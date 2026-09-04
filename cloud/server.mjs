// 自有服务器入口（香港轻量等）：发 dist/ 静态资源 + /api/*，
// 业务逻辑与 Cloudflare Worker 共用 cloud/src/api.mjs。
//
// 前面挂 Caddy 负责 HTTPS，本进程只听 127.0.0.1，不直接对公网。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './src/api.mjs';
import { openDatabase } from './src/d1-sqlite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const MIGRATIONS = path.join(ROOT, 'cloud', 'migrations');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'hongniang-bazi.sqlite');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const env = { DB: openDatabase(DB_PATH, MIGRATIONS) };

/** dist/ 之外一律不给，避免路径穿越 */
function resolveAsset(pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidate = path.normalize(path.join(DIST, rel));
  if (!candidate.startsWith(DIST)) return null;
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  return path.join(DIST, 'index.html'); // 与 Workers 的 SPA 回落一致
}

function serveAsset(req, pathname, res) {
  const file = resolveAsset(pathname);
  if (!file || !fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  // 文件名不带内容 hash，所以一律走协商缓存：每次带 If-Modified-Since 问一句，
  // 没变就 304（几十字节）。用 max-age 会让改版后老师拿到新 index.html 配旧 app.js，
  // 版本错配比多一次条件请求难查得多。
  const stat = fs.statSync(file);
  const lastModified = stat.mtime.toUTCString();
  const ext = path.extname(file).toLowerCase();

  if (req.headers['if-modified-since'] === lastModified) {
    res.writeHead(304, { 'cache-control': 'no-cache', 'last-modified': lastModified });
    res.end();
    return;
  }

  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-cache',
    'last-modified': lastModified,
    'content-length': stat.size,
  });
  fs.createReadStream(file).pipe(res);
}

/** node 的 req 转成 Web Request，好让 handleApi 原样复用 */
async function toWebRequest(req) {
  const url = `http://${req.headers.host || 'localhost'}${req.url}`;
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let body;
  if (hasBody) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }
  return new Request(url, { method: req.method, headers: req.headers, body });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (!pathname.startsWith('/api/')) {
      serveAsset(req, pathname, res);
      return;
    }

    const response = await handleApi(await toWebRequest(req), env);
    const text = await response.text();
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(text);
  } catch (err) {
    // 不静默：先留下上下文再回 500
    console.error(JSON.stringify({
      action: 'server', method: req.method, url: req.url,
      error: String(err && err.stack ? err.stack : err),
    }));
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({ code: 5000, data: null, message: '服务器开小差了，请稍后重试' }));
  }
});

server.listen(PORT, HOST, () => {
  console.log('====================================================');
  console.log(' 红娘八字排盘 · 自有服务器');
  console.log(` 监听 ${HOST}:${PORT}`);
  console.log(` 数据库 ${DB_PATH}`);
  console.log('====================================================');
});
