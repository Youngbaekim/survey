// 교육생용 전체 결과 (r.html?id=교육ID) — 강사가 '결과 공개'를 켠 경우에만 표시, 실시간 갱신
import './style.css';
import './theme.js';
import { CONFIGURED } from './firebase-config.js';
import { esc, titlesOf } from './common.js';
import { summaryView } from './render.js';

const root = document.getElementById('root');
const sid = new URLSearchParams(location.search).get('id') || '';
let session = null, summary = null;

function draw() {
  if (!session) return;
  const head = `<header class="resp-head"><span class="badge">교육 전후 결과</span><h1>${esc(session.title)}</h1><div class="note">${esc([session.date, session.instructor].filter(Boolean).join(' · '))}</div></header>`;
  const body = session.showResults
    ? `<div class="card">${summaryView(summary, { titles: titlesOf(session) })}</div><p class="note center">이 화면은 응답이 들어오면 자동으로 갱신됩니다.</p>`
    : '<div class="card"><div class="empty">강사가 결과를 공개하면 이 화면에 표시됩니다.<br>(자동으로 바뀝니다)</div></div>';
  root.innerHTML = head + body;
}

if (!CONFIGURED) root.innerHTML = '<div class="empty">설정이 아직 끝나지 않았습니다.</div>';
else if (!sid) root.innerHTML = '<div class="empty">주소가 올바르지 않습니다.</div>';
else {
  const { db } = await import('./firebase.js');
  const { doc, onSnapshot } = await import('firebase/firestore');
  onSnapshot(doc(db, 'sessions', sid), (s) => { session = s.exists() ? s.data() : null; if (!session) root.innerHTML = '<div class="empty">결과를 찾을 수 없습니다.</div>'; else draw(); });
  onSnapshot(doc(db, 'sessions', sid, 'public', 'summary'), (s) => { summary = s.exists() ? s.data() : null; draw(); }, () => {});
}
