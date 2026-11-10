const test = require("node:test");
const assert = require("node:assert");
const Drive = require("../js/drive.js");

function mockFetch(handler) {
  const calls = [];
  global.fetch = async (url, opts = {}) => { calls.push({ url, opts }); return handler(url, opts, calls.length); };
  return calls;
}
const json = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });

test("escopo é só appdata (não enxerga o resto do Drive)", () => {
  assert.strictEqual(Drive.SCOPE, "https://www.googleapis.com/auth/drive.appdata");
});

test("uploadBackup: multipart na appDataFolder com Bearer", async () => {
  const calls = mockFetch(() => json({ id: "1", name: "x" }));
  await Drive.uploadBackup("TOK", "FinanceRealBackup_1.json", '{"a":1}');
  const c = calls[0];
  assert.match(c.url, /upload\/drive\/v3\/files\?uploadType=multipart/);
  assert.strictEqual(c.opts.headers.Authorization, "Bearer TOK");
  assert.match(c.opts.headers["Content-Type"], /^multipart\/related; boundary=/);
  assert.match(c.opts.body, /"parents":\["appDataFolder"\]/);
  assert.match(c.opts.body, /\{"a":1\}/);
});

test("listBackups: consulta a appDataFolder e devolve a lista", async () => {
  const calls = mockFetch(() => json({ files: [{ id: "a" }, { id: "b" }] }));
  const files = await Drive.listBackups("T");
  assert.deepStrictEqual(files.map(f => f.id), ["a", "b"]);
  assert.match(calls[0].url, /spaces=appDataFolder/);
});

test("401 vira erro com code=401 (o app pede novo login)", async () => {
  mockFetch(() => json({}, 401));
  await assert.rejects(Drive.listBackups("T"), e => e.code === 401);
});

test("erro HTTP traz o status", async () => {
  mockFetch(() => json({ error: "x" }, 500));
  await assert.rejects(Drive.listBackups("T"), e => e.code === 500 && /HTTP 500/.test(e.message));
});

test("pruneOld apaga só os mais antigos além do limite", async () => {
  const deleted = [];
  mockFetch((url, opts) => {
    if (opts.method === "DELETE") { deleted.push(decodeURIComponent(url.split("/files/")[1])); return json({}); }
    return json({ files: [{ id: "n1" }, { id: "n2" }, { id: "n3" }, { id: "o1" }, { id: "o2" }] });
  });
  await Drive.pruneOld("T", 3);
  assert.deepStrictEqual(deleted, ["o1", "o2"]);
});

test("ids são escapados na URL", async () => {
  const calls = mockFetch(() => ({ ok: true, status: 200, text: async () => "{}" }));
  await Drive.downloadBackup("T", "a/b?c");
  assert.match(calls[0].url, /files\/a%2Fb%3Fc\?alt=media/);
});
