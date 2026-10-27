/* 定时任务管理前端：只调用同源 /cron-api/<profile>/jobs，鉴权由 Caddy+gatekeeper 完成。 */
(() => {
  'use strict';
  const root = document.querySelector('[data-cron-console]');
  if (!root) return;
  const self = root.dataset.profile;
  const allowSwitch = root.dataset.switch === '1';
  const $ = (sel, el = document) => el.querySelector(sel);
  const listEl = $('#cc-list');
  const filtersEl = $('#cc-filters');
  const alertEl = $('#cc-alert');
  const dialog = $('#cc-dialog');
  const form = $('#cc-form');
  const formErr = $('#cc-form-err');
  const toastEl = $('#cc-toast');
  let profile = self;
  let jobs = [];
  let filter = 'all';
  let editing = null;
  let busy = false;

  const NAMES = { yeti: '阿暖', yuki: '阿安' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  let toastTimer;
  function toast(msg, bad) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    toastEl.style.background = bad ? '#7a2020' : '#2b2318';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3600);
  }
  function alert(msg, kind) {
    if (!msg) { alertEl.hidden = true; alertEl.textContent = ''; return; }
    alertEl.hidden = false;
    alertEl.className = 'cc-alert cc-alert--' + (kind === 'ok' ? 'ok' : 'err');
    alertEl.textContent = msg;
  }

  async function api(method, path, body) {
    const res = await fetch(`/cron-api/${profile}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* ignore */ }
    if (!res.ok) throw new Error((data && data.error) || `请求失败（HTTP ${res.status}）`);
    return data;
  }

  function stateTag(j) {
    if (j.enabled) return '<span class="cc-tag cc-tag--on">运行中</span>';
    if (j.state === 'completed') return '<span class="cc-tag cc-tag--off">已完成</span>';
    return '<span class="cc-tag cc-tag--off">已暂停</span>';
  }

  function card(j) {
    const last = j.last_status
      ? `<span class="cc-tag ${j.last_status === 'ok' ? 'cc-tag--on' : 'cc-tag--bad'}">上次 ${esc(j.last_status)}</span>`
      : '<span class="cc-tag">还没跑过</span>';
    const repeat = j.repeat_times
      ? `${j.repeat_completed || 0}/${j.repeat_times} 次`
      : '长期';
    const action = j.enabled
      ? `<button class="cc-icon" data-act="pause" data-id="${esc(j.id)}">暂停</button>`
      : (j.state === 'completed' ? '' : `<button class="cc-icon" data-act="resume" data-id="${esc(j.id)}">恢复</button>`);
    return `
    <article class="cc-card${j.enabled ? '' : ' is-off'}" data-id="${esc(j.id)}">
      <div class="cc-card-top">
        <h2 class="cc-name">${esc(j.name || '(未命名任务)')}</h2>
        <div class="cc-meta">${stateTag(j)}${last}</div>
      </div>
      <div class="cc-facts">
        <div>计划<b>${esc(j.schedule || '—')}</b></div>
        <div>下次运行<b>${esc(fmt(j.next_run_at))}</b></div>
        <div>上次运行<b>${esc(fmt(j.last_run_at))}</b></div>
        <div>投递<b>${esc(j.deliver || '默认')}</b></div>
        <div>重复<b>${esc(repeat)}</b></div>
        <div>模式<b>${j.no_agent ? '脚本直出' : (j.script ? '脚本+AI' : 'AI 任务')}</b></div>
      </div>
      ${j.last_error ? `<p class="cc-alert cc-alert--err" style="margin:12px 0 0">${esc(j.last_error)}</p>` : ''}
      <div class="cc-actions">
        <button class="cc-icon" data-act="run" data-id="${esc(j.id)}">立即运行</button>
        ${action}
        <button class="cc-icon" data-act="edit" data-id="${esc(j.id)}">编辑</button>
        <button class="cc-icon cc-icon--danger" data-act="del" data-id="${esc(j.id)}">删除</button>
      </div>
    </article>`;
  }

  function render() {
    const shown = jobs.filter((j) => filter === 'all' || (filter === 'on' ? j.enabled : !j.enabled));
    const who = NAMES[profile] || profile;
    $('#cc-count').textContent = `共 ${jobs.length} 个任务 · 运行中 ${jobs.filter((j) => j.enabled).length} 个`;
    if (!shown.length) {
      listEl.innerHTML = `<div class="cc-empty"><strong>${jobs.length ? '这个筛选下没有任务' : `${who}还没有定时任务`}</strong>${jobs.length ? '换个筛选看看。' : '点右上角「新建任务」创建第一个，比如每天早上汇总一次服务器状态。'}</div>`;
      return;
    }
    listEl.innerHTML = shown.map(card).join('');
    if (root.dataset.demo === 'true') {
      listEl.querySelectorAll('[data-act]').forEach(button => { button.disabled = true; button.title = '演示未接入任务网关，不会执行'; });
    }
  }

  async function load() {
    alert('');
    listEl.innerHTML = '<div class="cc-empty"><strong>正在读取任务清单…</strong></div>';
    try {
      const data = await api('GET', '/jobs');
      jobs = data.jobs || [];
      render();
    } catch (e) {
      listEl.innerHTML = '';
      alert(e.message + '（可刷新页面重试）');
    }
  }

  async function act(verb, id) {
    if (busy) return;
    const job = jobs.find((j) => j.id === id);
    if (verb === 'del') {
      const name = job ? job.name : id;
      if (!confirm(`确定删除「${name}」？删除后无法恢复。`)) return;
    }
    busy = true;
    document.querySelectorAll('.cc-icon').forEach((b) => { b.disabled = true; });
    try {
      if (verb === 'del') await api('DELETE', `/jobs/${id}`);
      else if (verb === 'edit') { openForm(job); return; }
      else {
        const r = await api('POST', `/jobs/${id}/${verb}`);
        toast(r.message || '操作完成', false);
      }
      if (verb === 'del') toast('任务已删除', false);
      await load();
    } catch (e) {
      alert(e.message);
      toast(e.message, true);
    } finally {
      busy = false;
      document.querySelectorAll('.cc-icon').forEach((b) => { b.disabled = false; });
    }
  }

  function openForm(job) {
    editing = job || null;
    formErr.textContent = '';
    $('#cc-dialog-title').textContent = job ? '编辑任务' : '新建任务';
    $('#f-name').value = job ? job.name : '';
    $('#f-schedule').value = job ? job.schedule : '';
    $('#f-prompt').value = job ? job.prompt : '';
    $('#f-deliver').value = job ? (job.deliver || 'origin') : 'origin';
    $('#f-repeat').value = job && job.repeat_times ? String(job.repeat_times) : '';
    dialog.showModal();
    $('#f-name').focus();
  }

  listEl.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    act(btn.dataset.act, btn.dataset.id);
  });
  filtersEl.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-filter]');
    if (!b) return;
    filter = b.dataset.filter;
    filtersEl.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    render();
  });
  $('#cc-new').addEventListener('click', () => openForm(null));
  $('#cc-refresh').addEventListener('click', load);
  $('#cc-cancel').addEventListener('click', () => dialog.close());
  root.querySelectorAll('[data-profile-switch]').forEach((b) => {
    b.addEventListener('click', () => {
      profile = b.dataset.profileSwitch;
      root.querySelectorAll('[data-profile-switch]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#cc-owner').textContent = NAMES[profile] || profile;
      load();
    });
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const body = {
      name: $('#f-name').value.trim(),
      schedule: $('#f-schedule').value.trim(),
      prompt: $('#f-prompt').value.trim(),
      deliver: $('#f-deliver').value,
      repeat: $('#f-repeat').value.trim(),
    };
    if (!body.schedule) { formErr.textContent = '请填写计划'; $('#f-schedule').focus(); return; }
    if (!body.prompt && !editing) { formErr.textContent = '请填写任务内容'; $('#f-prompt').focus(); return; }
    const submit = $('#cc-save');
    submit.disabled = true;
    formErr.textContent = '';
    try {
      if (editing) {
        const patch = { name: body.name, schedule: body.schedule, prompt: body.prompt, deliver: body.deliver };
        if (body.repeat) patch.repeat = body.repeat;
        await api('PATCH', `/jobs/${editing.id}`, patch);
        toast('已更新', false);
      } else {
        await api('POST', '/jobs', body);
        toast('任务已创建', false);
      }
      dialog.close();
      await load();
    } catch (e) {
      formErr.textContent = e.message;
    } finally {
      submit.disabled = false;
    }
  });


  /* ── 主题：跟随时间自动 / 强制亮 / 强制暗，选择记在本地 ── */
  const THEME_KEY = 'cc-theme';
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function autoPeriod() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    if (h < 5 || h >= 20) return 'night';
    if (h >= 17.5) return 'dusk';
    return 'day';
  }
  function applyTheme(mode) {
    const period = mode === 'light' ? 'day' : mode === 'dark' ? 'night' : autoPeriod();
    document.body.dataset.interiorTime = period;
    document.documentElement.dataset.ccTheme = mode;
    document.documentElement.style.colorScheme = period === 'night' ? 'dark' : 'light';
    document.querySelectorAll('[data-theme-set]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.themeSet === mode));
    });
    const label = { auto: '自动', light: '亮色', dark: '暗色' }[mode];
    const state = { day: '白天', dusk: '黄昏', night: '夜间' }[period];
    const hint = $('#cc-theme-state');
    if (hint) hint.textContent = mode === 'auto' ? `按时间：${state}` : `已固定：${label}`;
  }
  function initTheme() {
    let mode = 'auto';
    try { mode = localStorage.getItem(THEME_KEY) || 'auto'; } catch (_) { /* 隐私模式 */ }
    if (!['auto', 'light', 'dark'].includes(mode)) mode = 'auto';
    applyTheme(mode);
    document.querySelectorAll('[data-theme-set]').forEach((b) => {
      b.addEventListener('click', () => {
        mode = b.dataset.themeSet;
        try { localStorage.setItem(THEME_KEY, mode); } catch (_) { /* ignore */ }
        applyTheme(mode);
      });
    });
    // 自动模式下随时间推移刷新（跨过黄昏/夜间边界时不用刷新页面）
    setInterval(() => {
      let m = 'auto';
      try { m = localStorage.getItem(THEME_KEY) || 'auto'; } catch (_) { /* ignore */ }
      if (m === 'auto') applyTheme('auto');
    }, 60000);
  }
  initTheme();

  if (!allowSwitch) {
    const sw = $('.cc-person');
    if (sw) sw.hidden = true;
  }
  load();
})();
