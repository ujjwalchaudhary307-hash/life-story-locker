// js/script.js
// App logic — drawers (paginated), timeline v2, constellation, auth UI, theme,
// search/filter/sort with suggestions+history, favorites, dashboard, analytics.
// All Firebase calls go through js/firebase.js (unchanged config/architecture).
// Auth logic unchanged.

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
  getUserMemoriesPage,
  getPublicMemories,
  getAllUserMemories,
  getSettings,
  updateSettings,
} from "./firebase.js";

gsap.registerPlugin(ScrollTrigger);

const LIFE_STAGES = ['Childhood','School','College','Career','Marriage','Parenthood','Achievement','Failure','Travel','Illness','Retirement','Legacy'];
const EMOTIONS = ['Joy','Grief','Pride','Regret','Fear','Love','Anger','Peace'];
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const PAGE_SIZE = 8;

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

// Per-drawer pagination state: { [section]: { lastDoc, hasMore, loaded:[], usingFallback:bool } }
let drawerPageState = {};

// Single cache of everything the user can see (own memories + public Society).
// Powers Dashboard, Timeline, Constellation, Search, and Analytics.
let allEntriesCache = [];

let searchState = { query:'', section:'all', emotion:'all', stage:'all', favoritesOnly:false, archivedOnly:false, sort:'newest' };
let timelineSectionFilter = 'all';
let timelineRenderedYears = 0;
let timelineYearGroups = [];
const SEARCH_BATCH = 15;
let searchRenderedCount = SEARCH_BATCH;
let searchObserver = null;

function escapeHtml(str){ const d=document.createElement('div'); d.textContent=str; return d.innerHTML; }

const EMPTY_ICON = `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 24 L32 12 L56 24 L32 36 Z"/><path d="M8 24 V48 L32 60 L56 48 V24"/><path d="M32 36 V60"/></svg>`;

function emptyStateRichHtml({ title, sub, ctaLabel, ctaAction }){
  return `<div class="empty-state-rich">
    ${EMPTY_ICON}
    <div class="empty-title">${escapeHtml(title)}</div>
    <div class="empty-sub">${escapeHtml(sub)}</div>
    ${ctaLabel ? `<button class="btn solid" data-empty-cta="1">${escapeHtml(ctaLabel)}</button>` : ''}
  </div>`;
}
function wireEmptyStateCta(container, action){
  const btn = container.querySelector('[data-empty-cta]');
  if(btn && action) btn.addEventListener('click', action);
}
function fmtDate(ts){
  const d = ts?.seconds ? new Date(ts.seconds*1000) : (ts instanceof Date ? ts : new Date(ts || Date.now()));
  return d.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
}
function tsValue(ts){ return ts?.seconds ? ts.seconds*1000 : (ts || 0); }
function tsDate(ts){ return ts?.seconds ? new Date(ts.seconds*1000) : new Date(ts || Date.now()); }
function debounce(fn, wait){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); }; }
function isVisibleForAnalytics(e){
  // Drafts and archived entries are excluded from Timeline/Constellation/Analytics
  // by default — they're either incomplete or intentionally set aside.
  return e.status !== 'draft' && !e.archived;
}
function isSealed(e){
  const s = SECTIONS[e.section] || {};
  return s.timeLocked && e.unlockDate && new Date(e.unlockDate) > new Date();
}

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
  allEntriesCache = all;
  return all;
}

// ---------------------------------------------------------------------------
// SHARED ENTRY CARD
// ---------------------------------------------------------------------------

function highlightText(text, query){
  if(!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${q})`, 'ig'), '<mark class="search-hit">$1</mark>');
}

function entryCardHtml(e, opts = {}){
  const s = SECTIONS[e.section] || {};
  const locked = isSealed(e);
  const canEditThis = currentUser && e.userId === currentUser.uid;
  const showSourceTag = !!opts.showSource;
  const hl = opts.highlightQuery || '';

  if(locked){
    return `<div class="entry-card locked" data-exhibit-id="${e.id}" data-exhibit-section="${e.section}" tabindex="0" role="button" aria-label="Open exhibit for ${escapeHtml(e.title)}">
      <div class="meta"><span class="title">${escapeHtml(e.title)}</span><span class="badge sealed">Sealed until ${e.unlockDate}</span></div>
      <div class="sealed-box">This one stays shut until ${e.unlockDate}.</div>
      ${canEditThis ? `<button class="del-btn" data-id="${e.id}" data-section="${e.section}">Delete entry</button>` : ''}
    </div>`;
  }
  const qaHtml = Object.entries(e.answers||{}).filter(([,v])=>v && v.trim()).map(([pk,v])=>{
    const pd = (s.prompts||[]).find(p=>p.key===pk);
    return `<div class="q">${pd?pd.q:pk}</div><div class="a">${highlightText(v, hl)}</div>`;
  }).join('');
  const tagsHtml = (e.tags && e.tags.length) ? e.tags.map(t=>`<span class="tag-chip">#${escapeHtml(t)}</span>`).join('') : '';
  const sourceChip = showSourceTag ? `<span class="tag-chip source-tag" data-jump="${e.section}" title="Jump to this drawer">${escapeHtml(s.label||e.section)}</span>` : '';
  const draftBadge = e.status === 'draft' ? `<span class="badge draft">Draft</span>` : '';
  const archivedBadge = e.archived ? `<span class="badge archived">Archived</span>` : '';

  const actions = [];
  if(canEditThis){
    if(e.status === 'draft'){
      actions.push(`<button class="del-btn" data-publish-id="${e.id}" data-publish-section="${e.section}" style="color:#8fd6b0;">Publish</button>`);
    }
    actions.push(`<button class="del-btn" data-fav-id="${e.id}" data-fav-section="${e.section}" data-fav-state="${!!e.favorite}" style="color:var(--gold);">${e.favorite ? 'Unfavorite' : 'Favorite'}</button>`);
    actions.push(`<button class="del-btn" data-archive-id="${e.id}" data-archive-section="${e.section}" data-archive-state="${!!e.archived}">${e.archived ? 'Unarchive' : 'Archive'}</button>`);
    actions.push(`<button class="del-btn" data-edit-id="${e.id}" data-edit-section="${e.section}" style="color:var(--gold);">Edit entry</button>`);
    actions.push(`<button class="del-btn" data-id="${e.id}" data-section="${e.section}">Delete entry</button>`);
  }

  return `<div class="entry-card${opts.resultStyle?' result':''}" data-exhibit-id="${e.id}" data-exhibit-section="${e.section}" tabindex="0" role="button" aria-label="Open exhibit for ${escapeHtml(e.title)}">
    <div class="meta"><span class="title">${e.favorite ? '★ ' : ''}${highlightText(e.title, hl)}</span><span class="stamp-meta">${fmtDate(e.createdAt)}</span></div>
    <div class="tag-row">${sourceChip}${draftBadge}${archivedBadge}<span class="tag-chip">${escapeHtml(e.lifeStage||'')}</span><span class="tag-chip">${escapeHtml(e.emotion||'')}</span><span class="tag-chip">${escapeHtml(e.audienceLabel||'Just me')}</span>${tagsHtml}</div>
    <div class="qa">${qaHtml}</div>
    ${e.contradiction ? `<div class="contradiction">"${highlightText(e.contradiction, hl)}"</div>` : ''}
    ${e.anchor ? `<div class="anchor"><b>Memory anchor —</b> ${highlightText(e.anchor, hl)}</div>` : ''}
    ${actions.length ? `<div class="draft-actions" style="flex-wrap:wrap;">${actions.join('')}</div>` : ''}
  </div>`;
}

