// js/script.js
// App logic — drawers, timeline, constellation, auth UI, theme.
// All Firebase calls go through js/firebase.js.

import {
  auth,
  signUp,
  logIn,
  loginWithGoogle,
  resetPassword,
  setRememberMe,
  updateDisplayName,
  logOut,
  onAuthChange,
  createMemory,
  updateMemory,
  deleteMemory,
  getUserMemoriesBySection,
  getPublicMemories,
  getAllUserMemories,
  getSettings,
  updateSettings,
} from "./firebase.js";

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
    quip:"The rare comment section that isn't trying to ruin your day.", note:"⚠ Public. Everyone visiting this site can read this drawer.",
    prompts:[{key:'lesson',q:'The lesson that took embarrassingly long to learn',hint:''},{key:'advice',q:'What would you tell someone going through it right now?',hint:''}]},
  legacy:{ key:'legacy', label:'Legacy', accent:'var(--legacy)', hex:'#d4af6a', shared:false, timeLocked:true, kicker:'THE ONE WITH A TIMER',
    purpose:"Messages sealed until a future date — a birthday, an adulthood, a funeral.",
    quip:"'I'll tell them someday' has a 100% failure rate historically.", note:"Sealed until the date you choose.",
    prompts:[{key:'message',q:'When this unlocks, here\u2019s what I want you to know',hint:''},{key:'why',q:'Why this couldn\u2019t be said out loud, until now',hint:''}]}
};
const order = ['personal','family','relationship','society','legacy'];
let openDrawer = 'personal';
let currentUser = null;
let editingId = {};

function escapeHtml(str){ const d=document.createElement('div'); d.textContent=str; return d.innerHTML; }
function fmtDate(ts){
  const d = ts?.seconds ? new Date(ts.seconds*1000) : (ts instanceof Date ? ts : new Date(ts || Date.now()));
  return d.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
}
function tsValue(ts){ return ts?.seconds ? ts.seconds*1000 : (ts || 0); }

// ---------------------------------------------------------------------------
// DATA ACCESS
// ---------------------------------------------------------------------------

async function loadSectionEntries(key){
  const s = SECTIONS[key];
  if(s.shared) return await getPublicMemories('society');
  if(!currentUser) return [];
  return await getUserMemoriesBySection(currentUser.uid, key);
}

async function loadAllEntriesForOverview(){
  let all = [];
  if(currentUser) all = all.concat(await getAllUserMemories(currentUser.uid));
  const publicSociety = await getPublicMemories('society');
  const mineIds = new Set(all.map(e=>e.id));
  publicSociety.forEach(e=>{ if(!mineIds.has(e.id)) all.push(e); });
  return all;
}

// ---------------------------------------------------------------------------
// DRAWERS (CABINET)
// ---------------------------------------------------------------------------

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
  el.innerHTML = `<div class="empty-state">Loading…</div>`;
  const entries = await loadSectionEntries(key);

  const gateHtml = (!s.shared && !currentUser) ? `
    <div class="auth-gate">
      <p>This drawer is private. Sign in to read or write here.</p>
      <button class="btn solid" data-open-auth="login">Log in</button>
      <button class="btn" data-open-auth="signup" style="margin-left:8px;">Sign up</button>
    </div>` : '';

  el.innerHTML = `
    <p style="color:var(--muted); font-size:0.94rem; max-width:60ch;">${s.purpose}</p>
    <p class="quip">${s.quip}</p>
    <div class="visibility-pill">${s.note}</div>
    ${gateHtml}
    ${(s.shared || currentUser) ? `
    <div class="new-entry-toggle">
      <button class="btn solid" id="toggleForm-${key}">+ Add a memory</button>
    </div>
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
      <label>Tags <span style="color:var(--muted); text-transform:none; font-weight:400;">(comma separated, optional)</span></label>
      <input type="text" id="f-tags-${key}" placeholder="e.g. move, first job, heartbreak">
      <div class="form-row3">
        <div><label>Life stage</label><select id="f-stage-${key}">${LIFE_STAGES.map(ls=>`<option>${ls}</option>`).join('')}</select></div>
        <div><label>Emotion</label><select id="f-emotion-${key}">${EMOTIONS.map(e=>`<option>${e}</option>`).join('')}</select></div>
        <div><label>Who's allowed to read this</label><select id="f-audience-${key}">
          <option>Just me</option><option>My kids (once they're grown)</option><option>Partner (after trust unlocks)</option><option>Family</option>
          ${s.shared ? '<option selected>Public (anonymous)</option>' : ''}
        </select></div>
      </div>
      <label style="display:flex; align-items:center; gap:8px; text-transform:none; letter-spacing:0; margin-top:16px;">
        <input type="checkbox" id="f-favorite-${key}" style="width:auto;"> Mark as a favorite memory
      </label>
      ${s.timeLocked ? `<div style="margin-top:16px;"><label>Unlock date</label><input type="date" id="f-unlock-${key}"></div>` : ''}
      <div class="form-actions">
        <button type="submit" class="btn solid" id="submitLabel-${key}">Save to this drawer</button>
        <button type="button" class="btn" id="cancelForm-${key}">Never mind</button>
        <span class="form-status" id="formStatus-${key}"></span>
      </div>
    </form>` : ''}
    <div class="entries" id="entriesList-${key}"></div>
  `;

  el.querySelectorAll('[data-open-auth]').forEach(b=> b.addEventListener('click', ()=> openAuthModal(b.dataset.openAuth)));

  if(s.shared || currentUser){
    document.getElementById('toggleForm-'+key).addEventListener('click', ()=>{
      editingId[key] = null;
      resetForm(key);
      document.getElementById('entryForm-'+key).classList.toggle('open');
      ScrollTrigger.refresh();
    });
    document.getElementById('cancelForm-'+key).addEventListener('click', ()=>{
      editingId[key] = null;
      document.getElementById('entryForm-'+key).classList.remove('open');
    });
    document.getElementById('entryForm-'+key).addEventListener('submit', (ev)=> onSubmitEntry(ev, key));
  }

  renderEntries(key, entries);
}

