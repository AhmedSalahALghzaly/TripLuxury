/**
 * Production server for the Expo web build.
 *
 * Serves the output of `expo export --platform web` (the dist/ directory).
 * All unknown paths fall back to index.html so Expo Router's client-side
 * navigation works correctly (SPA routing).
 *
 * Zero external dependencies — uses only Node.js built-ins.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const DIST_ROOT = path.resolve(__dirname, "..", "dist");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");
const port = parseInt(process.env.PORT || "3000", 10);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ts": "video/mp2t",
  ".m3u8": "application/vnd.apple.mpegurl",
};

if (!fs.existsSync(DIST_ROOT)) {
  console.error(`ERROR: dist/ folder not found at ${DIST_ROOT}`);
  console.error("Run the build step first: pnpm --filter @workspace/mobile run build");
  process.exit(1);
}

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  // HTML files: no cache (they reference hashed JS/CSS bundles)
  // Everything else: long-lived immutable cache (content-hashed filenames)
  const isHtml = ext === ".html";
  const cacheControl = isHtml
    ? "no-cache, no-store, must-revalidate"
    : "public, max-age=31536000, immutable";

  res.writeHead(200, {
    "content-type": contentType,
    "cache-control": cacheControl,
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = url.pathname;

  // Strip BASE_PATH prefix so the rest of the logic uses root-relative paths
  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  // Sanitize to prevent path traversal
  const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(DIST_ROOT, safePath);

  // Enforce we stay within dist/
  if (!filePath.startsWith(DIST_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // 1. Exact file match
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return serveFile(filePath, res);
  }

  // 2. Append .html (static-site style)
  if (fs.existsSync(filePath + ".html")) {
    return serveFile(filePath + ".html", res);
  }

  // 3. Directory index
  const indexPath = path.join(filePath, "index.html");
  if (fs.existsSync(indexPath)) {
    return serveFile(indexPath, res);
  }

  // 4. SPA fallback — hand all unknown paths to Expo Router's client-side router
  const rootIndex = path.join(DIST_ROOT, "index.html");
  if (fs.existsSync(rootIndex)) {
    return serveFile(rootIndex, res);
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not Found");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Serving Expo web app on port ${port}`);
  console.log(`Serving from: ${DIST_ROOT}`);
});
