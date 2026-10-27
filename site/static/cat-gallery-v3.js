(() => {
 'use strict';
 const ready=fn=>document.readyState==='loading'?document.addEventListener('DOMContentLoaded',fn,{once:true}):fn();
 ready(()=>{
  const stage=document.getElementById('cat-stage'); if(!stage)return;
  const labels={idle:'发呆与眨眼',walk:'慢慢散步',run:'小跑过来',jump:'开心蹦起',stretch:'伸个懒腰',sleep:'树下打盹',groom:'洗脸时间',love:'喜欢你'};
  const pictures=[...document.querySelectorAll('[data-cat-gif]')];const visible=new WeakSet();
  const still=()=>document.body.dataset.pixelMotion==='still'||document.hidden;
  const sync=()=>{for(const img of pictures){const src=!still()&&visible.has(img)?img.dataset.catGif:img.dataset.catPoster;if(img.getAttribute('src')!==src)img.src=src;}document.getElementById('cat-gallery-motion-note').textContent=still()?'静止模式 · 动作封面仍可查看和下载':'可预览，也可以保存 GIF';};
  if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{for(const e of entries){if(e.isIntersecting)visible.add(e.target);else visible.delete(e.target);}sync();},{rootMargin:'70px'});pictures.forEach(img=>observer.observe(img));}else{pictures.forEach(img=>visible.add(img));}
  new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['data-pixel-motion']});document.addEventListener('visibilitychange',sync);
  document.addEventListener('pixel-cat-state',e=>{const d=e.detail||{};const label=labels[d.action]||d.label||'正在散步';document.getElementById('cat-live-state').textContent=d.mode==='still'?'休息中 · 已暂停':label;document.querySelectorAll('.cat-card').forEach(card=>card.dataset.active=String(card.dataset.action===d.action));});
  const view=()=>stage.scrollIntoView({behavior:still()?'instant':'smooth',block:'start'});
  const canPlay=()=>{if(document.body.dataset.pixelMotion==='still'){document.getElementById('cat-live-state').textContent='先选完整或轻柔，再一起玩';return false;}return !!window.PixelVillage;};
  document.getElementById('cat-watch').addEventListener('click',view);
  document.querySelectorAll('[data-try-action]').forEach(button=>button.addEventListener('click',()=>{view();if(canPlay()&&!window.PixelVillage.playCatAction(button.dataset.tryAction))document.getElementById('cat-live-state').textContent='等它歇一下，再点一次';}));
  document.querySelectorAll('[data-cat-stop]').forEach((button,index)=>button.addEventListener('click',()=>{view();if(canPlay()){const api=window.PixelVillage;const point=api.getState().routePoints?.[index];api.moveCatTo(point?.x??Number(button.dataset.catStop));}}));
  sync();
 });
})();
