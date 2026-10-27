/* Town calendar and pixel scenery. Weather remains a separate, explicitly sourced input. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TownEnvironmentV9 = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  const W = 1536, H = 1024, TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const mod = (v, n) => ((v % n) + n) % n;
  const random = n => { const f = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return f - Math.floor(f); };
  const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  const PHASES = [
    { id: 'early-spring', name: '初春', season: 'spring', start: '02-19', range: '2月19日—3月20日', description: '柳芽初绿，零星花瓣落在小路上。', density: .48, foliage: ['#3c662f','#739746','#a1bb55','#c9cf77'], petals: 6, fireflies: 0, leaves: 0 },
    { id: 'mid-spring', name: '仲春', season: 'spring', start: '03-21', range: '3月21日—4月19日', description: '嫩叶渐密，花瓣随风轻轻飘落。', density: .76, foliage: ['#365e31','#5c993c','#90bb4c','#c0d96c'], petals: 16, fireflies: 0, leaves: 0 },
    { id: 'late-spring', name: '暮春', season: 'spring', start: '04-20', range: '4月20日—5月5日', description: '柳荫长成，春花渐少，草色更浓。', density: .94, foliage: ['#295b31','#4c8b3a','#7bb343','#b1cf5f'], petals: 9, fireflies: 0, leaves: 0 },
    { id: 'early-summer', name: '初夏', season: 'summer', start: '05-06', range: '5月6日—6月20日', description: '池边新绿，花叶舒展，夜里偶见流萤。', density: 1, foliage: ['#275633','#4d8735','#83af3f','#b9cb65'], petals: 0, fireflies: 6, leaves: 0 },
    { id: 'high-summer', name: '盛夏', season: 'summer', start: '06-21', range: '6月21日—7月31日', description: '树荫浓绿，柳条低垂，夏夜流萤最盛。', density: 1, foliage: ['#254b2e','#437532','#719e39','#a6bc51'], petals: 0, fireflies: 16, leaves: 0 },
    { id: 'late-summer', name: '晚夏', season: 'summer', start: '08-01', range: '8月1日—9月6日', description: '草尖微黄，夜色渐长，萤火慢慢稀疏。', density: .96, foliage: ['#45572d','#708137','#9daa45','#c8c36b'], petals: 0, fireflies: 9, leaves: 1 },
    { id: 'early-autumn', name: '初秋', season: 'autumn', start: '09-07', range: '9月7日—10月7日', description: '叶间初染金色，风里偶有一片落叶。', density: .91, foliage: ['#586333','#8a973d','#b8b74d','#d2c365'], petals: 0, fireflies: 0, leaves: 5 },
    { id: 'deep-autumn', name: '深秋', season: 'autumn', start: '10-08', range: '10月8日—11月6日', description: '树叶转金，铜色落叶铺到池边。', density: .72, foliage: ['#785334','#a87a3b','#ce9e45','#e8bd65'], petals: 0, fireflies: 0, leaves: 17 },
    { id: 'late-autumn', name: '暮秋', season: 'autumn', start: '11-07', range: '11月7日—11月30日', description: '枝条渐露，余叶由金黄转成暖褐。', density: .37, foliage: ['#674b37','#8e643b','#af8249','#cda564'], petals: 0, fireflies: 0, leaves: 21 },
    { id: 'early-winter', name: '初冬', season: 'winter', start: '12-01', range: '12月1日—1月4日', description: '柳枝疏落，草色收敛，冷天才出现薄霜。', density: .15, foliage: ['#65533f','#857148','#a18f60','#b6aa7d'], petals: 0, fireflies: 0, leaves: 4 },
    { id: 'mid-winter', name: '隆冬', season: 'winter', start: '01-05', range: '1月5日—2月3日', description: '细枝舒展，常青树守着小镇；下雪跟随实况。', density: .035, foliage: ['#675b4e','#847968','#a09780','#b7b19a'], petals: 0, fireflies: 0, leaves: 0 },
    { id: 'late-winter', name: '冬末', season: 'winter', start: '02-04', range: '2月4日—2月18日', description: '枝头露出微小新芽，等下一阵春风。', density: .20, foliage: ['#5d6244','#7c8751','#9eab63','#b8bd83'], petals: 0, fireflies: 0, leaves: 0 }
  ].map(p => Object.freeze(p));
  Object.freeze(PHASES);
  const SEASON_NAMES = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
  const validDateKey = key => /^\d{4}-\d{2}-\d{2}$/.test(key || '') && Number.isFinite(Date.parse(`${key}T12:00:00+08:00`));
  function dateKey(value) {
    if (value && validDateKey(value.key)) return value.key;
    const date = value instanceof Date ? value : new Date();
    const parts = Object.fromEntries(dayFormat.formatToParts(Number.isFinite(date.getTime()) ? date : new Date()).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function phaseAt(value) {
    const key = dateKey(value), md = key.slice(5);
    let index = PHASES.findIndex((p, i) => {
      const end = PHASES[(i + 1) % PHASES.length].start;
      return end > p.start ? md >= p.start && md < end : md >= p.start || md < end;
    });
    if (index < 0) index = 0;
    const phase = PHASES[index], next = PHASES[(index + 1) % PHASES.length];
    const year = Number(key.slice(0, 4)), startYear = md < phase.start ? year - 1 : year;
    const start = Date.parse(`${startYear}-${phase.start}T00:00:00+08:00`);
    const nextYear = next.start < phase.start ? startYear + 1 : startYear;
    const end = Date.parse(`${nextYear}-${next.start}T00:00:00+08:00`), current = Date.parse(`${key}T12:00:00+08:00`);
    return { ...phase, progress: clamp((current - start) / (end - start), 0, 1), nextId: next.id, date: key };
  }
  function hexColor(a, b, t) {
    const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
    const part = shift => Math.round(mix((A >> shift) & 255, (B >> shift) & 255, t));
    return `rgb(${part(16)},${part(8)},${part(0)})`;
  }
  function normalizeWeather(value) {
    const v = value && typeof value === 'object' ? value : {};
    const status = ['fresh','cached','stale','loading','unavailable'].includes(v.status) ? v.status : 'unavailable';
    const active = status === 'fresh' || status === 'cached';
    const kind = ['clear','cloudy','fog','rain','snow','thunder'].includes(v.kind) ? v.kind : null;
    const numeric = (v, min, max, fallback) => Number.isFinite(v) ? clamp(v, min, max) : fallback;
    return { status, active, kind: active ? kind : null, windKmh: active ? numeric(v.windKmh, 0, 150, 0) : 0, windDeg: numeric(v.windDeg, 0, 360, 90), intensity: active ? numeric(v.intensity, 0, 1, .25) : 0, cloud: active ? numeric(v.cloud, 0, 100, kind === 'cloudy' ? 75 : 15) : 0, temp: active ? numeric(v.temp, -50, 60, null) : null, sourceKind: kind };
  }
  function create(options = {}) {
    const { doc, world, onChange } = options;
    const anchors = { windmill: { x: 1330, y: 139, radius: 78 }, willow: { x: 1460, y: 685 }, ...(options.anchors || {}) };
    let actualPhase = phaseAt(new Date()), previewId = null, weather = normalizeWeather(null), stateSignature = '';
    let lastMode = null, motionSeconds = 0, previousElapsed = null, millAngle = -.52, lastDelta = 0, drawCounts = { weather: 0, seasonal: 0 };
    let drawInfo = { millAngle, willowSway: 0, particleCount: 0, mode: 'full' };
    let ambient = null, ambientKey = '', ambientColors = new Map();
    function currentPhase() {
      if (!previewId) return actualPhase;
      const p = PHASES.find(p => p.id === previewId);
      return { ...p, progress: .5, nextId: PHASES[(PHASES.indexOf(p) + 1) % PHASES.length].id, date: actualPhase.date };
    }
    function palette() {
      const p = currentPhase(), next = PHASES.find(n => n.id === p.nextId);
      // Foliage evolves inside a season; the four prepared world paintings change at its boundary.
      const t = next.season === p.season && !previewId ? p.progress * .58 : 0;
      return { ...p, colors: p.foliage.map((c, i) => hexColor(c, next.foliage[i], t)), density: mix(p.density, next.density, t) };
    }
    function getState() {
      const p = currentPhase();
      return { phase: { id: p.id, name: p.name, season: p.season, description: p.description, range: p.range, progress: p.progress }, season: p.season, seasonName: SEASON_NAMES[p.season], preview: Boolean(previewId), date: actualPhase.date, backgroundURL: `/static/pixel/town-climate-v9/${p.season}.png`, weather: { ...weather }, anchors, motion: { ...drawInfo } };
    }
    function notify() {
      const state = getState(), signature = JSON.stringify([state.phase.id, state.date, state.preview, weather]);
      if (world && world.dataset) { world.dataset.townSeason = state.season; world.dataset.townPhase = state.phase.id; world.dataset.seasonPreview = String(state.preview); }
      if (signature !== stateSignature) { stateSignature = signature; if (typeof onChange === 'function') onChange(state); }
      return state;
    }
    function updateTime(date) { actualPhase = phaseAt(date); return notify(); }
    function setWeather(value) { weather = normalizeWeather(value); return notify(); }
    function setPreview(value) {
      const id = typeof value === 'string' ? value : value?.phase;
      if (!PHASES.some(p => p.id === id)) return getState();
      previewId = id; return notify();
    }
    function clearPreview() { previewId = null; return notify(); }
    function beginFrame(elapsed, mode) {
      const now = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
      const still = mode === 'still';
      lastDelta = !still && previousElapsed !== null ? clamp((now - previousElapsed) / 1000, 0, .25) : 0;
      previousElapsed = now;
      if (!still) {
        motionSeconds += lastDelta;
        // This is a decorative mill: calm air still gives it a slow idle turn.
        const speed = .105 + clamp(weather.windKmh / 50, 0, 1) * .46;
        millAngle = mod(millAngle + lastDelta * speed, TAU);
      }
      lastMode = mode;
      drawCounts = { weather: 0, seasonal: 0 };
      drawInfo = { millAngle, willowSway: 0, particleCount: 0, mode };
      return motionSeconds;
    }
    function setAmbient(light) {
      const night=clamp(Number(light.night)||0,0,1),dusk=clamp(Number(light.dusk)||0,0,1);
      const key=`${night}:${dusk}`;
      if(key!==ambientKey){ambientKey=key;ambientColors.clear();}
      // Match the painting's two CSS multiply layers exactly, channel by channel.
      const da=dusk*.38,na=night*.83;
      ambient=[250,136,62].map((v,i)=>(1-da+da*v/255)*(1-na+na*[20,38,83][i]/255));
    }
    function ambientColor(color) {
      if(!ambient)return color;
      if(ambientColors.has(color))return ambientColors.get(color);
      let channels;
      if(/^#[\da-f]{6}$/i.test(color))channels=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
      else if(/^rgb\(/.test(color))channels=color.match(/[\d.]+/g)?.slice(0,3).map(Number);
      if(!channels||channels.length!==3)return color;
      const result=`rgb(${channels.map((v,i)=>Math.round(v*ambient[i])).join(',')})`;
      ambientColors.set(color,result);return result;
    }
    function rect(ctx, x, y, w, h, color, alpha = 1) {
      if (alpha <= 0) return;
      ctx.globalAlpha = alpha; ctx.fillStyle = ambientColor(color); ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    }
    function pixelLine(ctx, x1, y1, x2, y2, color, width = 3, alpha = 1) {
      const length = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 2));
      for (let i = 0; i <= length; i++) rect(ctx, mix(x1,x2,i/length), mix(y1,y2,i/length), width, width, color, alpha);
    }
    function drawWindmill(ctx) {
      const hub = anchors.windmill, unit = 3, radius = hub.radius || 78;
      for (let arm = 0; arm < 4; arm++) {
        const angle = millAngle + arm * TAU / 4, c = Math.cos(angle), s = Math.sin(angle);
        for (let radial = 9; radial <= radius; radial += unit) {
          for (let side = -4; side <= (radial > 23 ? 20 : 3); side += unit) {
            const edge = side <= -2 || side >= 18 || radial >= radius - 2 || (radial <= 26 && side > 3);
            const slat = side < 3 || mod(radial - 24, 18) < 3;
            const color = edge ? '#67462d' : slat ? '#b58d52' : side > 12 ? '#e7d5a1' : '#fff0c6';
            const x = hub.x + radial * c - side * s, y = hub.y + radial * s + side * c;
            rect(ctx, x, y, unit + .1, unit + .1, color);
          }
        }
      }
      rect(ctx,hub.x-9,hub.y-6,18,12,'#5f402b'); rect(ctx,hub.x-6,hub.y-9,12,18,'#5f402b');
      rect(ctx,hub.x-6,hub.y-6,12,12,'#b38244'); rect(ctx,hub.x-3,hub.y-5,6,7,'#e8bc68'); rect(ctx,hub.x-1,hub.y-2,3,4,'#f7d889');
    }
    function drawWillow(ctx, p, t) {
      const a = anchors.willow, wind = clamp(weather.windKmh / 32, 0, 1), amp = 1.9 + wind * 7;
      const sway = Math.sin(t * 1.05) * amp + Math.sin(t * .37 + .8) * amp * .35;
      drawInfo.willowSway = sway;
      // Three crooked crown limbs link into the trunk retained by the scene painting.
      const limbs = [[a.x+24,a.y+129,a.x-23,a.y+34],[a.x+27,a.y+123,a.x+61,a.y+35],[a.x+19,a.y+113,a.x-60,a.y+66]];
      limbs.forEach((l,i) => { pixelLine(ctx,...l,'#635139',6); pixelLine(ctx,l[0]-2,l[1],l[2]+sway*.2,l[3],'#a08a50',3); });
      // Dense three-pixel leaf masses. Seasonal thinning shrinks whole crowns,
      // rather than punching checkerboard holes through an otherwise solid tree.
      const clusters = [{x:-27,y:20,rx:48,ry:27},{x:21,y:12,rx:53,ry:29},{x:65,y:30,rx:38,ry:30},{x:-63,y:49,rx:30,ry:28}];
      const crownScale = Math.pow(p.density,.62);
      clusters.forEach((c,k) => {
        if(p.density<.12) return;
        const rx=c.rx*crownScale,ry=c.ry*crownScale;
        for (let y = -ry; y <= ry; y += 3) for (let x = -rx; x <= rx; x += 3) {
          const seed = k*537 + (x+c.rx)*13 + (y+c.ry)*37, r = random(seed);
          const edge=(x/rx)**2+(y/ry)**2;
          if (edge > .91 + r*.14) continue;
          // Coherent upper-left light and lower-right shade; tiny isolated gleams
          // add leaf detail without turning the crown into colored pixel noise.
          const light=clamp(1.55-y/ry*.75-x/rx*.35,0,3);
          const tone=clamp(Math.floor(light+(r>.84?.8:r<.12?-.65:0)),0,3);
          const px=a.x+c.x+x+sway*.25,py=a.y+c.y+y;
          rect(ctx,px,py,3,3,p.colors[tone]);
          if(r>.91 && tone>0 && edge<.82)rect(ctx,px,py,2,1,p.colors[Math.min(3,tone+1)]);
        }
      });
      // Individually hinged fronds: top anchored; leaf tips travel farther in the breeze.
      for (let f = 0; f < 24; f++) {
        const q = f / 23, rootX = a.x - 75 + q * 169, rootY = a.y + 25 + Math.sin(q*Math.PI)*-4 + random(f+54)*23;
        const length = 96 + random(f+19)*76 + Math.sin(q*Math.PI)*13;
        const bend = Math.sin(t * (.85 + f%3*.09) + f*.43) * amp + sway;
        const leafy=random(f*73+291)<p.density;
        let px = rootX, py = rootY;
        for (let segment = 1; segment <= 17; segment++) {
          const r = segment/17, x = rootX + Math.sin(r*2.0+f*.4)*5 + bend*r*r, y = rootY + r*length;
          const branch=p.season==='winter'?'#807351':p.season==='autumn'?'#8a773e':'#6a8137';
          pixelLine(ctx,px,py,x,y,branch,2,.9);
          if (leafy && (r<.82 || random(f+segment*31)<.72)) {
            const dark=p.colors[0],middle=p.colors[1+f%2],tip=p.colors[2+f%2];
            // Leaflets form tapering, overlapping tufts along each hanging spray.
            // Three-pixel silhouettes sit over a shaded stem and avoid long flat bars.
            pixelLine(ctx,px-1,py+1,x-1,y+3,dark,r<.7?4:3,.96);
            rect(ctx,x-4,y-3,3,5,middle);rect(ctx,x-5,y-1,3,3,tip);
            rect(ctx,x+1,y+1,3,5,middle);rect(ctx,x+3,y+2,2,3,tip);
            rect(ctx,x-2,y+4,3,4,middle);rect(ctx,x-2,y+4,2,2,tip);
          }else if(p.id==='late-winter' && segment%5===1 && f%3===0){
            rect(ctx,x-2,y,3,3,p.colors[2]);
          }
          px=x; py=y;
        }
      }
    }
    function drawGroundDetails(ctx, p) {
      const spots = [{x:964,y:956},{x:906,y:730},{x:728,y:742},{x:1017,y:700},{x:1371,y:984},{x:1147,y:952},{x:1040,y:673}];
      const frost = p.season === 'winter' && weather.temp !== null && weather.temp <= 3;
      spots.forEach((spot,i) => {
        for (let j=0;j<6;j++) {
          const x=spot.x+random(i*19+j)*42, y=spot.y+random(i*31+j+12)*15;
          if (p.season==='autumn') {
            const count = p.id==='early-autumn'?2:p.id==='deep-autumn'?4:6;
            if(j>=count) continue;
            rect(ctx,x,y,4+(j%2)*2,2,p.colors[1+j%3],.85); rect(ctx,x+2,y-2,3,3,p.colors[2],.85);
          } else if (frost) {
            rect(ctx,x,y,5,2,'#d9e5d9',.72);rect(ctx,x+2,y-2,2,4,'#edf3de',.66);
          } else if (p.season==='spring' && j < (p.id==='mid-spring'?4:2)) {
            rect(ctx,x+1,y-3,2,6,'#789044');rect(ctx,x-1,y-4,6,3,p.id==='early-spring'?'#f7d9c0':'#f1d3da');rect(ctx,x+1,y-6,2,6,'#fff1c7');
          } else if (p.id==='late-summer') {
            rect(ctx,x,y-3,2,6,'#a6a054',.8);rect(ctx,x-2,y-4,5,2,'#d0ba66',.85);
          }
        }
      });
    }
    function drawBack(ctx, elapsed, light = {}, mode = 'full') {
      const t = beginFrame(elapsed, mode), p = palette();
      ctx.save(); ctx.beginPath(); ctx.rect(0,0,W,H); ctx.clip(); ctx.imageSmoothingEnabled=false;
      setAmbient(light);
      drawWindmill(ctx); drawWillow(ctx,p,t); drawGroundDetails(ctx,p);
      // Weather veils, later characters, and emissive fireflies have independent
      // lighting. Only the solid environment shapes above use this palette.
      ambient=null;
      const night=clamp(Number(light.night)||0,0,1);
      if (weather.active) {
        const cloud = (weather.kind==='thunder' ? .19 : weather.kind==='rain' || weather.kind==='snow' ? .105 : weather.cloud/100*.065)*(1-night*.72);
        rect(ctx,0,0,W,H,'#52667a',cloud);
        if(weather.kind==='fog') {
          for(let i=0;i<5;i++) rect(ctx,0,230+i*164+Math.sin(t*.12+i)*6,W,98,'#dbe3d7',.06+weather.intensity*.035);
        }
      }
      ctx.restore();
    }
    function seasonalParticles(ctx,p,t,light,mode) {
      const factor=mode==='gentle'?.5:1;
      if(mode!=='still') {
        const petals=Math.ceil(p.petals*factor), leaves=Math.ceil(p.leaves*factor);
        for(let i=0;i<petals+leaves;i++) {
          const leaf=i>=petals, duration=leaf?20:26;
          const age=mod(t+random(i+822)*duration,duration)/duration;
          const x=570+random(i+31)*900+Math.sin(age*7+i)*17+age*(20+weather.windKmh*1.4);
          const y=140+age*810;
          if(x>W-5) continue;
          const color=leaf?p.colors[1+i%3]:i%3?'#f7dfe2':'#fff3d7';
          rect(ctx,x,y,leaf?5:4,3,color,.80);rect(ctx,x+2+Math.sin(age*10+i)*2,y-2,3,leaf?5:3,color,.80); drawCounts.seasonal++;
        }
      }
      if(light.night>.5 && p.fireflies && weather.kind!=='rain' && weather.kind!=='thunder' && weather.kind!=='snow') {
        const count=Math.ceil(p.fireflies*factor);
        for(let i=0;i<count;i++) {
          const x=880+random(i+612)*480+Math.sin(t*.65+i)*11,y=695+random(i+133)*255+Math.cos(t*.43+i)*8;
          const alpha=(.33+Math.sin(t*1.7+i)*.2)*light.night;
          rect(ctx,x-2,y-2,7,7,'#dce89a',alpha*.16);rect(ctx,x,y,3,3,'#f3f4ab',alpha);drawCounts.seasonal++;
        }
      }
    }
    function weatherParticles(ctx,t,mode) {
      if(!weather.active || mode==='still') return;
      const kind=weather.kind, gentle=mode==='gentle'?.5:1;
      if(kind==='rain'||kind==='thunder') {
        const count=Math.round((36+weather.intensity*74)*gentle), drift=15+weather.windKmh*2;
        for(let i=0;i<count;i++) {
          const duration=1.7+random(i+100)*.6, age=mod(t+random(i+27)*duration,duration)/duration;
          const x=mod(random(i+1)*W+age*drift,W), y=age*(H+25)-20;
          const len=9+weather.intensity*7;
          pixelLine(ctx,x,y,x-3-weather.windKmh*.07,y+len,'#d7e5ed',2,.32);drawCounts.weather++;
        }
        // Rain rings are restricted to open pond water, not the banks or path.
        for(let i=0;i<6;i++) {
          const age=mod(t+i*.317,1), x=1110+i*43,y=805+(i%3)*25;
          rect(ctx,x-age*6,y,age*12+2,1,'#c7e6e5',.32*(1-age));
        }
      } else if(kind==='snow') {
        const count=Math.round((28+weather.intensity*46)*gentle);
        for(let i=0;i<count;i++) {
          const duration=12+random(i+17)*8, age=mod(t+random(i+142)*duration,duration)/duration;
          const x=mod(random(i+26)*W+Math.sin(age*8+i)*21+age*weather.windKmh*3,W),y=age*(H+8)-4;
          const size=i%4?3:5;rect(ctx,x,y,size,size,'#eff4ee',.62);drawCounts.weather++;
        }
      }
    }
    function drawFront(ctx,elapsed,light={},mode='full') {
      // drawBack advances the shared clock once; this layer only reads it.
      const p=palette(),t=motionSeconds;
      ctx.save();ctx.beginPath();ctx.rect(0,0,W,H);ctx.clip();ctx.imageSmoothingEnabled=false;
      seasonalParticles(ctx,p,t,light,mode);weatherParticles(ctx,t,mode);
      ctx.restore();drawInfo.particleCount=drawCounts.seasonal+drawCounts.weather;
    }
    notify();
    return { updateTime,setWeather,setPreview,clearPreview,drawBack,drawFront,getState };
  }
  return { PHASES,phaseAt,normalizeWeather,create };
});
