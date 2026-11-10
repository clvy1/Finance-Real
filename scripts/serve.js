#!/usr/bin/env node
/* Servidor estático mínimo para testar localmente: `npm run serve` (porta 8080, ou PORT=xxxx). */
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const port = +process.env.PORT || 8080;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root) || /(^|[\\/])(\.git|node_modules|tests|scripts)([\\/]|$)/.test(path.relative(root, file))) { res.writeHead(404); return res.end("404"); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}).listen(port, () => console.log(`Finance Real em http://localhost:${port}/`));