function resetForm(key){
  const form = document.getElementById('entryForm-'+key);
  if(!form) return;
  form.reset();
  document.getElementById('submitLabel-'+key).textContent = 'Save to this drawer';
}

function renderEntries(key, entries){
  const s = SECTIONS[key]; const list = document.getElementById('entriesList-'+key); if(!list) return;
  if(!entries.length){
    list.innerHTML = `<div class="empty-state">Nothing filed yet in this drawer.${(s.shared||currentUser)?' Write the first memory.':''}</div>`;
    return;
  }
  const sorted = [...entries].sort((a,b)=> tsValue(b.createdAt) - tsValue(a.createdAt));
  const canEdit = (uid)=> currentUser && uid === currentUser.uid;

  list.innerHTML = sorted.map(e=>{
    const isLocked = s.timeLocked && e.unlockDate && new Date(e.unlockDate) > new Date();
    if(isLocked){
      return `<div class="entry-card locked"><div class="meta"><span class="title">${escapeHtml(e.title)}</span><span class="badge sealed">Sealed until ${e.unlockDate}</span></div>
        <div class="sealed-box">This one stays shut until ${e.unlockDate}.</div>
        ${canEdit(e.userId) ? `<button class="del-btn" data-id="${e.id}">Delete entry</button>` : ''}
      </div>`;
    }
    const qaHtml = Object.entries(e.answers||{}).filter(([,v])=>v && v.trim()).map(([pk,v])=>{ const pd=s.prompts.find(p=>p.key===pk); return `<div class="q">${pd?pd.q:pk}</div><div class="a">${escapeHtml(v)}</div>`; }).join('');
    const tagsHtml = (e.tags && e.tags.length) ? e.tags.map(t=>`<span class="tag-chip">#${escapeHtml(t)}</span>`).join('') : '';
    return `<div class="entry-card">
      <div class="meta"><span class="title">${e.favorite ? '★ ' : ''}${escapeHtml(e.title)}</span><span class="stamp-meta">${fmtDate(e.createdAt)}</span></div>
      <div class="tag-row"><span class="tag-chip">${escapeHtml(e.lifeStage||'')}</span><span class="tag-chip">${escapeHtml(e.emotion||'')}</span><span class="tag-chip">${escapeHtml(e.audienceLabel||'Just me')}</span>${tagsHtml}</div>
      <div class="qa">${qaHtml}</div>
      ${e.contradiction ? `<div class="contradiction">"${escapeHtml(e.contradiction)}"</div>` : ''}
      ${e.anchor ? `<div class="anchor"><b>Memory anchor —</b> ${escapeHtml(e.anchor)}</div>` : ''}
      ${canEdit(e.userId) ? `
        <div style="display:flex; gap:14px; margin-top:12px;">
          <button class="del-btn" data-fav-id="${e.id}" data-fav-state="${!!e.favorite}" style="color:var(--gold);">${e.favorite ? 'Unfavorite' : 'Favorite'}</button>
          <button class="del-btn" data-edit-id="${e.id}" style="color:var(--gold);">Edit entry</button>
          <button class="del-btn" data-id="${e.id}">Delete entry</button>
        </div>` : ''}
    </div>`;
  }).join('');

  list.querySelectorAll('[data-id]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      if(!confirm('Delete this memory? This can\'t be undone.')) return;
      await deleteMemory(currentUser.uid, b.dataset.id);
      const fresh = await loadSectionEntries(key);
      renderEntries(key, fresh);
      refreshOverview();
    });
  });
  list.querySelectorAll('[data-edit-id]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const entry = sorted.find(x=>x.id === b.dataset.editId);
      if(entry) beginEdit(key, entry);
    });
  });
  list.querySelectorAll('[data-fav-id]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const newState = b.dataset.favState !== 'true';
      await updateMemory(currentUser.uid, b.dataset.favId, { favorite: newState });
      const fresh = await loadSectionEntries(key);
      renderEntries(key, fresh);
    });
  });
}

