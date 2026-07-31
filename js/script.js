gsap.registerPlugin(ScrollTrigger);

const LIFE_STAGES = ['Childhood','School','College','Career','Marriage','Parenthood','Achievement','Failure','Travel','Illness','Retirement','Legacy'];
const EMOTIONS = ['Joy','Grief','Pride','Regret','Fear','Love','Anger','Peace'];

const SECTIONS = {
  personal:{ key:'personal', label:'Personal', accent:'var(--personal)', hex:'#b79bd0', shared:false, kicker:'THE ONE NOBODY READS',
    purpose:"The unfiltered draft. Regrets, spirals, 2am realizations — too honest for even your closest circle.",
    quip:"Not therapy. Just honest, and free.", note:"Visible to exactly one person: you.",
    prompts:[{key:'what',q:'What actually happened?',hint:'No spin — that\u2019s for later.'},{key:'feel',q:'What are you feeling right now, honestly?',hint:''},{key:'wrong',q:'Write the version where you were wrong',hint:'The part you keep leaving out.'}]},
  family:{ key:'family', label:'Family', accent:'var(--family)', hex:'#e0a06b', shared:false, kicker:'THE APOLOGY YOU HAVEN\u2019T GIVEN',
    purpose:"Where parents get to be people — not just authority figures who occasionally embarrassed you.",
    quip:"Understanding, not just history.", note:"For your kids. Ideally read before the eulogy.",
    prompts:[{key:'age',q:'What was I actually going through at your age?',hint:''},{key:'decision',q:'The decision that shaped our family — and why I made it',hint:''},{key:'understand',q:'What I need you to understand about me',hint:''}]},
  relationship:{ key:'relationship', label:'Relationship', accent:'var(--relationship)', hex:'#d98b8b', shared:false, kicker:'THE TERMS AND CONDITIONS',
    purpose:"Unlocks after trust, not after three dates. Your patterns and boundaries — labeled, not weaponized.",
    quip:"Compatibility needs information, not vibes.", note:"Shared only with someone who's earned it. Revoke anytime.",
    prompts:[{key:'pattern',q:'The pattern I keep repeating, no matter who I date',hint:''},{key:'safe',q:'What I actually need to feel safe',hint:''},{key:'lesson',q:'What the last relationship taught me — blame-free',hint:''}]},
  society:{ key:'society', label:'Society', accent:'var(--society)', hex:'#7fb8a8', shared:true, kicker:'FOR ANYONE STILL FIGURING IT OUT',
    purpose:"Anonymous life lessons for strangers. No likes, no followers, no performance — just the plot.",
    quip:"The rare comment section that isn't trying to ruin your day.", note:"⚠ Public. Everyone using this page can read it.",
    prompts:[{key:'lesson',q:'The lesson that took embarrassingly long to learn',hint:''},{key:'advice',q:'What would you tell someone going through it right now?',hint:''}]},
  legacy:{ key:'legacy', label:'Legacy', accent:'var(--legacy)', hex:'#d4af6a', shared:false, timeLocked:true, kicker:'THE ONE WITH A TIMER',
    purpose:"Messages sealed until a future date — a birthday, an adulthood, a funeral.",
    quip:"'I'll tell them someday' has a 100% failure rate historically.", note:"Sealed until the date you choose.",
    prompts:[{key:'message',q:'When this unlocks, here\u2019s what I want you to know',hint:''},{key:'why',q:'Why this couldn\u2019t be said out loud, until now',hint:''}]}
};
const order = ['personal','family','relationship','society','legacy'];
let openDrawer = 'personal';
const cache = {};

async function loadEntries(k){ if(cache[k]) return cache[k]; const s=SECTIONS[k];
  try{ const res = await window.storage.get('stories:'+k, s.shared); cache[k] = res && res.value ? JSON.parse(res.value) : []; }
  catch(e){ cache[k] = []; } return cache[k]; }
async function saveEntries(k, arr){ const s=SECTIONS[k]; cache[k]=arr;
  try{ await window.storage.set('stories:'+k, JSON.stringify(arr), s.shared); }catch(e){ console.error(e); } }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function fmtDate(ts){ return new Date(ts).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}); }
function escapeHtml(str){ const d=document.createElement('div'); d.textContent=str; return d.innerHTML; }

