// web/server.js
// 零依赖 Node.js 静态服务，用于在浏览器中运行红娘排盘前端与历法引擎 ESM

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const WEB_DIR = __dirname;
const ENGINE_DIR = path.join(PROJECT_ROOT, 'engine');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveFilePath(reqUrl) {
  const urlObj = new URL(reqUrl, 'http://localhost');
  let pathname = decodeURIComponent(urlObj.pathname);

  if (pathname === '/' || pathname === '/index.html') {
    return path.join(WEB_DIR, 'index.html');
  }

  // 路由映射：/engine/ -> engine/ 目录；其余优先 web/ 目录
  if (pathname.startsWith('/engine/')) {
    const rel = pathname.slice('/engine/'.length);
    return path.join(ENGINE_DIR, rel);
  }

  if (pathname.startsWith('/prototype/')) {
    const rel = pathname.slice('/prototype/'.length);
    return path.join(PROJECT_ROOT, 'prototype', rel);
  }

  // 默认在 web 目录找
  const localInWeb = path.join(WEB_DIR, pathname.startsWith('/') ? pathname.slice(1) : pathname);
  if (fs.existsSync(localInWeb)) {
    return localInWeb;
  }

  // 这里曾经兜底去项目根目录找文件，等于把 docs/ 整个开放给 HTTP
  // （docs/reviews/ 里是对抗审查与对外话术红线）。已删除：只服务 web/、engine/、prototype/。
  return localInWeb;
}

function serveStatic(req, res) {
  const filePath = resolveFilePath(req.url);

  // Markdown 一律不服务：目录里的 .md 全是内部交接文档（回执、审查、话术红线），
  // 页面本身一个也用不到。按类拒绝，避免以后新增文档又漏出去。
  if (path.extname(filePath).toLowerCase() === '.md') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  // 安全检查：防止目录遍历
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PROJECT_ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Access denied');
    return;
  }

  fs.stat(normalized, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 Not Found: ${req.url}`);
      return;
    }

    const ext = path.extname(normalized).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });

    fs.createReadStream(normalized).pipe(res);
  });
}

function tryListen(port, attemptsLeft = 10) {
  const srv = http.createServer(serveStatic);

  srv.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`端口 ${port} 被占用，尝试端口 ${port + 1}...`);
      tryListen(port + 1, attemptsLeft - 1);
    } else {
      console.error('服务器启动失败:', err);
    }
  });

  srv.listen(port, () => {
    console.log('====================================================');
    console.log(' 红娘八字排盘 · 朱砂卷宗 (B档试用 MVP)');
    console.log(` 本地运行地址: http://localhost:${port}`);
    console.log(' 历法引擎与城市数据已就绪，按 Ctrl+C 可停止服务');
    console.log('====================================================');
  });
}

const defaultPort = Number(process.env.PORT) || 5173;
tryListen(defaultPort);
