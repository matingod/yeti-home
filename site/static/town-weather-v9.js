/* Home town weather: fixed city coordinates, no geolocation, no cookies or API key. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TownWeatherV9 = api;
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict';
  const LOCATION = '云栖', SOURCE = 'Open-Meteo', SOURCE_URL = 'https://open-meteo.com/';
  const LAT = 31.23, LON = 121.47; // Public example coordinates; customize for your own deployment.
  const CACHE = `town-weather-v9:home:${LAT},${LON}`, ATTEMPT = CACHE + ':attempt';
  const REFRESH_MS = 15 * 60 * 1000, RETRY_MS = 60 * 1000, STALE_MS = 90 * 60 * 1000, MAX_CACHE_MS = 24 * 60 * 60 * 1000;
  const API_URL = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m&daily=sunrise,sunset&forecast_days=2&timezone=Asia%2FShanghai&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm`;
  // Optional same-origin snapshot; configure your own weather updater for deployment.
  // Same-origin, so a device that cannot reach api.open-meteo.com still gets current weather.
  const SNAPSHOT_URL = '/static/weather/home.json';
  // Snapshot first, upstream second: any snapshot failure silently falls back to the original
  // direct call, so behaviour without a snapshot is exactly the pre-2026-10-26 behaviour.
  async function fetchRaw(signal) {
    try {
      const local = await root.fetch(SNAPSHOT_URL + '?t=' + Date.now(), { method: 'GET', credentials: 'omit', cache: 'no-store', signal });
      if (local.ok) {
        const snap = await local.json();
        if (snap && snap.raw && snap.raw.current && typeof snap.raw.current.time === 'string') return snap.raw;
      }
    } catch (_) { /* fall through to upstream */ }
    const response = await root.fetch(API_URL, { method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal });
    if (!response.ok) throw new Error('Weather endpoint unavailable');
    return await response.json();
  }
  const CODES = {
    0: ['晴', 'clear'], 1: ['晴间多云', 'clear'], 2: ['多云', 'cloudy'], 3: ['阴', 'cloudy'],
    45: ['雾', 'fog'], 48: ['雾凇', 'fog'], 51: ['小毛毛雨', 'rain'], 53: ['毛毛雨', 'rain'], 55: ['较强毛毛雨', 'rain'],
    56: ['轻微冻毛毛雨', 'rain'], 57: ['冻毛毛雨', 'rain'], 61: ['小雨', 'rain'], 63: ['中雨', 'rain'], 65: ['大雨', 'rain'],
    66: ['轻微冻雨', 'rain'], 67: ['冻雨', 'rain'], 71: ['小雪', 'snow'], 73: ['中雪', 'snow'], 75: ['大雪', 'snow'], 77: ['米雪', 'snow'],
    80: ['小阵雨', 'rain'], 81: ['阵雨', 'rain'], 82: ['强阵雨', 'rain'], 85: ['小阵雪', 'snow'], 86: ['强阵雪', 'snow'],
    95: ['雷雨', 'thunder'], 96: ['雷雨伴冰雹', 'thunder'], 97: ['强雷雨', 'thunder'], 99: ['强雷雨伴冰雹', 'thunder']
  };
  const UNITS = { time: 'iso8601', interval: 'seconds', temperature_2m: '°C', apparent_temperature: '°C', is_day: '', precipitation: 'mm', rain: 'mm', showers: 'mm', snowfall: 'cm', weather_code: 'wmo code', cloud_cover: '%', wind_speed_10m: 'km/h', wind_direction_10m: '°' };
  const RANGES = { temperature_2m: [-60, 60], apparent_temperature: [-90, 80], is_day: [0, 1], precipitation: [0, 500], rain: [0, 500], showers: [0, 500], snowfall: [0, 100], cloud_cover: [0, 100], wind_speed_10m: [0, 250], wind_direction_10m: [0, 360], interval: [60, 3600] };
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  function dateKey(date) { return new Date(Number(date) + 8 * 3600000).toISOString().slice(0, 10); }
  function chinaTime(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error('Weather time is invalid');
    const iso = value + (value.length === 16 ? ':00' : '') + '+08:00', ms = Date.parse(iso);
    if (!Number.isFinite(ms) || new Date(ms + 8 * 3600000).toISOString().slice(0, 19) !== iso.slice(0, 19)) throw new Error('Weather date is invalid');
    return { iso, ms };
  }
  function empty(status = 'unavailable') {
    return { status, location: LOCATION, temp: null, apparentTemp: null, code: null, label: status === 'loading' ? '天气读取中' : '天气暂未取得', kind: null, cloud: null, windKmh: null, windDeg: null, intensity: 0, precipitationMm: null, rainMm: null, showersMm: null, snowCm: null, isDay: null, observedAt: null, fetchedAt: null, sunrise: null, sunset: null, sunHours: null, sunDays: [], timestampLabel: '', source: SOURCE, sourceURL: SOURCE_URL, sourceNote: '当前模型天气', message: status === 'loading' ? '正在读取云栖天气' : '天气暂未取得' };
  }
  function sunDaysFrom(raw) {
    const d = raw.daily, u = raw.daily_units;
    if (!d || !u || u.time !== 'iso8601' || u.sunrise !== 'iso8601' || u.sunset !== 'iso8601' || !Array.isArray(d.time)) return [];
    return d.time.slice(0, 3).flatMap((key, i) => {
      try {
        const rise = chinaTime(d.sunrise[i]), set = chinaTime(d.sunset[i]);
        if (dateKey(rise.ms) !== key || dateKey(set.ms) !== key || set.ms <= rise.ms || set.ms - rise.ms < 6 * 3600000 || set.ms - rise.ms > 18 * 3600000) return [];
        const hour = iso => Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
        return [{ date: key, sunrise: rise.iso, sunset: set.iso, sunHours: { date: key, sunrise: hour(rise.iso), sunset: hour(set.iso) } }];
      } catch (_) { return []; }
    });
  }
  function normalize(raw, fetchedAt, now = Date.now(), status = 'fresh') {
    if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.latitude) || !Number.isFinite(raw.longitude) || Math.abs(raw.latitude - LAT) > .3 || Math.abs(raw.longitude - LON) > .3) throw new Error('Weather location is invalid');
    if (raw.timezone !== 'Asia/Shanghai' || raw.utc_offset_seconds !== 28800) throw new Error('Weather timezone is invalid');
    const c = raw.current, units = raw.current_units;
    if (!c || !units || Object.keys(UNITS).some(key => units[key] !== UNITS[key])) throw new Error('Weather units are invalid');
    for (const [key, range] of Object.entries(RANGES)) {
      if (typeof c[key] !== 'number' || !Number.isFinite(c[key]) || c[key] < range[0] || c[key] > range[1]) throw new Error('Weather range is invalid');
    }
    if (!Number.isInteger(c.weather_code) || !CODES[c.weather_code] || !Number.isInteger(c.is_day)) throw new Error('Weather code is invalid');
    const observed = chinaTime(c.time), fetched = Date.parse(fetchedAt);
    if (!Number.isFinite(fetched) || fetched > now + 60000 || now - fetched > MAX_CACHE_MS || observed.ms > now + 20 * 60000 || now - observed.ms > MAX_CACHE_MS) throw new Error('Weather timestamp is invalid');
    const [label, kind] = CODES[c.weather_code];
    const minimum = ({51:.12,53:.2,55:.35,56:.15,57:.3,61:.2,63:.45,65:.8,66:.3,67:.6,71:.2,73:.45,75:.8,77:.15,80:.25,81:.5,82:.9,85:.25,86:.7,95:.6,96:.7,97:.85,99:.9})[c.weather_code] || 0;
    const intensity = minimum ? clamp(Math.max(minimum, c.precipitation / (c.interval / 3600) / 12, c.snowfall / (c.interval / 3600) / 4), .1, 1) : 0;
    const sunDays = sunDaysFrom(raw), today = sunDays.find(day => day.date === dateKey(now));
    const stale = now - observed.ms > STALE_MS || now - fetched > STALE_MS;
    const timestampLabel = c.time.slice(5, 10).replace('-', '/') + ' ' + c.time.slice(11, 16);
    return { ...empty(), status: stale ? 'stale' : status, temp: c.temperature_2m, apparentTemp: c.apparent_temperature, code: c.weather_code, label, kind, cloud: c.cloud_cover, windKmh: c.wind_speed_10m, windDeg: c.wind_direction_10m, intensity, precipitationMm: c.precipitation, rainMm: c.rain, showersMm: c.showers, snowCm: c.snowfall, isDay: c.is_day === 1, observedAt: observed.iso, fetchedAt: new Date(fetched).toISOString(), sunrise: today ? today.sunrise : null, sunset: today ? today.sunset : null, sunHours: today ? today.sunHours : null, sunDays, timestampLabel, message: stale ? '天气已过期 · ' + timestampLabel : status === 'cached' ? '缓存天气 · ' + timestampLabel : '更新于 ' + timestampLabel };
  }
  function create(options = {}) {
    const doc = root.document, onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
    let destroyed = false, pending = null, controller = null, timer = null, lastAttempt = 0, lastSaved = null, current = empty('loading');
    const visible = () => !doc || doc.visibilityState !== 'hidden';
    function read(key) { try { return root.localStorage.getItem(key); } catch (_) { return null; } }
    function write(key, value) { try { root.localStorage.setItem(key, value); } catch (_) {} }
    function emit(value) { if (destroyed) return; current = value; try { onChange({ ...value }); } catch (_) {} }
    function newer(saved, previous) {
      if (!previous) return true;
      const observed = chinaTime(saved.raw.current.time).ms, prior = chinaTime(previous.raw.current.time).ms;
      return observed > prior || (observed === prior && Date.parse(saved.fetchedAt) > Date.parse(previous.fetchedAt));
    }
    function cacheValue() {
      const text = read(CACHE);
      if (text) {
        try {
          const saved = JSON.parse(text);
          if (saved.version === 1) { normalize(saved.raw, saved.fetchedAt, Date.now(), 'cached'); if (newer(saved, lastSaved)) lastSaved = saved; }
        } catch (_) {}
      }
      if (lastSaved) { try { return normalize(lastSaved.raw, lastSaved.fetchedAt, Date.now(), 'cached'); } catch (_) { lastSaved = null; } }
      return null;
    }
    function ageState() {
      if (lastSaved) {
        try { current = normalize(lastSaved.raw, lastSaved.fetchedAt, Date.now(), current.status === 'fresh' ? 'fresh' : 'cached'); }
        catch (_) { lastSaved = null; current = empty(); }
      }
      return { ...current };
    }
    function schedule() {
      if (timer) root.clearTimeout(timer);
      timer = null;
      if (!destroyed && visible()) timer = root.setTimeout(() => { timer = null; refresh(); }, 60000);
    }
    async function refresh() {
      if (destroyed) return ageState();
      if (pending) return pending;
      const cached = cacheValue();
      if (!visible()) { if (cached) emit(cached); return ageState(); }
      const now = Date.now(), externalAttempt = Number(read(ATTEMPT));
      const recentAttempt = Number.isFinite(externalAttempt) && externalAttempt <= now + 60000 ? externalAttempt : 0;
      const recentFetch = lastSaved ? Date.parse(lastSaved.fetchedAt) : 0;
      // Failures share only a short retry window; successful data keeps its 15-minute cadence.
      const due = Math.max(lastAttempt, recentAttempt);
      if ((due && now - due < RETRY_MS) || (cached && cached.status !== 'stale' && recentFetch && now - recentFetch < REFRESH_MS)) { emit(cached || empty()); schedule(); return ageState(); }
      lastAttempt = now;
      write(ATTEMPT, String(now));
      if (!cached) emit(empty('loading')); else emit(cached);
      controller = new root.AbortController();
      const abort = root.setTimeout(() => controller && controller.abort(), 10000);
      pending = Promise.resolve().then(async () => {
        try {
          const raw = await fetchRaw(controller.signal), fetchedAt = new Date().toISOString();
          const weather = normalize(raw, fetchedAt, Date.now(), 'fresh');
          if (!destroyed) {
            const latest = cacheValue(), saved = { version: 1, raw, fetchedAt };
            if (newer(saved, lastSaved)) { lastSaved = saved; write(CACHE, JSON.stringify(lastSaved)); emit(weather); }
            else emit(latest);
          }
        } catch (_) { if (!destroyed) emit(cacheValue() || empty()); }
        finally { root.clearTimeout(abort); pending = null; controller = null; schedule(); }
        return ageState();
      });
      return pending;
    }
    function visibilityChange() {
      if (visible()) refresh();
      else { if (timer) root.clearTimeout(timer); timer = null; if (controller) controller.abort(); }
    }
    function storageChange(event) { if (event.key === CACHE) { const cached = cacheValue(); if (cached) emit(cached); } }
    if (doc) doc.addEventListener('visibilitychange', visibilityChange);
    if (root.addEventListener) root.addEventListener('storage', storageChange);
    const initial = cacheValue();
    if (initial) emit(initial); else emit(empty(visible() ? 'loading' : 'unavailable'));
    refresh();
    return {
      getState: ageState,
      refresh,
      getSunHours(date = new Date()) {
        const key = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dateKey(new Date(date));
        const state = ageState();
        if (state.status !== 'fresh' && state.status !== 'cached') return null;
        const day = state.sunDays.find(item => item.date === key);
        return day ? { ...day.sunHours } : null;
      },
      destroy() {
        destroyed = true;
        if (timer) root.clearTimeout(timer);
        if (controller) controller.abort();
        if (doc) doc.removeEventListener('visibilitychange', visibilityChange);
        if (root.removeEventListener) root.removeEventListener('storage', storageChange);
      }
    };
  }
  return { create, normalize, constants: Object.freeze({ API_URL, CACHE, ATTEMPT, REFRESH_MS, STALE_MS, MAX_CACHE_MS }) };
});
