/* Rewrites navigation links only. Authentication, forms and application requests are untouched. */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AccessRoutingV10=api;
  if(root&&root.document){const start=()=>api.mount(root.document);root.document.readyState==='loading'?root.document.addEventListener('DOMContentLoaded',start,{once:true}):start();}
})(typeof window==='undefined'?null:window,function(root){
  'use strict';
  const STORAGE='home-access-routing-v10:mode',CONFIG='/static/access-routes-v10.json',MODES=['auto','local','public'];
  const hostName=value=>String(value||'').toLowerCase().replace(/\.$/,'').replace(/^\[|\]$/g,'');
  function ipv4(host){const p=hostName(host).split('.');return p.length===4&&p.every(n=>/^\d{1,3}$/.test(n)&&Number(n)<=255)?p.map(Number):null;}
  function localPageHost(host){const h=hostName(host),p=ipv4(h);return h==='localhost'||h.endsWith('.localhost')||h==='::1'||!!p&&(p[0]===127||p[0]===192&&p[1]===168&&p[2]===50);}
  function privateHost(host){const h=hostName(host),p=ipv4(h);return localPageHost(h)||h.endsWith('.local')||!!p&&(p[0]===10||p[0]===192&&p[1]===168||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===169&&p[1]===254)||/^f[cd][a-f0-9]{2}:/.test(h)||/^fe[89ab][a-f0-9]:/.test(h);}
  function strictOrigin(value){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('Invalid origin');return u;}
  function validateConfig(raw){
    if(!raw||raw.version!==1||!Array.isArray(raw.publicHosts)||!raw.publicHosts.length||raw.publicHosts.length>8||!Array.isArray(raw.routes)||raw.routes.length>100)throw new Error('Invalid routing configuration');
    const publicHosts=[...new Set(raw.publicHosts.map(host=>{if(typeof host!=='string')throw new Error('Invalid domain');const h=hostName(host);if(!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(h)||privateHost(h)||ipv4(h))throw new Error('Invalid public domain');return h;}))];
    const specifiedReserved=raw.reservedPublicPorts||[];if(!Array.isArray(specifiedReserved)||specifiedReserved.some(port=>!Number.isInteger(port)||port<1||port>65535))throw new Error('Invalid reserved ports');const reserved=[...new Set([443,8443,...specifiedReserved])];
    const used=new Set(),routes=raw.routes.map(route=>{
      if(!route||typeof route.enabled!=='boolean'||typeof route.id!=='string'||!/^[-a-z0-9]{1,40}$/.test(route.id))throw new Error('Invalid route');
      const local=strictOrigin(route.localOrigin),external=strictOrigin(route.publicOrigin),port=Number(external.port||(external.protocol==='https:'?443:80));
      if(!privateHost(local.hostname)||!publicHosts.includes(hostName(external.hostname))||reserved.includes(port)||used.has(local.origin))throw new Error('Unsafe or duplicate route');
      used.add(local.origin);return{id:route.id,label:typeof route.label==='string'?route.label.slice(0,80):route.id,localOrigin:local.origin,publicOrigin:external.origin,enabled:route.enabled};
    });
    const probe=raw.probe;if(!probe||probe.width!==17||probe.height!==13||probe.timeoutMs!==1800)throw new Error('Invalid probe configuration');
    const url=new URL(probe.url);if(url.origin!=='http://192.0.2.10:8089'||url.pathname!=='/static/access-probe-v10.svg'||url.search||url.hash||url.username||url.password)throw new Error('Probe is outside the approved static endpoint');
    return Object.freeze({version:1,publicHosts:Object.freeze(publicHosts),reservedPublicPorts:Object.freeze([...reserved]),routes:Object.freeze(routes.map(Object.freeze)),probe:Object.freeze({url:url.href,width:17,height:13,timeoutMs:1800})});
  }
  function pageKind(location,config){const u=new URL(location);return localPageHost(u.hostname)?'local':config&&config.publicHosts.includes(hostName(u.hostname))?'public':'unconfigured';}
  function classifyHref(href,base){
    if(typeof href!=='string'||! /^(?:https?:)?\/\//i.test(href.trim()))return{kind:'other',href};
    try{const url=new URL(href,base);return{kind:privateHost(url.hostname)?'private':'other',url,href};}catch(_){return{kind:'invalid',href};}
  }
  function mapHref(href,{mode,config,location}){
    const source=classifyHref(href,location);if(source.kind!=='private'||mode==='local')return{action:'keep',href};
    if(!config)return{action:'blocked',href:'#access-private-service',reason:'config-unavailable'};
    if(pageKind(location,config)==='unconfigured')return{action:'keep',href,reason:'unconfigured-origin'};
    if(source.url.username||source.url.password)return{action:'blocked',href:'#access-private-service',reason:'credentials-in-link'};
    const route=config.routes.find(item=>item.localOrigin===source.url.origin&&item.enabled===true);
    if(!route)return{action:'blocked',href:'#access-private-service',reason:'local-only'};
    return{action:'map',href:route.publicOrigin+source.url.pathname+source.url.search+source.url.hash,route:route.id};
  }
  function probeResult(event,width,height){return event==='load'&&width===17&&height===13?{ok:true,reason:'matched'}:{ok:false,reason:event==='load'?'unexpected-image':event==='timeout'?'timeout':'network-or-browser-blocked'};}
  function probePlan({permission='unsupported',pageProtocol='http:',probeProtocol='http:'}){
    if(permission==='denied')return{allowed:false,reason:'browser-permission-denied'};
    if(permission==='prompt')return{allowed:false,reason:'browser-permission-required'};
    if(pageProtocol==='https:'&&probeProtocol==='http:'&&permission!=='granted')return{allowed:false,reason:'mixed-content-or-browser-policy'};
    return{allowed:true,reason:'one-static-image'};
  }
  function probeImage(platform,config){
    return new Promise(resolve=>{
      let settled=false,timer=0;const img=new platform.Image();
      const finish=(event)=>{if(settled)return;settled=true;if(timer)platform.clearTimeout(timer);const result=probeResult(event,img.naturalWidth,img.naturalHeight);img.onload=img.onerror=null;if(!result.ok)img.removeAttribute?.('src');resolve(result);};
      img.referrerPolicy='no-referrer';img.decoding='async';img.onload=()=>finish('load');img.onerror=()=>finish('error');
      timer=platform.setTimeout(()=>finish('timeout'),config.timeoutMs);img.src=config.url+'?access-route-v10='+Date.now().toString(36);
    });
  }
  function anchorDecision(current,record,context){const original=record&&current===record.applied?record.original:current,result=mapHref(original,context);return{original,applied:result.href,result,write:current!==result.href};}
  function mount(doc){
    if(!root||!doc.body||doc.body.dataset.accessRouting||doc.documentElement.dataset.accessRouting==='unconfigured')return null;
    doc.body.dataset.accessRouting='10';
    let preference='auto';try{const value=root.localStorage.getItem(STORAGE);if(MODES.includes(value))preference=value;}catch(_){}
    let config=null,configError=false,mode=localPageHost(root.location.hostname)?'local':'public',reason='loading',probePromise=null,selection=0,toastTimer=0,queued=false;
    const records=new WeakMap(),pending=new Set();
    const box=doc.createElement('details');box.className='access-route-status';
    const summary=doc.createElement('summary');summary.setAttribute('aria-label','访问方式');
    const label=doc.createElement('span');label.className='access-route-label';summary.appendChild(label);
    const panel=doc.createElement('div');panel.className='access-route-panel';
    const field=doc.createElement('label');field.textContent='服务链接使用';
    const select=doc.createElement('select');select.setAttribute('aria-label','服务链接访问方式');
    for(const [value,text]of[['auto','自动选择'],['local','内网直连'],['public','公网访问']]){const option=doc.createElement('option');option.value=value;option.textContent=text;select.appendChild(option);}select.value=preference;field.appendChild(select);
    const explanation=doc.createElement('p');explanation.className='access-route-explanation';
    panel.append(field,explanation);box.append(summary,panel);
    const destination=doc.querySelector('.pixel-nav .actions');if(destination)destination.appendChild(box);else{box.classList.add('access-route-floating');doc.body.appendChild(box);}
    const toast=doc.createElement('div');toast.className='access-route-toast';toast.hidden=true;toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');doc.body.appendChild(toast);
    function say(message){toast.textContent=message;toast.hidden=false;if(toastTimer)root.clearTimeout(toastTimer);toastTimer=root.setTimeout(()=>{toast.hidden=true;},4500);}
    function updateBadge(){
      box.dataset.routeMode=mode;const limited=!['local-host','manual-local','manual-public','matched','loading','probing'].includes(reason);box.dataset.routeWarning=String(limited);
      label.textContent=mode==='local'?'内网直连':reason==='probing'?'公网访问 · 确认内网':limited?'公网访问 · 内网探测不可用':'公网访问';
      const details={
        'local-host':'当前通过家中地址访问，服务直接使用内网链接。',
        'manual-local':'已手动选择内网直连；只有能连接家中网络时，这些服务才可打开。',
        'manual-public':'已手动选择公网访问；仅使用已明确开放的服务地址。',
        'matched':'已连接到家中小站的专用静态图片，服务使用内网直连。',
        'probing':'正在确认家中小站是否可达；只检查一张静态图片，不读取设备或位置。',
        'loading':'正在读取服务链接配置。',
        'config-unavailable':'链接配置暂未取得，内网服务不会跳到未经确认的公网端口。',
        'unconfigured-origin':'当前网站地址尚未列入公网白名单，服务链接保持原样。',
        'browser-permission-denied':'浏览器限制了内网探测，已使用公网链接。没有据此判断你是否在家；也可手动选择内网。',
        'browser-permission-required':'浏览器需要额外允许内网探测；页面没有自动弹出权限请求，当前使用公网。也可直接手动选择内网。',
        'mixed-content-or-browser-policy':'浏览器不允许此页面自动确认内网连接，当前使用公网；需要时可手动选择内网。',
        'timeout':'内网探测在 1.8 秒内未确认，当前使用公网。网络或浏览器限制都可能导致此结果；也可手动选择内网。',
        'network-or-browser-blocked':'内网探测不可用，当前使用公网。这可能是网络或浏览器限制，不表示你一定不在家。',
        'unexpected-image':'未取得小站的专用验证图片，当前使用公网。'
      };
      explanation.textContent=details[reason]||details['network-or-browser-blocked'];summary.title=explanation.textContent;
      doc.body.dataset.accessRouteMode=mode;doc.body.dataset.accessRoutePreference=preference;doc.body.dataset.accessRouteReason=reason;
    }
    function context(){return{mode,config,location:root.location.href};}
    function updateAnchor(anchor){
      if(!anchor||anchor.tagName!=='A'||!anchor.hasAttribute('href'))return;
      const current=anchor.getAttribute('href'),previous=records.get(anchor),decision=anchorDecision(current,previous,context());
      const currentTitle=anchor.getAttribute('title'),title=previous&&(current===previous.applied||previous.result.action==='blocked'&&currentTitle==='这个服务暂时仅内网开放')?previous.title:currentTitle;
      const record={original:decision.original,applied:decision.applied,title,result:decision.result};records.set(anchor,record);
      if(decision.write)anchor.setAttribute('href',decision.applied);
      const blocked=decision.result.action==='blocked';
      if(blocked){if(anchor.dataset.accessRoute!=='local-only')anchor.dataset.accessRoute='local-only';const text='这个服务暂时仅内网开放';if(anchor.getAttribute('title')!==text)anchor.setAttribute('title',text);}
      else if(anchor.dataset.accessRoute){delete anchor.dataset.accessRoute;if(title===null)anchor.removeAttribute('title');else anchor.setAttribute('title',title);}
    }
    function updateAll(){for(const anchor of doc.querySelectorAll('a[href]'))updateAnchor(anchor);}
    function enqueue(node){
      if(!node||node.nodeType!==1)return;if(node.tagName==='A')pending.add(node);for(const anchor of node.querySelectorAll?.('a[href]')||[])pending.add(anchor);
      if(queued||!pending.size)return;queued=true;Promise.resolve().then(()=>{queued=false;const batch=[...pending];pending.clear();for(const anchor of batch)if(anchor.isConnected)updateAnchor(anchor);});
    }
    function apply(nextMode,nextReason){mode=nextMode;reason=nextReason;updateBadge();updateAll();}
    async function oneProbe(){
      if(probePromise)return probePromise;
      probePromise=(async()=>{
        let permission='unsupported';
        let permissionTimer=0;
        try{if(root.navigator?.permissions?.query){const state=await Promise.race([root.navigator.permissions.query({name:'local-network'}),new Promise(resolve=>{permissionTimer=root.setTimeout(()=>resolve({state:'unavailable'}),250);})]);if(state.state==='unavailable')return{ok:false,reason:'network-or-browser-blocked'};if(['granted','prompt','denied'].includes(state.state))permission=state.state;}}catch(_){}finally{if(permissionTimer)root.clearTimeout(permissionTimer);}
        const plan=probePlan({permission,pageProtocol:root.location.protocol,probeProtocol:new URL(config.probe.url).protocol});
        return plan.allowed?probeImage(root,config.probe):{ok:false,reason:plan.reason};
      })().catch(()=>({ok:false,reason:'network-or-browser-blocked'}));return probePromise;
    }
    async function choose(){
      const token=++selection;
      if(preference==='local'){apply('local','manual-local');return;}
      if(!config){apply(localPageHost(root.location.hostname)&&preference==='auto'?'local':'public',configError?'config-unavailable':'loading');return;}
      const kind=pageKind(root.location.href,config);
      if(kind==='unconfigured'){apply('public','unconfigured-origin');return;}
      if(preference==='public'){apply('public','manual-public');return;}
      if(kind==='local'){apply('local','local-host');return;}
      apply('public','probing');const result=await oneProbe();if(token===selection&&preference==='auto')apply(result.ok?'local':'public',result.reason);
    }
    select.addEventListener('change',()=>{if(!MODES.includes(select.value))return;preference=select.value;try{root.localStorage.setItem(STORAGE,preference);}catch(_){}choose();});
    root.addEventListener('storage',event=>{if(event.key===STORAGE){preference=MODES.includes(event.newValue)?event.newValue:'auto';select.value=preference;choose();}});
    function intercept(event){const anchor=event.target.closest?.('a');if(!anchor)return;updateAnchor(anchor);const record=records.get(anchor);if(record?.result.action==='blocked'){event.preventDefault();event.stopImmediatePropagation();say('这个服务暂时仅内网开放，可在家中网络选择“内网直连”后使用。');}}
    doc.addEventListener('click',intercept,true);doc.addEventListener('auxclick',intercept,true);
    doc.addEventListener('keydown',event=>{if(event.key==='Escape'){box.open=false;toast.hidden=true;}});
    if(typeof root.MutationObserver==='function')new root.MutationObserver(changes=>{for(const change of changes)if(change.type==='attributes')enqueue(change.target);else for(const node of change.addedNodes)enqueue(node);}).observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['href']});
    choose();
    let configExpired=false;
    const controller=typeof root.AbortController==='function'?new root.AbortController():null,timeout=root.setTimeout(()=>{configExpired=true;configError=true;controller?.abort();choose();},3000);
    root.fetch(CONFIG,{credentials:'same-origin',cache:'no-cache',signal:controller?.signal}).then(response=>{if(!response.ok)throw new Error('Routing config unavailable');return response.json();}).then(raw=>{if(!configExpired){config=validateConfig(raw);choose();}}).catch(()=>{if(!configExpired){configError=true;choose();}}).finally(()=>root.clearTimeout(timeout));
    return{getState:()=>({mode,reason,preference,configured:!!config,probeStarted:!!probePromise}),refreshLinks:updateAll};
  }
  return Object.freeze({validateConfig,localPageHost,privateHost,pageKind,classifyHref,mapHref,probeResult,probePlan,probeImage,anchorDecision,mount});
});
