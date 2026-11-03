// Firebase 연결 — 관리자 로그인(Google)과 Firestore
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

/** 관리 화면 전용: Google 로그인 (응답 화면에는 로그인 모듈을 싣지 않음) */
export async function loadAuth() {
  const m = await import('firebase/auth');
  const auth = m.getAuth(app);
  auth.languageCode = 'ko';
  const provider = new m.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return {
    auth,
    watch: (cb) => m.onAuthStateChanged(auth, cb),
    signOut: () => m.signOut(auth),
    finishRedirect: () => m.getRedirectResult(auth).catch((e) => console.warn('[survey] 로그인 이동 결과', e)),
    async signIn() {
      try {
        await m.signInWithPopup(auth, provider);
      } catch (err) {
        const fallback = ['auth/popup-blocked', 'auth/operation-not-supported-in-environment', 'auth/web-storage-unsupported'];
        if (fallback.includes(err.code)) return m.signInWithRedirect(auth, provider);
        if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
        throw err;
      }
    },
  };
}
