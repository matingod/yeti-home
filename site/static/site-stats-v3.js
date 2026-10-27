(() => {
  'use strict';
  const root = document.querySelector('[data-site-stats]');
  if (!root) return;
  // 2026-10-26: the motion switch used to be inserted *before* the stats card, which meant the
  // card could never reach the scene's bottom edge and the switch floated over the gutters.
  // It now lives inside the card (positioned in the card's top-right corner by CSS), so the card
  // can span the full content width and still keep the switch reachable.
  function placeMotionControl() {
    const control = document.querySelector('body > .pixel-motion-control');
    if (!control) return;
    control.classList.add('site-stats-motion');
    if (control.parentElement !== root) root.append(control);
  }
  placeMotionControl();
  if (document.readyState !== 'complete') document.addEventListener('DOMContentLoaded',placeMotionControl,{once:true});
  const status = root.querySelector('[data-stats-status]');
  const number = new Intl.NumberFormat('en-US');
  let timer, busy = false, last = null, stopped = false;
  const validCount = value => Number.isSafeInteger(value) && value >= 0;
  const date = value => new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
  function render(data) {
    if (!['total_views','today_views','today_visitors'].every(key => validCount(data[key])) || !Number.isFinite(Date.parse(data.updated_at)) || !Number.isFinite(Date.parse(data.started_at))) throw new Error('Invalid statistics');
    for (const key of ['total_views','today_views','today_visitors','blocked_ips']) {
      const value = key === 'blocked_ips' && data.ban_status !== 'ok' ? null : data[key];
      root.querySelector(`[data-stat="${key}"]`).textContent = validCount(value) ? number.format(value) : '—';
    }
    last = data;
    const messages = [`自 ${date(data.started_at)} 起统计`, `更新于 ${date(data.updated_at)}（北京时间）`];
    if (Date.now() - Date.parse(data.updated_at) > 180000) messages.push('数据更新延迟');
    if (data.ban_status !== 'ok' || !validCount(data.blocked_ips)) messages.push('封禁数据暂不可用');
    status.textContent = messages.join(' · ');
  }
  async function load() {
    if (busy || document.hidden || stopped) return;
    clearTimeout(timer);busy = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch('/static/site-stats-v1.json', {cache:'no-store',credentials:'omit',signal:controller.signal});
      if (!response.ok) throw new Error('Statistics unavailable');
      render(await response.json());
    } catch (_) {
      status.textContent = last ? `更新暂时中断，显示 ${date(last.updated_at)} 的统计` : '统计暂时不可用，稍后自动重试';
    } finally {
      clearTimeout(timeout);busy = false;
      if (!stopped && !document.hidden) timer = setTimeout(load,60000);
    }
  }
  document.addEventListener('visibilitychange', () => {clearTimeout(timer);if (!document.hidden) load();});
  window.addEventListener('pagehide', () => {stopped = true;clearTimeout(timer);});
  window.addEventListener('pageshow', event => {if (event.persisted) {stopped = false;load();}});
  load();
})();
