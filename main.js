/**************************************************************
 * Research Papers Viewer – 全機能クライアントサイド実装
 * Author: ChatGPT (o3)
 * ************************************************************/

// ----------- 設定 ----------------
const PAGE_SIZE = 20;              // 一覧 1 ページあたりの件数
const DATA_FILE = 'CHI2025_intermediate_summaries.json';// ★ここを任意のファイル名に変更★

/*  以下のコードは前回提示した内容と同一です。
    （動作に必要なロジックをそのまま保持しています） */
// ----------- 状態 ----------------
let papers = [];                // 取得した全論文
let currentPage = 1;
let currentLang = 'en';         // 'en' or 'ja'
let currentView = 'all';        // 'all' | 'bookmarks' | 'tags'
let currentTag  = null;         // tags view 時の選択タグ

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
const $content   = document.getElementById('content');
const $pagination= document.getElementById('pagination');
const $langBtn   = document.getElementById('lang-toggle');
const $btnAll    = document.getElementById('view-all');
const $btnBM     = document.getElementById('view-bookmarks');
const $btnTags   = document.getElementById('view-tags');
const $btnJump   = document.getElementById('jump-checkpoint');

// ----------- イベント登録 ----------------
window.addEventListener('DOMContentLoaded', init);
$langBtn.addEventListener('click', () => {
  currentLang = currentLang === 'en' ? 'ja' : 'en';
  $langBtn.textContent = currentLang === 'en' ? '日本語' : 'English';
  render();
});
$btnAll.addEventListener('click', () => setView('all'));
$btnBM .addEventListener('click', () => setView('bookmarks'));
$btnTags.addEventListener('click', () => setView('tags'));
$btnJump.addEventListener('click', jumpToCheckpoint);

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
  render();
}

/* ===================== 画面レンダリング ===================== */
function setView(v, tag=null){
  currentView = v;
  currentTag  = tag;
  currentPage = 1;
  for(const b of [$btnAll,$btnBM,$btnTags]) b.classList.remove('active');
  if(v==='all')       $btnAll.classList.add('active');
  else if(v==='bookmarks') $btnBM .classList.add('active');
  else if(v==='tags')      $btnTags.classList.add('active');
  render();
}

function render(){
  let list = [...papers];

  // ビュー別フィルタ
  if(currentView==='bookmarks'){
    const bm = store.load(store.keyBookmarks, []);
    list = list.filter(p=>bm.includes(p.id));
  }else if(currentView==='tags' && currentTag){
    const tags = store.load(store.keyTags, {});
    list = list.filter(p=>(tags[p.id]??[]).includes(currentTag));
  }

  const totalPages = Math.max(1, Math.ceil(list.length/PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const slice = list.slice((currentPage-1)*PAGE_SIZE, currentPage*PAGE_SIZE);

  // 本文
  $content.innerHTML = '';
  if(currentView==='tags' && !currentTag){
    renderTagListView(); return;
  }
  slice.forEach(paper=> $content.appendChild(createCard(paper)));

  // ページネーション
  renderPagination(totalPages);
}

function renderPagination(total){
  $pagination.innerHTML='';
  const prev = document.createElement('button');
  prev.textContent='Prev';
  prev.disabled = currentPage===1;
  prev.onclick  = ()=>{currentPage--;render();};
  const next = document.createElement('button');
  next.textContent='Next';
  next.disabled = currentPage===total;
  next.onclick  = ()=>{currentPage++;render();};
  const info = document.createElement('span');
  info.textContent=`${currentPage} / ${total}`;
  $pagination.append(prev,info,next);
}

/* ------------------ 個別カード生成 ------------------ */
function createCard(p){
  const notes = store.load(store.keyNotes,{});
  const tags  = store.load(store.keyTags ,{});
  const bm    = store.load(store.keyBookmarks,[]);
  const isBM  = bm.includes(p.id);

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

  addSection(c, 'Summary',      p[`summary_${langKey()}`]);
  addSection(c, 'Problem',      p[`problem_${langKey()}`]);
  addSection(c, 'Method',       p[`method_${langKey()}`]);
  addSection(c, 'Results',      p[`results_${langKey()}`]);

  /* ----- 操作ボタン群 ----- */
  const ctrl = document.createElement('div'); ctrl.className='controls';

  const bmBtn = mkBtn(isBM?'★ Bookmarked':'☆ Bookmark', ()=>toggleBookmark(p.id));
  if(isBM) bmBtn.classList.add('active');
  ctrl.appendChild(bmBtn);

  const noteBtn = mkBtn('Notes', ()=>toggleNoteArea());
  ctrl.appendChild(noteBtn);

  const tagBtn = mkBtn('Add Tag', ()=>toggleTagInput());
  ctrl.appendChild(tagBtn);

  const cpBtn = mkBtn('Mark to Here', ()=>setCheckpoint(p.id));
  ctrl.appendChild(cpBtn);

  c.appendChild(ctrl);

  /* ----- メモ ----- */
  const noteArea = document.createElement('textarea');
  noteArea.className='note-input';
  noteArea.placeholder='Write your notes here…';
  noteArea.value = notes[p.id]??'';
  noteArea.style.display='none';
  noteArea.oninput = ()=>saveNote(p.id, noteArea.value);
  c.appendChild(noteArea);

  /* ----- タグ表示 & 追加入力 ----- */
  const tagWrap = document.createElement('div');
  tagWrap.style.marginTop='.5rem';

  const tagList = document.createElement('div');
  tagWrap.appendChild(tagList);

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
      const s=document.createElement('span');s.className='tag';s.textContent=t;s.onclick=()=>setView('tags',t);
      tagList.appendChild(s);
    });
  }

  return c;
}

/* ===================== 操作ロジック ===================== */
function toggleBookmark(id){
  let bm = store.load(store.keyBookmarks,[]);
  const idx = bm.indexOf(id);
  if(idx>=0) bm.splice(idx,1); else bm.push(id);
  store.save(store.keyBookmarks,bm);
  render();
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

function renderTagListView(){
  $content.innerHTML='';
  const tags = store.load(store.keyTags,{});
  const all = new Set(Object.values(tags).flat());
  if(all.size===0){
    $content.textContent='No tags yet.';
    return;
  }
  const wrap=document.createElement('div');
  wrap.className='controls';
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
  alert('Checkpoint saved!');
}

function jumpToCheckpoint(){
  const id = store.load(store.keyCheckpointID,null);
  if(!id){
    alert('No checkpoint set.'); return;
  }
  const el = document.getElementById(`paper-${id}`);
  if(el){
    window.scrollTo({top: el.getBoundingClientRect().top + window.scrollY - 20, behavior:'smooth'});
  }else{
    // 別ページにある場合はそのページを探す
    const idx = papers.findIndex(p=>p.id===id);
    if(idx<0){alert('Checkpoint paper not found.');return;}
    currentPage = Math.floor(idx / PAGE_SIZE) + 1;
    render();
    setTimeout(jumpToCheckpoint,200); // 再帰呼び出しでスクロール
  }
}

/* ------------------ ユーティリティ ------------------ */
function addSection(parent,title,text){
  if(!text) return;
  const s = document.createElement('div'); s.className='paper-section';
  const tt = document.createElement('span'); tt.className='paper-section-title'; tt.textContent=title+':';
  const body = document.createElement('span'); body.textContent=' '+text;
  s.append(tt,body); parent.appendChild(s);
}