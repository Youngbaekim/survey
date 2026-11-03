import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// GitHub Pages 주소: https://youngbaekim.github.io/survey/
// 세 쪽: index.html(관리) · s.html(교육생 응답) · r.html(교육생용 전체 결과)
const page = (f) => fileURLToPath(new URL(`./${f}`, import.meta.url));
export default defineConfig({
  base: '/survey/',
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: page('index.html'), s: page('s.html'), r: page('r.html') } },
  },
});
