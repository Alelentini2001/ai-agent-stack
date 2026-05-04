/**
 * Mobile-first iOS PWA served at GET /app
 * All dynamic content rendered via esc() (HTML entity encoding) before DOM insertion.
 * Protected by APP_TOKEN — personal admin tool, not public-facing.
 */
export function webAppHtml(projectName: string): string {
  const p = projectName.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return buildHtml(p);
}

export function manifestJson(projectName: string): string {
  return JSON.stringify({
    name: `${projectName} AI`,
    short_name: "AI Feed",
    description: "Autonomous AI agent feed",
    start_url: "/app",
    display: "standalone",
    background_color: "#f2f2f7",
    theme_color: "#007aff",
    orientation: "portrait",
    icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  }, null, 2);
}

function buildHtml(p: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="${p}">
<meta name="theme-color" content="#f2f2f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1c1c1e" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="/manifest.json">
<title>${p} AI</title>
<style>
:root{
  --bg:#f2f2f7;--card:#fff;--tert:#e5e5ea;
  --fg:#000;--fg2:#6d6d72;--fg3:#aeaeb2;
  --acc:#007aff;--hi:#ff3b30;--ok:#34c759;--warn:#ff9500;
  --sep:rgba(60,60,67,.12);
  --sh:0 1px 3px rgba(0,0,0,.08),0 4px 14px rgba(0,0,0,.05);
  --blur:blur(20px) saturate(180%);
  --st:env(safe-area-inset-top,44px);
  --sb:env(safe-area-inset-bottom,34px);
}
@media(prefers-color-scheme:dark){:root{
  --bg:#1c1c1e;--card:#2c2c2e;--tert:#3a3a3c;
  --fg:#fff;--fg2:#98989f;--fg3:#636366;
  --sep:rgba(84,84,88,.55);
  --sh:0 1px 3px rgba(0,0,0,.3),0 4px 14px rgba(0,0,0,.2);
}}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
  background:var(--bg);color:var(--fg);-webkit-overflow-scrolling:touch}
.nav{position:fixed;top:0;left:0;right:0;z-index:100;
  background:rgba(242,242,247,.88);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);
  border-bottom:.5px solid var(--sep);padding-top:var(--st)}
@media(prefers-color-scheme:dark){.nav{background:rgba(28,28,30,.9)}}
.nav-bar{display:flex;align-items:center;justify-content:space-between;padding:10px 18px;min-height:44px}
.nav-title{font-size:17px;font-weight:600;letter-spacing:-.4px}
.nav-btn{background:none;border:none;color:var(--acc);cursor:pointer;padding:6px;
  display:flex;align-items:center;border-radius:8px;transition:background .1s}
.nav-btn:active{background:var(--tert)}
.large-title{font-size:34px;font-weight:700;letter-spacing:-.5px;padding:4px 18px 0;line-height:1.1;
  display:flex;align-items:center;gap:10px}
.pill{background:var(--hi);color:#fff;border-radius:9px;font-size:12px;font-weight:700;
  padding:1px 7px;display:none;min-width:20px;text-align:center}
.pill.on{display:inline}
.sub{font-size:13px;color:var(--fg2);padding:2px 18px 8px}
.seg-wrap{padding:8px 18px 10px}
.seg{display:flex;background:var(--tert);border-radius:9px;padding:2px}
.seg-btn{flex:1;padding:7px 0;border:none;background:none;border-radius:7px;
  font-size:13px;font-weight:500;cursor:pointer;color:var(--fg2);transition:all .18s}