/* ---------- DRAWERS ---------- */
function buildCabinet(){
  const cab = document.getElementById('cabinet');
  cab.innerHTML = order.map(k=>{
    const s = SECTIONS[k]; const isOpen = k===openDrawer;
    return `<div class="drawer ${isOpen?'open':''}" data-key="${k}">
      <button class="drawer-face">
        <div class="handle" style="--c:${s.hex}">${s.label[0]}</div>
        <div class="label"><div class="title">${s.label}</div><div class="kicker">${s.kicker}</div></div>
        <div class="chev">⌄</div>
      </button>
      <div class="drawer-body"><div class="drawer-inner" id="inner-${k}"></div></div>
    </div>`;
  }).join('');
  cab.querySelectorAll('.drawer-face').forEach(f=>{
    f.addEventListener('click', ()=>{
      const key = f.parentElement.dataset.key;
      openDrawer = (openDrawer===key) ? null : key;
      buildCabinet();
      if(openDrawer) renderDrawerContent(openDrawer);
      ScrollTrigger.refresh();
    });
  });
  if(openDrawer) renderDrawerContent(openDrawer);
}

async function renderDrawerContent(key){
  const s = SECTIONS[key]; const el = document.getElementById('inner-'+key); if(!el) return;
  const entries = await loadEntries(key);
  el.innerHTML = `
    <p style="color:var(--muted); font-size:0.94rem; max-width:60ch;">${s.purpose}</p>
    <p class="quip">${s.quip}</p>
    <div class="visibility-pill">${s.note}</div>
    <div class="new-entry-toggle"><button class="btn solid" id="toggleForm-${key}">+ Add a memory</button></div>
    <form class="entry-form" id="entryForm-${key}">
      <label>Title</label>
      <input type="text" id="f-title-${key}" placeholder="Give this memory a name" required>
      ${s.prompts.map(p=>`<label>${p.q}</label>${p.hint?`<span class="hint">${p.hint}</span>`:''}<textarea data-pk="${p.key}" class="prompt-input-${key}"></textarea>`).join('')}
      <label>Contradiction check <span style="color:var(--muted); text-transform:none; font-weight:400;">(optional)</span></label>
      <span class="hint">Is there a version of this story where you're the villain?</span>
      <textarea id="f-contradiction-${key}"></textarea>
      <label>Memory anchor <span style="color:var(--muted); text-transform:none; font-weight:400;">(optional)</span></label>
      <span class="hint">Not proof — context. Describe the photo you'd attach and what it actually felt like.</span>
      <textarea id="f-anchor-${key}"></textarea>
      <div class="form-row3">
        <div><label>Life stage</label><select id="f-stage-${key}">${LIFE_STAGES.map(ls=>`<option>${ls}</option>`).join('')}</select></div>
        <div><label>Emotion</label><select id="f-emotion-${key}">${EMOTIONS.map(e=>`<option>${e}</option>`).join('')}</select></div>
        <div><label>Who's allowed to read this</label><select id="f-visibility-${key}">
          <option>Just me</option><option>My kids (once they're grown)</option><option>Partner (after trust unlocks)</option><option>Family</option>
          ${s.shared ? '<option selected>Public (anonymous)</option>' : ''}
        </select></div>
      </div>
      ${s.timeLocked ? `<div style="margin-top:16px;"><label>Unlock date</label><input type="date" id="f-unlock-${key}"></div>` : ''}
      <div class="form-actions">
        <button type="submit" class="btn solid">Save to this drawer</button>
        <button type="button" class="btn" id="cancelForm-${key}">Never mind</button>
        <span class="form-status" id="formStatus-${key}"></span>
      </div>
    </form>
    <div class="entries" id="entriesList-${key}"></div>
  `;
  document.getElementById('toggleForm-'+key).addEventListener('click', ()=>{ document.getElementById('entryForm-'+key).classList.toggle('open'); ScrollTrigger.refresh(); });
  document.getElementById('cancelForm-'+key).addEventListener('click', ()=> document.getElementById('entryForm-'+key).classList.remove('open'));
  document.getElementById('entryForm-'+key).addEventListener('submit', (ev)=> onSubmitEntry(ev, key));
  renderEntries(key, entries);
}

