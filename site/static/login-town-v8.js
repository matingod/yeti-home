/* Login-town decoration. Only optional browser-local preferences and collectibles are saved. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    const start = () => api.mount(document);
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start, { once: true }) : start();
  }
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  const WIDTH = 1536, HEIGHT = 1024, STORE = 'login-town-v8:day', MODE = 'login-town-v8:motion';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const clockFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function clockParts(date = new Date()) {
    const parts = Object.fromEntries(clockFormat.formatToParts(date).map(p => [p.type, p.value]));
    return { key: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, date: `${Number(parts.month)}月${Number(parts.day)}日`, hour: Number(parts.hour) + Number(parts.minute) / 60 };
  }
  function lighting(hour, sunHours) {
    const h = ((hour % 24) + 24) % 24;
    if (sunHours && Number.isFinite(sunHours.sunrise) && Number.isFinite(sunHours.sunset) && sunHours.sunrise >= 3 && sunHours.sunrise <= 9 && sunHours.sunset >= 15 && sunHours.sunset <= 22 && sunHours.sunset > sunHours.sunrise) {
      const rise = sunHours.sunrise, set = sunHours.sunset;
      const night = h < rise - .75 ? 1 : h < rise + .75 ? 1 - smooth(rise - .75, rise + .75, h) : h < set - .75 ? 0 : smooth(set - .75, set + 1.25, h);
      const dusk = h >= set - 1.5 && h <= set + 1.25 ? Math.sin((h - set + 1.5) / 2.75 * Math.PI) * .7 : h >= rise - .75 && h <= rise + 1.25 ? Math.sin((h - rise + .75) / 2 * Math.PI) * .35 : 0;
      const label = h < rise - .75 || h >= set + 1.25 ? '夜晚' : h < rise + 1.25 ? '清晨' : h < 12 ? '上午' : h < set - .75 ? '午后' : '黄昏';
      return { night, dusk, label };
    }
    const night = h < 5 ? 1 : h < 7 ? 1 - smooth(5, 7, h) : h < 17.5 ? 0 : smooth(17.5, 20, h);
    const dusk = h >= 16 && h <= 20 ? Math.sin((h - 16) / 4 * Math.PI) * .7 : h >= 5 && h <= 8 ? Math.sin((h - 5) / 3 * Math.PI) * .35 : 0;
    const label = h < 5 || h >= 20 ? '夜晚' : h < 8 ? '清晨' : h < 12 ? '上午' : h < 17 ? '午后' : '黄昏';
    return { night, dusk, label };
  }
  function ambientMultipliers(light = {}) {
    const night = clamp(Number(light.night) || 0, 0, 1) * .83, dusk = clamp(Number(light.dusk) || 0, 0, 1) * .38;
    // The same sRGB multiply colors and strengths used by the background CSS.
    return [0, 1, 2].map(i => (1 - dusk + [250, 136, 62][i] / 255 * dusk) * (1 - night + [20, 38, 83][i] / 255 * night));
  }
  function makeAmbientFilter(doc) {
    if (typeof doc.createElementNS !== 'function') return null;
    let svg;
    try {
      const ns = 'http://www.w3.org/2000/svg', filter = doc.createElementNS(ns, 'filter'), matrix = doc.createElementNS(ns, 'feColorMatrix');
      svg = doc.createElementNS(ns, 'svg'); svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.style.position = 'absolute';
      filter.setAttribute('id', 'town-actor-ambient-v9'); filter.setAttribute('color-interpolation-filters', 'sRGB');
      filter.setAttribute('x', '0'); filter.setAttribute('y', '0'); filter.setAttribute('width', '100%'); filter.setAttribute('height', '100%');
      matrix.setAttribute('type', 'matrix'); filter.appendChild(matrix); svg.appendChild(filter); doc.body.appendChild(svg);
      const url = 'url(#town-actor-ambient-v9)';
      const values = factors => `${factors[0]} 0 0 0 0 0 ${factors[1]} 0 0 0 0 0 ${factors[2]} 0 0 0 0 0 1 0`;
      // Probe the actual browser path, including preservation of translucent alpha.
      const original = doc.createElement('canvas'), probe = doc.createElement('canvas'); original.width = original.height = probe.width = probe.height = 1;
      const a = original.getContext('2d'), b = probe.getContext('2d');
      matrix.setAttribute('values', values([.5, .4, .3]));
      a.fillStyle = 'rgba(200,150,100,0.5)'; a.fillRect(0, 0, 1, 1); b.filter = url; b.drawImage(original, 0, 0);
      const pixel = b.getImageData(0, 0, 1, 1).data;
      if (Math.abs(pixel[0] - 100) > 3 || Math.abs(pixel[1] - 60) > 3 || Math.abs(pixel[2] - 30) > 3 || Math.abs(pixel[3] - 128) > 2) throw new Error('Ambient filter unavailable');
      let previous = '';
      return { url, update(light) { const next = values(ambientMultipliers(light)); if (next !== previous) { matrix.setAttribute('values', next); previous = next; } } };
    } catch (_) { svg?.remove(); return null; }
  }
  const ITEMS = ['egg-0', 'egg-1', 'egg-2', 'crop-0', 'crop-1', 'crop-2'];
  function dailyState(saved, key) {
    return { date: key, collected: saved && saved.date === key && Array.isArray(saved.collected) ? [...new Set(saved.collected.filter(id => ITEMS.includes(id)))] : [] };
  }
  function collectItem(saved, key, id) {
    const state = dailyState(saved, key);
    if (!ITEMS.includes(id) || state.collected.includes(id)) return { state, added: false };
    return { state: { date: key, collected: state.collected.concat(id) }, added: true };
  }
  function routePoint(route, seconds, speed = 12, pause = 6) {
    if (!Array.isArray(route) || !route.length) return { x: 0, y: 0, direction: 1, walking: false };
    if (route.length === 1) return { ...route[0], direction: 1, walking: false };
    const segments = route.slice(1).map((p, i) => Math.hypot(p.x - route[i].x, p.y - route[i].y));
    const length = segments.reduce((a, b) => a + b, 0);
    if (!length) return { ...route[0], direction: 1, walking: false };
    const period = length / speed * 2 + pause * 2, local = ((seconds % period) + period) % period;
    const outbound = local < length / speed + pause;
    let distance = outbound ? clamp((local - pause) * speed, 0, length) : clamp(length - (local - length / speed - pause) * speed, 0, length);
    const walking = outbound ? local > pause : local < period - pause;
    for (let i = 0; i < segments.length; i++) {
      if (distance <= segments[i] || i === segments.length - 1) {
        const t = segments[i] ? distance / segments[i] : 0, a = route[i], b = route[i + 1];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, direction: (b.x >= a.x ? 1 : -1) * (outbound ? 1 : -1), walking };
      }
      distance -= segments[i];
    }
  }
  function duckPoint(pond, seconds, offset = 0) {
    // Bound the complete duck and largest click ripple to the water's elliptical chord.
    const phase = seconds / 12 + offset;
    const dx = Math.sin(phase) * Math.max(0, pond.rx - 48) * .6;
    const chord = pond.ry * Math.sqrt(Math.max(0, 1 - ((Math.abs(dx) + 48) / pond.rx) ** 2));
    const lower = pond.cy - chord + 31, upper = pond.cy + chord - 24;
    return { x: pond.cx + dx, y: clamp(pond.cy + Math.cos(phase * 2) * 8, lower, Math.max(lower, upper)), direction: Math.cos(phase) < 0 ? -1 : 1 };
  }
  function isNewsURL(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'chinanews.com.cn' || url.hostname.endsWith('.chinanews.com.cn')); } catch (_) { return false; }
  }
  function validNews(payload, today, now = Date.now()) {
    if (!payload || payload.date !== today || !Array.isArray(payload.items)) return [];
    return payload.items.filter(item => {
      if (!item || typeof item.title !== 'string' || !item.title.trim() || !isNewsURL(item.url) || item.source !== '中新网') return false;
      const published = Date.parse(item.publishedAt);
      return Number.isFinite(published) && published <= now && clockParts(new Date(published)).key === today;
    }).slice(0, 20);
  }
  const CAT_ATLAS = {"version":1,"image":"atlas.png","frameWidth":128,"frameHeight":128,"anchor":{"x":64,"y":112},"facing":"right","pixelScale":2,"actions":{"idle":{"label":"歇一会儿","fps":4,"loop":true,"durations":[1600,200,90,80,100,300],"durationMs":2370,"frames":[{"x":0,"y":0,"w":128,"h":128},{"x":128,"y":0,"w":128,"h":128},{"x":256,"y":0,"w":128,"h":128},{"x":384,"y":0,"w":128,"h":128},{"x":512,"y":0,"w":128,"h":128},{"x":640,"y":0,"w":128,"h":128}]},"walk":{"label":"慢慢散步","fps":9,"loop":true,"durations":[110,110,110,110,110,110],"durationMs":660,"frames":[{"x":0,"y":128,"w":128,"h":128},{"x":128,"y":128,"w":128,"h":128},{"x":256,"y":128,"w":128,"h":128},{"x":384,"y":128,"w":128,"h":128},{"x":512,"y":128,"w":128,"h":128},{"x":640,"y":128,"w":128,"h":128}]},"run":{"label":"小步快跑","fps":12,"loop":true,"durations":[80,80,80,80,80,80],"durationMs":480,"frames":[{"x":0,"y":256,"w":128,"h":128},{"x":128,"y":256,"w":128,"h":128},{"x":256,"y":256,"w":128,"h":128},{"x":384,"y":256,"w":128,"h":128},{"x":512,"y":256,"w":128,"h":128},{"x":640,"y":256,"w":128,"h":128}]},"jump":{"label":"轻轻一跃","fps":9,"loop":false,"durations":[180,100,110,180,110,240],"durationMs":920,"frames":[{"x":0,"y":384,"w":128,"h":128},{"x":128,"y":384,"w":128,"h":128},{"x":256,"y":384,"w":128,"h":128},{"x":384,"y":384,"w":128,"h":128},{"x":512,"y":384,"w":128,"h":128},{"x":640,"y":384,"w":128,"h":128}]},"stretch":{"label":"伸个懒腰","fps":5,"loop":false,"durations":[350,200,400,600,200,350],"durationMs":2100,"frames":[{"x":0,"y":512,"w":128,"h":128},{"x":128,"y":512,"w":128,"h":128},{"x":256,"y":512,"w":128,"h":128},{"x":384,"y":512,"w":128,"h":128},{"x":512,"y":512,"w":128,"h":128},{"x":640,"y":512,"w":128,"h":128}]},"sleep":{"label":"打个小盹","fps":2,"loop":true,"durations":[700,500,400,700,500,400],"durationMs":3200,"frames":[{"x":0,"y":640,"w":128,"h":128},{"x":128,"y":640,"w":128,"h":128},{"x":256,"y":640,"w":128,"h":128},{"x":384,"y":640,"w":128,"h":128},{"x":512,"y":640,"w":128,"h":128},{"x":640,"y":640,"w":128,"h":128}]},"groom":{"label":"洗洗脸","fps":5,"loop":false,"durations":[350,180,200,250,200,350],"durationMs":1530,"frames":[{"x":0,"y":768,"w":128,"h":128},{"x":128,"y":768,"w":128,"h":128},{"x":256,"y":768,"w":128,"h":128},{"x":384,"y":768,"w":128,"h":128},{"x":512,"y":768,"w":128,"h":128},{"x":640,"y":768,"w":128,"h":128}]},"love":{"label":"喜欢摸摸","fps":6,"loop":false,"durations":[150,200,300,300,300,350],"durationMs":1600,"frames":[{"x":0,"y":896,"w":128,"h":128},{"x":128,"y":896,"w":128,"h":128},{"x":256,"y":896,"w":128,"h":128},{"x":384,"y":896,"w":128,"h":128},{"x":512,"y":896,"w":128,"h":128},{"x":640,"y":896,"w":128,"h":128}]}}};
  const CHICKEN_ATLAS = {"version":1,"image":"chicken-atlas.png","width":256,"height":192,"columns":4,"rows":3,"frameWidth":64,"frameHeight":64,"footX":32,"footY":56,"direction":"right","actions":{"idle":{"fps":2,"loop":true,"row":0,"frames":[{"x":0,"y":0,"w":64,"h":64},{"x":64,"y":0,"w":64,"h":64},{"x":128,"y":0,"w":64,"h":64},{"x":192,"y":0,"w":64,"h":64}]},"walk":{"fps":8,"loop":true,"row":1,"frames":[{"x":0,"y":64,"w":64,"h":64},{"x":64,"y":64,"w":64,"h":64},{"x":128,"y":64,"w":64,"h":64},{"x":192,"y":64,"w":64,"h":64}]},"peck":{"fps":5,"loop":true,"row":2,"frames":[{"x":0,"y":128,"w":64,"h":64},{"x":64,"y":128,"w":64,"h":64},{"x":128,"y":128,"w":64,"h":64},{"x":192,"y":128,"w":64,"h":64}]}},"source":{"width":1448,"height":1086,"gridCell":362,"processing":"Mechanical alpha-bounds crop, fixed-scale nearest-neighbor resizing, fixed foot baseline and cell packing; no artwork redrawn."},"verification":{"hasAlpha":true,"frameCount":12,"allFramesInsideCells":true,"bounds":[{"row":0,"col":0,"sourceBounds":{"left":78,"top":127,"width":205,"height":223},"destination":{"x":13,"y":16,"width":38,"height":41},"opaque":27898},{"row":0,"col":1,"sourceBounds":{"left":78,"top":127,"width":204,"height":223},"destination":{"x":13,"y":16,"width":37,"height":41},"opaque":27853},{"row":0,"col":2,"sourceBounds":{"left":95,"top":124,"width":191,"height":227},"destination":{"x":16,"y":15,"width":35,"height":42},"opaque":27849},{"row":0,"col":3,"sourceBounds":{"left":78,"top":127,"width":204,"height":223},"destination":{"x":13,"y":16,"width":37,"height":41},"opaque":27879},{"row":1,"col":0,"sourceBounds":{"left":79,"top":110,"width":213,"height":227},"destination":{"x":13,"y":15,"width":39,"height":42},"opaque":28181},{"row":1,"col":1,"sourceBounds":{"left":74,"top":117,"width":217,"height":220},"destination":{"x":12,"y":16,"width":40,"height":40},"opaque":28551},{"row":1,"col":2,"sourceBounds":{"left":79,"top":104,"width":212,"height":233},"destination":{"x":13,"y":14,"width":39,"height":43},"opaque":27835},{"row":1,"col":3,"sourceBounds":{"left":78,"top":121,"width":212,"height":216},"destination":{"x":13,"y":17,"width":39,"height":40},"opaque":28011},{"row":2,"col":0,"sourceBounds":{"left":72,"top":92,"width":227,"height":216},"destination":{"x":12,"y":17,"width":42,"height":40},"opaque":29218},{"row":2,"col":1,"sourceBounds":{"left":71,"top":116,"width":252,"height":192},"destination":{"x":12,"y":21,"width":46,"height":35},"opaque":30830},{"row":2,"col":2,"sourceBounds":{"left":77,"top":122,"width":236,"height":186},"destination":{"x":13,"y":22,"width":43,"height":34},"opaque":28207},{"row":2,"col":3,"sourceBounds":{"left":82,"top":82,"width":230,"height":226},"destination":{"x":14,"y":15,"width":42,"height":41},"opaque":29723}]}};
  const SCENE = {
    cat: [{ x: 880, y: 765 }, { x: 980, y: 655 }, { x: 1000, y: 580 }],
    chickens: [{ x: 487, y: 912 }, { x: 557, y: 925 }],
    eggs: [{ x: 490, y: 940 }, { x: 550, y: 960 }, { x: 610, y: 986 }],
    crops: [{ x: 658, y: 856 }, { x: 737, y: 896 }, { x: 796, y: 946 }],
    pond: { cx: 1220, cy: 850, rx: 185, ry: 80 },
    npcs: [
      { name: '报纸爷爷', color: '#668d9e', route: [{ x: 960, y: 338 }, { x: 1045, y: 365 }, { x: 1140, y: 335 }, { x: 1200, y: 310 }] },
      { name: '花店姑娘', color: '#bd6375', route: [{ x: 1100, y: 660 }, { x: 1010, y: 680 }] },
      { name: '菜园爷爷', color: '#8b9871', route: [{ x: 650, y: 768 }, { x: 840, y: 768 }] }
    ],
    chimneys: [{ x: 568, y: 80 }, { x: 888, y: 102 }, { x: 1442, y: 305 }, { x: 1185, y: 430 }, { x: 662, y: 555 }],
    lamps: [{ x: 633, y: 382 }, { x: 944, y: 425 }, { x: 866, y: 562 }, { x: 1412, y: 907 }]
  };
  // Hand-authored 16-pixel characters; each color cell is a crisp two-unit game pixel.
  const PEOPLE = [
    [
      '.....OOOOOO.....','....OHHhHHHO....','...OOHHHHHHOO...','...OHHHHHHHHO...',
      '....OSSSSSSO....','....OSOSOSSO....','....OsSSSSsO....','.....OSSSSO.....',
      '......OSSO......','....OOWWWOOO....','...OCcWWLCCCO...','..OSOCCCCcCOSO..',
      '..OSOCLCCcCOSO..','..OsOCWOCcCOsO..','...OOCWOCcCOO...','....OCWOCcCO....',
      '....OCCCCccO....','....OCCCCccO....','....OBBBBBBO....','....OTTOOTTO....',
      '....OTTOOTTO....','....OTtOOTtO....','....OTtOOTtO....','....OBBOOBBO....',
      '...OBBBOOBBBO...','...OOOOOOOOOO...'
    ],
    [
      '.....OOOOOO.....','....OHHhHHHO....','...OHhHHHHHHO...','...OHhHHHHHHO...',
      '...OHHSSSSHHO...','...OHSOSOSHHO...','...OHsSSSshHO...','...OHOSSSOhHO...',
      '...OHWOSSOWhO...','....OCLWWLCO....','...OCCLWWLCCO...','..OSOCLWWLCOSO..',
      '..OSOCWCCWCOSO..','..OsOCWWWWCOsO..','...OOCWWWWCOO...','....OCWWWWCO....',
      '...OCCWLLWCCO...','...OCCWLLWCCO...','...OCCWWWWCcO...','...OCCCCCCCCO...',
      '....OSSOOSSO....','....OSSOOSSO....','....OsSOOSsO....','....OBBOOBBO....',
      '...OBBBOOBBBO...','...OOOOOOOOOO...'
    ],
    [
      '.....OOOOOO.....','....OKKKkKKO....','....OKKKkKKO....','..OOKKKKKKKKOO..',
      '..OOOOOOOOOOOO..','....OHHSSSHO....','....OHSOSOHO....','....OsSSSSsO....',
      '.....OHhHHO.....','......OHHOO.....','....OOCWWCOO....','...OCCLWWLCCO...',
      '..OSOCCCCCCOSO..','..OSOCWCWCCOSO..','..OsOCWCWCCOsO..','...OOCCcCCCOO...',
      '....OCCcCCCO....','....OCCcCCCO....','....OBBBBBBO....','....OTTOOTTO....',
      '....OTTOOTTO....','....OTtOOTtO....','....OTtOOTtO....','....OBBOOBBO....',
      '...OBBBOOBBBO...','...OOOOOOOOOO...'
    ]
  ];
  function mount(doc) {
    const world = doc.getElementById('town-world'), canvas = doc.getElementById('town-canvas');
    if (!world || !canvas || world.dataset.townReady) return;
    world.dataset.townReady = 'true';
    const displayCtx = canvas.getContext('2d');
    let ctx = displayCtx;
    if (!ctx) return;
    canvas.width = WIDTH; canvas.height = HEIGHT; ctx.imageSmoothingEnabled = false;
    const actorCanvas = doc.createElement('canvas'), actorCtx = actorCanvas.getContext?.('2d');
    actorCanvas.width = WIDTH; actorCanvas.height = HEIGHT;
    if (actorCtx) actorCtx.imageSmoothingEnabled = false;
    const ambientFilter = actorCtx ? makeAmbientFilter(doc) : null;
    world.dataset.townActorTint = actorCtx ? ambientFilter ? 'matrix' : 'fallback' : 'unavailable';
    let scene = SCENE;
    try {
      const custom = JSON.parse(doc.getElementById('town-scene-config')?.textContent || 'null');
      if (custom && typeof custom === 'object') scene = { ...SCENE, ...custom };
    } catch (_) { /* Shipped scene positions remain usable. */ }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let storageOK = true;
    function read(key) { try { return localStorage.getItem(key); } catch (_) { storageOK = false; return null; } }
    function write(key, value) { try { localStorage.setItem(key, value); } catch (_) { storageOK = false; } }
    let saved = null;
    try { saved = JSON.parse(read(STORE)); } catch (_) { /* Treat malformed optional state as empty. */ }
    let clock = clockParts(), daily = dailyState(saved, clock.key), light = lighting(clock.hour);
    let environment = null, weatherClient = null, weatherState = null, backgroundTarget = '', backgroundGeneration = 0;
    let explicitMode = read(MODE), mode = ['full', 'gentle', 'still'].includes(explicitMode) ? explicitMode : reduced.matches ? 'still' : 'full';
    let elapsed = 0, catPathElapsed = 0, last = 0, raf = 0, visible = true, frame = 0, lastFrame = 0, scale = 1, scrollPositionInitialized = false;
    const npcPathElapsed = scene.npcs.map((_, i) => i * 7000);
    let speech = null, speechOwner = null, speechIndex = 0, toastTimer = 0, catCycle = 0, catAction = '', catSince = 0, catUntil = 0, chickenUntil = 0, duckUntil = 0;
    let autoTime = 0, nextAutoAt = 8000, speechUntil = 0, lastAutoTick = performance.now();
    const autoSlots = [{ actor: 0, topic: 'news', gap: 8000 }, { actor: 1, topic: 'weather', gap: 1000 }, { actor: 2, topic: 'weather', gap: 12000 }, { actor: 1, topic: 'almanac', gap: 1000 }, { actor: 2, topic: 'almanac', gap: 18000 }];
    let autoCursor = 0, autoExchange = null, dialogueRequest = null, dialogueAttempts = 0, autoVariant = 0, speechGap = 8000;
    const manualTopics = scene.npcs.map(() => 0);
    function loadDialogue() {
      if (window.TownDialogueV1?.getExchange) return Promise.resolve(window.TownDialogueV1);
      if (dialogueRequest) return dialogueRequest;
      if (dialogueAttempts >= 2) return Promise.resolve(null);
      dialogueAttempts++;
      dialogueRequest = new Promise(resolve => {
        const script = doc.createElement('script'); let done = false;
        const finish = () => { if (done) return; done = true; window.clearTimeout(timeout); script.onload = script.onerror = null; resolve(window.TownDialogueV1 || null); };
        const timeout = window.setTimeout(() => { script.remove(); finish(); }, 10000);
        script.src = '/static/town-dialogue-v1.js?v=20261023-1'; script.async = true; script.onload = finish; script.onerror = () => { script.remove(); finish(); };
        doc.head.appendChild(script);
      }).finally(() => { dialogueRequest = null; });
      return dialogueRequest;
    }
    function cancelExchange() {
      autoExchange = null;
      if (autoSlots[autoCursor].actor === 2) autoCursor = (autoCursor + 1) % autoSlots.length;
    }
    const hotspots = [], images = {}, actors = {}, particles = [];
    const stage = doc.getElementById('town-stage') || world;
    const hotspotLayer = doc.getElementById('town-hotspots') || world;
    const seasonToggle = doc.getElementById('town-season-toggle'), climatePanel = doc.getElementById('town-climate-panel');
    const toast = doc.getElementById('town-toast') || (() => { const el = doc.createElement('div'); el.id = 'town-toast'; el.className = 'town-toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); stage.appendChild(el); return el; })();
    const chatter = [
      '早一点、晚一点，都欢迎你回家。',
      '池塘里的小鸭子今天又绕了好多圈。点点它，看看水花。',
      '鸡舍和菜园每天都能收一点小礼物，记得带上你的小篮子。',
      '夜里灯亮了，小镇也会慢慢安静下来。',
      '别着急，先和猫咪打个招呼吧。',
      '这里的小收获只放在这台设备里，明天又是新的一天。'
    ];
    let newsPayload = (() => { try { return JSON.parse(doc.getElementById('town-news-data')?.textContent || 'null'); } catch (_) { return null; } })();
    let newsRequest = null, newsAbort = null, newsGeneration = 0, lastNewsURL = '';
    const NEWS_CACHE = 'login-town-v8:news', NEWS_RSS = 'https://www.chinanews.com.cn/rss/scroll-news.xml';
    async function loadNews() {
      if (doc.documentElement.dataset.demo === 'true') return []; // Offline demo never fetches news feeds.
      const now = Date.now(), today = clockParts().key;
      let cached = newsPayload;
      try { cached = JSON.parse(sessionStorage.getItem(NEWS_CACHE)) || cached; } catch (_) { /* Cache is optional. */ }
      if (cached && now - cached.fetchedAt >= 0 && now - cached.fetchedAt < 1800000 && validNews(cached, today, now).length) return validNews(cached, today, now);
      if (newsRequest) return newsRequest;
      newsAbort = new AbortController();
      const timeout = window.setTimeout(() => newsAbort?.abort(), 4000);
      newsRequest = (async () => {
        const response = await fetch(NEWS_RSS, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: newsAbort.signal });
        if (!response.ok) throw new Error('News unavailable');
        const xml = await response.text();
        if (xml.length > 1048576) throw new Error('News feed too large');
        const parsed = new DOMParser().parseFromString(xml, 'application/xml');
        if (parsed.querySelector('parsererror')) throw new Error('Invalid news feed');
        const items = Array.from(parsed.querySelectorAll('item')).map(item => ({
          title: (item.querySelector('title')?.textContent || '').trim(),
          url: (item.querySelector('link')?.textContent || '').trim(),
          publishedAt: (item.querySelector('pubDate')?.textContent || '').trim(), source: '中新网'
        }));
        const current = Date.now(), currentDay = clockParts().key;
        newsPayload = { date: currentDay, fetchedAt: current, items: validNews({ date: currentDay, items }, currentDay, current) };
        try { sessionStorage.setItem(NEWS_CACHE, JSON.stringify(newsPayload)); } catch (_) { /* Public feed cache is optional. */ }
        return newsPayload.items;
      })().finally(() => { window.clearTimeout(timeout); newsRequest = null; newsAbort = null; });
      return newsRequest;
    }

    function announce(text) {
      toast.hidden = false; toast.textContent = text; toast.classList.add('is-visible');
      window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { toast.classList.remove('is-visible'); toast.hidden = true; }, 4200);
    }
    function closeSpeech(focus = false, reason = 'dismiss') {
      if (!speech) return;
      newsGeneration++;
      const owner = speechOwner, hadFocus = speech.contains(doc.activeElement), automatic = speech.dataset.automatic === 'true';
      const gap = automatic && reason === 'auto' ? Number(speech.dataset.pauseAfter) : 30000;
      if (reason !== 'auto' && reason !== 'replace') cancelExchange();
      speech.remove(); speech = null; speechOwner = null; speechUntil = 0; nextAutoAt = autoTime + gap;
      if (focus && owner && (!automatic || hadFocus)) owner.focus({ preventScroll: true });
    }
    function speak(button, name, text, news, automatic = false, details = null) {
      const keepFocus = speechOwner === button && speech?.contains(doc.activeElement);
      closeSpeech(false, 'replace'); speechOwner = button;
      const box = doc.createElement('div'); box.className = 'town-speech'; box.dataset.automatic = String(automatic);
      box.dataset.actor = button.dataset.townActor; box.dataset.topic = details?.topic || (button.dataset.townActor === 'npc-0' ? 'news' : 'chatter');
      box.dataset.pauseAfter = String(speechGap);
      if (details?.dateKey) box.dataset.dialogueDate = details.dateKey;
      box.setAttribute('role', automatic ? 'status' : 'dialog'); box.setAttribute('aria-label', `${name}说`);
      if (automatic) { box.setAttribute('aria-live', 'polite'); speechUntil = autoTime + (details?.topic === 'almanac' ? 14000 : 12000); }
      const header = doc.createElement('strong'); header.textContent = news ? '今日见闻 · 中新网' : details ? `${name} · ${details.topic === 'almanac' ? '今日黄历' : '聊天气'}` : `${name} · 小镇闲聊`;
      if (news) { const published = clockParts(new Date(news.publishedAt)); box.dataset.newsDate = published.key; box.dataset.newsDateLabel = published.date; }
      const p = doc.createElement('p'); p.textContent = text;
      const close = doc.createElement('button'); close.type = 'button'; close.className = 'town-speech-close'; close.textContent = '知道啦'; close.addEventListener('click', () => closeSpeech(true));
      box.append(header, p);
      if (details?.note) { const note = doc.createElement('small'); note.className = 'town-speech-note'; note.textContent = details.note; box.appendChild(note); }
      if (details?.sourceURL && ['https://open-meteo.com/', 'https://github.com/6tail/lunar-javascript', 'https://6tail.cn/calendar/'].includes(details.sourceURL)) {
        const source = doc.createElement('a'); source.href = details.sourceURL; source.textContent = details.topic === 'almanac' ? '黄历来源' : '天气来源'; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.referrerPolicy = 'no-referrer'; box.appendChild(source);
      }
      if (news) { const a = doc.createElement('a'); a.href = news.url; a.textContent = `查看原文 · ${clockParts(new Date(news.publishedAt)).time}`; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer'; box.appendChild(a); }
      box.appendChild(close); speech = box; doc.body.appendChild(box); positionSpeech();
      if (!automatic || keepFocus) close.focus({ preventScroll: true });
    }
    function positionSpeech() {
      if (!speech || !speechOwner) return;
      const p = speechOwner._townPoint;
      const worldRect = world.getBoundingClientRect(), stageRect = stage.getBoundingClientRect();
      const bounds = { left: Math.max(0, stageRect.left) + 12, right: Math.min(innerWidth, stageRect.right) - 12,
        top: Math.max(0, stageRect.top) + 12, bottom: Math.min(innerHeight, stageRect.bottom) - 12 };
      const x = worldRect.left + p.x * scale, y = worldRect.top + (p.y - 55) * scale;
      const offscreen = bounds.right <= bounds.left || bounds.bottom <= bounds.top || x < bounds.left - 24 || x > bounds.right + 24 || y > innerHeight || y + 55 * scale < 0;
      speech.style.visibility = offscreen ? 'hidden' : 'visible';
      if (offscreen) return;
      speech.style.maxWidth = `${Math.max(100, bounds.right - bounds.left)}px`;
      const box = speech.getBoundingClientRect(), w = box.width, h = box.height;
      const obstacles = Array.from(doc.querySelectorAll('.town-time-hud,.town-panel,.town-footer,.town-inventory,.town-climate-panel:not([hidden])'))
        .map(el => el.getBoundingClientRect()).filter(r => r.width && r.height);
      obstacles.push(speechOwner.getBoundingClientRect());
      const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right + 8) - Math.max(a.left, b.left - 8)) * Math.max(0, Math.min(a.bottom, b.bottom + 8) - Math.max(a.top, b.top - 8));
      const candidates = [[x - w / 2, y - h - 12], [x - w / 2, y + 55 * scale + 12], [x + 28, y - h / 2], [x - w - 28, y - h / 2]];
      for (const r of obstacles) candidates.push([r.right + 12, y - h - 12], [r.left - w - 12, y - h - 12], [x - w / 2, r.bottom + 12]);
      const xs = [x - w / 2, ...obstacles.flatMap(r => [r.right + 12, r.left - w - 12])];
      const ys = [y - h - 12, worldRect.top + p.y * scale + 20];
      for (const left of xs) for (const top of ys) candidates.push([left, top]);
      const choices = candidates.map(([left, top], index) => {
        left = clamp(left, bounds.left, Math.max(bounds.left, bounds.right - w));
        top = clamp(top, bounds.top, Math.max(bounds.top, bounds.bottom - h));
        const rect = { left, top, right: left + w, bottom: top + h };
        const penalty = obstacles.reduce((sum, obstacle) => sum + overlap(rect, obstacle), 0);
        return { left, top, score: penalty * 100000 + Math.hypot(left + w / 2 - x, top + h - y) + index };
      }).sort((a, b) => a.score - b.score);
      const best = choices[0];
      speech.style.left = `${best.left}px`; speech.style.top = `${best.top}px`;
      speech.dataset.side = best.top >= y ? 'below' : best.top + h <= y ? 'above' : best.left > x ? 'right' : 'left';
      speech.style.setProperty('--speech-tail-left', `${clamp(x - best.left, 20, w - 25)}px`);
      speech.style.setProperty('--speech-tail-top', `${clamp(y - best.top, 20, h - 25)}px`);
    }
    doc.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (climatePanel && !climatePanel.hidden) { event.preventDefault(); setClimatePanel(false, true); }
      else if (speech) { event.preventDefault(); closeSpeech(true); }
    });
    function hotspot(id, name, point, click) {
      const b = doc.createElement('button'); b.type = 'button'; b.className = 'town-hotspot'; b.dataset.townActor = id; b.setAttribute('aria-label', name); b.title = name;
      const label = doc.createElement('span'); label.className = 'town-hotspot-label'; label.textContent = name; b.appendChild(label);
      b.addEventListener('click', () => click(b)); b._townPoint = point;
      hotspotLayer.appendChild(b); hotspots.push(b); positionButton(b); return b;
    }
    function positionButton(b) {
      const size = Math.max(48 * scale, 44), p = b._townPoint;
      b.style.left = `${p.x / WIDTH * 100}%`; b.style.top = `${(p.y - 18) / HEIGHT * 100}%`; b.style.width = `${size}px`; b.style.height = `${size}px`;
      b.style.setProperty('--town-ui-scale', '1');
    }
    function resize() {
      scale = Math.max(.1, world.getBoundingClientRect().width / WIDTH);
      if (!scrollPositionInitialized) {
        const viewportWidth = stage.clientWidth || stage.getBoundingClientRect().width;
        if (stage.scrollWidth > viewportWidth + 1) stage.scrollLeft = Math.min(350, stage.scrollWidth - viewportWidth);
        scrollPositionInitialized = true;
      }
      hotspots.forEach(positionButton); positionSpeech(); draw();
    }
    function updateBasket() {
      const eggs = daily.collected.filter(x => x.startsWith('egg')).length, crops = daily.collected.filter(x => x.startsWith('crop')).length;
      const eggCount = doc.getElementById('town-eggs'), cropCount = doc.getElementById('town-crops');
      if (eggCount) eggCount.textContent = `${eggs}/3`;
      if (cropCount) cropCount.textContent = `${crops}/3`;
      const basket = doc.getElementById('town-basket');
      if (basket) basket.setAttribute('aria-label', `今日小篮子，鸡蛋 ${eggs}/3，蔬菜 ${crops}/3。点击查看收获说明`);
      for (const b of hotspots) {
        const taken = daily.collected.includes(b.dataset.townActor);
        if (/^(egg|crop)-/.test(b.dataset.townActor)) {
          b.dataset.collected = String(taken); b.setAttribute('aria-disabled', String(taken));
          const type = b.dataset.townActor.startsWith('egg') ? '鸡蛋' : '蔬菜';
          b.setAttribute('aria-label', taken ? `${type}已收好，明天再来` : `收集${type}`);
        }
      }
    }
    function collect(id, b) {
      const freshClock = clockParts();
      let persisted;
      try { persisted = JSON.parse(read(STORE)); } catch (_) { persisted = null; }
      // Merge tabs for this date while retaining memory-only collection if storage is unavailable.
      const other = dailyState(persisted, freshClock.key), current = dailyState(daily, freshClock.key);
      const merged = { date: freshClock.key, collected: [...new Set(current.collected.concat(other.collected))] };
      const result = collectItem(merged, freshClock.key, id); daily = result.state;
      if (!result.added) { announce('这个已经收好啦，明天再来。'); updateBasket(); return; }
      write(STORE, JSON.stringify(daily)); updateBasket();
      const type = id.startsWith('egg') ? '鸡蛋' : '蔬菜';
      announce(`收好一份${type}！${daily.collected.length === 6 ? '今天的小篮子装满啦，明天再来。' : `今日收获 ${daily.collected.length}/6。`}${storageOK ? '' : '本次仅临时记住。'}`);
      if (mode !== 'still') particles.push({ ...b._townPoint, since: elapsed, kind: id.startsWith('egg') ? 'egg' : 'leaf' });
      draw();
    }
    const catButton = hotspot('cat', '和小猫打招呼', scene.cat[0], () => {
      const actions = ['love', 'jump', 'stretch']; catAction = actions[catCycle++ % actions.length]; catSince = elapsed; catUntil = elapsed + 2400;
      announce(mode === 'still' ? '喵～小猫收到了你的问候。' : ['喵～小猫蹭了蹭你的手。', '小猫开心地跳了起来。', '小猫伸了个长长的懒腰。'][(catCycle - 1) % 3]); draw();
    });
    const chickenButtons = scene.chickens.map((p, i) => hotspot(`chicken-${i}`, '和小鸡打招呼', p, () => { chickenUntil = elapsed + 1600; announce('咯咯哒～鸡舍旁边有今天的鸡蛋。'); draw(); }));
    const duckButton = hotspot('duck', '和池塘的小鸭子打招呼', { x: scene.pond.cx, y: scene.pond.cy }, () => { duckUntil = elapsed + 2400; announce('嘎嘎！小鸭子划出一圈圈水花。'); draw(); });
    scene.eggs.forEach((p, i) => hotspot(`egg-${i}`, '收集鸡蛋', p, b => collect(`egg-${i}`, b)));
    scene.crops.forEach((p, i) => hotspot(`crop-${i}`, '收集蔬菜', p, b => collect(`crop-${i}`, b)));
    function residentTurn(topic, i, exchange = null) {
      const dateKey = clockParts().key, now = Date.now();
      const weather = exchange?.weather || weatherClient?.getState() || weatherState;
      try {
        const turns = window.TownDialogueV1?.getExchange(topic, { dateKey, weather, now, variant: exchange?.variant ?? manualTopics[i] });
        const turn = turns?.find(item => item.actor === i);
        if (turn && typeof turn.text === 'string' && turn.dateKey === dateKey) return turn;
      } catch (_) { /* Optional dialogue must never block login or the scene. */ }
      loadDialogue();
      return { actor: i, topic, dateKey, text: topic === 'weather' ? '今天的天气还没读到，等更新好了再聊，先别急着出门。' : '今天这页黄历还没读到，等会儿再翻给你看。', note: topic === 'almanac' ? '黄历暂不可用 · 民俗参考' : '天气暂不可用' };
    }
    function talkToNPC(b, npc, i, automatic = false, topic = null) {
      if (!automatic) cancelExchange();
      const line = chatter[(speechIndex++ + i + Number(clock.key.slice(-2))) % chatter.length];
      if (i !== 0) {
        const chosen = topic || (manualTopics[i]++ % 2 ? 'almanac' : 'weather');
        const turn = residentTurn(chosen, i, automatic ? autoExchange : null);
        speak(b, npc.name, turn.text, null, automatic, turn); draw(); return;
      }
      speak(b, npc.name, '我去翻翻今天的报纸，请稍等。', null, automatic);
      const generation = ++newsGeneration;
      if (speech) speech.setAttribute('aria-busy', 'true');
      loadNews().then(items => {
        if (generation !== newsGeneration || speechOwner !== b) return;
        const choices = items.filter(item => item.url !== lastNewsURL), pool = choices.length ? choices : items;
        const item = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
        if (item) { lastNewsURL = item.url; speak(b, npc.name, item.title, item, automatic); }
        else speak(b, npc.name, `今天的报纸还没送到，先聊点小镇日常吧。${line}`, null, automatic);
      }).catch(() => {
        if (generation === newsGeneration && speechOwner === b) speak(b, npc.name, `这会儿没取到今天的报纸，先聊点小镇日常吧。${line}`, null, automatic);
      });
      draw();
    }
    const npcButtons = scene.npcs.map((npc, i) => hotspot(`npc-${i}`, i === 0 ? '听报纸爷爷读今天的新闻' : `和${npc.name}聊聊`, npc.route[0], b => talkToNPC(b, npc, i)));
    function npcInView(i) {
      const b = npcButtons[i]; if (!b) return false;
      const r = b.getBoundingClientRect(), s = stage.getBoundingClientRect();
      return r.right >= Math.max(0, s.left) && r.left <= Math.min(innerWidth, s.right) && r.bottom >= Math.max(0, s.top) && r.top <= Math.min(innerHeight, s.bottom);
    }
    function automaticSpeech() {
      const now = performance.now(), delta = Math.max(0, Math.min(1000, now - lastAutoTick)); lastAutoTick = now;
      const today = clockParts().key;
      if (speech?.dataset.dialogueDate && speech.dataset.dialogueDate !== today) closeSpeech(speech.contains(doc.activeElement));
      if (autoExchange?.dateKey !== today) autoExchange = null;
      if (doc.hidden || !visible || mode === 'still' || (climatePanel && !climatePanel.hidden) || doc.activeElement?.matches('input,textarea,select,[contenteditable="true"]')) {
        if (speech?.dataset.automatic === 'true') closeSpeech();
        cancelExchange();
        return;
      }
      autoTime += delta;
      if (speech) {
        if (speech.dataset.automatic === 'true' && autoTime >= speechUntil && !speech.matches(':hover') && !speech.contains(doc.activeElement)) closeSpeech(false, 'auto');
        return;
      }
      if (autoTime < nextAutoAt || doc.activeElement?.matches('input,textarea,select,[contenteditable="true"]')) return;
      for (let attempt = 0; attempt < autoSlots.length; attempt++) {
        const slot = autoSlots[autoCursor]; autoCursor = (autoCursor + 1) % autoSlots.length;
        if (!npcInView(slot.actor)) { autoExchange = null; continue; }
        if (slot.actor === 1 || (slot.actor === 2 && (!autoExchange || autoExchange.topic !== slot.topic))) {
          autoExchange = { topic: slot.topic, dateKey: today, weather: weatherClient?.getState() || weatherState, variant: autoVariant++ };
        }
        speechGap = slot.gap;
        talkToNPC(npcButtons[slot.actor], scene.npcs[slot.actor], slot.actor, true, slot.topic);
        return;
      }
    }
    function refreshClock() {
      const next = clockParts();
      if (next.key !== clock.key) {
        let persisted = null; try { persisted = JSON.parse(read(STORE)); } catch (_) { /* Optional state. */ }
        const current = dailyState(daily, next.key), other = dailyState(persisted, next.key);
        daily = { date: next.key, collected: [...new Set(current.collected.concat(other.collected))] };
        write(STORE, JSON.stringify(daily)); updateBasket();
      }
      clock = next;
      // Only fresh, same-day weather may drive the real sunrise/sunset lighting.
      if (weatherClient) weatherState = weatherClient.getState();
      const activeWeather = weatherState && ['fresh', 'cached'].includes(weatherState.status);
      const sunHours = activeWeather ? (weatherState.sunHours?.date === clock.key ? weatherState.sunHours : weatherState.sunDays?.find(day => day.date === clock.key)?.sunHours) : null;
      light = lighting(clock.hour, sunHours);
      if (environment) { environment.updateTime(clock); environment.setWeather(weatherState); }
      renderWeather(weatherState);
      if (speech?.dataset.newsDate && speech.dataset.newsDate !== clock.key) speech.firstElementChild.textContent = `${speech.dataset.newsDateLabel}见闻 · 中新网`;
      const text = { 'town-clock': clock.time, 'town-period': light.label, 'town-date': clock.date };
      for (const [id, value] of Object.entries(text)) { const el = doc.getElementById(id); if (el) el.textContent = value; }
      doc.body.style.setProperty('--town-night', light.night.toFixed(3)); doc.body.style.setProperty('--town-dusk', light.dusk.toFixed(3)); doc.body.dataset.townPeriod = light.label;
      draw();
    }
    function setMode(next, save = true) {
      if (!['full', 'gentle', 'still'].includes(next)) return;
      mode = next; doc.body.dataset.townMotion = mode;
      if (save) { explicitMode = mode; write(MODE, mode); }
      doc.querySelectorAll('[data-town-motion]').forEach(button => { if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', String(button.dataset.townMotion === mode)); });
      reconcile(); draw();
    }
    doc.querySelectorAll('button[data-town-motion]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.townMotion)));
    doc.getElementById('town-basket')?.addEventListener('click', () => {
      announce(`今天的小篮子：鸡蛋 ${daily.collected.filter(x => x.startsWith('egg')).length}/3，蔬菜 ${daily.collected.filter(x => x.startsWith('crop')).length}/3。点击鸡舍旁的鸡蛋、菜园里的蔬菜收集；每天零点更新。${storageOK ? '收获只保存在这台设备。' : '当前浏览器无法保存，收获仅在本次页面停留期间保留。'}`);
    });
    const eye = doc.getElementById('town-password-toggle'), password = doc.getElementById('password');
    eye?.addEventListener('click', () => {
      if (!password) return;
      const show = password.type === 'password'; password.type = show ? 'text' : 'password';
      eye.setAttribute('aria-pressed', String(show)); eye.setAttribute('aria-label', show ? '隐藏口令' : '显示口令');
      eye.textContent = show ? '隐藏' : '显示'; password.focus({ preventScroll: true });
    });
    reduced.addEventListener?.('change', () => { if (!['full', 'gentle', 'still'].includes(explicitMode)) setMode(reduced.matches ? 'still' : 'full', false); });
    function rect(x, y, w, h, color, alpha = 1) { ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); ctx.globalAlpha = 1; }
    function sprite(img, atlas, actionName, time, p, size, direction = 1) {
      if (!img || !img.complete || !img.naturalWidth) return false;
      const action = atlas.actions[actionName] || atlas.actions.idle;
      const durations = action.durations || action.frames.map(() => 1000 / (action.fps || 6)), total = durations.reduce((a, b) => a + b, 0);
      let cursor = action.loop === false ? Math.min(time, total - 1) : time % total, index = 0;
      while (index < durations.length - 1 && cursor >= durations[index]) { cursor -= durations[index]; index++; }
      const f = action.frames[index];
      ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.scale(direction, 1);
      ctx.drawImage(img, f.x, f.y, f.w, f.h, -size / 2, -size * .875, size, size); ctx.restore(); return true;
    }
    function drawEgg(p, taken) {
      if (taken) { rect(p.x - 8, p.y - 3, 16, 5, '#a88b55', .28); return; }
      rect(p.x - 8, p.y - 13, 16, 13, '#71543d'); rect(p.x - 5, p.y - 19, 10, 6, '#71543d');
      rect(p.x - 6, p.y - 12, 12, 10, '#fff3ca'); rect(p.x - 3, p.y - 17, 6, 7, '#fff9e4'); rect(p.x + 3, p.y - 7, 3, 5, '#e4c68c');
      if (mode !== 'still') rect(p.x + 12, p.y - 24 + Math.round(Math.sin(elapsed / 500) * 2), 3, 3, '#fff8c1', .85);
    }
    function drawCrop(p, taken, index) {
      rect(p.x - 12, p.y - 4, 24, 5, '#785837', .45);
      if (taken) { rect(p.x - 2, p.y - 7, 4, 4, '#7e9e42'); return; }
      const leaf = index === 1 ? '#d09245' : index === 2 ? '#aabc5a' : '#6f9c3f';
      rect(p.x - 10, p.y - 19, 20, 15, '#455b2e'); rect(p.x - 7, p.y - 23, 14, 21, leaf);
      rect(p.x - 12, p.y - 16, 24, 9, leaf); rect(p.x - 5, p.y - 19, 4, 11, '#c7d77d');
      rect(p.x - 3, p.y - 31, 5, 9, '#4b772e'); rect(p.x - 9, p.y - 28, 7, 4, '#77a047'); rect(p.x + 3, p.y - 29, 7, 4, '#79a94c');
    }
    function drawNPC(p, npc, i) {
      const rows = PEOPLE[i % PEOPLE.length], walking = p.walking && mode !== 'still';
      const stride = walking ? Math.floor(elapsed / 230) % 4 : 0, bob = walking && stride % 2 ? 1 : 0;
      const palette = { O:'#49352a', H:i === 2 ? '#b6b6a0' : i === 1 ? '#9b4d32' : '#70432c', h:i === 2 ? '#e0dfc8' : i === 1 ? '#d07743' : '#a26a3b', S:'#f1c18d', s:'#cf9467', C:npc.color, c:i === 1 ? '#9b4b59' : i === 2 ? '#637251' : '#3e6e84', L:i === 1 ? '#dda495' : i === 2 ? '#afbd8b' : '#92bec6', W:'#f6e3ae', B:'#835530', T:'#696849', t:'#4f513d', K:'#c8a359', k:'#edce84' };
      rect(p.x - 12, p.y - 2, 25, 5, '#364b36', .22);
      rows.forEach((row, sy) => [...row].forEach((pixel, sx) => {
        if (!palette[pixel]) return;
        let leg = 0;
        if (walking && sy >= 20) leg = (sx < 8 ? 1 : -1) * (stride === 1 ? 1 : stride === 3 ? -1 : 0);
        rect(p.x + (sx - 8) * 2, p.y + (sy - rows.length) * 2 - bob + leg, 2, 2, palette[pixel]);
      }));
      if (i === 0) { // Folded newspaper and ink lines identify the newsboy at a glance.
        rect(p.x + 8, p.y - 27, 10, 16, '#4f4738'); rect(p.x + 10, p.y - 25, 6, 12, '#f8eac5');
        rect(p.x + 11, p.y - 23, 4, 2, '#72908a'); rect(p.x + 11, p.y - 19, 3, 1, '#a39474'); rect(p.x + 11, p.y - 16, 4, 1, '#a39474');
      }
    }
    function drawDuck(p, active, index) {
      const unit = 2, y = p.y + (mode === 'still' ? 0 : Math.sin(elapsed / 700 + index) * 1.5);
      const r = (sx, sy, w, h, c, a = 1) => rect(p.x + (p.direction < 0 ? -sx - w : sx) * unit, y + sy * unit, w * unit, h * unit, c, a);
      r(-14, 3, 26, 1, '#d3efdc', .7); r(-10, 5, 19, 1, '#a9dedb', .65);
      r(-10, -5, 17, 8, '#65503b'); r(-9, -7, 13, 9, '#65503b'); r(0, -12, 8, 10, '#65503b'); r(2, -15, 5, 3, '#65503b');
      r(-10, -7, 3, 2, '#65503b'); r(-9, -6, 3, 3, '#fff4ce'); r(-8, -5, 12, 7, '#fff2c9');
      r(1, -11, 6, 9, '#fff5d5'); r(2, -14, 4, 4, '#fff8e1'); r(6, -10, 1, 1, '#3c3429');
      r(7, -9, 5, 3, '#8f6131'); r(7, -8, 4, 1, '#f5b850'); r(7, -7, 3, 1, '#db9839');
      r(-7, -4, 7, 4, '#d8c592'); r(-6, -5, 6, 2, '#efe0b4'); r(-5, -3, 5, 1, '#c8b581'); r(-6, 1, 9, 1, '#bca47c');
      if (active) {
        const pulse = (elapsed % 900) / 900;
        ctx.strokeStyle = '#e6f7db'; ctx.globalAlpha = 1 - pulse; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 5, 28 + pulse * 20, 9 + pulse * 8, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    function drawSmoke() {
      scene.chimneys.forEach((p, index) => {
        for (let i = 0; i < 4; i++) {
          const age = ((elapsed + i * 1050 + index * 370) % 4200) / 4200;
          const x = p.x + Math.round(Math.sin(age * 3) * 12), y = p.y - age * 58;
          rect(x - 6, y, 13, 7, '#f1efe0', (1 - age) * .7); rect(x - 3, y - 4, 9, 4, '#f9f5e5', (1 - age) * .7);
        }
      });
    }
    function drawWater() {
      // Small highlights stay within the water already painted in the scene.
      const clock = elapsed / 1000;
      for (let i = 0; i < 7; i++) {
        const x = 99 + i % 3 * 12, y = 22 + ((clock * 22 + i * 17) % 79);
        rect(x, y, i % 2 ? 3 : 5, 7 + i % 3 * 2, '#d5f5f3', .22);
        rect(x + 2, y + 4, 2, 6, '#f7fff5', .2);
      }
      const pond = scene.pond;
      for (let i = 0; i < 12; i++) {
        const angle = i * 2.4, radius = .22 + (i % 4) * .14;
        const x = pond.cx + Math.cos(angle) * pond.rx * radius + Math.sin(clock * .5 + i) * 3;
        const y = pond.cy + Math.sin(angle) * pond.ry * radius;
        const alpha = .09 + (Math.sin(clock * 1.2 + i) + 1) * .045;
        rect(x, y, 9 + i % 3 * 5, 2, '#ddf6e6', alpha); rect(x + 5, y + 3, 5, 1, '#f0f9df', alpha * .6);
      }
    }
    function drawLamps() {
      scene.lamps.forEach(p => {
        if (light.night > .05 || light.dusk > .3) {
          const alpha = clamp(light.night + light.dusk * .6, 0, 1);
          const gradient = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 44); gradient.addColorStop(0, `rgba(255,216,116,${alpha * .35})`); gradient.addColorStop(1, 'rgba(255,216,116,0)'); ctx.fillStyle = gradient; ctx.fillRect(p.x - 44, p.y - 44, 88, 88); rect(p.x - 3, p.y - 3, 6, 6, '#ffe9a3', alpha);
        }
      });
    }
    function drawActors() {
      drawWater(); drawSmoke();
      const catPos = routePoint(scene.cat, catPathElapsed / 1000, 13), actionActive = elapsed < catUntil;
      actors.cat = actionActive && actors.cat ? actors.cat : catPos;
      const catP = actors.cat;
      const action = actionActive ? catAction : catPos.walking ? 'walk' : light.night > .8 ? 'sleep' : 'idle';
      sprite(images.cat, CAT_ATLAS, action, actionActive ? elapsed - catSince : elapsed, catP, 48, catP.direction);
      catButton._townPoint = catP; positionButton(catButton);
      scene.chickens.forEach((p, i) => {
        const walk = Math.sin(elapsed / 5300 + i) * 12;
        const hop = elapsed < chickenUntil && mode !== 'still' ? Math.abs(Math.sin(elapsed / 130)) * 9 : 0;
        const point = { x: p.x + walk, y: p.y - hop };
        sprite(images.chicken, CHICKEN_ATLAS, elapsed < chickenUntil ? 'walk' : 'peck', elapsed + i * 300, point, 45, Math.cos(elapsed / 5300 + i) < 0 ? -1 : 1);
        chickenButtons[i]._townPoint = point; positionButton(chickenButtons[i]);
      });
      scene.eggs.forEach((p, i) => drawEgg(p, daily.collected.includes(`egg-${i}`)));
      scene.crops.forEach((p, i) => drawCrop(p, daily.collected.includes(`crop-${i}`), i));
      const duck = duckPoint(scene.pond, elapsed / 1000); drawDuck(duck, elapsed < duckUntil, 0); duckButton._townPoint = duck; positionButton(duckButton);
      scene.npcs.forEach((npc, i) => {
        const current = routePoint(npc.route, npcPathElapsed[i] / 1000, i === 0 ? 16 : 9, i === 0 ? 2 : 6), b = npcButtons[i];
        const p = speechOwner === b && speech?.dataset.automatic !== 'true' && actors[`npc-${i}`] ? { ...actors[`npc-${i}`], walking: false } : current;
        actors[`npc-${i}`] = p; drawNPC(p, npc, i); b._townPoint = p; positionButton(b);
      });
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i], age = (elapsed - p.since) / 1000;
        if (age >= 1.2) { particles.splice(i, 1); continue; }
        for (let j = 0; j < 5; j++) rect(p.x + Math.sin(j * 1.3) * age * 20, p.y - age * 36 - j % 2 * 6, 4, 4, '#fff0a9', 1 - age / 1.2);
      }
    }
    function draw() {
      displayCtx.clearRect(0, 0, WIDTH, HEIGHT);
      environment?.drawBack(displayCtx, elapsed, light, mode);
      if (actorCtx) {
        actorCtx.clearRect(0, 0, WIDTH, HEIGHT);
        ctx = actorCtx;
        try { drawActors(); } finally { ctx = displayCtx; }
        displayCtx.save();
        try {
          if (ambientFilter) { ambientFilter.update(light); displayCtx.filter = ambientFilter.url; }
          else if (light.night > 0 || light.dusk > 0) {
            // Older renderers still darken existing actor pixels, retaining alpha.
            actorCtx.save(); actorCtx.globalCompositeOperation = 'source-atop';
            actorCtx.globalAlpha = clamp(light.dusk, 0, 1) * .16; actorCtx.fillStyle = '#b47736'; actorCtx.fillRect(0, 0, WIDTH, HEIGHT);
            actorCtx.globalAlpha = clamp(light.night, 0, 1) * .74; actorCtx.fillStyle = '#000000'; actorCtx.fillRect(0, 0, WIDTH, HEIGHT);
            actorCtx.globalAlpha = clamp(light.night, 0, 1) * .08; actorCtx.fillStyle = '#142653'; actorCtx.fillRect(0, 0, WIDTH, HEIGHT);
            actorCtx.restore();
          }
          displayCtx.drawImage(actorCanvas, 0, 0);
        } finally { displayCtx.restore(); }
      } else { drawActors(); }
      // Emissive lamps and seasonal fireflies are composited after ambient color.
      drawLamps(); environment?.drawFront(displayCtx, elapsed, light, mode);
      positionSpeech();
    }
    function tick(now) {
      raf = 0;
      if (mode === 'still' || !visible || doc.hidden) { last = 0; return; }
      const delta = last ? Math.min(80, now - last) : 0; last = now;
      const step = delta * (mode === 'gentle' ? .48 : 1);
      if (elapsed >= catUntil) catPathElapsed += step;
      npcPathElapsed.forEach((_, i) => { if (speechOwner !== npcButtons[i] || speech?.dataset.automatic === 'true') npcPathElapsed[i] += step; });
      elapsed += step;
      if (now - lastFrame >= (mode === 'gentle' ? 66 : 40)) { draw(); lastFrame = now; frame++; }
      raf = window.requestAnimationFrame(tick);
    }
    function reconcile() {
      if (mode !== 'still' && visible && !doc.hidden) { if (!raf) { last = 0; raf = window.requestAnimationFrame(tick); } }
      else { if (raf) window.cancelAnimationFrame(raf); raf = 0; last = 0; }
    }
    function setClimatePanel(open, restoreFocus = false) {
      if (!climatePanel) return;
      climatePanel.hidden = !open;
      seasonToggle?.setAttribute('aria-expanded', String(open));
      if (open) {
        closeSpeech();
        const buttons = Array.from(doc.querySelectorAll('button[data-town-phase]'));
        const selected = buttons.find(button => button.getAttribute('aria-pressed') === 'true');
        (selected || doc.getElementById('town-follow-real') || buttons[0])?.focus({ preventScroll: true });
      } else if (restoreFocus) seasonToggle?.focus({ preventScroll: true });
    }
    function renderEnvironment(state) {
      const name = doc.getElementById('town-season-name'), description = doc.getElementById('town-season-description'), label = doc.getElementById('town-season-mode');
      if (name) name.textContent = state.preview ? `季节预览 · ${state.phase.name}` : state.phase.name;
      if (description) description.textContent = `${state.phase.range} · ${state.phase.description}`;
      if (label) label.textContent = state.preview ? '季节预览中 · 天气仍跟随云栖' : '跟随真实日期 · 天气来自云栖';
      doc.querySelectorAll('button[data-town-phase]').forEach(button => button.setAttribute('aria-pressed', String(state.preview && button.dataset.townPhase === state.phase.id)));
      doc.getElementById('town-follow-real')?.setAttribute('aria-pressed', String(!state.preview));
      if (state.backgroundURL !== backgroundTarget) {
        backgroundTarget = state.backgroundURL;
        const generation = ++backgroundGeneration, requestedSeason = state.season, image = new Image();
        world.dataset.townBackgroundPending = 'true'; world.dataset.townBackgroundError = 'false';
        image.onload = () => {
          if (generation !== backgroundGeneration || !image.naturalWidth) return;
          world.style.backgroundImage = `url("${state.backgroundURL}")`;
          world.dataset.townBackground = requestedSeason; world.dataset.townBackgroundPending = 'false';
        };
        image.onerror = () => {
          if (generation !== backgroundGeneration) return;
          world.dataset.townBackgroundPending = 'false'; world.dataset.townBackgroundError = 'true';
        };
        image.src = state.backgroundURL;
      }
      draw();
    }
    function renderWeather(state) {
      const summary = doc.getElementById('town-weather-summary'), detail = doc.getElementById('town-weather-detail'), source = doc.getElementById('town-weather-source');
      const status = state?.status || 'unavailable';
      if (status === 'fresh' || status === 'cached') {
        if (summary) summary.textContent = `云栖 · ${state.label} ${state.temp.toFixed(1)}°C${status === 'cached' ? ' · 缓存' : ''}`;
        if (detail) detail.textContent = `北京时间 ${state.timestampLabel} · 体感 ${state.apparentTemp.toFixed(1)}°C · 风速 ${state.windKmh.toFixed(1)} km/h${state.sunrise && state.sunset ? ` · 日出 ${state.sunrise.slice(11,16)} / 日落 ${state.sunset.slice(11,16)}` : ''}`;
      } else if (status === 'stale') {
        if (summary) summary.textContent = '云栖 · 天气已过期';
        if (detail) detail.textContent = `上次天气：${state.timestampLabel} · ${state.label} ${state.temp.toFixed(1)}°C。已暂停天气特效，等待更新。`;
      } else {
        if (summary) summary.textContent = status === 'loading' ? '云栖 · 天气读取中' : '云栖 · 天气暂未取得';
        if (detail) detail.textContent = status === 'loading' ? '正在读取云栖的当前天气。' : '稍后自动重试；季节仍跟随日期，暂不显示天气特效。';
      }
      if (source) { source.textContent = 'Open-Meteo · 当前模型天气'; source.href = 'https://open-meteo.com/en/docs'; }
      world.dataset.townWeather = status;
      world.dataset.townWeatherKind = ['fresh', 'cached'].includes(status) ? (state.kind || '') : '';
    }
    for (const [name, path] of Object.entries({ cat: '/static/pixel/cat-v3/atlas.png', chicken: '/static/pixel/scene-v3/chicken-atlas.png' })) {
      const img = new Image(); images[name] = img; img.onload = draw; img.onerror = () => { world.dataset[`${name}Ready`] = 'false'; }; img.src = path;
    }
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null; resizeObserver?.observe(world);
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('scroll', positionSpeech, { passive: true });
    stage.addEventListener('scroll', positionSpeech, { passive: true });
    if (typeof IntersectionObserver === 'function') new IntersectionObserver(entries => { visible = entries[0].isIntersecting; reconcile(); }, { threshold: 0 }).observe(stage);
    doc.addEventListener('visibilitychange', () => { refreshClock(); reconcile(); });
    window.addEventListener('storage', e => {
      if (e.key === STORE) { try { daily = dailyState(JSON.parse(e.newValue), clockParts().key); updateBasket(); draw(); } catch (_) { /* Ignore malformed other-tab state. */ } }
      if (e.key === MODE && ['full', 'gentle', 'still'].includes(e.newValue)) { explicitMode = e.newValue; setMode(e.newValue, false); }
    });
    window.addEventListener('pagehide', () => { if (raf) window.cancelAnimationFrame(raf); raf = 0; last = 0; });
    window.addEventListener('pageshow', reconcile);
    window.setInterval(refreshClock, 15000);
    window.setInterval(automaticSpeech, 250);
    seasonToggle?.addEventListener('click', () => setClimatePanel(Boolean(climatePanel?.hidden)));
    doc.querySelectorAll('button[data-town-phase]').forEach(button => button.addEventListener('click', () => environment?.setPreview(button.dataset.townPhase)));
    doc.getElementById('town-follow-real')?.addEventListener('click', () => environment?.clearPreview());
    // Create optional scenery modules only after all actors and callbacks exist.
    if (window.TownEnvironmentV9?.create) environment = window.TownEnvironmentV9.create({ doc, world, onChange: renderEnvironment });
    if (window.TownWeatherV9?.create) weatherClient = window.TownWeatherV9.create({ onChange(state) { weatherState = state; refreshClock(); } });
    loadDialogue();
    updateBasket(); refreshClock(); setMode(mode, false); resize();
  }
  return { clockParts, lighting, ambientMultipliers, dailyState, collectItem, routePoint, duckPoint, isNewsURL, validNews, mount };
});
