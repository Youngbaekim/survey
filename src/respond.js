// 교육생 응답 화면 (s.html?id=교육ID) — 로그인 없음
import './style.css';
import './theme.js';
import { CONFIGURED } from './firebase-config.js';
import { SCALES, SAT_SCALE, scaleValues, validCode, codeKey, esc, fmt, fmtSigned, titlesOf, isEtc, optLabel } from './common.js';
import { dumbbell, legend } from './render.js';
import { mean } from './stats.js';

const root = document.getElementById('root');
const sid = new URLSearchParams(location.search).get('id') || '';
const LS = `yb-survey:${sid}`;

const local = {
  get() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } },
  set(patch) { try { localStorage.setItem(LS, JSON.stringify({ ...local.get(), ...patch })); } catch { /* 무시 */ } },
};

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

if (!CONFIGURED) root.innerHTML = '<div class="empty">설정이 아직 끝나지 않았습니다. (Firebase 설정값 필요)</div>';
else if (!sid) root.innerHTML = '<div class="empty">설문 주소가 올바르지 않습니다.<br>QR 코드를 다시 찍어 주세요.</div>';
else start();

let fb, session = null, summary = null, view = '', form = null;

async function start() {
  const { db } = await import('./firebase.js');
  const fs = await import('firebase/firestore');
  fb = { db, ...fs };
  fs.onSnapshot(fs.doc(db, 'sessions', sid), (snap) => {
    if (!snap.exists()) { root.innerHTML = '<div class="empty">설문을 찾을 수 없습니다.</div>'; return; }
    const prev = session;
    session = snap.data();
    // 단계가 바뀌었거나 처음이면 다시 그림 (작성 중인 응답은 단계가 같으면 유지)
    if (!prev || prev.phase !== session.phase) route();
    else if (view === 'card') renderCard();
  }, () => { root.innerHTML = '<div class="empty">연결에 실패했습니다. 잠시 후 다시 열어 주세요.</div>'; });
  fs.onSnapshot(fs.doc(db, 'sessions', sid, 'public', 'summary'), (snap) => {
    summary = snap.exists() ? snap.data() : null;
    if (view === 'card') renderCard();
  }, () => {});
}

function head(sub) {
  return `<header class="resp-head">
    <span class="badge ${session.phase}">${sub}</span>
    <h1>${esc(session.title)}</h1>
    <div class="note">${esc([session.date, session.instructor].filter(Boolean).join(' · '))}</div>
  </header>`;
}

function route() {
  const ph = session.phase;
  const me = local.get();
  if (ph === 'ready') {
    view = 'wait';
    root.innerHTML = `${head('준비 중')}<div class="card"><div class="empty">아직 설문이 열리지 않았습니다.<br>강사가 시작하면 이 화면이 자동으로 바뀝니다.</div></div>`;
  } else if (ph === 'pre' || ph === 'post') {
    if (me[ph]) return ph === 'post' ? renderCard() : renderDone();
    renderCode();
  } else {
    if (me.post) return renderCard();
    view = 'closed';
    root.innerHTML = `${head('마감')}<div class="card"><div class="empty">설문이 마감되었습니다. 참여해 주셔서 감사합니다.</div></div>`;
  }
}