function beginEdit(key, entry){
  editingId[key] = entry.id;
  const form = document.getElementById('entryForm-'+key);
  form.classList.add('open');
  document.getElementById('f-title-'+key).value = entry.title || '';
  document.querySelectorAll('.prompt-input-'+key).forEach(t=>{ t.value = (entry.answers && entry.answers[t.dataset.pk]) || ''; });
  document.getElementById('f-contradiction-'+key).value = entry.contradiction || '';
  document.getElementById('f-anchor-'+key).value = entry.anchor || '';
  document.getElementById('f-tags-'+key).value = (entry.tags || []).join(', ');
  document.getElementById('f-stage-'+key).value = entry.lifeStage || LIFE_STAGES[0];
  document.getElementById('f-emotion-'+key).value = entry.emotion || EMOTIONS[0];
  document.getElementById('f-favorite-'+key).checked = !!entry.favorite;
  const audienceEl = document.getElementById('f-audience-'+key);
  if(audienceEl && entry.audienceLabel) audienceEl.value = entry.audienceLabel;
  const unlockEl = document.getElementById('f-unlock-'+key);
  if(unlockEl) unlockEl.value = entry.unlockDate || '';
  document.getElementById('submitLabel-'+key).textContent = 'Save changes';
  form.scrollIntoView({behavior:'smooth', block:'center'});
}

async function onSubmitEntry(ev, key){
  ev.preventDefault();
  const s = SECTIONS[key];
  if(!currentUser){ openAuthModal('login'); return; }

  const title = document.getElementById('f-title-'+key).value.trim(); if(!title) return;
  const answers = {}; document.querySelectorAll('.prompt-input-'+key).forEach(t=>{ answers[t.dataset.pk] = t.value.trim(); });
  const contradiction = document.getElementById('f-contradiction-'+key).value.trim();
  const anchor = document.getElementById('f-anchor-'+key).value.trim();
  const tags = document.getElementById('f-tags-'+key).value.split(',').map(t=>t.trim()).filter(Boolean);
  const lifeStage = document.getElementById('f-stage-'+key).value;
  const emotion = document.getElementById('f-emotion-'+key).value;
  const favorite = document.getElementById('f-favorite-'+key).checked;
  const audienceLabel = document.getElementById('f-audience-'+key).value;
  const unlockEl = document.getElementById('f-unlock-'+key); const unlockDate = unlockEl ? unlockEl.value : null;

  const status = document.getElementById('formStatus-'+key);
  status.textContent = 'Saving…';

  const payload = { title, answers, contradiction, anchor, tags, lifeStage, emotion, favorite, audienceLabel, unlockDate };

  try{
    if(editingId[key]){
      await updateMemory(currentUser.uid, editingId[key], payload);
    } else {
      await createMemory(currentUser.uid, key, { ...payload, visibility: s.shared ? 'public' : 'private' });
    }
    status.textContent = 'Saved.';
    showStamp();
  }catch(err){
    console.error(err);
    status.textContent = 'Something went wrong — try again.';
    return;
  }

  editingId[key] = null;
  resetForm(key);
  document.getElementById('entryForm-'+key).classList.remove('open');
  const fresh = await loadSectionEntries(key);
  renderEntries(key, fresh);
  refreshOverview();
  setTimeout(()=>{ if(status) status.textContent=''; }, 2200);
}

