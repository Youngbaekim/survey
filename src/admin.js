// 관리 화면 — 교육 만들기, 문항 설정, 진행(QR·단계 전환), 결과 분석, 발표 모드
import './style.css';
import { getTheme, setTheme } from './theme.js';
import { CONFIGURED } from './firebase-config.js';
import {
  SCALES, TEMPLATES, DEFAULT_SAT, DEFAULT_OPEN_PRE, DEFAULT_OPEN_POST, PHASES,
  parseItems, itemsToText, esc, fmt, respondUrl, resultUrl,
  DEFAULT_TITLES, titlesOf, DEFAULT_INFO_CHOICE, DEFAULT_INFO_TEXT, parseChoices, choicesToText, isEtc, WHEN,
} from './common.js';
import { analyze, publicSummary } from './analysis.js';
import { summaryView, testLine, itemTable, openView, infoView, choiceTables, groupNote } from './render.js';
import { mean } from './stats.js';

export const VERSION = 'v0.3.0';
const ADMINS = ['youngpeace@gmail.com']; // firestore.rules의 목록과 같게 유지

const root = document.getElementById('root');
const present = document.getElementById('present');
const selTheme = document.getElementById('sel-theme');
selTheme.value = getTheme();
selTheme.onchange = () => setTheme(selTheme.value);

let F, db, user = null, authApi;
let unsubSession = null, unsubResp = null;
let cur = null; // { id, data, responses, res, tab }
let presentTab = 'qr';

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

if (!CONFIGURED) {
  root.innerHTML = `<div class="card"><h2>처음 설정이 필요합니다</h2>
    <p><code>src/firebase-config.js</code>에 Firebase 웹 앱 설정값을 붙여넣은 뒤 다시 배포해 주십시오.<br>자세한 순서는 저장소의 README.md에 있습니다.</p></div>`;
} else {
  boot();
}

async function boot() {
  ({ db } = await import('./firebase.js'));
  F = await import('firebase/firestore');
  authApi = await (await import('./firebase.js')).loadAuth();
  authApi.finishRedirect();
  document.getElementById('btn-logout').onclick = () => authApi.signOut();
  authApi.watch((u) => {
    user = u;
    document.getElementById('account').textContent = u ? u.email : '';
    document.getElementById('btn-logout').hidden = !u;
    if (!u) return renderLogin();
    if (!ADMINS.includes(u.email)) {
      root.innerHTML = `<div class="card"><div class="empty">${esc(u.email)} 계정은 관리 권한이 없습니다.<br>교육생은 강사가 안내한 QR 코드로 접속해 주세요.</div></div>`;
      return;
    }
    router();
  });
  window.addEventListener('hashchange', router);
}

function renderLogin() {
  closeSession();
  root.innerHTML = `<div class="card" style="max-width:460px;margin:40px auto;text-align:center">
    <img src="icons/icon.svg" width="64" height="64" alt="" style="border-radius:14px" />
    <h2 style="margin-top:12px">관리자 로그인</h2>
    <p class="note">교육 설문을 만들고 결과를 보려면 Google 계정으로 로그인하십시오.</p>
    <button id="login" class="btn primary big">Google 계정으로 로그인</button>
    <p class="note" style="margin-top:18px">교육생은 로그인하지 않고 QR 코드로 응답합니다.</p>
  </div>`;
  root.querySelector('#login').onclick = () => authApi.signIn().catch((e) => toast('로그인 실패: ' + e.code));
}

