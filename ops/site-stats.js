#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');

function header(headers, name) {
  const key = Object.keys(headers || {}).find(key => key.toLowerCase() === name.toLowerCase());
  const value = key === undefined ? '' : headers[key];
  return Array.isArray(value) ? value.join(' ') : String(value || '');
}
function eligible(entry, www) {
  const req = entry.request || {};
  if (req.method !== 'GET' || entry.status !== 200 || !net.isIP(req.remote_ip || '')) return false;
  if (!/^text\/html(?:\s*;|\s*$)/i.test(header(entry.resp_headers, 'Content-Type'))) return false;
  if (/bot|crawler|spider|curl|wget|python|HeadlessChrome|HomeStatsVerify/i.test(String(entry.site_user_agent ?? header(req.headers, 'User-Agent')))) return false;
  const uri = entry.site_path ?? req.uri;
  if (typeof uri !== 'string' || !uri.startsWith('/') || uri.startsWith('//')) return false;
  const route = uri.split('?')[0];
  if (/%|\\|(?:^|\/)\.{1,2}(?:\/|$)/.test(route)) return false;
  if (!['/', '/index.html', '/yeti/', '/yuki/', '/blog/', '/blog/ai-workbench/', '/blog/yeti-home/'].includes(route) && !/^\/(?:yeti|yuki|blog)\/(?:[^/]+\/)*(?:[^/]+\.html)?$/.test(route)) return false;
  if (/(?:^|\/)(?:login|api|static|vfx)(?:\/|$)/i.test(route)) return false;
  if (!www) return ['/', '/index.html', '/yeti/', '/yuki/', '/blog/', '/blog/ai-workbench/', '/blog/yeti-home/'].includes(route);
  try {
    const root = fs.realpathSync(www);
    const file = fs.realpathSync(path.join(root, route, route.endsWith('/') ? 'index.html' : ''));
    return file.startsWith(root + path.sep) && fs.statSync(file).isFile();
  } catch { return false; }
}

const day = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

function bans(file, now) {
  try {
    const fails = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!fails || Array.isArray(fails) || typeof fails !== 'object') throw new Error('invalid');
    const ips = new Set();
    for (const [key, value] of Object.entries(fails)) {
      const ip = key.slice(0, key.indexOf('|'));
      if (!key.includes('|') || !net.isIP(ip) || !Array.isArray(value) || value.length !== 2 || !Number.isSafeInteger(value[0]) || value[0] < 0 || !Number.isFinite(value[1]) || value[1] < 0) throw new Error('invalid');
      const [n, timestamp] = value;
      if (n >= 5 && now.getTime() / 1000 - timestamp < 600 * 2 ** (n - 5)) ips.add(ip);
    }
    return { blocked_ips: ips.size, ban_status: 'ok' };
  } catch { return { blocked_ips: null, ban_status: 'unavailable' }; }
}

function atomicWrite(file, value, mode) {
  const temp = file + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', mode);
    fs.writeFileSync(fd, JSON.stringify(value) + '\n');
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
    const dir = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function acquireLock(file) {
  const create = () => {
    const fd = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }) + '\n');
    return fd;
  };
  try { return create(); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  // Serialize stale-lock reclamation: never unlink a successor's live lock.
  let reaper;
  try { reaper = fs.openSync(file + '.reap', 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('LOCKED'); throw error; }
  try {
    if (fs.existsSync(file)) {
      const before = fs.lstatSync(file);
      let owner;
      try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('LOCKED'); }
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('LOCKED');
      try { process.kill(owner.pid, 0); throw new Error('LOCKED'); }
      catch (error) { if (error.code !== 'ESRCH') throw new Error('LOCKED'); }
      const after = fs.lstatSync(file);
      if (before.dev !== after.dev || before.ino !== after.ino) throw new Error('LOCKED');
      fs.unlinkSync(file);
    }
    try { return create(); } catch (error) { if (error.code === 'EEXIST') throw new Error('LOCKED'); throw error; }
  } finally { fs.closeSync(reaper); fs.unlinkSync(file + '.reap'); }
}