function showStamp(){
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.createElement('div'); el.className='stamp-fx'; el.textContent='Saved to the locker';
  document.body.appendChild(el); setTimeout(()=>el.remove(),900);
}

// ---------------------------------------------------------------------------
// LIFE IN NUMBERS / CORRIDOR / CONSTELLATION
// ---------------------------------------------------------------------------

function animateCount(el, target, dur=1.4){
  gsap.fromTo(el, {innerText:0}, { innerText:target, duration:dur, ease:'power2.out', snap:{innerText:1}, onUpdate(){ el.textContent = Math.round(this.targets()[0].innerText); } });
}

async function refreshOverview(){
  const all = await loadAllEntriesForOverview();
  renderNumbers(all);
  renderTimeline(all);
  renderConstellation(all);
  ScrollTrigger.refresh();
}

function renderNumbers(all){
  const stages = new Set(all.filter(e=>e.lifeStage).map(e=>e.lifeStage));
  document.getElementById('statMemories').dataset.target = all.length;
  document.getElementById('statStages').dataset.target = stages.size;
}

function renderTimeline(all){
  const el = document.getElementById('timelineList');
  if(!all.length){ el.innerHTML = `<div class="empty-state">No memories filed yet across any drawer.</div>`; return; }
  const withMeta = all.map(e=>{
    const s = SECTIONS[e.section] || {};
    const isLocked = s.timeLocked && e.unlockDate && new Date(e.unlockDate) > new Date();
    return { ...e, sectionLabel: s.label || e.section, hex: s.hex || '#d4af6a', locked: isLocked };
  });
  withMeta.sort((a,b)=>{ const sa=LIFE_STAGES.indexOf(a.lifeStage), sb=LIFE_STAGES.indexOf(b.lifeStage); if(sa!==sb) return sa-sb; return tsValue(a.createdAt)-tsValue(b.createdAt); });
  el.innerHTML = withMeta.map(e=>`
    <div class="tl-node" style="--dot:${e.hex}">
      <div class="tl-stage">${e.lifeStage || 'Unstaged'}</div>
      <div class="tl-card"><div class="title">${e.locked?'🔒 ':''}${e.favorite?'★ ':''}${escapeHtml(e.title)}</div><div class="sub">${e.sectionLabel} · ${e.emotion||''} · ${fmtDate(e.createdAt)}</div></div>
    </div>`).join('');
}