function router() {
  if (!user) return;
  const m = location.hash.match(/^#\/s\/([^/]+)(?:\/(\w+))?/);
  if (m) openSession(decodeURIComponent(m[1]), m[2] || 'run');
  else { closeSession(); renderList(); }
}

// ── 교육 목록 ──
async function renderList() {
  root.innerHTML = `<div class="btn-row"><h2 style="margin:0;flex:1">내 교육</h2><button id="new" class="btn primary">＋ 새 교육</button></div>
    <div id="list" class="sess-list"><div class="empty">불러오는 중…</div></div>
    <p class="note" style="margin-top:24px">${VERSION}</p>`;
  root.querySelector('#new').onclick = () => createSession();
  try {
    const snap = await F.getDocs(F.query(F.collection(db, 'sessions'), F.where('owner', '==', user.uid)));
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    const list = root.querySelector('#list');
    if (!list) return;
    list.innerHTML = rows.length ? rows.map((r) => `
      <button class="sess" data-id="${esc(r.id)}">
        <div class="sess-main"><div class="sess-title">${esc(r.title)}</div><div class="sess-meta">${esc([r.date, r.instructor, SCALES[r.scale]?.name, `효능감 ${r.items?.length || 0}문항`].filter(Boolean).join(' · '))}</div></div>
        <span class="badge ${r.phase}">${PHASES[r.phase] || r.phase}</span>
      </button>`).join('') : '<div class="empty">아직 만든 교육이 없습니다.<br>＋ 새 교육을 눌러 시작하십시오.</div>';
    list.querySelectorAll('.sess').forEach((b) => (b.onclick = () => (location.hash = `#/s/${b.dataset.id}`)));
  } catch (e) {
    console.error(e);
    root.querySelector('#list').innerHTML = `<div class="empty">목록을 불러오지 못했습니다. (${esc(e.code || e.message)})<br>Firestore 보안 규칙이 게시되었는지 확인해 주십시오.</div>`;
  }
}

function defaults() {
  const t = TEMPLATES[0];
  return {
    owner: user.uid, title: '새 교육', date: today(), instructor: '', scale: 'L5',
    titles: { ...DEFAULT_TITLES },
    infoChoice: parseChoices(DEFAULT_INFO_CHOICE.join('\n'), 'c'), infoText: parseItems(DEFAULT_INFO_TEXT.join('\n'), 't'),
    items: parseItems(t.items.join('\n'), 'e'), retro: false,
    sat: parseItems(DEFAULT_SAT.join('\n'), 's'),
    openPre: parseItems(DEFAULT_OPEN_PRE.join('\n'), 'a'),
    openPost: parseItems(DEFAULT_OPEN_POST.join('\n'), 'b'),
    phase: 'ready', showResults: false, minN: 5,
    createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp(),
  };
}

async function createSession(base = null) {
  try {
    const data = base ? { ...base, owner: user.uid, title: base.title + ' (복제)', date: today(), phase: 'ready', showResults: false, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() } : defaults();
    const ref = await F.addDoc(F.collection(db, 'sessions'), data);
    location.hash = `#/s/${ref.id}/setup`;
  } catch (e) {
    toast('만들기 실패: ' + (e.code || e.message));
  }
}

// ── 교육 상세 ──
function closeSession() {
  unsubSession?.(); unsubResp?.();
  unsubSession = unsubResp = null;
  cur = null;
  present.hidden = true;
}

function openSession(id, tab) {
  if (cur?.id === id) { cur.tab = tab; return drawSession(); }
  closeSession();
  cur = { id, data: null, responses: [], res: null, tab, published: '' };
  root.innerHTML = '<div class="empty">불러오는 중…</div>';
  unsubSession = F.onSnapshot(F.doc(db, 'sessions', id), (snap) => {
    if (!snap.exists()) { root.innerHTML = '<div class="empty">교육을 찾을 수 없습니다.</div>'; return; }
    const first = !cur.data;
    cur.data = snap.data();
    recompute();
    if (first || cur.tab !== 'setup') drawSession(); // 설정 탭은 입력 중 내용 보호
    else drawHeader();
    drawPresent();
  }, (e) => toast('불러오기 실패: ' + e.code));
  unsubResp = F.onSnapshot(F.collection(db, 'sessions', id, 'responses'), (snap) => {
    cur.responses = snap.docs.map((d) => d.data());
    recompute();
    if (cur.data && cur.tab !== 'setup') drawSession();
    else if (cur.data) drawHeader();
    drawPresent();
  }, (e) => toast('응답 불러오기 실패: ' + e.code));
}

let pubTimer = 0;
function recompute() {
  if (!cur?.data) return;
  cur.res = analyze(cur.data, cur.responses);
  // 공개용 집계를 자동 갱신 (내용이 바뀐 경우에만, 1.5초 모아서)
  clearTimeout(pubTimer);
  pubTimer = setTimeout(async () => {
    if (!cur?.res) return;
    // 결과 공개를 켠 경우에만 집계 게시, 끄면 인원수만 남김
    const sum = cur.data.showResults
      ? publicSummary(cur.res, cur.data.minN || 5)
      : { nPre: cur.res.nPre, nPost: cur.res.nPost, nPaired: cur.res.nPaired, minN: cur.data.minN || 5, locked: true, hidden: true, updatedAt: Date.now() };
    const sig = JSON.stringify({ ...sum, updatedAt: 0 });
    if (sig === cur.published) return;
    try {
      await F.setDoc(F.doc(db, 'sessions', cur.id, 'public', 'summary'), JSON.parse(JSON.stringify(sum, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v))));
      cur.published = sig;
      const el = root.querySelector('#pub-at');
      if (el) el.textContent = new Date().toLocaleTimeString('ko-KR');
    } catch (e) { console.warn('[survey] 집계 게시 실패', e); }
  }, 1500);
}

const TABS = [['run', '진행'], ['result', '결과'], ['open', '주관식'], ['setup', '설정·문항']];

