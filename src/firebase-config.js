// Firebase 웹 앱 설정값 (프로젝트: yb-survey)
// Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹) → 'SDK 설정 및 구성'의 값을 그대로 붙여넣으세요.
// 비밀번호가 아닌 프로젝트 식별 정보이므로 공개 저장소에 포함해도 됩니다.
// 데이터 보호는 Firestore 보안 규칙(firestore.rules)이 담당합니다.
export const firebaseConfig = {
  apiKey: 'AIzaSyC0gREqamXwyZDuFIX0go-EewsceObi5r8',
  authDomain: 'yb-survey.firebaseapp.com',
  projectId: 'yb-survey',
  storageBucket: 'yb-survey.firebasestorage.app',
  messagingSenderId: '515096608914',
  appId: '1:515096608914:web:3e1e9f79f6b65c580a264b',
};

export const CONFIGURED = !firebaseConfig.apiKey.startsWith('PASTE');