function collect(options) {
  fs.mkdirSync(path.dirname(options.state), { recursive: true, mode: 0o700 });
  const lock = acquireLock(options.state + '.lock');
  try { return collectLocked(options); }
  finally { fs.closeSync(lock); fs.unlinkSync(options.state + '.lock'); }
}
const inode = stat => `${stat.dev}:${stat.ino}`;
function readLogs(options, state) {
  const active = fs.statSync(options.log);
  const activeKey = inode(active);
  const directory = path.dirname(options.log);
  const base = path.basename(options.log);
  const stem = path.basename(base, path.extname(base));
  const files = new Map([[activeKey, options.log]]);
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) continue;
    const key = inode(stat);
    if (key === state.current || state.sources[key] || ((name.startsWith(base + '.') || name.startsWith(stem + '-')) && !/\.(?:gz|zip|zst|tmp)$/.test(name))) files.set(key, file);
  }
  if (state.current && !files.has(state.current)) throw new Error('ROTATION_GAP');
  const entries = [];
  for (const [key, file] of files) {
    const source = state.sources[key] ||= { offset: 0 };
    const fd = fs.openSync(file, 'r');
    try {
      if (inode(fs.fstatSync(fd)) !== key) throw new Error('ROTATION_RACE');
      const data = fs.readFileSync(fd);
      if (data.length < source.offset || (source.anchor && source.anchor !== crypto.createHash('sha256').update(data.subarray(Math.max(0, source.offset - 4096), source.offset)).digest('hex'))) throw new Error('LOG_REWRITTEN');
      const unread = data.subarray(source.offset);
      const complete = unread.subarray(0, unread.lastIndexOf(10) + 1);
      source.offset += complete.length;
      if (key !== activeKey && source.offset !== data.length) throw new Error('ROTATION_PARTIAL');
      source.anchor = crypto.createHash('sha256').update(data.subarray(Math.max(0, source.offset - 4096), source.offset)).digest('hex');
      for (const line of complete.toString('utf8').split('\n').filter(Boolean)) entries.push(JSON.parse(line));
    } finally { fs.closeSync(fd); }
  }
  if (inode(fs.statSync(options.log)) !== activeKey) throw new Error('ROTATION_RACE');
  state.current = activeKey;
  return entries;
}

function validateState(state) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!object(state) || state.schema !== 1 || !/^[a-f0-9]{64}$/.test(state.secret) || !Number.isFinite(Date.parse(state.started_at)) || !count(state.total_views) || !object(state.daily) || !object(state.visitors) || !object(state.sources)) throw new Error('STATE_INVALID');
  if (Object.entries(state.daily).some(([key, value]) => !date(key) || !count(value)) || Object.values(state.daily).reduce((a, b) => a + b, 0) !== state.total_views) throw new Error('STATE_INVALID');
  if (Object.entries(state.visitors).some(([key, value]) => !date(key) || !Array.isArray(value) || value.some(hash => !/^[a-f0-9]{64}$/.test(hash)))) throw new Error('STATE_INVALID');
  if (Object.entries(state.sources).some(([key, value]) => !/^\d+:\d+$/.test(key) || !object(value) || !count(value.offset) || (value.anchor !== undefined && !/^[a-f0-9]{64}$/.test(value.anchor)))) throw new Error('STATE_INVALID');
  if (state.current !== undefined && !state.sources[state.current]) throw new Error('STATE_INVALID');
}

function collectLocked(options) {
  const now = options.now || new Date();
  const state = fs.existsSync(options.state) ? JSON.parse(fs.readFileSync(options.state, 'utf8')) : { schema: 1, started_at: now.toISOString(), secret: crypto.randomBytes(32).toString('hex'), total_views: 0, daily: {}, visitors: {} };
  state.sources ||= {};
  validateState(state);
  const lines = readLogs(options, state).filter(entry => Number.isFinite(entry.ts) && Number.isFinite(new Date(entry.ts * 1000).getTime()) && eligible(entry, options.www));
  for (const entry of lines) {
    const date = day(new Date(entry.ts * 1000));
    state.total_views++;
    state.daily[date] = (state.daily[date] || 0) + 1;
    const hash = crypto.createHmac('sha256', state.secret).update(date + '\0' + entry.request.remote_ip).digest('hex');
    state.visitors[date] ||= [];
    if (!state.visitors[date].includes(hash)) state.visitors[date].push(hash);
  }
  const keepDates = new Set([day(now), day(new Date(now.getTime() - 86400000))]);
  for (const date of Object.keys(state.visitors)) if (!keepDates.has(date)) delete state.visitors[date];
  const result = { schema: 1, started_at: state.started_at, updated_at: now.toISOString(), time_zone: 'Asia/Shanghai', total_views: state.total_views, today_views: state.daily[day(now)] || 0, today_visitors: (state.visitors[day(now)] || []).length, ...bans(options.fails, now) };
  fs.mkdirSync(path.dirname(options.state), { recursive: true, mode: 0o700 });
  atomicWrite(options.state, state, 0o600);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  atomicWrite(options.output, result, 0o644);
  return result;
}
module.exports = { collect };
if (require.main === module) {
  try {
    const options = {};
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
      if (!['--log', '--state', '--output', '--fails', '--www'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options[args[i].slice(2)]) throw new Error('USAGE');
      options[args[i].slice(2)] = args[i + 1];
    }
    if (!['log', 'state', 'output', 'fails'].every(key => options[key])) throw new Error('USAGE');
    collect(options);
  } catch (error) {
    const code = error.message === 'LOCKED' ? 'LOCKED' : error.message === 'USAGE' ? 'USAGE: --log FILE --state FILE --output FILE --fails FILE [--www DIR]' : 'COLLECTION_FAILED';
    process.stderr.write('site-stats: ' + code + '\n');
    process.exitCode = error.message === 'LOCKED' ? 75 : 1;
  }
}