// ── 1단계: 매칭 코드 ──
function renderCode() {
  view = 'code';
  const ph = session.phase;
  const me = local.get();
  root.innerHTML = `${head(ph === 'pre' ? '교육 전 설문' : '교육 후 설문')}
  <div class="card">
    <h2>나의 응답 코드</h2>
    <p>교육 전·후 응답을 이름 없이 연결하기 위한 6자리 숫자입니다.<br><b>생일 월·일 4자리 + 휴대폰 번호 끝 2자리</b></p>
    <p class="note">예) 3월 7일생, 휴대폰 끝자리 …45 → <b>030745</b> · 교육 후 설문에서도 같은 코드를 입력합니다.</p>
    <input id="code" class="inp code-inp" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="000000" value="${esc(me.code || '')}" />
    <button id="go" class="btn primary big" style="width:100%;margin-top:10px">다음</button>
  </div>`;
  const inp = root.querySelector('#code');
  inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); });
  const go = async () => {
    const code = inp.value;
    if (!validCode(code)) return toast('6자리 숫자(월·일 4자리 + 끝 2자리)를 정확히 입력해 주세요.');
    const btn = root.querySelector('#go');
    btn.disabled = true;
    try {
      const key = await codeKey(sid, code);
      const ex = await fb.getDoc(fb.doc(fb.db, 'sessions', sid, 'responses', `${ph}_${key}`));
      local.set({ code, key });
      if (ex.exists()) {
        const d = ex.data();
        local.set({ [ph]: { eff: d.eff, retro: d.retro } });
        toast('이미 제출된 코드입니다.');
        return ph === 'post' ? renderCard() : renderDone();
      }
      // 사후 단계: 사전 응답이 없는 사람에게만 참여자 정보를 물음
      let needInfo = ph === 'pre';
      if (ph === 'post') needInfo = !(await fb.getDoc(fb.doc(fb.db, 'sessions', sid, 'responses', `pre_${key}`))).exists();
      renderForm(key, needInfo);
    } catch (e) {
      console.error(e);
      toast('연결에 실패했습니다. 다시 시도해 주세요.');
      btn.disabled = false;
    }
  };
  root.querySelector('#go').onclick = go;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

// ── 2단계: 설문 ──
function scaleHtml(name, scale, value) {
  const vals = scaleValues(scale);
  const p100 = scale === SCALES.P100;
  return `<div class="scale ${p100 ? 'p100' : ''}" style="--n:${vals.length}" data-name="${name}">
    ${vals.map((v) => `<button type="button" data-v="${v}" class="${value === v ? 'sel' : ''}">${v}</button>`).join('')}
  </div><div class="scale-ends"><span>${esc(scale.labels[0])}</span>${p100 ? `<span>${esc(scale.labels[5])}</span>` : ''}<span>${esc(scale.labels.at(-1))}</span></div>`;
}

function choiceBlock(bk, title, choice, text) {
  if (!choice.length && !text.length) return '';
  const opt = (o) => `<button type="button" data-c="${esc(optLabel(o))}" ${isEtc(o) ? 'data-etc="1"' : ''}>${esc(optLabel(o))}${isEtc(o) ? '(직접입력)' : ''}</button>`;
  return `<div class="card" style="margin-top:10px"><h2>${esc(title)}</h2>
    ${choice.map((q, i) => `<div class="q" data-ch="${bk}:${q.id}"><div class="q-text"><span class="qn">${i + 1}.</span>${esc(q.text)}${q.multi ? ' <small class="note">(복수 선택 가능)</small>' : ''}</div>
      <div class="choices" data-bk="${bk}" data-id="${q.id}" ${q.multi ? 'data-multi="1"' : ''}>${q.options.map(opt).join('')}</div>
      <input class="inp etc-inp" data-etc-for="${bk}:${q.id}" maxlength="100" placeholder="직접 입력해 주십시오" hidden /></div>`).join('')}
    ${text.map((q, i) => `<div class="q"><div class="q-text"><span class="qn">${choice.length + i + 1}.</span>${esc(q.text)} <small class="note">(선택)</small></div>
      <textarea class="ta auto" rows="1" data-free="${bk}:${q.id}" maxlength="300"></textarea></div>`).join('')}
  </div>`;
}

