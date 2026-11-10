#!/usr/bin/env node
/* Verificações estáticas rápidas (rodam no CI): sintaxe, arquivos do shell, versão do SW, ausência de dados pessoais. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
let bad = 0;
const fail = m => { console.error("✗ " + m); bad++; };
const ok = m => console.log("✓ " + m);

for (const f of ["js/core.js", "js/i18n.js", "js/drive.js", "js/app.js", "sw.js", "config.js"]) {
  try { new vm.Script(read(f), { filename: f }); ok(`sintaxe ${f}`); } catch (e) { fail(`sintaxe ${f}: ${e.message}`); }
}
const pkg = JSON.parse(read("package.json"));
const sw = read("sw.js");
const m = sw.match(/const VERSION = "([^"]+)"/);
if (!m || m[1] !== pkg.version) fail(`sw.js VERSION (${m && m[1]}) difere do package.json (${pkg.version})`); else ok(`versão do SW = ${pkg.version}`);

const shell = JSON.parse("[" + sw.match(/const SHELL = \[([\s\S]*?)\];/)[1] + "]");
for (const f of shell) if (f !== "./" && !fs.existsSync(path.join(root, f))) fail(`SHELL referencia arquivo inexistente: ${f}`);
ok(`${shell.length} arquivos do shell conferidos`);

const html = read("index.html");
for (const [, src] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) if (!fs.existsSync(path.join(root, src))) fail(`index.html referencia ${src}`);
const man = JSON.parse(read("manifest.webmanifest"));
for (const i of man.icons) if (!fs.existsSync(path.join(root, i.src))) fail(`manifest referencia ${i.src}`);
if (/user-scalable=no|maximum-scale/.test(html)) fail("viewport bloqueia zoom (acessibilidade)");

const cfg = read("config.js");
if (/googleClientId:\s*"[^"]+"/.test(cfg) || /pixKey:\s*"[^"]+"/.test(cfg)) fail("config.js tem valores preenchidos — o repositório deve ir com os padrões vazios");
for (const f of ["js/app.js", "js/i18n.js", "config.js", "index.html", "README.md"]) {
  if (!fs.existsSync(path.join(root, f))) continue;
  if (/[\w.+-]+@(hotmail|gmail|outlook)\.[a-z.]+/i.test(read(f)) && f !== "README.md") fail(`possível e-mail pessoal em ${f}`);
}
console.log(bad ? `\n${bad} problema(s)` : "\nTudo certo.");
process.exit(bad ? 1 : 0);
