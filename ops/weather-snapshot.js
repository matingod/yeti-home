#!/usr/bin/env node
/**
 * 云栖天气快照生成器（2026-10-26）
 *
 * 为什么要有它：首页天气是纯前端 JS 直连 Open-Meteo，浏览器侧一旦刷新失败
 * （网络/代理/CORS），服务端完全无痕，只能等用户看到"天气已过期"。
 * 这个脚本在服务器出口定时拉一次，落成同源快照 + 健康状态：
 *   - www/static/weather/home.json      同源快照（前端可兜底，也可人工查）
 *   - data/weather-health.json          每次探测的健康状态（监控数据源）
 *
 * 上游失败不删旧快照；health.json 记连续失败次数，供监控判"两轮失败"。
 * 退出码：0 = 本轮成功，1 = 本轮失败（旧快照保留）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.env.HOMEPAGE_ROOT || '/srv/homepage';
const SNAP_DIR = path.join(ROOT, 'www/static/weather');
const SNAP = path.join(SNAP_DIR, 'home.json');
const HEALTH = path.join(ROOT, 'data/weather-health.json');

const LOCATION = process.env.WEATHER_LOCATION || '云栖';
const LAT = Number(process.env.WEATHER_LAT || '31.23');
const LON = Number(process.env.WEATHER_LON || '121.47');
if (!Number.isFinite(LAT) || LAT < -90 || LAT > 90 || !Number.isFinite(LON) || LON < -180 || LON > 180) throw new Error('Invalid weather coordinates');
const API_URL = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
  '&current=temperature_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,' +
  'weather_code,cloud_cover,wind_speed_10m,wind_direction_10m' +
  '&daily=sunrise,sunset&forecast_days=2&timezone=Asia%2FShanghai' +
  '&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm';
const TIMEOUT_MS = 15000;
const MAX_OBS_AGE_MIN = 180;   // 观测时间超过 3 小时视为上游数据陈旧

function writeAtomic(file, text) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function validate(raw) {
  const cur = raw && raw.current;
  if (!cur || typeof cur !== 'object') throw new Error('missing current block');
  if (typeof cur.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(cur.time)) {
    throw new Error('bad current.time: ' + cur.time);
  }
  const t = Number(cur.temperature_2m);
  if (!Number.isFinite(t) || t < -60 || t > 60) throw new Error('bad temperature: ' + cur.temperature_2m);
  if (!Number.isFinite(Number(cur.weather_code))) throw new Error('bad weather_code');
  const obsMs = Date.parse(cur.time + ':00+08:00');
  if (!Number.isFinite(obsMs)) throw new Error('unparseable current.time');
  const ageMin = (Date.now() - obsMs) / 60000;
  if (ageMin > MAX_OBS_AGE_MIN) throw new Error('upstream observation stale: ' + Math.round(ageMin) + 'min old');
  return { obsMs, ageMin, temp: t, code: Number(cur.weather_code) };
}

(async () => {
  const now = new Date();
  const prev = readJson(HEALTH, {});
  let health = {
    ok: false,
    checkedAt: now.toISOString(),
    lastOkAt: prev.lastOkAt || null,
    snapshotAgeMin: null,
    observedAt: null,
    temp: null,
    weatherCode: null,
    error: null,
    consecutiveFailures: Number(prev.consecutiveFailures || 0),
    consecutiveFailuresAt: prev.consecutiveFailures ? (prev.checkedAt || null) : null,
    source: LOCATION,
    api: 'open-meteo'
  };
  let code = 1;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(API_URL, { signal: ctrl.signal, headers: { 'user-agent': 'yeti-weather-snapshot/1.0' } });
    } finally { clearTimeout(timer); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const raw = await res.json();
    const v = validate(raw);

    fs.mkdirSync(SNAP_DIR, { recursive: true });
    writeAtomic(SNAP, JSON.stringify({
      version: 1,
      location: LOCATION,
      source: 'open-meteo',
      sourceUrl: 'https://open-meteo.com/',
      fetchedAt: new Date().toISOString(),
      observedAt: raw.current.time,
      raw
    }, null, 2));
    try { fs.chmodSync(SNAP, 0o644); } catch (_) {}

    health.ok = true;
    health.lastOkAt = health.checkedAt;
    health.observedAt = raw.current.time;
    health.temp = v.temp;
    health.weatherCode = v.code;
    health.observationAgeMin = Math.round(v.ageMin);
    health.consecutiveFailures = 0;
    health.consecutiveFailuresAt = null;
    code = 0;
  } catch (err) {
    health.error = String(err && err.message || err).slice(0, 200);
    health.consecutiveFailures += 1;
    health.consecutiveFailuresAt = health.checkedAt;
  }

  // 快照新鲜度单独算：即使本轮失败，也要能看出已落盘的快照有多旧
  const snap = readJson(SNAP, null);
  if (snap && snap.fetchedAt) {
    health.snapshotAgeMin = Math.round((Date.now() - Date.parse(snap.fetchedAt)) / 60000);
  }
  try {
    fs.mkdirSync(path.dirname(HEALTH), { recursive: true });
    writeAtomic(HEALTH, JSON.stringify(health, null, 2) + '\n');
  } catch (e) {
    console.error('health write failed:', e.message);
  }

  if (code === 0) {
    console.log(`weather-snapshot ok ${health.temp}C ${health.observedAt} (${health.observationAgeMin}min old)`);
  } else {
    console.error(`weather-snapshot FAIL: ${health.error} (consecutive=${health.consecutiveFailures}, snapshotAge=${health.snapshotAgeMin}min)`);
  }
  process.exit(code);
})();
