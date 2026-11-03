// 통계 함수 — 대응표본 t검정, Wilcoxon 부호순위 검정, 효과크기(Cohen's dz)
// 외부 라이브러리 없이 계산 (scipy 결과와 대조 검증)

export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

export function sd(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

// ── 감마·베타 함수 (Numerical Recipes 방식) ──
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp0 = x + 5.5;
  const tmp = tmp0 - (x + 0.5) * Math.log(tmp0);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a, b, x) {
  const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** 정규화 불완전 베타 함수 I_x(a,b) */
export function ibeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** t분포 양측 유의확률 */
export const tTwoSided = (t, df) => ibeta(df / (df + t * t), df / 2, 0.5);

/** 표준정규 누적분포 (erfc 고정밀 근사) */
export function normCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const erfc = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return z >= 0 ? 1 - erfc / 2 : erfc / 2;
}

/** 대응표본 t검정 + 효과크기 dz (차이 = 사후 − 사전) */
export function pairedT(pre, post) {
  const d = post.map((v, i) => v - pre[i]);
  const n = d.length;
  const md = mean(d), sdd = sd(d);
  const out = { n, pre: mean(pre), post: mean(post), diff: md, sdDiff: sdd, t: NaN, df: n - 1, p: NaN, dz: NaN };
  if (n < 2) return out;
  if (sdd === 0) {
    out.dz = md === 0 ? 0 : NaN;
    out.p = md === 0 ? 1 : 0;
    out.t = md === 0 ? 0 : Infinity * Math.sign(md);
    return out;
  }
  out.t = md / (sdd / Math.sqrt(n));
  out.p = tTwoSided(out.t, n - 1);
  out.dz = md / sdd;
  return out;
}

/** 순위 (동점은 평균 순위) */
function rank(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  const ties = [];
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    if (j > i) ties.push(j - i + 1);
    i = j + 1;
  }
  return { r, ties };
}

/**
 * Wilcoxon 부호순위 검정 (차이 0 제외)
 * - n ≤ 50: 정확 분포(동점은 평균 순위 기준 부호 뒤집기 분포)
 * - n > 50: 정규 근사(동점 보정, 연속성 보정 없음) — scipy.stats.wilcoxon 기본값과 동일
 */
export function wilcoxon(pre, post) {
  const d = post.map((v, i) => v - pre[i]).filter((x) => Math.abs(x) > 1e-12);
  const n = d.length;
  if (n === 0) return { n: 0, W: 0, p: 1, z: 0, r: 0, method: '차이 없음' };
  const { r, ties } = rank(d.map(Math.abs));
  let wPlus = 0, wMinus = 0;
  d.forEach((x, i) => (x > 0 ? (wPlus += r[i]) : (wMinus += r[i])));
  const W = Math.min(wPlus, wMinus);
  const mu = (n * (n + 1)) / 4;
  const varW = (n * (n + 1) * (2 * n + 1)) / 24 - ties.reduce((s, t) => s + t ** 3 - t, 0) / 48;
  const z = varW > 0 ? (wPlus - mu) / Math.sqrt(varW) : 0;
  let p, method;
  if (n <= 50) {
    // 순위를 2배 해 정수로 만든 뒤 부호 뒤집기 분포를 정확히 계산 (동점이 있어도 조건부 정확 검정)
    const r2 = r.map((x) => Math.round(x * 2));
    const max = r2.reduce((s, x) => s + x, 0);
    const cnt = new Float64Array(max + 1);
    cnt[0] = 1;
    for (const k of r2) for (let s = max; s >= k; s--) cnt[s] += cnt[s - k];
    const total = 2 ** n;
    const w2 = Math.round(W * 2);
    let cum = 0;
    for (let s = 0; s <= w2; s++) cum += cnt[s];
    p = Math.min(1, (2 * cum) / total);
    method = '정확 검정';
  } else {
    p = varW > 0 ? 2 * (1 - normCdf(Math.abs(z))) : 1;
    method = '정규 근사';
  }
  return { n, W, wPlus, wMinus, p, z, r: Math.abs(z) / Math.sqrt(n), method };
}

/** 효과크기 해석 (Cohen, 1988 기준) */
export function effectLabel(d) {
  const a = Math.abs(d);
  if (!Number.isFinite(a)) return '-';
  if (a < 0.2) return '미미';
  if (a < 0.5) return '작음';
  if (a < 0.8) return '중간';
  return '큼';
}

export function fmtP(p) {
  if (!Number.isFinite(p)) return '-';
  if (p < 0.001) return 'p < .001';
  return 'p = ' + p.toFixed(3).replace(/^0/, '');
}
