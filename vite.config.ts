import { defineConfig } from 'vite';
const proxy = { '/api': process.env.ASKI_API_URL || 'http://127.0.0.1:4181' };
export default defineConfig({ worker: { format: 'es' }, server: { host: '127.0.0.1', proxy }, preview: { proxy } });
