"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { I18N, DEFAULT_CATS, TIPS, CURRENCIES, LANGS } = require("../js/i18n.js");

const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");

test("todos os idiomas têm exatamente as mesmas chaves", () => {
  const base = Object.keys(I18N.pt).sort();
  for (const l of LANGS) assert.deepEqual(Object.keys(I18N[l]).sort(), base, `idioma ${l}`);
});

test("placeholders {n}/{name}… são iguais em todos os idiomas", () => {
  for (const k of Object.keys(I18N.pt)) for (const l of LANGS) assert.equal(placeholders(I18N[l][k]), placeholders(I18N.pt[k]), `${l}.${k}`);
});

test("nenhum texto vazio nem dado pessoal embutido", () => {
  for (const l of LANGS) for (const [k, v] of Object.entries(I18N[l])) {
    assert.equal(typeof v, "string", `${l}.${k}`);
    assert.ok(v.length > 0, `${l}.${k} vazio`);
    assert.ok(!/@(hotmail|gmail)\./i.test(v), `${l}.${k} contém e-mail`);
  }
});

test("categorias e dicas cobrem todos os idiomas", () => {
  for (const c of DEFAULT_CATS) for (const l of LANGS) assert.ok(c.label[l], `${c.id}.${l}`);
  for (const l of LANGS) assert.ok(TIPS[l] && TIPS[l].length >= 10);
  assert.ok(CURRENCIES.some((c) => c.id === "BRL"));
});
