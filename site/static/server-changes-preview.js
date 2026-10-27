(() => {
'use strict';
const zones=[...document.querySelectorAll('[data-server-changes]')];
if(!zones.length)return;
const statuses={verified:'已验证',observed:'已记录',rolled_back:'已撤回',pending:'待确认'};
async function update(){
 try{
  const response=await fetch('/yeti/server/log/records.json',{cache:'no-store',credentials:'same-origin'});
  if(!response.ok||!(response.headers.get('content-type')||'').includes('json'))throw Error('读取失败');
  const data=await response.json();
  if(!Array.isArray(data.entries)||!data.updated_at)throw Error('格式错误');
  const entries=[...data.entries].sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
  for(const zone of zones){
   const list=zone.querySelector('[data-changes-latest]');
   list.replaceChildren();
   for(const entry of entries.slice(0,3)){
    const li=document.createElement('li');
    const time=document.createElement('time');time.textContent=`${entry.date} · ${entry.time_label} · ${statuses[entry.status]||'待确认'}`;time.dateTime=entry.date;
    const a=document.createElement('a');a.href='/yeti/server/log/#'+encodeURIComponent(entry.id);a.textContent=entry.title;
    li.append(time,a);list.append(li);
   }
   if(!entries.length){const li=document.createElement('li');li.textContent='暂无变更记录';list.append(li);}
   zone.querySelector('[data-changes-updated]').textContent=`共 ${entries.length} 条 · 更新于 ${new Date(data.updated_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`;
  }
 }catch(error){for(const zone of zones){zone.querySelector('[data-changes-updated]').textContent='最近变更暂时读取失败，请打开完整日志查看。';}}
}
update();
setInterval(()=>{if(!document.hidden)update();},60000);
})();