function wireEntryCardActions(container, { onChanged } = {}){
  container.querySelectorAll('[data-exhibit-id]').forEach(card=>{
    const openExhibit = (ev)=>{
      if(ev.target.closest('button')) return;
      const entryId = card.dataset.exhibitId;
      const section = card.dataset.exhibitSection;
      openMemoryExhibit(section, entryId);
    };
    card.addEventListener('click', openExhibit);
    card.addEventListener('keydown', (ev)=>{ if(ev.key==='Enter' || ev.key===' '){ ev.preventDefault(); openExhibit(ev); } });
  });
  container.querySelectorAll('[data-id]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      if(!confirm('Delete this memory? This can\'t be undone.')) return;
      await deleteMemory(currentUser.uid, b.dataset.id);
      await refreshOverview();
      if(openDrawer === b.dataset.section){ resetDrawerPagination(openDrawer); await loadDrawerPage(openDrawer, true); }
      if(onChanged) onChanged();
    });
  });
  container.querySelectorAll('[data-fav-id]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const newState = b.dataset.favState !== 'true';
      await updateMemory(currentUser.uid, b.dataset.favId, { favorite: newState });
      await refreshOverview();
      if(openDrawer === b.dataset.favSection){ resetDrawerPagination(openDrawer); await loadDrawerPage(openDrawer, true); }
      if(onChanged) onChanged();
    });
  });
  container.querySelectorAll('[data-archive-id]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const newState = b.dataset.archiveState !== 'true';
      await updateMemory(currentUser.uid, b.dataset.archiveId, { archived: newState });
      await refreshOverview();
      if(openDrawer === b.dataset.archiveSection){ resetDrawerPagination(openDrawer); await loadDrawerPage(openDrawer, true); }
      if(onChanged) onChanged();
    });
  });
  container.querySelectorAll('[data-publish-id]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      await updateMemory(currentUser.uid, b.dataset.publishId, { status: 'published' });
      await refreshOverview();
      if(openDrawer === b.dataset.publishSection){ resetDrawerPagination(openDrawer); await loadDrawerPage(openDrawer, true); }
      if(onChanged) onChanged();
    });
  });
  container.querySelectorAll('[data-edit-id]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const section = b.dataset.editSection;
      if(openDrawer !== section){ openDrawer = section; buildCabinet(); await renderDrawerContent(section); }
      const entries = await loadSectionEntries(section);
      const entry = entries.find(x=>x.id === b.dataset.editId);
      if(entry) beginEdit(section, entry);
      document.getElementById('locker').scrollIntoView({behavior:'smooth'});
    });
  });
  container.querySelectorAll('[data-jump]').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      const section = chip.dataset.jump;
      openDrawer = section; buildCabinet(); renderDrawerContent(section);
      document.getElementById('locker').scrollIntoView({behavior:'smooth'});
    });
  });
}

// ---------------------------------------------------------------------------
// DRAWERS (CABINET) — now with real pagination + graceful fallback
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

function resetDrawerPagination(key){
  drawerPageState[key] = { lastDoc:null, hasMore:true, loaded:[], usingFallback:false, showArchived:false };
}

/**
 * Loads one page of a drawer's entries via the new paginated query. If the
 * required composite index isn't ready yet (or any other error occurs), this
 * falls back to the original full-fetch so the drawer still works exactly as
 * before — pagination degrades gracefully instead of breaking the app.
 */
async function loadDrawerPage(key, isFirstPage){
  const s = SECTIONS[key];
  if(!drawerPageState[key]) resetDrawerPagination(key);
  const state = drawerPageState[key];

  if(s.shared){
    // Society stays as a single full fetch (public collectionGroup query,
    // unchanged from before) — pagination applies to owner-only drawers.
    if(isFirstPage){ state.loaded = await getPublicMemories('society'); state.hasMore = false; }
    return renderEntries(key, state.loaded, state);
  }
  if(!currentUser) return;

  if(state.usingFallback){
    if(isFirstPage){ state.loaded = await getUserMemoriesBySection(currentUser.uid, key); state.hasMore = false; }
    return renderEntries(key, state.loaded, state);
  }

  try{
    const cursor = isFirstPage ? null : state.lastDoc;
    const page = await getUserMemoriesPage(currentUser.uid, key, PAGE_SIZE, cursor);
    state.loaded = isFirstPage ? page.items : state.loaded.concat(page.items);
    state.lastDoc = page.lastDoc;
    state.hasMore = page.hasMore;
  }catch(err){
    console.warn('Paginated query unavailable (likely missing composite index) — falling back to full fetch for', key, err);
    state.usingFallback = true;
    state.loaded = await getUserMemoriesBySection(currentUser.uid, key);
    state.hasMore = false;
  }
  renderEntries(key, state.loaded, state);
}

async function renderDrawerContent(key){
  const s = SECTIONS[key]; const el = document.getElementById('inner-'+key); if(!el) return;
  el.innerHTML = `<div class="empty-state">Loading…</div>`;
  resetDrawerPagination(key);

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
        ${!s.shared ? `<button type="button" class="btn" id="draftBtn-${key}">Save as draft</button>` : ''}
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
    document.getElementById('entryForm-'+key).addEventListener('submit', (ev)=> onSubmitEntry(ev, key, 'published'));
    const draftBtn = document.getElementById('draftBtn-'+key);
    if(draftBtn) draftBtn.addEventListener('click', ()=> onSubmitEntry(null, key, 'draft'));
  }

  await loadDrawerPage(key, true);
}

function resetForm(key){
  const form = document.getElementById('entryForm-'+key);
  if(!form) return;
  form.reset();
  document.getElementById('submitLabel-'+key).textContent = 'Save to this drawer';
}