function drawHeader() {
  const h = root.querySelector('#sess-head');
  if (!h) return;
  const d = cur.data, r = cur.res;
  h.innerHTML = `<div class="btn-row"><a href="#/" class="btn">‹ 목록</a>
    <div style="flex:1;min-width:200px"><div style="font-size:19px;font-weight:800">${esc(d.title)}</div>
    <div class="note" style="margin:0">${esc([d.date, d.instructor].filter(Boolean).join(' · '))} · 사전 ${r.nPre} · 사후 ${r.nPost} · 짝 ${r.nPaired}</div></div>
    <span class="badge ${d.phase}">${PHASES[d.phase]}</span>
    <button class="btn primary" id="btn-present">▶ 발표 모드</button></div>`;
  h.querySelector('#btn-present').onclick = openPresent;
}

function drawSession() {
  if (!cur?.data) return;
  const keepY = window.scrollY;
  root.innerHTML = `<div id="sess-head"></div>
    <nav class="tabs">${TABS.map(([k, n]) => `<a class="tab ${cur.tab === k ? 'active' : ''}" href="#/s/${cur.id}/${k}">${n}</a>`).join('')}</nav>
    <div id="tab"></div>`;
  drawHeader();
  const el = root.querySelector('#tab');
  ({ run: drawRun, result: drawResult, open: drawOpen, setup: drawSetup })[cur.tab]?.(el);
  window.scrollTo(0, keepY);
}

// ── 진행 탭 ──
async function qrCanvas(url, width) {
  const QR = (await import('qrcode')).default;
  const c = document.createElement('canvas');
  await QR.toCanvas(c, url, { width, margin: 1, errorCorrectionLevel: 'M' });
  c.style.width = c.style.height = ''; // 화면 크기는 CSS가 정함
  return c;
}

function drawRun(el) {
  const d = cur.data, r = cur.res, url = respondUrl(cur.id), rurl = resultUrl(cur.id);
  const ph = d.phase;
  el.innerHTML = `<div class="run-grid">
    <div class="card qr-box"><div id="qr"></div><p class="url">${esc(url)}</p>
      <div class="btn-row" style="justify-content:center"><button class="btn" id="copy">주소 복사</button><button class="btn" id="saveqr">QR 저장</button></div>
      <p class="note">사전·사후 모두 같은 QR을 사용합니다.<br>단계를 바꾸면 교육생 화면이 자동으로 바뀝니다.</p></div>
    <div>
      <div class="card"><h2>응답 현황</h2>
        <div class="counts"><div class="count"><b>${r.nPre}</b><span>사전 응답</span></div><div class="count"><b>${r.nPost}</b><span>사후 응답</span></div><div class="count"><b>${r.nPaired}</b><span>사전·사후 짝</span></div></div>
        <h3>설문 단계</h3>
        <div class="btn-row phase-btns">
          ${[['ready', '준비'], ['pre', '① 사전 설문 열기'], ['post', '② 사후 설문 열기'], ['closed', '마감']].map(([k, n]) => `<button class="btn ${ph === k ? 'on' : ''}" data-phase="${k}">${n}</button>`).join('')}
        </div>
        <p class="note">현재: <b>${PHASES[ph]}</b> · 한 단계만 열 수 있으며, 열린 단계에만 응답이 저장됩니다.</p>
      </div>
      <div class="card"><h2>교육생 결과 공개</h2>
        <div class="btn-row"><button class="btn ${d.showResults ? 'on' : ''}" id="show">${d.showResults ? '공개 중 — 끄기' : '결과 공개 켜기'}</button>
        <button class="btn" id="copy-r">공개 결과 주소 복사</button></div>
        <p class="note">켜면 교육생의 '나의 결과' 화면에 전체 평균이 함께 표시되고, 공개 결과 화면(${esc(rurl)})이 열립니다.<br>
        짝지어진 응답이 <b>${d.minN || 5}명 미만</b>이면 개인 식별 방지를 위해 집계를 공개하지 않습니다. · 공개용 집계 갱신: <span id="pub-at">자동</span></p>
        <p class="note">※ 집계는 이 관리 화면이 열려 있는 동안 자동으로 갱신됩니다.</p>
      </div>
    </div></div>`;
  qrCanvas(url, 480).then((c) => { el.querySelector('#qr')?.replaceChildren(c); });
  el.querySelector('#copy').onclick = () => navigator.clipboard.writeText(url).then(() => toast('응답 주소를 복사했습니다.'));
  el.querySelector('#copy-r').onclick = () => navigator.clipboard.writeText(rurl).then(() => toast('공개 결과 주소를 복사했습니다.'));
  el.querySelector('#saveqr').onclick = async () => {
    const c = await qrCanvas(url, 1000);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `YB_C_QR_${d.title.replace(/[\\/:*?"<>|\s]+/g, '_')}.png`;
    a.click();
  };
  el.querySelectorAll('[data-phase]').forEach((b) => (b.onclick = () => setPhase(b.dataset.phase)));
  el.querySelector('#show').onclick = () => update({ showResults: !d.showResults });
}

