// main.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAnalytics, setUserId } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-analytics.js";

/* ===== 設定 ===== */
const PAGE_SIZE = 20;
const DATA_FILE = 'CHI2025_intermediate_summaries.json';

/* ===== Firebase 初期化 ===== */
const firebaseConfig = {
  apiKey: "AIzaSyAJitOyeUsXrJ0Y9WmjLzFILpw808verL0",
  authDomain: "serendipitywall.firebaseapp.com",
  projectId: "serendipitywall",
  storageBucket: "serendipitywall.appspot.com",          // ← 修正
  messagingSenderId: "1045879297647",
  appId: "1:1045879297647:web:dd5f83773b3dc796ca9f9a",
  measurementId: "G-LC3BG63D92"
};
const app       = initializeApp(firebaseConfig);
const auth      = getAuth(app);
const db        = getFirestore(app);
const analytics = getAnalytics(app);

/* ===== 状態 & localStorage ===== */
let papers = [], currentPage = 1, currentLang = 'en';
let currentView = 'all', currentTag = null, searchKeywords = [];

const store = {
  keyBookmarks:    'rpv_bookmarks',
  keyNotes:        'rpv_notes',
  keyTags:         'rpv_tags',
  keyCheckpointID: 'rpv_checkpoint',
  load(k,d){ try{ return JSON.parse(localStorage.getItem(k)) ?? d; }catch{ return d; } },
  save(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
};

/* ===== DOM ===== */
const $content          = document.getElementById('content');
const $paginationTop    = document.getElementById('pagination-top');
const $paginationBottom = document.getElementById('pagination');
const $langEnBtn        = document.getElementById('lang-en');
const $langJaBtn        = document.getElementById('lang-ja');
const $btnAll           = document.getElementById('view-all');
const $btnBM            = document.getElementById('view-bookmarks');
const $btnTags          = document.getElementById('view-tags');
const $btnJump          = document.getElementById('jump-checkpoint');
const $searchInput      = document.getElementById('search-input');
const $searchBtn        = document.getElementById('search-btn');
const $loginBtn         = document.getElementById('login-btn');
const $logoutBtn        = document.getElementById('logout-btn');

/* ===== イベント ===== */
window.addEventListener('DOMContentLoaded', init);
$langEnBtn.addEventListener('click', () => setLanguage('en'));
$langJaBtn.addEventListener('click', () => setLanguage('ja'));
$btnAll .addEventListener('click', () => setView('all'));
$btnBM  .addEventListener('click', () => setView('bookmarks'));
$btnTags.addEventListener('click', () => setView('tags'));
$btnJump.addEventListener('click', jumpToCheckpoint);
$searchBtn.addEventListener('click', applySearch);
$searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') applySearch(); });
$loginBtn .addEventListener('click', () => signInWithPopup(auth, new GoogleAuthProvider()));
$logoutBtn.addEventListener('click', () => signOut(auth));

/* ===== 初期化 ===== */
async function init(){
  try{
    const res = await fetch(DATA_FILE);
    papers = await res.json();
  }catch(e){
    $content.textContent = 'Failed to load ' + DATA_FILE;
    console.error(e); return;
  }
  papers.forEach(p=>{
    p.search_en = [
      p.title,p.authors,p.journal,p.summary_english,p.problem_english,
      p.method_english,p.results_english
    ].join(' ').toLowerCase();
    p.search_ja = [
      p.title,p.authors,p.journal,p.summary_japanese,p.problem_japanese,
      p.method_japanese,p.results_japanese
    ].join(' ').toLowerCase();
  });

  onAuthStateChanged(auth, user=>{
    if(user){
      $loginBtn.style.display='none';
      $logoutBtn.style.display='inline-block';
      setUserId(analytics, user.uid);
      syncFromCloud(user.uid);
      subscribeCloud(user.uid);
    }else{
      $loginBtn.style.display='inline-block';
      $logoutBtn.style.display='none';
      setUserId(analytics, null);
    }
  });
  setLanguage(currentLang);
}

// ----------- 言語切替 ----------------
function setLanguage(lang){
  currentLang = lang;
  $langEnBtn.classList.toggle('lang-active', lang === 'en');
  $langJaBtn.classList.toggle('lang-active', lang === 'ja');
  render();
}

// ----------- 検索適用 ----------------
function applySearch(){
  const raw = $searchInput.value.trim().toLowerCase();
  searchKeywords = raw ? raw.split(/\s+/) : [];
  currentPage = 1;
  render();
}

// ----------- ビュー切替 ----------------
function setView(v, tag = null){
  currentView = v; currentTag = tag; currentPage = 1;
  [$btnAll, $btnBM, $btnTags].forEach(b => b.classList.remove('active'));
  if (v === 'all')         $btnAll.classList.add('active');
  else if (v === 'bookmarks') $btnBM.classList.add('active');
  else if (v === 'tags')      $btnTags.classList.add('active');
  render();
}

// ----------- マージ用ユーティリティ関数 ------------
function mergeBookmarks(local, remote) {
  return Array.from(new Set([...(local||[]), ...(remote||[])]));
}
function mergeNotes(local = {}, remote = {}) {
    const result = {};
    const allIDs = new Set([...Object.keys(local), ...Object.keys(remote)]);
    allIDs.forEach(id => {
      const l = local[id];
      const r = remote[id];
      if (l != null && r != null) {
        if (l === r) {
          // ローカルとクラウドが同じ内容ならそのまま
          result[id] = l;
        } else {
          // 違うなら両方残す
          result[id] = `クラウド：${r}\n\nブラウザ：${l}`;
        }
      } else {
        // 片方しかなければそのまま
        result[id] = l != null ? l : r;
      }
    });
    return result;
  }
function mergeTags(local, remote) {
  const allKeys = new Set([...Object.keys(local||{}), ...Object.keys(remote||{})]);
  const merged = {};
  allKeys.forEach(id => {
    const a = remote[id] || [];
    const b = local[id]  || [];
    merged[id] = Array.from(new Set([...a, ...b]));
  });
  return merged;
}

// ----------- クラウド → ローカル同期 (初回) ----------
async function syncFromCloud(uid){
  const docRef = doc(collection(db, 'user_states'), uid);
  const snap   = await getDoc(docRef);
  if (snap.exists()) {
    const r  = snap.data();
    const lB = store.load(store.keyBookmarks, []);
    const lN = store.load(store.keyNotes, {});
    const lT = store.load(store.keyTags, {});
    const lC = store.load(store.keyCheckpointID, null);
    const mB = mergeBookmarks(lB, r.bookmarks);
    const mN = mergeNotes(lN, r.notes);
    const mT = mergeTags(lT, r.tags);
    const mC = lC || r.checkpoint || null;
    store.save(store.keyBookmarks,    mB);
    store.save(store.keyNotes,        mN);
    store.save(store.keyTags,         mT);
    store.save(store.keyCheckpointID, mC);
    render();
    await saveStateToCloud(uid);
  } else {
    await saveStateToCloud(uid);
  }
}

// ----------- リアルタイム同期 ----------------
function subscribeCloud(uid){
    const ref = doc(collection(db,'user_states'),uid);
    onSnapshot(ref, snap=>{
      if(!snap.exists()) return;
      const d = snap.data();
      store.save(store.keyBookmarks,    d.bookmarks    || []);
      store.save(store.keyNotes,        d.notes        || {});
      store.save(store.keyTags,         d.tags         || {});
      store.save(store.keyCheckpointID, d.checkpoint   || null);
      render();
    });
}

// ----------- ローカル → クラウド同期 -------------
async function saveStateToCloud(uid){
  const docRef = doc(collection(db, 'user_states'), uid);
  const data = {
    bookmarks:  store.load(store.keyBookmarks, []),
    notes:      store.load(store.keyNotes, {}),
    tags:       store.load(store.keyTags, {}),
    checkpoint: store.load(store.keyCheckpointID, null)
  };
  await setDoc(docRef, data);
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
  noteArea.className = 'note-input';
  noteArea.placeholder = 'Write your notes here…';
  noteArea.value = notes[p.id] ?? '';
  noteArea.style.display = 'none';
  
  // input イベントリスナー：ローカル表示の更新のみ行う
  noteArea.addEventListener('input', e => {
      const text = e.target.value;
      // noteDisplay をリアルタイム更新
      if (text.trim()) {
          noteDisplay.style.display = 'block';
          noteDisplay.textContent = text;
      } else {
          noteDisplay.style.display = 'none';
      }
      // ここでは saveNote を呼び出さない！
  });
  
  // blur イベントリスナー：フォーカスが外れたら保存・同期
  noteArea.addEventListener('blur', e => {
      const text = e.target.value;
      // ローカル＆クラウドに保存
      saveNote(p.id, text);
  });
  
  c.appendChild(noteArea);
  
  /* ----- メモ表示 ----- */
  const noteDisplay = document.createElement('div');
  noteDisplay.className = 'note-display';
  if (notes[p.id]) noteDisplay.textContent = notes[p.id]; else noteDisplay.style.display = 'none';
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

function pushCloud(){
    const user = auth.currentUser;
    if (user) saveStateToCloud(user.uid);
  }
  
  /* --- ブックマーク切替 --- */
  function toggleBookmark(id){
    const bm = store.load(store.keyBookmarks, []);
    const idx = bm.indexOf(id);
    if (idx >= 0) bm.splice(idx,1); else bm.push(id);
    store.save(store.keyBookmarks, bm);
    render();
    pushCloud();
  }
  
  /* --- メモ保存 --- */

  function saveNote(id, text){
    const notes = store.load(store.keyNotes, {});
    if (text.trim()) notes[id] = text;
    else             delete notes[id];
    store.save(store.keyNotes, notes);
    pushCloud();
    }
  
  /* --- タグ追加 --- */
  function addTag(id, tag){
    const tags = store.load(store.keyTags,{});
    tags[id] = Array.from(new Set([...(tags[id]||[]), tag]));
    store.save(store.keyTags, tags);
    render();
    pushCloud();
  }
  
  /* --- タグ削除 --- */
  function removeTag(id, tag){
    const tags = store.load(store.keyTags,{});
    if (tags[id]) tags[id] = tags[id].filter(t=>t!==tag);
    store.save(store.keyTags, tags);
    render();
    pushCloud();
  }
  
  /* --- タグ一覧ビュー --- */
  function renderTagListView(){
    $content.innerHTML='';
    const tags = store.load(store.keyTags,{});
    const all  = new Set(Object.values(tags).flat());
    if (all.size===0){ $content.textContent='No tags yet.'; return; }
    const wrap = document.createElement('div'); wrap.className='controls';
    all.forEach(t=>{
      const b=document.createElement('button');
      b.textContent=`${t} (${countTag(t)})`;
      b.onclick = ()=>setView('tags', t);
      wrap.appendChild(b);
    });
    $content.appendChild(wrap);
  
    function countTag(tag){
      return Object.values(tags).filter(arr=>arr.includes(tag)).length;
    }
  }
  
  /* --- チェックポイント設定 --- */
  function setCheckpoint(id){
    store.save(store.keyCheckpointID, id);
    render();
    alert('Checkpoint saved!');
    pushCloud();
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