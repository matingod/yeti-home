/* Read-only rendering. Uses the shared collector refresh; never writes to a service. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite = n => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n));
  const percent = n => finite(n) ? Math.max(0, Math.min(100, Math.round(Number(n)))) : null;
  const ratio = (used,total) => finite(used) && finite(total) && Number(total)>0 ? percent(Number(used)/Number(total)*100) : null;
  const gb = n => finite(n) ? (Number(n)/1073741824).toFixed(1) : '—';
  const tb = n => finite(n) ? (Number(n)/1099511627776).toFixed(1) : '—';
  const duration = s => { if(!finite(s)) return '—'; const n=Number(s),d=Math.floor(n/86400),h=Math.floor(n%86400/3600),m=Math.floor(n%3600/60); return (d?d+'天 ':'')+h+'小时 '+m+'分'; };
  const detailedIcons = new Set(['cpu','thermometer','memory','clock','gpu','disk','calendar','studio','vault','film','nas']);
  const icon = name => (detailedIcons.has(name)?'/static/server-icons-v5/':'/static/pixel/')+name+'.svg';
  const names={studio:'示例工作台',vault:'示例密码库',emby:'示例影视库',dsm:'示例存储',caddy:'示例网关'};
  const serviceIcon={studio:'studio',vault:'vault',emby:'film',dsm:'nas',caddy:'home'};
  const serviceUrl = () => '/demo-unavailable/';
  const meta = () => typeof STATUS_META==='undefined'?{baseStale:true,hardwareStale:true,fieldTs:{},fieldSources:{}}:STATUS_META;
  const age = ts => finite(ts)?Math.max(0,Math.floor(Date.now()/1000-Number(ts))):null;
  const ageText = ts => {const value=age(ts);return value===null?'尚无采集':value<60?value+' 秒前':value<3600?Math.floor(value/60)+' 分 '+value%60+' 秒前':Math.floor(value/3600)+' 小时前';};
  const clockText = ts => finite(ts)?new Date(Number(ts)*1000).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
  function fieldNote(keys){
    const m=meta(),times=keys.map(key=>m.fieldTs[key]);
    if(times.some(ts=>age(ts)===null)) return ' · 未采集完整';
    if(times.some(ts=>age(ts)>30)) return ' · 历史数据，待更新';
    return keys.some(key=>m.fieldSources[key]!=='live')?' · 完整采集数据':'';
  }
  function refreshControl(){
    const button=$('refresh-status');if(!button)return;
    button.disabled=!!meta().loading;button.textContent=meta().loading?'正在刷新…':'立即刷新';
    button.setAttribute('aria-busy',String(!!meta().loading));
  }
  function renderTimes(){
    const m=meta();
    const hardware=m.cpuTs===m.gpuTs?'CPU/GPU '+clockText(m.cpuTs)+'（'+ageText(m.cpuTs)+'）':
      'CPU '+clockText(m.cpuTs)+'（'+ageText(m.cpuTs)+'） · GPU '+clockText(m.gpuTs)+'（'+ageText(m.gpuTs)+'）';
    $('upd').textContent=hardware+' · 服务/存储 '+clockText(m.baseTs)+'（'+ageText(m.baseTs)+'）'+
      (m.baseStale||m.hardwareStale?' · 有数据待更新':'')+(m.baseError||m.liveError?' · 本次读取未完整成功':'');
    refreshControl();
  }
  function metric(label,p,kind='') { return `<div class="metric-row ${kind}"><span>${label}</span><span class="bar" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" ${p===null?'aria-valuetext="无数据"':`aria-valuenow="${p}"`}><i style="width:${p??0}%"></i></span><span class="value">${p===null?'—':p+'%'}</span></div>`; }
  // AI reachability alone is not a failure: use passive lifecycle observations.
  const managedKeys=new Set();
  function managedState(key){
    if(!managedKeys.has(key))return null;
    const o=window.YETI_AI_OBSERVATION,service=o&&o.services&&o.services[key];
    if(!o||!o.fresh||!service||!finite(service.observedAt)||Date.now()-Number(service.observedAt)>15000)return 'unknown';
    if(service.runState==='sleeping')return 'sleeping';
    if(['disabled','draining'].includes(service.admission))return service.admission;
    if(['unhealthy','failed','error'].includes(service.health))return 'down';
    return service.health==='healthy'?'up':'unknown';
  }
  function serviceRow([key,value]) {
    const outdated=meta().baseStale||meta().baseError;
    const managed=managedState(key);const state=managed|| (outdated?'unknown':value&&value.up===true?'up':value&&value.up===false?'down':'unknown');
    return `<a class="service-row" id="service-${escape(key)}" href="${escape(serviceUrl(key))}" target="_blank" rel="noopener"><img src="${icon(serviceIcon[key]||'gpu')}" alt=""><span class="service-name">${escape(names[key]||key)}</span><span class="service-state ${state}">${state==='up'?'在线':state==='down'?'故障':state==='sleeping'?'休眠（按需）':state==='draining'?'排空中':state==='disabled'?'已停用':outdated?'待更新':'待核'}</span></a>`;
  }
  function renderMap(data,storage) {
    const rows=Array.isArray(data&&data.rows)?data.rows:(storage.mounts||[]).map(m=>({label:m.path,pct:m.pct,used:m.used,size:m.size}));
    const disks=Array.isArray(data&&data.cols)?data.cols:[];
    const box=$('storage-map');
    if(!rows.length&&!disks.length){box.innerHTML='<p class="server-empty">暂无存储采集数据</p>';$('map-total').textContent='';return;}
    const columns=window.innerWidth<680?18:28;
    const cells=[];
    rows.forEach(row=>{
      const p=percent(row.pct),count=p===null?0:Math.round(p/100*columns);
      for(let i=0;i<columns;i++)cells.push(`<span class="map-cell ${i<count?'used':''}" title="${escape(row.label||'存储区')} · 已用 ${p===null?'未知':p+'%'} · ${tb(row.used)} / ${tb(row.size)} TB"></span>`);
    });
    // Each disk is represented once. Padding is unassigned, never a second temperature reading.
    if(disks.length){const diskRows=Math.ceil(disks.length/columns);for(let i=0;i<diskRows*columns;i++){
      const d=disks[i];if(!d){cells.push('<span class="map-cell" aria-hidden="true"></span>');continue;}
      const tone=!finite(d.temp)?'':Number(d.temp)>=45?'critical':Number(d.temp)>=40?'hot':'warm';
      cells.push(`<span class="map-cell ${tone}" title="${escape(d.label||'磁盘')} · ${finite(d.temp)?escape(d.temp)+'°C':'温度未采集'}"></span>`);
    }}
    box.innerHTML=`<div class="storage-map-grid" style="--map-columns:${columns}" role="img" aria-label="${rows.length} 个存储区使用率；末行显示磁盘温度，详细数据可在下方展开">${cells.join('')}</div>`;
    $('map-total').textContent='合计 '+tb(rows.reduce((n,r)=>n+(Number(r.used)||0),0))+' / '+tb(rows.reduce((n,r)=>n+(Number(r.size)||0),0))+' TB';
    $('map-hint').textContent='每行一个存储区 · 末行盘温 · 悬停查看数值'+(meta().baseStale||meta().baseError?' · 历史数据，待更新':'');
  }
  function render(){
    const data=typeof STATUS==='undefined'?null:STATUS;
    renderTimes();
    if(!data){
      $('verdict').className='server-verdict is-unknown';
      $('verdict').innerHTML='<span class="verdict-icon" aria-hidden="true">?</span><strong>状态暂不可用</strong><span class="verdict-copy">未取得采集数据，前台每 10 秒自动重试，也可立即刷新。</span>';
      for(const id of ['hw-kv','gpu-bars','storage-map','app-grid','app-more-list','sto-bars','hw-disks'])$(id).innerHTML='<p class="server-empty">等待采集数据…</p>';
      $('map-total').textContent='';$('alert-details').innerHTML='';$('vm-details').textContent='';$('app-more').hidden=true;
      return;
    }
    const focusedId=document.activeElement&&document.activeElement.id;
    const opened=new Set([...document.querySelectorAll('details[open][id]')].map(el=>el.id));
    const hw=data.hardware||{},storage=data.storage||{},apps=data.apps||{};
    const gpus=Array.isArray(hw.gpus)?hw.gpus:[],disks=Array.isArray(hw.disks)?hw.disks:[],processes=Array.isArray(hw.gpu_apps)?hw.gpu_apps:[],vms=Array.isArray(hw.vms)?hw.vms:[];
    const entries=Object.entries(apps).filter(([k,v])=>k!=='voice_detail'&&v&&typeof v==='object');
    const alerts=[];
    const m=meta(),baseCurrent=!m.baseStale&&!m.baseError,gpuCurrent=age(m.gpuTs)!==null&&age(m.gpuTs)<=30;
    const freshness=[];
    if(m.baseError)freshness.push('服务/存储读取失败，保留上次采集供参考');
    else if(m.baseStale)freshness.push('服务/存储数据已过期，请等待采集更新');
    if(m.liveError)freshness.push('实时硬件读取失败，正在自动重试');
    if(m.hardwareStale)freshness.push('部分硬件数据已过期');
    if(m.partial)freshness.push('部分硬件未采集成功，已标注历史数据');
    if(!Array.isArray(hw.gpus)||!Array.isArray(hw.disks)||!Array.isArray(storage.mounts)||!entries.length)alerts.push('部分状态字段尚未采集');
    if(gpuCurrent)gpus.forEach(g=>{if(finite(g.temp)&&Number(g.temp)>=80)alerts.push('GPU '+g.idx+' 温度 '+g.temp+'°C');});
    if(baseCurrent){
      disks.filter(d=>d.ok===false).forEach(d=>alerts.push((d.name||d.dev||'磁盘')+' '+(d.status||'异常')));
      entries.forEach(([k,v])=>{if(managedKeys.has(k)?managedState(k)==='down':v.up===false)alerts.push((names[k]||k)+' 不可达');});
      if(storage.sync_action&&storage.sync_action!=='idle')alerts.push('磁盘任务进行中：'+storage.sync_action);
    }
    const tight=gpus.filter(g=>(ratio(g.mem_used,g.mem_total)??0)>=90),up=entries.filter(([k,v])=>managedKeys.has(k)?managedState(k)==='up':v.up===true).length;
    if(entries.some(([k])=>managedKeys.has(k)&&managedState(k)==='unknown'))freshness.push('AI管理观测待核，不按端口不可达判故障');
    const messages=[...freshness,...alerts];
    const statusCopy=messages.length?messages.slice(0,3).join(' · ')+(messages.length>3?' 等 '+messages.length+' 项':''):(tight.length?tight.length+' 张显卡显存 ≥90% · ':'')+gpus.length+' 张显卡 · '+up+' / '+entries.length+' 项服务在线';
    $('verdict').className='server-verdict '+(freshness.length?'is-unknown':alerts.length?'is-warning':'is-ok');
    $('verdict').innerHTML=`<span class="verdict-icon" aria-hidden="true">${messages.length?'!':'✓'}</span><strong>${freshness.length?'数据待更新':alerts.length?'需要关注的服务':'服务器运行正常'}</strong><span class="verdict-copy">${escape(statusCopy)}</span><a class="verdict-more" id="status-details-link" href="#server-details">查看详情 →</a>`;
    $('alert-details').innerHTML=messages.length?'<ul class="alert-detail-list">'+messages.map(t=>'<li>'+escape(t)+'</li>').join(''):'<p class="vm-detail">当前采集未报告服务或磁盘异常。</p>';
    const load=String(hw.load||'').split(/\s+/); // load average is not CPU percent
    const memP=ratio(hw.mem_used,hw.mem_total);
    const hardware=[
      ['cpu','CPU 负载',escape(load[0]||'—'),escape(hw.load||'暂无数据')+' · 1 / 5 / 15分钟 · '+escape(hw.cores||'—')+'核（非利用率）'+fieldNote(['load','cores'])],
      ['thermometer','CPU 温度',finite(hw.cpu_temp)?escape(hw.cpu_temp)+'°C':'—','采集温度 · 提示阈值 85°C'+fieldNote(['cpu_temp'])],
      ['memory','内存',gb(hw.mem_used)+'<small> / '+gb(hw.mem_total)+' GB</small>',(memP===null?'未知':memP+'%')+' · MemAvailable '+(finite(hw.mem_total)&&finite(hw.mem_used)?gb(Number(hw.mem_total)-Number(hw.mem_used)):'—')+' GiB · 交换空间 '+gb(hw.swap_used)+' GB'+fieldNote(['mem_used','mem_total','swap_used'])],
      ['clock','运行时长',escape(duration(hw.uptime_s)),vms.length+' 台虚拟机 · 展开查看详情'+fieldNote(['uptime_s'])]
    ];
    $('hw-kv').innerHTML=hardware.map(([ic,label,value,sub])=>`<article class="hardware-card"><img src="${icon(ic)}" alt=""><div><div class="k">${label}</div><div class="v">${value}</div><div class="s">${sub}</div></div></article>`).join('');
    $('compute').dataset.telemetryStale=String(!gpuCurrent);
    $('gpu-bars').style.setProperty('--gpu-count',String(Math.max(1,Math.min(gpus.length,6))));
    $('gpu-bars').innerHTML=gpus.length?gpus.map(g=>{
      const p=ratio(g.mem_used,g.mem_total),u=percent(g.util),model=String(g.name||'型号未采集').replace(/^NVIDIA GeForce /,'');
      const proc=processes.filter(a=>a.uuid===g.uuid).map(a=>escape(a.name)+' '+gb(Number(a.mem)*1048576)+' GB').join('<br>')||'没有采集到占用进程';
      return `<article class="gpu-card"><div class="gpu-card-head"><img src="${icon('gpu')}" alt=""><h2>GPU ${escape(g.idx)}<span class="gpu-model" title="${escape(model)}">${escape(model)}</span></h2></div>${metric('显存',p)}${metric('利用率',u,'util')}<details class="gpu-detail" id="gpu-detail-${escape(g.idx)}"><summary id="gpu-toggle-${escape(g.idx)}">${finite(g.temp)?escape(g.temp)+'°C':'温度未知'} · ${finite(g.power)?escape(g.power)+' W':'功率未知'}${fieldNote(['gpus'])}</summary><div class="gpu-detail-content">显存 ${escape(g.mem_used??'—')} / ${escape(g.mem_total??'—')} MiB${p!==null&&p>=90?' · 占用较高':''}<br>UUID ${escape(g.uuid||'未采集')}<br>${proc}${fieldNote(['gpu_apps'])}</div></details></article>`;
    }).join(''):'<p class="server-empty">暂无显卡采集数据</p>';
    renderMap(data.snake,storage);
    const mounts=Array.isArray(storage.mounts)?storage.mounts:[];
    $('sto-bars').innerHTML=mounts.length?mounts.map(m=>{const p=percent(m.pct);return `<article class="storage-mount"><header><span class="path">${escape(m.path)}</span><span class="capacity">${tb(m.used)} / ${tb(m.size)} TB · ${p===null?'—':p+'%'}</span></header><div class="track"><i style="width:${p??0}%;${p>=90?'background:#cf9174':p>=75?'background:#d3b16c':''}"></i></div></article>`;}).join(''):'<p class="server-empty">暂无挂载点数据</p>';
    $('hw-disks').innerHTML=disks.map(d=>`<span class="diskchip ${d.ok===false?'bad':finite(d.temp)&&Number(d.temp)>=45?'warn':''}">${escape(d.name||d.dev||'磁盘')} · ${finite(d.temp)?escape(d.temp)+'°C':'温度未采集'}${d.status?' · '+escape(d.status):''}</span>`).join('')+(hw.disk_slots_empty?`<span class="diskchip">空槽 ${escape(hw.disk_slots_empty)}</span>`:'');
    $('vm-details').textContent='虚拟机：'+(vms.map(v=>v.name+' '+v.state).join(' · ')||'无采集记录');
    const priority=['studio','vault','emby','dsm','caddy'];
    const sorted=[...entries].sort((a,b)=>{const ai=priority.indexOf(a[0]),bi=priority.indexOf(b[0]);return (ai<0?100:ai)-(bi<0?100:bi);});
    $('app-grid').innerHTML=sorted.slice(0,5).map(serviceRow).join('')||'<p class="server-empty">暂无服务状态</p>';
    $('app-more-list').innerHTML=sorted.slice(5).map(serviceRow).join('');
    $('app-more').hidden=sorted.length<=5;
    $('app-more-summary').textContent='查看其余 '+Math.max(0,sorted.length-5)+' 项服务';
    opened.forEach(id=>{const el=$(id);if(el)el.open=true;});
    if(focusedId){const el=$(focusedId);if(el&&el!==document.activeElement)el.focus({preventScroll:true});}
  }
  document.addEventListener('status-ready',render);
  document.addEventListener('ai-observation-ready',render);
  document.addEventListener('status-loading',refreshControl);
  document.addEventListener('DOMContentLoaded',()=>{
    refreshControl();
    $('refresh-status').addEventListener('click',()=>{if(typeof loadStatus==='function')loadStatus();});
    if(typeof STATUS!=='undefined'&&STATUS)render();
    document.querySelectorAll('.server-tabs a').forEach(a=>a.addEventListener('click',()=>{
      document.querySelectorAll('.server-tabs a').forEach(item=>item.classList.toggle('active',item===a));
    }));
    $('verdict').addEventListener('click',event=>{if(event.target.closest('a[href="#server-details"]'))$('server-details').open=true;});
  });
  let resizeTimer;
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(typeof STATUS!=='undefined'&&STATUS)renderMap(STATUS.snake,STATUS.storage||{});},180);});
})();
