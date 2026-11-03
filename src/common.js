// 공통: 척도 정의, 예시 문항, 매칭 코드, 문항 편집 형식, 작은 도우미

export const SCALES = {
  L5: { name: '5점 리커트', min: 1, max: 5, step: 1, labels: ['전혀 그렇지 않다', '그렇지 않다', '보통이다', '그렇다', '매우 그렇다'] },
  L7: { name: '7점 리커트', min: 1, max: 7, step: 1, labels: ['전혀 그렇지 않다', '', '', '보통이다', '', '', '매우 그렇다'] },
  P100: { name: '0~100점(10점 단위)', min: 0, max: 100, step: 10, labels: ['전혀 할 수 없다', '', '', '', '', '어느 정도 할 수 있다', '', '', '', '', '확실히 할 수 있다'] },
};
export const SAT_SCALE = SCALES.L5; // 만족도는 항상 5점

export const scaleValues = (s) => {
  const out = [];
  for (let v = s.min; v <= s.max; v += s.step) out.push(v);
  return out;
};

// 예시 문항 세트 — 자체 작성 예시(타당화된 척도 아님). 교육 성격에 맞게 고쳐 쓰는 것을 전제로 함
export const TEMPLATES = [
  {
    id: 'general',
    name: '교육 효능감(일반) — 예시 5문항',
    items: [
      '이 교육에서 다룬 내용을 다른 사람에게 설명할 수 있다.',
      '이 교육에서 배운 내용을 내 업무에 적용할 수 있다.',
      '관련 과제가 주어지면 스스로 해결할 수 있다.',
      '예상하지 못한 문제가 생겨도 배운 내용을 활용해 대처할 수 있다.',
      '이 주제와 관련된 일을 맡는 것에 자신이 있다.',
    ],
  },
  {
    id: 'ai',
    name: 'AI 활용 효능감 — 예시 6문항(3개 요인)',
    items: [
      '이해 | 생성형 AI가 답을 만들어 내는 기본 원리를 설명할 수 있다.',
      '이해 | 생성형 AI 결과물의 한계와 오류 가능성을 판단할 수 있다.',
      '활용 | 원하는 결과를 얻도록 AI에 지시문(프롬프트)을 작성할 수 있다.',
      '활용 | AI를 활용해 내 업무의 시간을 줄일 수 있다.',
      '윤리 | AI 활용 시 개인정보·저작권 문제를 구분해 대응할 수 있다.',
      '윤리 | AI 결과물을 검증한 뒤 책임 있게 사용할 수 있다.',
    ],
  },
  {
    id: 'teaching',
    name: '교수 효능감 — 예시 6문항(3개 요인)',
    items: [
      '수업설계 | 학습목표에 맞게 수업 활동을 설계할 수 있다.',
      '수업설계 | 학생 수준에 맞게 수업 자료를 조정할 수 있다.',
      '학생참여 | 학생들이 수업에 적극적으로 참여하도록 이끌 수 있다.',
      '학생참여 | 수업 중 학생의 질문과 반응에 효과적으로 대응할 수 있다.',
      '평가 | 학습목표 달성 여부를 확인할 수 있는 평가를 설계할 수 있다.',
      '평가 | 평가 결과를 바탕으로 수업을 개선할 수 있다.',
    ],
  },
];

export const DEFAULT_SAT = [
  '교육 내용 전반에 만족한다.',
  '강사의 설명이 이해하기 쉬웠다.',
  '교육 시간과 구성이 적절했다.',
  '다른 사람에게 이 교육을 추천하겠다.',
];
export const DEFAULT_OPEN_PRE = ['이번 교육에서 가장 기대하는 점은 무엇입니까?'];
export const DEFAULT_OPEN_POST = [
  '가장 유익했던 내용은 무엇입니까?',
  '업무(현장)에 적용해 보고 싶은 것은 무엇입니까?',
  '개선이 필요한 점이 있다면 적어 주십시오.',
];

/** 문항 편집칸(한 줄에 한 문항, '요인 | 문항' 형식 허용) → 문항 배열 */
export function parseItems(text, prefix) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const m = line.match(/^(.{1,20}?)\s*\|\s*(.+)$/);
      return { id: `${prefix}${i + 1}`, factor: m ? m[1].trim() : '', text: (m ? m[2] : line).trim() };
    });
}

export const itemsToText = (items = []) => items.map((it) => (it.factor ? `${it.factor} | ${it.text}` : it.text)).join('\n');

/** 매칭 코드: 생일 월일 4자리 + 휴대폰 끝 2자리 = 6자리 숫자 */
export function validCode(code) {
  if (!/^\d{6}$/.test(code)) return false;
  const mm = +code.slice(0, 2), dd = +code.slice(2, 4);
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

/** 매칭 키 = SHA-256(교육ID|코드) 앞 20자 → 원래 코드는 저장하지 않음 */
export async function codeKey(sid, code) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${sid}|${code}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
export const fmtSigned = (x, d = 2) => (Number.isFinite(x) ? (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x).toFixed(d) : '-');
export const pct = (x) => (Number.isFinite(x) ? Math.round(x * 100) + '%' : '-');

export const PHASES = { ready: '준비', pre: '사전 설문 진행 중', post: '사후 설문 진행 중', closed: '마감' };

export function respondUrl(sid) {
  return new URL(`s.html?id=${encodeURIComponent(sid)}`, location.href.replace(/[^/]*$/, '')).href;
}
export function resultUrl(sid) {
  return new URL(`r.html?id=${encodeURIComponent(sid)}`, location.href.replace(/[^/]*$/, '')).href;
}
