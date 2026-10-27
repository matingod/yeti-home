/* Local decorative pets. Only read-only sprite assets; food remains browser-local. */
(() => {
  'use strict';
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const dailyLimit = 6, bowlCapacity = 4;
  function chinaDay(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key).value).join('-');
  }
  function normalizeFood(value, day) {
    const source = value && value.version === 1 ? value : {};
    const integer = (v, max) => Number.isFinite(v) ? clamp(Math.floor(v), 0, max) : 0;
    return { version: 1, day, toppedUp: source.day === day ? integer(source.toppedUp, dailyLimit) : 0,
      portions: integer(source.portions, bowlCapacity), dogMeals: source.day === day ? integer(source.dogMeals, 100) : 0,
      catMeals: source.day === day ? integer(source.catMeals, 100) : 0,
      pending: { dog: source.pending?.dog === true, cat: source.pending?.cat === true } };
  }
  function addFood(state) {
    if (state.portions >= bowlCapacity) return 'full';
    if (state.toppedUp >= dailyLimit) return 'limit';
    state.portions = Math.min(bowlCapacity, state.portions + 2); state.toppedUp++; return 'added';
  }
  function reserveFood(state, animal) {
    if (!['dog', 'cat'].includes(animal) || state.pending[animal]) return false;
    if (state.portions < 1) return false;
    state.portions--; state.pending[animal] = true; return true;
  }
  function finishFood(state, animal) {
    if (!state.pending[animal]) return false;
    state.pending[animal] = false; state[animal + 'Meals']++; return true;
  }
  function petGeometry(village) {
    const { viewport, image, cat, pondBounds } = village;
    // Teddy atlas has transparent margins too; keep its visible body comparable to the cat.
    const size = cat.size * .94, radius = size * .49, inset = Math.max(23, radius + 5);
    const shore = image.x + (pondBounds.cx - pondBounds.rx) * image.scale;
    const min = inset, max = Math.max(min, Math.min(viewport.width - inset, cat.bounds.max - size * .08, shore - radius - 12 * image.scale));
    const bowlX = min + (max - min) * .60;
    return { width: viewport.width, height: viewport.height, scale: image.scale, size, min, max, catBodyWidth: cat.size * .625,
      // The cat stays on source row 650; the dog walks in the foreground on 685.
      footY: Math.min(viewport.height - 7, cat.footY + 35 * image.scale),
      bowlX, bowlSize: cat.size * .5, dogMealX: clamp(bowlX - size * .33, min, max),
      catMealX: clamp(bowlX + cat.size * .37, cat.bounds.min, cat.bounds.max), shore };
  }
  function separatedRestX(preferred, catX, geometry) {
    const clearance = Math.max(geometry.catBodyWidth, geometry.size * 31 / 32) + 8;
    const target = clamp(preferred, geometry.min, geometry.max);
    if (!Number.isFinite(catX) || Math.abs(target - catX) >= clearance) return target;
    const options = [catX - clearance, catX + clearance].filter(x => x >= geometry.min && x <= geometry.max);
    if (options.length) return options.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
    return Math.abs(geometry.min - catX) >= Math.abs(geometry.max - catX) ? geometry.min : geometry.max;
  }
  function petPerson(bodyPerson, pathname, remembered) {
    if (['yeti', 'yuki'].includes(bodyPerson)) return bodyPerson;
    const owner = /^\/(yeti|yuki)(?:\/|$)/.exec(pathname || '')?.[1];
    if (owner) return owner;
    return ['yeti', 'yuki'].includes(remembered) ? remembered : 'guest';
  }
  /* Pure helpers are available to the local validation harness without a browser. */
  if (typeof module === 'object' && module.exports) { module.exports = { chinaDay, normalizeFood, addFood, reserveFood, finishFood, petGeometry, separatedRestX, petPerson }; return; }
  const ready = callback => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', callback, { once: true }) : callback();
  ready(function mountPets() {
    const body = document.body, host = body?.querySelector('.pixel-hero');
    // Every existing hero village gets the same animals, including content pages.
    if (!host || host.dataset.interiorPetsReady) return;
    const village = () => window.PixelVillage?.getState?.();
    if (!village()) { document.addEventListener('pixel-cat-state', mountPets, { once: true }); return; }
    const identityKey = 'home-interior-pets:v10:person', motionKey = 'yeti-home-pixel-motion';
    let remembered; try { remembered = sessionStorage.getItem(identityKey); } catch (_) { /* Optional tab identity. */ }
    const person = petPerson(body.dataset.person, window.location?.pathname, remembered);
    if (person !== 'guest') { try { sessionStorage.setItem(identityKey, person); } catch (_) { /* Keep explicit page identity. */ } }
    const storageKey = `home-interior-pets:v10:${person}`, reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let food; try { food = normalizeFood(JSON.parse(localStorage.getItem(storageKey)), chinaDay()); } catch (_) { food = normalizeFood(null, chinaDay()); }
    let observedMotionPreference;
    let visible = true, suspended = false, running = false, raf = 0, lastTime = 0, elapsed = 0, initialized = false, geometry, dpr = 1;
    let nextRoute = 0, lastFeedback = '', clickCount = 0, catPhase = '', catSince = 0, lastCatTry = -1000, lastDayCheck = 0;
    let dogAtlas, dogImage;
    const dog = { x: 0, target: null, direction: 1, action: 'idle', since: 0, until: 2800, heartUntil: 0, frame: 0, spriteReady: false, frameRect: null };
    const canvas = document.createElement('canvas'); canvas.className = 'interior-pet-canvas'; canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d', { alpha: true }); if (!ctx) return;
    const dogButton = document.createElement('button'); dogButton.type = 'button'; dogButton.className = 'interior-dog-hit'; dogButton.setAttribute('aria-label', '小狗：点击打招呼，左右方向键带它散步');
    const dogHint = document.createElement('span'); dogHint.className = 'interior-pet-hint'; dogHint.textContent = '和小狗玩'; dogButton.appendChild(dogHint);
    const bowlButton = document.createElement('button'); bowlButton.type = 'button'; bowlButton.className = 'interior-food-hit';
    const bowlHint = document.createElement('span'); bowlHint.className = 'interior-pet-hint'; bowlHint.textContent = '给小伙伴添粮'; bowlButton.appendChild(bowlHint);
    const tools = document.createElement('div'); tools.className = 'interior-pet-tools'; tools.setAttribute('role', 'group'); tools.setAttribute('aria-label', '照顾小伙伴');
    const feedButton = document.createElement('button'); feedButton.type = 'button'; feedButton.className = 'interior-pet-feed'; feedButton.textContent = '添粮';
    const callButton = document.createElement('button'); callButton.type = 'button'; callButton.textContent = '叫小狗';
    const catButton = document.createElement('button'); catButton.type = 'button'; catButton.textContent = '喂小猫';
    const counter = document.createElement('span'); counter.className = 'interior-food-count';
    const status = document.createElement('span'); status.className = 'interior-pet-feedback'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
    tools.append(feedButton, callButton, catButton, counter, status); host.append(canvas, dogButton, bowlButton, tools);
    host.dataset.interiorPetsReady = 'true'; host.dataset.petPerson = person;
    Promise.all([
      fetch('/static/pixel/scene-v7/teddy-atlas.json', { credentials: 'same-origin' }).then(response => { if (!response.ok) throw new Error('Missing teddy metadata'); return response.json(); }),
      new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = '/static/pixel/scene-v7/teddy-atlas.png'; })
    ]).then(([metadata, image]) => {
      if (!metadata || ![metadata.frameHeight, metadata.footY].every(Number.isFinite) || metadata.frameHeight <= 0 || !['idle', 'walk', 'wag', 'jump', 'eat'].every(name => {
        const frames = metadata.actions?.[name]?.frames;
        return Array.isArray(frames) && frames.length && frames.every(frame => [frame.x, frame.y, frame.w, frame.h].every(Number.isFinite) && frame.x >= 0 && frame.y >= 0 && frame.w > 0 && frame.h > 0 && frame.x + frame.w <= image.naturalWidth && frame.y + frame.h <= image.naturalHeight);
      })) throw new Error('Invalid teddy atlas');
      dogAtlas = metadata; dogImage = image; dog.spriteReady = true; draw();
    }).catch(() => { dog.spriteReady = false; draw(); });
    function save() { try { localStorage.setItem(storageKey, JSON.stringify(food)); } catch (_) { /* Browser-local play remains available when persistence is blocked. */ } updateLabels(); }
    function readSharedFood() {
      try {
        const saved = localStorage.getItem(storageKey);
        food = normalizeFood(JSON.parse(saved), chinaDay());
      } catch (_) { /* Keep playable in-memory state if storage is unavailable. */ }
      if (!food.pending.cat) catPhase = '';
      updateLabels();
    }
    function syncMotionPreference() {
      try {
        const value = localStorage.getItem(motionKey);
        if (['full', 'gentle', 'still'].includes(value) && value !== observedMotionPreference) {
          observedMotionPreference = value;
          // Preserve explicit user choice in PixelVillage as well as its body dataset.
          // Writing the same localStorage value does not generate another storage event.
          window.PixelVillage.setMode?.(value);
        }
      } catch (_) { /* Existing page/system mode remains authoritative. */ }
    }
    function refreshDay(force = false) { const now = Date.now(); if (!force && now - lastDayCheck < 60000) return; lastDayCheck = now; const day = chinaDay(); if (food.day !== day) { food = normalizeFood(food, day); save(); } }
    function feedback(message) { if (lastFeedback !== message) { lastFeedback = message; status.textContent = message; } }
    function updateLabels() {
      counter.textContent = `粮碗 ${food.portions}/${bowlCapacity}`;
      counter.title = `今天添粮 ${food.toppedUp}/${dailyLimit} 次；小狗吃过 ${food.dogMeals} 份，小猫吃过 ${food.catMeals} 份`;
      bowlButton.setAttribute('aria-label', `粮碗里还有 ${food.portions} 份粮食，点击添粮`);
      feedButton.title = `一次添两份，粮碗最多四份，每天可添 ${dailyLimit} 次；不会扣分或影响互动`;
      feedButton.dataset.remaining = String(Math.max(0, dailyLimit - food.toppedUp));
      host.dataset.petFood = String(food.portions);
    }
    const mode = () => ['full', 'gentle', 'still'].includes(body.dataset.pixelMotion) ? body.dataset.pixelMotion : reduced.matches ? 'still' : 'full';
    function begin(action, hold = 2400) { dog.action = action; dog.since = elapsed; dog.until = elapsed + hold; dogButton.dataset.action = action; }
    function resize() {
      const state = village(); if (!state) return;
      const old = geometry; geometry = petGeometry(state);
      if (!initialized) { dog.x = separatedRestX(geometry.min + (geometry.max - geometry.min) * .78, state.cat.x, geometry); initialized = true; }
      else { dog.x = clamp(old ? dog.x / old.width * geometry.width : dog.x, geometry.min, geometry.max); if (dog.target !== null) dog.target = clamp(dog.target / (old?.width || geometry.width) * geometry.width, geometry.min, geometry.max); }
      if (dog.target === null && !food.pending.dog && dog.action === 'idle') dog.x = separatedRestX(dog.x, state.cat.x, geometry);
      if (food.pending.dog) dog.target = geometry.dogMealX;
      dpr = Math.min(devicePixelRatio || 1, 1.5); canvas.width = Math.max(1, Math.round(geometry.width * dpr)); canvas.height = Math.max(1, Math.round(geometry.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false;
      positionButtons(); draw();
    }
    function positionButtons() {
      if (!geometry) return;
      const hit = Math.max(44, geometry.size * .91), hitHeight = Math.max(44, geometry.size * .85);
      Object.assign(dogButton.style, { left: `${dog.x - hit / 2}px`, top: `${geometry.footY - hitHeight}px`, width: `${hit}px`, height: `${hitHeight}px` });
      Object.assign(bowlButton.style, { left: `${geometry.bowlX - 22}px`, top: `${Math.min(geometry.height - 44, geometry.footY - 31)}px`, width: '44px', height: '44px' });
      dogButton.dataset.x = String(Math.round(dog.x)); dogButton.dataset.safeMin = String(Math.round(geometry.min)); dogButton.dataset.safeMax = String(Math.round(geometry.max));
    }
    function requestDogMeal() {
      readSharedFood(); refreshDay(true);
      if (food.pending.dog) { feedback(mode() === 'still' ? '粮已经备好，恢复动效后小狗会来吃。' : '小狗正在过来，给它留点时间。'); return false; }
      if (!reserveFood(food, 'dog')) return false;
      save(); dog.target = geometry.dogMealX; dog.direction = dog.target >= dog.x ? 1 : -1; begin('walk');
      feedback(mode() === 'still' ? '粮已经备好，恢复动效后小狗会来吃。' : '小狗闻到香味，过来吃粮啦。'); draw(); return true;
    }
    function topUp() {
      readSharedFood(); refreshDay(true); const result = addFood(food); save();
      if (result === 'limit') { feedback('今天的零食够啦，明天还能添粮；现在可以继续和它们玩。'); return; }
      if (result === 'full') { feedback('粮碗已经满啦，先让小伙伴慢慢吃。'); requestDogMeal(); return; }
      if (!requestDogMeal()) feedback('粮已经添好，小猫小狗都有份。'); draw();
    }
    function feedCat() {
      readSharedFood(); refreshDay(true);
      if (food.pending.cat) { feedback('小猫的那份已经留好啦。'); return; }
      if (!reserveFood(food, 'cat')) { feedback('粮碗空了，点“添粮”给小猫准备一份吧。'); return; }
      save(); catPhase = 'walk'; catSince = elapsed; lastCatTry = -1000;
      feedback(mode() === 'still' ? '已给小猫留一份，恢复动效后它会来吃。' : '给小猫留好一份，叫它过来。'); draw();
    }
    function greetDog() {
      if (food.pending.dog) { dog.heartUntil = elapsed + 1400; feedback('小狗正在吃饭，尾巴也没忘记回应你。'); draw(); return; }
      dog.target = null;
      if (mode() === 'still') { begin('idle'); feedback('小狗安静地陪着你。切回轻柔或完整，可以和它散步。'); draw(); return; }
      clickCount++; begin(clickCount % 3 === 0 ? 'jump' : 'wag', clickCount % 3 === 0 ? 950 : 2200); dog.heartUntil = elapsed + 1400;
      feedback(clickCount % 3 === 0 ? '小狗开心地跳了一下。' : '小狗摇摇尾巴，和你打招呼。'); draw();
    }
    function moveDog(direction) {
      if (food.pending.dog) { feedback('先让小狗吃完这一口，再去散步吧。'); return; }
      if (mode() === 'still') { greetDog(); return; }
      dog.target = clamp(dog.x + direction * Math.max(35, geometry.size * 1.65), geometry.min, geometry.max);
      dog.direction = dog.target >= dog.x ? 1 : -1; begin('walk'); feedback('小狗在草地上陪你散步。');
    }
    function update(delta) {
      if (!geometry) return;
      refreshDay(); dog.x = clamp(dog.x, geometry.min, geometry.max);
      if (food.pending.dog && dog.action !== 'eat') { dog.target = geometry.dogMealX; if (dog.action !== 'walk') begin('walk'); }
      if (dog.target !== null) {
        dog.target = clamp(dog.target, geometry.min, geometry.max);
        const gap = dog.target - dog.x, step = 120 * geometry.scale * delta / 1000;
        dog.direction = gap >= 0 ? 1 : -1;
        if (Math.abs(gap) <= step + .5) { dog.x = dog.target; dog.target = null; if (food.pending.dog) { dog.direction = 1; begin('eat', 3100); feedback('小狗低头吃粮，尾巴轻轻摇。'); } else begin('idle', 2600 + Math.random() * 2000); }
        else dog.x = clamp(dog.x + Math.sign(gap) * step, geometry.min, geometry.max);
      } else if (elapsed >= dog.until) {
        if (dog.action === 'eat') { readSharedFood(); if (finishFood(food, 'dog')) { save(); feedback('小狗吃饱啦，摇摇尾巴谢谢你。'); } begin('wag', 2200); dog.heartUntil = elapsed + 1400; }
        else if (dog.action !== 'idle') begin('idle', 2400);
        else { const route = [.78, .32, .56, .88]; dog.target = separatedRestX(geometry.min + (geometry.max - geometry.min) * route[nextRoute++ % route.length], village()?.cat.x, geometry); begin('walk'); }
      }
      // Passing each other is fine; choose another resting place if the cat settles here.
      if (!food.pending.dog && dog.target === null && dog.action === 'idle' && elapsed - dog.since > 900) {
        const restingX = separatedRestX(dog.x, village()?.cat.x, geometry);
        if (Math.abs(restingX - dog.x) > 2) { dog.target = restingX; begin('walk'); }
      }
      if (food.pending.cat) {
        if (!catPhase) { catPhase = 'walk'; catSince = elapsed; }
        const current = village();
        if (catPhase === 'walk' && current?.ready) {
          if (Math.abs(current.cat.x - geometry.catMealX) < Math.max(6, current.cat.size * .15) && !current.moving) {
            if (window.PixelVillage.playCatAction('groom')) { catPhase = 'groom'; catSince = elapsed; feedback('小猫尝过粮，坐下来洗洗脸。'); }
          } else if (elapsed - lastCatTry > 900 && (!current.moving || Math.abs((current.target || 0) * geometry.width - geometry.catMealX) > 8)) {
            lastCatTry = elapsed; window.PixelVillage.moveCatTo(geometry.catMealX / geometry.width);
          }
        }
        if (catPhase === 'groom' && elapsed - catSince > 2200) { readSharedFood(); if (finishFood(food, 'cat')) { save(); feedback('小猫吃好啦，继续在草地上散步。'); } catPhase = ''; }
      }
    }
    function rect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); }
    function drawDogSprite() {
      if (!dogAtlas || !dogImage) return false;
      const action = dogAtlas.actions[dog.action] || dogAtlas.actions.idle, time = Math.max(0, elapsed - dog.since);
      const raw = Math.floor(time / 1000 * (action.fps || 4));
      dog.frame = action.loop === false ? Math.min(raw, action.frames.length - 1) : raw % action.frames.length;
      const frame = action.frames[dog.frame], size = geometry.size;
      dog.frameRect = { ...frame };
      const hop = dog.action === 'jump' ? Math.sin(clamp(time / 950, 0, 1) * Math.PI) * size * .25 : 0;
      ctx.save(); ctx.translate(Math.round(dog.x), Math.round(geometry.footY - hop)); ctx.scale(dog.direction, 1);
      ctx.drawImage(dogImage, frame.x, frame.y, frame.w, frame.h, Math.round(-size / 2), Math.round(-size * dogAtlas.footY / dogAtlas.frameHeight), Math.round(size), Math.round(size));
      ctx.restore(); return true;
    }
    function drawDog() {
      if (drawDogSprite()) { drawDogHeart(); return; }
      const p = geometry.size / 32, t = elapsed - dog.since, walk = dog.action === 'walk', eating = dog.action === 'eat';
      const stride = walk ? Math.floor(t / 130) % 4 : 0, bob = walk && stride % 2 ? 1 : 0;
      const jump = dog.action === 'jump' ? Math.round(Math.sin(clamp(t / 950, 0, 1) * Math.PI) * 8) : 0;
      const wag = ['wag', 'eat', 'walk'].includes(dog.action) ? Math.floor(t / (eating ? 240 : 130)) % 3 : 1;
      const headDown = eating ? 8 + Math.floor(t / 260) % 2 : 0;
      const c = { line: '#60361e', tan: '#d88a39', light: '#efb65e', shade: '#b76829', cream: '#ffe2a8', white: '#fff0ca', eye: '#29251f', pink: '#d98970' };
      ctx.save(); ctx.translate(Math.round(dog.x), Math.round(geometry.footY - jump * p)); ctx.scale(dog.direction, 1); ctx.translate(-16 * p, -28 * p);
      const r = (x, y, w, h, color) => rect(x * p, (y - bob) * p, w * p, h * p, color);
      /* Curled tail changes in crisp one-pixel steps instead of rotating a bitmap. */
      const tailY = wag === 0 ? -1 : wag === 2 ? 1 : 0;
      r(3, 8 + tailY, 4, 2, c.line); r(1, 10 + tailY, 3, 6, c.line); r(3, 15, 6, 4, c.line); r(6, 10 + tailY, 2, 3, c.line);
      r(3, 9 + tailY, 3, 2, c.white); r(2, 11 + tailY, 2, 4, c.light); r(4, 15, 4, 2, c.tan); r(4, 17, 5, 1, c.shade); r(6, 11 + tailY, 1, 1, c.cream);
      r(9, 12, 13, 2, c.line); r(7, 14, 17, 7, c.line); r(8, 21, 16, 3, c.line); r(6, 16, 2, 4, c.line);
      r(9, 14, 14, 7, c.tan); r(11, 13, 10, 3, c.light); r(8, 16, 3, 4, c.tan); r(8, 19, 13, 3, c.shade); r(13, 20, 10, 2, c.cream);
      r(11, 15, 2, 1, c.light); r(16, 17, 2, 1, c.light); r(8, 18, 2, 2, c.shade); r(18, 21, 3, 1, c.white);
      const backLift = walk && [0, 3].includes(stride) ? 2 : 0, frontLift = walk && [1, 2].includes(stride) ? 2 : 0;
      r(8, 21, 4, 7 - backLift, c.line); r(9, 22, 2, 4 - backLift, c.tan); r(8, 26 - backLift, 4, 1, c.cream);
      r(20, 20, 5, 8 - frontLift, c.line); r(21, 21, 3, 5 - frontLift, c.cream); r(20, 26 - frontLift, 5, 1, c.white);
      r(23, 13, 4, 9, c.line); r(23, 14, 3, 7, c.cream);
      const h = (x, y, w, height, color) => r(x, y + headDown, w, height, color);
      h(20, 1, 1, 2, c.line); h(19, 3, 3, 2, c.line); h(18, 5, 5, 3, c.line); h(20, 3, 1, 3, c.light); h(19, 5, 2, 2, c.pink);
      h(27, 1, 1, 2, c.line); h(26, 3, 3, 2, c.line); h(26, 5, 4, 3, c.line); h(27, 3, 1, 3, c.light); h(27, 5, 1, 2, c.pink);
      h(19, 7, 11, 6, c.line); h(20, 12, 9, 3, c.line); h(20, 6, 8, 7, c.tan); h(22, 5, 4, 3, c.light);
      h(27, 10, 4, 1, c.line); h(25, 11, 7, 3, c.line); h(25, 11, 5, 2, c.white); h(26, 13, 4, 1, c.cream); h(30, 10, 2, 2, c.eye);
      h(26, 8, 2, 2, c.eye); h(26, 8, 1, 1, c.white); h(25, 7, 2, 1, c.cream); h(21, 11, 4, 3, c.cream); h(23, 13, 4, 2, c.white);
      if (dog.action === 'wag' || dog.action === 'jump') h(28, 14, 2, 2, c.pink);
      if (eating && Math.floor(t / 350) % 2) { r(31, 25, 1, 1, c.light); r(28, 27, 1, 1, c.cream); }
      ctx.restore();
      drawDogHeart();
    }
    function drawDogHeart() {
      if (dog.heartUntil > elapsed) {
        const heart = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
        const hp = Math.max(1, geometry.scale * 2), hx = dog.x - hp * 3, hy = geometry.footY - geometry.size - hp * 7;
        heart.forEach((row, y) => [...row].forEach((cell, x) => { if (cell === '1') rect(hx + x * hp, hy + y * hp, hp, hp, '#ca725d'); }));
      }
    }
    function drawBowl() {
      const p = geometry.bowlSize / 22, x = geometry.bowlX - 11 * p, y = geometry.footY - 6 * p;
      const r = (px, py, w, h, color) => rect(x + px * p, y + py * p, w * p, h * p, color);
      r(0, 0, 22, 2, '#62412d'); r(1, 2, 20, 2, '#785236'); r(3, 4, 16, 3, '#62412d'); r(3, 2, 16, 3, '#b9834e'); r(5, 5, 12, 1, '#e1b977'); r(2, 0, 18, 1, '#e2b66c');
      const hasFood = food.portions || food.pending.dog || food.pending.cat;
      if (hasFood) { r(5, -2, 13, 3, '#915b2d'); r(6, -2, 3, 1, '#d5a055'); r(11, -1, 2, 1, '#ebbd70'); r(15, -2, 2, 1, '#c58a47'); }
    }
    function draw() {
      if (!geometry) return;
      ctx.clearRect(0, 0, geometry.width, geometry.height); drawBowl();
      rect(dog.x - geometry.size * .34, geometry.footY, geometry.size * .68, Math.max(2, geometry.scale * 5), '#4e723d55');
      drawDog(); positionButtons();
    }
    function tick(timestamp) {
      if (!running) return;
      const budget = mode() === 'gentle' ? 1000 / 15 : 1000 / 24;
      if (!lastTime) lastTime = timestamp;
      const delta = timestamp - lastTime;
      if (delta >= budget) { const step = Math.min(delta, 120) * (mode() === 'gentle' ? .56 : 1); elapsed += step; lastTime = timestamp; update(step); draw(); }
      raf = requestAnimationFrame(tick);
    }
    function reconcile() {
      const shouldRun = mode() !== 'still' && visible && !document.hidden && !suspended;
      if (shouldRun && !running) { running = true; lastTime = 0; raf = requestAnimationFrame(tick); }
      else if (!shouldRun && running) { running = false; cancelAnimationFrame(raf); lastTime = 0; raf = 0; }
      canvas.dataset.running = String(running); canvas.dataset.motion = mode(); draw();
    }
    dogButton.addEventListener('click', event => { event.stopPropagation(); greetDog(); });
    dogButton.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); moveDog(event.key === 'ArrowLeft' ? -1 : 1); } });
    bowlButton.addEventListener('click', event => { event.stopPropagation(); topUp(); });
    tools.addEventListener('click', event => event.stopPropagation());
    feedButton.addEventListener('click', topUp); callButton.addEventListener('click', greetDog); catButton.addEventListener('click', feedCat);
    if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(host); else window.addEventListener('resize', resize, { passive: true });
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => {
      host.style.setProperty('--interior-pet-toolbar-height', `${Math.ceil(tools.getBoundingClientRect().height)}px`);
    }).observe(tools);
    if (typeof IntersectionObserver === 'function') new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); reconcile(); }).observe(host);
    new MutationObserver(reconcile).observe(body, { attributes: true, attributeFilter: ['data-pixel-motion'] });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { readSharedFood(); syncMotionPreference(); } reconcile(); }); reduced.addEventListener('change', reconcile);
    window.addEventListener('pagehide', () => { suspended = true; reconcile(); }, { passive: true });
    window.addEventListener('pageshow', () => { suspended = false; readSharedFood(); syncMotionPreference(); resize(); reconcile(); }, { passive: true });
    window.addEventListener('focus', () => { readSharedFood(); syncMotionPreference(); draw(); }, { passive: true });
    window.addEventListener('storage', event => {
      if (event.key === storageKey || event.key === null) { readSharedFood(); draw(); }
      if (event.key === motionKey || event.key === null) { syncMotionPreference(); reconcile(); }
    });
    document.addEventListener('pixel-cat-state', () => { resize(); reconcile(); });
    window.InteriorPetsV10 = Object.freeze({ getState: () => ({ person, storageKey, running, mode: mode(), elapsed: Math.round(elapsed), geometry: { ...geometry }, dog: { ...dog }, food: JSON.parse(JSON.stringify(food)), catPhase }), topUp, feedCat, greetDog });
    save(); syncMotionPreference(); resize(); reconcile();
  });
})();
