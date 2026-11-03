// 결과 화면 그리기 (HTML 문자열) — 관리·발표·공개·개인 카드 공용
import { esc, fmt, fmtSigned, pct } from './common.js';
import { effectLabel, fmtP } from './stats.js';

const dec = (s) => (s.scale === 'P100' ? 1 : 2);
const pos = (v, s) => ((v - s.scaleMin) / (s.scaleMax - s.scaleMin)) * 100;

/** 핵심 지표 카드 */
export function kpis(s) {
  const o = s.overall, d = dec(s);
  return `
  <div class="kpis">
    <div class="kpi"><span class="kpi-label">사전 평균</span><span class="kpi-num pre-c">${fmt(o.pre, d)}</span></div>
    <div class="kpi-arrow">→</div>
    <div class="kpi"><span class="kpi-label">사후 평균</span><span class="kpi-num post-c">${fmt(o.post, d)}</span></div>
    <div class="kpi"><span class="kpi-label">변화</span><span class="kpi-num ${o.diff >= 0 ? 'up-c' : 'down-c'}">${fmtSigned(o.diff, d)}</span></div>
    <div class="kpi"><span class="kpi-label">효과크기 d<sub>z</sub></span><span class="kpi-num">${fmt(o.dz)}</span><span class="kpi-sub">${effectLabel(o.dz)}</span></div>
    <div class="kpi"><span class="kpi-label">향상 응답자</span><span class="kpi-num">${pct(o.up)}</span><span class="kpi-sub">동일 ${pct(o.same)} · 하락 ${pct(o.down)}</span></div>
  </div>`;
}

/** 척도 눈금 */
function axis(s) {
  const ticks = [];
  const step = s.scale === 'P100' ? 20 : 1;
  for (let v = s.scaleMin; v <= s.scaleMax; v += step) ticks.push(`<span style="left:${pos(v, s)}%">${v}</span>`);
  return `<div class="db-row db-axis"><div class="db-label"></div><div class="db-ticks">${ticks.join('')}</div><div class="db-val"></div></div>`;
}

/**
 * 덤벨 차트: 문항별 사전(●회색) → 사후(●강조색)
 * rows: [{label, factor, pre, post, diff, mine?:{pre, post}}]
 */
export function dumbbell(s, rows, { showFactor = true } = {}) {
  const d = dec(s);
  return `<div class="db">${axis(s)}${rows.map((r) => {
    const a = pos(r.pre, s), b = pos(r.post, s);
    const lo = Math.min(a, b), w = Math.abs(b - a);
    const mine = r.mine ? `<span class="db-mark pre" style="left:${pos(r.mine.pre, s)}%" title="나의 사전"></span><span class="db-mark post" style="left:${pos(r.mine.post, s)}%" title="나의 사후"></span>` : '';
    return `<div class="db-row">
      <div class="db-label">${showFactor && r.factor ? `<em>${esc(r.factor)}</em> ` : ''}${esc(r.label)}</div>
      <div class="db-track"><span class="db-bar ${r.post >= r.pre ? 'up' : 'down'}" style="left:${lo}%;width:${w}%"></span><span class="db-dot pre" style="left:${a}%"></span><span class="db-dot post" style="left:${b}%"></span>${mine}</div>
      <div class="db-val">${fmt(r.pre, d)} → ${fmt(r.post, d)} <b class="${r.diff >= 0 ? 'up-c' : 'down-c'}">${fmtSigned(r.diff, d)}</b></div>
    </div>`;
  }).join('')}</div>`;
}

export const legend = (mine = false) => `<div class="legend"><span><i class="lg pre"></i>사전</span><span><i class="lg post"></i>사후</span>${mine ? '<span><i class="lg mk"></i>나(◆)</span>' : ''}</div>`;

/** 개인별 변화량 분포 */
export function histogram(s) {
  const diffs = s.diffs || [];
  if (!diffs.length) return '';
  const w = s.scale === 'P100' ? 10 : 0.5;
  const bin = (x) => Math.round(x / w) * w;
  const lo = Math.min(-2 * w, ...diffs.map(bin)), hi = Math.max(2 * w, ...diffs.map(bin));
  const cnt = new Map();
  diffs.forEach((x) => { const b = +bin(x).toFixed(2); cnt.set(b, (cnt.get(b) || 0) + 1); });
  const max = Math.max(...cnt.values());
  const bars = [];
  for (let b = lo; b <= hi + 1e-9; b = +(b + w).toFixed(2)) {
    const c = cnt.get(+b.toFixed(2)) || 0;
    const cls = b > 0 ? 'up' : b < 0 ? 'down' : 'zero';
    bars.push(`<div class="hb"><span class="hb-n">${c || ''}</span><span class="hb-bar ${cls}" style="height:${(c / max) * 100}%"></span><span class="hb-x">${b > 0 ? '+' : ''}${s.scale === 'P100' ? b : b.toFixed(1)}</span></div>`);
  }
  return `<div class="hist">${bars.join('')}</div><p class="note center">개인별 변화량(사후 − 사전, 문항 평균) 분포 · 오른쪽일수록 향상</p>`;
}

