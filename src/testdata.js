// 테스트용 가상 응답 생성 — 지금 교육의 문항 설정(척도·참여자 정보·기타 문항·만족도·주관식)에 맞춰 만듦
// 매칭키가 'test'로 시작 → 나중에 '테스트 응답 삭제'로 한꺼번에 지울 수 있음
import { SCALES, SAT_SCALE, scaleValues, isLikert, isEtc, optLabel } from './common.js';

export const TEST_PREFIX = 'test';
export const isTestKey = (k) => typeof k === 'string' && k.startsWith(TEST_PREFIX);

const rnd = Math.random;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const clamp = (v, s) => Math.max(s.min, Math.min(s.max, v));
const snap = (v, s) => clamp(Math.round(v / s.step) * s.step, s);
// 표준정규 난수 (Box–Muller)
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

const OPEN_POOL = [
  '실습 위주라 이해하기 쉬웠습니다', '예시가 많아 도움이 되었습니다', '업무에 바로 적용해 보고 싶습니다',
  '시간이 조금 부족했습니다', '자료를 미리 받을 수 있으면 좋겠습니다', '질의응답 시간이 유익했습니다',
  '심화 과정이 있으면 참여하고 싶습니다', '동료들과 함께 연습해 볼 계획입니다',
];
const TEXT_POOL = ['교육혁신팀', '학사팀', '교무처', '학생처', '기획조정실', '연구지원팀'];

function answerChoices(qs, likertBase = 3.6) {
  const out = {};
  for (const q of qs || []) {
    if (isLikert(q)) { out[q.id] = snap(likertBase + gauss() * 0.9, SAT_SCALE); continue; }
    if (!q.options?.length) continue;
    let sel;
    if (q.multi) {
      sel = q.options.filter(() => rnd() < 0.4);
      if (!sel.length) sel = [pick(q.options)];
    } else sel = [pick(q.options)];
    out[q.id] = q.multi ? sel.map(optLabel) : optLabel(sel[0]);
    if (sel.some(isEtc)) out[`${q.id}_etc`] = '테스트 직접입력';
  }
  return out;
}
const answerTexts = (qs, rate = 0.5) => Object.fromEntries((qs || []).filter(() => rnd() < rate).map((q) => [q.id, pick(TEXT_POOL)]));
const answerOpen = (qs, rate = 0.6) => Object.fromEntries((qs || []).filter(() => rnd() < rate).map((q) => [q.id, pick(OPEN_POOL)]));

/**
 * 가상 응답 n명 생성: 사전 n명, 사후는 약 90%(짝 맞춤) — 교육 후 평균이 오르도록 설정
 * 반환: { pre: [문서], post: [문서] }
 */
export function makeTestResponses(session, n) {
  const s = SCALES[session.scale] || SCALES.L5;
  const range = s.max - s.min;
  const items = session.items || [];
  const pre = [], post = [];
  for (let i = 0; i < n; i++) {
    const key = TEST_PREFIX + [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join(''); // 4+16=20자
    const ability = 0.35 + gauss() * 0.12; // 사전 수준(척도 대비 비율)
    const gain = 0.12 + gauss() * 0.08; // 교육 효과
    const effPre = {}, effPost = {}, retro = {};
    items.forEach((it) => {
      const p = s.min + range * (ability + gauss() * 0.08);
      effPre[it.id] = snap(p, s);
      effPost[it.id] = snap(p + range * (gain + gauss() * 0.06), s);
      retro[it.id] = snap(p - range * Math.abs(gauss() * 0.05), s);
    });
    const info = { ...answerChoices(session.infoChoice), ...answerTexts(session.infoText) };
    const ext = (ph) => Object.fromEntries((session.extra || []).filter((x) => x.when === ph || x.when === 'both')
      .map((x) => [x.id, { ...answerChoices(x.choice), ...answerTexts(x.text) }]));
    pre.push({ phase: 'pre', key, info, ext: ext('pre'), eff: effPre, retro: {}, sat: {}, open: answerOpen(session.openPre) });
    if (rnd() < 0.9) {
      post.push({
        phase: 'post', key, info: {}, ext: ext('post'), eff: effPost, retro: session.retro ? retro : {},
        sat: answerChoices(session.sat, 3.9), open: answerOpen(session.openPost),
      });
    }
  }
  return { pre, post };
}