function renderEntries(key, entries){
  const s = SECTIONS[key]; const list = document.getElementById('entriesList-'+key); if(!list) return;
  if(!entries.length){ list.innerHTML = `<div class="empty-state">Nothing filed yet in this drawer. Write the first memory.</div>`; return; }
  const sorted = [...entries].sort((a,b)=>b.createdAt-a.createdAt);
  list.innerHTML = sorted.map(e=>{
    const isLocked = s.timeLocked && e.unlockDate && new Date(e.unlockDate) > new Date();
    if(isLocked){ return `<div class="entry-card locked"><div class="meta"><span class="title">${escapeHtml(e.title)}</span><span class="badge sealed">Sealed until ${e.unlockDate}</span></div><div class="sealed-box">This one stays shut until ${e.unlockDate}.</div><button class="del-btn" data-id="${e.id}">Delete entry</button></div>`; }
    const qaHtml = Object.entries(e.answers||{}).filter(([,v])=>v && v.trim()).map(([pk,v])=>{ const pd=s.prompts.find(p=>p.key===pk); return `<div class="q">${pd?pd.q:pk}</div><div class="a">${escapeHtml(v)}</div>`; }).join('');
    return `<div class="entry-card">
      <div class="meta"><span class="title">${escapeHtml(e.title)}</span><span class="stamp-meta">${fmtDate(e.createdAt)}</span></div>
      <div class="tag-row"><span class="tag-chip">${escapeHtml(e.lifeStage||'')}</span><span class="tag-chip">${escapeHtml(e.emotion||'')}</span><span class="tag-chip">${escapeHtml(e.visibility||'Just me')}</span></div>
      <div class="qa">${qaHtml}</div>
      ${e.contradiction ? `<div class="contradiction">"${escapeHtml(e.contradiction)}"</div>` : ''}
      ${e.anchor ? `<div class="anchor"><b>Memory anchor —</b> ${escapeHtml(e.anchor)}</div>` : ''}
      <button class="del-btn" data-id="${e.id}">Delete entry</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.del-btn').forEach(b=>{
    b.addEventListener('click', async ()=>{ const entries = await loadEntries(key); const next = entries.filter(x=>x.id!==b.dataset.id); await saveEntries(key, next); renderEntries(key, next); refreshAll(); });
  });
}

async function onSubmitEntry(ev, key){
  ev.preventDefault(); const s = SECTIONS[key];
  const title = document.getElementById('f-title-'+key).value.trim(); if(!title) return;
  const answers = {}; document.querySelectorAll('.prompt-input-'+key).forEach(t=>{ answers[t.dataset.pk] = t.value.trim(); });
  const contradiction = document.getElementById('f-contradiction-'+key).value.trim();
  const anchor = document.getElementById('f-anchor-'+key).value.trim();
  const lifeStage = document.getElementById('f-stage-'+key).value;
  const emotion = document.getElementById('f-emotion-'+key).value;
  const visibility = document.getElementById('f-visibility-'+key).value;
  const unlockEl = document.getElementById('f-unlock-'+key); const unlockDate = unlockEl ? unlockEl.value : null;
  const entry = { id:uid(), title, answers, contradiction, anchor, lifeStage, emotion, visibility, unlockDate, createdAt: Date.now() };
  const status = document.getElementById('formStatus-'+key); status.textContent = 'Saving…';
  const entries = await loadEntries(key); entries.push(entry); await saveEntries(key, entries);
  status.textContent = 'Saved.'; showStamp();
  document.getElementById('entryForm-'+key).reset(); document.getElementById('entryForm-'+key).classList.remove('open');
  renderEntries(key, entries); refreshAll();
  setTimeout(()=>{ if(status) status.textContent=''; }, 2200);
}
function showStamp(){ if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.createElement('div'); el.className='stamp-fx'; el.textContent='Saved to the locker';
  document.body.appendChild(el); setTimeout(()=>el.remove(),900); }

async function refreshAll(){ await renderNumbers(); await renderTimeline(); await renderConstellation(); ScrollTrigger.refresh(); }

/* ---------- NUMBERS ---------- */
function animateCount(el, target, dur=1.4){
  gsap.fromTo(el, {innerText:0}, { innerText:target, duration:dur, ease:'power2.out', snap:{innerText:1}, onUpdate(){ el.textContent = Math.round(this.targets()[0].innerText); } });
}
async function renderNumbers(){
  let total=0; const stages = new Set();
  for(const k of order){ const entries = await loadEntries(k); total += entries.length; entries.forEach(e=> e.lifeStage && stages.add(e.lifeStage)); }
  document.getElementById('statMemories').dataset.target = total;
  document.getElementById('statStages').dataset.target = stages.size;
}

/* ---------- TIMELINE / CORRIDOR ---------- */
async function renderTimeline(){
  const el = document.getElementById('timelineList');
  let all = [];
  for(const k of order){ const s = SECTIONS[k]; const entries = await loadEntries(k);
    entries.forEach(e=>{ const isLocked = s.timeLocked && e.unlockDate && new Date(e.unlockDate) > new Date();
      all.push({...e, sectionLabel:s.label, hex:s.hex, locked:isLocked}); }); }
  if(!all.length){ el.innerHTML = `<div class="empty-state">No memories filed yet across any drawer.</div>`; return; }
  all.sort((a,b)=>{ const sa=LIFE_STAGES.indexOf(a.lifeStage), sb=LIFE_STAGES.indexOf(b.lifeStage); if(sa!==sb) return sa-sb; return a.createdAt-b.createdAt; });
  el.innerHTML = all.map(e=>`
    <div class="tl-node" style="--dot:${e.hex}">
      <div class="tl-stage">${e.lifeStage || 'Unstaged'}</div>
      <div class="tl-card"><div class="title">${e.locked?'🔒 ':''}${escapeHtml(e.title)}</div><div class="sub">${e.sectionLabel} · ${e.emotion||''} · ${fmtDate(e.createdAt)}</div></div>
    </div>`).join('');
}

/* ---------- CONSTELLATION ---------- */
let constNodes = [];
async function renderConstellation(){
  const canvas = document.getElementById('constellation');
  const emptyEl = document.getElementById('constEmpty');
  let all = [];
  for(const k of order){ const s = SECTIONS[k]; const entries = await loadEntries(k);
    entries.forEach(e=> all.push({...e, hex:s.hex})); }
  constNodes = [];
  if(!all.length){ emptyEl.style.display='flex'; return; }
  emptyEl.style.display='none';
  const w = canvas.clientWidth || 800, h = 440;
  all.forEach((e,i)=>{
    let seed=0; for(const ch of e.id) seed += ch.charCodeAt(0);
    const angle = (seed % 360) * Math.PI/180;
    const r = 60 + (seed % 160);
    constNodes.push({ x: w/2 + Math.cos(angle)*r + (Math.random()*40-20), y: h/2 + Math.sin(angle)*r*0.7 + (Math.random()*40-20),
      hex:e.hex, emotion:e.emotion, title:e.title, phase: Math.random()*Math.PI*2 });
  });
}
function initConstellationCanvas(){
  const canvas = document.getElementById('constellation'); const ctx = canvas.getContext('2d');
  function resize(){ canvas.width = canvas.clientWidth * devicePixelRatio; canvas.height = 440 * devicePixelRatio; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); }
  resize(); window.addEventListener('resize', resize);
  let t=0;
  function draw(){
    t += 0.01;
    const w = canvas.clientWidth, h=440;
    ctx.clearRect(0,0,w,h);
    for(let i=0;i<constNodes.length;i++){
      for(let j=i+1;j<constNodes.length;j++){
        if(constNodes[i].emotion && constNodes[i].emotion === constNodes[j].emotion){
          ctx.strokeStyle = 'rgba(212,175,106,0.12)'; ctx.lineWidth=1;
          ctx.beginPath(); ctx.moveTo(constNodes[i].x, constNodes[i].y); ctx.lineTo(constNodes[j].x, constNodes[j].y); ctx.stroke();
        }
      }
    }
    constNodes.forEach(n=>{
      const fx = n.x + Math.sin(t + n.phase)*4;
      const fy = n.y + Math.cos(t*0.8 + n.phase)*4;
      ctx.beginPath(); ctx.arc(fx, fy, 3, 0, Math.PI*2);
      ctx.fillStyle = n.hex; ctx.shadowColor = n.hex; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur=0;
    });
    requestAnimationFrame(draw);
  }
  draw();
}

/* ---------- HERO DUST PARTICLES ---------- */
function initDust(){
  const canvas = document.getElementById('dust'); const ctx = canvas.getContext('2d');
  function resize(){ canvas.width = canvas.clientWidth*devicePixelRatio; canvas.height = canvas.clientHeight*devicePixelRatio; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); }
  resize(); window.addEventListener('resize', resize);
  const particles = Array.from({length:60}, ()=>({ x:Math.random()*canvas.clientWidth, y:Math.random()*canvas.clientHeight, r:Math.random()*1.4+0.3, s:Math.random()*0.3+0.05, o:Math.random()*0.5+0.2 }));
  function draw(){
    ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);
    particles.forEach(p=>{ p.y -= p.s; if(p.y < -5) p.y = canvas.clientHeight+5;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fillStyle=`rgba(212,175,106,${p.o})`; ctx.fill(); });
    requestAnimationFrame(draw);
  }
  draw();
}

/* ---------- EMBERS (philosophy) ---------- */
function initEmbers(){
  const canvas = document.getElementById('embers'); const ctx = canvas.getContext('2d');
  function resize(){ canvas.width = canvas.clientWidth*devicePixelRatio; canvas.height = canvas.clientHeight*devicePixelRatio; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); }
  resize(); window.addEventListener('resize', resize);
  const embers = Array.from({length:26}, ()=>({ x:Math.random()*canvas.clientWidth, y:canvas.clientHeight+Math.random()*100, r:Math.random()*1.6+0.5, s:Math.random()*0.4+0.15, drift:Math.random()*0.6-0.3, o:Math.random()*0.5+0.2 }));
  function draw(){
    ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);
    embers.forEach(p=>{ p.y -= p.s; p.x += p.drift*0.2; if(p.y < -10) p.y = canvas.clientHeight+10;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fillStyle=`rgba(212,175,106,${p.o})`; ctx.fill(); });
    requestAnimationFrame(draw);
  }
  draw();
}

/* ---------- ATMOSPHERE + REVEALS + SCROLLTRIGGERS ---------- */
function initScrollStory(){
  const atmos = document.getElementById('atmosphere');
  document.querySelectorAll('[data-atmos]').forEach(sec=>{
    ScrollTrigger.create({ trigger:sec, start:'top center', end:'bottom center',
      onEnter:()=> atmos.style.setProperty('background', `radial-gradient(900px 700px at 50% 20%, ${sec.dataset.atmos}, transparent 70%)`),
      onEnterBack:()=> atmos.style.setProperty('background', `radial-gradient(900px 700px at 50% 20%, ${sec.dataset.atmos}, transparent 70%)`)
    });
  });

  // simple fade-up reveals
  document.querySelectorAll('.reveal').forEach(el=>{
    ScrollTrigger.create({ trigger:el, start:'top 85%', onEnter:()=>el.classList.add('in'), onEnterBack:()=>el.classList.add('in') });
  });
  // mask text reveals
  document.querySelectorAll('.mask').forEach(el=>{
    ScrollTrigger.create({ trigger:el, start:'top 88%', onEnter:()=>el.classList.add('in'), onEnterBack:()=>el.classList.add('in') });
  });
  // metaphor cards light up staggered
  ScrollTrigger.create({ trigger:'#metaphorRow', start:'top 80%', onEnter:()=>{
    document.querySelectorAll('.metaphor-card').forEach((c,i)=> setTimeout(()=>c.classList.add('lit'), i*180));
  }});
  // numbers count up
  ScrollTrigger.create({ trigger:'#numbersGrid', start:'top 80%', once:true, onEnter:()=>{
    document.querySelectorAll('.numbers-item .count').forEach(el=> animateCount(el, +el.dataset.target || +el.textContent));
  }});
  // timeline nodes + line fill
  ScrollTrigger.create({ trigger:'#corridorSec', start:'top 70%', end:'bottom bottom', scrub:0.6,
    onUpdate:(self)=>{ document.getElementById('tlFill').style.height = (self.progress*100)+'%'; } });
  ScrollTrigger.create({ trigger:'#timelineList', start:'top 85%', onEnter:()=>{
    document.querySelectorAll('.tl-node').forEach((n,i)=> setTimeout(()=>n.classList.add('in'), i*90));
  }});
}

/* ---------- MAGNETIC BUTTONS ---------- */
function initMagnetic(){
  document.querySelectorAll('.magnetic').forEach(btn=>{
    btn.addEventListener('mousemove', (e)=>{
      const r = btn.getBoundingClientRect();
      const x = e.clientX - r.left - r.width/2, y = e.clientY - r.top - r.height/2;
      gsap.to(btn, { x:x*0.25, y:y*0.4, duration:0.3, ease:'power2.out' });
    });
    btn.addEventListener('mouseleave', ()=> gsap.to(btn, { x:0, y:0, duration:0.4, ease:'elastic.out(1,0.4)' }));
  });
}

/* ---------- HERO GLOW ---------- */
const heroSec = document.getElementById('heroSec'); const heroGlow = document.getElementById('heroGlow');
heroSec.addEventListener('mousemove', (ev)=>{ const r = heroSec.getBoundingClientRect();
  heroGlow.style.setProperty('--mx', ((ev.clientX-r.left)/r.width*100)+'%');
  heroGlow.style.setProperty('--my', ((ev.clientY-r.top)/r.height*100)+'%'); });

document.getElementById('viewDrawers').addEventListener('click', ()=> document.getElementById('locker').scrollIntoView({behavior:'smooth'}));
document.getElementById('viewTimelineBtn').addEventListener('click', ()=> document.getElementById('corridorSec').scrollIntoView({behavior:'smooth'}));

/* ---------- INIT ---------- */
buildCabinet();
initDust();
initEmbers();
initConstellationCanvas();
initMagnetic();
refreshAll().then(()=>{ initScrollStory(); ScrollTrigger.refresh(); });