async function update(patch) {
  try { await F.updateDoc(F.doc(db, 'sessions', cur.id), { ...patch, updatedAt: F.serverTimestamp() }); }
  catch (e) { toast('저장 실패: ' + (e.code || e.message)); }
}

function setPhase(p) {
  if (p === cur.data.phase) return;
  if (p === 'post' && cur.res.nPre === 0 && !confirm('사전 응답이 없습니다. 그래도 사후 설문을 열까요?')) return;
  update({ phase: p });
}

// ── 결과 탭 ──
function drawResult(el) {
  const r = cur.res, d = cur.data;
  el.innerHTML = `<div class="btn-row no-print" style="justify-content:flex-end;margin-bottom:10px">
      <button class="btn" id="csv">CSV 내려받기</button><button class="btn" id="print">A4 인쇄·PDF</button></div>
    <div class="print-only"><h1 style="margin:0 0 4px;font-size:18pt">${esc(d.title)} — 교육 전후 효능감 분석</h1>
      <p class="note">${esc([d.date, d.instructor].filter(Boolean).join(' · '))} · 척도 ${SCALES[d.scale]?.name} · 출력 ${new Date().toLocaleString('ko-KR')}</p></div>
    <div class="card">
      ${r.nPaired ? summaryView({ ...r, locked: false }, { titles: titlesOf(d) }) : `<div class="empty">사전·사후 모두 응답한 인원이 아직 없습니다.<br>(사전 ${r.nPre}명 · 사후 ${r.nPost}명)</div>`}
    </div>
    ${r.nPaired ? `<div class="card page-break"><h2>통계 검정</h2>
      ${testLine(r.overall)}
      <div class="tbl-wrap">${itemTable(r)}</div>
      <p class="note">· 짝지어진 응답(같은 응답 코드로 사전·사후 모두 제출)만 분석 · 변화 = 사후 − 사전<br>
      · d<sub>z</sub> = 평균 차이 ÷ 차이의 표준편차 (Cohen 기준 0.2 작음 / 0.5 중간 / 0.8 큼)¹ · Wilcoxon은 n ≤ 50이면 정확 검정, 초과 시 정규 근사<br>
      · 참고: 전체 응답자 단순 평균 — 사전 ${fmt(r.preAll)} (n=${r.nPre}) / 사후 ${fmt(r.postAll)} (n=${r.nPost})</p>
      ${r.retro && r.retro.n >= 2 ? `<h3>회고적 사전 평가 비교</h3>${testLine(r.retro)}
        ${r.retro.shift.n >= 2 ? `<p class="note">응답 이동(실제 사전 → 회고적 사전): ${testLine(r.retro.shift).replace(/<\/?p[^>]*>/g, '')}</p>` : ''}` : ''}
      <p class="note">¹ Cohen, J. (1988). <i>Statistical power analysis for the behavioral sciences</i> (2nd ed.). Lawrence Erlbaum.</p>
    </div>` : ''}
    ${r.infoChoice.length ? `<div class="card"><h2>${esc(titlesOf(d).info)}별 결과</h2>${infoView(r)}</div>` : ''}
    ${r.extra.filter((x) => x.phases.some((p) => p.choice.length)).map((x) => `<div class="card"><h2>${esc(x.title)}</h2>
      ${x.phases.filter((p) => p.choice.length).map((p) => `${x.phases.length > 1 ? `<h3>${p.label} 응답</h3>` : `<p class="note">${p.label} 설문 문항</p>`}${choiceTables(r, p.choice)}`).join('')}${groupNote}</div>`).join('')}`;
  el.querySelector('#print').onclick = () => window.print();
  el.querySelector('#csv').onclick = downloadCsv;
}

