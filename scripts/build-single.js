#!/usr/bin/env node
/* Gera dist/FinanceReal.html: o app inteiro num único arquivo (fontes, CSS, React e scripts embutidos).
 * Útil para abrir offline sem servidor. Sem service worker/instalação (isso exige http/https). */
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
let html = read("index.html");

// CSS com fontes em base64
let css = read("css/app.css").replace(/url\(\.\.\/(fonts\/[^)]+)\)/g, (_, f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(root, f)).toString("base64")})`);
html = html.replace(/<link rel="stylesheet" href="css\/app.css"\/>/, () => `<style>${css}</style>`);
const icon = "data:image/svg+xml;base64," + fs.readFileSync(path.join(root, "icons/icon.svg")).toString("base64");
html = html.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="${icon}"/>`)
           .replace(/<link rel="apple-touch-icon"[^>]*>\n?/, "")
           .replace(/<link rel="manifest"[^>]*>\n?/, "");
// scripts embutidos (escapa </script>)
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => `<script>\n${read(src).replace(/<\/script/gi, "<\\/script")}\n</script>`);
// CSP: scripts inline necessários no arquivo único
html = html.replace("script-src 'self' https://accounts.google.com", "script-src 'unsafe-inline' https://accounts.google.com");
html = html.replace("font-src 'self'", "font-src data:").replace("img-src 'self' data:", "img-src data:");
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist/FinanceReal.html"), html);
console.log(`dist/FinanceReal.html (${(html.length / 1024).toFixed(0)} KB)`);