function renderEntries(key, entries, state){
  const s = SECTIONS[key]; const list = document.getElementById('entriesList-'+key); if(!list) return;
  const showArchived = state?.showArchived;
  const visible = entries.filter(e => showArchived || !e.archived);
  const archivedCount = entries.filter(e=>e.archived).length;

  const toggleHtml = archivedCount ? `<button class="show-archived-toggle" id="archToggle-${key}">${showArchived ? 'Hide archived' : `Show ${archivedCount} archived`}</button>` : '';
  const loadMoreHtml = state && state.hasMore ? `<div class="load-more-wrap"><button class="btn" id="loadMore-${key}">Load more</button>${state.usingFallback ? '' : '<div class="pagination-note">Paginated — 8 at a time</div>'}</div>` : '';

  if(!visible.length){
    const emptyHtml = emptyStateRichHtml({
      title: 'Nothing filed yet',
      sub: (s.shared||currentUser) ? 'This drawer is waiting for its first memory.' : 'Sign in to start writing here.',
      ctaLabel: (s.shared||currentUser) ? 'Write the first memory' : null,
    });
    list.innerHTML = `${toggleHtml}${emptyHtml}${loadMoreHtml}`;
    wireEmptyStateCta(list, ()=>{
      const form = document.getElementById('entryForm-'+key);
      if(form){ form.classList.add('open'); form.scrollIntoView({behavior:'smooth', block:'center'}); }
    });
  } else {
    const sorted = [...visible].sort((a,b)=> tsValue(b.createdAt) - tsValue(a.createdAt));
    list.innerHTML = `${toggleHtml}${sorted.map(e=> entryCardHtml(e)).join('')}${loadMoreHtml}`;
  }

  wireEntryCardActions(list);
  const archToggle = document.getElementById('archToggle-'+key);
  if(archToggle) archToggle.addEventListener('click', ()=>{ state.showArchived = !state.showArchived; renderEntries(key, entries, state); });
  const loadMoreBtn = document.getElementById('loadMore-'+key);
  if(loadMoreBtn) loadMoreBtn.addEventListener('click', ()=>{ loadMoreBtn.textContent = 'Loading…'; loadDrawerPage(key, false); });
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

async function onSubmitEntry(ev, key, saveStatus){
  if(ev) ev.preventDefault();
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

  const finalStatus = s.shared ? 'published' : saveStatus;
  const statusEl = document.getElementById('formStatus-'+key);
  statusEl.textContent = finalStatus === 'draft' ? 'Saving draft…' : 'Saving…';

  const payload = { title, answers, contradiction, anchor, tags, lifeStage, emotion, favorite, audienceLabel, unlockDate, status: finalStatus };

  try{
    if(editingId[key]){
      await updateMemory(currentUser.uid, editingId[key], payload);
    } else {
      await createMemory(currentUser.uid, key, { ...payload, visibility: s.shared ? 'public' : 'private' });
    }
    statusEl.textContent = finalStatus === 'draft' ? 'Saved as draft.' : 'Saved.';
    showStamp(finalStatus === 'draft' ? 'Saved as draft' : 'Saved to the locker');
  }catch(err){
    console.error(err);
    statusEl.textContent = 'Something went wrong — try again.';
    return;
  }

  editingId[key] = null;
  resetForm(key);
  document.getElementById('entryForm-'+key).classList.remove('open');
  resetDrawerPagination(key);
  await loadDrawerPage(key, true);
  await refreshOverview();
  setTimeout(()=>{ if(statusEl) statusEl.textContent=''; }, 2200);
}

function showStamp(text){
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.createElement('div'); el.className='stamp-fx'; el.textContent = text || 'Saved to the locker';
  document.body.appendChild(el); setTimeout(()=>el.remove(),900);
}

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------

function computeStreaks(dateSet){
  // dateSet: Set of 'YYYY-MM-DD' strings
  if(!dateSet.size) return { current:0, longest:0 };
  const dates = [...dateSet].sort();
  let longest = 1, run = 1;
  for(let i=1;i<dates.length;i++){
    const prev = new Date(dates[i-1]); const cur = new Date(dates[i]);
    const diffDays = Math.round((cur - prev) / 86400000);
    if(diffDays === 1) run++; else run = 1;
    if(run > longest) longest = run;
  }
  // current streak: walk backwards from today (or yesterday, if nothing today)
  const today = new Date(); today.setHours(0,0,0,0);
  let cursor = new Date(today);
  let current = 0;
  const fmt = (d)=> d.toISOString().slice(0,10);
  if(!dateSet.has(fmt(cursor))) cursor.setDate(cursor.getDate()-1); // allow "yesterday" to still count as an active streak
  while(dateSet.has(fmt(cursor))){ current++; cursor.setDate(cursor.getDate()-1); }
  return { current, longest };
}

function animateCount(el, target, dur=1.2){
  gsap.fromTo(el, {innerText:0}, { innerText:target, duration:dur, ease:'power2.out', snap:{innerText:1}, onUpdate(){ el.textContent = Math.round(this.targets()[0].innerText); } });
}

function renderDashboard(){
  const grid = document.getElementById('dashGrid');
  const lists = document.getElementById('dashLists');
  if(!grid) return;
  const all = allEntriesCache;

  const now = new Date();
  const thisMonthCount = all.filter(e=>{ const d = tsDate(e.createdAt); return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth(); }).length;
  const thisYearCount = all.filter(e=>{ const d = tsDate(e.createdAt); return d.getFullYear()===now.getFullYear(); }).length;
  const favCount = all.filter(e=>e.favorite).length;
  const legacyCount = all.filter(e=>e.section==='legacy').length;
  const archivedCount = all.filter(e=>e.archived).length;
  const draftCount = all.filter(e=>e.status==='draft').length;

  const dateSet = new Set(all.map(e=> tsDate(e.createdAt).toISOString().slice(0,10)));
  const { current, longest } = computeStreaks(dateSet);

  const cards = [
    { label:'Total memories', value: all.length },
    { label:'Favorites', value: favCount },
    { label:'Legacy memories', value: legacyCount },
    { label:'Archived', value: archivedCount },
    { label:'Drafts', value: draftCount },
    { label:'This month', value: thisMonthCount },
    { label:'This year', value: thisYearCount },
    { label:'Writing streak (days)', value: current },
    { label:'Longest streak (days)', value: longest },
  ];
  grid.innerHTML = cards.map(c=>`<div class="dash-card"><div class="dash-count" data-target="${c.value}">0</div><div class="dash-label">${c.label}</div></div>`).join('');

  const recentAdded = [...all].sort((a,b)=>tsValue(b.createdAt)-tsValue(a.createdAt)).slice(0,5);
  const recentUpdated = [...all]
    .filter(e=> e.updatedAt && tsValue(e.updatedAt) > tsValue(e.createdAt) + 1000)
    .sort((a,b)=>tsValue(b.updatedAt)-tsValue(a.updatedAt)).slice(0,5);

  const listHtml = (items, emptyMsg, useUpdated)=> items.length
    ? items.map(e=>`<div class="dash-list-item"><span class="dl-title">${escapeHtml(e.title)}</span><span class="dl-meta">${fmtDate(useUpdated ? e.updatedAt : e.createdAt)}</span></div>`).join('')
    : `<div class="empty-state" style="padding:6px 0;">${emptyMsg}</div>`;

  lists.innerHTML = `
    <div class="dash-list-card"><h3>Recently added</h3>${listHtml(recentAdded, 'Nothing filed yet.', false)}</div>
    <div class="dash-list-card"><h3>Recently updated</h3>${listHtml(recentUpdated, 'Nothing edited yet — new entries don\u2019t count as updates.', true)}</div>
  `;
}

// ---------------------------------------------------------------------------
// LIFE IN NUMBERS (Chapter 4 — kept as the narrative summary, unchanged shape)
// ---------------------------------------------------------------------------

function renderNumbers(){
  const all = allEntriesCache.filter(isVisibleForAnalytics);
  const stages = new Set(all.filter(e=>e.lifeStage).map(e=>e.lifeStage));
  document.getElementById('statMemories').dataset.target = all.length;
  document.getElementById('statStages').dataset.target = stages.size;

  const breakdown = document.getElementById('numbersBreakdown');
  if(breakdown){
    breakdown.innerHTML = order.map(k=>{
      const s = SECTIONS[k];
      const count = all.filter(e=>e.section===k).length;
      return `<span class="breakdown-chip"><span class="dot" style="background:${s.hex}"></span>${s.label} · ${count}</span>`;
    }).join('');
  }

  const highlightsEl = document.getElementById('numbersHighlights');
  if(highlightsEl){
    if(!all.length){ highlightsEl.innerHTML = ''; }
    else{
      const emotionCounts = {};
      all.forEach(e=>{ if(e.emotion) emotionCounts[e.emotion] = (emotionCounts[e.emotion]||0)+1; });
      const topEmotion = Object.entries(emotionCounts).sort((a,b)=>b[1]-a[1])[0];
      const favCount = all.filter(e=>e.favorite).length;
      const mostRecent = [...all].sort((a,b)=>tsValue(b.createdAt)-tsValue(a.createdAt))[0];
      highlightsEl.innerHTML = `
        ${topEmotion ? `<span>Most-felt emotion: <b>${escapeHtml(topEmotion[0])}</b></span>` : ''}
        <span>Favorites: <b>${favCount}</b></span>
        ${mostRecent ? `<span>Last written: <b>${fmtDate(mostRecent.createdAt)}</b></span>` : ''}
      `;
    }
  }
}

// ---------------------------------------------------------------------------
// TIMELINE V2 — chronological, sticky year headers, month groups,
// expand/collapse, jump-to-year, lazy/incremental rendering, GSAP reveal
// ---------------------------------------------------------------------------

function initTimelineFilter(){
  const el = document.getElementById('timelineFilter');
  if(!el) return;
  const chips = ['all', ...order].map(k=>{
    const label = k==='all' ? 'All' : SECTIONS[k].label;
    return `<button class="filter-chip ${k===timelineSectionFilter?'active':''}" data-tl-section="${k}">${label}</button>`;
  }).join('');
  el.innerHTML = chips;
  el.querySelectorAll('[data-tl-section]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      timelineSectionFilter = btn.dataset.tlSection;
      el.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
      btn.classList.add('active');
      buildTimelineData();
      renderTimelineIncremental(true);
    });
  });
}

