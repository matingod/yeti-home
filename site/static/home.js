/* Small interactions for the shared personal home layout. */
(() => {
  'use strict';
  const ready = () => {
    const who = document.body.dataset.person === 'yuki' ? '阿安' : '阿暖';
    const hour = new Date().getHours();
    const greeting = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    const title = document.getElementById('greet');
    if (title) title.textContent = `${greeting}，${who}`;
    const dialog = document.getElementById('dlg-tags');
    dialog?.querySelector('.cancel')?.addEventListener('click', () => dialog.close());

    // The complete holiday list stays available without dominating the home page.
    document.querySelectorAll('[data-holiday]').forEach(region => {
      const compact = () => {
        const list = region.querySelector(':scope > .holi-list');
        if (!list) return;
        const details = document.createElement('details');
        details.className = 'holiday-details';
        const summary = document.createElement('summary');
        summary.textContent = '查看假期安排';
        list.before(details);
        details.append(summary, list);
        const note = region.querySelector(':scope > .holi-note');
        if (note) details.append(note);
        region.querySelector(':scope > .holi-foot')?.remove();
      };
      new MutationObserver(compact).observe(region, {childList: true});
      compact();
    });

    const form = document.querySelector('.hero-search');
    if (!form) return;
    const input = form.querySelector('input');
    const results = document.getElementById('search-results');
    let catalog = null;
    let request = null;
    const close = () => { results.hidden = true; input.setAttribute('aria-expanded', 'false'); };
    const getCatalog = () => request || (request = fetch('/' + (document.body.dataset.person === 'yuki' ? 'yuki' : 'yeti') + '/search-index.json', {credentials: 'same-origin'})
      .then(r => { if (!r.ok) throw new Error('unavailable'); return r.json(); })
      .then(data => { catalog = data; return data; })
      .catch(() => {
        request = null;
        return null;
      }));
    const draw = async () => {
      const query = input.value.trim().toLocaleLowerCase();
      if (!query) { close(); return; }
      const data = catalog || await getCatalog();
      if (input.value.trim().toLocaleLowerCase() !== query) return;
      results.replaceChildren();
      const matches = data?.filter(item => `${item.name} ${item.description} ${item.href}`.toLocaleLowerCase().includes(query)).slice(0, 7) || [];
      for (const item of matches) {
        const a = document.createElement('a');
        a.className = 'search-result'; a.href = item.href;
        if (/^https?:/.test(item.href)) { a.target = '_blank'; a.rel = 'noopener'; }
        const name = document.createElement('strong'); name.textContent = item.name;
        const description = document.createElement('small'); description.textContent = item.description;
        a.append(name, description); results.append(a);
      }
      if (!matches.length) {
        const empty = document.createElement('p'); empty.className = 'search-empty';
        empty.textContent = data ? '没有找到这个应用或页面，换个关键词试试。' : '搜索暂时不可用，可以从下方应用或顶部导航进入。';
        results.append(empty);
      }
      results.hidden = false; input.setAttribute('aria-expanded', 'true');
    };
    input.addEventListener('input', draw);
    input.addEventListener('focus', () => { getCatalog(); if (input.value.trim()) draw(); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      await draw();
      results.querySelector('a')?.click();
    });
    form.addEventListener('keydown', event => {
      if (event.key === 'Escape') { close(); input.focus(); }
      if (event.key === 'ArrowDown' && event.target === input) {
        event.preventDefault(); results.querySelector('a')?.focus();
      }
    });
    document.addEventListener('pointerdown', event => { if (!form.contains(event.target)) close(); });
    document.addEventListener('focusin', event => { if (!form.contains(event.target)) close(); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once: true});
  else ready();
})();
