/*!
 * Finance Real — núcleo de regras (lógica pura, sem DOM).
 * Funciona no navegador (window.FRCore) e no Node (require), o que permite testar tudo com `npm test`.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FRCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ───────────── números e datas ───────────── */
  const pad2 = (n) => String(n).padStart(2, "0");

  /** Arredonda para centavos sem o erro clássico de ponto flutuante (1.005 → 1.01). */
  const round2 = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    const r = Math.round((Math.abs(v) + Number.EPSILON) * 100) / 100;
    return v < 0 ? -r : r;
  };

  const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayISO = (now) => isoOf(now || new Date());

  /** Lê "AAAA-MM-DD" e rejeita datas inexistentes (ex.: 2026-02-31). */
  function parseISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof iso === "string" ? iso : "");
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { y, m: mo, d };
  }
  const isValidISO = (s) => parseISO(s) !== null;
  const isValidYM = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(typeof s === "string" ? s : "");

  const dayNum = (iso) => { const p = parseISO(iso); return p ? Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000) : NaN; };
  const fromDayNum = (n) => { const d = new Date(n * 86400000); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
  /** a − b em dias inteiros (NaN se alguma data for inválida). */
  const daysDiff = (a, b) => dayNum(a) - dayNum(b);
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  /** Soma meses a um "AAAA-MM". */
  function addMonthsYM(ym, n) {
    const [y, m] = ym.split("-").map(Number);
    const t = y * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${pad2((t % 12) + 1)}`;
  }

  /** Soma meses a uma data preservando o dia (31/01 + 1 mês = 28/02 ou 29/02). */
  function addCalendarMonths(iso, n) {
    const p = parseISO(iso);
    if (!p) return iso;
    const ym = addMonthsYM(`${p.y}-${pad2(p.m)}`, n);
    const [y, m] = ym.split("-").map(Number);
    return `${ym}-${pad2(Math.min(p.d, daysInMonth(y, m)))}`;
  }

  /** Divide `total` em `n` parcelas somando exatamente `total` (sobra de centavos vai para as primeiras). */
  function splitInstallments(total, n) {
    const cents = Math.round(Math.abs(Number(total) || 0) * 100);
    const count = Math.max(1, Math.floor(n) || 1);
    const base = Math.floor(cents / count);
    const extra = cents - base * count;
    return Array.from({ length: count }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
  }

  /* ───────────── lançamentos e saldos ───────────── */
  const TX_TYPES = ["income", "expense", "transfer_in", "transfer_out"];
  const STATUSES = ["paid", "pending"];
  const RECURRENCES = ["weekly", "monthly", "yearly"];
  const ACC_TYPES = ["checking", "savings", "credit", "wallet"];
  const CAT_TX_TYPES = ["both", "income", "expense"];

  const isTransfer = (t) => t.type === "transfer_in" || t.type === "transfer_out";
  const signedAmount = (t) =>
    t.type === "income" || t.type === "transfer_in" ? t.amount :
    t.type === "expense" || t.type === "transfer_out" ? -t.amount : 0;

  /** Saldo de cada conta = saldo base + lançamentos pagos. */
  function accountBalances(accs, txs) {
    const delta = Object.create(null);
    for (const t of txs) if (t.status === "paid" && t.accountId) delta[t.accountId] = (delta[t.accountId] || 0) + signedAmount(t);
    const out = {};
    for (const a of accs) out[a.id] = round2((Number(a.openingBalance) || 0) + (delta[a.id] || 0));
    return out;
  }

  /* ───────────── recorrência ───────────── */
  /** Data "âncora" da série: vencimento enquanto pendente, data do pagamento depois de pago. */
  const anchorOf = (t) => (t.status === "pending" && isValidISO(t.dueDate) ? t.dueDate : t.date);
  const matchKey = (t) => [t.type, t.accountId || "", String(t.desc || "").trim().toLowerCase(), t.cat || ""].join("|");
  const seriesKey = (t) => matchKey(t) + "|" + (t.recurrence || "");

  /** Datas (dentro de `ym`) em que a série cuja origem é `t` voltaria a ocorrer. */
  function occurrencesInMonth(t, ym) {
    const a = parseISO(anchorOf(t));
    const [y, m] = ym.split("-").map(Number);
    if (!a) return [];
    const dim = daysInMonth(y, m);
    if (t.recurrence === "monthly") {
      return `${a.y}-${pad2(a.m)}` < ym ? [`${ym}-${pad2(Math.min(a.d, dim))}`] : [];
    }
    if (t.recurrence === "yearly") {
      return a.y < y && a.m === m ? [`${ym}-${pad2(Math.min(a.d, dim))}`] : [];
    }
    if (t.recurrence === "weekly") {
      const origin = dayNum(anchorOf(t));
      const start = dayNum(`${ym}-01`);
      const end = start + dim - 1;
      const out = [];
      for (let k = Math.max(1, Math.ceil((start - origin) / 7)); origin + 7 * k <= end; k++) out.push(fromDayNum(origin + 7 * k));
      return out;
    }
    return [];
  }

  /**
   * Ocorrências projetadas das séries recorrentes para o mês `ym`.
   * - Para cada série usa a origem mais recente anterior ao mês (evita somar o mesmo aluguel várias vezes).
   * - Se já existe um lançamento real equivalente no mês, a projeção cede lugar a ele.
   */
  function projectMonth(txs, ym) {
    const monthStart = `${ym}-01`;
    const heads = new Map();
    const realCount = new Map();
    for (const t of txs) {
      if (isTransfer(t) || typeof t.date !== "string") continue;
      if (t.date.startsWith(ym)) realCount.set(matchKey(t), (realCount.get(matchKey(t)) || 0) + 1);
      if (!t.recurrent || !RECURRENCES.includes(t.recurrence)) continue;
      const a = anchorOf(t);
      if (!isValidISO(a) || a >= monthStart) continue;
      const k = seriesKey(t);
      const cur = heads.get(k);
      if (!cur || a > anchorOf(cur)) heads.set(k, t);
    }
    const out = [];
    for (const t of heads.values()) {
      const skip = realCount.get(matchKey(t)) || 0;
      for (const date of occurrencesInMonth(t, ym).slice(skip)) {
        out.push({ ...t, id: `proj_${t.id}_${date}`, date, dueDate: date, status: "pending", _isProjection: true, _originId: t.id });
      }
    }
    return out;
  }

  /** Próxima ocorrência (pendente) de um lançamento recorrente que acabou de ser pago. */
  function nextOccurrence(t) {
    const a = anchorOf({ ...t, status: "pending" });
    if (!isValidISO(a)) return null;
    const date =
      t.recurrence === "weekly" ? fromDayNum(dayNum(a) + 7) :
      t.recurrence === "yearly" ? addCalendarMonths(a, 12) :
      t.recurrence === "monthly" ? addCalendarMonths(a, 1) : null;
    return date ? { date, dueDate: date } : null;
  }

  /* ───────────── resumos mensais e projeção ───────────── */
  /**
   * Receitas/despesas do mês (sem transferências).
   * Meses passados/atual: só o que foi pago. Meses futuros: lançamentos reais (qualquer status) + projeções.
   */
  function monthSummary(txs, ym, todayYM) {
    const future = ym > todayYM;
    let income = 0, expense = 0;
    const add = (t) => { if (t.type === "income") income += t.amount; else if (t.type === "expense") expense += t.amount; };
    for (const t of txs) {
      if (isTransfer(t) || typeof t.date !== "string" || !t.date.startsWith(ym)) continue;
      if (future || t.status === "paid") add(t);
    }
    if (future) for (const p of projectMonth(txs, ym)) add(p);
    income = round2(income); expense = round2(expense);
    return { income, expense, net: round2(income - expense), future };
  }

  /**
   * Cartão de projeção de um mês futuro: saldo do mês, acumulado do ano e patrimônio projetado.
   * Patrimônio projetado = patrimônio atual + pendências em aberto + resultado projetado dos meses seguintes.
   */
  function projectionCard(txs, accs, balances, ym, todayYM) {
    const included = new Set(accs.filter((a) => a.includeInTotal !== false).map((a) => a.id));
    const own = txs.filter((t) => included.has(t.accountId));
    const totAssets = round2([...included].reduce((s, id) => s + (balances[id] || 0), 0));

    const month = monthSummary(txs, ym, todayYM);

    let open = 0;
    for (const t of own) {
      if (t.status !== "pending" || typeof t.date !== "string" || t.date.slice(0, 7) > todayYM) continue;
      const due = isValidYM((t.dueDate || "").slice(0, 7)) ? t.dueDate : t.date;
      if (due.slice(0, 7) <= ym) open += signedAmount(t);
    }

    let netFromNow = 0, guard = 0;
    for (let m = addMonthsYM(todayYM, 1); m <= ym && guard < 1200; m = addMonthsYM(m, 1), guard++) netFromNow += monthSummary(own, m, todayYM).net;

    let cumIncome = 0, cumExpense = 0;
    for (let m = `${ym.slice(0, 4)}-01`; m <= ym; m = addMonthsYM(m, 1)) {
      const s = monthSummary(txs, m, todayYM);
      cumIncome += s.income; cumExpense += s.expense;
    }

    const [ty, tm] = todayYM.split("-").map(Number);
    const [yy, mm] = ym.split("-").map(Number);
    return {
      projIncome: month.income,
      projExpense: month.expense,
      projNet: month.net,
      cumIncome: round2(cumIncome),
      cumExpense: round2(cumExpense),
      openNet: round2(open),
      projAssets: round2(totAssets + open + netFromNow),
      totAssets,
      savingsRate: month.income > 0 ? Math.round(((month.income - month.expense) / month.income) * 100) : 0,
      monthsAhead: (yy - ty) * 12 + (mm - tm),
    };
  }

  /* ───────────── validação de dados importados ───────────── */
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

  function sanitizeAccount(a) {
    if (!a || typeof a !== "object" || typeof a.id !== "string" || !a.id || typeof a.name !== "string") return null;
    const opening = Number.isFinite(Number(a.openingBalance)) && a.openingBalance !== "" && a.openingBalance !== null
      ? Number(a.openingBalance) : (Number(a.balance) || 0);
    return {
      id: a.id.slice(0, 64),
      name: str(a.name, 60) || "Conta",
      type: ACC_TYPES.includes(a.type) ? a.type : "checking",
      icon: str(a.icon, 8) || "🏦",
      color: HEX.test(a.color) ? a.color : "#6366F1",
      openingBalance: round2(opening),
      includeInTotal: a.includeInTotal !== false,
    };
  }

  function sanitizeTx(t) {
    if (!t || typeof t !== "object" || typeof t.id !== "string" || !t.id) return null;
    const amount = Number(t.amount);
    if (!Number.isFinite(amount) || amount < 0 || !TX_TYPES.includes(t.type) || !isValidISO(t.date)) return null;
    const out = {
      id: t.id.slice(0, 64),
      desc: str(t.desc, 120),
      amount: round2(amount),
      type: t.type,
      cat: str(t.cat, 64) || "other",
      date: t.date,
      dueDate: isValidISO(t.dueDate) ? t.dueDate : t.date,
      status: STATUSES.includes(t.status) ? t.status : "paid",
      accountId: typeof t.accountId === "string" && t.accountId ? t.accountId.slice(0, 64) : null,
      recurrent: !!t.recurrent && RECURRENCES.includes(t.recurrence),
    };
    if (out.recurrent) out.recurrence = t.recurrence;
    if (typeof t.transferPairId === "string" && t.transferPairId) out.transferPairId = t.transferPairId.slice(0, 64);
    if (typeof t.groupId === "string" && t.groupId) out.groupId = t.groupId.slice(0, 64);
    if (t.accountRemoved) {
      out.accountRemoved = true;
      out.accountNameSnapshot = str(t.accountNameSnapshot, 60);
      out.accountIconSnapshot = str(t.accountIconSnapshot, 8);
      out.accountColorSnapshot = HEX.test(t.accountColorSnapshot) ? t.accountColorSnapshot : "#64748B";
    }
    return out;
  }

  function sanitizeCategory(c) {
    if (!c || typeof c !== "object" || typeof c.id !== "string" || !c.id) return null;
    const label = typeof c.label === "string" ? c.label : (c.label && typeof c.label === "object" ? (c.label.pt || c.label.en || c.id) : c.id);
    return {
      id: c.id.slice(0, 64),
      icon: str(c.icon, 8) || "📦",
      color: HEX.test(c.color) ? c.color : "#F0A500",
      txType: CAT_TX_TYPES.includes(c.txType) ? c.txType : "both",
      label: str(label, 40) || c.id,
      builtin: false,
    };
  }

  function sanitizeBalanceHistory(h) {
    const out = {};
    if (h && typeof h === "object") {
      for (const [ym, v] of Object.entries(h)) {
        if (!isValidYM(ym) || !v || typeof v !== "object") continue;
        const manual = v.manual === null || v.manual === undefined ? null : Number(v.manual);
        out[ym] = v.adjusted && Number.isFinite(manual) ? { adjusted: true, manual: round2(manual) } : { adjusted: false, manual: null };
      }
    }
    return out;
  }

  /**
   * Valida e normaliza um arquivo de backup. Lança Error("invalid") se não for um backup reconhecível.
   * Lançamentos inválidos são descartados (e contados em `dropped`) em vez de contaminar os dados.
   */
  function sanitizeBackup(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.transactions) || !Array.isArray(data.accounts)) throw new Error("invalid");
    const accounts = data.accounts.map(sanitizeAccount).filter(Boolean);
    if (!accounts.length) throw new Error("invalid");
    const accIds = new Set(accounts.map((a) => a.id));
    const seen = new Set();
    const transactions = [];
    let dropped = 0;
    for (const raw of data.transactions) {
      const t = sanitizeTx(raw);
      if (!t || seen.has(t.id)) { dropped++; continue; }
      seen.add(t.id);
      if (t.accountId && !accIds.has(t.accountId)) {
        t.accountId = null; t.accountRemoved = true;
        t.accountNameSnapshot = t.accountNameSnapshot || "";
        t.accountIconSnapshot = t.accountIconSnapshot || "🗃️";
        t.accountColorSnapshot = t.accountColorSnapshot || "#64748B";
      }
      transactions.push(t);
    }
    const cats = [];
    const catSeen = new Set();
    for (const c of Array.isArray(data.customCategories) ? data.customCategories : []) {
      const s = sanitizeCategory(c);
      if (s && !catSeen.has(s.id)) { catSeen.add(s.id); cats.push(s); }
    }
    return { transactions, accounts, balanceHistory: sanitizeBalanceHistory(data.balanceHistory), customCategories: cats, dropped };
  }


  /* ───────────── backup automático ───────────── */
  /** Está na hora de enviar outro backup? `last` = ISO completo do último envio (ou null). */
  function backupDue(interval, last, now) {
    if (!["daily", "weekly", "monthly"].includes(interval)) return false;
    if (!last) return true;
    const lastDay = isoOf(new Date(last));
    const today = todayISO(now);
    if (Number.isNaN(dayNum(lastDay))) return true;
    if (interval === "daily") return daysDiff(today, lastDay) >= 1;
    if (interval === "weekly") return daysDiff(today, lastDay) >= 7;
    return addCalendarMonths(lastDay, 1) <= today;
  }

  /* ───────────── PIN (trava de tela) ───────────── */
  const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

  function weakHash(s) { // só para contextos sem crypto.subtle; melhor que texto puro, mas não é criptografia forte
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let r = 0; r < 5000; r++) for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
  }

  function randomHex(bytes) {
    const c = typeof crypto !== "undefined" ? crypto : null;
    const a = new Uint8Array(bytes);
    if (c && c.getRandomValues) c.getRandomValues(a); else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
    return toHex(a);
  }

  async function derive(pin, salt, mode) {
    const subtle = typeof crypto !== "undefined" && crypto.subtle;
    if (mode === "pbkdf2" && subtle) {
      const key = await subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
      const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 120000 }, key, 256);
      return toHex(bits);
    }
    return weakHash(salt + ":" + pin);
  }

  /** Gera o valor a guardar: "fr2$modo$sal$hash". */
  async function hashPin(pin) {
    const mode = typeof crypto !== "undefined" && crypto.subtle ? "pbkdf2" : "weak";
    const salt = randomHex(16);
    return `fr2$${mode}$${salt}$${await derive(String(pin), salt, mode)}`;
  }

  /** Confere o PIN. Aceita o formato antigo (4 dígitos em texto puro) e informa que precisa migrar. */
  async function verifyPin(pin, stored) {
    pin = String(pin);
    if (typeof stored !== "string" || !stored) return { ok: false, legacy: false };
    if (/^\d{4}$/.test(stored)) return { ok: pin === stored, legacy: true };
    const [tag, mode, salt, hash] = stored.split("$");
    if (tag !== "fr2" || !salt || !hash) return { ok: false, legacy: false };
    return { ok: (await derive(pin, salt, mode)) === hash, legacy: false };
  }

  /* ───────────── PIX (BR Code "copia e cola") ───────────── */
  const emv = (id, value) => { const s = String(value == null ? "" : value); return id + String(s.length).padStart(2, "0") + s; };

  function crc16(payload) {
    let crc = 0xffff;
    for (let i = 0; i < payload.length; i++) {
      crc ^= payload.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }

  /** O BR Code só aceita ASCII: remove acentos/emoji, que quebravam o tamanho dos campos e o CRC. */
  const pixText = (s, max, upper) => {
    let t = String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
    if (upper) t = t.toUpperCase();
    return t.slice(0, max);
  };

  function buildPixPayload({ key, name, city, amount, description, txid }) {
    const k = String(key || "").trim();
    if (!k) throw new Error("pix-key");
    const account = emv("00", "br.gov.bcb.pix") + emv("01", k) + (pixText(description, 40) ? emv("02", pixText(description, 40)) : "");
    const value = Number(amount);
    const payload =
      emv("00", "01") +
      emv("26", account) +
      emv("52", "0000") +
      emv("53", "986") +
      (Number.isFinite(value) && value > 0 ? emv("54", value.toFixed(2)) : "") +
      emv("58", "BR") +
      emv("59", pixText(name, 25, true) || "NAO INFORMADO") +
      emv("60", pixText(city, 15, true) || "BRASIL") +
      emv("62", emv("05", pixText(txid, 25).replace(/[^A-Za-z0-9]/g, "") || "***")) +
      "6304";
    return payload + crc16(payload);
  }

  return {
    pad2, round2, isoOf, todayISO, parseISO, isValidISO, isValidYM, dayNum, fromDayNum, daysDiff, daysInMonth,
    addMonthsYM, addCalendarMonths, splitInstallments,
    TX_TYPES, STATUSES, RECURRENCES, ACC_TYPES, isTransfer, signedAmount, accountBalances,
    anchorOf, matchKey, seriesKey, occurrencesInMonth, projectMonth, nextOccurrence,
    monthSummary, projectionCard,
    sanitizeAccount, sanitizeTx, sanitizeCategory, sanitizeBalanceHistory, sanitizeBackup,
    hashPin, verifyPin, backupDue,
    crc16, buildPixPayload,
  };
});
