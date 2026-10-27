/* Local decorative animation only. No application data or write API is used. */
(() => {
  'use strict';
  if (window.__pixelVillageLoaded) return;
  window.__pixelVillageLoaded = true;
  const ready = fn => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn, { once: true }) : fn();
  ready(() => {
    const body = document.body;
    if (!body || !body.matches('.pixel-home,.pixel-entrance,.pixel-login,.pixel-inner,.pixel-blog')) return;
    const preferenceKey = 'yeti-home-pixel-motion';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)'), mobile = matchMedia('(max-width: 700px)'), coarse = matchMedia('(pointer: coarse)');
    const labels = { idle: '眨眼发呆', walk: '散步', run: '小跑', jump: '开心跳跃', stretch: '伸个懒腰', sleep: '打个盹', groom: '洗脸理毛', love: '贴贴比心' };
    const modes = { full: '完整', gentle: '轻柔', still: '静止' };
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    let saved;
    try { saved = localStorage.getItem(preferenceKey); } catch (_) { /* Optional preference. */ }
    let explicitMode = Object.hasOwn(modes, saved), mode = explicitMode ? saved : reduced.matches ? 'still' : 'full';
    let width = 1, height = 1, groundHeight = 88, dpr = 1, elapsed = 0;
    let running = false, raf = 0, lastTime = 0, visible = true, suspended = false;
    let catAtlas, chickenAtlas, catImage, chickenImage, imageLoaded = false, initialized = false;
    let pointer = null, lastManual = -10000, lastRipple = -10000, routeIndex = 0, clickCycle = 0, ripples = [], route = [];
    let sceneInfo = { width: 2172, height: 724, horizonY: 500,
      cat: { size: 112, footY: 650, maxX: 1555 },
      pondBounds: { cx: 1854, cy: 628, rx: 190, ry: 38 },
      anchors: { chimney: { x: 1522, y: 356 }, pond: { x: 1854, y: 628 }, duck: { x: 1854, y: 624 }, chicken: { x: 1668, y: 553 }, tree: { x: 1266, y: 548 }, door: { x: 1500, y: 555 } }
    };
    let geometry = { x: 0, y: 0, scale: 1, width: 1, height: 1 };
    let catSize = 58, catBounds = { min: 22, max: 1 };
    const cat = { x: .43, y: 0, direction: 1, action: 'idle', since: 0, until: 2400, target: null, reason: 'route', next: null, route: '草坪', frame: 0 };
    let host = body.querySelector('.pixel-hero,.entrance-scene,.pixel-login-scene');
    if (!host) { host = document.createElement('div'); host.className = 'pixel-backdrop'; body.prepend(host); }
    host.classList.add('village-ready'); body.dataset.pixelVillage = '6';
    const ground = document.createElement('div'); ground.className = 'village-ground'; ground.setAttribute('aria-hidden', 'true'); host.appendChild(ground);
    const illustration = document.createElement('img'); illustration.className = 'village-illustration'; illustration.alt = ''; illustration.setAttribute('aria-hidden', 'true'); illustration.draggable = false;
    illustration.addEventListener('load', () => { imageLoaded = true; illustration.classList.add('is-ready'); resize(); });
    illustration.addEventListener('error', () => { imageLoaded = false; illustration.hidden = true; draw(); });
    illustration.src = '/static/pixel/scene-v6/village.png'; host.appendChild(illustration);
    let scene = host.querySelector('.pixel-scene');
    if (!scene) { scene = document.createElement('div'); scene.className = 'pixel-scene'; host.appendChild(scene); }
    scene.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true'); scene.replaceChildren(canvas);
    const ctx = canvas.getContext('2d', { alpha: true });
    const catButton = document.createElement('button'); catButton.type = 'button'; catButton.className = 'village-cat-hit'; catButton.hidden = true;
    catButton.setAttribute('aria-label', '小猫：点击和它打招呼；左右方向键带它散步');
    catButton.title = '点击：贴贴 / 跳跃 / 伸懒腰 · 双击：跳跃 · 左右方向键：散步';
    const hint = document.createElement('span'); hint.className = 'village-cat-hint'; hint.textContent = '和小猫玩'; catButton.appendChild(hint); host.appendChild(catButton);
    const live = document.createElement('span'); live.className = 'village-sr-only'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); host.appendChild(live);
    const control = document.createElement('div'); control.className = 'pixel-motion-control'; control.setAttribute('role', 'group'); control.setAttribute('aria-label', '场景动效');
    const heading = document.createElement('span'); heading.textContent = '场景'; control.appendChild(heading);
    const buttons = Object.entries(modes).map(([value, label]) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.mode = value; button.setAttribute('aria-label', `场景动效：${label}`);
      button.title = value === 'full' ? '小猫巡游，小鸡散步，烟囱冒烟；点草地带小猫散步' : value === 'gentle' ? '保留小猫、小鸡和烟，动作放慢' : '暂停所有场景动画';
      button.addEventListener('click', () => setMode(value)); control.appendChild(button); return button;
    });
    if (!body.matches('.pixel-login,.pixel-entrance') && (['yeti', 'yuki'].includes(body.dataset.person) || /^\/(yeti|yuki)\//.test(location.pathname))) {
      const gallery = document.createElement('a'); gallery.className = 'village-gallery-link'; gallery.href = body.dataset.person === 'yuki' || location.pathname.startsWith('/yuki/') ? '/yuki/cats/' : '/yeti/cats/'; gallery.textContent = '小猫图库'; control.appendChild(gallery);
    }
    body.appendChild(control);

    function getImage(url) { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = url; }); }
    async function loadAtlas(base, json = 'atlas.json', png = 'atlas.png') {
      const [metadata, image] = await Promise.all([
        fetch(`${base}/${json}`, { credentials: 'same-origin' }).then(response => { if (!response.ok) throw new Error('Missing sprite metadata'); return response.json(); }), getImage(`${base}/${png}`)
      ]);
      if (!metadata || typeof metadata.actions !== 'object' || !Object.values(metadata.actions).every(action => Array.isArray(action.frames) && action.frames.length && action.frames.every(frame => [frame.x, frame.y, frame.w, frame.h].every(Number.isFinite)))) throw new Error('Invalid sprite metadata');
      return { metadata, image };
    }
    loadAtlas('/static/pixel/cat-v3').then(({ metadata, image }) => { catAtlas = metadata; catImage = image; catButton.hidden = false; host.dataset.catReady = 'true'; resize(); publish(); reconcile(); }).catch(() => { host.dataset.catReady = 'false'; catButton.hidden = true; publish(); });
    loadAtlas('/static/pixel/scene-v3', 'chicken-atlas.json', 'chicken-atlas.png').then(({ metadata, image }) => { chickenAtlas = metadata; chickenImage = image; host.dataset.chickenReady = 'true'; draw(); }).catch(() => { host.dataset.chickenReady = 'false'; });
    fetch('/static/pixel/scene-v6/scene.json', { credentials: 'same-origin' }).then(response => { if (!response.ok) throw new Error('Using built-in coordinates'); return response.json(); }).then(metadata => {
      if ([metadata.width, metadata.height, metadata.horizonY].every(Number.isFinite) && metadata.width > 0 && metadata.height > 0) {
        sceneInfo = { ...sceneInfo, ...metadata, anchors: { ...sceneInfo.anchors, ...metadata.anchors }, cat: { ...sceneInfo.cat, ...metadata.cat }, pondBounds: { ...sceneInfo.pondBounds, ...metadata.pondBounds } };
        resize();
      }
    }).catch(() => { /* Built-in coordinates match the shipped illustration. */ });

    function point(name, fallback) { const source = sceneInfo.anchors[name] || fallback; return { x: geometry.x + source.x * geometry.scale, y: geometry.y + source.y * geometry.scale }; }
    function safeCatX(x) { return clamp(x, catBounds.min, catBounds.max); }
    function resize() {
      const bounds = host.getBoundingClientRect(), oldWidth = width, previousStop = cat.next?.name;
      width = Math.max(1, Math.round(bounds.width)); height = Math.max(1, Math.round(bounds.height));
      const pictureWidth = mobile.matches ? Math.min(720, width * 1.7) : Math.min(1160, Math.max(900, width * .76));
      const scale = pictureWidth / sceneInfo.width;
      groundHeight = Math.max(1, (sceneInfo.height - sceneInfo.horizonY) * scale);
      host.style.setProperty('--village-ground-height', `${groundHeight}px`);
      geometry = { x: width - pictureWidth, y: height - sceneInfo.height * scale, scale, width: pictureWidth, height: sceneInfo.height * scale };
      Object.assign(illustration.style, { width: `${geometry.width}px`, height: `${geometry.height}px`, left: `${geometry.x}px`, top: `${geometry.y}px` });
      dpr = Math.min(devicePixelRatio || 1, mobile.matches ? 1.25 : 1.5); canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      if (ctx) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false; }
      catSize = sceneInfo.cat.size * scale;
      // The widest atlas pose extends 48/128 of a frame from the foot anchor.
      const bodyRadius = catSize * .375, screenInset = Math.max(22, bodyRadius + 4);
      catBounds.min = screenInset;
      catBounds.max = Math.max(catBounds.min, Math.min(width - screenInset, geometry.x + sceneInfo.cat.maxX * scale));
      const tree = point('tree'), door = point('door');
      route = [
        { name: 'lawn', label: '草坪', x: safeCatX(width * (mobile.matches ? .2 : .35)), action: 'stretch', dwell: 2900 },
        { name: 'shade', label: '树荫', x: safeCatX(tree.x - 65 * scale), action: 'sleep', dwell: 5800 },
        { name: 'door', label: '房前', x: safeCatX(door.x - 35 * scale), action: 'groom', dwell: 4200 },
        { name: 'pond', label: '池边', x: catBounds.max, action: 'idle', dwell: 3000 }
      ];
      if (!initialized) { cat.x = safeCatX(width * (mobile.matches ? .36 : .55)); initialized = true; }
      else {
        cat.x = safeCatX(cat.x / oldWidth * width);
        if (previousStop) {
          cat.next = route.find(stop => stop.name === previousStop) || null;
          cat.target = cat.next ? cat.next.x : null;
        } else if (cat.target !== null) cat.target = safeCatX(cat.target / oldWidth * width);
      }
      cat.y = geometry.y + sceneInfo.cat.footY * scale;
      ripples = []; positionButton(); draw();
    }
    function actionDuration(action) { return action.durationMs || (Array.isArray(action.durations) ? action.durations.reduce((a, b) => a + b, 0) : action.frames.length / (action.fps || 8) * 1000); }
    function frameFor(atlas, name, time, rate = 1) {
      const action = atlas && (atlas.actions[name] || atlas.actions.idle); if (!action || !action.frames.length) return null;
      let index = 0; const duration = actionDuration(action), timeMs = Math.max(0, time * rate);
      if (Array.isArray(action.durations) && action.durations.length === action.frames.length && action.durations.every(ms => Number.isFinite(ms) && ms > 0)) {
        let cursor = action.loop === false ? Math.min(timeMs, duration - 1) : timeMs % duration;
        while (index < action.frames.length - 1 && cursor >= action.durations[index]) { cursor -= action.durations[index]; index++; }
      } else { const raw = Math.floor(timeMs / 1000 * (action.fps || 8)); index = action.loop === false ? Math.min(raw, action.frames.length - 1) : raw % action.frames.length; }
      return { frame: action.frames[index], index };
    }
    function duration(name) {
      const definition = catAtlas && catAtlas.actions[name];
      if (definition && definition.loop === false) return Math.max(700, actionDuration(definition) / (mode === 'gentle' ? .7 : 1));
      return name === 'sleep' ? 5600 : name === 'groom' ? 3600 : 2400;
    }
    function getState() {
      return { ready: !!catAtlas, chickenReady: !!chickenAtlas, action: cat.action, label: labels[cat.action], mode, route: cat.route, target: cat.target === null ? null : cat.target / width,
        x: cat.x / width, frame: cat.frame, moving: cat.target !== null, running, elapsed: Math.round(elapsed),
        routePoints: route.map(stop => ({ name: stop.name, label: stop.label, x: stop.x / width, action: stop.action })),
        ground: { top: (height - groundHeight) / height, height: groundHeight },
        cat: { x: cat.x, footY: cat.y, size: catSize, bounds: { ...catBounds }, source: { ...sceneInfo.cat } },
        duck: duckPosition(), pondBounds: { ...sceneInfo.pondBounds },
        viewport: { width, height }, image: { ...geometry }, scene: { width: sceneInfo.width, height: sceneInfo.height, horizonY: sceneInfo.horizonY } };
    }
    function publish() { document.dispatchEvent(new CustomEvent('pixel-cat-state', { detail: getState() })); }
    function begin(name, { hold, manual = false, reason = 'route' } = {}) {
      if (!Object.hasOwn(labels, name)) return false;
      cat.action = name; cat.since = elapsed; cat.until = elapsed + (hold || duration(name)); cat.reason = reason;
      catButton.setAttribute('aria-label', `小猫正在${labels[name]}。点击和它打招呼；左右方向键带它散步`);
      if (manual) live.textContent = `小猫${labels[name]}`;
      publish(); draw(); return true;
    }
    function playCatAction(name) {
      if (!Object.hasOwn(labels, name) || !catAtlas) return false;
      if (mode === 'still') { live.textContent = '场景已静止，选择完整或轻柔后再和小猫玩。'; return false; }
      if (elapsed - lastManual < 180) return false;
      lastManual = elapsed; cat.target = null; cat.next = null; cat.route = '和你互动';
      if (name === 'walk' || name === 'run') {
        const distance = name === 'run' ? Math.min(210, width * .38) : Math.min(125, width * .25), target = cat.x + cat.direction * distance;
        if (target < catBounds.min || target > catBounds.max) cat.direction *= -1;
        cat.target = safeCatX(cat.x + cat.direction * distance); cat.route = '自由散步';
      }
      return begin(name, { manual: true, reason: 'manual' });
    }
    function moveCatTo(normalizedX) {
      if (!catAtlas || mode === 'still' || !Number.isFinite(normalizedX) || elapsed - lastManual < 140) return false;
      const target = safeCatX(normalizedX * width), distance = Math.abs(target - cat.x);
      if (distance < 6) return playCatAction('idle');
      lastManual = elapsed; cat.target = target; cat.next = null; cat.direction = target > cat.x ? 1 : -1; cat.route = '自由散步';
      return begin(distance > Math.min(200, width * .4) ? 'run' : 'walk', { manual: true, reason: 'manual' });
    }
    function nextStop() {
      const stop = route[routeIndex]; if (!stop) return;
      cat.target = safeCatX(stop.x); cat.next = stop; cat.direction = stop.x > cat.x ? 1 : -1; cat.route = stop.label; begin('walk');
    }
    function updateCat(delta) {
      if (!catAtlas) return;
      cat.x = safeCatX(cat.x);
      if (cat.target !== null) cat.target = safeCatX(cat.target);
      if (cat.target !== null) {
        const speed = (cat.action === 'run' ? 210 : 96) * geometry.scale * (mode === 'gentle' ? .62 : 1), difference = cat.target - cat.x, step = speed * delta / 1000;
        if (Math.abs(difference) <= step) {
          cat.x = cat.target; cat.target = null;
          if (cat.next) { const stop = cat.next; cat.next = null; begin(stop.action, { hold: stop.dwell / (mode === 'gentle' ? .8 : 1) }); routeIndex = (routeIndex + 1) % route.length; }
          else begin('idle', { hold: 2100, reason: 'manual-rest' });
        } else { cat.direction = difference > 0 ? 1 : -1; cat.x = safeCatX(cat.x + cat.direction * step); }
      } else if (elapsed >= cat.until) {
        if (cat.reason === 'manual') begin('idle', { hold: 1600, reason: 'manual-rest' }); else nextStop();
      }
      if (pointer && cat.target === null && cat.action !== 'sleep' && Math.abs(pointer.x - cat.x) < 95 && pointer.y > height - groundHeight - 30) cat.direction = pointer.x >= cat.x ? 1 : -1;
    }
    function positionButton() {
      const hitWidth = Math.max(44, catSize * .78), hitHeight = Math.max(44, catSize * .72);
      Object.assign(catButton.style, { left: `${Math.round(cat.x - hitWidth / 2)}px`, top: `${Math.round(cat.y - catSize * .35 - hitHeight / 2)}px`, width: `${Math.round(hitWidth)}px`, height: `${Math.round(hitHeight)}px` });
    }
    function fill(x, y, w, h, color, alpha = 1) { ctx.globalAlpha = clamp(alpha, 0, 1); ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); ctx.globalAlpha = 1; }
    function cloud(x, y, scale, alpha) {
      fill(x, y + 6 * scale, 32 * scale, 5 * scale, '#fffbe9', alpha); fill(x + 5 * scale, y + 3 * scale, 9 * scale, 8 * scale, '#fffbe9', alpha);
      fill(x + 12 * scale, y, 10 * scale, 11 * scale, '#fffbe9', alpha); fill(x + 21 * scale, y + 4 * scale, 8 * scale, 7 * scale, '#fffbe9', alpha); fill(x + 3 * scale, y + 10 * scale, 27 * scale, 2 * scale, '#d9ece6', alpha);
    }
    function drawSprite(image, selection, x, footY, size, direction, sourceFoot = .875) {
      if (!selection) return; const frame = selection.frame;
      ctx.save(); ctx.translate(Math.round(x), Math.round(footY)); ctx.scale(direction < 0 ? -1 : 1, 1);
      ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, Math.round(-size / 2), Math.round(-size * sourceFoot), Math.round(size), Math.round(size)); ctx.restore();
    }
    function drawSmoke() {
      if (!imageLoaded) return; const chimney = point('chimney'), clock = elapsed * (mode === 'gentle' ? .6 : 1);
      for (let i = 0; i < 5; i++) {
        const age = ((clock + i * 950) % 4750) / 4750, unit = Math.max(2, Math.round(geometry.scale * 6));
        const x = chimney.x + Math.round((Math.sin(age * 4 + i) * 4 + age * 13) / 2) * 2, y = chimney.y - age * Math.max(36, geometry.scale * 95), alpha = Math.min(1, age * 6) * (1 - age) * .83;
        fill(x - unit, y, unit * 3, unit * 2, '#fffbe8', alpha); fill(x, y - unit, unit * 2, unit, '#fffdf3', alpha); fill(x - unit * 2, y + unit, unit, unit, '#e6eeeb', alpha * .75);
      }
    }
    function drawChickens() {
      if (!chickenAtlas || !chickenImage || !imageLoaded) return;
      const origin = point('chicken'), size = 80 * geometry.scale, clock = elapsed * (mode === 'gentle' ? .62 : 1);
      for (let i = 0; i < 1; i++) {
        const time = (clock + i * 3700) % 13200, walking = time >= 4200 && time < 9500, phase = walking ? (time - 4200) / 5300 : time >= 9500 ? 1 : 0;
        const back = Math.floor((clock + i * 3700) / 13200) % 2 === 1, x = origin.x + (16 + (back ? 66 - phase * 66 : phase * 66)) * geometry.scale, y = origin.y + 6 * geometry.scale;
        drawSprite(chickenImage, frameFor(chickenAtlas, walking ? 'walk' : time < 4200 ? 'peck' : 'idle', clock + i * 500), clamp(x, 18, width - 18), y, size, back ? -1 : 1, (chickenAtlas.footY || chickenAtlas.anchor?.y || 56) / (chickenAtlas.frameHeight || 64));
      }
    }
    function duckPosition() {
      const pond = sceneInfo.pondBounds, origin = sceneInfo.anchors.duck || { x: pond.cx, y: pond.cy };
      const clock = elapsed * (mode === 'gentle' ? .6 : 1), phase = clock / 10500;
      // Fit the whole duck and wake into a water chord, including its bobbing frames.
      const halfWidth = 44, aboveFoot = 38, belowFoot = 14, requiredHalfHeight = (aboveFoot + belowFoot) / 2;
      const horizontalRoom = Math.max(0, pond.rx * Math.sqrt(Math.max(0, 1 - (requiredHalfHeight / pond.ry) ** 2)) - halfWidth);
      const dx = clamp(origin.x - pond.cx + Math.sin(phase) * horizontalRoom * .7, -horizontalRoom * .9, horizontalRoom * .9);
      const halfChord = pond.ry * Math.sqrt(Math.max(0, 1 - ((Math.abs(dx) + halfWidth) / pond.rx) ** 2));
      const minY = pond.cy - halfChord + aboveFoot, maxY = pond.cy + halfChord - belowFoot;
      const sourceX = pond.cx + dx, sourceY = clamp(origin.y + Math.sin(phase * 2) * Math.min(8, pond.ry * .12), minY, Math.max(minY, maxY));
      return { x: geometry.x + sourceX * geometry.scale, y: geometry.y + sourceY * geometry.scale,
        sourceX, sourceY, direction: Math.cos(phase) >= 0 ? 1 : -1, frame: Math.floor(clock / 440) % 4, size: 72 * geometry.scale };
    }
    function drawDuck() {
      if (!imageLoaded) return;
      const duck = duckPosition(), unit = 4 * geometry.scale, bob = (duck.frame === 1 ? -1 : duck.frame === 3 ? 1 : 0) * geometry.scale;
      const x = duck.x, y = duck.y + bob;
      const rect = (sx, sy, w, h, color, alpha = 1) => {
        const left = duck.direction < 0 ? -sx - w : sx;
        fill(x + left * unit, y + sy * unit, w * unit, h * unit, color, alpha);
      };
      const wake = duck.frame % 2 ? .7 : .5;
      rect(-10, 1, 4, .5, '#edf9df', wake); rect(-6, 2, 10, .5, '#d5f4ec', wake);
      rect(6, 1, 4, .5, '#edf9df', wake); rect(-7, 3, 13, .5, '#86c5d0', .75);
      rect(-8, -4, 3, 2, '#92734a'); rect(-7, -3, 12, 4, '#92734a');
      rect(-7, -5, 2, 2, '#fff9dc'); rect(-6, -4, 10, 4, '#fff9dc');
      rect(-5, -1, 8, 2, '#e8ddaf'); rect(-5, -4, 8, 2, '#fffdf0');
      rect(1, -8, 5, 6, '#92734a'); rect(2, -9, 3, 2, '#92734a');
      rect(2, -8, 3, 5, '#fff9dc'); rect(3, -7, 3, 3, '#fffdf0');
      rect(6, -6, 3, 2, '#bb7937'); rect(6, -6, 2, 1, '#efac4c');
      rect(4, -7, 1, 1, '#3d342d');
      rect(-4, -3, 4, 2, '#d4c695'); rect(-4, -3, 3, 1, '#eee5bf');
      if (duck.frame === 2) rect(-3, -2, 3, .5, '#bbaa7d');
    }
    function drawRipples() {
      ripples = ripples.filter(r => elapsed - r.born < 1600);
      for (const ripple of ripples) {
        const age = (elapsed - ripple.born) / 1600, radius = 5 + age * 31, x = Math.round(ripple.x), y = Math.round(ripple.y), r = Math.round(radius / 2) * 2, h = Math.max(2, Math.round(radius * .22 / 2) * 2);
        ctx.strokeStyle = `rgba(255,251,220,${(1 - age) * .85})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - r, y - 2); ctx.lineTo(x - r, y + 2); ctx.lineTo(x - r + 6, y + 2); ctx.lineTo(x - r + 6, y + h); ctx.lineTo(x + r - 6, y + h); ctx.lineTo(x + r - 6, y + 2); ctx.lineTo(x + r, y + 2); ctx.lineTo(x + r, y - 2); ctx.lineTo(x + r - 6, y - 2); ctx.lineTo(x + r - 6, y - h); ctx.lineTo(x - r + 6, y - h); ctx.lineTo(x - r + 6, y - 2); ctx.closePath(); ctx.stroke();
      }
    }
    function draw() {
      if (!ctx) return; ctx.clearRect(0, 0, width, height);
      const speed = mode === 'gentle' ? .0017 : .0034, spread = Math.max(280, width * .57), start = width * .39;
      cloud(start + (elapsed * speed) % spread - 30, Math.max(14, height * .08), mobile.matches ? 1.25 : 1.7, .85);
      if (!mobile.matches) cloud(start + (spread * .6 + elapsed * speed * .7) % spread, Math.max(36, height * .21), 1.1, .65);
      drawSmoke(); drawChickens(); drawRipples(); drawDuck();
      if (catImage && catAtlas) {
        const selection = frameFor(catAtlas, cat.action, elapsed - cat.since, mode === 'gentle' ? .7 : 1); if (selection) cat.frame = selection.index;
        const size = catSize, jumpAge = clamp((elapsed - cat.since) / duration('jump'), 0, 1), hop = cat.action === 'jump' ? Math.sin(jumpAge * Math.PI) * 36 * geometry.scale : 0;
        ctx.fillStyle = '#5d7f3838'; ctx.fillRect(Math.round(cat.x - size * .19), Math.round(cat.y - 1), Math.round(size * .38), 3);
        drawSprite(catImage, selection, cat.x, cat.y - hop, size, cat.direction, (catAtlas.anchor?.y || catAtlas.footY || 112) / (catAtlas.frameHeight || 128));
        if (cat.action === 'love') {
          const age = (elapsed - cat.since) / duration('love'), x = cat.x + cat.direction * size * .25, y = cat.y - size * .75 - Math.min(1, age) * 10, alpha = age > .8 ? (1 - age) * 5 : .95;
          fill(x, y, 4, 4, '#db6f6a', alpha); fill(x + 6, y, 4, 4, '#db6f6a', alpha); fill(x - 2, y + 4, 14, 4, '#db6f6a', alpha); fill(x + 2, y + 8, 6, 4, '#db6f6a', alpha); fill(x + 4, y + 12, 2, 2, '#db6f6a', alpha);
        }
      }
      positionButton();
    }
    function tick(timestamp) {
      if (!running) return;
      const budget = mode === 'gentle' || mobile.matches ? 1000 / 15 : 1000 / 24;
      if (!lastTime) lastTime = timestamp;
      const delta = timestamp - lastTime;
      if (delta >= budget) { const step = Math.min(delta, 140); elapsed += step; lastTime = timestamp; updateCat(step); draw(); }
      raf = requestAnimationFrame(tick);
    }
    function reconcile() {
      const shouldRun = !!ctx && mode !== 'still' && visible && !document.hidden && !suspended;
      if (shouldRun && !running) { running = true; lastTime = 0; raf = requestAnimationFrame(tick); }
      if (!shouldRun && running) { running = false; cancelAnimationFrame(raf); raf = 0; lastTime = 0; }
      body.dataset.villagePlaying = running ? 'true' : 'false';
    }
    function setMode(value, save = true) {
      if (!Object.hasOwn(modes, value)) return false;
      mode = value;
      if (save) { explicitMode = true; try { localStorage.setItem(preferenceKey, value); } catch (_) { /* Optional preference. */ } }
      body.dataset.pixelMotion = mode; buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
      if (mode === 'still') { pointer = null; ripples = []; }
      reconcile(); draw(); publish(); return true;
    }
    function eventPoint(event) {
      if (event.target.closest('a,button,input,textarea,select,label,form,summary,[role="button"],.hero-copy,.gate-box,.login-box,.pixel-motion-control')) return null;
      const rect = host.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
      return x >= 0 && y >= 0 && x <= width && y <= height ? { x, y } : null;
    }
    function waterAt(position) {
      if (!position || !imageLoaded) return false;
      const pond = sceneInfo.pondBounds, x = geometry.x + pond.cx * geometry.scale, y = geometry.y + pond.cy * geometry.scale;
      return ((position.x - x) / Math.max(1, geometry.scale * pond.rx)) ** 2 + ((position.y - y) / Math.max(1, geometry.scale * pond.ry)) ** 2 <= 1;
    }
    function ripple(position, strong = false) {
      if (!waterAt(position) || mode === 'still' || elapsed - lastRipple < (strong ? 170 : 900)) return false;
      lastRipple = elapsed; ripples.push({ x: position.x, y: position.y, born: elapsed }); if (ripples.length > 5) ripples.shift(); return true;
    }
    const interactionHost = body.matches('.pixel-login,.pixel-entrance') ? body : host;
    interactionHost.addEventListener('pointermove', event => { if (coarse.matches || mode === 'still') return; pointer = eventPoint(event); if (pointer && mode === 'full') ripple(pointer); }, { passive: true });
    interactionHost.addEventListener('pointerleave', () => { pointer = null; }, { passive: true });
    interactionHost.addEventListener('click', event => {
      if (mode === 'still') return; const position = eventPoint(event); if (!position) return;
      if (waterAt(position)) { ripple(position, true); return; }
      if (position.y >= height - groundHeight + 10) moveCatTo(position.x / width);
    });
    catButton.addEventListener('click', event => { event.stopPropagation(); if (event.detail > 1) return; const sequence = ['love', 'jump', 'stretch']; if (playCatAction(sequence[clickCycle % sequence.length])) clickCycle++; });
    catButton.addEventListener('dblclick', event => {
      event.preventDefault(); event.stopPropagation();
      if (mode !== 'still' && catAtlas && cat.action !== 'jump') { cat.target = null; cat.next = null; lastManual = elapsed; cat.route = '和你互动'; begin('jump', { manual: true, reason: 'manual' }); }
    });
    catButton.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); moveCatTo((cat.x + (event.key === 'ArrowLeft' ? -1 : 1) * 100) / width); });
    if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(host); else window.addEventListener('resize', resize, { passive: true });
    if (typeof IntersectionObserver === 'function') new IntersectionObserver(entries => { visible = entries[0].isIntersecting; reconcile(); }, { rootMargin: '30px' }).observe(host);
    document.addEventListener('visibilitychange', reconcile);
    reduced.addEventListener('change', event => { if (!explicitMode) setMode(event.matches ? 'still' : 'full', false); });
    window.addEventListener('pagehide', () => { suspended = true; reconcile(); }, { passive: true });
    window.addEventListener('pageshow', () => { suspended = false; resize(); reconcile(); }, { passive: true });
    window.PixelVillage = Object.freeze({ playCatAction, moveCatTo, setMode, getState });
    resize(); setMode(mode, false);
  });
})();
