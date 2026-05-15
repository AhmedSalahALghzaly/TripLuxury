/**
 * Development startup script for Al-Ghazaly Dining app.
 * Starts the API server and serves the Expo web app on port 5173.
 */
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// Allow self-signed certificates for Supabase pooler connections
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Load .env file
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
}
const MOBILE_DIR = path.join(ROOT, 'artifacts/mobile');
const API_SERVER_DIST = path.join(ROOT, 'artifacts/api-server/dist/index.mjs');
const MOBILE_DIST = path.join(MOBILE_DIR, 'dist');

const WEB_PORT = 5173;
const API_PORT = 8080;

// ─── MIME TYPES ──────────────────────────────────────────────────────────────
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.map':  'application/json',
  '.webp': 'image/webp',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.wav':  'audio/wav',
  '.ts':   'video/mp2t',
  '.m3u8': 'application/vnd.apple.mpegurl',
};

// ─── ENSURE MOBILE DIST EXISTS ───────────────────────────────────────────────
function ensureMobileDist() {
  if (fs.existsSync(path.join(MOBILE_DIST, 'index.html'))) {
    console.log('[web] Using existing Expo web build in mobile/dist');
    return true;
  }

  console.log('[web] Building Expo web app...');
  const pnpmPaths = ['/tmp/pnpm', `${process.env.HOME}/bin/pnpm`];
  let pnpmBin = null;
  for (const p of pnpmPaths) {
    if (fs.existsSync(p)) { pnpmBin = p; break; }
  }

  const expoLocal = path.join(MOBILE_DIR, 'node_modules/.bin/expo');
  if (fs.existsSync(expoLocal)) {
    const result = spawnSync(expoLocal, ['export', '--platform', 'web', '--output-dir', 'dist', '--clear'], {
      cwd: MOBILE_DIR,
      stdio: 'inherit',
      env: { ...process.env, EXPO_PUBLIC_DOMAIN: `localhost:${API_PORT}`, NODE_ENV: 'production' },
    });
    return result.status === 0;
  }

  if (pnpmBin) {
    const result = spawnSync(pnpmBin, ['--filter', '@workspace/mobile', 'run', 'build'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, EXPO_PUBLIC_DOMAIN: `localhost:${API_PORT}`, NODE_ENV: 'production' },
    });
    return result.status === 0;
  }

  console.error('[web] Cannot build Expo web: expo CLI not found');
  return false;
}

// ─── SERVE EXPO WEB APP ───────────────────────────────────────────────────────
function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const isHtml = ext === '.html';
  res.writeHead(200, {
    'content-type': contentType,
    'cache-control': isHtml ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000, immutable',
    'access-control-allow-origin': '*',
  });
  fs.createReadStream(filePath).pipe(res);
}

function startWebServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${WEB_PORT}`);
    const safePath = path.normalize(url.pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(MOBILE_DIST, safePath);

    if (!filePath.startsWith(MOBILE_DIST)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveFile(filePath, res);
    }
    if (fs.existsSync(filePath + '.html')) {
      return serveFile(filePath + '.html', res);
    }
    const indexPath = path.join(filePath, 'index.html');
    if (fs.existsSync(indexPath)) {
      return serveFile(indexPath, res);
    }
    const rootIndex = path.join(MOBILE_DIST, 'index.html');
    if (fs.existsSync(rootIndex)) {
      return serveFile(rootIndex, res);
    }
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not Found');
  });

  server.listen(WEB_PORT, '0.0.0.0', () => {
    console.log(`[web] Al-Ghazaly Dining app serving on http://localhost:${WEB_PORT}`);
  });
}

// ─── START API SERVER ─────────────────────────────────────────────────────────
function startApiServer() {
  if (!fs.existsSync(API_SERVER_DIST)) {
    console.log('[api] API server dist not found, building...');
    const result = spawnSync('node', [path.join(ROOT, 'artifacts/api-server/build.mjs')], {
      cwd: path.join(ROOT, 'artifacts/api-server'),
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      console.error('[api] Build failed');
      return;
    }
  }

  const env = {
    ...process.env,
    PORT: String(API_PORT),
    NODE_ENV: 'development',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
  };

  const apiProc = spawn('node', ['--enable-source-maps', API_SERVER_DIST], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });

  apiProc.on('exit', (code) => {
    console.log(`[api] Server exited with code ${code}`);
  });

  console.log(`[api] Starting API server on port ${API_PORT}...`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Starting Al-Ghazaly Dining development environment...\n');

  const hasWebBuild = ensureMobileDist();
  if (!hasWebBuild) {
    console.error('[fatal] Could not get Expo web build. Exiting.');
    process.exit(1);
  }

  startApiServer();
  startWebServer();
}

main().catch(console.error);
