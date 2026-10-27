/* Public moments, private drafts and shared family dates. User text is never executable markup. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.HomeJournalV14 = api;
    const start = () => api.mount(root.document, root);
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const DAY = 86400000;
  const HOME_PAGE_SIZE = 5;
  const PEOPLE = { yeti: '阿暖', yuki: '阿安' };

  function shanghaiDate(now) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now || new Date());
    const get = key => parts.find(part => part.type === key).value;
    return get('year') + '-' + get('month') + '-' + get('day');
  }

  function shanghaiMoment(now) {
    const instant = now || new Date();
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
    return { date: shanghaiDate(instant), time: parts.find(part => part.type === 'hour').value + ':' + parts.find(part => part.type === 'minute').value };
  }

  function validTime(value) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')); }

  function timestampMoment(value) {
    if (typeof value !== 'string') return null;
    const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::([0-5]\d)(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!parts || !calendarParts(parts[1], false) || !validTime(parts[2])) return null;
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) return null;
    return Object.assign(shanghaiMoment(new Date(milliseconds)), { milliseconds });
  }

  function noteTiming(item) {
    const date = calendarParts(item?.date, false) ? item.date : '';
    const explicit = Object.prototype.hasOwnProperty.call(item || {}, 'occurredAt');
    const stamp = timestampMoment(explicit ? item.occurredAt : item?.createdAt);
    if (date && stamp && stamp.date === date) return { time: stamp.time, milliseconds: stamp.milliseconds, source: explicit ? 'occurred' : 'created' };
    return { time: '', milliseconds: null, source: 'unknown' };
  }

  function calendarParts(value, allowMonthDay) {
    const match = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match || (!allowMonthDay && !match[1])) return null;
    const year = match[1] ? Number(match[1]) : null, month = Number(match[2]), day = Number(match[3]);
    const check = new Date(Date.UTC(year || 2000, month - 1, day));
    if ((year !== null && year < 1000) || check.getUTCFullYear() !== (year || 2000) || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return { year, month, day };
  }

  function anniversaryInfo(value, now) {
    const event = calendarParts(value, true), today = calendarParts(shanghaiDate(now), false);
    if (!event) return null;
    const midnight = Date.UTC(today.year, today.month - 1, today.day);
    let year = Math.max(today.year, event.year || today.year);
    const occurrence = y => {
      const last = new Date(Date.UTC(y, event.month, 0)).getUTCDate();
      return Date.UTC(y, event.month - 1, Math.min(event.day, last));
    };
    let next = occurrence(year);
    if (next < midnight) next = occurrence(++year);
    return { days: Math.round((next - midnight) / DAY), year, month: event.month, day: event.day, originalYear: event.year };
  }

  function prettyDate(value) {
    const parts = calendarParts(value, false);
    return parts ? parts.year + '年' + parts.month + '月' + parts.day + '日' : '日期待补充';
  }

  function noteOrder(items) {
    const key = item => calendarParts(item.date, false) ? item.date : '';
    return items.slice().sort((a, b) => key(b).localeCompare(key(a)) || (noteTiming(b).milliseconds ?? -Infinity) - (noteTiming(a).milliseconds ?? -Infinity) || String(a.id).localeCompare(String(b.id)));
  }

  function timelineGroups(items) {
    const groups = [];
    for (const item of noteOrder(items)) {
      const parts = calendarParts(item.date, false), key = parts ? item.date.slice(0, 7) : 'unknown';
      let group = groups[groups.length - 1];
      if (!group || group.key !== key) { group = { key, year: parts?.year || null, month: parts?.month || null, items: [] }; groups.push(group); }
      group.items.push(item);
    }
    return groups;
  }

  function notePayload(user, item, values) {
    const visibility = values.visibility || item?.visibility || 'private';
    if (!['public', 'private'].includes(visibility)) throw new ApiError(400, 'invalid_visibility');
    const payload = { user, action: item ? 'update' : 'create', text: values.text, visibility };
    const previousDate = item?.date || '', previousTime = item ? noteTiming(item).time : '';
    const changedDate = values.date !== previousDate, changedTime = values.time !== previousTime;
    if (!item || changedDate) {
      if (!calendarParts(values.date, false)) throw new ApiError(400, 'invalid_date');
      payload.date = values.date;
    }
    if (item) Object.assign(payload, { id: item.id, revision: item.revision });
    if (!item || changedDate || changedTime) {
      if (values.time && (!validTime(values.time) || !calendarParts(values.date, false))) throw new ApiError(400, 'invalid_time');
      payload.occurredAt = values.time ? values.date + 'T' + values.time + ':00+08:00' : null;
    }
    return payload;
  }

  class ApiError extends Error {
    constructor(status, code) { super(code || 'request_failed'); this.status = status; this.code = code || ''; }
  }

  function errorMessage(error) {
    if (error && error.status === 409) return '这条内容已在另一处更新。你输入的文字仍在，请先复制保留，再关闭并刷新列表后重试。';
    if (error && error.status === 401) return '登录已过期，请重新登录。当前未保存的文字仍保留在这里。';
    if (error && error.status === 403) return '当前登录身份不能查看或修改这份记录，请切换到对应身份。';
    if (error && error.status === 404) return '这条记录已不存在，请刷新列表后查看。';
    if (error && error.status === 400) return '请检查名称、日期和文字长度，再试一次。';
    return '暂时没有保存成功，请稍后重试。当前输入的内容仍保留。';
  }

  function createClient(fetcher, timeoutMs) {
    async function request(path, data) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs || 12000) : null;
      try {
        const options = { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
        if (controller) options.signal = controller.signal;
        if (data !== undefined) { options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(data); }
        const response = await fetcher(path, options);
        let body = {};
        try { body = await response.json(); } catch (_) { if (response.ok) throw new ApiError(0, 'invalid_json'); }
        if (!response.ok) throw new ApiError(response.status, body.error);
        return body;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(0, 'network_failed');
      } finally { if (timer) clearTimeout(timer); }
    }
    return {
      identity: () => request('/whoami'),
      notes: user => request('/api/notes?user=' + encodeURIComponent(user)),
      publicNotes: () => request('/api/notes?scope=public'),
      note: data => request('/api/notes', data),
      anniversaries: user => request('/api/anniv?user=' + encodeURIComponent(user)),
      anniversary: data => request('/api/anniv', data),
      drafts: () => request('/api/blog-drafts'),
      draft: data => request('/api/blog-drafts', data)
    };
  }

  function draftFromHash(hash) {
    try {
      const value = new URLSearchParams(String(hash || '').replace(/^#/, '')).get('draft');
      return value && value.length <= 160 && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
    } catch (_) { return null; }
  }

  function mount(doc, win, suppliedClient) {
    if (!doc || !doc.body || doc.body.dataset.journalMounted === '1') return null;
    const notesRoot = doc.querySelector('[data-journal-notes]');
    const timelineRoot = doc.querySelector('[data-journal-timeline]');
    const annivRoot = doc.querySelector('[data-journal-anniv]');
    const draftsRoot = doc.querySelector('[data-journal-drafts]');
    if (!notesRoot && !timelineRoot && !annivRoot && !draftsRoot) return null;
    doc.body.dataset.journalMounted = '1';
    const client = suppliedClient || createClient(win.fetch.bind(win));
    const person = PEOPLE[doc.body.dataset.person] ? doc.body.dataset.person : null;
    const state = { identity: null, ready: false, notes: [], publicNotes: [], anniversaries: [], drafts: [], notesError: null, publicNotesError: null, annivError: null, draftsError: null, timelineMode: 'public', visibleNotes: 20, notesPage: 1, expandedNotes: new Set(), dialog: null, hasUnsavedChanges: null, quickHasUnsavedChanges: null };
    const notesOwner = () => timelineRoot ? state.identity?.user : person;
    let dialogCounter = 0;
    const generations = { notes: 0, publicNotes: 0, anniversaries: 0, drafts: 0 };
    const el = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = String(text);
      return node;
    };
    function button(text, handler, className) {
      const node = el('button', className || '', text); node.type = 'button';
      node.addEventListener('click', handler); return node;
    }
    function heading(title, action) {
      const row = el('div', 'journal-heading');
      if (title) row.append(el('h2', '', title));
      if (action) row.append(action);
      return row;
    }
    function status(root, text, kind) {
      let node = root.querySelector('.journal-status');
      if (!node) { node = el('p', 'journal-status'); node.setAttribute('role', 'status'); root.append(node); }
      node.textContent = text || ''; node.dataset.kind = kind || '';
      return node;
    }
    function authMessage(root, target, wrongPerson) {
      const row = el('div', 'journal-auth');
      row.append(el('p', '', wrongPerson ? '这里是 ' + PEOPLE[target] + ' 的私人记录，请切换身份后查看。' : '登录后可以查看自己的记录。'));
      const link = el('a', 'journal-signin', wrongPerson ? '切换身份' : '登录');
      link.href = '/login?as=' + encodeURIComponent(target || 'yeti') + '&next=' + encodeURIComponent(win.location.pathname + win.location.search + win.location.hash);
      row.append(link); root.append(row);
    }
    function retry(root, error, callback) {
      if (!error) return;
      status(root, errorMessage(error), 'error');
      root.append(button('重新读取', callback));
    }

    function editDialog(config) {
      if (state.dialog) return;
      const dialog = el('dialog', 'journal-dialog' + (config.draft ? ' journal-draft-dialog' : ''));
      const form = el('form');
      const title = el('h2', '', config.title); title.id = 'journal-dialog-title-' + (++dialogCounter);
      dialog.setAttribute('aria-labelledby', title.id);
      form.append(title);
      if (config.description) form.append(el('p', '', config.description));
      const fields = {};
      for (const spec of config.fields || []) {
        const label = el('label', 'journal-field'); label.append(el('span', '', spec.label));
        const field = el(spec.options ? 'select' : spec.multiline ? 'textarea' : 'input', spec.className || '');
        if (spec.options) for (const option of spec.options) { const node = el('option', '', option.label); node.value = option.value; field.append(node); }
        field.name = spec.name; field.value = spec.value || '';
        if (!spec.multiline && !spec.options) field.type = spec.type || 'text';
        if (spec.multiline) field.rows = spec.rows || 5;
        field.required = spec.required !== false;
        if (spec.maxLength) field.maxLength = spec.maxLength;
        if (spec.type === 'date') { field.min = '1000-01-01'; field.max = '9999-12-31'; }
        if (spec.placeholder) field.placeholder = spec.placeholder;
        label.append(field); if (spec.hint) label.append(el('small', '', spec.hint));
        fields[spec.name] = field; form.append(label);
      }
      const message = el('p', 'journal-form-error'); message.setAttribute('role', 'status'); form.append(message);
      const unsaved = el('div', 'journal-unsaved'); unsaved.hidden = true;
      unsaved.append(el('p', '', '还有未保存的修改，要放弃这些修改吗？'));
      const unsavedActions = el('div', 'journal-actions');
      unsavedActions.append(button('继续编辑', () => { unsaved.hidden = true; Object.values(fields)[0]?.focus(); }), button('放弃修改', finish));
      unsaved.append(unsavedActions); form.append(unsaved);
      const actions = el('div', 'journal-dialog-actions');
      const cancel = button('关闭', requestClose);
      const save = el('button', 'journal-primary', config.saveLabel || '保存'); save.type = 'submit';
      if (fields.visibility) {
        const updateSaveLabel = () => { save.textContent = fields.visibility.value === 'public' ? (config.editingNote ? '保存并公开' : '发布随手记') : (config.editingNote ? '保存修改' : '保存为私有'); };
        fields.visibility.addEventListener('change', updateSaveLabel); updateSaveLabel();
      }
      actions.append(cancel, save); form.append(actions); dialog.append(form); doc.body.append(dialog);
      let busy = false, savedSnapshot = snapshot();
      function snapshot() { return JSON.stringify(Object.fromEntries(Object.entries(fields).map(([key, node]) => [key, node.value]))); }
      function finish() {
        if (busy) return;
        if (dialog.open) dialog.close(); dialog.remove(); state.dialog = null; state.hasUnsavedChanges = null;
        if (config.onClose) config.onClose();
      }
      function requestClose() {
        if (busy) return;
        if (snapshot() !== savedSnapshot) { unsaved.hidden = false; unsaved.querySelector('button').focus(); }
        else finish();
      }
      dialog.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (busy || !form.reportValidity()) return;
        const values = Object.fromEntries(Object.entries(fields).map(([key, node]) => [key, node.value]));
        if (values.date && !calendarParts(values.date, false)) { message.textContent = '请选择有效的完整日期。'; return; }
        busy = true; save.disabled = true; cancel.disabled = true;
        for (const field of Object.values(fields)) { field.readOnly = true; if (field.name === 'visibility') field.disabled = true; }
        message.textContent = '正在保存…'; unsaved.hidden = true;
        try {
          await config.onSave(values);
          savedSnapshot = snapshot(); message.textContent = config.draft ? '已保存，仅自己可见。' : '已保存。';
          if (config.closeOnSave !== false) { busy = false; finish(); }
        } catch (error) { message.textContent = errorMessage(error); }
        finally {
          busy = false; save.disabled = false; cancel.disabled = false;
          for (const field of Object.values(fields)) { field.readOnly = false; if (field.name === 'visibility') field.disabled = false; }
        }
      });
      state.dialog = dialog;
      state.hasUnsavedChanges = () => snapshot() !== savedSnapshot;
      dialog.showModal();
      const first = Object.values(fields)[0]; if (first) first.focus();
    }

    function confirmDelete(title, description, action) {
      if (state.dialog) return;
      const dialog = el('dialog', 'journal-dialog');
      const titleNode = el('h2', '', title); titleNode.id = 'journal-confirm-' + (++dialogCounter);
      dialog.setAttribute('aria-labelledby', titleNode.id);
      dialog.append(titleNode, el('p', 'journal-confirm-copy', description));
      const message = el('p', 'journal-form-error'); message.setAttribute('role', 'status'); dialog.append(message);
      const row = el('div', 'journal-dialog-actions'); let busy = false;
      const close = () => { if (!busy) { dialog.close(); dialog.remove(); state.dialog = null; state.hasUnsavedChanges = null; } };
      const cancel = button('保留', close);
      const remove = button('删除', async () => {
        if (busy) return; busy = true; cancel.disabled = remove.disabled = true;
        message.textContent = '正在处理…';
        try { await action(); busy = false; close(); }
        catch (error) { message.textContent = errorMessage(error); }
        finally { busy = false; cancel.disabled = remove.disabled = false; }
      }, 'journal-danger');
      row.append(cancel, remove); dialog.append(row); doc.body.append(dialog); state.dialog = dialog; state.hasUnsavedChanges = null;
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      dialog.showModal(); cancel.focus();
    }

    function editNote(item) {
      const moment = shanghaiMoment();
      editDialog({ title: item ? '编辑随手记' : '记下这一刻', editingNote: Boolean(item), description: '公开内容会显示在博客，所有访客都能看到。也可以选择仅自己可见。博客草稿仍保持私有。', fields: [
        { name: 'date', label: '发生日期', type: 'date', required: !item || Boolean(item.date), value: item ? item.date || '' : moment.date, hint: item && !item.date ? '原记录没有日期，可以补充；只改文字会保留原来的未知日期。' : '' },
        { name: 'time', label: '时间（选填）', type: 'time', required: false, value: item ? noteTiming(item).time : moment.time, hint: '北京时间。不记得时间可以留空；不会补成 00:00。' },
        { name: 'visibility', label: '可见范围', value: item?.visibility === 'public' ? 'public' : item ? 'private' : 'public', options: [{ value: 'public', label: '公开到博客 · 所有访客可见' }, { value: 'private', label: '仅自己可见' }] },
        { name: 'text', label: '想记下什么', multiline: true, rows: 7, maxLength: 5000, value: item ? item.text : '', placeholder: '今天发生的事，或一个值得留住的念头…', hint: '最多 5000 字。标点和换行都会保留。' }
      ], onSave: async values => {
        await client.note(notePayload(notesOwner(), item, values));
        if (!item) state.notesPage = 1;
        await refreshNotes();
      } });
    }

    function editAnniversary(item) {
      const hasYear = item && calendarParts(item.date, false);
      editDialog({ title: item ? '编辑家庭纪念日' : '添加家庭纪念日', description: '阿安和阿暖共享。保存后，两个首页都会显示。', fields: [
        { name: 'name', label: '姓名或纪念日名称', maxLength: 80, value: item ? item.name : '', placeholder: '例如：生日、认识的第一天' },
        { name: 'date', label: '日期', type: 'date', value: item ? (hasYear ? item.date : '') : shanghaiDate(), hint: item && !hasYear ? '这条旧记录只有月日，请补全年份。' : '每年提醒；2 月 29 日在平年按 2 月 28 日提醒。' }
      ], onSave: async values => {
        const payload = { user: person, action: item ? 'update' : 'create', name: values.name, date: values.date };
        if (item) Object.assign(payload, { id: item.id, revision: item.revision });
        if (item?.familyId) payload.familyId = item.familyId;
        await client.anniversary(payload); await loadAnniversaries();
      } });
    }

    function openDraft(item) {
      let current = item;
      editDialog({ title: '继续写这篇草稿', draft: true, closeOnSave: false, description: '仅自己可见。保存不会公开，也不会改动原来的随手记。', fields: [
        { name: 'title', label: '标题', maxLength: 120, value: item.title || '', placeholder: '给这段记录起个名字' },
        { name: 'content', label: '正文', multiline: true, rows: 14, maxLength: 30000, className: 'journal-draft-body', value: item.content || '', hint: '最多 30000 字。现在以文字草稿保存。' }
      ], onSave: async values => {
        const reply = await client.draft({ action: 'update', id: current.id, revision: current.revision, title: values.title, content: values.content });
        if (!reply.item) throw new ApiError(0, 'missing_saved_item');
        current = reply.item; await loadDrafts(false);
      }, onClose: () => {
        if (draftFromHash(win.location.hash) === item.id) win.history.replaceState(null, '', win.location.pathname + win.location.search);
      } });
    }

    function noteMeta(item) {
      const meta = el('p', 'journal-meta'), date = calendarParts(item.date, false), timing = noteTiming(item);
      const time = el('time', '', date ? prettyDate(item.date) : '日期未记录');
      if (date) time.dateTime = timing.time ? item.date + 'T' + timing.time + ':00+08:00' : item.date;
      meta.append(time, el('span', 'journal-note-clock', timing.time || '时间未记录'));
      if (timing.source === 'created') meta.append(el('span', 'journal-time-source', '按当时记录时间'));
      if (item.legacy) meta.append(el('span', 'journal-badge', '原有记录'));
      if (PEOPLE[item.owner]) meta.append(el('span', 'journal-badge', PEOPLE[item.owner]));
      if (item.visibility === 'private') meta.append(el('span', 'journal-badge journal-private-badge', '仅自己可见'));
      else if (item.visibility === 'public') meta.append(el('span', 'journal-badge', '已公开'));
      return meta;
    }

    function noteBody(item, compact) {
      const wrap = el('div', 'journal-note-copy' + (compact ? ' journal-note-compact' : ''));
      const text = String(item.text || ''), long = text.length > (compact ? 180 : 650) || text.split('\n').length > (compact ? 4 : 10);
      const body = el('p', 'journal-note-text', text); wrap.append(body);
      if (long) {
        const key = (compact ? 'home:' : 'timeline:') + (item.owner || notesOwner() || '') + ':' + item.id;
        wrap.dataset.expanded = state.expandedNotes.has(key) ? 'true' : 'false';
        const toggle = button(wrap.dataset.expanded === 'true' ? '收起' : '展开全文', () => {
          const expanded = wrap.dataset.expanded !== 'true'; wrap.dataset.expanded = String(expanded);
          if (expanded) state.expandedNotes.add(key); else state.expandedNotes.delete(key);
          toggle.textContent = expanded ? '收起' : '展开全文'; toggle.setAttribute('aria-expanded', String(expanded));
        }, 'journal-expand');
        toggle.setAttribute('aria-expanded', wrap.dataset.expanded); wrap.append(toggle);
      }
      return wrap;
    }

    function noteActions(item, root) {
      const actions = el('div', 'journal-actions'); actions.append(button('编辑', () => editNote(item)));
      const draftButton = button(item.draftId ? '继续写草稿' : '转为博客草稿', async () => {
        draftButton.disabled = true;
        try {
          const reply = await client.note({ user: notesOwner(), action: 'to-draft', id: item.id, revision: item.revision });
          if (!reply.draft || !reply.draft.id) throw new ApiError(0, 'missing_draft');
          win.location.assign('/blog/#draft=' + encodeURIComponent(reply.draft.id));
        } catch (error) { status(root, errorMessage(error), 'error'); draftButton.disabled = false; }
      });
      actions.append(draftButton, button('删除', () => confirmDelete('删除这条随手记？', '首页和时间线会同步移除这条记录。已经转出的博客草稿会保留。', async () => {
        await client.note({ user: notesOwner(), action: 'delete', id: item.id, revision: item.revision }); await refreshNotes();
      })));
      return actions;
    }

    function quickComposer() {
      const form = el('form', 'journal-quick-compose'), moment = shanghaiMoment();
      const label = el('label', 'journal-quick-text'); label.append(el('span', '', '这一刻，想记下什么？'));
      const text = el('textarea'); text.name = 'text'; text.rows = 2; text.required = true; text.maxLength = 5000; text.placeholder = '一件小事、一个念头，或今天的好心情…'; label.append(text); form.append(label);
      const row = el('div', 'journal-quick-row'), inputs = { text };
      for (const spec of [{ name: 'date', label: '日期', value: moment.date }, { name: 'time', label: '时间（选填）', value: moment.time }]) {
        const fieldLabel = el('label', 'journal-quick-field'); fieldLabel.append(el('span', '', spec.label));
        const field = el('input'); field.type = spec.name; field.name = spec.name; field.value = spec.value; field.required = spec.name === 'date';
        if (spec.name === 'date') { field.min = '1000-01-01'; field.max = '9999-12-31'; }
        fieldLabel.append(field); row.append(fieldLabel); inputs[spec.name] = field;
      }
      const visibilityLabel = el('label', 'journal-quick-field journal-visibility-field'); visibilityLabel.append(el('span', '', '可见范围'));
      const visibility = el('select'); visibility.name = 'visibility';
      for (const choice of [{ value: 'public', label: '公开到博客' }, { value: 'private', label: '仅自己可见' }]) { const option = el('option', '', choice.label); option.value = choice.value; visibility.append(option); }
      visibility.value = 'public'; visibilityLabel.append(visibility); row.append(visibilityLabel); inputs.visibility = visibility;
      const save = el('button', 'journal-primary', '发布随手记'); save.type = 'submit'; row.append(save); form.append(row);
      const disclosure = el('p', 'journal-visibility-hint', '公开后，所有访客都能在博客看到。'); form.append(disclosure);
      visibility.addEventListener('change', () => { const shared = visibility.value === 'public'; save.textContent = shared ? '发布随手记' : '保存为私有'; disclosure.textContent = shared ? '公开后，所有访客都能在博客看到。' : '仅自己可见，不会出现在公开时间线。'; });
      const message = el('p', 'journal-form-error'); message.setAttribute('role', 'status'); form.append(message);
      let busy = false; state.quickHasUnsavedChanges = () => Boolean(text.value.trim());
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (busy || !form.reportValidity()) return;
        busy = true; save.disabled = true; visibility.disabled = true; Object.values(inputs).forEach(input => { input.readOnly = true; }); message.textContent = '正在记下…';
        try {
          const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]));
          await client.note(notePayload(notesOwner(), null, values));
          state.notesPage = 1;
          text.value = ''; const next = shanghaiMoment(); inputs.date.value = next.date; inputs.time.value = next.time;
          message.textContent = values.visibility === 'public' ? '已发布到博客时间线。' : '已保存，仅自己可见。'; await refreshNotes();
        } catch (error) { message.textContent = errorMessage(error); }
        finally { busy = false; save.disabled = false; visibility.disabled = false; Object.values(inputs).forEach(input => { input.readOnly = false; }); }
      });
      return form;
    }

    function renderNotes() {
      if (!notesRoot) return;
      if (!state.ready || !state.identity?.user || state.identity.user !== person) {
        notesRoot.replaceChildren(heading('我的随手记')); notesRoot.querySelector('h2').id = 'journal-notes-title';
        if (!state.ready) status(notesRoot, '正在打开随手记…'); else authMessage(notesRoot, person, Boolean(state.identity?.user));
        return;
      }
      // Keep this form node mounted while focus/visibility refresh updates the list.
      if (!notesRoot.querySelector('.journal-quick-compose')) {
        const link = el('a', 'journal-timeline-link', '查看全部随手记 →'); link.href = '/blog/#moments';
        notesRoot.replaceChildren(heading('我的随手记', link)); notesRoot.querySelector('h2').id = 'journal-notes-title';
        notesRoot.append(el('p', 'journal-hint', '给日子留一点记忆。发布后会出现在博客时间线。每页最多 5 条。'), quickComposer(), el('div', 'journal-recent-notes'));
      }
      const recent = notesRoot.querySelector('.journal-recent-notes'); recent.replaceChildren();
      retry(recent, state.notesError, loadNotes);
      if (!state.notes.length && !state.notesError) recent.append(el('p', 'journal-empty', '还没有随手记。今天有什么想留下的吗？'));
      const items = noteOrder(state.notes), pages = Math.max(1, Math.ceil(items.length / HOME_PAGE_SIZE));
      state.notesPage = Math.min(Math.max(1, state.notesPage), pages);
      const list = el('ol', 'journal-list'); list.id = 'home-notes-list';
      const start = (state.notesPage - 1) * HOME_PAGE_SIZE;
      for (const item of items.slice(start, start + HOME_PAGE_SIZE)) {
        const row = el('li', 'journal-note'); row.append(noteMeta({ ...item, visibility: item.visibility || 'private' }), noteBody(item, true), noteActions(item, recent)); list.append(row);
      }
      recent.append(list);
      if (pages > 1) {
        const pager = el('nav', 'journal-pagination'); pager.setAttribute('aria-label', '随手记分页');
        const changePage = next => {
          state.notesPage = Math.min(Math.max(1, next), pages); renderNotes();
          recent.querySelector('.journal-page-info')?.focus({ preventScroll: true });
          recent.scrollIntoView({ block: 'start' });
        };
        const previous = button('上一页', () => changePage(state.notesPage - 1)); previous.disabled = state.notesPage === 1;
        const next = button('下一页', () => changePage(state.notesPage + 1)); next.disabled = state.notesPage === pages;
        previous.setAttribute('aria-controls', list.id); next.setAttribute('aria-controls', list.id);
        const info = el('span', 'journal-page-info', '第 ' + state.notesPage + ' / ' + pages + ' 页 · 共 ' + items.length + ' 条');
        info.setAttribute('role', 'status'); info.tabIndex = -1;
        pager.append(previous, info, next); recent.append(pager);
      }
    }

    function renderTimeline() {
      if (!timelineRoot) return;
      timelineRoot.replaceChildren(heading('随手记时间线')); timelineRoot.querySelector('h2').id = 'journal-timeline-title';
      timelineRoot.append(el('p', 'journal-hint', '把平凡的小事串起来。记录重要的事，与来访的人分享。'));
      if (!state.ready) { status(timelineRoot, '正在整理时间线…'); return; }
      const user = state.identity?.user, signedIn = Boolean(PEOPLE[user]);
      if (signedIn) {
        timelineRoot.querySelector('.journal-heading').append(button('发布随手记', () => editNote(null), 'journal-primary'));
        const tabs = el('div', 'journal-timeline-tabs'); tabs.setAttribute('aria-label', '时间线范围');
        for (const choice of [{ value: 'public', label: '公开时间线' }, { value: 'mine', label: '我的记录' }]) {
          const tab = button(choice.label, () => { state.timelineMode = choice.value; state.visibleNotes = 20; renderTimeline(); });
          tab.setAttribute('aria-pressed', String(state.timelineMode === choice.value)); tabs.append(tab);
        }
        timelineRoot.append(tabs);
      }
      const ownView = signedIn && state.timelineMode === 'mine';
      retry(timelineRoot, ownView ? state.notesError : state.publicNotesError, ownView ? loadNotes : loadPublicNotes);
      const items = ownView ? state.notes.map(item => ({ ...item, owner: user, visibility: item.visibility || 'private', editable: true })) : state.publicNotes.map(item => {
        const own = signedIn && item.owner === user ? state.notes.find(record => record.id === item.id) : null;
        if (own && own.visibility !== 'public') return null;
        return own ? { ...item, ...own, owner: user, editable: true } : { ...item, visibility: 'public', editable: false };
      }).filter(Boolean);
      if (!items.length && !(ownView ? state.notesError : state.publicNotesError)) timelineRoot.append(el('p', 'journal-empty', ownView ? '还没有随手记。记下第一件值得留下的事吧。' : '还没有公开的随手记，新的故事正在路上。'));
      if (ownView) timelineRoot.append(el('p', 'journal-hint', '这里包含你的公开和私有记录。私有内容只在这个视图中对你显示。'));
      let yearNode = null, previousYear = undefined;
      for (const group of timelineGroups(noteOrder(items).slice(0, state.visibleNotes))) {
        if (previousYear !== group.year) {
          yearNode = el('section', 'journal-timeline-year'); yearNode.append(el('h3', 'journal-year-title', group.year ? group.year + ' 年' : '日期未记录'));
          timelineRoot.append(yearNode); previousYear = group.year;
        }
        const month = el('section', 'journal-timeline-month');
        if (group.month) month.append(el('h4', 'journal-month-title', String(group.month).padStart(2, '0') + ' 月'));
        else month.append(el('p', 'journal-hint', '这些原有记录没有可靠日期，完整保留在这里。'));
        const list = el('ol', 'journal-moments-list');
        for (const item of group.items) {
          const row = el('li', 'journal-moment'); row.append(noteMeta(item), noteBody(item, false));
          if (signedIn && item.owner === user && item.editable && Number.isInteger(item.revision)) row.append(noteActions(item, timelineRoot));
          list.append(row);
        }
        month.append(list); yearNode.append(month);
      }
      if (items.length > state.visibleNotes) timelineRoot.append(button('再看看之前的日子', () => { state.visibleNotes += 20; renderTimeline(); }, 'journal-load-more'));
    }

    function renderAnniversaries() {
      if (!annivRoot) return;
      annivRoot.replaceChildren();
      if (!state.ready) { status(annivRoot, '正在打开纪念日…'); return; }
      const allowed = Boolean(PEOPLE[state.identity?.user]);
      if (!allowed) { authMessage(annivRoot, person, Boolean(state.identity?.user)); return; }
      const add = button('添加', () => editAnniversary(null)); add.disabled = state.anniversaries.length >= 80;
      annivRoot.append(heading('', add));
      annivRoot.append(el('p', 'journal-hint', '阿安和阿暖共享 · 两个首页同步'));
      retry(annivRoot, state.annivError, loadAnniversaries);
      const list = el('ul', 'journal-anniv-list');
      const items = state.anniversaries.map(item => ({ item, next: anniversaryInfo(item.date) })).sort((a, b) => (a.next?.days ?? Infinity) - (b.next?.days ?? Infinity));
      if (!items.length && !state.annivError) annivRoot.append(el('p', 'journal-empty', '生日、纪念日，都可以记在这里。'));
      for (const { item, next } of items) {
        const row = el('li', 'journal-anniv-item');
        row.append(el('span', 'journal-anniv-name', item.name), el('span', 'journal-anniv-count', next ? (next.days === 0 ? '就是今天' : next.days + ' 天后') : '日期待补充'));
        row.append(el('span', 'journal-anniv-date', next ? ((next.originalYear ? next.originalYear + '年' : '') + next.month + '月' + next.day + '日 · 每年') : '请编辑日期'));
        const actions = el('div', 'journal-actions');
        actions.append(button('编辑', () => editAnniversary(item)), button('删除', () => confirmDelete('从家庭纪念日中删除？', String(item.name) + ' · 删除后两个首页都会移除。', async () => {
          const payload = { user: person, action: 'delete', id: item.id, revision: item.revision };
          if (item.familyId) payload.familyId = item.familyId;
          await client.anniversary(payload); await loadAnniversaries();
        })));
        row.append(actions); list.append(row);
      }
      annivRoot.append(list);
      if (state.anniversaries.length >= 80) annivRoot.append(el('p', 'journal-hint', '已经记下 80 个日子，可以先整理已有记录。'));
    }

    function renderDrafts() {
      if (!draftsRoot) return;
      draftsRoot.hidden = !state.ready || !PEOPLE[state.identity?.user];
      if (draftsRoot.hidden) { draftsRoot.replaceChildren(); return; }
      draftsRoot.replaceChildren(heading('我的草稿'));
      draftsRoot.querySelector('h2').id = 'journal-drafts-title';
      draftsRoot.append(el('p', 'journal-hint', '从随手记接着写。这里的草稿仅自己可见，保存不会公开。'));
      if (!state.ready) { status(draftsRoot, '正在打开写作小屋…'); return; }
      if (!state.identity?.user) { authMessage(draftsRoot, 'yeti', false); return; }
      const top = draftsRoot.querySelector('.journal-heading'); top.append(el('span', 'journal-private', PEOPLE[state.identity.user] + ' 的私人草稿'));
      retry(draftsRoot, state.draftsError, () => loadDrafts(true));
      if (!state.drafts.length && !state.draftsError) {
        draftsRoot.append(el('p', 'journal-empty', '想写得长一点时，可以把下面的随手记转成草稿。'));
        const link = el('a', 'journal-signin', '去看随手记'); link.href = timelineRoot ? '#moments' : '/' + state.identity.user + '/#tags'; draftsRoot.append(link);
      }
      const list = el('ul', 'journal-list journal-draft-list');
      for (const item of state.drafts.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))) {
        const row = el('li', 'journal-draft');
        const topRow = el('div', 'journal-draft-top'); topRow.append(el('h3', 'journal-draft-title', item.title || '未命名草稿'), el('span', 'journal-badge', '仅自己可见'));
        row.append(topRow, el('p', 'journal-meta', item.date ? prettyDate(item.date) : '来自原有记录'), el('p', 'journal-draft-preview', item.content || '还没有正文。'));
        const actions = el('div', 'journal-actions');
        actions.append(button('继续写', () => {
          win.history.replaceState(null, '', win.location.pathname + win.location.search + '#draft=' + encodeURIComponent(item.id)); openDraft(item);
        }, 'journal-primary'), button('删除草稿', () => confirmDelete('删除这篇草稿？', '原来的随手记会保留。', async () => {
          await client.draft({ action: 'delete', id: item.id, revision: item.revision }); await loadDrafts(false);
        })));
        row.append(actions); list.append(row);
      }
      draftsRoot.append(list);
    }

    async function loadNotes() {
      const owner = notesOwner();
      if ((!notesRoot && !timelineRoot) || !PEOPLE[owner] || state.identity?.user !== owner) return;
      const generation = ++generations.notes;
      try {
        const result = await client.notes(owner);
        if (generation !== generations.notes) return;
        if (result.user !== owner || !Array.isArray(result.items)) throw new ApiError(0, 'invalid_notes');
        state.notes = result.items; state.notesError = null;
      } catch (error) { if (generation === generations.notes) { state.notesError = error; if (error?.status === 401 || error?.status === 403) state.notes = []; } }
      if (generation === generations.notes) { renderNotes(); renderTimeline(); }
    }
    async function loadPublicNotes() {
      if (!timelineRoot) return;
      const generation = ++generations.publicNotes;
      try {
        const result = await client.publicNotes();
        if (generation !== generations.publicNotes) return;
        if (result.scope !== 'public' || !Array.isArray(result.items) || result.items.some(item => !PEOPLE[item.owner] || typeof item.id !== 'string' || typeof item.text !== 'string')) throw new ApiError(0, 'invalid_public_notes');
        state.publicNotes = result.items.map(item => {
          const safe = { id: item.id, owner: item.owner, text: item.text, date: item.date, createdAt: item.createdAt };
          if (Object.prototype.hasOwnProperty.call(item, 'occurredAt')) safe.occurredAt = item.occurredAt;
          return safe;
        });
        state.publicNotesError = null;
      } catch (error) { if (generation === generations.publicNotes) state.publicNotesError = error; }
      if (generation === generations.publicNotes) renderTimeline();
    }
    async function refreshNotes() { await Promise.all([loadNotes(), loadPublicNotes()]); }
    async function loadAnniversaries() {
      if (!annivRoot || !PEOPLE[state.identity?.user]) return;
      const generation = ++generations.anniversaries;
      try {
        const result = await client.anniversaries(person);
        if (generation !== generations.anniversaries) return;
        const items = result.scope === 'family' ? result.items : result[person];
        if (!Array.isArray(items)) throw new ApiError(0, 'invalid_anniversaries');
        state.anniversaries = items; state.annivError = null;
      } catch (error) { if (generation === generations.anniversaries) state.annivError = error; }
      if (generation === generations.anniversaries) renderAnniversaries();
    }
    function openHashDraft() {
      if (!draftsRoot || state.dialog || !state.identity?.user || state.draftsError) return;
      const id = draftFromHash(win.location.hash); if (!id) return;
      const draft = state.drafts.find(item => item.id === id);
      if (draft) openDraft(draft);
      else status(draftsRoot, '这篇草稿不存在，或不属于当前登录身份。', 'error');
    }
    async function loadDrafts(openRequested) {
      if (!draftsRoot || !state.identity?.user) return;
      const generation = ++generations.drafts;
      try {
        const result = await client.drafts();
        if (generation !== generations.drafts) return;
        if (result.user !== state.identity.user || !Array.isArray(result.items)) throw new ApiError(0, 'invalid_drafts');
        state.drafts = result.items; state.draftsError = null;
      } catch (error) { if (generation === generations.drafts) state.draftsError = error; }
      if (generation === generations.drafts) { renderDrafts(); if (openRequested) openHashDraft(); }
    }

    renderNotes(); renderTimeline(); renderAnniversaries(); renderDrafts();
    const ready = (async () => {
      try { state.identity = await client.identity(); } catch (_) { state.identity = { user: null }; }
      if (!PEOPLE[state.identity?.user]) state.identity = { user: null };
      state.ready = true; renderNotes(); renderTimeline(); renderAnniversaries(); renderDrafts();
      await Promise.all([loadNotes(), loadPublicNotes(), loadAnniversaries(), loadDrafts(true)]);
    })();
    win.addEventListener('hashchange', openHashDraft);
    const preventLostEdits = event => {
      if ((state.hasUnsavedChanges && state.hasUnsavedChanges()) || (state.quickHasUnsavedChanges && state.quickHasUnsavedChanges())) { event.preventDefault(); event.returnValue = ''; }
    };
    win.addEventListener('beforeunload', preventLostEdits);
    win.addEventListener('pageshow', event => { if (event.persisted) win.location.reload(); });
    const refreshFamily = () => { if (!doc.hidden && state.ready) loadAnniversaries(); };
    const refreshVisibleRecords = () => { if (!doc.hidden && state.ready) { loadAnniversaries(); refreshNotes(); } };
    doc.addEventListener('visibilitychange', refreshVisibleRecords);
    win.addEventListener('focus', refreshVisibleRecords);
    if (annivRoot) win.setInterval(refreshFamily, 60000);
    return { state, ready, reloadNotes: refreshNotes, reloadAnniversaries: loadAnniversaries, reloadDrafts: () => loadDrafts(true) };
  }

  return { shanghaiDate, shanghaiMoment, validTime, timestampMoment, noteTiming, calendarParts, anniversaryInfo, prettyDate, noteOrder, timelineGroups, notePayload, draftFromHash, ApiError, errorMessage, createClient, mount };
});
