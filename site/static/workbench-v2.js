(() => {
  'use strict';
  const ready = fn => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn, {once:true}) : fn();
  ready(() => {
    const catalogElement = document.getElementById('service-catalog');
    if (catalogElement) {
      let catalog = [];
      try { catalog = JSON.parse(catalogElement.textContent); } catch (_) { return; }
      const tiles = [...document.querySelectorAll('.service-tile')];
      const search = document.getElementById('workbench-search');
      const categories = [...document.querySelectorAll('[data-service-category]')];
      const detail = document.getElementById('service-detail');
      const count = document.getElementById('workbench-count');
      let category = 'all';
      const hashId = new URLSearchParams(location.hash.slice(1)).get('service');
      let selected = catalog.some(s => s.id === hashId) ? hashId : 'qdrant';
      function serviceState(key) {
        const record = typeof STATUS !== 'undefined' && STATUS && STATUS.apps ? STATUS.apps[key] : null;
        return record && typeof record.up === 'boolean' ? (record.up ? 'on' : 'off') : 'unknown';
      }
      function updateStatus() {
        document.querySelectorAll('[data-service-status]').forEach(el => {
          const state = serviceState(el.dataset.serviceStatus);
          const dot = el.querySelector('.dot');
          const label = el.querySelector('.status-text');
          if (dot) dot.className = 'dot' + (state === 'unknown' ? '' : ` ${state}`);
          if (label) label.textContent = state === 'on' ? '在线' : state === 'off' ? '未响应' : '待检查';
          el.title = state === 'on' ? '最近一次采集：服务在线' : state === 'off' ? '最近一次采集未获得响应' : '尚无可用状态数据';
        });
      }
      function selectService(id, updateUrl) {
        const service = catalog.find(item => item.id === id);
        if (!service) return;
        selected = id;
        detail.hidden = false;
        tiles.forEach(tile => {
          const active = tile.dataset.service === id;
          tile.classList.toggle('is-selected', active);
          tile.querySelector('.service-select').setAttribute('aria-pressed', String(active));
        });
        const image = document.getElementById('service-detail-icon'); image.src = `/static/pixel/${service.icon}.svg`;
        document.getElementById('service-detail-name').textContent = service.name;
        document.getElementById('service-detail-kind').textContent = service.kind;
        document.getElementById('service-detail-copy').textContent = service.description;
        document.getElementById('service-open').href = service.href;
        const openLabel = service.openLabel || '打开服务';
        const openLabelElement = document.getElementById('service-open-label');
        if (openLabelElement) openLabelElement.textContent = openLabel;
        document.getElementById('service-open').setAttribute('aria-label', service.openLabel ? `${service.name}：${openLabel}` : `打开 ${service.name}`);
        document.getElementById('service-detail-endpoint').textContent = service.href;
        const status = document.getElementById('service-detail-status'); status.dataset.serviceStatus = service.id;
        const panelLink = document.getElementById('service-panel'); panelLink.href = service.panel || '/yeti/debug/panel.html';
        if (updateUrl) history.replaceState(null, '', `${location.pathname}${location.search}#service=${encodeURIComponent(id)}`);
        updateStatus();
      }
      function filter() {
        const query = search.value.trim().toLocaleLowerCase();
        const visible = catalog.filter(service => (category === 'all' || service.category === category) && `${service.name} ${service.kind} ${service.description} ${service.href}`.toLocaleLowerCase().includes(query));
        const ids = new Set(visible.map(service => service.id));
        tiles.forEach(tile => { tile.hidden = !ids.has(tile.dataset.service); });
        document.getElementById('workbench-empty').hidden = visible.length > 0;
        count.textContent = `${visible.length} 项服务` + (query ? ` · 搜索“${search.value.trim()}”` : '');
        if (visible.length) selectService(ids.has(selected) ? selected : visible[0].id, false);
        else detail.hidden = true;
      }
      categories.forEach(button => button.addEventListener('click', () => {
        category = button.dataset.serviceCategory;
        categories.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        filter();
      }));
      tiles.forEach(tile => tile.querySelector('.service-select').addEventListener('click', () => selectService(tile.dataset.service, true)));
      search.addEventListener('input', filter);
      document.getElementById('workbench-clear').addEventListener('click', () => { search.value = ''; filter(); search.focus(); });
      document.addEventListener('status-ready', updateStatus);
      window.addEventListener('hashchange', () => {
        const id = new URLSearchParams(location.hash.slice(1)).get('service');
        if (catalog.some(service => service.id === id)) selectService(id, false);
      });
      filter();
    }

    // Profile selection changes the destination of existing working links only.
    const memberButtons = [...document.querySelectorAll('[data-member]')];
    memberButtons.forEach(button => button.addEventListener('click', () => {
      const member = button.dataset.member;
      if (!['yeti','yuki'].includes(member)) return;
      const name = member === 'yeti' ? '阿暖' : '阿安';
      memberButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      document.getElementById('member-preview').href = `/${member}/`;
      document.getElementById('member-edit').href = `/${member}/#tags`;
      document.getElementById('member-preview-label').textContent = `预览 ${name} 的首页`;
      document.getElementById('member-edit-label').textContent = `编辑 ${name} 的标签`;
    }));

    // A view change merely shows the existing controls; it does not invoke their APIs.
    const views = [...document.querySelectorAll('[data-panel-content]')];
    if (views.length) {
      const links = [...document.querySelectorAll('[data-panel-link]')];
      function showPanel() {
        let id = location.hash.slice(1);
        try { id = decodeURIComponent(id); } catch (_) { /* Ignore malformed URL escapes. */ }
        const target = id ? document.getElementById(id) : null;
        const view = target?.closest('[data-panel-content]') || views.find(item => item.dataset.panelContent === 'memory');
        views.forEach(item => { item.hidden = item !== view; });
        links.forEach(link => {
          const active = link.dataset.panelLink === view.dataset.panelContent;
          if (active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
        });
      }
      links.forEach(link => link.addEventListener('click', () => {
        const matching = views.find(view => view.dataset.panelContent === link.dataset.panelLink);
        if (matching) { views.forEach(view => { view.hidden = view !== matching; }); }
      }));
      window.addEventListener('hashchange', showPanel);
      showPanel();
    }
    document.querySelectorAll('[data-guide-check]').forEach(checkbox => {
      const key = `yeti-blog-check-${checkbox.dataset.guideCheck}`;
      try { checkbox.checked = localStorage.getItem(key) === 'yes'; } catch (_) { /* Optional preference. */ }
      checkbox.addEventListener('change', () => { try { localStorage.setItem(key,checkbox.checked ? 'yes' : 'no'); } catch (_) { /* Optional preference. */ } });
    });
  });
})();
