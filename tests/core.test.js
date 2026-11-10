"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/core.js");

const tx = (o) => ({ id: "t" + Math.random().toString(36).slice(2, 8), desc: "x", amount: 10, type: "expense", cat: "bills", date: "2026-01-10", dueDate: "2026-01-10", status: "paid", accountId: "a1", recurrent: false, ...o });

test("round2 evita erro de ponto flutuante", () => {
  assert.equal(C.round2(1.005), 1.01);
  assert.equal(C.round2(0.1 + 0.2), 0.3);
  assert.equal(C.round2(-2.345), -2.35);
  assert.equal(C.round2("abc"), 0);
});

test("datas: validação, diferença e soma de meses", () => {
  assert.equal(C.isValidISO("2026-02-29"), false);
  assert.equal(C.isValidISO("2028-02-29"), true);
  assert.equal(C.isValidISO("2026-13-01"), false);
  assert.equal(C.daysDiff("2026-03-01", "2026-02-28"), 1);
  assert.equal(C.daysDiff("2026-11-10", "2026-11-10"), 0);
  assert.ok(Number.isNaN(C.daysDiff("lixo", "2026-01-01")));
  assert.equal(C.addCalendarMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(C.addCalendarMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(C.addCalendarMonths("2026-11-30", 3), "2027-02-28");
  assert.equal(C.addMonthsYM("2026-12", 1), "2027-01");
  assert.equal(C.addMonthsYM("2026-01", -1), "2025-12");
});

test("parcelas somam exatamente o total", () => {
  const p = C.splitInstallments(100, 3);
  assert.deepEqual(p, [33.34, 33.33, 33.33]);
  assert.equal(C.round2(p.reduce((a, b) => a + b, 0)), 100);
  assert.equal(C.round2(C.splitInstallments(99.99, 7).reduce((a, b) => a + b, 0)), 99.99);
  assert.deepEqual(C.splitInstallments(50, 1), [50]);
});

test("saldos: só lançamentos pagos contam; transferências movem entre contas", () => {
  const accs = [{ id: "a1", openingBalance: 100 }, { id: "a2", openingBalance: 0 }];
  const txs = [
    tx({ type: "income", amount: 50 }),
    tx({ type: "expense", amount: 20 }),
    tx({ type: "expense", amount: 999, status: "pending" }),
    tx({ type: "transfer_out", amount: 30, accountId: "a1" }),
    tx({ type: "transfer_in", amount: 30, accountId: "a2" }),
  ];
  assert.deepEqual(C.accountBalances(accs, txs), { a1: 100, a2: 30 });
});

test("recorrência mensal: dia 31 vira último dia do mês curto (antes gerava data inválida)", () => {
  const t = tx({ recurrent: true, recurrence: "monthly", date: "2026-01-31", dueDate: "2026-01-31" });
  assert.deepEqual(C.occurrencesInMonth(t, "2026-02"), ["2026-02-28"]);
  assert.deepEqual(C.occurrencesInMonth(t, "2026-03"), ["2026-03-31"]);
  assert.deepEqual(C.occurrencesInMonth(t, "2026-01"), []);
});

test("recorrência anual não duplica a própria origem (bug do original)", () => {
  const t = tx({ recurrent: true, recurrence: "yearly", date: "2027-03-15", dueDate: "2027-03-15" });
  assert.deepEqual(C.occurrencesInMonth(t, "2027-03"), []);
  assert.deepEqual(C.occurrencesInMonth(t, "2028-03"), ["2028-03-15"]);
  assert.deepEqual(C.occurrencesInMonth(t, "2028-04"), []);
});

test("recorrência semanal agora é projetada (antes era ignorada)", () => {
  const t = tx({ recurrent: true, recurrence: "weekly", date: "2026-11-02", dueDate: "2026-11-02" });
  assert.deepEqual(C.occurrencesInMonth(t, "2026-12"), ["2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28"]);
});

test("projeção não soma a mesma série marcada como recorrente em vários meses", () => {
  const txs = [
    tx({ desc: "Aluguel", amount: 1000, recurrent: true, recurrence: "monthly", date: "2026-08-05", dueDate: "2026-08-05" }),
    tx({ desc: "Aluguel", amount: 1000, recurrent: true, recurrence: "monthly", date: "2026-09-05", dueDate: "2026-09-05" }),
    tx({ desc: "Aluguel", amount: 1000, recurrent: true, recurrence: "monthly", date: "2026-10-05", dueDate: "2026-10-05" }),
  ];
  const p = C.projectMonth(txs, "2027-01");
  assert.equal(p.length, 1);
  assert.equal(p[0].date, "2027-01-05");
  assert.equal(C.monthSummary(txs, "2027-01", "2026-11").expense, 1000);
});

test("projeção cede lugar ao lançamento real do mesmo mês", () => {
  const txs = [
    tx({ desc: "Internet", amount: 100, recurrent: true, recurrence: "monthly", date: "2026-10-20", dueDate: "2026-10-20" }),
    tx({ desc: "Internet", amount: 110, recurrent: true, recurrence: "monthly", status: "pending", date: "2026-12-20", dueDate: "2026-12-20" }),
  ];
  assert.equal(C.projectMonth(txs, "2026-12").length, 0);
  assert.equal(C.monthSummary(txs, "2026-12", "2026-11").expense, 110);
  assert.equal(C.projectMonth(txs, "2027-01").length, 1);
});

test("mês futuro conta receita pendente e origem recorrente no próprio mês", () => {
  const txs = [
    tx({ type: "income", amount: 500, status: "pending", date: "2027-02-10", dueDate: "2027-02-10" }),
    tx({ amount: 40, recurrent: true, recurrence: "monthly", status: "pending", date: "2027-02-12", dueDate: "2027-02-12" }),
  ];
  const s = C.monthSummary(txs, "2027-02", "2026-11");
  assert.equal(s.income, 500);
  assert.equal(s.expense, 40);
});

test("próxima ocorrência após pagar", () => {
  assert.deepEqual(C.nextOccurrence(tx({ recurrence: "monthly", date: "2026-01-31", dueDate: "2026-01-31", status: "paid" })), { date: "2026-02-28", dueDate: "2026-02-28" });
  assert.deepEqual(C.nextOccurrence(tx({ recurrence: "weekly", date: "2026-11-09", dueDate: "2026-11-09" })), { date: "2026-11-16", dueDate: "2026-11-16" });
  assert.deepEqual(C.nextOccurrence(tx({ recurrence: "yearly", date: "2026-11-09", dueDate: "2026-11-09" })), { date: "2027-11-09", dueDate: "2027-11-09" });
});

test("projeção de patrimônio considera pendências abertas e contas fora do total", () => {
  const accs = [
    { id: "a1", openingBalance: 1000, includeInTotal: true },
    { id: "a2", openingBalance: 5000, includeInTotal: false },
  ];
  const txs = [
    tx({ type: "income", amount: 3000, recurrent: true, recurrence: "monthly", date: "2026-11-05", dueDate: "2026-11-05" }),
    tx({ amount: 500, status: "pending", date: "2026-11-01", dueDate: "2026-11-15" }),
    tx({ amount: 9999, recurrent: true, recurrence: "monthly", accountId: "a2", date: "2026-11-05", dueDate: "2026-11-05" }),
  ];
  const bal = C.accountBalances(accs, txs);
  const p = C.projectionCard(txs, accs, bal, "2027-01", "2026-11");
  // 1000 (hoje) + 3000 (ainda não paga é do mês atual: já paga) ... ver cálculo:
  // saldo a1 = 1000 + 3000 (paga) = 4000; pendência −500; dez e jan: +3000 cada
  assert.equal(p.totAssets, 4000);
  assert.equal(p.openNet, -500);
  assert.equal(p.projAssets, 4000 - 500 + 3000 * 2);
  assert.equal(p.monthsAhead, 2);
  assert.equal(p.projNet, 3000 - 9999); // o cartão do mês soma todas as contas
});

test("projeção por mais de 24 meses continua correta (o original cortava em 24)", () => {
  const accs = [{ id: "a1", openingBalance: 0, includeInTotal: true }];
  const txs = [tx({ type: "income", amount: 100, recurrent: true, recurrence: "monthly", date: "2026-11-05", dueDate: "2026-11-05" })];
  const bal = C.accountBalances(accs, txs);
  const p = C.projectionCard(txs, accs, bal, "2029-11", "2026-11");
  assert.equal(p.monthsAhead, 36);
  assert.equal(p.projAssets, 100 + 36 * 100);
});

test("sanitizeBackup converte textos em números e descarta lixo", () => {
  const r = C.sanitizeBackup({
    accounts: [{ id: "a1", name: "Nu", openingBalance: "150.5", color: "red" }, { id: 5 }],
    transactions: [
      { id: "1", desc: "ok", amount: "100", type: "expense", date: "2026-01-02", status: "paid", accountId: "a1" },
      { id: "2", desc: "dup", amount: 1, type: "expense", date: "2026-01-02", accountId: "a1" },
      { id: "2", desc: "dup", amount: 1, type: "expense", date: "2026-01-02", accountId: "a1" },
      { id: "3", amount: "abc", type: "expense", date: "2026-01-02" },
      { id: "4", amount: 5, type: "hack", date: "2026-01-02" },
      { id: "5", amount: 5, type: "income", date: "2026-02-31" },
      { id: "6", amount: 7, type: "income", date: "2026-03-01", accountId: "inexistente" },
    ],
    balanceHistory: { "2026-01": { adjusted: true, manual: "12" }, lixo: {} },
    customCategories: [{ id: "c1", label: "Pet", color: "zzz", txType: "x" }],
  });
  assert.equal(r.accounts.length, 1);
  assert.equal(r.accounts[0].openingBalance, 150.5);
  assert.equal(r.accounts[0].color, "#6366F1");
  assert.equal(typeof r.transactions[0].amount, "number");
  assert.equal(r.transactions.length, 3); // 1, 2, 6
  assert.equal(r.dropped, 4);
  assert.equal(r.transactions.find((t) => t.id === "6").accountRemoved, true);
  assert.deepEqual(r.balanceHistory, { "2026-01": { adjusted: true, manual: 12 } });
  assert.equal(r.customCategories[0].txType, "both");
});

test("sanitizeBackup rejeita o que não é backup", () => {
  assert.throws(() => C.sanitizeBackup(null), /invalid/);
  assert.throws(() => C.sanitizeBackup({ transactions: [], accounts: [] }), /invalid/);
  assert.throws(() => C.sanitizeBackup({ transactions: {}, accounts: [{ id: "a", name: "x" }] }), /invalid/);
});

test("PIN: hash com sal, verificação e migração do formato antigo", async () => {
  const h1 = await C.hashPin("1234");
  const h2 = await C.hashPin("1234");
  assert.match(h1, /^fr2\$pbkdf2\$/);
  assert.notEqual(h1, h2); // sal diferente
  assert.equal((await C.verifyPin("1234", h1)).ok, true);
  assert.equal((await C.verifyPin("1235", h1)).ok, false);
  assert.deepEqual(await C.verifyPin("4321", "4321"), { ok: true, legacy: true });
  assert.equal((await C.verifyPin("1111", "4321")).ok, false);
  assert.equal((await C.verifyPin("1111", "")).ok, false);
});

test("CRC16 confere com o vetor padrão CCITT-FALSE", () => {
  assert.equal(C.crc16("123456789"), "29B1");
});

test("PIX: payload ASCII, tamanhos coerentes e CRC válido", () => {
  const code = C.buildPixPayload({ key: "teste@exemplo.com", name: "José da Silva Çãõ", city: "São Paulo", amount: 5, description: "☕ Uma vez" });
  assert.ok(/^[\x20-\x7E]+$/.test(code), "somente ASCII");
  assert.ok(code.startsWith("000201"));
  assert.ok(code.includes("5303986"));
  assert.ok(code.includes("54045.00"));
  assert.ok(code.includes("5917JOSE DA SILVA CAO")); // acentos removidos, 17 caracteres
  const body = code.slice(0, -4);
  assert.equal(C.crc16(body), code.slice(-4));
  assert.throws(() => C.buildPixPayload({ key: "" }), /pix-key/);
});

/** Lê o BR Code como sequência TLV e confirma que cada tamanho declarado bate com o conteúdo. */
function parseTLV(s) {
  const out = {};
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    assert.ok(Number.isInteger(len), "tamanho numérico");
    const val = s.slice(i + 4, i + 4 + len);
    assert.equal(val.length, len, "campo " + id + " com tamanho correto");
    out[id] = val;
    i += 4 + len;
  }
  return out;
}

test("PIX: estrutura TLV íntegra, inclusive com acentos e emoji na descrição", () => {
  const code = C.buildPixPayload({ key: "+5521999999999", name: "Fulano", city: "Rio", amount: 12.5, description: "⭐ Apoiador Anual — ação" });
  const f = parseTLV(code);
  assert.equal(f["53"], "986");
  assert.equal(f["54"], "12.50");
  assert.equal(f["58"], "BR");
  assert.equal(f["59"], "FULANO");
  const acc = parseTLV(f["26"]);
  assert.equal(acc["00"], "br.gov.bcb.pix");
  assert.equal(acc["01"], "+5521999999999");
  assert.ok(/^[\x20-\x7E]*$/.test(acc["02"]));
});

test("backup automático: quando está vencido", () => {
  const now = new Date(2026, 10, 10, 12); // 10/nov/2026
  const iso = (y, m, d) => new Date(y, m - 1, d, 8).toISOString();
  assert.equal(C.backupDue("manual", null, now), false);
  assert.equal(C.backupDue("daily", null, now), true);
  assert.equal(C.backupDue("daily", iso(2026, 11, 10), now), false);
  assert.equal(C.backupDue("daily", iso(2026, 11, 9), now), true);
  assert.equal(C.backupDue("weekly", iso(2026, 11, 4), now), false);
  assert.equal(C.backupDue("weekly", iso(2026, 11, 3), now), true);
  assert.equal(C.backupDue("monthly", iso(2026, 10, 11), now), false);
  assert.equal(C.backupDue("monthly", iso(2026, 10, 10), now), true);
});
