import { createServer } from 'node:http';
import type { Hono } from 'hono';
import type { AccountEnv } from './account.ts';
export function accountServer(app: Hono<AccountEnv>, origin: string) {
  return createServer(async (req,res) => {
    try {
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) { size += chunk.length; if (size > 4096) { res.writeHead(413, { 'content-type':'application/json', 'cache-control':'no-store' }); res.end('{"message":"Request is too large."}'); return; } chunks.push(chunk); }
      const request = new Request(new URL(req.url || '/', origin), { method: req.method, headers: new Headers(Object.entries(req.headers).flatMap(([key,value]) => value === undefined ? [] : [[key,Array.isArray(value) ? value.join(',') : value]])), body: ['GET','HEAD'].includes(req.method || 'GET') ? undefined : Buffer.concat(chunks) });
      const response = await app.fetch(request, { peerIP: req.socket.remoteAddress || '' });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(503, { 'content-type':'application/json', 'cache-control':'no-store' }); res.end('{"message":"Sign-in is unavailable. Try again later."}'); }
  });
}