function downloadCsv() {
  const d = cur.data, items = d.items || [];
  const pre = new Map(), post = new Map();
  cur.responses.forEach((r) => (r.phase === 'pre' ? pre : post).set(r.key, r));
  const keys = [...new Set([...pre.keys(), ...post.keys()])];
  const infoQs = [...(d.infoChoice || []).flatMap((q) => [q, ...(q.options || []).some(isEtc) ? [{ id: `${q.id}_etc`, text: `${q.text}(직접입력)` }] : []]), ...(d.infoText || [])];
  const joinV = (v) => (Array.isArray(v) ? v.join('; ') : v ?? '');
  const extQs = (d.extra || []).flatMap((x, xi) => (x.when === 'both' ? ['pre', 'post'] : [x.when || 'pre']).flatMap((ph) =>
    [...(x.choice || []).flatMap((q) => [q, ...(q.options || []).some(isEtc) ? [{ id: `${q.id}_etc`, text: `${q.text}(직접입력)` }] : []]), ...(x.text || [])]
      .map((q) => ({ set: x.id, qid: q.id, ph, id: `${xi + 1}_${q.id}_${ph === 'pre' ? '사전' : '사후'}`, text: `[${x.title}] ${q.text}` }))));
  const head = ['응답키', '사전', '사후', ...infoQs.map((q) => `정보_${q.id}`), ...extQs.map((q) => `기타_${q.id}`),
    ...items.map((i) => `사전_${i.id}`), ...items.map((i) => `사후_${i.id}`),
    ...(d.retro ? items.map((i) => `회고사전_${i.id}`) : []),
    ...(d.sat || []).map((s) => `만족_${s.id}`),
    ...(d.openPre || []).map((q) => `사전의견_${q.id}`), ...(d.openPost || []).map((q) => `사후의견_${q.id}`),
    '사전평균', '사후평균', '변화'];
  const avg = (o) => { const v = items.map((i) => o?.[i.id]).filter(Number.isFinite); return v.length ? mean(v) : ''; };
  const rows = keys.map((k) => {
    const a = pre.get(k), b = post.get(k);
    const pa = avg(a?.eff), pb = avg(b?.eff);
    const inf = { ...(b?.info || {}), ...(a?.info || {}) };
    return [k, a ? 1 : 0, b ? 1 : 0, ...infoQs.map((q) => joinV(inf[q.id])),
      ...extQs.map((q) => joinV((q.ph === 'pre' ? a : b)?.ext?.[q.set]?.[q.qid])),
      ...items.map((i) => a?.eff?.[i.id] ?? ''), ...items.map((i) => b?.eff?.[i.id] ?? ''),
      ...(d.retro ? items.map((i) => b?.retro?.[i.id] ?? '') : []),
      ...(d.sat || []).map((s) => b?.sat?.[s.id] ?? ''),
      ...(d.openPre || []).map((q) => a?.open?.[q.id] ?? ''), ...(d.openPost || []).map((q) => b?.open?.[q.id] ?? ''),
      pa === '' ? '' : pa.toFixed(3), pb === '' ? '' : pb.toFixed(3), pa !== '' && pb !== '' ? (pb - pa).toFixed(3) : ''];
  });
  const legendRows = [[], ['문항ID', '요인', '문항'], ...infoQs.map((q) => [q.id, '참여자 정보', q.text]), ...extQs.map((q) => [`기타_${q.id}`, '기타 문항', q.text]), ...items.map((i) => [i.id, i.factor, i.text]), ...(d.sat || []).map((s) => [s.id, '만족도', s.text]),
    ...(d.openPre || []).map((q) => [q.id, '사전 주관식', q.text]), ...(d.openPost || []).map((q) => [q.id, '사후 주관식', q.text])];
  const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [head, ...rows, ...legendRows].map((r) => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `YB_C_${d.title.replace(/[\\/:*?"<>|\s]+/g, '_')}_${d.date || ''}_응답.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ── 주관식 탭 ──
function drawOpen(el) {
  const r = cur.res;
  const html = openView(r.infoText, titlesOf(cur.data).info)
    + r.extra.map((x) => x.phases.map((p) => openView(p.text, `${x.title}(${p.label})`)).join('')).join('')
    + openView(r.openPre, '사전') + openView(r.openPost, '사후');
  el.innerHTML = `<div class="card"><h2>주관식 응답</h2><p class="note">핵심어는 응답에 함께 나온 낱말의 단순 빈도입니다(조사 일부 제거). 해석 시 원문을 함께 확인하십시오.</p>${html || '<div class="empty">주관식 문항이 없습니다.</div>'}</div>`;
}

// ── 설정 탭 ──
function drawSetup(el) {
  const d = cur.data;
  const locked = cur.responses.length > 0;
  el.innerHTML = `<div class="card"><h2>기본 정보</h2>
    <div class="form-grid">
      <label>교육명</label><input class="inp" id="f-title" value="${esc(d.title)}" />
      <label>일자</label><input class="inp" id="f-date" type="date" value="${esc(d.date)}" style="max-width:200px" />
      <label>강사·주관</label><input class="inp" id="f-inst" value="${esc(d.instructor)}" placeholder="예: 교육혁신팀" />
      <label>공개 최소 인원</label><div><input class="inp" id="f-minn" type="number" min="3" max="30" value="${d.minN || 5}" style="max-width:100px" /> <span class="note">짝지어진 응답이 이 인원 미만이면 교육생에게 집계를 보이지 않음</span></div>
    </div></div>
  <div class="card"><h2>참여자 정보</h2>
    <div class="form-grid">
      <label>화면 표시 이름</label><input class="inp title-inp" id="t-info" value="${esc(titlesOf(d).info)}" />
      <label>객관식</label><div><textarea class="ta auto" rows="1" id="f-ichoice" placeholder="소속 | 교원, 직원, 기타*">${esc(choicesToText(d.infoChoice))}</textarea>
        <p class="note">한 줄에 한 문항 · <b>질문 | 보기1, 보기2, …</b> 형식(보기는 쉼표로 구분) · 보기 끝에 <b>*</b>를 붙이면 ‘직접입력’ 보기(예: <b>기타*</b>) · 질문 끝에 <b>(복수)</b>를 붙이면 복수 선택(예: <b>관심 분야(복수) | 수업, 연구, 행정</b>).<br>객관식은 필수 응답이며, 결과 탭에서 보기별 효능감 변화가 함께 분석됩니다.</p></div>
      <label>주관식</label><div><textarea class="ta auto" rows="1" id="f-itext" placeholder="예: 소속 부서">${esc(itemsToText(d.infoText))}</textarea>
        <p class="note">한 줄에 한 문항 · 선택 응답 · 이름·연락처 등 개인 식별정보는 묻지 않는 것을 권장합니다.</p></div>
    </div>
    <p class="note">참여자 정보는 사전 설문에서 묻고, 사전 응답이 없는 사람에게만 사후 설문에서 묻습니다. 비워 두면 묻지 않습니다.</p></div>
  <div id="extra-sets">${(d.extra || []).map((x, i) => extraCard(x, i + 1)).join('')}</div>
  <div class="btn-row set-ctl"><button class="btn" id="x-add" title="기타 문항 세트 추가">＋ 기타 문항</button><button class="btn" id="x-del" title="마지막 기타 문항 세트 삭제" ${(d.extra || []).length ? '' : 'disabled'}>－ 기타 문항</button>
    <span class="note">참여자 정보와 같은 구성(객관식·주관식)의 문항 세트를 추가합니다.</span></div>
  <div class="card"><h2>효능감 문항</h2>
    ${locked ? '<p class="note" style="color:var(--danger)">응답이 들어온 뒤에는 척도·효능감 문항·회고 설정을 바꿀 수 없습니다. (바꾸려면 ‘복제’ 후 새 교육으로)</p>' : ''}
    <div class="form-grid">
      <label>화면 표시 이름</label><input class="inp title-inp" id="t-eff" value="${esc(titlesOf(d).eff)}" />
      <label>척도</label><select class="sel" id="f-scale" style="max-width:260px" ${locked ? 'disabled' : ''}>${Object.entries(SCALES).map(([k, s]) => `<option value="${k}" ${d.scale === k ? 'selected' : ''}>${s.name}</option>`).join('')}</select>
      <label>예시 문항</label><div class="btn-row"><select class="sel" id="f-tpl" style="max-width:320px" ${locked ? 'disabled' : ''}><option value="">— 예시 불러오기 —</option>${TEMPLATES.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
      <label>문항</label><div><textarea class="ta auto" rows="1" id="f-items" ${locked ? 'disabled' : ''}>${esc(itemsToText(d.items))}</textarea>
        <p class="note">한 줄에 한 문항 · 하위요인을 쓰려면 <b>요인명 | 문항</b> 형식 · 예시 문항은 자체 작성 예시이므로 교육 목표에 맞게 고쳐 쓰십시오.<br>효능감 문항은 ‘~할 수 있다’ 형태(할 수 있다는 믿음)로 쓰는 것이 원칙입니다.</p></div>
      <label>회고적 사전 평가</label><label class="chk"><input type="checkbox" id="f-retro" ${d.retro ? 'checked' : ''} ${locked ? 'disabled' : ''} /><span>사후 설문에서 ‘교육 전의 나’를 함께 응답 (응답 이동 편향 보정, 응답 부담은 늘어남)</span></label>
    </div></div>
  <div class="card"><h2>만족도·주관식</h2>
    <div class="form-grid">
      <label>화면 표시 이름</label><div class="btn-row"><span class="note">만족도</span><input class="inp title-inp" id="t-sat" value="${esc(titlesOf(d).sat)}" /><span class="note">주관식</span><input class="inp title-inp" id="t-open" value="${esc(titlesOf(d).open)}" /></div>
      <label>만족도(사후, 5점)</label><textarea class="ta auto" rows="1" id="f-sat">${esc(itemsToText(d.sat))}</textarea>
      <label>사전 주관식</label><textarea class="ta auto" rows="1" id="f-opre">${esc(itemsToText(d.openPre))}</textarea>
      <label>사후 주관식</label><textarea class="ta auto" rows="1" id="f-opost">${esc(itemsToText(d.openPost))}</textarea>
    </div>
    <p class="note">만족도·주관식은 비워 두면 묻지 않습니다. 응답이 들어온 뒤 문항 순서를 바꾸면 기존 응답과 어긋나므로 끝에 추가만 하십시오.</p></div>
  <div class="btn-row" style="margin-top:14px"><button class="btn primary big" id="save">저장</button><span class="grow" style="flex:1"></span>
    <button class="btn" id="dup">복제</button><button class="btn danger" id="del">삭제</button></div>`;

  autoGrow(el);
  const sets = el.querySelector('#extra-sets');
  const delBtn = el.querySelector('#x-del');
  el.querySelector('#x-add').onclick = () => {
    const n = sets.children.length + 1;
    sets.insertAdjacentHTML('beforeend', extraCard({ id: 'x' + Date.now().toString(36), title: '기타 문항', when: 'pre', choice: [], text: [] }, n));
    autoGrow(sets.lastElementChild);
    delBtn.disabled = false;
    sets.lastElementChild.querySelector('.title-inp').focus();
  };
  delBtn.onclick = () => {
    const last = sets.lastElementChild;
    if (!last) return;
    const filled = [...last.querySelectorAll('textarea')].some((t) => t.value.trim());
    if (filled && !confirm(`‘${last.querySelector('.title-inp').value}’ 세트를 삭제할까요? (저장해야 반영됩니다)`)) return;
    last.remove();
    delBtn.disabled = !sets.children.length;
  };
  el.querySelector('#f-tpl').onchange = (e) => {
    const t = TEMPLATES.find((x) => x.id === e.target.value);
    if (t && confirm('지금 문항을 예시 문항으로 바꿀까요?')) { const ta = el.querySelector('#f-items'); ta.value = t.items.join('\n'); ta.dispatchEvent(new Event('input')); }
    e.target.value = '';
  };
  el.querySelector('#save').onclick = async () => {
    const v = (id) => el.querySelector(id).value;
    const patch = {
      title: v('#f-title').trim() || '제목 없음', date: v('#f-date'), instructor: v('#f-inst').trim(),
      minN: Math.max(3, Math.min(30, parseInt(v('#f-minn'), 10) || 5)),
      sat: parseItems(v('#f-sat'), 's'), openPre: parseItems(v('#f-opre'), 'a'), openPost: parseItems(v('#f-opost'), 'b'),
      infoChoice: parseChoices(v('#f-ichoice'), 'c'), infoText: parseItems(v('#f-itext'), 't'),
      titles: Object.fromEntries(['info', 'eff', 'sat', 'open'].map((k) => [k, v(`#t-${k}`).trim() || DEFAULT_TITLES[k]])),
    };
    patch.extra = [...sets.children].map((c) => ({
      id: c.dataset.xid, title: c.querySelector('.title-inp').value.trim() || '기타 문항', when: c.querySelector('.x-when').value,
      choice: parseChoices(c.querySelector('.x-choice').value, 'c'), text: parseItems(c.querySelector('.x-text').value, 't'),
    }));
    const bad = [...patch.infoChoice, ...patch.extra.flatMap((x) => x.choice)].find((q) => q.options.length < 2);
    if (bad) return toast(`‘${bad.text}’ 문항의 보기를 2개 이상 입력하십시오. (질문 | 보기1, 보기2)`);
    if (!locked) {
      patch.scale = v('#f-scale');
      patch.items = parseItems(v('#f-items'), 'e');
      patch.retro = el.querySelector('#f-retro').checked;
      if (!patch.items.length) return toast('효능감 문항을 1개 이상 입력하십시오.');
    }
    await update(patch);
    toast('저장했습니다.');
  };
  el.querySelector('#dup').onclick = () => {
    const { owner, createdAt, updatedAt, ...rest } = cur.data;
    createSession(rest);
  };
  el.querySelector('#del').onclick = deleteSession;
}

