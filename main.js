const PAGE_SIZE = 20;              // 一覧 1 ページあたりの件数
const DATA_FILE = 'CHI2025_intermediate_summaries.json';// 読み込む JSON

// ----------- 状態 ----------------
let papers = [];                // 取得した全論文
let currentPage = 1;
let currentLang = 'en';         // 'en' or 'ja'
let currentView = 'all';        // 'all' | 'bookmarks' | 'tags'
let currentTag  = null;         // tags view 時の選択タグ
let searchKeywords = [];        // AND 検索キーワード（小文字化済み）

// ----------- 永続データ (localStorage) -------------
const store = {
  keyBookmarks:    'rpv_bookmarks',
  keyNotes:        'rpv_notes',
  keyTags:         'rpv_tags',
  keyCheckpointID: 'rpv_checkpoint',

  load (k, def){
    try{ return JSON.parse(localStorage.getItem(k)) ?? def; }
    catch(e){ return def; }
  },
  save (k, v){ localStorage.setItem(k, JSON.stringify(v)); }
};

// ----------- DOM 要素 ----------------
const $content         = document.getElementById('content');
const $paginationTop   = document.getElementById('pagination-top');
const $paginationBottom= document.getElementById('pagination');
const $langEnBtn       = document.getElementById('lang-en');
const $langJaBtn       = document.getElementById('lang-ja');
const $btnAll          = document.getElementById('view-all');
const $btnBM           = document.getElementById('view-bookmarks');
const $btnTags         = document.getElementById('view-tags');
const $btnJump         = document.getElementById('jump-checkpoint');
const $searchInput     = document.getElementById('search-input');
const $searchBtn       = document.getElementById('search-btn');

// ----------- イベント登録 ----------------
window.addEventListener('DOMContentLoaded', init);
$langEnBtn.addEventListener('click', () => setLanguage('en'));
$langJaBtn.addEventListener('click', () => setLanguage('ja'));
$btnAll .addEventListener('click', () => setView('all'));
$btnBM  .addEventListener('click', () => setView('bookmarks'));
$btnTags.addEventListener('click', () => setView('tags'));
$btnJump.addEventListener('click', jumpToCheckpoint);
$searchBtn.addEventListener('click', applySearch);
$searchInput.addEventListener('keydown', e => { if(e.key==='Enter') applySearch(); });

// ----------- 初期化 ----------------
async function init(){
  try{
    const res = await fetch(DATA_FILE);
    papers = await res.json();
  }catch(e){
    $content.textContent = 'Failed to load ' + DATA_FILE;
    console.error(e);
    return;
  }

  /* ① ========= 事前に全文検索用文字列を生成 ========= */
  papers.forEach(p=>{
    p.search_en = [
      p.title, p.authors, p.journal,
      p.summary_english||'', p.problem_english||'',
      p.method_english||'',  p.results_english||''
    ].join(' ').toLowerCase();

    p.search_ja = [
      p.title, p.authors, p.journal,
      p.summary_japanese||'', p.problem_japanese||'',
      p.method_japanese||'',  p.results_japanese||''
    ].join(' ').toLowerCase();
  });
  /* ================================================ */

  setLanguage(currentLang); // 初期レンダリング
}

/* ===================== 言語切替 ===================== */
function setLanguage(lang){
  currentLang = lang;
  $langEnBtn.classList.toggle('lang-active', lang==='en');
  $langJaBtn.classList.toggle('lang-active', lang==='ja');
  render();
}

/* ===================== キーワード検索適用 ===================== */
function applySearch(){
  const raw = $searchInput.value.trim().toLowerCase();
  searchKeywords = raw ? raw.split(/\s+/) : [];
  currentPage = 1;
  render();
}

/* ===================== 画面レンダリング ===================== */
function setView(v, tag=null){
  currentView = v; currentTag = tag; currentPage = 1;
  [$btnAll,$btnBM,$btnTags].forEach(b=>b.classList.remove('active'));
  if(v==='all')       $btnAll.classList.add('active');
  else if(v==='bookmarks') $btnBM.classList.add('active');
  else if(v==='tags')      $btnTags.classList.add('active');
  render();
}

