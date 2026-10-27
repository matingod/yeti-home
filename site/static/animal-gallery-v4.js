(() => {
  'use strict';
  const ready = fn => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn, {once:true}) : fn();
  ready(async () => {
    const root = document.querySelector('[data-animal-gallery]');
    if (!root) return;
    const motionControl = document.querySelector('body > .pixel-motion-control');
    if (motionControl) { motionControl.classList.add('animal-gallery-motion'); root.before(motionControl); }
    const grid = root.querySelector('#animal-grid');
    const status = root.querySelector('#animal-status');
    const filters = [...root.querySelectorAll('[data-animal-filter]')];
    const records = new Map();
    let registry, selected;
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const valid = data => {
      if (data?.schemaVersion !== 1 || !Array.isArray(data.animals) || !data.animals.length) return false;
      const animalIds = new Set();
      for (const animal of data.animals) {
        if (!/^[a-z][a-z0-9-]*$/.test(animal.id) || animalIds.has(animal.id) || typeof animal.name !== 'string' || !Array.isArray(animal.actions) || !animal.actions.length) return false;
        animalIds.add(animal.id);
        const ids = new Set();
        for (const action of animal.actions) {
          if (!/^[a-z][a-z0-9-]*$/.test(action.id) || ids.has(action.id) || typeof action.name !== 'string' || typeof action.description !== 'string') return false;
          ids.add(action.id);
          if (!['poster','gif'].every(key => typeof action[key] === 'string' && /^\/static\/[a-zA-Z0-9_./-]+$/.test(action[key]) && !action[key].includes('..'))) return false;
          if (!action.poster.endsWith('.png') || !action.gif.endsWith('.gif')) return false;
        }
      }
      return animalIds.has(data.defaultAnimal);
    };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const mode = () => document.body.dataset.pixelMotion || 'full';
    const quiet = () => mode() === 'still' || reduced.matches || document.hidden;
    let active = null, previewTimer = 0;
    const stopPreview = () => {
      clearTimeout(previewTimer); previewTimer = 0;
      if (!active) return;
      const rec = active; active = null;
      rec.image.src = rec.action.poster;
      rec.preview.textContent = '预览动作'; rec.preview.setAttribute('aria-pressed','false');
      rec.card.dataset.previewing = 'false';
    };
    const syncMotion = () => {
      if (quiet()) stopPreview();
      const disabled = quiet();
      for (const rec of records.values()) {
        rec.preview.disabled = disabled || rec.gifMissing || rec.posterMissing;
        const scene = rec.card.querySelector('[data-scene]'); if (scene) scene.disabled = disabled;
      }
      root.querySelector('#animal-motion-note').textContent = mode() === 'still' || reduced.matches ? '静止预览 · 仍可下载 PNG / GIF' : mode() === 'gentle' ? '轻柔 · 手动预览一小段，一次一个' : '点击预览播放一小段，一次一个';
    };
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const rec = records.get(entry.target.dataset.action);
        if (!rec || rec.card !== entry.target) return;
        rec.visible = entry.isIntersecting;
        if (!entry.isIntersecting && active === rec) stopPreview();
      });
    },{threshold:0.01}) : null;
    const startPreview = rec => {
      if (active === rec) { stopPreview(); return; }
      stopPreview();
      if (quiet() || rec.gifMissing || rec.posterMissing) return;
      active = rec; rec.image.hidden = false; rec.fallback.hidden = true;
      rec.image.src = rec.action.gif;
      rec.card.dataset.previewing = 'true'; rec.preview.textContent = '暂停预览'; rec.preview.setAttribute('aria-pressed','true');
      status.textContent = `${rec.animal.name} · ${rec.action.name}；离开画面或切到静止会暂停。`;
      previewTimer = setTimeout(stopPreview,mode() === 'gentle' ? 2400 : 5000);
    };
    const viewStage = () => document.getElementById('cat-stage')?.scrollIntoView({behavior:'instant',block:'start'});
    root.querySelector('#cat-watch').addEventListener('click',viewStage);
    const playScene = rec => {
      if (quiet()) return;
      stopPreview(); viewStage();
      // A single finite callback lets the existing scene's visibility observer catch up.
      setTimeout(() => {
        if (quiet()) return;
        let result = false;
        if (rec.action.scene === 'cat') result = window.PixelVillage?.playCatAction?.(rec.action.sceneAction || rec.action.id);
        else if (rec.action.scene === 'dog-greet' && window.InteriorPetsV10?.greetDog) {
          window.InteriorPetsV10.greetDog(); result = true;
        } else if (['chicken','duck'].includes(rec.action.scene)) result = window.PixelVillage?.playBirdAction?.(rec.action.scene);
        status.textContent = result ? rec.action.scene === 'cat' ? `草地上的小猫：${rec.action.name}` : '已和小伙伴打招呼；场景按自己的节奏回应，单独动作请看卡片预览。' : '小伙伴还没准备好，请稍后再试；仍可在卡片预览和下载。';
      },120);
    };
    new MutationObserver(syncMotion).observe(document.body,{attributes:true,attributeFilter:['data-pixel-motion']});
    reduced.addEventListener('change',syncMotion);
    document.addEventListener('visibilitychange',syncMotion);
    const render = id => {
      const animal = registry.animals.find(item => item.id === id);
      if (!animal) return;
      stopPreview(); observer?.disconnect();
      records.clear();
      selected = id;
      filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.animalFilter === id)));
      root.querySelector('#animal-category-title').textContent = `${animal.name} · ${animal.actions.length} 个动作`;
      root.querySelector('#animal-category-description').textContent = animal.description || '';
      grid.replaceChildren();
      animal.actions.forEach(action => {
        const card = el('article','cat-card pixel-frame');
        card.dataset.animal = id; card.dataset.action = action.id;
        const picture = el('div','cat-picture'), image = el('img');
        image.src = action.poster; image.alt = `${animal.name}：${action.name}`;
        image.width = 128; image.height = 128; image.loading = 'lazy';
        const fallback = el('span','animal-fallback','图片暂不可用'); fallback.hidden = true;
        picture.append(image, fallback);
        const copy = el('div','cat-card-copy');
        copy.append(el('h3','',action.name),el('p','',action.description));
        const actions = el('div','cat-card-actions');
        const preview = el('button','','预览动作'); preview.type = 'button'; preview.dataset.preview = action.id; preview.setAttribute('aria-pressed','false');
        actions.append(preview);
        if (['cat','dog-greet','chicken','duck'].includes(action.scene)) {
          const scene = el('button','',action.scene === 'dog-greet' ? '和泰迪打招呼 ↑' : '在草地上看看 ↑');
          scene.type = 'button'; scene.dataset.scene = action.id;
          scene.title = action.scene === 'cat' ? '在草地演示这个小猫动作' : '沿用场景里的互动组合；单独动作请看卡片预览';
          actions.append(scene);
        }
        ['gif','poster'].forEach(key => {
          const ext = key === 'gif' ? 'gif' : 'png', link = el('a','',`${ext.toUpperCase()} ↓`);
          link.href = action[key]; link.download = `${id}-${action.id}.${ext}`; link.setAttribute('aria-label',`下载${animal.name}的${action.name} ${ext.toUpperCase()}`);
          actions.append(link);
        });
        card.append(picture,copy,actions); grid.append(card);
        const rec = {animal,action,card,image,fallback,preview,visible:false,gifMissing:false,posterMissing:false};
        records.set(action.id,rec);
        preview.addEventListener('click',() => startPreview(rec));
        card.querySelector('[data-scene]')?.addEventListener('click',() => playScene(rec));
        image.addEventListener('error',() => {
          if (image.getAttribute('src') === action.gif) {
            rec.gifMissing = true; stopPreview(); image.src = action.poster;
            status.textContent = '这段动画暂不可用，先看看封面；其他动作不受影响。';
          } else {
            rec.posterMissing = true; if (active === rec) stopPreview();
            image.hidden = true; fallback.hidden = false;
            status.textContent = '这张图片暂不可用；其他动作仍可预览和下载。';
          }
          syncMotion();
        });
        observer?.observe(card);
      });
      status.textContent = `${animal.name}的 ${animal.actions.length} 个动作；选择预览，或直接保存。`;
      root.dataset.animal = selected;
      syncMotion();
    };
    try {
      const response = await fetch(root.dataset.config, {credentials:'same-origin'});
      if (!response.ok) throw new Error('registry unavailable');
      const data = await response.json();
      if (!valid(data)) throw new Error('registry invalid');
      registry = data;
      // Build category controls from the registry, not a hard-coded species list.
      const filterRow = root.querySelector('.animal-filters'); filterRow.replaceChildren(); filters.length = 0;
      registry.animals.forEach(animal => {
        const button = el('button','',`${animal.name} `); button.type = 'button'; button.dataset.animalFilter = animal.id;
        button.setAttribute('aria-controls','animal-grid'); button.append(el('span','',String(animal.actions.length)));
        filters.push(button); filterRow.append(button);
      });
      filters.forEach((button,index) => {
        button.addEventListener('click',() => render(button.dataset.animalFilter));
        button.addEventListener('keydown',event => {
          let target;
          if (event.key === 'ArrowRight') target = (index + 1) % filters.length;
          if (event.key === 'ArrowLeft') target = (index + filters.length - 1) % filters.length;
          if (event.key === 'Home') target = 0;
          if (event.key === 'End') target = filters.length - 1;
          if (target !== undefined) { event.preventDefault(); filters[target].focus(); filters[target].click(); }
        });
      });
      render(registry.defaultAnimal);
      root.dataset.ready = 'true';
    } catch (_) {
      status.textContent = '分类暂时没加载好；下方小猫的 8 个动作仍可下载，刷新后再试。';
      filters.forEach(button => { button.disabled = true; });
      root.dataset.ready = 'fallback';
    }
  });
})();
