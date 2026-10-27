/* Shared indoor-page atmosphere. The village and its interaction bounds stay in pixel.js. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.InteriorClimateV10 = api;
  if (root && root.document) {
    const start = () => api.mount(root.document);
    root.document.readyState === 'loading' ? root.document.addEventListener('DOMContentLoaded', start, { once: true }) : start();
  }
})(typeof window === 'undefined' ? null : window, function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const random = n => { const f = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return f - Math.floor(f); };
  const FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const PHASES = [
    ['early-spring','初春','spring','02-19',6], ['mid-spring','仲春','spring','03-21',16], ['late-spring','暮春','spring','04-20',9],
    ['early-summer','初夏','summer','05-06',6], ['high-summer','盛夏','summer','06-21',16], ['late-summer','晚夏','summer','08-01',9],
    ['early-autumn','初秋','autumn','09-07',5], ['deep-autumn','深秋','autumn','10-08',17], ['late-autumn','暮秋','autumn','11-07',21],
    ['early-winter','初冬','winter','12-01',4], ['mid-winter','隆冬','winter','01-05',0], ['late-winter','冬末','winter','02-04',0]
  ];
  function clockParts(date = new Date()) {
    const p = Object.fromEntries(FORMAT.formatToParts(date).map(part => [part.type, part.value]));
    return { key: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, date: `${Number(p.month)}月${Number(p.day)}日`, hour: Number(p.hour) + Number(p.minute) / 60 };
  }
  function phaseAt(date = new Date()) {
    if (root && root.TownEnvironmentV9 && typeof root.TownEnvironmentV9.phaseAt === 'function') return root.TownEnvironmentV9.phaseAt(date);
    const md = clockParts(date).key.slice(5);
    const p = PHASES.find((item, i) => { const end = PHASES[(i + 1) % PHASES.length][3]; return end > item[3] ? md >= item[3] && md < end : md >= item[3] || md < end; });
    return { id: p[0], name: p[1], season: p[2], petals: p[2] === 'spring' ? p[4] : 0, fireflies: p[2] === 'summer' ? p[4] : 0, leaves: p[2] === 'autumn' || p[0] === 'early-winter' ? p[4] : 0 };
  }
  function activeWeather(state) { return !!state && (state.status === 'fresh' || state.status === 'cached'); }
  function solarHours(state, dateKey) {
    if (!activeWeather(state)) return null;
    const hours = state.sunHours && state.sunHours.date === dateKey ? state.sunHours : state.sunDays?.find(day => day.date === dateKey)?.sunHours;
    return hours && Number.isFinite(hours.sunrise) && Number.isFinite(hours.sunset) && hours.sunrise >= 3 && hours.sunrise <= 9 && hours.sunset >= 15 && hours.sunset <= 22 && hours.sunset > hours.sunrise ? hours : null;
  }
  function lighting(hour, sunHours) {
    const h = ((hour % 24) + 24) % 24;
    let night, dusk;
    if (sunHours && Number.isFinite(sunHours.sunrise) && Number.isFinite(sunHours.sunset) && sunHours.sunrise >= 3 && sunHours.sunrise <= 9 && sunHours.sunset >= 15 && sunHours.sunset <= 22 && sunHours.sunset > sunHours.sunrise) {
      const rise = sunHours.sunrise, set = sunHours.sunset;
      night = h < rise - .75 ? 1 : h < rise + .75 ? 1 - smooth(rise - .75, rise + .75, h) : h < set - .75 ? 0 : smooth(set - .75, set + 1.25, h);
      dusk = h >= set - 1.5 && h <= set + 1.25 ? Math.sin((h - set + 1.5) / 2.75 * Math.PI) * .7 : h >= rise - .75 && h <= rise + 1.25 ? Math.sin((h - rise + .75) / 2 * Math.PI) * .35 : 0;
    } else {
      night = h < 5 ? 1 : h < 7 ? 1 - smooth(5, 7, h) : h < 17.5 ? 0 : smooth(17.5, 20, h);
      dusk = h >= 16 && h <= 20 ? Math.sin((h - 16) / 4 * Math.PI) * .7 : h >= 5 && h <= 8 ? Math.sin((h - 5) / 3 * Math.PI) * .35 : 0;
    }
    return { night: clamp(night, 0, 1), dusk: clamp(dusk, 0, 1), period: night >= .85 ? 'night' : night > .06 || dusk > .2 ? 'dusk' : 'day' };
  }
  function ambientMultipliers(light, cloud = 0) {
    const n = clamp(light.night, 0, 1) * .83, d = clamp(light.dusk, 0, 1) * .38, c = 1 - clamp(cloud, 0, 1) * .12;
    return [0,1,2].map(i => (1 - d + [250,136,62][i] / 255 * d) * (1 - n + [20,38,83][i] / 255 * n) * c);
  }
  function foliageMatrix(phase) {
    const identity=[1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0];
    const autumn=[.7,.6,0,0,0, .1,.78,.08,0,0, .06,.12,.65,0,0, 0,0,0,1,0];
    const winter=[.50,.40,.10,0,0, .30,.50,.10,0,0, .25,.35,.25,0,0, 0,0,0,1,0];
    const strength=({'early-autumn':.35,'deep-autumn':.85,'late-autumn':1,'early-winter':.65,'mid-winter':.9,'late-winter':.7,'late-summer':.12})[phase.id]||0;
    const target=phase.season==='winter'?winter:autumn;
    return identity.map((value,i)=>value+(target[i]-value)*strength);
  }
  function foliageMask(rgb) {return clamp(3.06*(rgb[1]-rgb[2])/255-.3,0,1)*clamp(6*(rgb[1]-rgb[0])/255-.1,0,1);}
  function weatherView(state) {
    const s = state || {}, active = activeWeather(s), hasTemp = Number.isFinite(s.temp);
    const value = hasTemp ? `${s.label || '天气'} ${s.temp.toFixed(1)}°C` : s.status === 'loading' ? '天气读取中' : '天气暂未取得';
    return { active, kind: active ? s.kind : null, cloud: active && Number.isFinite(s.cloud) ? clamp(s.cloud / 100, 0, 1) : 0,
      wind: active && Number.isFinite(s.windKmh) ? clamp(s.windKmh, 0, 150) : 0, intensity: active && Number.isFinite(s.intensity) ? clamp(s.intensity, 0, 1) : 0,
      text: `云栖 · ${value}${s.status === 'stale' ? ' · 已过期' : ''}`,
      detail: `云栖｜${s.source || 'Open-Meteo'} 当前模型天气${s.timestampLabel ? '｜' + s.timestampLabel : ''}${s.status === 'cached' ? '（缓存）' : ''}${s.status === 'stale' ? '｜数据已过期，暂停雨雪效果' : ''}` };
  }
  function shouldAnimate({ hasCanvas, mode, visible, hidden, suspended }) { return !!hasCanvas && mode !== 'still' && visible && !hidden && !suspended; }
  function mount(doc) {
    const body = doc.body;
    if (!root || !body || body.dataset.interiorClimate || !body.matches('.pixel-home,.pixel-inner,.pixel-blog')) return null;
    body.dataset.interiorClimate = '10';
    const html = doc.documentElement, hero = body.querySelector('.pixel-hero,.pixel-backdrop');
    const reduced = root.matchMedia('(prefers-reduced-motion: reduce)');
    let weather = null, client = null, clock = clockParts(), phase = phaseAt(), light = lighting(clock.hour), view = weatherView(null);
    let mode = body.dataset.pixelMotion || (reduced.matches ? 'still' : 'full'), visible = true, suspended = false, running = false, raf = 0, lastFrame = 0, elapsed = 0, timer = 0;
    let width = 1, height = 1, dpr = 1, canvas = null, ctx = null, geometry = null;
    const almanac = doc.createElement('div'); almanac.className = 'interior-almanac'; almanac.setAttribute('aria-label', '小镇日历与云栖天气');
    const season = doc.createElement('span'); season.className = 'interior-almanac-season';
    const time = doc.createElement('time'); time.className = 'interior-almanac-time';
    const forecast = doc.createElement('a'); forecast.className = 'interior-almanac-weather'; forecast.href = 'https://open-meteo.com/en/docs'; forecast.target = '_blank'; forecast.rel = 'noopener noreferrer';
    almanac.append(season, time, forecast);
    const copy = hero?.querySelector('.hero-copy');
    if (copy) copy.prepend(almanac);
    else if (hero) hero.prepend(almanac);
    else { const nav = body.querySelector('.pixel-nav'); nav ? nav.after(almanac) : body.prepend(almanac); }
    const ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg'), filter = doc.createElementNS(ns, 'filter'), matrix = doc.createElementNS(ns, 'feColorMatrix');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.style.position = 'absolute'; svg.style.pointerEvents = 'none';
    filter.setAttribute('id', 'interior-ambient-v10'); filter.setAttribute('color-interpolation-filters', 'sRGB'); filter.setAttribute('x', '0'); filter.setAttribute('y', '0'); filter.setAttribute('width', '100%'); filter.setAttribute('height', '100%');
    matrix.setAttribute('type', 'matrix'); filter.appendChild(matrix); svg.appendChild(filter); body.appendChild(svg);
    html.style.setProperty('--interior-scene-filter', 'url("#interior-ambient-v10")');
    const foliage=doc.createElementNS(ns,'filter'), mask=doc.createElementNS(ns,'feColorMatrix'), greenMask=doc.createElementNS(ns,'feColorMatrix'), recolor=doc.createElementNS(ns,'feColorMatrix');
    foliage.setAttribute('id','interior-foliage-v10');foliage.setAttribute('color-interpolation-filters','sRGB');foliage.setAttribute('x','0');foliage.setAttribute('y','0');foliage.setAttribute('width','100%');foliage.setAttribute('height','100%');
    mask.setAttribute('in','SourceGraphic');mask.setAttribute('type','matrix');mask.setAttribute('values','0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 3.06 -3.06 0 -.3');mask.setAttribute('result','blueMask');
    greenMask.setAttribute('in','SourceGraphic');greenMask.setAttribute('type','matrix');greenMask.setAttribute('values','0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -6 6 0 0 -.1');greenMask.setAttribute('result','greenMask');
    recolor.setAttribute('in','SourceGraphic');recolor.setAttribute('type','matrix');recolor.setAttribute('result','warmLeaves');
    const compose=(input,input2,operator,result)=>{const node=doc.createElementNS(ns,'feComposite');node.setAttribute('in',input);node.setAttribute('in2',input2);node.setAttribute('operator',operator);node.setAttribute('result',result);return node;};
    const leafMask=compose('blueMask','greenMask','in','leafMask'),leaves=compose('warmLeaves','leafMask','in','leaves'),rest=compose('SourceGraphic','leafMask','out','rest'),join=compose('leaves','rest','arithmetic','result');join.setAttribute('k2','1');join.setAttribute('k3','1');
    foliage.append(mask,greenMask,leafMask,recolor,leaves,rest,join);svg.appendChild(foliage);html.style.setProperty('--interior-season-filter','url("#interior-foliage-v10")');
    if (hero) {
      canvas = doc.createElement('canvas'); canvas.className = 'interior-weather-layer'; canvas.setAttribute('aria-hidden', 'true');
      Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '1', imageRendering: 'pixelated' });
      hero.appendChild(canvas); ctx = canvas.getContext('2d', { alpha: true });
    }
    function resize() {
      if (!hero || !canvas) return;
      const box = hero.getBoundingClientRect(), image = hero.querySelector('.village-illustration');
      width = Math.max(1, Math.round(box.width)); height = Math.max(1, Math.round(box.height)); dpr = Math.min(root.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      if (ctx) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false; }
      if (image && image.complete && image.naturalWidth > 0) {
        const rect = image.getBoundingClientRect(); geometry = { x: rect.left - box.left, y: rect.top - box.top, scale: rect.width / 2172 };
      } else geometry = null;
      draw();
    }
    function rect(x,y,w,h,color,alpha=1) { ctx.fillStyle = color; ctx.globalAlpha = clamp(alpha, 0, 1); ctx.fillRect(Math.round(x), Math.round(y), Math.max(1,Math.round(w)), Math.max(1,Math.round(h))); ctx.globalAlpha = 1; }
    function sourceRect(x,y,w,h,color,alpha) { if (geometry) rect(geometry.x + x * geometry.scale, geometry.y + y * geometry.scale, w * geometry.scale, h * geometry.scale, color, alpha); }
    function lamps() {
      if (!geometry) return;
      const alpha = clamp(light.night + light.dusk * .6, 0, 1); if (alpha < .01) return;
      // Four original cottage window panes and the small wall lantern, in scene-v6 source pixels.
      sourceRect(1378,455,59,61,'#ffd48a',alpha*.09);
      for (const x of [1395,1409]) for (const y of [469,483]) sourceRect(x,y,9,9,'#ffce73',alpha*.93);
      sourceRect(1532,482,20,24,'#ffd48a',alpha*.12); sourceRect(1538,490,8,11,'#ffd788',alpha*.96);
      sourceRect(1483,545,38,9,'#fbc56a',alpha*.15);
    }
    function stars() {
      if (light.night < .2 || view.kind === 'rain' || view.kind === 'snow' || view.kind === 'thunder' || view.kind === 'fog') return;
      for (let i=0;i<22;i++) {
        const x = width * (.4 + random(i+51) * .58), y = 12 + random(i+79) * height * .34;
        const a = light.night * (1-view.cloud*.8) * (.28+random(i+94)*.37);
        rect(x,y,2,2,'#e9ddaf',a);
      }
    }
    function seasonal() {
      const slow = elapsed / 1000, count = Math.min(22, phase.petals || phase.leaves || (light.night > .5 ? phase.fireflies : 0) || 0);
      const insects = phase.season === 'summer';
      for (let i=0;i<count;i++) {
        const seed=random(i+201), speed=5+random(i+239)*7;
        if (insects) {
          const x=width*(.42+random(i+251)*.55)+Math.sin(slow*.3+i)*9, y=height*(.75+random(i+278)*.19)+Math.cos(slow*.4+i)*5;
          rect(x,y,2,2,'#e4df8a',light.night*(.25+.4*(.5+.5*Math.sin(slow*.9+i))));
        } else {
          const y=(seed*height+slow*speed)%height, x=width*(.43+random(i+303)*.55)+Math.sin(slow*.7+i)*14+Math.sin(slow*.1)*view.wind*.5;
          const color=phase.season==='spring'?'#efb8ba':['#a5743e','#cd994d','#daa95b'][i%3], shade=1-light.night*.65;
          rect(x,y,4,2,color,shade*.7); rect(x+2,y+2,2,2,color,shade*.7);
        }
      }
    }
    function precipitation() {
      if (!view.active) return;
      const slow=elapsed/1000;
      if (['rain','thunder','snow'].includes(view.kind)) {
        const snow=view.kind==='snow', count=Math.round((snow?26:42)*(0.35+view.intensity*.65)*(mode==='gentle'?.55:1));
        for(let i=0;i<count;i++) {
          const speed=snow?14+random(i+421)*12:100+random(i+421)*70;
          const y=(random(i+401)*height+slow*speed)%(height+14)-7, base=random(i+451)*width;
          const x=(base+(snow?Math.sin(slow*.8+i)*9:y*.12)+width)%width;
          rect(x,y,snow?3:1,snow?3:7,snow?'#e8edf1':'#aacbd8',snow?.5:.33);
        }
      }
      if(view.kind==='fog') for(let i=0;i<3;i++) rect(0,height*(.42+i*.18),width,10,'#dce4dd',.055);
    }
    function draw() { if(!ctx)return;ctx.clearRect(0,0,width,height);stars();lamps();seasonal();precipitation(); }
    function reconcile() {
      const next=shouldAnimate({hasCanvas:ctx,mode,visible,hidden:doc.hidden,suspended});
      if(next&&!running){running=true;lastFrame=0;raf=root.requestAnimationFrame(tick);}
      else if(!next&&running){running=false;root.cancelAnimationFrame(raf);raf=0;lastFrame=0;}
      body.dataset.interiorPlaying=String(running);
    }
    function tick(timestamp) {
      if(!running)return;
      if(!lastFrame)lastFrame=timestamp;
      const delta=timestamp-lastFrame,budget=mode==='gentle'?1000/15:40;
      if(delta>=budget){elapsed+=Math.min(delta,140)*(mode==='gentle'?.48:1);lastFrame=timestamp;draw();}
      raf=root.requestAnimationFrame(tick);
    }
    function sync() {
      clock=clockParts();phase=phaseAt();view=weatherView(weather);light=lighting(clock.hour,solarHours(weather,clock.key));
      html.style.setProperty('--interior-night',light.night.toFixed(4));html.style.setProperty('--interior-dusk',light.dusk.toFixed(4));html.style.setProperty('--interior-cloud',view.cloud.toFixed(4));
      const rgb=ambientMultipliers(light,view.cloud),rgbText=base=>`rgb(${base.map((channel,i)=>Math.round(channel*rgb[i])).join(',')})`;
      html.style.setProperty('--interior-sky',rgbText([105,198,245]));html.style.setProperty('--interior-grass',rgbText([153,204,67]));
      matrix.setAttribute('values',`${rgb[0]} 0 0 0 0 0 ${rgb[1]} 0 0 0 0 0 ${rgb[2]} 0 0 0 0 0 1 0`);
      recolor.setAttribute('values',foliageMatrix(phase).join(' '));
      body.dataset.interiorTime=light.period;body.dataset.interiorSeason=phase.season;body.dataset.interiorPhase=phase.id;body.dataset.interiorWeather=weather?.status||'unavailable';body.dataset.interiorWeatherKind=view.kind||'unavailable';
      season.textContent=phase.name;season.title='小镇按江南时令分为十二阶段，随现实日期变化';time.textContent=`${clock.date} ${clock.time}`;time.dateTime=`${clock.key}T${clock.time}:00+08:00`;
      forecast.textContent=view.text;forecast.title=view.detail;forecast.setAttribute('aria-label',view.text+'，'+view.detail+'，查看天气来源');
      const greeting=doc.getElementById('greet'), who=body.dataset.person;
      if(greeting&&['yeti','yuki'].includes(who)){const h=clock.hour;greeting.textContent=`${h<6?'夜深了':h<11?'早上好':h<14?'中午好':h<18?'下午好':'晚上好'}，${who==='yuki'?'阿安':'阿暖'}`;}
      draw();
    }
    function schedule() {
      if(timer)root.clearTimeout(timer);timer=0;
      if(!doc.hidden&&!suspended)timer=root.setTimeout(()=>{timer=0;if(client)weather=client.getState();sync();schedule();},30000);
    }
    function modeChanged() {mode=body.dataset.pixelMotion||(reduced.matches?'still':'full');reconcile();draw();}
    doc.addEventListener('pixel-cat-state',modeChanged);
    if(typeof root.MutationObserver==='function')new root.MutationObserver(modeChanged).observe(body,{attributes:true,attributeFilter:['data-pixel-motion']});
    reduced.addEventListener('change',modeChanged);
    doc.addEventListener('visibilitychange',()=>{if(!doc.hidden){if(client)weather=client.getState();sync();}schedule();reconcile();});
    root.addEventListener('pagehide',()=>{suspended=true;schedule();reconcile();},{passive:true});
    root.addEventListener('pageshow',()=>{suspended=false;sync();resize();schedule();reconcile();},{passive:true});
    if(hero){
      if(typeof root.ResizeObserver==='function')new root.ResizeObserver(()=>root.requestAnimationFrame(resize)).observe(hero);else root.addEventListener('resize',resize,{passive:true});
      if(typeof root.IntersectionObserver==='function')new root.IntersectionObserver(entries=>{visible=entries[0].isIntersecting;reconcile();},{rootMargin:'30px'}).observe(hero);
      hero.addEventListener('load',event=>{if(event.target.matches?.('.village-illustration'))resize();},true);
    }
    sync();resize();schedule();reconcile();
    if(root.TownWeatherV9&&typeof root.TownWeatherV9.create==='function')client=root.TownWeatherV9.create({onChange:state=>{weather=state;sync();}});
    return {getState:()=>({clock:{...clock},phase:phase.id,season:phase.season,light:{...light},weather:weather?.status||'unavailable',mode,running,visible,geometry:geometry?{...geometry}:null})};
  }
  return Object.freeze({clockParts,phaseAt,lighting,solarHours,ambientMultipliers,foliageMatrix,foliageMask,weatherView,shouldAnimate,mount});
});