function render(){
  let list = [...papers]; // ← All Papers ビューでは **全件** が初期対象

  /* ビュー別フィルタ */
  if(currentView==='bookmarks'){
    const bm = store.load(store.keyBookmarks, []);
    list = list.filter(p=>bm.includes(p.id));
  }else if(currentView==='tags' && currentTag){
    const tags = store.load(store.keyTags, {});
    list = list.filter(p=>(tags[p.id]??[]).includes(currentTag));
  }

  /* ② ========= 検索フィルタ（高速化版） ========= */
  if(searchKeywords.length){
    const field = currentLang==='en' ? 'search_en' : 'search_ja';
    list = list.filter(paper =>
      searchKeywords.every(kw => paper[field].includes(kw))
    );
  }
  /* ============================================ */

  const totalPages = Math.max(1, Math.ceil(list.length/PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const slice = list.slice((currentPage-1)*PAGE_SIZE, currentPage*PAGE_SIZE);

  $content.innerHTML = '';
  if(currentView==='tags' && !currentTag){
    renderTagListView();
  } else {
    slice.forEach(paper=> $content.appendChild(createCard(paper)));
  }

  renderPagination(totalPages, $paginationTop);
  renderPagination(totalPages, $paginationBottom);
}

/* ---------------- ページネーション描画 ---------------- */
function renderPagination(total, container){
  container.innerHTML='';

  /* Prev */
  const prev = document.createElement('button');
  prev.textContent='Prev';
  prev.disabled = currentPage===1;
  prev.onclick  = ()=>{currentPage--;render();};
  container.appendChild(prev);

  /* ページ番号入力 */
  const input = document.createElement('input');
  input.type='number';
  input.min = 1; input.max = total;
  input.value = currentPage;
  input.onkeydown = e=>{
    if(e.key==='Enter') jumpToPage(Number(input.value), total);
  };
  input.onblur = ()=> jumpToPage(Number(input.value), total);
  container.appendChild(input);

  /* `/ total` 表示 */
  const info = document.createElement('span');
  info.textContent = ` / ${total}`;
  container.appendChild(info);

  /* Next */
  const next = document.createElement('button');
  next.textContent='Next';
  next.disabled = currentPage===total;
  next.onclick  = ()=>{currentPage++;render();};
  container.appendChild(next);
}

/* ページジャンプ（不正値ガード） */
function jumpToPage(page, total){
  if(Number.isNaN(page)) return;
  page = Math.max(1, Math.min(total, page));
  if(page !== currentPage){ currentPage = page; render(); }
}

/* ------------------ 個別カード生成 ------------------ */
function createCard(p){
  const notes = store.load(store.keyNotes,{});
  const tags  = store.load(store.keyTags ,{});
  const bm    = store.load(store.keyBookmarks,[]);
  const checkpointID = store.load(store.keyCheckpointID,null);
  const isBM  = bm.includes(p.id);
  const isCP  = checkpointID === p.id;

  const c = document.createElement('article');
  c.className='paper-card'; c.id = `paper-${p.id}`;

  const h2 = document.createElement('h2');
  h2.textContent = p.title;
  c.appendChild(h2);

  const meta = document.createElement('div');
  meta.className='paper-meta';
  meta.textContent = `${p.authors} (${p.year}) – ${p.journal}`;
  c.appendChild(meta);

  const link = document.createElement('a');
  link.href = p.url; link.target='_blank'; link.textContent='DOI Link';
  link.style.display='inline-block'; link.style.marginBottom='.6rem';
  c.appendChild(link);

  addSection(c, 'Summary', p[`summary_${langKey()}`]);
  addSection(c, 'Problem', p[`problem_${langKey()}`]);
  addSection(c, 'Method',  p[`method_${langKey()}`]);
  addSection(c, 'Results', p[`results_${langKey()}`]);

  /* ----- 操作ボタン群 ----- */
  const ctrl = document.createElement('div'); ctrl.className='controls';

  const bmBtn = mkBtn(isBM?'★ Bookmarked':'☆ Bookmark', ()=>toggleBookmark(p.id));
  if(isBM) bmBtn.classList.add('active');
  ctrl.appendChild(bmBtn);

  const noteBtn = mkBtn('Edit Note', ()=>toggleNoteArea());
  ctrl.appendChild(noteBtn);

  const tagBtn  = mkBtn('Add Tag', ()=>toggleTagInput());
  ctrl.appendChild(tagBtn);

  const cpBtn   = mkBtn('Checkpoint', ()=>setCheckpoint(p.id));
  if(isCP) cpBtn.classList.add('checkpoint-active');
  ctrl.appendChild(cpBtn);

  c.appendChild(ctrl);

  /* ----- メモ入力 ----- */
  const noteArea = document.createElement('textarea');
  noteArea.className='note-input';
  noteArea.placeholder='Write your notes here…';
  noteArea.value = notes[p.id]??'';
  noteArea.style.display='none';
  noteArea.oninput = ()=>saveNote(p.id, noteArea.value);
  c.appendChild(noteArea);

  /* ----- メモ表示 ----- */
  const noteDisplay = document.createElement('div');
  noteDisplay.className='note-display';
  if(notes[p.id]) noteDisplay.textContent = notes[p.id]; else noteDisplay.style.display='none';
  c.appendChild(noteDisplay);

  /* ----- タグ表示 & 追加入力 ----- */
  const tagWrap = document.createElement('div'); tagWrap.style.marginTop='.5rem';
  const tagList = document.createElement('div'); tagWrap.appendChild(tagList);

  const tagInput = document.createElement('input');
  tagInput.type='text'; tagInput.className='tag-input';
  tagInput.placeholder='new tag…'; tagInput.style.display='none';
  tagInput.onkeydown = (e)=>{
    if(e.key==='Enter' && tagInput.value.trim()){
      addTag(p.id, tagInput.value.trim()); tagInput.value=''; render();
    }
  };
  tagWrap.appendChild(tagInput);

  updateTagList();
  c.appendChild(tagWrap);

  /* ----- 内部関数 ----- */
  function langKey(){ return currentLang==='en'?'english':'japanese';}
  function mkBtn(txt,fn){ const b=document.createElement('button');b.textContent=txt;b.onclick=fn;return b;}

  function toggleNoteArea(){ noteArea.style.display = noteArea.style.display==='none'?'block':'none';}
  function toggleTagInput(){ tagInput.style.display = tagInput.style.display==='none'?'inline-block':'none';}

  function updateTagList(){
    tagList.innerHTML='';
    (tags[p.id]??[]).forEach(t=>{
      const span=document.createElement('span'); span.className='tag'; span.textContent=t;
      span.onclick = ()=>setView('tags',t);
      // 削除ボタン
      const del=document.createElement('button'); del.textContent='×'; del.className='tag-del';
      del.onclick = (e)=>{ e.stopPropagation(); removeTag(p.id,t); };
      span.appendChild(del);
      tagList.appendChild(span);
    });
  }

  // メモ表示エリア更新
  noteArea.addEventListener('input', ()=>{
    if(noteArea.value.trim()){
      noteDisplay.style.display='block'; noteDisplay.textContent = noteArea.value;
    }else{
      noteDisplay.style.display='none'; noteDisplay.textContent='';
    }
  });

  return c;
}

/* ===================== 操作ロジック ===================== */
function toggleBookmark(id){
  let bm = store.load(store.keyBookmarks,[]);
  const idx = bm.indexOf(id);
  if(idx>=0) bm.splice(idx,1); else bm.push(id);
  store.save(store.keyBookmarks,bm); render();
}

function saveNote(id, text){
  const notes = store.load(store.keyNotes,{});
  if(text.trim()) notes[id]=text; else delete notes[id];
  store.save(store.keyNotes,notes);
}

function addTag(id, tag){
  const tags = store.load(store.keyTags,{});
  tags[id] = Array.from(new Set([...(tags[id]??[]), tag]));
  store.save(store.keyTags,tags);
}

function removeTag(id, tag){
  const tags = store.load(store.keyTags,{});
  if(tags[id]) tags[id] = tags[id].filter(t=>t!==tag);
  store.save(store.keyTags,tags); render();
}

function renderTagListView(){
  $content.innerHTML='';
  const tags = store.load(store.keyTags,{});
  const all = new Set(Object.values(tags).flat());
  if(all.size===0){ $content.textContent='No tags yet.'; return; }
  const wrap=document.createElement('div'); wrap.className='controls';
  all.forEach(t=>{
    const b=document.createElement('button');
    b.textContent=`${t} (${countTag(t)})`;
    b.onclick=()=>setView('tags',t);
    wrap.appendChild(b);
  });
  $content.appendChild(wrap);

  function countTag(tag){
    return Object.values(tags).filter(arr=>arr.includes(tag)).length;
  }
}

function setCheckpoint(id){
  store.save(store.keyCheckpointID, id);
  render();
  alert('Checkpoint saved!');
}

/* ---------- ★ jumpToCheckpoint ---------- */
function jumpToCheckpoint(){
  const id = store.load(store.keyCheckpointID,null);
  if(!id){ alert('No checkpoint set.'); return; }

  /* 全論文リスト上で対象インデックスとページを確定 */
  const idx = papers.findIndex(p=>p.id===id);
  if(idx<0){ alert('Checkpoint paper not found.'); return; }
  const targetPage = Math.floor(idx / PAGE_SIZE) + 1;

  /* ===== ビューを All Papers に強制切替え ===== */
  currentView = 'all';
  currentTag  = null;
  currentPage = targetPage;

  // ビュー切替ボタンの見た目も更新
  [$btnAll,$btnBM,$btnTags].forEach(b=>b.classList.remove('active'));
  $btnAll.classList.add('active');

  // 再描画
  render();

  /* 描画反映後にスクロール */
  setTimeout(()=>{
    const el = document.getElementById(`paper-${id}`);
    if(el){
      window.scrollTo({top: el.getBoundingClientRect().top + window.scrollY - 20, behavior:'smooth'});
    }
  }, 100);
}

/* ------------------ ユーティリティ ------------------ */
function addSection(parent,title,text){
  if(!text) return;
  const s = document.createElement('div'); s.className='paper-section';
  const tt = document.createElement('span'); tt.className='paper-section-title'; tt.textContent=title+':';
  const body = document.createElement('span'); body.textContent=' '+text;
  s.append(tt,body); parent.appendChild(s);
}