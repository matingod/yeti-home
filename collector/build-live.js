#!/usr/bin/env node
"use strict";

// A small, independent hardware sample. No service, VM, or storage probing.
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const COMMAND_TIMEOUT_MS = 2200;
const MAX_OUTPUT_BYTES = 512 * 1024;

function number(value, { integer = false, min = 0 } = {}) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("invalid number");
  const valueNumber = Number(text);
  if (!Number.isFinite(valueNumber) || valueNumber < min ||
      (integer && !Number.isSafeInteger(valueNumber))) throw new Error("invalid number");
  return valueNumber;
}

function parseLoad(raw) {
  const values = raw.trim().split(/\s+/).slice(0, 3);
  if (values.length !== 3) throw new Error("invalid load");
  values.forEach(value => number(value));
  return values.join(" ");
}

function parseCores(raw) {
  const count = raw.split(/\r?\n/).filter(line => /^cpu\d+\s/.test(line)).length;
  if (!count) throw new Error("invalid cores");
  return count;
}

function parseMemory(raw) {
  const get = key => {
    const match = raw.match(new RegExp("^" + key + ":\\s+(\\d+)\\s+kB\\s*$", "m"));
    if (!match) throw new Error("missing memory field");
    const bytes = number(match[1], { integer: true }) * 1024;
    if (!Number.isSafeInteger(bytes)) throw new Error("invalid memory field");
    return bytes;
  };
  const values = {}, errors = [];
  try { values.mem_total = get("MemTotal"); if (!values.mem_total) throw new Error(); }
  catch { delete values.mem_total; errors.push("mem_total"); }
  try {
    const total = get("MemTotal"), available = get("MemAvailable");
    if (!total || available > total) throw new Error();
    values.mem_used = total - available;
  } catch { errors.push("mem_used"); }
  try {
    const total = get("SwapTotal"), free = get("SwapFree");
    if (free > total) throw new Error();
    values.swap_used = total - free;
  } catch { errors.push("swap_used"); }
  return { values, errors };
}

function parseUptime(raw) {
  return Math.floor(number(raw.trim().split(/\s+/)[0]));
}

function parseCpuTemp(raw) {
  const match = raw.match(/^Package id 0:\s*\+?([\d.]+)\s*°?C/m);
  if (!match) throw new Error("missing CPU temperature");
  const temp = number(match[1]);
  if (temp > 150) throw new Error("invalid CPU temperature");
  return temp;
}

function csvLine(line) {
  const columns = [];
  let field = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { columns.push(field.trim()); field = ""; }
    else field += char;
  }
  if (quoted) throw new Error("invalid CSV");
  columns.push(field.trim());
  return columns;
}

function parseGpus(raw) {
  const seen = new Set();
  return raw.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const p = csvLine(line);
    if (p.length !== 9 || !p[1] || !/^GPU-[\w-]+$/.test(p[2])) throw new Error("invalid GPU row");
    const row = {
      idx: number(p[0], { integer: true }), name: p[1], uuid: p[2],
      mem_used: number(p[3]), mem_total: number(p[4]),
      util: number(p[5]), temp: number(p[6]), power: number(p[7]),
      // Driver-reserved VRAM is neither used nor allocatable free memory.
      mem_free: number(p[8])
    };
    if (seen.has(row.idx) || row.mem_used > row.mem_total || row.mem_free > row.mem_total ||
        row.mem_free + row.mem_used > row.mem_total || row.util > 100 || row.temp > 150)
      throw new Error("invalid GPU row");
    seen.add(row.idx);
    return row;
  });
}

function parseGpuApps(raw) {
  return raw.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const p = csvLine(line);
    if (p.length !== 3 || !/^GPU-[\w-]+$/.test(p[1])) throw new Error("invalid GPU process");
    const pid = number(p[0], { integer: true, min: 1 });
    return { pid, uuid: p[1], mem: number(p[2]), name: "pid " + pid };
  });
}

