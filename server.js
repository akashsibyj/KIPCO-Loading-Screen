// server.js
// Local web server for the KIPCO loading screen.
// Run with:  npm start   →   http://localhost:3000
// No dependencies: uses only Node's built-in modules, so `npm install` is optional.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const START_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT_TRIES = 10;

// Only these paths are served. Everything else (server.js, package.json, …) is hidden.
const ALLOWED = [/^\/index\.html$/, /^\/src\/[\w.-]+$/, /^\/assets\/[\w.-]+$/];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers) {
  if (res.headersSent) return res.end();
  res.writeHead(status, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers));
  res.end(body);
}

function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    }

    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return send(res, 400, 'Bad request');
    }
    if (urlPath === '/') urlPath = '/index.html';
    if (urlPath === '/favicon.ico') return send(res, 204, '');

    if (!ALLOWED.some((re) => re.test(urlPath))) return send(res, 404, 'Not found');

    const filePath = path.join(ROOT, urlPath);
    if (!filePath.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) return send(res, 404, 'Not found');

      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') return res.end();

      const stream = fs.createReadStream(filePath);
      stream.on('error', (streamErr) => {
        console.error('Error reading', urlPath, streamErr.message);
        res.destroy();
      });
      stream.pipe(res);
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    send(res, 500, 'Internal server error');
  }
}

function start(port, triesLeft) {
  const server = http.createServer(handler);

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) {
      console.log(`Port ${port} is busy, trying ${port + 1}…`);
      return start(port + 1, triesLeft - 1);
    }
    console.error(`Could not start the server: ${err.message}`);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log('');
    console.log('  KIPCO loading screen is running');
    console.log(`  Open  http://localhost:${port}`);
    console.log('  Press Ctrl+C to stop.');
    console.log('');

    const stop = () => {
      server.close(() => process.exit(0));
      if (server.closeAllConnections) server.closeAllConnections(); // don't wait for idle browser connections
      setTimeout(() => process.exit(0), 1000).unref();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

process.on('uncaughtException', (err) => console.error('Uncaught error:', err));

start(START_PORT, MAX_PORT_TRIES);