async function deleteSession() {
  const n = cur.responses.length;
  if (!confirm(`‘${cur.data.title}’ 교육과 응답 ${n}건을 영구 삭제할까요?`)) return;
  try {
    const id = cur.id;
    const snap = await F.getDocs(F.collection(db, 'sessions', id, 'responses'));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const b = F.writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((x) => b.delete(x.ref));
      await b.commit();
    }
    await F.deleteDoc(F.doc(db, 'sessions', id, 'public', 'summary')).catch(() => {});
    closeSession();
    await F.deleteDoc(F.doc(db, 'sessions', id));
    toast('삭제했습니다.');
    location.hash = '#/';
  } catch (e) { toast('삭제 실패: ' + (e.code || e.message)); }
}

// ── 발표 모드 ──
function openPresent() {
  presentTab = cur.data.phase === 'pre' || cur.data.phase === 'post' ? 'qr' : 'result';
  present.hidden = false;
  document.documentElement.requestFullscreen?.().catch(() => {});
  drawPresent(true);
}
function closePresent() {
  present.hidden = true;
  if (document.fullscreenElement) document.exitFullscreen?.();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !present.hidden) closePresent(); });

async function drawPresent(force = false) {
  if (present.hidden || !cur?.data) return;
  const d = cur.data, r = cur.res;
  // QR 화면은 숫자만 갱신 (QR 깜빡임 방지)
  if (!force && presentTab === 'qr' && present.querySelector('#p-count') && present.dataset.phase === d.phase) {
    present.querySelector('#p-count').textContent = d.phase === 'post' ? r.nPost : r.nPre;
    return;
  }
  present.dataset.phase = d.phase;
  const bar = `<div class="present-bar"><span class="grow">${esc(d.title)}</span>
    <button class="btn ${presentTab === 'qr' ? 'on' : ''}" data-pt="qr">QR·응답 현황</button>
    <button class="btn ${presentTab === 'result' ? 'on' : ''}" data-pt="result">결과</button>
    <button class="btn" id="p-close">닫기 (Esc)</button></div>`;
  if (presentTab === 'qr') {
    const label = d.phase === 'post' ? '교육 후 설문' : d.phase === 'pre' ? '교육 전 설문' : PHASES[d.phase];
    present.innerHTML = `${bar}<h1>${esc(label)}</h1><p class="sub">휴대폰 카메라로 QR 코드를 찍어 응답해 주십시오.</p>
      <div class="present-qr"><div id="p-qr"></div>
        <div class="present-count"><b id="p-count" class="big-n">${d.phase === 'post' ? r.nPost : r.nPre}</b><span>명 응답 완료${d.phase === 'post' ? ` · 사전 응답 ${r.nPre}명` : ''}</span>
          <div class="code-help">응답 코드(6자리) = <b>생일 월·일 4자리 + 휴대폰 끝 2자리</b><br>예) 3월 7일생, 끝자리 45 → <b>030745</b><br><span class="note">교육 전·후에 같은 코드를 입력해야 비교됩니다.</span></div></div></div>`;
    qrCanvas(respondUrl(cur.id), 900).then((c) => present.querySelector('#p-qr')?.replaceChildren(c));
  } else {
    present.innerHTML = `${bar}${r.nPaired ? summaryView({ ...r, locked: false }, { title: `교육 전후 ${titlesOf(d).eff} 변화`, big: true, titles: titlesOf(d) }) + `<div class="summary big">${testLine(r.overall)}</div>` : '<div class="empty" style="font-size:22px">사전·사후 모두 응답한 인원이 아직 없습니다.</div>'}`;
  }
  present.querySelectorAll('[data-pt]').forEach((b) => (b.onclick = () => { presentTab = b.dataset.pt; drawPresent(true); }));
  present.querySelector('#p-close').onclick = closePresent;
}