.seg-btn.on{background:var(--card);color:var(--fg);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.spacer{height:calc(var(--st) + 200px)}
.tab{display:none;padding:0 14px;flex-direction:column;gap:10px;padding-bottom:calc(var(--sb)+16px)}
.tab.on{display:flex}
.card{background:var(--card);border-radius:16px;padding:16px;box-shadow:var(--sh);transition:transform .14s,opacity .14s}
.card:active{transform:scale(.98);opacity:.9}
.ch{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.risk{padding:3px 9px;border-radius:7px;font-size:11px;font-weight:700;
  letter-spacing:.3px;text-transform:uppercase}
.rH{background:rgba(255,59,48,.12);color:#ff3b30}
.rM{background:rgba(255,149,0,.12);color:#ff9500}
.rL{background:rgba(52,199,89,.12);color:#34c759}
.r0{background:rgba(142,142,147,.12);color:#8e8e93}
.ct{font-size:12px;color:var(--fg3)}
.ci{font-size:12px;color:var(--fg2);font-weight:600;margin-bottom:3px}
.ctitle{font-size:16px;font-weight:600;line-height:1.3;letter-spacing:-.2px}
.cdesc{font-size:13px;color:var(--fg2);margin-top:6px;line-height:1.45}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:10px}
.chip{padding:2px 8px;background:var(--tert);border-radius:5px;font-size:11px;color:var(--fg2);font-weight:500}
.acts{display:flex;gap:10px;margin-top:14px}
.act{flex:1;padding:11px;border:none;border-radius:11px;font-size:15px;font-weight:600;
  cursor:pointer;transition:transform .14s,filter .14s;display:flex;align-items:center;justify-content:center;gap:6px}
.act:active{transform:scale(.96);filter:brightness(.9)}
.act:disabled{opacity:.38;cursor:default}
.app-btn{background:rgba(52,199,89,.14);color:#34c759}
.rej-btn{background:rgba(255,59,48,.11);color:#ff3b30}
.dot{width:8px;height:8px;border-radius:50%;background:#34c759;display:inline-block;
  margin-right:6px;box-shadow:0 0 0 3px rgba(52,199,89,.2);animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 3px rgba(52,199,89,.2)}50%{box-shadow:0 0 0 6px rgba(52,199,89,0)}}
.empty{display:flex;flex-direction:column;align-items:center;padding:56px 28px;text-align:center;gap:10px}
.empty-icon{font-size:52px}
.empty-t{font-size:20px;font-weight:600}
.empty-s{font-size:15px;color:var(--fg2);line-height:1.45;max-width:240px}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.sk{background:linear-gradient(90deg,var(--tert) 25%,rgba(128,128,128,.08) 50%,var(--tert) 75%);
  background-size:200% 100%;animation:shimmer 1.4s infinite;border-radius:7px}
.sk-card{background:var(--card);border-radius:16px;padding:16px;box-shadow:var(--sh);display:flex;flex-direction:column;gap:8px}
.sk-line{height:13px}
.toasts{position:fixed;bottom:calc(var(--sb)+16px);left:0;right:0;
  display:flex;flex-direction:column;align-items:center;gap:8px;z-index:999;pointer-events:none}
.toast{background:rgba(28,28,30,.92);color:#fff;padding:12px 22px;border-radius:26px;
  font-size:14px;font-weight:500;backdrop-filter:blur(20px);
  transform:translateY(120px);opacity:0;transition:transform .32s cubic-bezier(.34,1.56,.64,1),opacity .32s ease}
.toast.show{transform:none;opacity:1}
.ref{text-align:center;padding:10px;font-size:12px;color:var(--fg3);
  display:flex;align-items:center;justify-content:center;gap:6px}
@keyframes spin{to{transform:rotate(360deg)}}
.spin{display:inline-block;animation:spin .9s linear infinite}
</style>
</head>
<body>
<div class="nav">
  <div class="nav-bar">
    <span style="width:32px"></span>
    <span class="nav-title">${p} AI</span>
    <button class="nav-btn" id="ref-btn" title="Refresh">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 4v6h6M23 20v-6h-6"/>
        <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
      </svg>
    </button>
  </div>
  <div class="large-title">Agent Feed <span class="pill" id="pill"></span></div>
  <div class="sub" id="sub">Loading…</div>
  <div class="seg-wrap">
    <div class="seg">
      <button class="seg-btn on" id="t-pending">Pending</button>
      <button class="seg-btn" id="t-active">Active</button>
      <button class="seg-btn" id="t-done">Done</button>
    </div>
  </div>
</div>
<div class="spacer"></div>
<div class="tab on" id="tab-pending"></div>
<div class="tab" id="tab-active"></div>
<div class="tab" id="tab-done"></div>
<div class="ref" id="ref"></div>
<div class="toasts" id="toasts"></div>
<script>
(function(){
  const TOKEN=qs('token')||cookie('app_token')||'';
  const H={'Content-Type':'application/json','X-App-Token':TOKEN};
  const HIGH=['risk:design','risk:schema','risk:deploy','risk:migration','risk:legal-review','risk:security','risk:breaking-change'];
  const MED=['risk:content','risk:copy','risk:config','risk:refactor'];
  let currentTab='pending', timer;

  function qs(k){return new URLSearchParams(location.search).get(k);}
  function cookie(n){return(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith(n+'='))||'').split('=')[1]||'';}
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function ago(iso){
    if(!iso)return'';
    const s=Math.floor((Date.now()-new Date(iso).getTime())/1000);
    if(s<60)return'just now';
    if(s<3600)return Math.floor(s/60)+'m ago';
    if(s<86400)return Math.floor(s/3600)+'h ago';
    return Math.floor(s/86400)+'d ago';
  }
  function riskOf(labels){
    const ns=(labels||[]).map(l=>typeof l==='string'?l:l.name);
    if(ns.some(n=>HIGH.includes(n)))return{cls:'rH',label:'High risk'};
    if(ns.some(n=>MED.includes(n)))return{cls:'rM',label:'Medium'};
    if(ns.length)return{cls:'rL',label:'Low risk'};
    return{cls:'r0',label:'No label'};
  }

  function toast(msg){
    const el=document.createElement('div');
    el.className='toast';
    el.textContent=msg;
    document.getElementById('toasts').appendChild(el);
    requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('show')));
    setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),400);},2600);
  }

  function makeCard(issue,type){
    const r=riskOf(issue.labels);
    const labs=(issue.labels||[]).map(l=>typeof l==='string'?l:l.name);

    const wrap=document.createElement('div');
    wrap.className='card';
    wrap.id='c-'+issue.id;

    const ch=document.createElement('div');ch.className='ch';
    const riskEl=document.createElement('span');riskEl.className='risk '+r.cls;riskEl.textContent=r.label;
    const timeEl=document.createElement('span');timeEl.className='ct';timeEl.textContent=ago(issue.created_at);
    ch.appendChild(riskEl);ch.appendChild(timeEl);
    wrap.appendChild(ch);

    const ci=document.createElement('div');ci.className='ci';ci.textContent=issue.identifier||'';wrap.appendChild(ci);
    const ct=document.createElement('div');ct.className='ctitle';ct.textContent=issue.title;wrap.appendChild(ct);

    if(issue.description){
      const cd=document.createElement('div');cd.className='cdesc';
      cd.textContent=issue.description.slice(0,150)+(issue.description.length>150?'…':'');
      wrap.appendChild(cd);
    }
    if(labs.length){
      const chips=document.createElement('div');chips.className='chips';
      labs.forEach(n=>{const c=document.createElement('span');c.className='chip';c.textContent=n;chips.appendChild(c);});
      wrap.appendChild(chips);
    }

    if(type==='pending'){
      const acts=document.createElement('div');acts.className='acts';
      const appBtn=document.createElement('button');appBtn.className='act app-btn';appBtn.textContent='✅ Approve';
      const rejBtn=document.createElement('button');rejBtn.className='act rej-btn';rejBtn.textContent='❌ Reject';
      appBtn.addEventListener('click',()=>decide(issue.id,'approve',acts));
      rejBtn.addEventListener('click',()=>decide(issue.id,'reject',acts));
      acts.appendChild(appBtn);acts.appendChild(rejBtn);
      wrap.appendChild(acts);
    } else if(type==='active'){
      const f=document.createElement('div');f.style.cssText='margin-top:10px;font-size:13px;color:var(--fg2)';
      const dot=document.createElement('span');dot.className='dot';
      f.appendChild(dot);f.appendChild(document.createTextNode('Agent working…'));
      wrap.appendChild(f);
    } else {
      const f=document.createElement('div');f.style.cssText='margin-top:8px;font-size:13px;color:var(--ok)';
      f.textContent='✓ Completed';wrap.appendChild(f);
    }
    return wrap;
  }

  function renderList(issues,type,containerId){
    const el=document.getElementById(containerId);
    while(el.firstChild)el.removeChild(el.firstChild);
    if(!issues.length){
      const info={pending:['📋','No pending approvals','AI is working autonomously — nothing needs your review right now.'],
                  active:['🔄','Nothing in progress','No tasks being worked on right now.'],
                  done:['✅','No completed tasks','Finished tasks will appear here.']}[type];
      const div=document.createElement('div');div.className='empty';
      const icon=document.createElement('div');icon.className='empty-icon';icon.textContent=info[0];
      const t=document.createElement('div');t.className='empty-t';t.textContent=info[1];
      const s=document.createElement('div');s.className='empty-s';s.textContent=info[2];
      div.appendChild(icon);div.appendChild(t);div.appendChild(s);
      el.appendChild(div);return;
    }
    issues.forEach(i=>el.appendChild(makeCard(i,type)));
  }

  function skeleton(id){
    const el=document.getElementById(id);
    while(el.firstChild)el.removeChild(el.firstChild);
    for(let i=0;i<3;i++){
      const c=document.createElement('div');c.className='sk-card';
      const l1=document.createElement('div');l1.className='sk sk-line';l1.style.width='35%';
      const l2=document.createElement('div');l2.className='sk sk-line';l2.style.cssText='width:80%;height:17px';
      const l3=document.createElement('div');l3.className='sk sk-line';l3.style.width='55%';
      c.appendChild(l1);c.appendChild(l2);c.appendChild(l3);el.appendChild(c);
    }
  }

  async function decide(taskId,decision,actsEl){
    actsEl.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{
      const r=await fetch('/api/app/decide',{method:'POST',headers:H,body:JSON.stringify({taskId,decision})});
      if(!r.ok)throw new Error(await r.text());
      const card=document.getElementById('c-'+taskId);
      if(card){
        card.style.opacity='.5';
        const done=document.createElement('div');done.style.cssText='text-align:center;padding:4px;font-size:14px;color:var(--fg2)';
        done.textContent=decision==='approve'?'✅ Approved':'❌ Rejected';
        actsEl.replaceWith(done);
      }
      toast(decision==='approve'?'Approved ✅':'Rejected ❌');
      setTimeout(doRefresh,1200);
    }catch(e){
      toast('⚠️ '+(e.message||String(e)));
      actsEl.querySelectorAll('button').forEach(b=>b.disabled=false);
    }
  }

  function setTab(t){
    currentTab=t;
    ['pending','active','done'].forEach(id=>{
      document.getElementById('t-'+id).classList.toggle('on',id===t);
      document.getElementById('tab-'+id).classList.toggle('on',id===t);
    });
  }

  async function doRefresh(){
    const ref=document.getElementById('ref');
    const spin=document.createElement('span');spin.className='spin';spin.textContent='↻';
    ref.textContent='';ref.appendChild(spin);ref.appendChild(document.createTextNode(' Refreshing…'));
    try{
      const [a,b,c]=await Promise.all([
        fetch('/api/app/issues?status=todo',{headers:H}).then(r=>r.json()),
        fetch('/api/app/issues?status=in_progress',{headers:H}).then(r=>r.json()),
        fetch('/api/app/issues?status=done',{headers:H}).then(r=>r.json()),
      ]);
      const pending=a.issues||[];
      const active=b.issues||[];
      const done=(c.issues||[]).slice(-15).reverse();

      renderList(pending,'pending','tab-pending');
      renderList(active,'active','tab-active');
      renderList(done,'done','tab-done');

      const pc=pending.length;
      const pill=document.getElementById('pill');
      pill.textContent=String(pc);
      pill.classList.toggle('on',pc>0);

      const now=new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
      document.getElementById('sub').textContent='Updated '+now+' · '+(pending.length+active.length)+' active';
      ref.textContent='';
      setTab(currentTab);
    }catch(e){
      ref.textContent='⚠️ Connection error';
      document.getElementById('sub').textContent='Offline';
    }
  }

  // Wire segment buttons
  ['pending','active','done'].forEach(t=>{
    document.getElementById('t-'+t).addEventListener('click',()=>setTab(t));
  });
  document.getElementById('ref-btn').addEventListener('click',doRefresh);

  // Init
  ['tab-pending','tab-active','tab-done'].forEach(skeleton);
  doRefresh();
  clearInterval(timer);timer=setInterval(doRefresh,20000);

  // Pull to refresh
  let sy=0;
  document.addEventListener('touchstart',e=>{sy=e.touches[0].clientY;},{passive:true});
  document.addEventListener('touchend',e=>{
    if(e.changedTouches[0].clientY-sy>90&&window.scrollY<=0)doRefresh();
  },{passive:true});
})();
</script>
</body>
</html>`;
}