let constNodes = [];
function renderConstellation(all){
  const emptyEl = document.getElementById('constEmpty');
  const canvas = document.getElementById('constellation');
  constNodes = [];
  if(!all.length){ emptyEl.style.display='flex'; return; }
  emptyEl.style.display='none';
  const w = canvas.clientWidth || 800, h = 440;
  all.forEach((e)=>{
    const s = SECTIONS[e.section] || {};
    let seed=0; for(const ch of (e.id||'x')) seed += ch.charCodeAt(0);
    const angle = (seed % 360) * Math.PI/180;
    const r = 60 + (seed % 160);
    constNodes.push({ x: w/2 + Math.cos(angle)*r + (Math.random()*40-20), y: h/2 + Math.sin(angle)*r*0.7 + (Math.random()*40-20),
      hex: s.hex || '#d4af6a', emotion:e.emotion, title:e.title, phase: Math.random()*Math.PI*2 });
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

// ---------------------------------------------------------------------------
// AMBIENT CANVASES
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SCROLL STORYTELLING
// ---------------------------------------------------------------------------

function initScrollStory(){
  const atmos = document.getElementById('atmosphere');
  document.querySelectorAll('[data-atmos]').forEach(sec=>{
    ScrollTrigger.create({ trigger:sec, start:'top center', end:'bottom center',
      onEnter:()=> atmos.style.setProperty('background', `radial-gradient(900px 700px at 50% 20%, ${sec.dataset.atmos}, transparent 70%)`),
      onEnterBack:()=> atmos.style.setProperty('background', `radial-gradient(900px 700px at 50% 20%, ${sec.dataset.atmos}, transparent 70%)`)
    });
  });
  document.querySelectorAll('.reveal').forEach(el=>{
    ScrollTrigger.create({ trigger:el, start:'top 85%', onEnter:()=>el.classList.add('in'), onEnterBack:()=>el.classList.add('in') });
  });
  document.querySelectorAll('.mask').forEach(el=>{
    ScrollTrigger.create({ trigger:el, start:'top 88%', onEnter:()=>el.classList.add('in'), onEnterBack:()=>el.classList.add('in') });
  });
  ScrollTrigger.create({ trigger:'#metaphorRow', start:'top 80%', onEnter:()=>{
    document.querySelectorAll('.metaphor-card').forEach((c,i)=> setTimeout(()=>c.classList.add('lit'), i*180));
  }});
  ScrollTrigger.create({ trigger:'#numbersGrid', start:'top 80%', once:true, onEnter:()=>{
    document.querySelectorAll('.numbers-item .count').forEach(el=> animateCount(el, +el.dataset.target || +el.textContent));
  }});
  ScrollTrigger.create({ trigger:'#corridorSec', start:'top 70%', end:'bottom bottom', scrub:0.6,
    onUpdate:(self)=>{ document.getElementById('tlFill').style.height = (self.progress*100)+'%'; } });
  ScrollTrigger.create({ trigger:'#timelineList', start:'top 85%', onEnter:()=>{
    document.querySelectorAll('.tl-node').forEach((n,i)=> setTimeout(()=>n.classList.add('in'), i*90));
  }});
}

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

// ---------------------------------------------------------------------------
// AUTH UI
// ---------------------------------------------------------------------------

let authMode = 'login';

function openAuthModal(mode){
  authMode = mode;
  document.getElementById('authOverlay').classList.add('open');
  document.getElementById('authError').textContent = '';
  document.getElementById('authHeading').textContent = mode === 'login' ? 'Welcome back' : 'Start your archive';
  document.getElementById('authSub').textContent = mode === 'login'
    ? 'Log in to read and write in your private drawers.'
    : 'One account, five private drawers, kept off the record.';
  document.getElementById('authSubmitBtn').textContent = mode === 'login' ? 'Log in' : 'Sign up';
  document.getElementById('authSwitch').innerHTML = mode === 'login'
    ? `Don't have an account? <button id="authToggleMode">Sign up</button>`
    : `Already have an account? <button id="authToggleMode">Log in</button>`;
  document.getElementById('authToggleMode').addEventListener('click', ()=> openAuthModal(mode === 'login' ? 'signup' : 'login'));
}
function closeAuthModal(){
  document.getElementById('authOverlay').classList.remove('open');
  document.getElementById('authForm').reset();
}

function initAuthUI(){
  document.getElementById('loginBtn').addEventListener('click', ()=> openAuthModal('login'));
  document.getElementById('signupBtn').addEventListener('click', ()=> openAuthModal('signup'));
  document.getElementById('authClose').addEventListener('click', closeAuthModal);
  document.getElementById('authOverlay').addEventListener('click', (e)=>{ if(e.target.id === 'authOverlay') closeAuthModal(); });

  document.getElementById('googleBtn').addEventListener('click', async ()=>{
    const errEl = document.getElementById('authError'); errEl.textContent = '';
    try{
      await setRememberMe(document.getElementById('rememberMe').checked);
      await loginWithGoogle();
      closeAuthModal();
    }catch(err){ errEl.textContent = friendlyAuthError(err); }
  });

  document.getElementById('forgotPasswordBtn').addEventListener('click', async ()=>{
    const email = document.getElementById('authEmail').value.trim();
    const errEl = document.getElementById('authError');
    if(!email){ errEl.textContent = 'Enter your email above first, then click "Forgot password?" again.'; return; }
    try{
      await resetPassword(email);
      errEl.style.color = '#8fd6b0';
      errEl.textContent = 'Password reset email sent — check your inbox.';
    }catch(err){ errEl.style.color = ''; errEl.textContent = friendlyAuthError(err); }
  });

  document.getElementById('authForm').addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const remember = document.getElementById('rememberMe').checked;
    const errEl = document.getElementById('authError');
    errEl.style.color = ''; errEl.textContent = '';
    try{
      await setRememberMe(remember);
      if(authMode === 'login'){ await logIn(email, password); }
      else { await signUp(email, password); }
      closeAuthModal();
    }catch(err){ errEl.textContent = friendlyAuthError(err); }
  });

  document.getElementById('profileClose').addEventListener('click', ()=> document.getElementById('profileOverlay').classList.remove('open'));
  document.getElementById('profileOverlay').addEventListener('click', (e)=>{ if(e.target.id === 'profileOverlay') document.getElementById('profileOverlay').classList.remove('open'); });
  document.getElementById('profileForm').addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const name = document.getElementById('profileName').value.trim();
    const errEl = document.getElementById('profileError');
    if(!name){ errEl.textContent = 'Name can\u2019t be empty.'; return; }
    try{
      await updateDisplayName(name);
      document.getElementById('profileOverlay').classList.remove('open');
      renderAuthArea();
    }catch(err){ errEl.textContent = 'Could not save — try again.'; }
  });

  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
}