function extraCard(x, n) {
  return `<div class="card x-set" data-xid="${esc(x.id)}"><h2>기타 문항 ${n}</h2>
    <div class="form-grid">
      <label>화면 표시 이름</label><input class="inp title-inp" value="${esc(x.title || '기타 문항')}" />
      <label>실시 시점</label><select class="sel x-when" style="max-width:200px">${Object.entries(WHEN).map(([k, v]) => `<option value="${k}" ${x.when === k ? 'selected' : ''}>${v} 설문</option>`).join('')}</select>
      <label>객관식</label><div><textarea class="ta auto x-choice" rows="1" placeholder="질문 | 보기1, 보기2, 기타*   (복수 선택: 질문(복수) | 보기…)">${esc(choicesToText(x.choice))}</textarea></div>
      <label>주관식</label><textarea class="ta auto x-text" rows="1" placeholder="한 줄에 한 문항">${esc(itemsToText(x.text))}</textarea>
    </div></div>`;
}

/** 입력칸 높이를 내용에 맞춰 자동 조절 (문항이 늘면 칸도 늘어남) */
function autoGrow(scope) {
  const fit = (ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  scope.querySelectorAll('textarea.auto').forEach((ta) => {
    fit(ta);
    if (!ta.dataset.grow) { ta.dataset.grow = '1'; ta.addEventListener('input', () => fit(ta)); }
  });
}