/** 통계 검정 요약 한 줄 */
export function testLine(o) {
  if (!o || o.n < 2) return '<p class="note">짝지어진 응답이 2명 이상이어야 검정할 수 있습니다.</p>';
  const parts = [
    `대응표본 t(${o.df}) = ${fmt(o.t)}, ${fmtP(o.p)}`,
    o.w ? `Wilcoxon 부호순위 ${fmtP(o.w.p)} (${o.w.method})` : o.wp != null ? `Wilcoxon ${fmtP(o.wp)}` : '',
    `Cohen's d<sub>z</sub> = ${fmt(o.dz)} (${effectLabel(o.dz)})`,
  ].filter(Boolean);
  const caution = o.n < 15 ? ' · <b>소규모(n&lt;15)</b>: 유의확률보다 효과크기·향상자 비율 중심으로 해석 권장' : '';
  return `<p class="stat-line">n = ${o.n} · ${parts.join(' · ')}${caution}</p>`;
}

/** 공개용·발표용 전체 결과 (publicSummary 또는 analyze 결과 모두 사용 가능) */
export function summaryView(s, { title = '', big = false } = {}) {
  if (!s) return '<div class="empty">아직 결과가 없습니다.</div>';
  if (s.locked) return `<div class="empty">사전·사후 모두 응답한 인원이 ${s.minN}명 이상이 되면 결과가 표시됩니다.<br>(현재 ${s.nPaired}명)</div>`;
  const itemRows = s.items.map((i) => ({ label: i.text, factor: i.factor, pre: i.pre, post: i.post, diff: i.diff }));
  const factorRows = (s.factors || []).map((f) => ({ label: f.name, pre: f.pre, post: f.post, diff: f.diff }));
  const retro = s.retro;
  return `<div class="summary ${big ? 'big' : ''}">
    ${title ? `<h2 class="sum-title">${esc(title)}</h2>` : ''}
    <p class="note">사전·사후 모두 응답(짝지어진 응답) ${s.nPaired}명 기준 · 척도 ${s.scaleMin}~${s.scaleMax}</p>
    ${kpis(s)}
    ${factorRows.length ? `<h3>요인별 변화</h3>${legend()}${dumbbell(s, factorRows, { showFactor: false })}` : ''}
    <h3>문항별 변화</h3>${legend()}${dumbbell(s, itemRows)}
    <h3>개인별 변화량</h3>${histogram(s)}
    ${retro ? `<h3>회고적 사전 평가(교육 후에 돌아본 교육 전 수준)</h3>
      <p class="note">교육을 받고 나서 기준이 높아지면 사전 점수를 높게 매기는 경향(응답 이동)을 보정하기 위한 비교입니다.</p>
      <div class="mini-kpis"><span>회고적 사전 <b class="pre-c">${fmt(retro.pre, dec(s))}</b></span><span>사후 <b class="post-c">${fmt(retro.post, dec(s))}</b></span><span>변화 <b>${fmtSigned(retro.diff, dec(s))}</b></span><span>d<sub>z</sub> <b>${fmt(retro.dz)}</b> (${effectLabel(retro.dz)})</span></div>
      ${retro.shift && retro.shift.n >= 2 ? `<p class="note">실제 사전 ${fmt(retro.shift.pre, dec(s))} vs 회고적 사전 ${fmt(retro.shift.post, dec(s))} (${fmtSigned(retro.shift.diff, dec(s))}, n=${retro.shift.n}) — 음수이면 교육 전 자신을 과대평가했던 것으로 해석</p>` : ''}` : ''}
    ${s.sat?.length ? `<h3>만족도(5점)</h3>${satTable(s.sat)}` : ''}
  </div>`;
}

export function satTable(sat) {
  return `<table class="tbl"><thead><tr><th>문항</th><th>n</th><th>평균</th><th>긍정(4·5점)</th></tr></thead><tbody>${sat.map((r) => `<tr><td>${esc(r.text)}</td><td class="num">${r.n}</td><td class="num">${fmt(r.mean)}</td><td class="num"><span class="pbar"><i style="width:${(r.pos || 0) * 100}%"></i></span>${pct(r.pos)}</td></tr>`).join('')}</tbody></table>`;
}

/** 관리자용 문항별 검정 표 */
export function itemTable(s) {
  const d = dec(s);
  const row = (label, o) => `<tr><td>${label}</td><td class="num">${o.n}</td><td class="num">${fmt(o.pre, d)}</td><td class="num">${fmt(o.post, d)}</td><td class="num">${fmtSigned(o.diff, d)}</td><td class="num">${fmt(o.dz)} <small>${effectLabel(o.dz)}</small></td><td class="num">${fmtP(o.p).replace('p ', '')}</td><td class="num">${o.w ? fmtP(o.w.p).replace('p ', '') : '-'}</td><td class="num">${pct(o.up)}</td></tr>`;
  return `<table class="tbl"><thead><tr><th>구분</th><th>n</th><th>사전</th><th>사후</th><th>변화</th><th>d<sub>z</sub></th><th>t검정 p</th><th>Wilcoxon p</th><th>향상</th></tr></thead><tbody>
    ${row('<b>전체(문항 평균)</b>', s.overall)}
    ${(s.factors || []).map((f) => row(`<b>[${esc(f.name)}]</b>`, f)).join('')}
    ${s.items.map((i, k) => row(`${k + 1}. ${esc(i.text)}`, i)).join('')}
  </tbody></table>`;
}

/** 주관식 */
export function openView(list, label) {
  if (!list?.length) return '';
  return list.map((q) => `
    <div class="open-q">
      <h4>${esc(label)} · ${esc(q.text)} <small>(${q.texts.length}건)</small></h4>
      ${q.keywords.length ? `<div class="chips">${q.keywords.map(([w, c]) => `<span class="chip">${esc(w)} <b>${c}</b></span>`).join('')}</div>` : ''}
      <ul class="open-list">${q.texts.map((t) => `<li>${esc(t)}</li>`).join('') || '<li class="note">응답 없음</li>'}</ul>
    </div>`).join('');
}