function renderForm(key, needInfo) {
  view = 'form';
  const T = titlesOf(session);
  const ph = session.phase;
  const blocks = [];
  const okQ = (qs) => (qs || []).filter((q) => q.options?.length);
  if (needInfo) blocks.push({ bk: 'info', title: T.info, choice: okQ(session.infoChoice), text: session.infoText || [] });
  for (const x of session.extra || []) {
    if (x.when === ph || x.when === 'both') blocks.push({ bk: x.id, title: x.title || '기타 문항', choice: okQ(x.choice), text: x.text || [] });
  }
  const scale = SCALES[session.scale] || SCALES.L5;
  const retro = ph === 'post' && session.retro;
  const items = session.items || [];
  const sat = ph === 'post' ? session.sat || [] : [];
  const opens = (ph === 'pre' ? session.openPre : session.openPost) || [];
  form = { key, ans: Object.fromEntries(blocks.map((b) => [b.bk, {}])), eff: {}, retro: {}, sat: {}, open: {} };
  const nChoice = blocks.reduce((n, b) => n + b.choice.length, 0);
  const required = nChoice + items.length * (retro ? 2 : 1) + sat.length;

  const intro = ph === 'pre'
    ? '각 문항에 대해 <b>지금 자신이 할 수 있다고 믿는 정도</b>를 골라 주십시오.'
    : retro
      ? '각 문항마다 <b>① 교육을 받기 전의 나</b>를 지금 돌아보며 한 번, <b>② 교육을 마친 지금의 나</b>를 한 번 골라 주십시오.'
      : '각 문항에 대해 <b>교육을 마친 지금 자신이 할 수 있다고 믿는 정도</b>를 골라 주십시오.';

  root.innerHTML = `${head(ph === 'pre' ? '교육 전 설문' : '교육 후 설문')}
  <div class="progress"><i id="prog" style="width:0"></i></div>
  ${blocks.map((b) => choiceBlock(b.bk, b.title, b.choice, b.text)).join('')}
  <div class="card" style="margin-top:10px">
    <h2>${esc(T.eff)}</h2><p class="note">${intro}</p>
    ${items.map((it, i) => `<div class="q" data-q="eff:${it.id}${retro ? `,retro:${it.id}` : ''}">
      <div class="q-text"><span class="qn">${i + 1}.</span>${esc(it.text)}</div>
      ${retro ? `<div class="q-sub">① 교육 전의 나(돌아보며)</div>${scaleHtml(`retro:${it.id}`, scale)}<div class="q-sub">② 지금의 나</div>` : ''}
      ${scaleHtml(`eff:${it.id}`, scale)}
    </div>`).join('')}
  </div>
  ${sat.length ? `<div class="card"><h2>${esc(T.sat)}</h2>
    ${sat.map((it, i) => `<div class="q" data-q="sat:${it.id}"><div class="q-text"><span class="qn">${i + 1}.</span>${esc(it.text)}</div>${scaleHtml(`sat:${it.id}`, SAT_SCALE)}</div>`).join('')}
  </div>` : ''}
  ${opens.length ? `<div class="card"><h2>${esc(T.open)} <small class="note">(선택)</small></h2>
    ${opens.map((q) => `<div class="q"><div class="q-text">${esc(q.text)}</div><textarea class="ta auto" data-open="${q.id}" maxlength="1000" rows="2"></textarea></div>`).join('')}
  </div>` : ''}
  <div class="sticky-submit"><button id="submit" class="btn primary big">제출하기 (<span id="cnt">0</span>/${required})</button></div>
  <p class="note center">응답 코드는 암호화된 형태로만 저장되며 이름 등 개인 식별정보는 수집하지 않습니다.</p>`;

  const chosen = (bk, id) => { const v = form.ans[bk][id]; return Array.isArray(v) ? v.length > 0 : !!v; };
  const update = () => {
    const nc = blocks.reduce((n, b) => n + b.choice.filter((q) => chosen(b.bk, q.id)).length, 0);
    const done = nc + Object.keys(form.eff).length + Object.keys(form.retro).length + Object.keys(form.sat).length;
    root.querySelector('#cnt').textContent = done;
    root.querySelector('#prog').style.width = `${(done / Math.max(1, required)) * 100}%`;
  };
  root.querySelectorAll('.scale').forEach((el) => {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      const [grp, id] = el.dataset.name.split(':');
      form[grp][id] = Number(b.dataset.v);
      el.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
      el.closest('.q')?.classList.remove('missing');
      update();
    });
  });
  root.querySelectorAll('.choices').forEach((el) => {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-c]');
      if (!b) return;
      const { bk, id } = el.dataset;
      if (el.dataset.multi) b.classList.toggle('sel');
      else el.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
      const sel = [...el.querySelectorAll('button.sel')];
      form.ans[bk][id] = el.dataset.multi ? sel.map((x) => x.dataset.c) : sel[0]?.dataset.c || '';
      const etcOn = sel.some((x) => x.dataset.etc);
      const etc = root.querySelector(`[data-etc-for="${bk}:${id}"]`);
      if (etcOn && etc.hidden) { etc.hidden = false; etc.focus(); }
      if (!etcOn) { etc.hidden = true; etc.value = ''; delete form.ans[bk][`${id}_etc`]; }
      if (chosen(bk, id)) el.closest('.q')?.classList.remove('missing');
      update();
    });
  });
  root.querySelectorAll('[data-etc-for]').forEach((inp) => inp.addEventListener('input', () => {
    const [bk, id] = inp.dataset.etcFor.split(':');
    form.ans[bk][`${id}_etc`] = inp.value.trim().slice(0, 100);
    if (inp.value.trim()) inp.closest('.q').classList.remove('missing');
  }));
  root.querySelectorAll('[data-free]').forEach((ta) => ta.addEventListener('input', () => {
    const [bk, id] = ta.dataset.free.split(':');
    form.ans[bk][id] = ta.value.trim().slice(0, 300);
  }));
  root.querySelectorAll('[data-open]').forEach((ta) => ta.addEventListener('input', () => { form.open[ta.dataset.open] = ta.value.trim().slice(0, 1000); }));
  autoGrow(root);
  root.querySelector('#submit').onclick = () => submit(required);
}

