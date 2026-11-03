// 응답 → 분석 결과 (관리 화면·발표 모드·공개 결과·개인 카드가 함께 사용)
import { mean, sd, pairedT, wilcoxon } from './stats.js';
import { SCALES } from './common.js';

const personMean = (answers, items) => {
  const v = items.map((it) => answers?.[it.id]).filter((x) => Number.isFinite(x));
  return v.length ? mean(v) : NaN;
};

function compare(pairs) {
  // pairs: [[pre, post], ...]
  const pre = pairs.map((p) => p[0]), post = pairs.map((p) => p[1]);
  const t = pairedT(pre, post);
  const w = pairs.length ? wilcoxon(pre, post) : null;
  const up = pairs.filter((p) => p[1] > p[0] + 1e-9).length;
  const down = pairs.filter((p) => p[1] < p[0] - 1e-9).length;
  const n = pairs.length;
  return { ...t, w, up: n ? up / n : NaN, same: n ? (n - up - down) / n : NaN, down: n ? down / n : NaN };
}

export function analyze(session, responses) {
  const items = session.items || [];
  const scale = SCALES[session.scale] || SCALES.L5;
  const pre = new Map(), post = new Map();
  for (const r of responses) (r.phase === 'pre' ? pre : post).set(r.key, r);
  const pairedKeys = [...pre.keys()].filter((k) => post.has(k));

  const factorNames = [...new Set(items.map((i) => i.factor).filter(Boolean))];
  const pairsOf = (sel) => pairedKeys.map((k) => [personMean(pre.get(k).eff, sel), personMean(post.get(k).eff, sel)])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));

  const overall = compare(pairsOf(items));
  const itemRes = items.map((it) => ({ id: it.id, text: it.text, factor: it.factor, ...compare(pairsOf([it])) }));
  const factors = factorNames.map((f) => ({ name: f, ...compare(pairsOf(items.filter((i) => i.factor === f))) }));

  // 변화량 분포 (사후 − 사전, 개인 평균)
  const diffs = pairsOf(items).map((p) => p[1] - p[0]);

  // 회고적 사전 평가: 사후 응답자 중 회고 응답이 있는 사람
  let retro = null;
  if (session.retro) {
    const rp = [...post.values()].filter((r) => r.retro && Object.keys(r.retro).length)
      .map((r) => [personMean(r.retro, items), personMean(r.eff, items)])
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    const items2 = items.map((it) => {
      const pp = [...post.values()].filter((r) => Number.isFinite(r.retro?.[it.id]) && Number.isFinite(r.eff?.[it.id]))
        .map((r) => [r.retro[it.id], r.eff[it.id]]);
      return { id: it.id, ...compare(pp) };
    });
    // 응답 이동(response shift): 같은 사람의 실제 사전 vs 회고적 사전
    const shiftPairs = pairedKeys.filter((k) => post.get(k).retro && Object.keys(post.get(k).retro).length)
      .map((k) => [personMean(pre.get(k).eff, items), personMean(post.get(k).retro, items)])
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    retro = { ...compare(rp), items: items2, shift: compare(shiftPairs) };
  }

  const sat = (session.sat || []).map((it) => {
    const v = [...post.values()].map((r) => r.sat?.[it.id]).filter((x) => Number.isFinite(x));
    return { id: it.id, text: it.text, n: v.length, mean: mean(v), sd: sd(v), pos: v.length ? v.filter((x) => x >= 4).length / v.length : NaN };
  });

  const openOf = (qs, src) => (qs || []).map((q) => {
    const texts = [...src.values()].map((r) => (r.open?.[q.id] || '').trim()).filter(Boolean);
    return { id: q.id, text: q.text, texts, keywords: keywords(texts) };
  });

  return {
    scale: session.scale || 'L5',
    scaleMin: scale.min, scaleMax: scale.max,
    nPre: pre.size, nPost: post.size, nPaired: pairedKeys.length,
    preAll: mean([...pre.values()].map((r) => personMean(r.eff, items)).filter(Number.isFinite)),
    postAll: mean([...post.values()].map((r) => personMean(r.eff, items)).filter(Number.isFinite)),
    overall, items: itemRes, factors, diffs, retro, sat,
    openPre: openOf(session.openPre, pre), openPost: openOf(session.openPost, post),
  };
}

/** 교육생 공개용 집계: 주관식 원문 제외, 최소 인원 미만이면 인원만 */
export function publicSummary(res, minN) {
  const base = { nPre: res.nPre, nPost: res.nPost, nPaired: res.nPaired, minN, updatedAt: Date.now() };
  if (res.nPaired < minN) return { ...base, locked: true };
  const strip = (o) => (o ? { n: o.n, pre: o.pre, post: o.post, diff: o.diff, dz: o.dz, p: o.p, up: o.up, same: o.same, down: o.down, wp: o.w?.p ?? null } : null);
  return {
    ...base, locked: false, scale: res.scale, scaleMin: res.scaleMin, scaleMax: res.scaleMax,
    overall: strip(res.overall),
    items: res.items.map((i) => ({ id: i.id, text: i.text, factor: i.factor, ...strip(i) })),
    factors: res.factors.map((f) => ({ name: f.name, ...strip(f) })),
    diffs: res.diffs,
    retro: res.retro && res.retro.n >= minN ? { ...strip(res.retro), items: res.retro.items.map((i) => ({ id: i.id, ...strip(i) })), shift: strip(res.retro.shift) } : null,
    sat: res.sat.filter((s) => s.n >= minN).map((s) => ({ id: s.id, text: s.text, n: s.n, mean: s.mean, pos: s.pos })),
  };
}

// ── 주관식 핵심어 (단순 빈도) ──
const STOP = new Set(['그리고', '그런데', '하지만', '너무', '정말', '매우', '조금', '많이', '같은', '같다', '있는', '있다', '없다', '없는', '대한', '대해', '위한', '위해', '통해', '것을', '것이', '것은', '수업', '교육', '내용', '부분', '생각', '합니다', '했습니다', '좋았습니다', '좋겠습니다', '있었으면', '없습니다', '특히', '다른', '이번', '해서', '하는', '하고', '했다', '되는', '되었다', '좋은', '좋았다', '좋겠다', '것', '수', '등']);
const JOSA = /(으로써|으로서|에서는|에게서|이라는|라는|으로|에서|에게|까지|부터|보다|처럼|이랑|하고|이나|이며|이고|에는|과|와|을|를|은|는|이|가|에|의|도|로|만|나|랑|요)$/;
export function keywords(texts, top = 12) {
  const cnt = new Map();
  for (const t of texts) {
    const seen = new Set();
    for (let w of t.split(/[^0-9A-Za-z가-힣]+/)) {
      if (!w) continue;
      if (/[가-힣]/.test(w) && w.length > 2) w = w.replace(JOSA, '');
      w = w.replace(/(합니다|했습니다|입니다|습니다|해요|어요|아요|었다|였다|하다|했다|한다|하는|해서|하기|되어|되었|되면)$/, '');
      if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue;
      const key = /[A-Za-z]/.test(w) ? w.toUpperCase() : w;
      if (seen.has(key)) continue; // 한 응답에서 같은 낱말은 한 번만
      seen.add(key);
      cnt.set(key, (cnt.get(key) || 0) + 1);
    }
  }
  return [...cnt.entries()].filter((e) => e[1] >= 2 || texts.length < 5).sort((a, b) => b[1] - a[1]).slice(0, top);
}
