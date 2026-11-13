import { defineConfig } from 'vite';
const proxy = { '/api': process.env.ASKI_API_URL || 'http://127.0.0.1:4181' };
// Two pages: the studio at / and the about page at /about/.
export default defineConfig({ worker: { format: 'es' }, server: { host: '127.0.0.1', proxy }, preview: { proxy },
  build: { rollupOptions: { input: { studio: 'index.html', about: 'about/index.html' } } } });