/** 입력칸 높이를 내용에 맞춰 자동 조절 */
function autoGrow(scope) {
  const fit = (ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  scope.querySelectorAll('textarea.auto').forEach((ta) => { fit(ta); ta.addEventListener('input', () => fit(ta)); });
}

async function submit(required) {
  const missing = [...root.querySelectorAll('.q[data-q], .q[data-ch]')].filter((q) => {
    if (q.dataset.ch) {
      const [bk, id] = q.dataset.ch.split(':');
      const v = form.ans[bk][id];
      const etcOn = !root.querySelector(`[data-etc-for="${bk}:${id}"]`)?.hidden;
      return !(Array.isArray(v) ? v.length : v) || (etcOn && !form.ans[bk][`${id}_etc`]);
    }
    return q.dataset.q.split(',').some((k) => { const [g, id] = k.split(':'); return !Number.isFinite(form[g][id]); });
  });
  missing.forEach((q) => q.classList.add('missing'));
  if (missing.length) {
    missing[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    return toast(`응답하지 않은 문항이 ${missing.length}개 있습니다.`);
  }
  const ph = session.phase;
  const btn = root.querySelector('#submit');
  btn.disabled = true;
  const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => (Array.isArray(v) ? v.length : v)));
  const open = clean(form.open);
  const info = clean(form.ans.info);
  const ext = Object.fromEntries(Object.entries(form.ans).filter(([k]) => k !== 'info').map(([k, v]) => [k, clean(v)]));
  try {
    await fb.setDoc(fb.doc(fb.db, 'sessions', sid, 'responses', `${ph}_${form.key}`), {
      phase: ph, key: form.key, info, ext, eff: form.eff, retro: form.retro, sat: form.sat, open, at: fb.serverTimestamp(),
    });
    local.set({ [ph]: { eff: form.eff, retro: form.retro } });
    window.scrollTo(0, 0);
    ph === 'post' ? renderCard() : renderDone();
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    toast(e.code === 'permission-denied' ? '제출할 수 없습니다. 이미 제출했거나 설문 단계가 바뀌었습니다.' : '제출에 실패했습니다. 다시 눌러 주세요.');
  }
}

function renderDone() {
  view = 'done';
  root.innerHTML = `${head('교육 전 설문')}<div class="card"><div class="empty"><b style="font-size:20px;color:var(--ink)">제출되었습니다. 감사합니다!</b><br><br>교육이 끝나면 강사 안내에 따라<br><b>이 화면을 다시 열거나 같은 QR</b>로 교육 후 설문에 참여해 주세요.<br>응답 코드가 이 기기에 기억되어 있습니다.</div></div>
  <p class="center"><button id="reset" class="btn">다른 사람이 이 기기로 응답하기</button></p>`;
  root.querySelector('#reset').onclick = resetLocal;
}