// Resolve at the deadline even if a driver child cannot immediately exit.
// No shell and no stderr are exposed in the public result or collector logs.
function runCommand(command, args, timeoutMs = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let settled = false, bytes = 0, chunks = [];
    let timer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        child.stdout.destroy();
        child.unref();
        reject(new Error("command unavailable"));
      } else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    child.once("error", () => finish(true));
    child.stdout.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) finish(true);
      else chunks.push(chunk);
    });
    child.once("close", code => finish(code !== 0));
    timer = setTimeout(() => finish(true), timeoutMs);
  });
}

async function collect({ readFile = fs.readFile, run = runCommand, now = Date.now } = {}) {
  // Conservative measurement origin, before either NVIDIA query. `ts` below
  // remains publication/completion time and must not authorize GPU release.
  const sampleStartedAtMs = now();
  const hardware = {}, failed = new Set();
  const field = async (name, task, parse) => {
    try { hardware[name] = parse(await task()); }
    catch { failed.add(name); }
  };
  await Promise.all([
    field("load", () => readFile("/proc/loadavg", "utf8"), parseLoad),
    field("cores", () => readFile("/proc/stat", "utf8"), parseCores),
    field("uptime_s", () => readFile("/proc/uptime", "utf8"), parseUptime),
    (async () => {
      try {
        const parsed = parseMemory(await readFile("/proc/meminfo", "utf8"));
        Object.assign(hardware, parsed.values);
        parsed.errors.forEach(name => failed.add(name));
      } catch { ["mem_total", "mem_used", "swap_used"].forEach(name => failed.add(name)); }
    })(),
    field("cpu_temp", () => run("sensors", []), parseCpuTemp),
    field("gpus", () => run("nvidia-smi", [
      "--query-gpu=index,name,uuid,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw,memory.free",
      "--format=csv,noheader,nounits"
    ]), parseGpus),
    (async () => {
      try {
        const rows = parseGpuApps(await run("nvidia-smi", [
          "--query-compute-apps=pid,gpu_uuid,used_memory", "--format=csv,noheader,nounits"
        ]));
        await Promise.all(rows.map(async row => {
          try {
            const name = (await readFile("/proc/" + row.pid + "/comm", "utf8")).trim();
            if (name) row.name = name.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 40);
          } catch { /* A process may exit between the GPU query and this read. */ }
        }));
        hardware.gpu_apps = rows;
      } catch { failed.add("gpu_apps"); }
    })()
  ]);
  return { version: 1, sampleStartedAtMs, ts: Math.floor(now() / 1000), hardware, errors: [...failed].sort() };
}

async function writeAtomic(filename, result) {
  const temporary = path.join(path.dirname(filename), ".live-" + process.pid + "-" + Date.now() + ".tmp");
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o644);
    await handle.writeFile(JSON.stringify(result) + "\n", "utf8");
    await handle.sync();
    await handle.close(); handle = undefined;
    await fs.rename(temporary, filename);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

async function main(args) {
  if (!(args.length === 1 && args[0] === "--stdout") &&
      !(args.length === 2 && args[0] === "--write" && path.isAbsolute(args[1]))) {
    throw new Error("invalid arguments");
  }
  const deadline = setTimeout(() => process.exit(1), 6500);
  try {
    const result = await collect();
    if (args[0] === "--stdout") process.stdout.write(JSON.stringify(result) + "\n");
    else await writeAtomic(args[1], result);
  } finally { clearTimeout(deadline); }
}

module.exports = { number, parseLoad, parseCores, parseMemory, parseUptime, parseCpuTemp,
  csvLine, parseGpus, parseGpuApps, runCommand, collect, writeAtomic };

// `node - --stdout` also permits a read-only remote check via stdin, without
// copying a candidate onto the server or touching its existing live.json.
if (require.main === module || (require.main == null && process.argv[1] === "-")) {
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write("live collector failed\n");
    process.exitCode = 1;
  });
}
