/* ============================================================
   app.js — 分层主页体系共享逻辑
   模块：图标 / 状态灯 / 贪吃蛇存储热力图 / 节假日（纪念日与标签由 home-journal-v14.js 负责）
   依赖：无。数据：/data/status.json（collector 产物）
   ============================================================ */
"use strict";

/* ---------- 统一 SVG 图标集（线性，stroke 继承 currentColor） ---------- */
const ICONS = {
  brain:  '<path d="M12 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5.2A3 3 0 0 0 9 18a3 3 0 0 0 3 1.8V4Z"/><path d="M12 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5.2A3 3 0 0 1 15 18a3 3 0 0 1-3 1.8V4Z"/>',
  monitor:'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  mouse:  '<rect x="8" y="3" width="8" height="12" rx="4"/><path d="M12 7v3"/>',
  mic:    '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  image:  '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 19 5-5 3 3 3-3 3 3"/>',
  db:     '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  memory: '<rect x="4" y="7" width="16" height="12" rx="2"/><path d="M8 3v4M16 3v4M12 3v4"/><path d="M8 12h2v3H8zM14 12h2v3h-2z"/>',
  film:   '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  down:   '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v3h16v-3"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  nas:    '<rect x="3" y="5" width="18" height="6" rx="2"/><rect x="3" y="13" width="18" height="6" rx="2"/><path d="M7 8h.01M7 16h.01"/>',
  lock:   '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  globe:  '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.3-4.3"/>',
  tool:   '<path d="M14.5 6.5a4 4 0 0 0-5.6 4.9L3 17.3V21h3.7l5.9-5.9a4 4 0 0 0 4.9-5.6l-2.8 2.8-2.1-2.1 2.9-2.7Z"/>',
  book:   '<path d="M4 5a2 2 0 0 1 2-2h14v18H6a2 2 0 0 0-2 2V5Z"/><path d="M4 19a2 2 0 0 1 2-2h14"/>',
  cal:    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  heart:  '<path d="M12 20s-7.5-4.6-9.3-9A5.2 5.2 0 0 1 12 6.5 5.2 5.2 0 0 1 21.3 11c-1.8 4.4-9.3 9-9.3 9Z"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  gauge:  '<path d="M12 15l4-6"/><circle cx="12" cy="14" r="1.5"/><path d="M4.5 18a9.5 9.5 0 1 1 15 0"/>',
  pen:    '<path d="M4 20 5 16l11-11a2.4 2.4 0 0 1 3.4 3.4L8.4 19 4 20Z"/>',
  eye:    '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  user:   '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-5.5 8-5.5S18.5 17 20 21"/>',
};
function icon(name){
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.globe}</svg>`;
}

/* ---------- 状态数据：硬件 10 秒，完整采集 60 秒 ---------- */
let STATUS = null, STATUS_BASE = null, STATUS_LIVE = null, STATUS_PENDING = null;
const STATUS_META = {loading:false, baseError:false, liveError:false, baseTs:null, cpuTs:null, gpuTs:null,
  baseStale:true, hardwareStale:true, partial:false, fieldTs:{}, fieldSources:{}, checkedAt:null};
const STATUS_FIELDS = ['load','cores','mem_used','mem_total','swap_used','uptime_s','cpu_temp','gpus','gpu_apps'];
const STATUS_CPU_FIELDS = ['load','mem_used','mem_total','uptime_s'];
let statusTimer = null, statusLastAttempt = -Infinity;
const statusObject = value => !!value && typeof value==='object' && !Array.isArray(value);
const statusTimestamp = value => typeof value==='number' && Number.isFinite(value) && value>0 && value<=Date.now()/1000+60;
const statusAge = ts => Number.isFinite(ts) ? Math.max(0,Date.now()/1000-ts) : Infinity;
function statusFieldValid(key,value){
  if(key==='gpus'||key==='gpu_apps') return Array.isArray(value) && value.every(statusObject);
  if(key==='load') return typeof value==='string' && /^\s*\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s*$/.test(value);
  return typeof value==='number' && Number.isFinite(value) && value>=0;
}
async function readStatusSnapshot(url,live){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch(url,{cache:'no-store',signal:controller.signal});
    if(!response.ok) throw new Error('Status unavailable');
    const value=await response.json();
    if(!statusObject(value)||!statusTimestamp(value.ts)||!statusObject(value.hardware)||
      (live&&(value.version!==1||!Array.isArray(value.errors)))) throw new Error('Invalid status snapshot');
    return value;
  }finally{clearTimeout(timeout);}
}
function mergeStatus(){
  const base=STATUS_BASE,live=STATUS_LIVE,hardware={...(base&&base.hardware||{})},fieldTs={},fieldSources={};
  let partial=!!(live&&live.errors.length);
  STATUS_FIELDS.forEach(key=>{
    if(base&&Object.prototype.hasOwnProperty.call(hardware,key)){fieldTs[key]=base.ts;fieldSources[key]='base';}
    if(live&&(!base||live.ts>=base.ts)&&Object.prototype.hasOwnProperty.call(live.hardware,key)){
      if(statusFieldValid(key,live.hardware[key])&&!live.errors.includes(key)){
        hardware[key]=live.hardware[key];fieldTs[key]=live.ts;fieldSources[key]='live';
      }else partial=true;
    }
  });
  const cpuTimes=STATUS_CPU_FIELDS.map(key=>fieldTs[key]);
  const cpuTs=cpuTimes.every(Number.isFinite)?Math.min(...cpuTimes):null,gpuTs=fieldTs.gpus??null;
  Object.assign(STATUS_META,{baseTs:base?base.ts:null,cpuTs,gpuTs,fieldTs,fieldSources,partial,
    baseStale:!base||statusAge(base.ts)>180,
    hardwareStale:statusAge(cpuTs)>30||statusAge(gpuTs)>30});
  // Never replace the full snapshot timestamp with the fast hardware timestamp.
  STATUS=base||live?{...(base||{}),ts:base?base.ts:null,hardware}:null;
}
function loadStatus(){
  if(STATUS_PENDING) return STATUS_PENDING;
  statusLastAttempt=Date.now();STATUS_META.loading=true;
  document.dispatchEvent(new CustomEvent('status-loading'));
  STATUS_PENDING=Promise.allSettled([
    readStatusSnapshot('/data/status.json',false),readStatusSnapshot('/data/live.json',true)
  ]).then(([base,live])=>{
    STATUS_META.baseError=base.status!=='fulfilled';STATUS_META.liveError=live.status!=='fulfilled';
    // An older response must not replace an already newer successful sample.
    if(base.status==='fulfilled'&&(!STATUS_BASE||base.value.ts>=STATUS_BASE.ts)) STATUS_BASE=base.value;
    if(live.status==='fulfilled'&&(!STATUS_LIVE||live.value.ts>=STATUS_LIVE.ts)) STATUS_LIVE=live.value;
    STATUS_META.checkedAt=Date.now();mergeStatus();
  }).finally(()=>{
    STATUS_META.loading=false;STATUS_PENDING=null;
    document.dispatchEvent(new CustomEvent('status-ready'));
  });
  return STATUS_PENDING;
}
function refreshVisibleStatus(){
  if(!document.hidden&&Date.now()-statusLastAttempt>=1000) return loadStatus();
}
function startStatusUpdates(){
  if(statusTimer!==null) return;
  // Install recovery before the initial request; a timeout must not stop polling.
  statusTimer=setInterval(refreshVisibleStatus,10000);
  document.addEventListener('visibilitychange',refreshVisibleStatus);
  ['focus','pageshow','online'].forEach(name=>window.addEventListener(name,refreshVisibleStatus));
  refreshVisibleStatus();
}
function appState(name){
  if(STATUS_META.baseError||STATUS_META.baseStale) return 'unknown';
  const item=STATUS&&STATUS.apps&&STATUS.apps[name];
  return item&&item.up===true?'on':item&&item.up===false?'off':'unknown';
}
const appUp = name => appState(name)==='on';

/* ---------- 状态灯 ---------- */
const LIGHT_NAME = {strata:"示例 AI",studio:"AI 工作台",hermes:"Hermes WebUI",emby:"Emby",dsm:"群晖",vault:"密码库",
  caddy:"门厅",gatekeeper:"认证",searxng:"搜索",mihomo:"代理",unraid:"unRAID"};
function renderLights(el){
  if(!STATUS){ el.innerHTML = '<span class="light">状态数据未就绪</span>'; return; }
  const keys = JSON.parse(el.dataset.lights || "[]");
  el.innerHTML = keys.map(k=>{
    const state = appState(k);
    return `<span class="light" title="${state==='unknown'?'状态待更新':state==='on'?'在线':'不可达'}"><span class="dot ${state==='unknown'?'':state}"></span>${LIGHT_NAME[k]||k}</span>`;
  }).join("");
}

/* ---------- 贪吃蛇存储热力图 ----------
   行 = 存储区（挂载点），该行被占用的格子数 ∝ 使用率
   列 = 物理盘（DISK_OK），格子颜色 ∝ 温度
   蛇身连续穿行于格子之间，视觉上仍是一条蛇 */
function usedT(b){
  if(!isFinite(b)) return "—";
  const t = b/1099511627776;
  return t>=1 ? t.toFixed(1)+"T" : (b/1073741824).toFixed(0)+"G";
}

function renderSnake(el){
  if(!STATUS || !STATUS.snake){ el.innerHTML = '<p class="empty-hint">等待采集数据…</p>'; return; }
  const {rows, cols} = STATUS.snake;
  // 列数随卡片宽度自适应：窄卡 14 列，宽卡 28 列，格子始终保持"贡献图"那种小方块
  const cw = el.clientWidth || 600;
  const W = cw > 900 ? 32 : cw > 700 ? 24 : cw > 520 ? 18 : 12;
  const tempTone = (t)=> t==null ? "temp-na" : t>=45 ? "crit" : t>=40 ? "hot" : "temp-ok";

  // 连续蛇身：从左上起笔逐行折返，每行接着上一行的落点走，保证一笔连到底
  const body = rows.map(()=>new Array(W).fill(null));
  let ci = 0, head = null;
  rows.forEach((r,ri)=>{
    const n = Math.max(r.pct>0?1:0, Math.round(r.pct/100*W));
    const tone = r.pct>=90 ? "hot" : r.pct>=75 ? "f2" : "f";
    for(let k=0;k<n;k++){
      ci = Math.max(0, Math.min(W-1, ci));
      body[ri][ci] = {tone, tip:`${r.label} · 已用 ${r.pct}%`};
      head = {ri, ci};
      if(ri%2===0) ci += 1; else ci -= 1;
    }
    // 落点留在本行蛇尾一侧，供下一行接着画
    ci = Math.max(0, Math.min(W-1, ri%2===0 ? ci-1 : ci+1));
  });

  let html = '<div class="snake-grid" style="grid-template-columns:auto repeat('+W+',minmax(0,1fr))">';
  rows.forEach((r,ri)=>{
    html += `<div class="lab">${r.label.replace("/mnt/","")}<span class="pct"> ${r.pct}%</span></div>`;
    for(let c=0; c<W; c++){
      const b = body[ri][c];
      const isHead = head && head.ri===ri && head.ci===c;
      const cls = !b ? "cell" : (isHead ? "cell head" : "cell "+b.tone);
      html += `<div class="${cls}" title="${b ? b.tip : "空闲"}"></div>`;
    }
  });
  // 尾随一行：盘温（颜色只表温度）
  const revT = rows.length%2===1;
  html += '<div class="lab">盘温</div>';
  for(let c=0; c<W; c++){
    const d = cols.length ? cols[(revT ? W-1-c : c) % cols.length] : null;
    html += d ? `<div class="cell ${tempTone(d.temp)}" title="${d.label} · ${d.temp??"?"}°C"></div>` : '<div class="cell"></div>';
  }
  html += '</div>';
  const usedB = rows.reduce((a,r)=>a+(r.used||0),0);
  const totalB = rows.reduce((a,r)=>a+(r.size||0),0);
  html += `<div class="snake-legend">
    <span><span class="sw" style="background:var(--snake)"></span>已用</span>
    <span><span class="sw" style="background:var(--snake2)"></span>占用≥75%</span>
    <span><span class="sw" style="background:var(--warn)"></span>占用≥90%</span>
    <span><span class="sw" style="background:var(--bg2);border:1px solid var(--line2)"></span>空闲</span>
    <span><span class="sw" style="background:var(--line2)"></span>盘温正常</span>
    <span><span class="sw" style="background:var(--bad)"></span>盘温≥45°C</span>
    <span style="margin-left:auto">合计 ${usedT(usedB)} / ${usedT(totalB)}</span>
  </div>
  <div class="snake-tip">蛇身一笔连到底：每格 = 该存储区容量的 1/${W}，蛇头停在最后一块有数据的存储区；末行是磁盘温度 · 数据 ${new Date(STATUS.ts*1000).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})} 采集</div>`;
  el.innerHTML = html;
}


/* ---------- 中国节假日 / 休假安排 ---------- */
// 优先本地（数据不出门），外网仅作兜底
const HOLIDAY_DAY_MS = 86400000;
const HOLIDAY_CLOCK = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit"});
const HOLIDAY_VIEWS = new WeakMap();
const HOLIDAY_LOADS = new Map();
function holidayDate(instant = new Date()){
  const parts = Object.fromEntries(HOLIDAY_CLOCK.formatToParts(instant).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
// UTC is used only for arithmetic on calendar dates, never to truncate a local midnight.
function holidayEpoch(dateStr){ return Date.parse(dateStr+"T00:00:00Z"); }
function holidayOffset(dateStr, count){ return new Date(holidayEpoch(dateStr)+count*HOLIDAY_DAY_MS).toISOString().slice(0,10); }
function holidayDistance(from, to){ return Math.round((holidayEpoch(to)-holidayEpoch(from))/HOLIDAY_DAY_MS); }
function holidayWeekday(dateStr){ return new Date(holidayEpoch(dateStr)).getUTCDay(); }
function holidayText(value){ return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function normalizeHolidays(value, year){
  if(!value || !Array.isArray(value.days) || (value.year!=null && Number(value.year)!==year)) return null;
  const seen = new Set();
  for(const day of value.days){
    if(!day || typeof day.date!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
       !Number.isFinite(holidayEpoch(day.date)) || holidayOffset(day.date,0)!==day.date ||
       typeof day.isOffDay!=="boolean" || typeof day.name!=="string" || !day.name.trim() || seen.has(day.date)) return null;
    seen.add(day.date);
  }
  const days = value.days.filter(day=>day.date.startsWith(year+"-")).sort((a,b)=>a.date.localeCompare(b.date));
  return days.length ? {year, days} : null;
}
async function getHolidays(year = Number(holidayDate().slice(0,4))){
  const key = "gk_holidays_v15_"+year;
  try{
    const cache = JSON.parse(localStorage.getItem(key) || "null");
    const age = cache ? Date.now()-cache.t : -1;
    const normalized = cache && normalizeHolidays(cache.d, year);
    if(normalized && Number.isFinite(cache.t) && age>=0 && age<HOLIDAY_DAY_MS*7) return normalized;
  }catch{}
  if(HOLIDAY_LOADS.has(year)) return HOLIDAY_LOADS.get(year);
  const pending = (async()=>{
    const urls = document.documentElement.dataset.demo === 'true' ? ["/api/holidays"] : ["/api/holidays", `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`];
    for(const url of urls){
      try{
        const response = await fetch(url, {cache:"no-cache", signal:AbortSignal.timeout(6000)});
        if(!response.ok) continue;
        const data = normalizeHolidays(await response.json(), year);
        if(!data) continue;
        try{ localStorage.setItem(key, JSON.stringify({t:Date.now(), d:data})); }catch{}
        return data;
      }catch{}
    }
    return null;
  })();
  HOLIDAY_LOADS.set(year,pending);
  try{ return await pending; }finally{ HOLIDAY_LOADS.delete(year); }
}
function isWorkday(dateStr, days){
  const hit = days.find(d=>d.date===dateStr);
  if(hit) return hit.isOffDay ? false : true;   // 调休上班日也在这里
  const wd = holidayWeekday(dateStr);
  return wd>=1 && wd<=5;
}
function renderHoliday(el){
  const todayStr = holidayDate();
  const year = Number(todayStr.slice(0,4));
  const view = {date:todayStr, attempted:Date.now(), failed:false};
  HOLIDAY_VIEWS.set(el,view);
  return getHolidays(year).then(h=>{
    if(HOLIDAY_VIEWS.get(el)!==view) return;
    if(holidayDate()!==todayStr) return renderHoliday(el);
    const weekday = "日一二三四五六"[holidayWeekday(todayStr)];
    const dateLabel = `${Number(todayStr.slice(5,7))}月${Number(todayStr.slice(8))}日 · 周${weekday}`;
    if(!h){
      view.failed=true;
      el.innerHTML=`<div class="holi-main"><span class="holi-nm">${dateLabel}</span></div><p class="empty-hint">${year} 年调休安排暂不可用，稍后自动重试。</p>`;
      return;
    }
    const days = h.days;
    let next = null;
    for(const d of days){ if(d.isOffDay && d.date >= todayStr){ next = d; break; } }
    let nextWork = null;
    for(let i=0;i<40;i++){
      const s=holidayOffset(todayStr,i);
      if(!s.startsWith(year+"-")) break; // Do not guess next year's unpublished adjustments.
      if(isWorkday(s,days)){ nextWork=s; break; }
    }
    const rest = next ? holidayDistance(todayStr,next.date) : null;
    const workIn = nextWork ? holidayDistance(todayStr,nextWork) : null;
    const todayOff = !isWorkday(todayStr, days);
    let holidayNow = null;
    if(todayOff){
      const hit = days.find(d=>d.date===todayStr);
      holidayNow = hit ? hit.name : "休息日";
    }
    let html = "";
    if(holidayNow){
      const label = days.some(d=>d.date===todayStr) ? `今天是「${holidayText(holidayNow)}」假期` : "今天是周末休息日";
      html += `<div class="holi-main"><span class="holi-days">休</span><span class="holi-nm">${label}</span></div>`;
      html += `<div class="holi-sub">${dateLabel} · ${workIn===null?"后续调休安排待更新":"下次上班："+workIn+" 天后"}</div>`;
    } else {
      const adjusted = days.some(d=>d.date===todayStr && !d.isOffDay);
      html += `<div class="holi-main"><span class="holi-days">班</span><span class="holi-nm">今天是${adjusted?"调休工作日":"工作日"}</span></div>`;
      html += `<div class="holi-sub">${dateLabel}${next && rest!==null?` · ${rest} 天后是${holidayText(next.name)}`:""}</div>`;
    }

    // 明天是否补班（周末调休上班）
    const tmrStr = holidayOffset(todayStr,1);
    const tmrWeekday = holidayWeekday(tmrStr);
    const tmrHit = days.find(d=>d.date===tmrStr && !d.isOffDay);
    if(tmrHit && (tmrWeekday===0 || tmrWeekday===6)){
      html += `<div class="holi-next"><span class="workday">明天（${tmrWeekday===6?"周六":"周日"}）因「${holidayText(tmrHit.name)}」调休补班</span></div>`;
    }

    // 后续假期清单：填满卡片，顺手给出全年节奏
    const groups = [];
    let curG = null;
    for(const d of days){
      if(!d.isOffDay) continue;
      if(d.date < todayStr && !(holidayNow && d.name===holidayNow)) continue;
      if(curG && curG.name===d.name){ curG.end = d.date; }
      else { curG = {name:d.name, start:d.date, end:d.date}; groups.push(curG); }
    }
    let up = groups.filter(g=>g.end >= todayStr).slice(0,3);
    // 本年已无假期时，改为展示全年节奏，不留空卡
    if(!up.length){
      const year = todayStr.slice(0,4);
      const all = [];
      let g2 = null;
      for(const d of days){
        if(!d.isOffDay || !d.date.startsWith(year)) continue;
        if(g2 && g2.name===d.name){ g2.end = d.date; }
        else { g2 = {name:d.name, start:d.date, end:d.date}; all.push(g2); }
      }
      if(all.length){
        html += `<div class="holi-note">${year} 年已无后续公共假期 · 周末照常按调休安排判断</div>`;
        html += `<div class="holi-list">` + all.map(g=>{
          const label = g.start===g.end ? g.start.slice(5) : g.start.slice(5)+" – "+g.end.slice(5);
          const past = g.end < todayStr;
          return `<div class="holi-row ${past?"past":""}"><span class="hn">${holidayText(g.name)}</span><span class="hd">${label}</span><span class="hc">${past?"已过":"待放"}</span></div>`;
        }).join("") + `</div>`;
      }
      // 给空位一个用途：提示当前所处阶段
      html += `<div class="holi-foot">今天${holidayNow?"在假期中":"是工作日"} · 距下次上班 ${workIn===null?"—":workIn+" 天"}</div>`;
    } else if(up.length){
      html += `<div class="holi-list">` + up.map(g=>{
        const n = holidayDistance(todayStr,g.start);
        const label = g.start===g.end ? g.start.slice(5) : g.start.slice(5)+" – "+g.end.slice(5);
        return `<div class="holi-row"><span class="hn">${holidayText(g.name)}</span><span class="hd">${label}</span><span class="hc">${n<=0?"进行中":n+" 天"}</span></div>`;
      }).join("") + `</div>`;
    }
    el.innerHTML = html;
  });
}
function refreshHolidays(){
  const date = holidayDate();
  document.querySelectorAll("[data-holiday]").forEach(el=>{
    const view = HOLIDAY_VIEWS.get(el);
    if(!view || view.date!==date || (view.failed && Date.now()-view.attempted>=300000)) renderHoliday(el);
  });
}
function startHolidayUpdates(){
  if(!document.querySelectorAll("[data-holiday]").length) return;
  refreshHolidays();
  setInterval(refreshHolidays,60000);
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) refreshHolidays(); });
  window.addEventListener("focus",refreshHolidays);
  window.addEventListener("pageshow",refreshHolidays);
}

/* ---------- 应用状态点（统一绑定 [data-app]） ---------- */
const APP_ALIAS = { photos:"dsm", vault:"vault" };
function bindAppDots(){
  document.querySelectorAll("[data-app]").forEach(el=>{
    const k = APP_ALIAS[el.dataset.app] || el.dataset.app;
    const state=appState(k);
    el.className = 'dot '+(state==='unknown'?'':state);
    el.title = state==='unknown'?'状态待更新':state==='on'?'在线':'不可达';
  });
}

/* ---------- 初始化 ---------- */
function renderStatusWidgets(){
  document.querySelectorAll("[data-lights]").forEach(renderLights);
  bindAppDots();
  document.querySelectorAll("[data-snake]").forEach(renderSnake);
}
document.addEventListener('status-ready',renderStatusWidgets);
document.addEventListener("DOMContentLoaded", ()=>{
  startHolidayUpdates();
  startStatusUpdates();
  // Personal notes and anniversaries are owned by home-journal-v14.js.
});