function friendlyAuthError(err){
  const code = err?.code || '';
  if(code.includes('email-already-in-use')) return 'That email already has an account — try logging in instead.';
  if(code.includes('invalid-email')) return 'That email address doesn\u2019t look right.';
  if(code.includes('weak-password')) return 'Password should be at least 6 characters.';
  if(code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential')) return 'Email or password didn\u2019t match.';
  if(code.includes('popup-closed-by-user')) return 'Google sign-in was closed before finishing.';
  return 'Something went wrong. Please try again.';
}

function renderAuthArea(){
  const area = document.getElementById('authArea');
  const themeBtn = `<button class="btn magnetic theme-toggle" id="themeToggle" title="Toggle light/dark">${document.body.classList.contains('light-mode') ? '☀️' : '🌙'}</button>`;
  if(currentUser){
    const initial = (currentUser.displayName || currentUser.email || '?')[0].toUpperCase();
    area.innerHTML = `
      ${themeBtn}
      <button class="auth-pill" id="profileBtn" style="cursor:pointer;"><span class="avatar">${initial}</span>${escapeHtml(currentUser.displayName || currentUser.email)}</button>
      <button class="btn magnetic" id="logoutBtn">Log out</button>
    `;
    document.getElementById('profileBtn').addEventListener('click', ()=>{
      document.getElementById('profileName').value = currentUser.displayName || '';
      document.getElementById('profileError').textContent = '';
      document.getElementById('profileOverlay').classList.add('open');
    });
    document.getElementById('logoutBtn').addEventListener('click', ()=> logOut());
  } else {
    area.innerHTML = `
      ${themeBtn}
      <button class="btn magnetic" id="loginBtn">Log in</button>
      <button class="btn magnetic" id="signupBtn">Sign up</button>
    `;
    document.getElementById('loginBtn').addEventListener('click', ()=> openAuthModal('login'));
    document.getElementById('signupBtn').addEventListener('click', ()=> openAuthModal('signup'));
  }
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  initMagnetic();
}

// ---------------------------------------------------------------------------
// THEME
// ---------------------------------------------------------------------------

async function toggleTheme(){
  const goingLight = !document.body.classList.contains('light-mode');
  document.body.classList.toggle('light-mode', goingLight);
  localStorage.setItem('lsl-theme', goingLight ? 'light' : 'dark');
  if(currentUser){
    try{ await updateSettings(currentUser.uid, { theme: goingLight ? 'light' : 'dark' }); }catch(e){ console.error(e); }
  }
  renderAuthArea();
}

async function initTheme(){
  let theme = localStorage.getItem('lsl-theme') || 'dark';
  if(currentUser){
    try{ const settings = await getSettings(currentUser.uid); theme = settings.theme || theme; }catch(e){ /* ignore */ }
  }
  document.body.classList.toggle('light-mode', theme === 'light');
}

// ---------------------------------------------------------------------------
// HERO GLOW + VIEW BUTTONS
// ---------------------------------------------------------------------------

function initHeroGlow(){
  const heroSec = document.getElementById('heroSec'); const heroGlow = document.getElementById('heroGlow');
  heroSec.addEventListener('mousemove', (ev)=>{ const r = heroSec.getBoundingClientRect();
    heroGlow.style.setProperty('--mx', ((ev.clientX-r.left)/r.width*100)+'%');
    heroGlow.style.setProperty('--my', ((ev.clientY-r.top)/r.height*100)+'%'); });
}

function initViewButtons(){
  document.getElementById('viewDrawers').addEventListener('click', ()=> document.getElementById('locker').scrollIntoView({behavior:'smooth'}));
  document.getElementById('viewTimelineBtn').addEventListener('click', ()=> document.getElementById('corridorSec').scrollIntoView({behavior:'smooth'}));
}

// ---------------------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------------------

buildCabinet();
initDust();
initEmbers();
initConstellationCanvas();
initMagnetic();
initHeroGlow();
initViewButtons();
initAuthUI();
initTheme();

onAuthChange(async (user)=>{
  currentUser = user;
  await initTheme();
  renderAuthArea();
  if(openDrawer) await renderDrawerContent(openDrawer);
  await refreshOverview();
  initScrollStory();
  ScrollTrigger.refresh();
});
