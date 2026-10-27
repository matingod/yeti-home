/* Home AI workbench: same-origin observations only, no fixture fallback. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root.document) api.mount(root.document);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const BASE = '/yeti/server/ai-api/';
  const n = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const map = {queued:'排队',running:'执行中',submitted:'后台已受理 / 待结果',succeeded:'已完成',failed:'失败',cancelled:'已取消',blocked:'依赖阻断',unknown:'待核',enabled:'接单',candidate:'候选 / 未部署',draining:'排空中',disabled:'已停用',retired:'已退役',sleeping:'休眠（按需）',healthy:'健康',stale:'过期 / 待核',drift:'配置漂移'};
  const label = value => map[value] || String(value || '待核');
  function serviceState(service, stale) {
    return {run:stale?'待核':service.runState==='running'?'容器运行中':label(service.runState),health:stale||!service.health||service.health==='unknown'?'待核':label(service.health)};
  }
  function etaText(segment, predecessorUnknown=false) {
    const s=segment||{}, count=Number(s.sampleCount)||0;
    if(predecessorUnknown) return '前序未知 · 不给倒计时 · n='+count;
    if(!count||!n(s.lowerMs)||!n(s.upperMs)) return '待测 · n='+count;
    const fmt=v=>Number((Number(v)/1000).toFixed(1));
    return fmt(s.lowerMs)+'–'+fmt(s.upperMs)+' 秒 · n='+count+'（观测范围）';
  }
  function filterTasks(tasks, search, lane, state) {
    const q=String(search||'').toLowerCase();
    return tasks.filter(t=>(lane==='all'||t.lane===lane) && (state==='all'||(state==='pending'?['queued','blocked','running','submitted'].includes(t.state):state==='waiting'?['queued','blocked'].includes(t.state):state==='active'?['running','submitted'].includes(t.state):t.state===state)) && (!q||[t.id,t.runtime,t.modelVersion,t.blockedReason,t.error&&JSON.stringify(t.error)].join(' ').toLowerCase().includes(q)));
  }
  function semanticEqual(a,b) { if(a===b)return true;if(a==null||b==null||typeof a!=='object'||typeof b!=='object')return false;if(Array.isArray(a)!==Array.isArray(b))return false;const ka=Object.keys(a).sort(),kb=Object.keys(b).sort();return ka.length===kb.length&&ka.every((k,i)=>k===kb[i]&&semanticEqual(a[k],b[k])); }
  function candidateMatches(c,want) { return !!c && c.admission==='candidate' && ['modelId','version','adapter','weights','evidence'].every(k=>semanticEqual(c[k],want[k])); }
  function jsonRuntimes(items) { return items.filter(r=>r.admission==='enabled' && r.runtime!=='voice' && r.inputProtocol!=='multipart'); }
  function artifactUrl(planId, artifactId) {return BASE+'artifact?planId='+encodeURIComponent(planId)+'&artifactId='+encodeURIComponent(artifactId);}
  function externalObservationFresh(job,now=Date.now()) {
    const at=job.lastObservedAt;
    return (job.observationFresh===undefined||job.observationFresh===true)&&job.lastObservationState==='running'&&Number.isSafeInteger(at)&&at>0&&at<=now&&now-at<=10000;
  }
  // SHA-256 over WHATWG UTF-8. HTTP LAN origins lack Web Crypto's SubtleCrypto.
  // FIPS 180-4 compression; no dependencies, eval, insecure-context flags or TLS changes.
  async function sha256(value) {
    const bytes=new TextEncoder().encode(value);
    if(globalThis.crypto?.subtle) {
      const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
      return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
    }
    const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const padded=new Uint8Array(Math.ceil((bytes.length+9)/64)*64);
    padded.set(bytes);padded[bytes.length]=0x80;
    const bits=bytes.length*8,high=Math.floor(bits/0x100000000),low=bits>>>0;
    for(let i=0;i<4;i++){padded[padded.length-8+i]=high>>>(24-i*8);padded[padded.length-4+i]=low>>>(24-i*8);}
    const w=new Uint32Array(64),ror=(x,n)=>(x>>>n)|(x<<(32-n));
    for(let offset=0;offset<padded.length;offset+=64){
      for(let i=0;i<16;i++){const j=offset+i*4;w[i]=(padded[j]<<24)|(padded[j+1]<<16)|(padded[j+2]<<8)|padded[j+3];}
      for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(ror(x,7)^ror(x,18)^(x>>>3))+w[i-7]+(ror(y,17)^ror(y,19)^(y>>>10)))>>>0;}
      let [a,b,c,d,e,f,g,z]=h;
      for(let i=0;i<64;i++){
        const t1=(z+(ror(e,6)^ror(e,11)^ror(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0;
        const t2=((ror(a,2)^ror(a,13)^ror(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
        z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
      }
      for(const [i,v] of [a,b,c,d,e,f,g,z].entries())h[i]=(h[i]+v)>>>0;
    }
    return Array.from(h,v=>v.toString(16).padStart(8,'0')).join('');
  }
  function externalTaskPresentation(job) {
    const stamp=value=>{const d=typeof value==='string'?new Date(value):typeof value==='number'&&value>0?new Date(value):null;return d&&Number.isFinite(d.getTime())?d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):null;};
    const cpu=job.kind==='cpu-reported',known=job.templateId==='demo-asr';
    const title=cpu?'脚本任务 · '+(job.version||'名称未提供'):known?'Whisper '+(job.modelVersion||'版本未提供')+' · 音频转文字':'文件处理任务 · '+(job.modelVersion||job.templateId||'名称未提供');
    const purpose=cpu?'由其他脚本主动上报的任务，工作台未独立确认它是否正在运行。':known?'把音频识别成文字，用于字幕制作中的语音识别步骤；这里不负责翻译。':'接口未提供具体用途，请先核对任务资料。';
    const actualStart=stamp(job.identity?.startedAt),completed=stamp(job.completedAt);
    const timing=job.state==='succeeded'?'已完成'+(completed?' · '+completed+'（北京时间）':'；完成时间未记录'):job.state==='cancelled'?'已取消，不会再从本计划启动':job.state==='failed'?'执行失败'+(completed?' · '+completed+'（北京时间）':'；结束时间未记录'):job.state==='planned'?'开始时间未安排；登记后仍需手动启动':job.state==='reserved'?'尚未开始；资源已预留，等待服务器执行程序启动':job.state==='unknown'?'执行情况待确认；不会自动重跑':cpu?'执行阶段由脚本上报；开始时间未独立确认':actualStart?'实际开始于 '+actualStart+'（北京时间）':'实际开始时间未记录；不能按登记时间推算';
    return {title,purpose,timing};
  }
  function mount(doc) {
    if(!doc.getElementById('ai-workbench')) return;
    const $=id=>doc.getElementById(id), root=$('ai-workbench');
    if (root.dataset.backend === 'unconfigured') {
      root.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = true; });
      return;
    }
    const S={session:null,snapshot:null,connected:false,preview:null,control:null,busy:false,polling:false,expiryTimer:null,inputRevision:0,externalPin:null,externalAttempt:false,externalControl:null,queuePage:1};
    const queuePageSize=10,queueOpened=new Set();
    let renderedObservationSignature='';
    const observationSignature=()=>JSON.stringify((S.snapshot?.externalJobs||[]).filter(j=>j.state==='bound').map(j=>[j.id,externalObservationFresh(j)]));
    const groupStatus=doc.createElement('p');groupStatus.id='ai-group-status';groupStatus.className='ai-caption';$('ai-revisions').after(groupStatus);
    const limitNote=doc.createElement('p');limitNote.id='ai-limit-note';limitNote.className='ai-caption';$('ai-readonly-note').after(limitNote);
    function el(tag,text,cls) {const e=doc.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e;}
    function add(parent,tag,text,cls) {const e=el(tag,text,cls);parent.append(e);return e;}
    function button(text,fn,cls) {const b=el('button',text,cls);b.type='button';b.addEventListener('click',fn);return b;}
    const old=ts=>!n(ts)||Date.now()-Number(ts)>15000||Number(ts)>Date.now()+60000;
    const stale=()=>!S.connected||!S.snapshot||S.snapshot.stale!==false||old(S.snapshot.generatedAt);
    const admin=()=>S.connected&&S.session&&S.session.role==='admin'&&S.session.csrfToken&&!oldSession();
    const oldSession=()=>!S.session||!n(S.session.expiresAt)||Number(S.session.expiresAt)<=Date.now();
    const manage=()=>admin()&&!stale();
    function message(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('is-error',error);}
    function pretty(value){return typeof value==='string'?value:JSON.stringify(value,null,2);}
    const time=ts=>n(ts)?new Date(Number(ts)).toLocaleString('zh-CN',{hour12:false}):'未采集';
    function pair(parent,name,value){const p=add(parent,'div',undefined,'ai-pair');add(p,'dt',name);add(p,'dd',value===undefined||value===null?'待核':pretty(value));}
    function fail(err){return (err.code?err.code+' · ':'')+(err.message||String(err));}
    async function request(path,body,beforeSend){
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
      try{
        const options={method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:controller.signal};
        if(body!==undefined){if(!manage())throw new Error('管理权限或状态已失效，请刷新核实');options.headers['Content-Type']='application/json';options.headers['x-csrf-token']=S.session.csrfToken;options.body=JSON.stringify(body);const limit=S.snapshot?.limits?.maxBodyBytes;if(n(limit)&&new TextEncoder().encode(options.body).byteLength>Number(limit))throw new Error('请求超过后台当前上限 '+limit+' B；输入已保留。');}
        // Only crossing the network boundary consumes a plan attempt. Validation may retry.
        if(beforeSend)beforeSend();
        const r=await fetch(BASE+path,options);let data;
        try {data=await r.json();}catch(_){throw new Error('接口未返回JSON；请核实认证与API映射');}
        if(!r.ok){const e=new Error(data.error?.message||('HTTP '+r.status));e.code=data.error?.code||('HTTP_'+r.status);if(r.status===401||r.status===403){S.session=null;S.connected=false;permissions();}throw e;}
        return data;
      }finally{clearTimeout(timeout);}
    }
    function permissions(){
      const writable=manage();
      $('ai-permission').textContent=!S.connected?'未连接 · 权限待核':oldSession()?'权限待核':S.session.role==='admin'?(stale()?'管理员 · 状态待核':'可管理 · 管理员'):'只读';
      $('ai-plan-form').hidden=!writable;$('ai-readonly-note').hidden=!!writable;
      $('ai-readonly-note').textContent=!S.connected?'API未连接；管理与提交已暂停，表单内容保留。':stale()?'数据已过期；待核实后才允许提交。':'当前身份只读；管理与任务提交不可用。';
      $('ai-register-toggle').hidden=!writable;
      for(const e of $('ai-model-table').querySelectorAll('.ai-actions'))e.hidden=!writable;
      for(const e of $('ai-tasks').querySelectorAll('.ai-cancel-button'))e.hidden=!writable;
      if(!writable){$('ai-candidate-form').hidden=true;$('ai-control-panel').hidden=true;}
      root.dataset.stale=String(stale());externalPermissions();
      if(S.preview) updatePreviewButton();
    }
    function invalidatePreview(text){if(!S.preview)return;S.preview.invalid=true;updatePreviewButton();if(text)message('ai-plan-result',text,true);}
    function updatePreviewButton(){const b=$('ai-confirm-plan');if(!b)return;b.disabled=!manage()||S.busy||S.preview.invalid||Number(S.preview.expiresAt)<=Date.now()||S.preview.configRev!==S.snapshot?.configRev;}
    function renderQueue(){
      const box=$('ai-tasks');
      for(const detail of box.querySelectorAll(':scope > details[data-task-id]')){if(detail.open)queueOpened.add(detail.dataset.taskId);else queueOpened.delete(detail.dataset.taskId);}
      const focused=box.contains(doc.activeElement)?{id:doc.activeElement.closest('[data-task-id]')?.dataset.taskId,tag:doc.activeElement.tagName,text:doc.activeElement.textContent}:null;
      box.replaceChildren();const tasks=S.snapshot?.tasks||[],items=filterTasks(tasks,$('ai-search').value,$('ai-lane').value,$('ai-state').value);
      const pages=Math.max(1,Math.ceil(items.length/queuePageSize));S.queuePage=Math.max(1,Math.min(S.queuePage,pages));
      const start=(S.queuePage-1)*queuePageSize,visible=items.slice(start,start+queuePageSize);
      $('ai-queue-count').textContent='匹配 '+items.length+' / '+tasks.length+' 项 · 本页 '+(items.length?start+1:0)+'–'+(start+visible.length)+(stale()?' · 历史待核':'');
      $('ai-queue-pagination').hidden=pages<=1;
      $('ai-queue-prev').disabled=S.queuePage===1;$('ai-queue-next').disabled=S.queuePage===pages;
      $('ai-queue-page').textContent='第 '+S.queuePage+' / '+pages+' 页 · 每页 '+queuePageSize+' 条';
      if(!items.length){add(box,'p',tasks.length?'没有匹配任务；调整筛选。':'当前没有已登记任务。','ai-empty');return;}
      for(const t of visible){
        const detail=add(box,'details',undefined,'ai-task');detail.dataset.taskId=t.id;detail.open=queueOpened.has(t.id);
        const summary=add(detail,'summary');const head=add(summary,'div',undefined,'ai-task-head');
        add(head,'strong',t.runtime||'未知实例');add(head,'span',(stale()?'历史 · ':'')+label(t.state),'ai-badge '+(!stale()&&t.state==='succeeded'?'is-good':t.state==='failed'?'is-error':''));
        add(summary,'span',t.id+' · '+(t.lane==='creation'?'创作':'日常')+' · '+t.modelVersion,'ai-task-meta');
        add(summary,'span',t.blockedReason||(['queued','blocked'].includes(t.state)?'后台未提供等待原因 · 待核':t.state==='unknown'?'派发 / 完成情况待核，不自动重放':'查看阶段、依赖与输出'),'ai-task-reason');
        const content=add(detail,'div',undefined,'ai-task-detail');const dl=add(content,'dl',undefined,'ai-facts');
        pair(dl,'阶段',t.phase||t.state);pair(dl,'配置版本',t.configRev);pair(dl,'提交方式',t.mode==='async'?'异步 · 关页继续':t.mode==='sync'?'原同步请求 · 断流不能续接':'后台未提供');
        pair(dl,'依赖',t.dependencies?.length?t.dependencies:'无');pair(dl,'创建 / 开始 / 完成',time(t.createdAt)+' / '+time(t.startedAt)+' / '+time(t.completedAt));
        if(t.promptId)pair(dl,'Comfy promptId',t.promptId);
        if(t.error)pair(dl,'后台错误（原文）',t.error);if(t.blockedReason)pair(dl,'等待 / 拒绝原因',t.blockedReason);
        const predecessorUnknown=(t.dependencies||[]).some(id=>!tasks.some(p=>p.id===id&&['succeeded','failed','cancelled'].includes(p.state)));
        renderEta(content,t.eta,predecessorUnknown);
        if(t.artifacts?.length){const out=add(content,'div',undefined,'ai-artifacts');add(out,'strong','输出：');for(const a of t.artifacts){if(a&&typeof a.id==='string'){const link=add(out,'a',a.id);link.href=artifactUrl(t.id,a.id);link.target='_blank';link.rel='noopener';}}}
        if(t.events) {const ev=add(content,'details');add(ev,'summary','事件 / 证据');add(ev,'pre',pretty(t.events));}
        if(manage()&&t.state==='queued'&&t.holdsResource===false&&t.startedAt==null)content.append(button('取消未派发任务',()=>openControl('task.cancel',t.id),'ai-cancel-button'));
        if(manage()&&t.state==='unknown'&&t.holdsResource===true)content.append(button('核实结果丢失',()=>openControl('task.resolveUnknown',t.id),'ai-resolve-button'));
        if(focused?.id===t.id){const target=[...detail.querySelectorAll('summary,button,a')].find(e=>e.tagName===focused.tag&&e.textContent===focused.text);if(target)target.focus({preventScroll:true});}
      }
    }
    function renderEta(parent,eta,unknown=false){const dl=add(parent,'dl',undefined,'ai-eta');for(const [key,name]of [['queue','排队'],['load','装载'],['execute','执行']]){const row=add(dl,'div');add(row,'dt',name);add(row,'dd',etaText(eta?.[key],key==='queue'&&unknown));}if(eta?.queue?.basis)add(parent,'p',eta.queue.basis,'ai-caption');if(eta?.revision!==undefined)add(parent,'p','估计修订 '+eta.revision+' · 非承诺完成时间','ai-caption');}
    function renderModels(){
      const box=$('ai-model-table');
      const opened=new Set([...box.querySelectorAll('tr')].filter(r=>r.querySelector('.ai-evidence')?.open).map(r=>r.dataset.modelId));
      const focus=box.contains(doc.activeElement)?{id:doc.activeElement.closest('tr')?.dataset.modelId,text:doc.activeElement.textContent,tag:doc.activeElement.tagName}:null;
      box.replaceChildren();
      if(!S.snapshot)return;
      const registry=S.snapshot.registry,models=Object.values(registry.models),runtimes=Object.values(registry.runtimes);
      const table=add(box,'table',undefined,'ai-table');const caption=add(table,'caption','每行一个模型版本；8131仅为8130别名，不重复计为模型。Comfy版本包含引擎、workflow与checkpoint。');
      caption.className='ai-caption';const th=add(add(table,'thead'),'tr');for(const s of ['模型 / 确切版本','运行实例 / 能力路由','接入','运行','健康','证据 / 管理']){const c=add(th,'th',s);c.scope='col';}
      const body=add(table,'tbody');
      for(const model of models){const row=add(body,'tr');row.dataset.modelId=model.modelId;
        const cell=(name)=>{const td=add(row,'td');td.dataset.label=name;return td;};
        const identity=cell('模型 / 确切版本');add(identity,'strong',model.modelId);add(identity,'span',model.version,'ai-cell-sub');add(identity,'span','适配器 '+(model.adapter||'未登记'),'ai-cell-sub');
        const rs=runtimes.filter(r=>r.modelId===model.modelId),instances=cell('运行实例 / 能力路由');
        if(!rs.length)add(instances,'span','无运行实例 · 未部署');
        for(const r of rs){const d=add(instances,'div',undefined,'ai-instance');add(d,'strong',r.runtime+' · '+r.group+' · '+r.slots+' 槽');const route=Object.entries(registry.routes).filter(([,x])=>x.runtime===r.runtime).map(([port,x])=>port+(x.alias?'（别名）':''));add(d,'span',route.join(' / ')||'无接入路由','ai-cell-sub');add(d,'span',r.gpuIndices?.length?'GPU '+r.gpuIndices.join(' + '):'GPU分配由资源组核对','ai-cell-sub');}
        add(cell('接入'),'span',label(model.admission));
        const run=cell('运行'),health=cell('健康');
        const modelObservation=S.snapshot.status.models?.[model.modelId];
        if(rs.length&&modelObservation)add(health,'span','模型接口：'+(stale()?'待核':modelObservation.health==='healthy'?'可达（非推理验收）':label(modelObservation.health)),'ai-cell-sub');
        if(!rs.length){add(run,'span','未部署');add(health,'span','未验收（不等于故障）');}
        for(const r of rs){const service=S.snapshot.status.services[r.runtime]||{},isStale=stale()||old(service.observedAt);const state=serviceState(service,isStale);add(run,'span',r.runtime+'：'+state.run,'ai-cell-sub');add(run,'span','接入 '+label(service.admission||r.admission)+' · 在途 '+(isStale?'待核':n(service.active)?service.active:'待核'),'ai-cell-sub');add(health,'span',state.health,'ai-cell-sub '+(state.health==='健康'?'is-good':''));}
        const actions=cell('证据 / 管理');const evidence=add(actions,'details',undefined,'ai-evidence');add(evidence,'summary','查看资源与验收证据');add(evidence,'pre',pretty(model.evidence||{measured:false,note:'峰值待测；没有验收记录'}));
        add(actions,'span',model.evidence?.measured===true?'峰值测量已登记 · 请核证据':'RAM / VRAM 峰值待测','ai-cell-sub');
        if(rs.some(r=>r.protected||r.group==='main'||r.runtime==='strata')){add(actions,'span','受保护的模型 · 保护配置不变','ai-cell-sub');}
        else lifecycleActions(actions,model,rs);
        evidence.open=opened.has(model.modelId);
        if(focus?.id===model.modelId){const target=[...row.querySelectorAll('button,summary')].find(e=>e.tagName===focus.tag&&e.textContent===focus.text);if(target)target.focus({preventScroll:true});}
      }
      if(!models.length)add(box,'p','没有模型登记。','ai-empty');
    }
    const approvedExternal=t=>t?.id==='demo-asr'&&t.approved===true&&t.admission==='approved'&&/^[a-f0-9]{64}$/.test(t.revision||'')&&typeof t.modelVersion==='string'&&!!t.modelVersion&&typeof t.precision==='string'&&!!t.precision;
    function externalPinValid(){const p=S.externalPin;return p&&p.id===$('ai-external-template').value&&(S.snapshot?.externalTemplates||[]).some(t=>approvedExternal(t)&&t.id===p.id&&t.revision===p.revision&&t.modelVersion===p.modelVersion&&t.precision===p.precision);}
    function externalPermissions(){
      const writable=manage();$('ai-external-plan-form').hidden=!writable;$('ai-external-readonly').hidden=writable;
      $('ai-external-readonly').textContent=!S.connected?'API 未连接 / 待核；保留表单，禁止外部写入。':stale()?'快照过期 / 待核；禁止外部写入。':'当前身份只读；外部操作不可用。';
      $('ai-external-pin').disabled=!writable||S.busy||S.externalAttempt||!(S.snapshot?.externalTemplates||[]).some(t=>approvedExternal(t)&&t.id===$('ai-external-template').value);
      $('ai-external-submit').disabled=!writable||S.busy||S.externalAttempt||!externalPinValid();
      for(const e of $('ai-external').querySelectorAll('.ai-external-actions'))e.hidden=!writable;
      if(!writable)$('ai-external-control').hidden=true;
      $('ai-external-control-submit').disabled=!writable||S.busy;
    }
    function externalActions(j){
      if(j?.kind!=='planned'||!/^[a-f0-9]{64}$/.test(j.templateRevision||'')||!j.modelVersion||!j.precision)return [];
      const actions=[];
      if(j.state==='planned'&&!j.createIntentAt&&(j.actions||[]).includes('admit')&&(S.snapshot?.externalTemplates||[]).some(t=>approvedExternal(t)&&t.id===j.templateId&&t.revision===j.templateRevision&&t.modelVersion===j.modelVersion&&t.precision===j.precision))actions.push('admit');
      if(['planned','reserved','unknown'].includes(j.state)&&!j.createIntentAt&&(j.actions||[]).includes('cancel'))actions.push('cancel');
      if(j.state==='unknown'&&j.holdsResource===true&&j.createIntentAt&&(j.containerId===null||/^[a-f0-9]{64}$/.test(j.containerId||''))&&(j.actions||[]).includes('resolve'))actions.push('resolve');
      return actions;
    }
    const externalActionName=a=>({admit:'预留显卡（仍不启动）',cancel:'取消这项任务',resolve:'确认结果丢失'})[a];
    function externalState(j){return j.kind==='cpu-reported'?'脚本自报 · '+(j.phase==='running'?'运行中（未独立确认）':j.phase||'状态待确认'):j.state==='bound'?(!stale()&&externalObservationFresh(j)?'正在处理音频':'运行情况待确认'):({planned:'已登记，尚未启动',reserved:'等待服务器启动',creating:'正在准备运行环境',prepared:'准备完成，尚未启动',starting:'正在启动，尚未确认运行',unknown:'执行情况待确认'})[j.state]||label(j.state);}
    function externalLease(j){
      if(j.holdsResource!==true)return '未持有调度资源（不是主机空闲证明）';
      const lease=(S.snapshot?.leases||[]).find(l=>l.id===j.leaseId&&l.taskId===j.id);
      if(stale()||!lease||!n(lease.expiresAt))return '租约待核 · 不自动释放或重放';
      if(lease.stale===true||Number(lease.expiresAt)<=Date.now())return '租约已过期 · 仍持有占位，不自动释放或重放';
      return '租约有效至 '+time(lease.expiresAt)+(lease.legacyUnverified?' · 历史身份待核':'')+' · 非进程存活或执行成功证明';
    }
    function externalResources(parent,j){
      const r=j.resources||{};
      pair(parent,'资源组 / 显卡',r.group+' / '+(r.gpuIndices?.length?'GPU '+r.gpuIndices.join(' + '):'无 GPU 调度分配'));
      if(r.gpuUUID)pair(parent,'GPU 身份',r.gpuUUID);
      if(n(r.minFreeMiB))pair(parent,'最低空闲显存',r.minFreeMiB+' MiB（准入门槛，非实测峰值）');
      pair(parent,'RAM / VRAM 峰值',(n(r.peakRamMiB)?r.peakRamMiB+' MiB':'待测')+' / '+(n(r.peakVramMiB)?r.peakVramMiB+' MiB':'待测'));
      pair(parent,'资源证据',r.evidence||'未提供 / 待核');
    }
    function renderExternal(){
      renderedObservationSignature=observationSignature();
      const jobs=S.snapshot?.externalJobs,observations=S.snapshot?.externalObservations,templates=S.snapshot?.externalTemplates;
      const select=$('ai-external-template'),available=(templates||[]).filter(approvedExternal),signature=JSON.stringify(available.map(t=>[t.id,t.revision,t.modelVersion,t.precision]));
      if(select.dataset.signature!==signature){const value=select.value;select.replaceChildren();for(const t of available){const op=add(select,'option',t.id==='demo-asr'?'Whisper '+t.modelVersion+' · 音频转文字':t.id+' · '+t.modelVersion);op.value=t.id;}if(available.some(t=>t.id===value))select.value=value;select.dataset.signature=signature;}
      if(S.externalPin&&!externalPinValid())message('ai-external-pinned','已固定的模板版本或批准状态已变化；禁止提交，请重新固定当前模板。',true);
      externalPermissions();
      const box=$('ai-external-jobs'),opened=new Set([...$('ai-external').querySelectorAll('[data-external-id][open]')].map(e=>e.dataset.externalId)),technicalOpened=new Set([...box.querySelectorAll('[data-external-technical-id][open]')].map(e=>e.dataset.externalTechnicalId));
      const query=$('ai-external-search').value.toLowerCase(),state=$('ai-external-state').value;
      const items=(jobs||[]).filter(j=>(state==='all'||j.state===state)&&(!query||[j.id,j.templateId,j.modelVersion,j.version,j.blockedReason].join(' ').toLowerCase().includes(query)));
      const page=S.snapshot?.externalJobPage,opage=S.snapshot?.externalObservationPage;
      $('ai-external-count').textContent=Array.isArray(jobs)?jobs.length+' / '+(n(page?.total)?page.total:jobs.length)+' 项已读取 · 筛选 '+items.length+' 项'+(stale()?' · 历史待核':''):'接口未提供 / 待核';
      $('ai-external-pagination').textContent='仅筛选已读取记录。'+(page?.hasMore?'较早历史未展开；可由可信管理端按游标读取。':'')+(page?.includesAllLive===false?' 未覆盖全部在途，不能据此判断资源可用。':'')+(!page?' 后台未提供分页范围，不能推断完整历史。':'');
      $('ai-external-observation-count').textContent=Array.isArray(observations)?observations.length+' / '+(n(opage?.total)?opage.total:observations.length)+' 项观察已读取'+(opage?.hasMore?' · 较早观察未展开':''):'观察接口未提供 / 待核';
      box.replaceChildren();
      if(!items.length)add(box,'p',Array.isArray(jobs)?(jobs.length?'没有符合筛选条件的文件处理任务。':'还没有文件处理任务。需要转写指定音频时再登记，这里不会定时自动运行。'):'暂时读不到任务记录，无法确认执行情况。','ai-empty');
      for(const j of items){
        const d=add(box,'details',undefined,'ai-external-item');d.dataset.externalId=j.id;d.open=opened.has(j.id);
        const summary=add(d,'summary'),head=add(summary,'div',undefined,'ai-task-head');
        const human=externalTaskPresentation(j);
        add(head,'strong',human.title);add(head,'span',(stale()?'旧数据 · ':'')+externalState(j),'ai-badge');
        add(summary,'span',human.timing,'ai-task-meta');
        add(summary,'span',human.purpose,'ai-task-reason');
        const content=add(d,'div',undefined,'ai-task-detail'),facts=add(content,'dl',undefined,'ai-facts');
        pair(facts,'处理内容',human.purpose);pair(facts,'执行方式',j.kind==='cpu-reported'?'其他脚本发起；本页只接收状态':'手动发起，不是定时任务；只登记不会自动执行');
        pair(facts,'执行时间',human.timing);pair(facts,'音频文件',j.kind==='cpu-reported'?'不适用':'当前接口未提供文件名，无法确认是哪段音频');
        if(j.state==='succeeded')pair(facts,'处理结果','已生成转写结果；未在本页核对文字是否准确');
        if(j.blockedReason)pair(facts,'需要处理','服务器正在等待条件满足或人工核实；具体原因见维护详情');
        const technical=add(content,'details',undefined,'ai-inline');technical.dataset.externalTechnicalId=j.id;technical.open=technicalOpened.has(j.id);add(technical,'summary','维护详情（任务编号、版本与资源核验）');
        const dl=add(technical,'dl',undefined,'ai-facts');pair(dl,'任务编号',j.id);if(j.blockedReason)pair(dl,'后台原因',j.blockedReason);
        pair(dl,'操作者',j.owner);pair(dl,'模板修订',j.templateRevision);pair(dl,'模型 / 精度',(j.modelVersion||j.version||'未提供')+' / '+(j.precision||'未声明（不推断精度）'));
        pair(dl,'资源状态',externalLease(j));pair(dl,'租约 ID',j.leaseId||'无');pair(dl,'ETA','待测 · 不提供倒计时');externalResources(dl,j);
        if(j.kind==='planned')pair(dl,'最近实际观测',time(j.lastObservedAt)+' / '+(({running:'运行',terminal:'已终止',absent:'未发现容器'})[j.lastObservationState]||'未提供 / 待核')+(!stale()&&externalObservationFresh(j)?' · 10 秒内运行观测':' · 历史 / 缺采，待核；不自动释放占位'));
        if(j.kind==='cpu-reported')pair(dl,'调度边界','调用方自报版本与阶段；无 CPU 准入 / 无跨 VM PID 核实；不是模板批准或受管执行证明');
        if(j.containerId)pair(dl,'容器 ID',j.containerId);if(j.identity)pair(dl,'已观察身份',j.identity);
        if(j.result)pair(dl,'结果证据',j.result);
        if(j.result)add(technical,'p','仅基础 JSON / 哈希证据，不代表语义质量验收；网页不读取音频、提示词或输出正文。','ai-caption');
        pair(dl,'创建 / 完成',time(j.createdAt)+' / '+time(j.completedAt));
        if(j.inputHash)pair(dl,'输入引用哈希',j.inputHash);if(j.outputHash)pair(dl,'输出引用哈希',j.outputHash);
        if(j.kind==='planned'&&['planned','reserved'].includes(j.state)&&!j.createIntentAt&&!j.startIntentAt&&!j.containerId&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(j.id||'')){
          add(technical,'p','可信 root CLI 交接模板（不是网页执行）：root 在本机另行提供配置路径与原始输入 / 输出引用；CLI 核对该任务的修订和引用哈希。只能继续 planned / reserved，无自动重放；过期租约或身份不足会拒绝。','ai-caption');
          add(technical,'pre','node external-cli.cjs --config "$EXTERNAL_CONFIG" execute-existing '+j.id+' "$INPUT_REF" "$OUTPUT_REF"','ai-external-cli');
        }
        if(manage()&&externalActions(j).length){const actions=add(content,'div',undefined,'ai-actions ai-external-actions');for(const action of externalActions(j))actions.append(button(externalActionName(action),()=>openExternalControl(action,j)));}
      }
      const ts=$('ai-external-template-list');ts.replaceChildren();
      if(!templates?.length)add(ts,'p',Array.isArray(templates)?'没有外部模板；不能创建计划。':'模板接口未提供 / 待核。','ai-empty');
      for(const t of templates||[]){
        const article=add(ts,'article',undefined,'ai-inline');add(article,'h4',t.id+' · '+(t.approved===true&&t.admission==='approved'?'已批准':label(t.admission)));
        const dl=add(article,'dl',undefined,'ai-facts');pair(dl,'精确修订',t.revision);pair(dl,'模型 / 精度',(t.modelVersion||'待核')+' / '+(t.precision||'未声明'));
        pair(dl,'证据类型',t.evidence?.kind==='legacyObserved'?'legacyObserved · 历史迁移确认，非实测':t.evidence?.measured===true?'measured · 已登记实测证据':'未测量 / 未提供证据');
        pair(dl,'峰值测量',t.evidence?.measured===true?'已登记；仍需核证据':'峰值待测 · 批准不等于已测量');externalResources(dl,t);
        add(article,'p','模板导入、批准与退役仅限可信 root CLI，本页没有这些操作。','ai-caption');
      }
      const obs=$('ai-external-observations');obs.replaceChildren();
      if(!observations?.length)add(obs,'p',Array.isArray(observations)?'本次快照没有观察记录；不是没有未知 GPU 进程的证明。':'观察接口未提供 / 待核。','ai-empty');
      for(const j of observations||[]){
        const d=add(obs,'details',undefined,'ai-external-item');d.dataset.externalId=j.id;d.open=opened.has(j.id);add(d,'summary',(stale()||old(j.observedAt)?'历史待核 · ':'')+'仅观察 / 未准入 · '+j.id);
        const dl=add(d,'dl',undefined,'ai-facts');pair(dl,'来源 / 时间',(j.source||'待核')+' / '+time(j.observedAt));pair(dl,'容器 ID',j.containerId);pair(dl,'进程身份',j.identity);
        pair(dl,'模板匹配',j.templateMatch===true?'匹配（不代表批准、准入或执行登记）':'未匹配 / 待核');pair(dl,'权限边界','仅观察，不追认、不加入调度、不发起重跑');
      }
    }
    function renderAudit(){
      let area=$('ai-audit');
      if(!area){area=el('details',undefined,'ai-inline');area.id='ai-audit';area.append(el('summary','最近AI操作记录'));const list=el('div');list.id='ai-audit-events';area.append(list);$('ai-model-table').after(area);}
      const list=$('ai-audit-events');list.replaceChildren();const data=S.snapshot?.auditEvents;
      if(!Array.isArray(data)){add(list,'p','操作记录尚未读取，待核。','ai-caption');return;}
      add(list,'p',(stale()?'历史 / 过期，待核 · ':'')+'显示最近 '+data.length+' 条持久记录；包含原入口任务和已验证管理员操作。','ai-caption');
      if(!data.length){add(list,'p','目前没有操作记录。','ai-caption');return;}
      const items=add(list,'ol',undefined,'ai-audit-list');
      for(const e of data){const item=add(items,'li');add(item,'strong',time(e.at)+' · '+(e.actor||'操作者待核'));add(item,'p',(e.action||'动作待核')+' · '+(e.target_id||e.task_id||'目标待核')+' · '+(e.before_state??'—')+' → '+(e.after_state??'—')+' · '+(e.result_code||'状态待核'));}
    }
    function lifecycleActions(parent,model,runtimes) {
      if(!manage()||model.admission==='retired')return;
      const controls=add(parent,'div',undefined,'ai-actions');
      if(!model.approved)controls.append(button('批准候选',()=>openControl('candidate.approve',model.modelId)));
      if(model.admission!=='enabled')controls.append(button('启用模型',()=>openControl('model.enable',model.modelId)));
      for(const r of runtimes){const state=S.snapshot.status.services[r.runtime]?.admission||r.admission;
        if(!['disabled','draining'].includes(state))controls.append(button('排空停用 '+r.runtime,()=>openControl('runtime.disable',r.runtime)));
        if(state==='disabled'&&model.approved===true&&model.admission==='enabled')controls.append(button('恢复接单 '+r.runtime,()=>openControl('runtime.enable',r.runtime)));
      }
      const drained=runtimes.every(r=>(S.snapshot.status.services[r.runtime]?.admission||r.admission)==='disabled');
      if(drained)controls.append(button('退役登记',()=>openControl('model.retire',model.modelId)));
      else add(parent,'span','先排空停用所有实例，才可退役。','ai-cell-sub');
      if(!model.evidence?.measured||!model.evidence?.adapterVerified)add(parent,'span','启用需适配器与峰值证据；未满足会由后台拒绝，不下载或运行。','ai-cell-sub');
    }
    function openControl(action,target){
      if(!manage())return;
      const bound=S.snapshot?.tasks.find(t=>t.id===target);
      S.control={action,target,task:bound?{...bound,containerId:S.snapshot.registry.runtimes[bound.runtime]?.containerId}:null,version:S.snapshot?.registry.models[target]?.version||S.snapshot?.registry.models[S.snapshot?.registry.runtimes[target]?.modelId]?.version||null,configRev:S.snapshot?.registry.configRev||null};const panel=$('ai-control-panel');panel.hidden=false;
      const names={'candidate.approve':'批准候选','model.enable':'启用模型','runtime.disable':'排空停用','runtime.enable':'恢复接单','model.retire':'退役登记','task.cancel':'取消未派发任务','task.resolveUnknown':'核实结果丢失'};
      $('ai-control-title').textContent=names[action]+' · '+target;
      const copy={'candidate.approve':'只提交已有真实测量与质量验收证据。缺适配器、缺峰值会被后台拒绝。','model.enable':'批准与资源证据必须满足；启用只是接入登记，不能冒充模型已经运行。','runtime.disable':'停止接新任务；在途自然完成后才由后台核实停用。本页不会强杀；排空中不等于已停止。','runtime.enable':'仅恢复同一已批准版本的接单；后台核对实例与配置。不会立即启动，也不允许绕过新候选验收。','task.resolveUnknown':'明确确认本任务结果不可恢复，记为失败。后台仍须独立核实新鲜空闲、版本和容器身份，不足就拒绝；不停止模型、不删除产物、不重播，不会标记成功。','model.retire':'仅停止使用并解除接入；保留权重、输出与历史。永久删除不在本次授权范围。'};
      $('ai-control-explanation').textContent=action==='task.cancel'?'仅取消目标 '+target+' 这一项未派发、未持有资源的排队任务；不取消上游依赖、不强停在途。若已经派发，后台必须拒绝；收起详情不是取消。':copy[action];$('ai-approval-fields').hidden=action!=='candidate.approve';
      $('ai-loss-confirm-row').hidden=action!=='task.resolveUnknown';$('ai-loss-confirm').required=action==='task.resolveUnknown';$('ai-loss-confirm').checked=false;
      $('ai-control-form').querySelector('button[type=submit]').textContent=action==='task.resolveUnknown'?'确认结果丢失并核实释放':'确认管理动作';
      for(const id of ['ai-approval-evidence','ai-peak-ram','ai-peak-vram','ai-adapter-verified'])$(id).required=action==='candidate.approve';
      $('ai-confirm-target').value='';$('ai-confirm-target').placeholder=target;
      message('ai-control-result','');panel.scrollIntoView({block:'nearest',behavior:'auto'});$('ai-confirm-target').focus({preventScroll:true});
    }
    $('ai-control-close').addEventListener('click',()=>{$('ai-control-panel').hidden=true;S.control=null;});
    $('ai-register-toggle').addEventListener('click',()=>{const f=$('ai-candidate-form');f.hidden=!f.hidden;$('ai-register-toggle').setAttribute('aria-expanded',String(!f.hidden));if(!f.hidden)$('ai-model-id').focus({preventScroll:true});});
    $('ai-candidate-form').addEventListener('submit',async event=>{
      event.preventDefault();if(S.busy||!manage())return;S.busy=true;
      const candidate={modelId:$('ai-model-id').value,version:$('ai-model-version').value,adapter:$('ai-adapter').value,weights:$('ai-weights').value.split(',').map(s=>s.trim()).filter(Boolean),evidence:null};
      if($('ai-source').value||$('ai-evidence-id').value)candidate.evidence={measured:false,sourceLicense:$('ai-source').value,evidenceId:$('ai-evidence-id').value||null};
      const b=event.submitter;if(b)b.disabled=true;message('ai-candidate-result','正在登记并读回核实…');
      try{await writeAndVerify('control',{action:'candidate.register',candidate},data=>{const c=data.registry.models[candidate.modelId];return candidateMatches(c,candidate);});message('ai-candidate-result','已读回确认候选 '+candidate.modelId+' · 未下载、未部署、未运行。');}
      catch(err){message('ai-candidate-result',fail(err),true);}
      finally{S.busy=false;if(b)b.disabled=false;}
    });
    $('ai-control-form').addEventListener('submit',async event=>{
      event.preventDefault();if(S.busy||!manage()||!S.control)return;
      const {action,target,version}=S.control;
      if($('ai-confirm-target').value!==target){message('ai-control-result','确认标识必须与完整目标精确一致。',true);return;}
      const command={action,...(action.startsWith('task.')?{planId:target}:action.startsWith('runtime.')?{runtime:target,expectedVersion:version}:{modelId:target,expectedVersion:version})};
      if(action==='task.resolveUnknown'){const b=S.control.task;if(!$('ai-loss-confirm').checked||!b||!b.modelVersion||!b.configRev||!/^[a-f0-9]{64}$/.test(b.containerId||'')){message('ai-control-result','确认结果丢失并核对任务版本、容器身份后才可请求；缺信息先刷新。',true);return;}Object.assign(command,{confirmation:'RESULT_UNRECOVERABLE_MARK_FAILED',expectedVersion:b.modelVersion,expectedConfigRev:b.configRev,expectedContainerId:b.containerId});}
      if(action==='candidate.approve'){
        const ram=Number($('ai-peak-ram').value),vram=Number($('ai-peak-vram').value);
        if(!Number.isSafeInteger(ram)||ram<=0||!Number.isSafeInteger(vram)||vram<=0||!$('ai-adapter-verified').checked||!$('ai-approval-evidence').value){message('ai-control-result','缺少真实峰值、适配器核实或证据ID，不能批准。',true);return;}
        command.decision='approved';command.evidence={...S.snapshot.registry.models[target]?.evidence,measured:true,peakRamMiB:ram,peakVramMiB:vram,adapterVerified:true,evidenceId:$('ai-approval-evidence').value};
      }
      S.busy=true;const b=event.submitter;if(b)b.disabled=true;message('ai-control-result','正在提交并读回目标…');
      try{
        await writeAndVerify('control',command,data=>{
          if(action==='task.cancel')return data.tasks.some(t=>t.id===target&&t.state==='cancelled');
          if(action==='task.resolveUnknown')return data.tasks.some(t=>t.id===target&&t.state==='failed'&&t.holdsResource===false&&t.resolution==='RESULT_UNRECOVERABLE_MARK_FAILED'&&t.resolvedBy===S.session.user&&t.modelVersion===command.expectedVersion&&t.configRev===command.expectedConfigRev);
          const model=data.registry.models[target];
          if(action==='candidate.approve')return model?.approved===true&&model.version===version&&semanticEqual(model.evidence,command.evidence);
          if(action==='model.enable')return model?.admission==='enabled'&&model.version===version;
          if(action==='model.retire')return model?.admission==='retired'&&model.version===version;
          if(action==='runtime.enable'){const r=data.registry.runtimes[target];return r?.admission==='enabled'&&data.registry.models[r.modelId]?.version===version;}
          return ['draining','disabled'].includes(data.status.services[target]?.admission||data.registry.runtimes[target]?.admission);
        });
        const state=S.snapshot.status.services[target]?.admission||S.snapshot.registry.runtimes[target]?.admission;
        message('ai-control-result',action==='task.resolveUnknown'?'已读回核实：结果丢失，记为失败；只释放程序占位，未停止模型或删除产物。':action==='task.cancel'?'已读回确认取消目标 '+target+' · 仅此未派发任务；未强停在途。':action==='runtime.disable'&&state==='draining'?'已读回确认：排空中；尚未确认停止，不截断在途任务。':action==='runtime.enable'?'已读回确认恢复接单 '+target+' · 未立即启动模型，下一请求按需唤醒。':'已读回确认 '+target+' · '+label(action==='candidate.approve'?'已批准':action==='model.enable'?'enabled':action==='model.retire'?'retired':'disabled'));
      }catch(err){message('ai-control-result',fail(err)+' 表单已保留。',true);}
      finally{S.busy=false;if(b)b.disabled=false;}
    });
    function renderHardwareNote(){
      const hw=S.snapshot?.hardware;
      if(!hw)return;
      const incomplete=hw.stale!==false||old(hw.observedAt)||!Array.isArray(hw.gpus)||!hw.gpus.length;
      const parts=['遥测 '+time(hw.observedAt)+(incomplete?' · 缺采 / 过期，待核':'')];
      const gpus=hw.gpus||[],valid=gpus.filter(g=>n(g.powerWatts));
      parts.push('GPU合计 '+(hw.stale===false&&!old(hw.observedAt)&&n(hw.gpuPowerWatts)?Number(hw.gpuPowerWatts).toFixed(1)+' W':'未知')+(valid.length!==gpus.length||!gpus.length?'（采样不完整）':'')+'，非整机功率');
      parts.push('CPU负载 '+(hw.cpu?.load??'未知')+' · '+(hw.cpu?.cores??'未知')+' 核（非CPU利用率） · 温度 '+(n(hw.cpu?.temperature)?hw.cpu.temperature+'°C':'未知'));
      parts.push('MemAvailable '+(n(hw.memory?.availableBytes)?(Number(hw.memory.availableBytes)/1073741824).toFixed(1)+' GiB':'未知'));
      $('ai-hardware-note').textContent=parts.join(' · ');
    }
    function render(){
      permissions();const snap=S.snapshot;
      window.YETI_AI_OBSERVATION={fresh:!stale(),services:snap?.status?.services||{}};
      doc.dispatchEvent(new Event('ai-observation-ready'));
      if(!snap)return;
      const isStale=stale();
      $('ai-connection').classList.remove('is-error');
      $('ai-connection').textContent=!S.connected?'AI接口未连接 / 待核；保留上次读取供参考，禁止据此操作。':isStale?'AI数据已过期 / 待核，不沿用健康绿灯。':'计划服务已连接 · 只读取快照，不唤醒模型';
      $('ai-revisions').textContent='期望 '+snap.configRev+' / 实际 '+(snap.actualConfigRev||'未知')+(snap.actualConfigRev!==snap.configRev?' · 配置未对齐，后台准入需复核':'')+' · 采集 '+time(snap.generatedAt)+' · 每 3 秒刷新';
      const activeGroupKeys=new Set(Object.values(snap.registry.runtimes||{}).map(r=>['main','gpu2','gpu4'].includes(r.group)?r.group:'runtime:'+r.runtime));
      const groups=Object.entries(snap.status.groups||{}).filter(([key,g])=>(snap.actualConfigRev!==snap.configRev||activeGroupKeys.has(key))&&(g.blockedReason||g.recoveryState==='manual_required'));
      groupStatus.textContent=groups.map(([name,g])=>(isStale?'历史待核 · ':'')+name+'：'+(g.blockedReason||'等待核实')+(g.recoveryState==='manual_required'?' · 自动恢复已停止，需人工处理':'')+(n(g.recoveryAttempts)?' · 已恢复尝试 '+g.recoveryAttempts+' 次':'')).concat((snap.notices||[]).map(notice=>notice&&typeof notice==='object'&&typeof notice.message==='string'?notice.message:pretty(notice))).join(' · ');
      groupStatus.hidden=!groupStatus.textContent;
      const limits=snap.limits||{};limitNote.textContent='后台当前限额：'+(n(limits.maxBodyBytes)?'请求 '+limits.maxBodyBytes+' B':'请求上限待核')+' · '+(n(limits.maxQueuedPlans)?'队列 '+limits.maxQueuedPlans+' 项':'队列上限待核')+(n(limits.maxPrivateBytes)?' · 私有存储 '+limits.maxPrivateBytes+' B':'')+(n(limits.minFreeDiskBytes)?' · 最小可用磁盘 '+limits.minFreeDiskBytes+' B':'')+'。仅取实际接口值，不代表容量承诺。';
      renderQueue();renderExternal();renderModels();renderAudit();renderHardwareNote();
      const select=$('ai-runtime'),value=select.value,items=jsonRuntimes(Object.values(snap.registry.runtimes));
      if(select.dataset.rev!==JSON.stringify(items.map(r=>[r.runtime,r.admission]))){select.replaceChildren();for(const r of items){const op=add(select,'option',r.runtime+' · '+(snap.registry.models[r.modelId]?.version||'版本待核'));op.value=r.runtime;}if(items.some(r=>r.runtime===value))select.value=value;select.dataset.rev=JSON.stringify(items.map(r=>[r.runtime,r.admission]));}
      if(S.preview&&S.preview.configRev!==snap.configRev)invalidatePreview('登记版本已变化；请保留输入并重新预览。');
    }
    async function snapshot(){
      const data=await request('snapshot');
      if(!data.registry?.models||!data.registry.runtimes||!data.registry.routes||!Array.isArray(data.tasks)||!data.status?.services)throw new Error('快照结构不符合 API-CONTRACT v1，状态待核');
      S.snapshot=data;S.connected=true;render();return data;
    }
    async function refresh(force=false){
      if(S.polling)return;S.polling=true;$('ai-refresh').disabled=true;
      try{if(force||oldSession())S.session=await request('session');await snapshot();}
      catch(err){S.connected=false;render();message('ai-connection','AI未连接 / 待核：'+fail(err),true);}
      finally{S.polling=false;$('ai-refresh').disabled=false;}
    }
    function externalMatches(j,bound,state){return !!j&&j.kind==='planned'&&j.id===bound.id&&['templateId','templateRevision','modelVersion','precision','inputHash','outputHash','initialPromptHash'].every(k=>j[k]===bound[k])&&j.state===state&&j.holdsResource===(state==='reserved')&&(state==='planned'||state==='reserved'||j.containerId===bound.containerId);}
    function openExternalControl(action,j){
      if(!manage()||S.busy||!externalActions(j).includes(action))return;S.externalControl={action,job:{...j}};
      $('ai-external-control-title').textContent=externalActionName(action)+' · '+j.id;$('ai-external-control-explanation').textContent=action==='admit'?'仅在可信 CLI 已就绪时，才为同一已登记任务预留 2 分钟；不创建或启动容器。过期后仍保护占位，不自动续过期租、不自动释放或重放；尚无创建意图时取消后重新规划。通常应交接 planned 同一 ID，由 CLI 执行前申请准入。':action==='resolve'?'明确确认结果不可恢复，只记为失败。固定模板修订与容器身份后，后台仍须独立核实退出、新鲜 GPU 空闲与资源释放；不足就拒绝。不强停、不删除、不重放，不会标成功。':'仅取消此 planned / reserved / unknown 计划；后台允许且尚无创建意图才可取消。不会强停容器、不删除产物；后台拒绝或读回不一致不显示成功。';
      $('ai-external-loss-row').hidden=action!=='resolve';$('ai-external-loss').required=action==='resolve';$('ai-external-loss').checked=false;
      $('ai-external-confirm-target').value='';message('ai-external-control-result','');$('ai-external-control').hidden=false;$('ai-external-control').scrollIntoView({block:'nearest'});
    }
    $('ai-external-control-close').addEventListener('click',()=>{$('ai-external-control').hidden=true;S.externalControl=null;});
    $('ai-external-control-form').addEventListener('submit',async event=>{
      event.preventDefault();if(!manage()||S.busy||!S.externalControl)return;const {action,job}=S.externalControl;
      if($('ai-external-confirm-target').value!==job.id){message('ai-external-control-result','确认标识必须与完整目标精确一致。',true);return;}
      const current=(S.snapshot?.externalJobs||[]).find(j=>j.id===job.id);
      if(!current||!externalActions(current).includes(action)||!['kind','state','templateId','templateRevision','modelVersion','precision','containerId','holdsResource'].every(k=>semanticEqual(current[k],job[k]))){message('ai-external-control-result','目标身份或状态已变化；关闭确认后刷新，不能沿用旧动作。',true);return;}
      const payload={action:'external.'+action,taskId:job.id};
      if(action==='resolve'){if(!$('ai-external-loss').checked){message('ai-external-control-result','必须明确确认结果不可恢复。',true);return;}Object.assign(payload,{confirmation:'RESULT_UNRECOVERABLE_MARK_FAILED',expectedRevision:job.templateRevision,expectedContainerId:job.containerId});}
      S.busy=true;externalPermissions();
      try{const exact=await externalWrite(payload,job,action==='admit'?'reserved':action==='resolve'?'failed':'cancelled');message('ai-external-control-result','已读回确认 '+exact.id+' · '+exact.state+' · '+exact.modelVersion+' · '+exact.templateRevision+(action==='admit'?'；仅预留资源，等待可信 CLI，尚未启动。':action==='resolve'?'；结果不可恢复，记为失败，未强停、删除或重放。':'；未强停或删除。'));S.externalControl=null;}
      catch(err){message('ai-external-control-result',fail(err)+' 确认内容已保留，请先核实目标。',true);}
      finally{S.busy=false;externalPermissions();}
    });
    async function externalWrite(payload,bound,state,beforeSend){
      const result=await request('control',payload,beforeSend),target=bound?.id||result?.id;
      if(typeof target!=='string'||!target||target.length>120)throw Object.assign(new Error('写请求已受理，但缺少精确任务 ID；不要重复登记。'),{code:'READBACK_UNCONFIRMED'});
      const expected={...bound,id:target};let exact,latest;
      try{exact=await request('external/job?taskId='+encodeURIComponent(target));latest=await snapshot();}
      catch(err){S.connected=false;render();throw Object.assign(new Error('任务 '+target+' 写请求已受理，但精确读回失败；请勿重复提交。'+fail(err)),{code:'READBACK_FAILED'});}
      if(stale()||!externalMatches(result,expected,state)||!externalMatches(exact,expected,state)||!(latest.externalJobs||[]).some(j=>externalMatches(j,expected,state)))throw Object.assign(new Error('任务 '+target+' 的 ID / 版本 / 模板修订 / 状态读回未核实；不显示成功，不自动重试。'),{code:'READBACK_UNCONFIRMED'});
      if(['cancelled','failed'].includes(state)&&(!Array.isArray(latest.leases)||latest.leases.some(l=>l.taskId===target)))throw Object.assign(new Error('任务 '+target+' 的租约释放读回未核实；不显示成功。'),{code:'READBACK_UNCONFIRMED'});
      if(state==='failed'&&![result,exact,(latest.externalJobs||[]).find(j=>j.id===target)].every(j=>j.resolution===payload.confirmation&&j.resolvedBy===S.session?.user))throw Object.assign(new Error('任务 '+target+' 的结果丢失确认 / 操作者读回未核实。'),{code:'READBACK_UNCONFIRMED'});
      return exact;
    }
    $('ai-external-template').addEventListener('change',()=>{S.externalPin=null;message('ai-external-pinned','模板选择已变化，请重新固定版本。');externalPermissions();});
    $('ai-external-pin').addEventListener('click',()=>{
      if(!manage()||S.busy||S.externalAttempt)return;const t=(S.snapshot?.externalTemplates||[]).find(t=>t.id===$('ai-external-template').value&&approvedExternal(t));if(!t)return;
      S.externalPin={id:t.id,revision:t.revision,modelVersion:t.modelVersion,precision:t.precision};message('ai-external-pinned','已固定 '+t.id+' · '+t.modelVersion+' · '+t.precision+' · 修订 '+t.revision+'；批准不等于峰值已测。');externalPermissions();
    });
    $('ai-external-plan-form').addEventListener('submit',async event=>{
      event.preventDefault();if(S.busy||!manage()||S.externalAttempt||!externalPinValid())return;
      const validRef=(v,suffix)=>v.length>0&&v.length<=512&&!/[\\\\\x00-\x1f]/.test(v)&&!v.startsWith('/')&&v.split('/').every(p=>p&&p!=='.'&&p!=='..')&&v.endsWith(suffix);
      const inputRef=$('ai-external-input').value,outputRef=$('ai-external-output').value,p={...S.externalPin};
      if(!validRef(inputRef,'.wav')||!validRef(outputRef,'.json')){message('ai-external-plan-result','引用必须是固定工作挂载内的相对 .wav / .json 文件，不含绝对路径、反斜杠、控制字符或点目录。',true);return;}
      S.busy=true;externalPermissions();let job;
      message('ai-external-plan-result','先持久登记，再读回精确任务；不会启动容器…');
      try{
        const inputHash=await sha256(inputRef),outputHash=await sha256(outputRef);
        if(!externalPinValid()||!semanticEqual(S.externalPin,p))throw new Error('模板已变化，请重新固定版本。');
        job=await externalWrite({action:'external.plan',templateId:p.id,expectedRevision:p.revision,inputRef,outputRef},{templateId:p.id,templateRevision:p.revision,modelVersion:p.modelVersion,precision:p.precision,inputHash,outputHash,initialPromptHash:null},'planned',()=>{S.externalAttempt=true;externalPermissions();});
        message('ai-external-plan-result','已读回确认 '+job.id+' · planned · '+job.modelVersion+' · '+job.templateRevision+'。任务已登记，但尚未开始，也没有设置定时。请让服务器执行程序（可信 CLI）接手同一任务后启动；不要重复登记。');
      }catch(err){message('ai-external-plan-result',fail(err)+(job?' 已登记任务 '+job.id+' 保留；请查该 ID，不要新建重提。':S.externalAttempt?' 本次提交已锁定；先刷新核对是否已登记，不要盲目重提。':' 尚未发出登记请求；修正后可重试。')+' 输入已保留。',true);}
      finally{S.busy=false;externalPermissions();}
    });
    async function writeAndVerify(path,payload,verify){
      const result=await request(path,payload);
      let latest;
      try{latest=await snapshot();}catch(err){S.connected=false;render();const e=new Error('写请求已受理，但读回失败；状态待核，请勿重复提交。'+fail(err));e.code='READBACK_FAILED';throw e;}
      if(stale()||!verify(latest,result)){const e=new Error('写请求已受理，但目标尚未在快照中核实；请刷新核对，不显示成功。');e.code='READBACK_UNCONFIRMED';throw e;}
      return result;
    }
    function previewView(p){
      const box=$('ai-preview');box.replaceChildren();box.hidden=false;
      add(box,'h4','计划预览 · 尚未提交');const dl=add(box,'dl',undefined,'ai-facts');
      pair(dl,'运行实例',p.runtime);pair(dl,'精确模型版本',p.modelVersion);pair(dl,'绑定配置',p.configRev);pair(dl,'有效至',time(p.expiresAt));
      const steps=add(box,'ol',undefined,'ai-steps');for(const step of p.steps||[])add(steps,'li',({persist:'持久登记',queue:'排队',admission:'资源准入',dispatch:'派发',reconcile:'完成对账'})[step]||pretty(step));
      pair(dl,'资源预算',p.resourceBudget||p.resources||'接口未提供单任务预算，待核；峰值证据不等于准入余量');
      pair(dl,'依赖',S.preview.dependencies?.length?S.preview.dependencies:'无');
      renderEta(box,p.eta,S.preview.dependencies?.length>0);
      for(const w of p.warnings||[])add(box,'p',pretty(w),'ai-caption');
      box.append(button('确认登记异步任务',submitPreview,'ai-primary'));box.lastChild.id='ai-confirm-plan';updatePreviewButton();
    }
    async function prepare(event){
      event.preventDefault();if(S.busy)return;S.busy=true;const inputRevision=S.inputRevision;invalidatePreview();message('ai-plan-result','正在生成预览…');
      try{
        const payload=JSON.parse($('ai-payload').value);if(!payload||Array.isArray(payload)||typeof payload!=='object')throw new Error('payload必须是JSON对象');
        const lines=id=>$(id).value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
        const dependencies=lines('ai-dependencies');const p=await request('plan-preview',{runtime:$('ai-runtime').value,lane:$('ai-plan-lane').value,inputClass:$('ai-input-class').value,payload,inputRefs:lines('ai-input-refs'),dependencies});
        if(!p.previewId||!p.configRev||!p.modelVersion||!n(p.expiresAt))throw new Error('预览缺少版本 / 有效期，不允许提交');
        S.preview={...p,dependencies,invalid:inputRevision!==S.inputRevision};previewView(p);
        if(S.preview.invalid)message('ai-plan-result','预览期间输入已变化；旧预览禁止提交，请重新预览。',true);
        else message('ai-plan-result','预览已生成；核对版本、预算与依赖后再提交。');
      }catch(err){message('ai-plan-result',fail(err),true);}
      finally{S.busy=false;updatePreviewButton();}
    }
    async function submitPreview(){
      if(S.busy||!S.preview||S.preview.invalid||Number(S.preview.expiresAt)<=Date.now())return;
      S.busy=true;updatePreviewButton();const p=S.preview;
      try{
        const result=await writeAndVerify('submit',{previewId:p.previewId,configRev:p.configRev},(data,r)=>!!r.planId&&data.tasks.some(t=>t.id===r.planId&&t.configRev===p.configRev&&t.runtime===p.runtime&&t.modelVersion===p.modelVersion));
        p.invalid=true;message('ai-plan-result','已读回确认任务 '+result.planId+' · 异步执行，关页继续。');
      }catch(err){p.invalid=true;message('ai-plan-result',fail(err)+' 输入已保留；提交结果未核实时请勿重复登记。',true);}
      finally{S.busy=false;updatePreviewButton();}
    }
    $('ai-plan-form').addEventListener('submit',prepare);
    for(const event of ['input','change'])$('ai-plan-form').addEventListener(event,()=>{S.inputRevision++;invalidatePreview('输入已变化；请重新生成预览。');});
    for(const id of ['ai-search','ai-lane','ai-state'])$(id).addEventListener(id==='ai-search'?'input':'change',()=>{S.queuePage=1;renderQueue();});
    for(const [id,step]of [['ai-queue-prev',-1],['ai-queue-next',1]])$(id).addEventListener('click',()=>{S.queuePage+=step;renderQueue();$('ai-queue').scrollIntoView({block:'start'});});
    for(const id of ['ai-external-search','ai-external-state'])$(id).addEventListener(id==='ai-external-search'?'input':'change',renderExternal);
    $('ai-refresh').addEventListener('click',()=>refresh(true));
    refresh();
    const timer=setInterval(()=>{if(!doc.hidden)refresh();},3000);
    S.expiryTimer=setInterval(()=>{const previous=root.dataset.stale;permissions();if(previous!==String(stale()))render();else if(S.snapshot&&renderedObservationSignature!==observationSignature())renderExternal();if(S.preview&&Number(S.preview.expiresAt)<=Date.now())invalidatePreview('预览已到期，请重新预览。');},1000);
    doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)refresh();});
    window.addEventListener('pagehide',()=>{clearInterval(timer);clearInterval(S.expiryTimer);},{once:true});
  }
  return {serviceState,etaText,filterTasks,jsonRuntimes,candidateMatches,artifactUrl,sha256,externalObservationFresh,externalTaskPresentation,mount};
});
