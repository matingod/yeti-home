#!/usr/bin/env node
// build.js — 把 collector 采集的原始文本组装成 status.json
// 用法: node build.js <rawdir>
const fs = require("fs"), path = require("path");
const RAW = process.argv[2];
const rd = (f) => { try { return fs.readFileSync(path.join(RAW, f), "utf8"); } catch { return ""; } };
const j = (x) => JSON.stringify(x);

const ts = parseInt(rd("ts").trim() || "0", 10);
const cores = parseInt(rd("cores").trim() || "0", 10);
const load = rd("loadavg").trim().split(/\s+/).slice(0, 3).join(" ");
const mem = (rd("mem").trim().match(/\d+/g) || [0, 0, 0]).map(Number);
const mem_total = mem[0] || 0, mem_avail = mem[5] || 0, mem_used = mem_total - mem_avail;
const swap_used = Number((rd("swap").trim().match(/\d+/g) || [0, 0, 0])[1] || 0);
const uptime_s = parseInt(rd("uptime").trim() || "0", 10);
const mCpu = rd("cputemp").match(/\+\s*([0-9.]+)\s*°?C/);
const cpu_temp = mCpu ? parseFloat(mCpu[1]) : null;

// GPUs: index, name, uuid, mem.used, mem.total, util, temp, power
const gpus = rd("gpus").split("\n").filter(l => l.trim()).map(l => {
  const p = l.split(", ");
  return { idx: +p[0], name: p[1], uuid: p[2], mem_used: +p[3], mem_total: +p[4], util: +p[5], temp: +p[6], power: parseFloat(p[7] || "0") };
});
const gpu_apps = rd("gpu_apps").split("\n").filter(l => l.trim()).map(l => {
  const p = l.split(", ");
  return { pid: +p[0], uuid: p[1], mem: +p[2] };
});
// pid -> 进程名（尽力而为）
let pidNames = {};
try {
  const ps = require("child_process").execFileSync("ps", ["-eo", "pid=,comm="], { timeout: 4000 }).toString();
  for (const line of ps.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/);
    if (m) pidNames[+m[1]] = m[2].replace(/[\x00-\x1f\x7f]/g, "").slice(0, 40);
  }
} catch { }
for (const a of gpu_apps) a.name = pidNames[a.pid] || ("pid " + a.pid);

const vms = rd("vms").split("\n").map(l => l.trim().split(/\s+/)).filter(p => p.length >= 3 && /^\d+$/.test(p[0]) && p[1] !== "Id").map(p => ({ name: p[1], state: p[2] }));

// disks.ini
const disks2 = [];
{
  let cur = null;
  for (const line of rd("disks.ini").split("\n")) {
    const s = line.match(/^\["?([A-Za-z0-9]+)"?\]/);
    if (s) { if (cur) disks2.push(cur); cur = { dev: s[1] }; continue; }
    if (!cur) continue;
    const kv = line.match(/^(\w+)\s*=\s*"([^"]*)"/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (k === "status") cur.status = v;
    else if (k === "temp") cur.temp = v === "*" ? null : (parseInt(v, 10) || null);
    else if (k === "size") cur.size = parseInt(v, 10) || 0;
    else if (k === "name") cur.name = v;
    else if (k === "device") cur.device = v;
  }
  if (cur) disks2.push(cur);
}

const superDat = {};
for (const line of rd("super.dat").split("\n")) {
  const kv = line.match(/^(\w+)\s*=\s*"([^"]*)"/);
  if (kv) superDat[kv[1]] = kv[2];
}
const sync_action = rd("sync_action").trim() || "idle";

const mounts = rd("mounts").split("\n").filter(l => l.trim()).map(l => {
  const p = l.trim().split(/\s+/);
  return { path: p[0], size: +p[1], used: +p[2], pct: parseInt(p[3], 10) || 0 };
});

const apps = {};
for (const line of rd("apps").split("\n").filter(l => l.trim())) {
  const [name, code] = line.trim().split(/\s+/);
  apps[name] = { up: /^[1-5]\d\d$/.test(code), code };
}
const vh = (() => { try { return JSON.parse(rd("voice_health")); } catch { return {}; } })();
apps.voice_detail = { asr_loaded: !!vh.asr_loaded, tts_loaded: !!vh.tts_loaded };

// ---------- 贪吃蛇热力图数据 ----------
// 行 = 存储区（挂载点容量占比）；列 = 磁盘（温度）
const snake = {
  rows: mounts.filter(m => !m.path.includes("boot")).map(m => ({
    id: m.path.replace(/[^a-z]/gi, "_").slice(1), label: m.path, pct: m.pct, size: m.size, used: m.used
  })),
  cols: disks2.filter(d => d.status === "DISK_OK").map(d => ({
    id: d.dev, label: d.name || d.dev, temp: d.temp, size: d.size
  })),
};

const out = {
  ts,
  hardware: { load, cores, mem_total, mem_used, mem_avail, swap_used, uptime_s, cpu_temp, gpus, gpu_apps, vms,
    // 只在位盘：空槽位（DISK_NP / DISK_NP_DSBL，size=0）不算异常
    disks: disks2.filter(d => (d.size || 0) > 0)
      .map(d => ({ name: d.name || d.dev, dev: d.dev, temp: d.temp, size: d.size, status: d.status, ok: d.status === "DISK_OK" })),
    disk_slots_empty: disks2.filter(d => !(d.size > 0)).length },
  storage: { mounts, sync_action, array_state: superDat.mdState || "unknown", md_num_invalid: parseInt(superDat.mdNumInvalid || "0", 10) },
  apps,
  snake,
};
process.stdout.write(JSON.stringify(out));