function resetLocal() {
  if (!confirm('이 기기에 기억된 응답 코드를 지우고 새로 응답할까요?')) return;
  try { localStorage.removeItem(LS); } catch { /* 무시 */ }
  preCache = null;
  route();
}

// ── 3단계: 나의 결과 카드 ──
let preCache = null;
async function renderCard() {
  view = 'card';
  const me = local.get();
  const items = session.items || [];
  const scale = SCALES[session.scale] || SCALES.L5;
  if (!me.pre && me.key && preCache === null) {
    preCache = false;
    try {
      const snap = await fb.getDoc(fb.doc(fb.db, 'sessions', sid, 'responses', `pre_${me.key}`));
      if (snap.exists()) { local.set({ pre: { eff: snap.data().eff } }); }
    } catch { /* 무시 */ }
    return renderCard();
  }
  const pre = me.pre?.eff, post = me.post?.eff || {}, retro = me.post?.retro;
  const hasRetro = retro && Object.keys(retro).length;
  const base = pre || (hasRetro ? retro : null);
  const baseLabel = pre ? '교육 전' : '교육 전(돌아보며)';
  const s = { scale: session.scale || 'L5', scaleMin: scale.min, scaleMax: scale.max };
  const d = s.scale === 'P100' ? 1 : 2;
  const avg = (o) => mean(items.map((i) => o?.[i.id]).filter(Number.isFinite));
  const group = session.showResults && summary && !summary.locked ? summary : null;

  let body;
  if (!base) {
    body = '<p class="note">교육 전 응답이 없어 비교할 수 없습니다. (교육 전 설문 미참여 또는 다른 코드 입력)</p>';
  } else {
    const mPre = avg(base), mPost = avg(post), diff = mPost - mPre;
    const rows = items.map((it) => {
      const g = group?.items?.find((x) => x.id === it.id);
      return g
        ? { label: it.text, factor: it.factor, pre: g.pre, post: g.post, diff: g.diff, mine: { pre: base[it.id], post: post[it.id] } }
        : { label: it.text, factor: it.factor, pre: base[it.id], post: post[it.id], diff: post[it.id] - base[it.id] };
    });
    body = `
      <div class="kpis">
        <div class="kpi"><span class="kpi-label">${baseLabel}</span><span class="kpi-num pre-c">${fmt(mPre, d)}</span></div>
        <div class="kpi-arrow">→</div>
        <div class="kpi"><span class="kpi-label">교육 후</span><span class="kpi-num post-c">${fmt(mPost, d)}</span></div>
        <div class="kpi"><span class="kpi-label">나의 변화</span><span class="kpi-num ${diff >= 0 ? 'up-c' : 'down-c'}">${fmtSigned(diff, d)}</span>
          ${group ? `<span class="kpi-sub">전체 평균 변화 ${fmtSigned(group.overall.diff, d)}</span>` : ''}</div>
      </div>
      <h3>문항별 ${group ? '— 막대는 전체 평균, ◆는 나' : '나의 변화'}</h3>
      ${legend(!!group)}
      ${dumbbell(s, rows)}
      ${group ? '' : '<p class="note">강사가 전체 결과를 공개하면 이 화면에 전체 평균이 함께 표시됩니다.</p>'}`;
  }
  root.innerHTML = `${head('나의 결과')}
    <div class="card"><h2>교육 전후 나의 ${esc(titlesOf(session).eff)}</h2>${body}</div>
    ${session.showResults ? `<p class="center"><a class="btn" href="r.html?id=${encodeURIComponent(sid)}">전체 결과 보기 →</a></p>` : ''}
    <p class="note center">이 결과는 이 기기에서만 보입니다. 참여해 주셔서 감사합니다.</p>
    ${session.phase === 'post' ? '<p class="center"><button id="reset" class="btn">다른 사람이 이 기기로 응답하기</button></p>' : ''}`;
  root.querySelector('#reset')?.addEventListener('click', resetLocal);
}