function buildTimelineData(){
  let all = allEntriesCache.filter(isVisibleForAnalytics).filter(e=>!isSealed(e));
  if(timelineSectionFilter !== 'all') all = all.filter(e=>e.section === timelineSectionFilter);

  const withMeta = all.map(e=>{
    const s = SECTIONS[e.section] || {};
    const d = tsDate(e.createdAt);
    return { ...e, sectionLabel:s.label||e.section, hex:s.hex||'#d4af6a', year:d.getFullYear(), month:d.getMonth() };
  }).sort((a,b)=> tsValue(a.createdAt) - tsValue(b.createdAt)); // chronological, oldest first

  const byYear = new Map();
  withMeta.forEach(e=>{
    if(!byYear.has(e.year)) byYear.set(e.year, new Map());
    const monthsMap = byYear.get(e.year);
    if(!monthsMap.has(e.month)) monthsMap.set(e.month, []);
    monthsMap.get(e.month).push(e);
  });

  timelineYearGroups = [...byYear.entries()].sort((a,b)=>a[0]-b[0]).map(([year, monthsMap])=>({
    year,
    count: [...monthsMap.values()].reduce((sum,arr)=>sum+arr.length,0),
    months: [...monthsMap.entries()].sort((a,b)=>a[0]-b[0]).map(([month, items])=>({ month, items })),
  }));

  // Populate jump-to-year select
  const jumpSelect = document.getElementById('jumpToYearSelect');
  if(jumpSelect){
    jumpSelect.innerHTML = `<option value="">Jump to year…</option>` + timelineYearGroups.map(g=>`<option value="${g.year}">${g.year} (${g.count})</option>`).join('');
  }
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function yearBlockHtml(group, collapsed){
  return `<div class="year-block${collapsed?' collapsed':''}" data-year="${group.year}">
    <div class="year-header" data-year-toggle="${group.year}">
      <span class="year-num">${group.year}</span>
      <span class="year-count">${group.count} ${group.count===1?'memory':'memories'} <span class="year-chev">⌄</span></span>
    </div>
    <div class="year-body">
      ${group.months.map(m=>`
        <div class="month-group">
          <div class="month-group-label">${MONTH_NAMES[m.month]}</div>
          <div class="timeline">
            <div class="tl-line"></div>
            ${m.items.map(e=>`
              <div class="tl-node in" style="--dot:${e.hex}">
                <div class="tl-card"><div class="title">${e.favorite?'★ ':''}${escapeHtml(e.title)}</div><div class="sub">${e.sectionLabel} · ${e.emotion||''} · ${fmtDate(e.createdAt)}</div></div>
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>
  </div>`;
}

let timelineObserver = null;

function renderTimelineIncremental(reset){
  const container = document.getElementById('timelineYears');
  if(!container) return;
  if(reset) timelineRenderedYears = 0;

  if(!timelineYearGroups.length){
    container.innerHTML = emptyStateRichHtml({
      title: 'The corridor is empty',
      sub: `No memories filed yet${timelineSectionFilter!=='all' ? ' in this drawer' : ' across any drawer'}.`,
      ctaLabel: 'Open the locker',
    });
    wireEmptyStateCta(container, ()=> document.getElementById('locker').scrollIntoView({behavior:'smooth'}));
    return;
  }
  if(reset) container.innerHTML = '';

  const BATCH = 3; // years per lazy batch — real infinite-scroll-style reveal over the cached dataset
  const nextSlice = timelineYearGroups.slice(timelineRenderedYears, timelineRenderedYears + BATCH);
  nextSlice.forEach((group, i)=>{
    const wrap = document.createElement('div');
    wrap.innerHTML = yearBlockHtml(group, false);
    const node = wrap.firstElementChild;
    node.style.opacity = '0';
    container.appendChild(node);
    gsap.to(node, { opacity:1, y:0, duration:0.6, delay:i*0.08, ease:'power2.out' });
  });
  timelineRenderedYears += nextSlice.length;

  container.querySelectorAll('[data-year-toggle]').forEach(header=>{
    if(header.dataset.bound) return;
    header.dataset.bound = '1';
    header.addEventListener('click', ()=>{
      header.closest('.year-block').classList.toggle('collapsed');
    });
  });

  const sentinel = document.getElementById('timelineSentinel');
  if(sentinel && timelineObserver) timelineObserver.disconnect();
  if(sentinel && timelineRenderedYears < timelineYearGroups.length){
    timelineObserver = new IntersectionObserver((entries)=>{
      if(entries[0].isIntersecting) renderTimelineIncremental(false);
    }, { rootMargin:'400px' });
    timelineObserver.observe(sentinel);
  }
}

function initJumpToYear(){
  const sel = document.getElementById('jumpToYearSelect');
  if(!sel) return;
  sel.addEventListener('change', ()=>{
    const year = sel.value;
    if(!year) return;
    // Ensure enough years are rendered to include the target, then scroll to it.
    const targetIndex = timelineYearGroups.findIndex(g=>String(g.year)===year);
    const revealBatches = ()=>{
      const el = document.querySelector(`.year-block[data-year="${year}"]`);
      if(el){ el.classList.remove('collapsed'); el.scrollIntoView({behavior:'smooth', block:'start'}); }
      else if(timelineRenderedYears < timelineYearGroups.length){ renderTimelineIncremental(false); setTimeout(revealBatches, 120); }
    };
    revealBatches();
  });
}

// ---------------------------------------------------------------------------
// CONSTELLATION — unchanged
// ---------------------------------------------------------------------------

let constNodes = [];
function renderConstellation(){
  const emptyEl = document.getElementById('constEmpty');
  const canvas = document.getElementById('constellation');
  const all = allEntriesCache.filter(isVisibleForAnalytics);
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
  function resize(){ canvas.width = canvas.clientWidth * devicePixelRatio; canvas.height = canvas.clientHeight * devicePixelRatio; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); }
  resize(); window.addEventListener('resize', resize);
  let t=0;
  function draw(){
    t += 0.01;
    const w = canvas.clientWidth, h = canvas.clientHeight;
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
// GLOBAL SEARCH + FILTERS + SORT + SUGGESTIONS + HISTORY
// ---------------------------------------------------------------------------

function getRecentSearches(){ try{ return JSON.parse(localStorage.getItem('lsl-recent-searches')||'[]'); }catch(e){ return []; } }
function addRecentSearch(q){
  if(!q) return;
  let list = getRecentSearches().filter(x=>x!==q);
  list.unshift(q);
  list = list.slice(0,5);
  localStorage.setItem('lsl-recent-searches', JSON.stringify(list));
  renderRecentSearches();
}
function renderRecentSearches(){
  const el = document.getElementById('recentSearches');
  if(!el) return;
  const list = getRecentSearches();
  el.innerHTML = list.length ? `<span class="pagination-note" style="margin:0 4px 0 0;">Recent:</span>` + list.map(q=>`<button class="recent-search-chip" data-recent="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('') : '';
  el.querySelectorAll('[data-recent]').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      document.getElementById('searchInput').value = chip.dataset.recent;
      searchState.query = chip.dataset.recent.toLowerCase();
      renderSearchHub();
      hideSuggestions();
    });
  });
}

function showSuggestions(items){
  const box = document.getElementById('searchSuggestions');
  if(!box) return;
  if(!items.length){ box.classList.remove('open'); box.innerHTML=''; return; }
  box.innerHTML = items.map(it=>`<div class="sugg-item" data-sugg-id="${it.id}" data-sugg-section="${it.section}"><span>${escapeHtml(it.title)}</span><span class="sugg-meta">${escapeHtml(SECTIONS[it.section]?.label || it.section)}</span></div>`).join('');
  box.classList.add('open');
  box.querySelectorAll('[data-sugg-id]').forEach(row=>{
    row.addEventListener('click', ()=>{
      const entry = allEntriesCache.find(e=>e.id===row.dataset.suggId);
      document.getElementById('searchInput').value = entry ? entry.title : '';
      searchState.query = (entry ? entry.title : '').toLowerCase();
      hideSuggestions();
      renderSearchHub();
      addRecentSearch(searchState.query);
    });
  });
}
function hideSuggestions(){ document.getElementById('searchSuggestions')?.classList.remove('open'); }

function initSearchHub(){
  const filterRow = document.getElementById('filterRow');
  if(!filterRow) return;

  const sectionChips = ['all', ...order].map(k=>{
    const label = k==='all' ? 'All drawers' : SECTIONS[k].label;
    return `<button class="filter-chip active" data-filter="section" data-value="${k}">${label}</button>`;
  }).join('');

  filterRow.innerHTML = `
    ${sectionChips}
    <select class="filter-select" id="emotionFilterSelect">
      <option value="all">Any emotion</option>
      ${EMOTIONS.map(e=>`<option value="${e}">${e}</option>`).join('')}
    </select>
    <select class="filter-select" id="stageFilterSelect">
      <option value="all">Any life stage</option>
      ${LIFE_STAGES.map(s=>`<option value="${s}">${s}</option>`).join('')}
    </select>
    <button class="filter-chip" id="favOnlyChip" data-fav-toggle>★ Favorites only</button>
    <button class="filter-chip" id="archOnlyChip">Archived only</button>
  `;

  filterRow.querySelectorAll('[data-filter="section"]').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      filterRow.querySelectorAll('[data-filter="section"]').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active');
      searchState.section = chip.dataset.value;
      renderSearchHub();
    });
  });
  document.getElementById('emotionFilterSelect').addEventListener('change', (e)=>{ searchState.emotion = e.target.value; renderSearchHub(); });
  document.getElementById('stageFilterSelect').addEventListener('change', (e)=>{ searchState.stage = e.target.value; renderSearchHub(); });
  document.getElementById('favOnlyChip').addEventListener('click', (e)=>{
    searchState.favoritesOnly = !searchState.favoritesOnly;
    e.target.classList.toggle('active', searchState.favoritesOnly);
    renderSearchHub();
  });
  document.getElementById('archOnlyChip').addEventListener('click', (e)=>{
    searchState.archivedOnly = !searchState.archivedOnly;
    e.target.classList.toggle('active', searchState.archivedOnly);
    renderSearchHub();
  });

  const input = document.getElementById('searchInput');
  input.addEventListener('input', debounce((e)=>{
    const raw = e.target.value.trim();
    searchState.query = raw.toLowerCase();
    renderSearchHub();
    if(raw.length >= 2){
      const matches = allEntriesCache.filter(en => !isSealed(en) && en.title && en.title.toLowerCase().includes(raw.toLowerCase())).slice(0,5);
      showSuggestions(matches);
    } else hideSuggestions();
  }, 200));
  input.addEventListener('focus', ()=>{ if(!input.value) renderRecentSearches(); });
  input.addEventListener('blur', ()=> setTimeout(hideSuggestions, 150));
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ hideSuggestions(); addRecentSearch(searchState.query); } });

  document.getElementById('sortSelect').addEventListener('change', (e)=>{ searchState.sort = e.target.value; renderSearchHub(); });

  renderRecentSearches();
}

function entryMatchesSearch(e, query){
  if(!query) return true;
  const haystack = [ e.title, ...Object.values(e.answers||{}), e.contradiction, e.anchor, ...(e.tags||[]), e.lifeStage, e.emotion ]
    .filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
}

function sortEntries(list, mode){
  const arr = [...list];
  if(mode === 'newest') arr.sort((a,b)=> tsValue(b.createdAt) - tsValue(a.createdAt));
  else if(mode === 'oldest') arr.sort((a,b)=> tsValue(a.createdAt) - tsValue(b.createdAt));
  else if(mode === 'az') arr.sort((a,b)=> (a.title||'').localeCompare(b.title||''));
  else if(mode === 'stage') arr.sort((a,b)=> LIFE_STAGES.indexOf(a.lifeStage) - LIFE_STAGES.indexOf(b.lifeStage));
  return arr;
}

function clearFilterChipLabel(key){
  return { section:'drawer filter', emotion:'emotion filter', stage:'life stage filter', favoritesOnly:'favorites-only', archivedOnly:'archived-only', query:'search text' }[key];
}

function renderSearchHub(resetBatch = true){
  const resultsEl = document.getElementById('searchResults');
  const countEl = document.getElementById('resultsCount');
  if(!resultsEl) return;

  let results = allEntriesCache.filter(e=>{
    if(isSealed(e)) return false;
    if(searchState.section !== 'all' && e.section !== searchState.section) return false;
    if(searchState.emotion !== 'all' && e.emotion !== searchState.emotion) return false;
    if(searchState.stage !== 'all' && e.lifeStage !== searchState.stage) return false;
    if(searchState.favoritesOnly && !e.favorite) return false;
    if(searchState.archivedOnly && !e.archived) return false;
    if(!searchState.archivedOnly && e.archived) return false; // archived hidden from normal results unless explicitly requested
    if(e.status === 'draft') return false; // drafts stay in their drawer, not in cross-archive search
    if(!entryMatchesSearch(e, searchState.query)) return false;
    return true;
  });

  results = sortEntries(results, searchState.sort);

  countEl.textContent = allEntriesCache.length === 0
    ? 'Nothing to search yet — write a memory first.'
    : `${results.length} of ${allEntriesCache.length} memories`;

  if(!results.length){
    if(searchObserver) searchObserver.disconnect();
    if(!allEntriesCache.length){
      resultsEl.innerHTML = emptyStateRichHtml({
        title: 'Nothing to search yet',
        sub: 'Write your first memory in any drawer, and it\u2019ll show up here.',
        ctaLabel: 'Open the locker',
      });
      wireEmptyStateCta(resultsEl, ()=> document.getElementById('locker').scrollIntoView({behavior:'smooth'}));
      return;
    }
    const activeFilters = Object.entries({ section:searchState.section!=='all', emotion:searchState.emotion!=='all', stage:searchState.stage!=='all', favoritesOnly:searchState.favoritesOnly, archivedOnly:searchState.archivedOnly })
      .filter(([,active])=>active).map(([k])=>k);
    resultsEl.innerHTML = `<div class="no-results-help">
      <div class="empty-state">No matches${searchState.query ? ` for "${escapeHtml(searchState.query)}"` : ''}.</div>
      ${activeFilters.length ? `<div style="margin-top:10px;">${activeFilters.map(k=>`<button class="btn clear-filter-btn" data-clear="${k}">Clear ${clearFilterChipLabel(k)}</button>`).join('')}</div>` : ''}
    </div>`;
    resultsEl.querySelectorAll('[data-clear]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const k = btn.dataset.clear;
        if(k==='section'){ searchState.section='all'; document.querySelector('[data-filter="section"][data-value="all"]')?.classList.add('active'); document.querySelectorAll('[data-filter="section"]').forEach(c=>{ if(c.dataset.value!=='all') c.classList.remove('active'); }); }
        if(k==='emotion'){ searchState.emotion='all'; document.getElementById('emotionFilterSelect').value='all'; }
        if(k==='stage'){ searchState.stage='all'; document.getElementById('stageFilterSelect').value='all'; }
        if(k==='favoritesOnly'){ searchState.favoritesOnly=false; document.getElementById('favOnlyChip').classList.remove('active'); }
        if(k==='archivedOnly'){ searchState.archivedOnly=false; document.getElementById('archOnlyChip').classList.remove('active'); }
        renderSearchHub();
      });
    });
    return;
  }

  // Batched/virtual rendering — only render a window of results at a time,
  // growing as the user scrolls near the bottom, instead of mounting every
  // matching card at once (matters once an archive has hundreds of entries).
  if(resetBatch) searchRenderedCount = SEARCH_BATCH;
  const visibleSlice = results.slice(0, searchRenderedCount);
  const hasMore = results.length > visibleSlice.length;

  resultsEl.innerHTML = visibleSlice.map(e=> entryCardHtml(e, { showSource:true, resultStyle:true, highlightQuery:searchState.query })).join('')
    + (hasMore ? `<div class="search-sentinel" id="searchSentinel"></div>` : '');
  wireEntryCardActions(resultsEl, { onChanged: ()=> renderSearchHub(true) });

  if(searchObserver) searchObserver.disconnect();
  const sentinel = document.getElementById('searchSentinel');
  if(sentinel){
    searchObserver = new IntersectionObserver((entries)=>{
      if(entries[0].isIntersecting){ searchRenderedCount += SEARCH_BATCH; renderSearchHub(false); }
    }, { rootMargin:'300px' });
    searchObserver.observe(sentinel);
  }
}

function goToFavorites(){
  searchState.favoritesOnly = true;
  document.getElementById('favOnlyChip')?.classList.add('active');
  renderSearchHub();
  document.getElementById('searchHubSec')?.scrollIntoView({behavior:'smooth'});
}

// ---------------------------------------------------------------------------
// MEMORY ANALYTICS
// ---------------------------------------------------------------------------

function renderBarChart(containerId, dataMap, orderedKeys, opts = {}){
  const el = document.getElementById(containerId);
  if(!el) return;
  const keys = orderedKeys || Object.keys(dataMap);
  const present = keys.filter(k=>dataMap[k]);
  const max = Math.max(1, ...keys.map(k=>dataMap[k]||0));
  if(!present.length){ el.innerHTML = `<div class="chart-empty">No data yet.</div>`; return; }
  el.innerHTML = present.map(k=>{
    const val = dataMap[k]||0;
    const pct = Math.round((val/max)*100);
    return `<div class="chart-bar-row" title="${escapeHtml(String(k))}: ${val}">
      <div class="chart-bar-label">${escapeHtml(String(k))}</div>
      <div class="chart-bar-track"><div class="chart-bar-fill${opts.clickable?' clickable':''}" style="width:0%; background:var(--gold);" data-width="${pct}" data-key="${escapeHtml(String(k))}"></div></div>
      <div class="chart-bar-count">${val}</div>
    </div>`;
  }).join('');
  requestAnimationFrame(()=>{ el.querySelectorAll('.chart-bar-fill').forEach(bar=>{ bar.style.width = bar.dataset.width + '%'; }); });
  if(opts.onClick){
    el.querySelectorAll('.chart-bar-fill.clickable').forEach(bar=> bar.addEventListener('click', ()=> opts.onClick(bar.dataset.key)));
  }
}

function renderActivityChart(){
  const el = document.getElementById('chartActivity');
  if(!el) return;
  const all = allEntriesCache.filter(isVisibleForAnalytics);
  const now = new Date();
  const months = [];
  for(let i=5;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push({ key:`${d.getFullYear()}-${d.getMonth()}`, label:d.toLocaleDateString('en-US',{month:'short'}), count:0 });
  }
  all.forEach(e=>{ const d = tsDate(e.createdAt); const key = `${d.getFullYear()}-${d.getMonth()}`; const m = months.find(m=>m.key===key); if(m) m.count++; });
  const max = Math.max(1, ...months.map(m=>m.count));
  if(!all.length){ el.innerHTML = `<div class="chart-empty">No data yet.</div>`; return; }
  el.innerHTML = `<div class="activity-chart">${months.map(m=>`
    <div class="activity-bar" title="${m.label}: ${m.count}">
      <div class="count">${m.count||''}</div>
      <div class="bar" style="height:0%;" data-height="${Math.round((m.count/max)*100)}"></div>
      <div class="label">${m.label}</div>
    </div>`).join('')}</div>`;
  requestAnimationFrame(()=>{ el.querySelectorAll('.activity-bar .bar').forEach(bar=>{ bar.style.height = bar.dataset.height + '%'; }); });
}

function renderYearlyChart(){
  const el = document.getElementById('chartYearly');
  if(!el) return;
  const all = allEntriesCache.filter(isVisibleForAnalytics);
  if(!all.length){ el.innerHTML = `<div class="chart-empty">No data yet.</div>`; return; }
  const counts = {};
  all.forEach(e=>{ const y = tsDate(e.createdAt).getFullYear(); counts[y] = (counts[y]||0)+1; });
  const years = Object.keys(counts).sort();
  const max = Math.max(1, ...years.map(y=>counts[y]));
  el.innerHTML = `<div class="activity-chart">${years.map(y=>`
    <div class="activity-bar" title="${y}: ${counts[y]}">
      <div class="count">${counts[y]}</div>
      <div class="bar" style="height:0%;" data-height="${Math.round((counts[y]/max)*100)}"></div>
      <div class="label">${y}</div>
    </div>`).join('')}</div>`;
  requestAnimationFrame(()=>{ el.querySelectorAll('.activity-bar .bar').forEach(bar=>{ bar.style.height = bar.dataset.height + '%'; }); });
}

function renderWeeklyPattern(){
  const el = document.getElementById('chartWeekly');
  if(!el) return;
  const all = allEntriesCache.filter(isVisibleForAnalytics);
  if(!all.length){ el.innerHTML = `<div class="chart-empty">No data yet.</div>`; return; }
  const counts = new Array(7).fill(0);
  all.forEach(e=>{ counts[tsDate(e.createdAt).getDay()]++; });
  const max = Math.max(1, ...counts);
  el.innerHTML = `<div class="weekly-chart">${DAY_NAMES.map((d,i)=>`
    <div class="weekly-bar-col" title="${d}: ${counts[i]}">
      <div class="bar" style="height:0%;" data-height="${Math.round((counts[i]/max)*100)}"></div>
      <div class="label">${d}</div>
    </div>`).join('')}</div>`;
  requestAnimationFrame(()=>{ el.querySelectorAll('.weekly-bar-col .bar').forEach(bar=>{ bar.style.height = bar.dataset.height + '%'; }); });
}

function renderFavoritePct(){
  const el = document.getElementById('chartFavPct');
  if(!el) return;
  const all = allEntriesCache.filter(isVisibleForAnalytics);
  if(!all.length){ el.innerHTML = `<div class="chart-empty">No data yet.</div>`; return; }
  const pct = Math.round((all.filter(e=>e.favorite).length / all.length) * 100);
  el.innerHTML = `<div class="ring-stat">
    <div class="ring-stat-track"><div class="ring-stat-fill" style="width:0%;" data-width="${pct}"></div></div>
    <div class="ring-stat-pct">${pct}%</div>
  </div>`;
  requestAnimationFrame(()=>{ const fill = el.querySelector('.ring-stat-fill'); if(fill) fill.style.width = fill.dataset.width + '%'; });
}

function renderTopTags(){
  const el = document.getElementById('chartTags');
  if(!el) return;
  const all = allEntriesCache.filter(isVisibleForAnalytics);
  const counts = {};
  all.forEach(e=> (e.tags||[]).forEach(t=>{ counts[t] = (counts[t]||0)+1; }));
  const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if(!top.length){ el.innerHTML = `<div class="chart-empty">No tags yet — add some when writing a memory.</div>`; return; }
  const dataMap = {}; top.forEach(([k,v])=>{ dataMap[k]=v; });
  renderBarChart('chartTags', dataMap, top.map(([k])=>k));
}

function renderHeatmap(){
  const el = document.getElementById('chartHeatmap');
  if(!el) return;
  const all = allEntriesCache.filter(isVisibleForAnalytics);
  const days = 84; // 12 weeks
  const counts = {};
  all.forEach(e=>{ const key = tsDate(e.createdAt).toISOString().slice(0,10); counts[key] = (counts[key]||0)+1; });
  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(today); start.setDate(start.getDate() - (days-1));
  // align start to a Sunday so columns represent whole weeks
  start.setDate(start.getDate() - start.getDay());

  const max = Math.max(1, ...Object.values(counts));
  const cells = [];
  const cursor = new Date(start);
  while(cursor <= today){
    const key = cursor.toISOString().slice(0,10);
    const count = counts[key] || 0;
    const intensity = count ? Math.min(1, 0.25 + (count/max)*0.75) : 0;
    cells.push(`<div class="heatmap-cell" style="background:${count ? `rgba(212,175,106,${intensity})` : 'rgba(255,255,255,0.05)'};" title="${key}: ${count} ${count===1?'memory':'memories'}"></div>`);
    cursor.setDate(cursor.getDate()+1);
  }
  if(!all.length){ el.innerHTML = `<div class="chart-empty">No data yet.</div>`; return; }
  el.innerHTML = `<div class="heatmap-wrap"><div class="heatmap-grid">${cells.join('')}</div></div>
    <div class="heatmap-legend">Less <span class="heatmap-cell" style="background:rgba(255,255,255,0.05);"></span><span class="heatmap-cell" style="background:rgba(212,175,106,0.4);"></span><span class="heatmap-cell" style="background:rgba(212,175,106,0.8);"></span><span class="heatmap-cell" style="background:rgba(212,175,106,1);"></span> More</div>`;
}

function renderAnalytics(){
  const all = allEntriesCache.filter(isVisibleForAnalytics);
  const emotionCounts = {}; EMOTIONS.forEach(e=> emotionCounts[e]=0);
  const stageCounts = {}; LIFE_STAGES.forEach(s=> stageCounts[s]=0);
  const drawerCounts = {}; order.forEach(k=> drawerCounts[SECTIONS[k].label]=0);
  all.forEach(e=>{
    if(e.emotion && emotionCounts[e.emotion] !== undefined) emotionCounts[e.emotion]++;
    if(e.lifeStage && stageCounts[e.lifeStage] !== undefined) stageCounts[e.lifeStage]++;
    const label = SECTIONS[e.section]?.label; if(label && drawerCounts[label] !== undefined) drawerCounts[label]++;
  });

  renderBarChart('chartEmotion', emotionCounts, EMOTIONS, { clickable:true, onClick:(k)=>{ searchState.emotion=k; document.getElementById('emotionFilterSelect').value=k; renderSearchHub(); document.getElementById('searchHubSec')?.scrollIntoView({behavior:'smooth'}); } });
  renderBarChart('chartStage', stageCounts, LIFE_STAGES, { clickable:true, onClick:(k)=>{ searchState.stage=k; document.getElementById('stageFilterSelect').value=k; renderSearchHub(); document.getElementById('searchHubSec')?.scrollIntoView({behavior:'smooth'}); } });
  renderBarChart('chartDrawer', drawerCounts, order.map(k=>SECTIONS[k].label));
  renderFavoritePct();
  renderActivityChart();
  renderYearlyChart();
  renderWeeklyPattern();
  renderTopTags();
  renderHeatmap();
}

// ---------------------------------------------------------------------------
// REFRESH
// ---------------------------------------------------------------------------

async function refreshOverview(){
  allEntriesCache = await loadAllEntriesForOverview();
  renderNumbers();
  renderDashboard();
  buildTimelineData();
  renderTimelineIncremental(true);
  renderConstellation();
  renderSearchHub();
  renderAnalytics();
  ScrollTrigger.refresh();
  document.querySelectorAll('.dash-card .dash-count').forEach(el=> animateCount(el, +el.dataset.target || 0));
}

// ---------------------------------------------------------------------------
// AMBIENT CANVASES — unchanged
// ---------------------------------------------------------------------------

function initDust(){
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.getElementById('dust'); const ctx = canvas.getContext('2d');
  function resize(){ canvas.width = canvas.clientWidth*devicePixelRatio; canvas.height = canvas.clientHeight*devicePixelRatio; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); }
  resize(); window.addEventListener('resize', resize);

  // Fewer particles on small screens — same visual language, lighter draw cost.
  const isSmall = window.innerWidth < 700;
  const bgCount = isSmall ? 22 : 44;
  const fgCount = isSmall ? 8 : 16;

  // Background particles: smaller, slower, dimmer, drift mostly straight up.
  const background = Array.from({length:bgCount}, ()=>({
    x:Math.random()*canvas.clientWidth, y:Math.random()*canvas.clientHeight,
    r:Math.random()*1.1+0.25, s:Math.random()*0.22+0.04, o:Math.random()*0.35+0.12,
    tPhase:Math.random()*Math.PI*2, tSpeed:Math.random()*0.006+0.002, tAmp:Math.random()*6+2,
  }));
  // Foreground particles: bigger, faster, brighter, more turbulence — reads
  // as "closer" to the viewer, giving the canvas real depth instead of one flat layer.
  const foreground = Array.from({length:fgCount}, ()=>({
    x:Math.random()*canvas.clientWidth, y:Math.random()*canvas.clientHeight,
    r:Math.random()*1.9+1, s:Math.random()*0.5+0.18, o:Math.random()*0.4+0.35,
    tPhase:Math.random()*Math.PI*2, tSpeed:Math.random()*0.012+0.004, tAmp:Math.random()*14+6,
  }));

  let t = 0;
  function drawLayer(layer){
    layer.forEach(p=>{
      p.y -= p.s;
      p.tPhase += p.tSpeed;
      if(p.y < -6) p.y = canvas.clientHeight + 6;
      const driftX = p.x + Math.sin(p.tPhase) * p.tAmp * 0.08; // gentle horizontal turbulence, never repetitive-looking
      ctx.beginPath(); ctx.arc(driftX, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(212,175,106,${p.o})`; ctx.fill();
    });
  }
  function draw(){
    t += 1;
    ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);
    drawLayer(background);
    drawLayer(foreground);
    requestAnimationFrame(draw);
  }
  draw();
}

function initEmbers(){
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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

// Item 3 — mouse-reactive lighting. Desktop only (checked via hover+pointer
// media query, matching the CSS fallback), respects reduced-motion, and only
// ever touches `transform` via a CSS custom property — no per-frame layout
// or paint work, no background recompute, GPU-composited throughout.
function initCursorBloom(){
  const bloom = document.querySelector('.cursor-bloom');
  if(!bloom) return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if(!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const SCAN_SELECTOR = '.btn, .entry-card, .dash-card, .chart-card, .metaphor-card, .tl-card, .drawer-face, input, select, textarea';
  let pending = false, lastX = window.innerWidth/2, lastY = window.innerHeight/2;
  let idleTimer = null;

  function apply(){
    bloom.style.setProperty('--bloom-x', `${lastX}px`);
    bloom.style.setProperty('--bloom-y', `${lastY}px`);
    pending = false;
  }
  function armIdle(){
    bloom.classList.remove('idle');
    clearTimeout(idleTimer);
    // Item 9 — idle animation: after 4.5s with no cursor movement, hand the
    // bloom over to its own slow autonomous drift instead of sitting frozen.
    idleTimer = setTimeout(()=> bloom.classList.add('idle'), 4500);
  }

  window.addEventListener('mousemove', (e)=>{
    lastX = e.clientX; lastY = e.clientY;
    bloom.classList.add('active');
    armIdle();
    if(!pending){ pending = true; requestAnimationFrame(apply); }
  }, { passive:true });

  // Cursor scanner — localized illumination on interactive elements.
  document.addEventListener('mouseover', (e)=>{
    if(e.target.closest(SCAN_SELECTOR)) bloom.classList.add('scanning');
  }, { passive:true });
  document.addEventListener('mouseout', (e)=>{
    if(e.target.closest(SCAN_SELECTOR) && !e.relatedTarget?.closest?.(SCAN_SELECTOR)) bloom.classList.remove('scanning');
  }, { passive:true });

  armIdle();
}

// ---------------------------------------------------------------------------
// SCROLL STORYTELLING — unchanged, now also covers Dashboard chapter
// automatically via [data-atmos] / .reveal / .mask selectors
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
}

function openMemoryExhibit(section, memoryId){
  const lookupEntries = (window.__exhibitEntries && window.__exhibitEntries.length) ? window.__exhibitEntries : allEntriesCache;
  const entries = lookupEntries.filter(e => e.section === section && e.id === memoryId);
  const entry = entries[0];
  if(!entry) {
    const overlay = document.getElementById('exhibitOverlay');
    if(overlay){
      document.getElementById('exhibitTitle').textContent = 'Memory exhibit';
      document.getElementById('exhibitSummary').textContent = 'The selected memory could not be found yet, but the exhibit view is ready.';
      document.getElementById('exhibitSectionLabel').textContent = 'Archive • exhibit';
      document.getElementById('exhibitMeta').innerHTML = '<span class="tag-chip">Preview</span>';
      document.getElementById('exhibitMetadata').innerHTML = '<div><strong>Drawer:</strong> Archive</div>';
      document.getElementById('exhibitStory').innerHTML = '<p>This preview confirms the exhibit shell is active.</p>';
      document.getElementById('exhibitAnchor').innerHTML = '';
      document.getElementById('exhibitContradiction').innerHTML = '';
      document.getElementById('exhibitAnchorBlock').style.display = 'none';
      document.getElementById('exhibitContradictionBlock').style.display = 'none';
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
    return;
  }

  const s = SECTIONS[section] || {};
  const overlay = document.getElementById('exhibitOverlay');
  if(!overlay) return;

  document.getElementById('exhibitTitle').textContent = entry.title || 'Untitled memory';
  document.getElementById('exhibitSummary').textContent = entry.contradiction ? `A carefully preserved remembrance from ${s.label || section}.` : 'A carefully preserved remembrance awaits.';
  document.getElementById('exhibitSectionLabel').textContent = `${s.label || section} • exhibit`;
  document.getElementById('exhibitBadge').textContent = entry.favorite ? 'Favorite artifact' : 'Museum exhibit';

  const metaWrap = document.getElementById('exhibitMeta');
  const metaItems = [
    `<span class="tag-chip">${escapeHtml(s.label || section)}</span>`,
    `<span class="tag-chip">${escapeHtml(entry.lifeStage || 'Unstaged')}</span>`,
    `<span class="tag-chip">${escapeHtml(entry.emotion || 'Unlabeled')}</span>`,
    `<span class="tag-chip">${escapeHtml(entry.audienceLabel || 'Private')}</span>`
  ];
  if(entry.tags && entry.tags.length) metaItems.push(`<span class="tag-chip">#${escapeHtml(entry.tags[0])}</span>`);
  metaWrap.innerHTML = metaItems.join('');

  const metadataWrap = document.getElementById('exhibitMetadata');
  metadataWrap.innerHTML = `
    <div><strong>Filed:</strong> ${fmtDate(entry.createdAt)}</div>
    <div><strong>Drawer:</strong> ${escapeHtml(s.label || section)}</div>
    <div><strong>Status:</strong> ${escapeHtml(entry.status || 'published')}</div>
    <div><strong>Favorite:</strong> ${entry.favorite ? 'Yes' : 'No'}</div>
  `;

  const storyWrap = document.getElementById('exhibitStory');
  const storyBlocks = Object.entries(entry.answers || {}).filter(([,v])=>v && v.trim()).map(([pk,v])=>{
    const pd = (s.prompts||[]).find(p=>p.key===pk);
    return `<div class="qa"><div class="q">${pd?pd.q:pk}</div><div class="a">${escapeHtml(v)}</div></div>`;
  });
  storyWrap.innerHTML = storyBlocks.length ? storyBlocks.join('') : `<p>There is no story text yet for this memory.</p>`;

  const anchorWrap = document.getElementById('exhibitAnchor');
  const contradictionWrap = document.getElementById('exhibitContradiction');
  document.getElementById('exhibitAnchorBlock').style.display = entry.anchor ? 'block' : 'none';
  document.getElementById('exhibitContradictionBlock').style.display = entry.contradiction ? 'block' : 'none';
  anchorWrap.innerHTML = entry.anchor ? `<p>${escapeHtml(entry.anchor)}</p>` : '';
  contradictionWrap.innerHTML = entry.contradiction ? `<p>${escapeHtml(entry.contradiction)}</p>` : '';

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeMemoryExhibit(){
  const overlay = document.getElementById('exhibitOverlay');
  if(!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  return false;
}

function initMemoryExhibit(){
  const overlay = document.getElementById('exhibitOverlay');
  if(!overlay) return;
  const closeBtn = document.getElementById('exhibitClose');
  const backBtn = document.getElementById('exhibitBackBtn');
  if(closeBtn){
    closeBtn.addEventListener('click', (e)=>{ e.stopPropagation(); closeMemoryExhibit(); });
    closeBtn.onclick = (e)=>{ e.stopPropagation(); closeMemoryExhibit(); };
  }
  if(backBtn){
    backBtn.addEventListener('click', (e)=>{ e.stopPropagation(); closeMemoryExhibit(); });
    backBtn.onclick = (e)=>{ e.stopPropagation(); closeMemoryExhibit(); };
  }
  overlay.addEventListener('click', (e)=>{ if(e.target.id === 'exhibitOverlay') closeMemoryExhibit(); });
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && overlay.classList.contains('open')) closeMemoryExhibit(); });
}

function initMagnetic(){
  document.querySelectorAll('.magnetic').forEach(btn=>{
    if(btn.dataset.magneticBound) return;
    btn.dataset.magneticBound = '1';
    btn.addEventListener('mousemove', (e)=>{
      const r = btn.getBoundingClientRect();
      const x = e.clientX - r.left - r.width/2, y = e.clientY - r.top - r.height/2;
      gsap.to(btn, { x:x*0.25, y:y*0.4, duration:0.3, ease:'power2.out' });
    });
    btn.addEventListener('mouseleave', ()=> gsap.to(btn, { x:0, y:0, duration:0.4, ease:'elastic.out(1,0.4)' }));
  });
}

// Museum-lighting cursor spotlight — one delegated listener covers every
// card that exists now or is rendered later (drawers, dashboard, analytics,
// timeline, search results), so no per-card wiring is needed anywhere else.
function initSpotlight(){
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const SPOTLIGHT_SELECTOR = '.entry-card, .dash-card, .chart-card, .metaphor-card, .tl-card, .drawer-face';
  document.addEventListener('mousemove', (e)=>{
    const card = e.target.closest(SPOTLIGHT_SELECTOR);
    if(!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--sx', `${((e.clientX - r.left) / r.width) * 100}%`);
    card.style.setProperty('--sy', `${((e.clientY - r.top) / r.height) * 100}%`);
  }, { passive:true });
}

// ---------------------------------------------------------------------------
// AUTH UI — unchanged
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
  document.getElementById('favoritesNavBtn')?.addEventListener('click', goToFavorites);
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
// THEME — unchanged
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
// HERO GLOW + VIEW BUTTONS — unchanged
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
initMemoryExhibit();
initTheme();
initSearchHub();
initTimelineFilter();
initJumpToYear();
initSpotlight();
initCursorBloom();

window.openMemoryExhibit = openMemoryExhibit;
window.closeMemoryExhibit = closeMemoryExhibit;

// Expose the overlay for lightweight verification and future integrations.
document.addEventListener('DOMContentLoaded', ()=>{
  const overlay = document.getElementById('exhibitOverlay');
  if(overlay){
    overlay.dataset.ready = 'true';
  }
});

onAuthChange(async (user)=>{
  currentUser = user;
  await initTheme();
  renderAuthArea();
  if(openDrawer) await renderDrawerContent(openDrawer);
  await refreshOverview();
  initScrollStory();
  ScrollTrigger.refresh();
});
