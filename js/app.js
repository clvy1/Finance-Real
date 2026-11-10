/*!
 * Finance Real — interface (React 18, sem etapa de build).
 * Regras puras: js/core.js · Textos: js/i18n.js · Google Drive: js/drive.js · Configuração: config.js
 */
"use strict";
const { useState, useEffect, useCallback, useRef, useMemo } = React;
const Core = window.FRCore;
const Drive = window.FRDrive;
const { I18N, CURRENCIES, TIPS, DEFAULT_CATS } = window.FRI18N;
const CFG = { googleClientId: "", donate: {}, ...(window.FR_CONFIG || {}) };
const DONATE = CFG.donate || {};
const round2 = Core.round2;
const LOCALES = { pt: "pt-BR", en: "en-US", es: "es-ES" };

/* ── Migração não destrutiva dos dados da versão simplificada (fr6_*), só quando não há dados fr4_* ── */
(function migrateFromSimplifiedVersion() {
    const mapping = { fr6_txs: "fr4_tx", fr6_accs: "fr4_accs", fr6_balH: "fr4_bh", fr6_bkp: "fr4_bkp", fr6_ucfg: "fr4_ucfg" };
    try {
        for (const [oldKey, newKey] of Object.entries(mapping)) {
            if (localStorage.getItem(newKey) !== null)
                continue;
            const raw = localStorage.getItem(oldKey);
            if (raw === null)
                continue;
            const data = JSON.parse(raw);
            if ((newKey === "fr4_tx" || newKey === "fr4_accs") && !Array.isArray(data))
                continue;
            if (newKey === "fr4_accs")
                localStorage.setItem(newKey, JSON.stringify(data.map(a => ({ ...a, openingBalance: typeof a.openingBalance === "number" ? a.openingBalance : (Number(a.balance) || 0) }))));
            else
                localStorage.setItem(newKey, JSON.stringify(data));
        }
    }
    catch (e) {
        console.warn("Migração de dados não concluída; dados originais preservados", e);
    }
})();

const getCatLabel = (cat, lang) => {
    if (!cat)
        return "";
    if (typeof cat.label === "object")
        return cat.label[lang] || cat.label.en || cat.id;
    return cat.label || cat.id;
};
const getCatById = (cats, id) => cats.find(c => c.id === id) || { id, icon: "📦", color: "#F0A500", label: { pt: id, en: id } };

/* ── Datas ─────────────────────────────────────────────── */
let TODAY = Core.todayISO();
let TODAY_YEAR = +TODAY.slice(0, 4);
/** Recalcula "hoje" (o app instalado pode ficar aberto por dias). Retorna true se o dia mudou. */
const refreshToday = () => { const t = Core.todayISO(); if (t === TODAY)
    return false; TODAY = t; TODAY_YEAR = +t.slice(0, 4); return true; };
const ddiff = d => Core.daysDiff(d, TODAY);
const monthName = (lang, m) => { const s = new Intl.DateTimeFormat(LOCALES[lang] || "pt-BR", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2020, m - 1, 1))).replace(/\.$/, ""); return s.charAt(0).toUpperCase() + s.slice(1); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fill = (s, vars) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);

const ACC_ICONS = ["🏦", "💳", "💎", "🐷", "💵", "🏧", "💼", "🌟"];
const ACC_COLORS = ["#820AD1", "#FF6B00", "#10B981", "#F59E0B", "#3B82F6", "#EF4444", "#8B5CF6", "#06B6D4"];
const CAT_PRESET_COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98FB98", "#87CEEB", "#A78BFA", "#F0A500", "#F87171", "#34D399", "#60A5FA", "#FBBF24", "#E879F9", "#2DD4BF"];
const CAT_PRESET_ICONS = ["🍔", "🚗", "💊", "🎮", "📄", "🛍️", "💰", "🔄", "🧮", "📦", "🏠", "✈️", "🎓", "💄", "🐾", "🎵", "⚽", "🍕", "☕", "🎁", "💻", "📱", "🌿", "🏋️"];
const BKP_IDS = ["manual", "daily", "weekly", "monthly"];
const BKP_LABELS = { pt: ["Apenas manual", "Diário", "Semanal", "Mensal"], en: ["Manual only", "Daily", "Weekly", "Monthly"], es: ["Solo manual", "Diario", "Semanal", "Mensual"] };

/** Primeiro uso: uma conta e nenhum lançamento (os dados de exemplo do original foram removidos). */
const INIT_ACCS = [
    { id: "acc1", name: "Carteira", type: "wallet", color: "#3B82F6", icon: "💵", openingBalance: 0, includeInTotal: true },
];
const INIT_TX = [];
const INIT_HIST = {};

function buildMonthsForYear(year) {
    const months = [];
    for (let m = 1; m <= 12; m++)
        months.push(`${year}-${String(m).padStart(2, "0")}`);
    return months;
}

/* ── Armazenamento local ───────────────────────────────── */
const quarantine = (key, items) => { if (!items.length) return; try {
    const k = "fr4_quarantine";
    const prev = JSON.parse(localStorage.getItem(k) || "[]");
    localStorage.setItem(k, JSON.stringify([...prev, ...items.map(raw => ({ key, raw, at: new Date().toISOString() }))].slice(-200)));
}
catch { } window.__frQuarantined = (window.__frQuarantined || 0) + items.length; };
const cleanList = (key, fn) => arr => { const ok = [], bad = []; arr.forEach(x => { const c = fn(x); c ? ok.push(c) : bad.push(x); }); quarantine(key, bad); return ok; };
const SCHEMA = {
    tx: { check: Array.isArray, clean: cleanList("tx", Core.sanitizeTx) },
    accs: { check: Array.isArray, clean: cleanList("accs", Core.sanitizeAccount) },
    cats: { check: Array.isArray, clean: cleanList("cats", c => Core.sanitizeCategory(c)) },
    bh: { check: v => v && typeof v === "object" && !Array.isArray(v), clean: Core.sanitizeBalanceHistory },
    bkp: { check: v => v && typeof v === "object" && !Array.isArray(v) },
    ucfg: { check: v => v && typeof v === "object" && !Array.isArray(v) },
};
function readLS(key, init) {
    const sc = SCHEMA[key] || {};
    try {
        const s = localStorage.getItem("fr4_" + key);
        if (s === null)
            return init;
        const v = JSON.parse(s);
        if (sc.check && !sc.check(v))
            return init;
        return sc.clean ? sc.clean(v) : v;
    }
    catch {
        return init;
    }
}
/** useState persistido em localStorage (gravação em efeito, sincronizada entre abas, erro de cota avisado). */
function useLS(key, init) {
    const [v, setV] = useState(() => readLS(key, init));
    const first = useRef(true);
    useEffect(() => {
        if (first.current) {
            first.current = false;
            return;
        }
        try {
            localStorage.setItem("fr4_" + key, JSON.stringify(v));
        }
        catch {
            window.dispatchEvent(new CustomEvent("fr-storage-error"));
        }
    }, [key, v]);
    useEffect(() => {
        const on = e => { if (e.key === "fr4_" + key && e.newValue !== null)
            setV(readLS(key, init)); };
        window.addEventListener("storage", on);
        return () => window.removeEventListener("storage", on);
    }, [key]);
    return [v, setV];
}
function ts() { const n = new Date(); return `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, "0")}${String(n.getDate()).padStart(2, "0")}_${String(n.getHours()).padStart(2, "0")}${String(n.getMinutes()).padStart(2, "0")}${String(n.getSeconds()).padStart(2, "0")}`; }
function downloadText(name, text, type = "application/json") { const b = new Blob([text], { type }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); }

/* ── Token do Google (dura ~1 h; fica só na sessão da aba) ── */
const readDriveToken = () => { try {
    const t = JSON.parse(sessionStorage.getItem("fr4_drive_token") || "null");
    return t && t.token && t.exp > Date.now() + 30000 ? t : null;
}
catch {
    return null;
} };
function loadGIS() { return new Promise((resolve, reject) => { if (window.google?.accounts?.oauth2)
    return resolve(); const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = () => resolve(); s.onerror = () => reject(new Error("Google Identity Services")); document.head.appendChild(s); }); }

/* ── Biometria (WebAuthn): confirma a identidade com o sensor do aparelho ── */
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const Bio = {
    supported: () => !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext),
    enrolled: () => !!localStorage.getItem("fr4_cred"),
    async register() {
        const cred = await navigator.credentials.create({ publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: "Finance Real" },
                user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "finance-real", displayName: "Finance Real" },
                pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
                authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
                timeout: 60000, attestation: "none"
            } });
        localStorage.setItem("fr4_cred", b64(cred.rawId));
    },
    async verify() {
        const id = localStorage.getItem("fr4_cred");
        if (!id)
            return false;
        await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: "public-key", id: unb64(id), transports: ["internal"] }], userVerification: "required", timeout: 60000 } });
        return true;
    },
    clear() { localStorage.removeItem("fr4_cred"); }
};

/* ── Proteção contra tela preta: qualquer erro de renderização cai aqui ── */
class ErrorBoundary extends React.Component {
    constructor(p) { super(p); this.state = { err: null }; }
    static getDerivedStateFromError(err) { return { err }; }
    componentDidCatch(err, info) { console.error("Finance Real:", err, info && info.componentStack); }
    render() {
        if (!this.state.err)
            return this.props.children;
        let lang = "pt";
        try {
            lang = JSON.parse(localStorage.getItem("fr4_ucfg")).lang;
        }
        catch { }
        const T = I18N[lang] || I18N.pt;
        const dump = () => { const o = {}; for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith("fr4_"))
                o[k] = localStorage.getItem(k);
        } downloadText(`FinanceReal_dados_brutos_${ts()}.json`, JSON.stringify(o, null, 2)); };
        const btn = { background: "linear-gradient(135deg,#6366F1,#4F46E5)", border: "none", color: "#fff", borderRadius: 13, padding: 13, fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" };
        return (React.createElement("div", { role: "alert", style: { minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 28, textAlign: "center", color: "#E8EDF5", background: "#080C18" } },
            React.createElement("div", { style: { fontSize: 42 } }, "⚠️"),
            React.createElement("h1", { style: { fontSize: 20 } }, T.errorTitle),
            React.createElement("p", { style: { fontSize: 13, color: "#94A3B8", maxWidth: 320, lineHeight: 1.6 } }, T.errorBody),
            React.createElement("button", { style: { ...btn, maxWidth: 320 }, onClick: () => location.reload() }, T.reload),
            React.createElement("button", { style: { ...btn, maxWidth: 320, background: "#111827", border: "1.5px solid #1F2D45", color: "#94A3B8" }, onClick: dump }, T.exportRaw)));
    }
}

/* ── COMPONENTES PEQUENOS ──────────────────────────────── */
/* ── SMALL COMPONENTS ─────────────────────────────────── */
function AppIcon({ size = 26 }) { return (React.createElement("svg", { width: size, height: size, viewBox: "0 0 48 48", fill: "none" },
    React.createElement("rect", { width: "48", height: "48", rx: "11", fill: "#080C18" }),
    React.createElement("text", { x: "24", y: "34", textAnchor: "middle", fontFamily: "Georgia,serif", fontSize: "30", fontWeight: "700", fill: "#6366F1" }, "$"),
    React.createElement("line", { x1: "24", y1: "8", x2: "24", y2: "13", stroke: "#6366F1", strokeWidth: "2.5", strokeLinecap: "round" }),
    React.createElement("line", { x1: "24", y1: "35", x2: "24", y2: "40", stroke: "#6366F1", strokeWidth: "2.5", strokeLinecap: "round" }))); }
function Toggle({ val, onChange, label }) { return (React.createElement("button", { type: "button", role: "switch", "aria-checked": !!val, "aria-label": label || undefined, onClick: () => onChange(!val), style: { width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", background: val ? "#6366F1" : "#1F2D45", position: "relative", transition: "background .25s", flexShrink: 0 } },
    React.createElement("div", { style: { position: "absolute", top: 3, left: val ? 22 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .25s", boxShadow: "0 1px 4px #0005" } }))); }
function Overlay({ children, onClose, label }) {
    const ref = useRef(null);
    useEffect(() => { const prev = document.activeElement; ref.current?.focus(); const onKey = e => { if (e.key === "Escape")
        onClose(); }; document.addEventListener("keydown", onKey); return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); }; }, []);
    return (React.createElement("div", { onClick: e => { if (e.target === e.currentTarget)
            onClose(); }, style: { position: "fixed", inset: 0, background: "#000C", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" } },
        React.createElement("div", { ref, role: "dialog", "aria-modal": "true", "aria-label": label || undefined, tabIndex: -1, style: { background: "#0D1526", borderRadius: "24px 24px 0 0", padding: "20px 17px 44px", width: "100%", maxWidth: 430, border: "1px solid #1A2640", maxHeight: "92dvh", overflowY: "auto", animation: "su .35s cubic-bezier(.22,1,.36,1)", outline: "none" } }, children)));
}
function MH({ title, onClose, badge, closeLabel }) { return (React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } },
    React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
        React.createElement("h3", { style: { fontSize: 17, fontWeight: 800, color: "#E8EDF5" } }, title),
        badge && React.createElement("span", { style: { fontSize: 10, fontWeight: 800, background: "#EC489920", color: "#EC4899", border: "1px solid #EC489940", borderRadius: 20, padding: "2px 8px" } }, badge)),
    React.createElement("button", { type: "button", "aria-label": closeLabel || "Close", onClick: onClose, style: { background: "#111827", border: "1px solid #1F2D45", color: "#94A3B8", width: 32, height: 32, borderRadius: 10, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 } }, "\u2715"))); }
function Row({ label, val, border = true }) { return (React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: border ? "1px solid #111827" : "none" } },
    React.createElement("span", { style: { fontSize: 11, color: "#64748B", fontWeight: 700 } }, label),
    React.createElement("span", { style: { fontSize: 13, fontWeight: 600 } }, val))); }
function SettingRow({ icon, label, note, right }) { return (React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "center", padding: "11px 0", borderBottom: "1px solid #0D1526" } },
    React.createElement("span", { style: { fontSize: 20, width: 28, textAlign: "center", flexShrink: 0 } }, icon),
    React.createElement("div", { style: { flex: 1 } },
        React.createElement("p", { style: { fontSize: 13, fontWeight: 600, color: "#E8EDF5" } }, label),
        note && React.createElement("p", { style: { fontSize: 10, color: "#475569", marginTop: 1 } }, note)),
    right)); }
function Section({ title, color, items, accs, onPay, T, fmtC, cats, lang }) {
    return (React.createElement("div", { style: { marginBottom: 16 } },
        React.createElement("p", { style: { fontSize: 11, fontWeight: 800, color, letterSpacing: .8, marginBottom: 8 } }, title),
        items.map(t => { const cat = getCatById(cats, t.cat); const acc = (accs.find(a => a.id === t.accountId) || (t?.accountNameSnapshot ? { name: t.accountNameSnapshot, icon: t.accountIconSnapshot || "🗃️", color: t.accountColorSnapshot || "#64748B" } : null)); const d = ddiff(t.dueDate); const dayStr = d < 0 ? T.daysAgo.replace("{n}", Math.abs(d)) : d === 0 ? T.today : T.inDays.replace("{n}", d); return (React.createElement("div", { key: t.id, style: { background: color + "0F", border: `1px solid ${color}30`, borderRadius: 16, padding: 12, marginBottom: 7, display: "flex", gap: 10, alignItems: "center" } },
            React.createElement("div", { style: { width: 40, height: 40, borderRadius: 12, background: cat.color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 } }, cat.icon),
            React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                React.createElement("p", { style: { fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t.desc),
                React.createElement("p", { style: { fontSize: 10, color, fontWeight: 600, marginTop: 2 } },
                    dayStr,
                    acc ? ` · ${acc.icon} ${acc.name}` : "")),
            React.createElement("div", { style: { textAlign: "right", flexShrink: 0 } },
                React.createElement("p", { style: { fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 700, color } }, fmtC(t.amount)),
                React.createElement("button", { onClick: () => onPay(t.id), style: { background: color + "25", border: `1px solid ${color}50`, color, borderRadius: 8, padding: "3px 8px", fontSize: 9, cursor: "pointer", fontWeight: 800, marginTop: 3 } }, T.payBtn)))); })));
}
function PinLock({ T, onUnlock, bio, onBio }) {
    const [pin, setPin] = useState("");
    const [err, setErr] = useState(false);
    const [wait, setWait] = useState(0);
    const busy = useRef(false);
    const failKey = "fr4_pin_fail";
    const readFail = () => { try {
        return JSON.parse(localStorage.getItem(failKey) || "{}");
    }
    catch {
        return {};
    } };
    useEffect(() => { const tick = () => { const left = Math.ceil(((readFail().until || 0) - Date.now()) / 1000); setWait(left > 0 ? left : 0); }; tick(); const i = setInterval(tick, 500); return () => clearInterval(i); }, []);
    useEffect(() => { if (bio)
        onBio(); }, []);
    const submit = async (n) => {
        busy.current = true;
        const r = await Core.verifyPin(n, localStorage.getItem("fr4_pin") || "");
        if (r.ok) {
            localStorage.removeItem(failKey);
            if (r.legacy) {
                try {
                    localStorage.setItem("fr4_pin", await Core.hashPin(n));
                }
                catch { }
            }
            busy.current = false;
            onUnlock();
            return;
        }
        const count = (readFail().count || 0) + 1;
        const until = count % 5 === 0 ? Date.now() + Math.min(30 * Math.pow(2, count / 5 - 1), 900) * 1000 : 0;
        try {
            localStorage.setItem(failKey, JSON.stringify({ count, until }));
        }
        catch { }
        setErr(true);
        setTimeout(() => { setPin(""); setErr(false); busy.current = false; }, 700);
    };
    const tap = d => { if (busy.current || wait > 0 || pin.length >= 4)
        return; const n = pin + d; setPin(n); setErr(false); if (n.length === 4)
        submit(n); };
    const del = () => { if (!busy.current)
        setPin(p => p.slice(0, -1)); };
    return (React.createElement("div", { style: { position: "fixed", inset: 0, background: "#080C18", zIndex: 500, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 } },
        React.createElement(AppIcon, { size: 52 }),
        React.createElement("p", { style: { fontSize: 20, fontWeight: 800, color: "#E8EDF5" } }, "Finance Real"),
        React.createElement("p", { role: "status", style: { fontSize: 13, color: wait > 0 ? "#F59E0B" : "#94A3B8", minHeight: 18 } }, wait > 0 ? fill(T.pinTooMany, { n: wait }) : T.pinUnlock),
        React.createElement("div", { style: { display: "flex", gap: 14 } }, [0, 1, 2, 3].map(i => (React.createElement("div", { key: i, style: { width: 16, height: 16, borderRadius: "50%", background: pin.length > i ? (err ? "#EF4444" : "#6366F1") : "#1F2D45", transition: "background .2s" } })))),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(3,72px)", gap: 12 } }, [1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map((d, i) => (React.createElement("button", { key: i, type: "button", "aria-label": d === "⌫" ? "Backspace" : undefined, disabled: d === "", onClick: () => d === "" ? null : d === "⌫" ? del() : tap(String(d)), style: { width: 72, height: 72, borderRadius: 18, fontSize: 22, fontWeight: 700, background: d === "" ? "transparent" : "#111827", border: d === "" ? "none" : "1px solid #1F2D45", color: d === "⌫" ? "#EF4444" : "#E8EDF5", cursor: d === "" ? "default" : "pointer" } }, d)))),
        bio && React.createElement("button", { type: "button", className: "btn2", onClick: onBio }, T.bioUse)));
}
function TipOverlay({ T, lang, onClose }) {
    const tips = TIPS[lang] || TIPS.pt;
    const tip = useMemo(() => tips[Math.floor(Math.random() * tips.length)], []);
    return (React.createElement("div", { role: "dialog", "aria-modal": "true", style: { position: "fixed", inset: 0, background: "#000C", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 } },
        React.createElement("div", { style: { background: "#0D1526", border: "1px solid #6366F140", borderRadius: 24, padding: 28, maxWidth: 380, width: "100%", animation: "su .4s cubic-bezier(.22,1,.36,1)" } },
            React.createElement("p", { style: { fontSize: 13, fontWeight: 800, color: "#6366F1", letterSpacing: .8, marginBottom: 12 } }, T.tipOf),
            React.createElement("p", { style: { fontSize: 16, fontWeight: 600, color: "#E8EDF5", lineHeight: 1.6, marginBottom: 22 } }, tip),
            React.createElement("button", { onClick: onClose, style: { width: "100%", background: "linear-gradient(135deg,#6366F1,#4F46E5)", border: "none", color: "#fff", borderRadius: 14, padding: "13px", fontSize: 14, fontWeight: 700, cursor: "pointer" } }, T.ok + " \uD83D\uDC4D"))));
}
/* ══════════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════════ */
function App() {
    const [txs, setTxs] = useLS("tx", INIT_TX);
    const [accs, setAccs] = useLS("accs", INIT_ACCS);
    const [balH, setBalH] = useLS("bh", INIT_HIST);
    const [bkpCfg, setBkp] = useLS("bkp", { interval: "manual", lastBackup: null, driveConnected: false });
    const [userCfg, setUser] = useLS("ucfg", { lang: "pt", currency: "BRL", pinEnabled: false, biometric: false, tipsEnabled: true, supporter: false });
    const [customCats, setCustomCats] = useLS("cats", []);
    const [tab, setTab] = useState("home");
    const [modal, setModal] = useState(null);
    const [toast, setToast] = useState(null);
    const [selMon, setSelMon] = useState(TODAY.slice(0, 7));
    const [selYear, setSelYear] = useState(TODAY_YEAR);
    const [fAcc, setFAcc] = useState("all");
    const [fStatus, setFStatus] = useState("all");
    const [detTx, setDetTx] = useState(null);
    const [showHist, setShowHist] = useState(false);
    const [editBM, setEditBM] = useState(null);
    const [tmpBal, setTmpBal] = useState("");
    const [editAccId, setEditAccId] = useState(null);
    const [accRealBal, setAccRealBal] = useState("");
    const [accEditName, setAccEditName] = useState("");
    const [accEditType, setAccEditType] = useState("checking");
    const [accEditIcon, setAccEditIcon] = useState("🏦");
    const [accEditIncluded, setAccEditIncluded] = useState(true);
    const [accAdjNote, setAccAdjNote] = useState("");
    const [accDeleteFutureMode, setAccDeleteFutureMode] = useState("transfer");
    const [accDeleteTargetId, setAccDeleteTargetId] = useState("");
    const [accDeleteBalanceMode, setAccDeleteBalanceMode] = useState("transfer");
    const [accDeleteBalanceTargetId, setAccDeleteBalanceTargetId] = useState("");
    const [deferPmt, setDeferPmt] = useState(null);
    const [locked, setLocked] = useState(() => userCfg.pinEnabled && !!localStorage.getItem("fr4_pin"));
    const [showPin, setShowPin] = useState(false);
    const [pinStep, setPinStep] = useState(1);
    const [pin1, setPin1] = useState("");
    const [pin2, setPin2] = useState("");
    const [showTip, setShowTip] = useState(false);
    const [restoreConfirm, setRestoreConfirm] = useState(null);
    const [pixModal, setPixModal] = useState(null);
    const [supMode, setSupMode] = useState("once");
    const [supAmt, setSupAmt] = useState(3);          // valor da contribuição única, em dólar
    const [supOther, setSupOther] = useState(false);
    const [editId, setEditId] = useState(null);
    const [delTarget, setDelTarget] = useState(null);
    const [driveTok, setDriveTok] = useState(readDriveToken);
    const [driveBusy, setDriveBusy] = useState(false);
    const [driveFiles, setDriveFiles] = useState(null);
    const [, bumpDay] = useState(0);
    const driveWaitRef = useRef(null);
    const toastTimer = useRef(null);
    // Sync selYear when selMon changes to a different year
    useEffect(() => {
        const y = parseInt(selMon.slice(0, 4));
        if (!isNaN(y) && y !== selYear)
            setSelYear(y);
    }, [selMon]);
    const goYear = d => { const y = selYear + d; setSelYear(y); setSelMon(`${y}-${selMon.slice(5, 7)}`); };
    useEffect(() => { document.documentElement.lang = LOCALES[userCfg.lang] || "pt-BR"; }, [userCfg.lang]);
    useEffect(() => { const on = () => { if (document.visibilityState === "visible" && refreshToday())
        bumpDay(n => n + 1); }; document.addEventListener("visibilitychange", on); return () => document.removeEventListener("visibilitychange", on); }, []);
    useEffect(() => { const on = () => toast_(T.storageFull, "#EF4444"); window.addEventListener("fr-storage-error", on); return () => window.removeEventListener("fr-storage-error", on); }, [userCfg.lang]);
    useEffect(() => { const on = e => toast_(e.detail.msg, e.detail.color); window.addEventListener("fr-toast", on); return () => window.removeEventListener("fr-toast", on); }, []);
    useEffect(() => { if (window.__frQuarantined)
        toast_(fill(T.restoreDropped, { n: window.__frQuarantined }), "#F59E0B"); }, []);
    const [catEditId, setCatEditId] = useState(null);
    const [catForm, setCatForm] = useState({ name: "", icon: "📦", color: "#F0A500", txType: "both" });
    const [catEditName, setCatEditName] = useState("");
    // Transfer form state
    const [trForm, setTrForm] = useState({ desc: "", amount: "", fromAccountId: "", toAccountId: "", date: TODAY, status: "paid" });
    const fileRef = useRef(null);
    const tokenClientRef = useRef(null);
    const T = I18N[userCfg.lang] || I18N.pt;
    const CURR = CURRENCIES.find(c => c.id === userCfg.currency) || CURRENCIES[0];
    const XT = T; // as chaves antigas "EXTRA" foram unificadas em T
    // Merged categories: defaults + custom
    const allCats = useMemo(() => [...DEFAULT_CATS, ...(customCats || [])], [customCats]);
    const accBalanceById = useMemo(() => Core.accountBalances(accs || [], txs || []), [accs, txs]);
    const getAccBal = useCallback(id => accBalanceById[id] ?? 0, [accBalanceById]);
    const typeLabel = useCallback(type => { if (type === "checking")
        return T.checking; if (type === "savings")
        return T.savings; if (type === "credit")
        return T.credit; return XT.wallet; }, [T, XT]);
    const getTxAccountMeta = useCallback(t => { const acc = (accs || []).find(a => a.id === t.accountId); if (acc)
        return { name: acc.name, icon: acc.icon, color: acc.color }; if (t?.accountNameSnapshot || t?.accountRemoved)
        return { name: t.accountNameSnapshot || XT.removedAccountLabel, icon: t.accountIconSnapshot || "🗃️", color: t.accountColorSnapshot || "#64748B", removed: true }; return null; }, [accs, XT]);
    const driveClientConfigured = !!CFG.googleClientId;
    const fmtC = useCallback((n) => { try {
        const locale = LOCALES[userCfg.lang] || "pt-BR";
        n = Number(n) || 0;
        return n.toLocaleString(locale, { style: "currency", currency: userCfg.currency });
    }
    catch {
        return CURR.symbol + " " + Math.abs(n).toFixed(2);
    } }, [userCfg.lang, userCfg.currency]);
    const fmtDate = useCallback(iso => { const p = Core.parseISO(iso); return p ? new Date(p.y, p.m - 1, p.d, 12).toLocaleDateString(LOCALES[userCfg.lang] || "pt-BR") : ""; }, [userCfg.lang]);
    const driveOn = !!driveTok && driveTok.exp > Date.now();
    useEffect(() => { const h = e => { e.preventDefault(); setDeferPmt(e); }; window.addEventListener("beforeinstallprompt", h); return () => window.removeEventListener("beforeinstallprompt", h); }, []);
    useEffect(() => { if (userCfg.tipsEnabled && !locked)
        setShowTip(true); }, []);
    const currentYM = TODAY.slice(0, 7);
    const mTxs = txs.filter(t => t.date.startsWith(selMon));
    const income = mTxs.filter(t => t.type === "income" && t.status === "paid").reduce((a, t) => a + t.amount, 0);
    const expenses = mTxs.filter(t => t.type === "expense" && t.status === "paid").reduce((a, t) => a + t.amount, 0);
    const pending = txs.filter(t => t.status === "pending" && t.type === "expense");
    const totPend = pending.reduce((a, t) => a + t.amount, 0);
    const mPendTot = mTxs.filter(t => t.status === "pending" && t.type === "expense").reduce((a, t) => a + t.amount, 0); // só o mês selecionado
    const overdue = pending.filter(t => ddiff(t.dueDate) < 0);
    const dueSoon = pending.filter(t => { const d = ddiff(t.dueDate); return d >= 0 && d <= 3; });
    const totAssets = accs.filter(a => a.includeInTotal).reduce((s, a) => s + getAccBal(a.id), 0);
    // ── Projeção: toda a regra vive em js/core.js (testada); aqui só consumimos ──
    const MONTHS_BASE = useMemo(() => Array.from({ length: 12 }, (_, i) => monthName(userCfg.lang, i + 1)), [userCfg.lang]);
    const projCard = useMemo(() => selMon > currentYM ? Core.projectionCard(txs, accs, accBalanceById, selMon, currentYM) : null, [txs, accs, accBalanceById, selMon, currentYM]);
    /** Saldo do mês: ajuste manual, se houver; senão realizado (passado/atual) ou projetado (futuro). */
    const getMonBal = ym => { const hh = balH[ym]; if (hh?.adjusted && hh?.manual !== null)
        return hh.manual; return Core.monthSummary(txs, ym, currentYM).net; };
    const ALL_MONTHS = useMemo(() => buildMonthsForYear(selYear), [selYear]);
    const histMons = ALL_MONTHS.map(ym => ({
        ym,
        label: MONTHS_BASE[parseInt(ym.split("-")[1]) - 1] + "/" + ym.slice(2, 4),
        balance: getMonBal(ym),
        adjusted: balH[ym]?.adjusted,
        isFuture: ym > currentYM,
    }));
    const toast_ = useCallback((msg, color = "#10B981") => { setToast({ msg, color }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 2800); }, []);
    const switchTab = useCallback((next) => { setModal(null); setTab(next); requestAnimationFrame(() => { try {
        document.querySelector(".scr")?.scrollTo({ top: 0, behavior: "instant" });
    }
    catch { } ; window.scrollTo?.(0, 0); }); }, []);
    const buildBackupPayload = useCallback(() => ({ transactions: txs, accounts: accs, balanceHistory: balH, userConfig: userCfg, customCategories: customCats, backupMeta: { exportedAt: new Date().toISOString(), version: "5.0", app: "Finance Real" } }), [txs, accs, balH, userCfg, customCats]);
    const makeBackupFileName = useCallback(() => `FinanceRealBackup_${ts()}.json`, []);
    const doBackupDownload = () => { downloadText(makeBackupFileName(), JSON.stringify(buildBackupPayload(), null, 2)); setBkp(p => ({ ...p, lastBackup: new Date().toISOString() })); toast_(T.backupOk, "#3B82F6"); };
    /** Pede o token ao Google (a biblioteca só é baixada quando o usuário usa o Drive). */
    const requestDriveToken = useCallback(async (prompt) => {
        if (!driveClientConfigured)
            throw new Error(T.driveNotConfigured);
        await loadGIS();
        if (!tokenClientRef.current)
            tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({ client_id: CFG.googleClientId, scope: Drive.SCOPE, callback: r => driveWaitRef.current?.ok(r), error_callback: e => driveWaitRef.current?.fail(e) });
        return await new Promise((resolve, reject) => {
            driveWaitRef.current = {
                ok: resp => { if (resp?.error) {
                    reject(new Error(resp.error_description || resp.error));
                    return;
                } if (!resp?.access_token) {
                    reject(new Error("token"));
                    return;
                } const t = { token: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 }; sessionStorage.setItem("fr4_drive_token", JSON.stringify(t)); setDriveTok(t); setBkp(p => ({ ...p, driveConnected: true })); resolve(t.token); },
                fail: e => reject(new Error(e?.type || "popup"))
            };
            tokenClientRef.current.requestAccessToken({ prompt });
        });
    }, [driveClientConfigured, T]);
    const getDriveToken = useCallback(async (interactive = true) => { const t = readDriveToken(); if (t)
        return t.token; if (!interactive)
        return null; return await requestDriveToken(bkpCfg.driveConnected ? "" : "consent"); }, [requestDriveToken, bkpCfg.driveConnected]);
    const driveError = (err, interactive = true) => { if (err && err.code === 401) {
        sessionStorage.removeItem("fr4_drive_token");
        setDriveTok(null);
    } if (interactive)
        toast_(fill(T.driveFail, { msg: err?.message || "?" }), "#EF4444"); };
    const connectDrive = async () => { try {
        toast_(T.driveConn, "#3B82F6");
        await requestDriveToken(bkpCfg.driveConnected ? "" : "consent");
        toast_(T.driveOk);
    }
    catch (err) {
        driveError(err);
    } };
    const disconnectDrive = () => { try {
        const t = readDriveToken();
        if (t && window.google?.accounts?.oauth2)
            window.google.accounts.oauth2.revoke(t.token, () => { });
    }
    catch { } sessionStorage.removeItem("fr4_drive_token"); setDriveTok(null); setBkp(p => ({ ...p, driveConnected: false })); };
    const backupToDrive = async (interactive = true) => {
        if (driveBusy)
            return false;
        setDriveBusy(true);
        try {
            const token = await getDriveToken(interactive);
            if (!token)
                return false;
            await Drive.uploadBackup(token, makeBackupFileName(), JSON.stringify(buildBackupPayload()));
            Drive.pruneOld(token, 10).catch(() => { });
            const now = new Date().toISOString();
            setBkp(p => ({ ...p, lastBackup: now, lastDriveBackup: now }));
            toast_(T.driveUploadOk, "#3B82F6");
            return true;
        }
        catch (err) {
            driveError(err, interactive);
            return false;
        }
        finally {
            setDriveBusy(false);
        }
    };
    const openDriveRestore = async () => {
        if (driveBusy)
            return;
        setDriveBusy(true);
        try {
            const files = await Drive.listBackups(await getDriveToken(true));
            if (!files.length) {
                toast_(T.driveNoBackups, "#F59E0B");
                return;
            }
            setDriveFiles(files);
            setModal("driveRestore");
        }
        catch (err) {
            driveError(err);
        }
        finally {
            setDriveBusy(false);
        }
    };
    const pickDriveBackup = async (id) => {
        if (driveBusy)
            return;
        setDriveBusy(true);
        try {
            prepareRestore(await Drive.downloadBackup(await getDriveToken(true), id));
        }
        catch (err) {
            driveError(err);
        }
        finally {
            setDriveBusy(false);
        }
    };
    // Envio automático ao abrir o app (só com token válido nesta sessão; o Google não permite renovar sem interação)
    useEffect(() => { if (locked || !driveClientConfigured || !Core.backupDue(bkpCfg.interval, bkpCfg.lastDriveBackup))
        return; if (readDriveToken())
        backupToDrive(false);
    else if (bkpCfg.driveConnected)
        toast_(T.driveBackupDue, "#F59E0B"); }, [locked]);
    const triggerRestore = () => { if (fileRef.current)
        fileRef.current.click(); };
    const prepareRestore = text => { try {
        setRestoreConfirm(Core.sanitizeBackup(JSON.parse(text)));
        setModal("restoreConfirm");
    }
    catch {
        toast_(T.invalidFile, "#EF4444");
    } };
    const handleFile = e => { const file = e.target.files[0]; e.target.value = ""; if (!file)
        return; if (file.size > 20 * 1024 * 1024) {
        toast_(T.invalidFile, "#EF4444");
        return;
    } const r = new FileReader(); r.onload = ev => prepareRestore(String(ev.target.result)); r.readAsText(file); };
    const doRestore = () => {
        if (!restoreConfirm)
            return;
        try {
            localStorage.setItem("fr4_pre_restore_backup", JSON.stringify(buildBackupPayload()));
        }
        catch (e) {
            toast_(T.noSpaceRestore, "#EF4444");
            return;
        }
        setTxs(restoreConfirm.transactions);
        setAccs(restoreConfirm.accounts);
        setBalH(restoreConfirm.balanceHistory);
        setCustomCats(restoreConfirm.customCategories);
        const dropped = restoreConfirm.dropped;
        setRestoreConfirm(null);
        setModal(null);
        setFAcc("all");
        toast_(dropped ? fill(T.restoreDropped, { n: dropped }) : T.restoreOk, dropped ? "#F59E0B" : "#10B981");
    };
    // TX
    const blankF = { desc: "", amount: "", type: "expense", cat: "food", date: TODAY, dueDate: TODAY, status: "pending", accountId: accs[0]?.id || "", recurrent: false, recurrence: "monthly", installments: false, installCount: 2, installmentTotal: "", scheduled: false, scheduledDate: TODAY };
    const [form, setForm] = useState(blankF);
    // Categorias filtradas pelo tipo do lançamento
    const formCats = useMemo(() => allCats.filter(c => c.txType === "both" || (form.type === "income" ? c.txType === "income" : c.txType === "expense")), [allCats, form.type]);
    const openNewTx = () => { setEditId(null); setForm({ ...blankF }); setModal("addTx"); };
    const openEditTx = t => { if (Core.isTransfer(t)) {
        toast_(T.transferNoEdit, "#F59E0B");
        return;
    } setForm({ ...blankF, desc: t.desc, amount: String(t.amount), type: t.type, cat: t.cat, date: t.date, dueDate: t.dueDate || t.date, status: t.status, accountId: accs.some(a => a.id === t.accountId) ? t.accountId : blankF.accountId, recurrent: !!t.recurrent, recurrence: t.recurrence || "monthly" }); setEditId(t.id); setModal("addTx"); };
    const closeTxModal = () => { setModal(null); setEditId(null); };
    const addTx = () => {
        const isInst = form.installments && !editId && !form.recurrent;
        const raw = parseFloat(isInst ? (form.installmentTotal || form.amount) : form.amount);
        if (!form.desc.trim() || !Number.isFinite(raw) || raw <= 0) {
            toast_(T.needDescAmount, "#EF4444");
            return;
        }
        if (!accs.some(a => a.id === form.accountId)) {
            toast_(T.pickValidAccount, "#EF4444");
            return;
        }
        const sched = !editId && form.scheduled && Core.isValidISO(form.scheduledDate);
        const futureSched = sched && form.scheduledDate > TODAY;
        const date = sched ? form.scheduledDate : form.date;
        const status = futureSched ? "pending" : form.status; // agendado para o futuro nunca nasce "pago"
        const dueDate = status === "pending" ? (futureSched ? date : (Core.isValidISO(form.dueDate) ? form.dueDate : date)) : date;
        const base = { desc: form.desc.trim().slice(0, 120), type: form.type, cat: form.cat, accountId: form.accountId, recurrent: !!form.recurrent, ...(form.recurrent ? { recurrence: form.recurrence } : {}) };
        if (editId) {
            setTxs(p => p.map(t => t.id === editId ? { ...t, ...base, recurrence: base.recurrent ? base.recurrence : undefined, amount: round2(raw), date, dueDate, status } : t));
            closeTxModal();
            toast_(T.edited);
            return;
        }
        let toAdd;
        if (isInst) {
            const n = Math.min(48, Math.max(2, Math.floor(Number(form.installCount)) || 2));
            const groupId = uid();
            // só a 1ª parcela segue o status escolhido; as demais ficam pendentes (antes todas nasciam "pagas")
            toAdd = Core.splitInstallments(raw, n).map((amt, i) => { const dd = Core.addCalendarMonths(dueDate, i); return { ...base, recurrent: false, id: uid(), groupId, amount: amt, desc: `${base.desc} (${i + 1}/${n})`, date: i === 0 ? date : dd, dueDate: i === 0 ? dueDate : dd, status: i === 0 ? status : "pending" }; });
        }
        else {
            toAdd = [{ ...base, id: uid(), amount: round2(raw), date, dueDate, status }];
        }
        toAdd = toAdd.map(Core.sanitizeTx).filter(Boolean);
        setTxs(p => [...toAdd, ...p]);
        closeTxModal();
        setForm(blankF);
        toast_(toAdd.length > 1 ? fill(T.parcelsAdded, { n: toAdd.length }) : T.txAdded);
    };
    // TRANSFER
    const blankTr = { desc: "", amount: "", fromAccountId: accs[0]?.id || "", toAccountId: accs[1]?.id || accs[0]?.id || "", date: TODAY, status: "paid" };
    useEffect(() => {
        if ((accs || []).length >= 2) {
            setTrForm(f => ({
                ...f,
                fromAccountId: (accs.some(a => a.id === f.fromAccountId) ? f.fromAccountId : accs[0]?.id) || "",
                toAccountId: (accs.some(a => a.id === f.toAccountId && a.id !== ((accs.some(x => x.id === f.fromAccountId) ? f.fromAccountId : accs[0]?.id) || "")) ? f.toAccountId : accs.find(a => a.id !== ((accs.some(x => x.id === f.fromAccountId) ? f.fromAccountId : accs[0]?.id) || ""))?.id) || "",
            }));
        }
        else {
            setTrForm(f => ({ ...f, fromAccountId: accs[0]?.id || "", toAccountId: "" }));
        }
    }, [accs]);
    const addTransfer = () => {
        if ((accs || []).length < 2) {
            toast_(T.needTwoAccounts, "#EF4444");
            return;
        }
        if (!trForm.amount || parseFloat(trForm.amount) <= 0) {
            toast_(T.invalidAmount, "#EF4444");
            return;
        }
        if (!trForm.fromAccountId || !trForm.toAccountId) {
            toast_(T.pickAccounts, "#EF4444");
            return;
        }
        if (trForm.fromAccountId === trForm.toAccountId) {
            toast_(T.sameAccountErr, "#EF4444");
            return;
        }
        if (!accs.some(a => a.id === trForm.fromAccountId) || !accs.some(a => a.id === trForm.toAccountId)) {
            toast_(T.invalidAccounts, "#EF4444");
            return;
        }
        const amt = parseFloat(trForm.amount);
        const desc = trForm.desc.trim() || (T.transferL || "Transferência").replace(/^🔄\s*/, "");
        const fromAcc = (accs || []).find(a => a.id === trForm.fromAccountId);
        const toAcc = (accs || []).find(a => a.id === trForm.toAccountId);
        const pairId = uid();
        setTxs(p => [
            { id: uid(), desc: `${desc} → ${toAcc?.name || ""}`, amount: amt, type: "transfer_out", cat: "transfer", date: trForm.date, status: trForm.status, accountId: trForm.fromAccountId, recurrent: false, dueDate: trForm.date, transferPairId: pairId },
            { id: uid(), desc: `${desc} ← ${fromAcc?.name || ""}`, amount: amt, type: "transfer_in", cat: "transfer", date: trForm.date, status: trForm.status, accountId: trForm.toAccountId, recurrent: false, dueDate: trForm.date, transferPairId: pairId },
            ...p
        ]);
        setModal(null);
        setTrForm(blankTr);
        toast_(T.transferAdded);
    };
    const markPaid = id => {
        const tx = txs.find(t => t.id === id);
        if (!tx || tx.status === "paid")
            return;
        // Pagou uma recorrente? Cria a próxima ocorrência como pendente (se ainda não existir).
        let next = null;
        if (tx.recurrent && !Core.isTransfer(tx)) {
            const no = Core.nextOccurrence(tx);
            const dup = no && txs.some(t => t.id !== tx.id && Core.matchKey(t) === Core.matchKey(tx) && (tx.recurrence === "weekly" ? t.date === no.date : t.date.slice(0, 7) === no.date.slice(0, 7)));
            if (no && !dup)
                next = no;
        }
        setTxs(p => { const pairId = tx.transferPairId; const paid = p.map(t => t.id === id || (pairId && t.transferPairId === pairId) ? { ...t, status: "paid" } : t); return next ? [{ ...tx, id: uid(), status: "pending", date: next.date, dueDate: next.dueDate }, ...paid] : paid; });
        toast_(next ? `${T.paidOk} · ${fill(T.nextCreated, { d: fmtDate(next.date) })}` : T.paidOk);
    };
    const askDelete = t => { setDelTarget(t); setModal("confirmDel"); };
    /** mode: "one" | "following" | "all" (as duas últimas valem para parcelas do mesmo parcelamento). */
    const delTx = (id, mode = "one") => {
        setTxs(p => {
            const tx = p.find(t => t.id === id);
            if (!tx)
                return p;
            const pairId = tx.transferPairId; // transferência: sempre remove as duas pernas
            return p.filter(t => {
                if (t.id === id || (pairId && t.transferPairId === pairId))
                    return false;
                if (tx.groupId && t.groupId === tx.groupId) {
                    if (mode === "all")
                        return false;
                    if (mode === "following" && t.date >= tx.date)
                        return false;
                }
                return true;
            });
        });
        setDelTarget(null);
        setModal(null);
        toast_(T.removed, "#EF4444");
    };
    const endSeries = t => { const key = Core.seriesKey(t); setTxs(p => p.map(x => x.recurrent && Core.seriesKey(x) === key ? { ...x, recurrent: false } : x)); setModal(null); toast_(T.seriesEnded, "#F59E0B"); };
    // ACCOUNT
    const blankA = { name: "", type: "checking", color: "#7C6FFF", icon: "🏦", openingBalance: "", includeInTotal: true };
    const [aForm, setAForm] = useState(blankA);
    const addAcc = () => { const name = aForm.name.trim(); if (!name)
        return; const acc = Core.sanitizeAccount({ ...aForm, name, id: uid(), openingBalance: parseFloat(aForm.openingBalance) || 0 }); if (!acc)
        return; setAccs(p => [...p, acc]); setModal(null); setAForm(blankA); toast_(T.accAdded); };
    const openAccAdjust = id => { const others = (accs || []).filter(a => a.id !== id); const firstOther = others[0]?.id || ""; setEditAccId(id); const selectedAcc = accs.find(a => a.id === id); setAccEditName(selectedAcc?.name || ""); setAccEditType(selectedAcc?.type || "checking"); setAccEditIcon(selectedAcc?.icon || "🏦"); setAccEditIncluded(selectedAcc?.includeInTotal !== false); setAccRealBal(String(getAccBal(id))); setAccAdjNote(""); setAccDeleteFutureMode("transfer"); setAccDeleteTargetId(firstOther); setAccDeleteBalanceMode("transfer"); setAccDeleteBalanceTargetId(firstOther); setModal("accAdj"); };
    const saveAccountDetails = () => { if (!editAccId || !accEditName.trim()) {
        toast_(T.enterAccName, "#EF4444");
        return;
    } setAccs(prev => prev.map(a => a.id === editAccId ? { ...a, name: accEditName.trim(), type: accEditType, icon: accEditIcon.trim() || "🏦", includeInTotal: accEditIncluded } : a)); setModal(null); toast_(T.accUpdated); };
    const saveAccAdjustmentTx = () => { const real = parseFloat(accRealBal); if (isNaN(real) || !editAccId)
        return; const diff = round2(real - getAccBal(editAccId)); if (Math.abs(diff) < 0.005) {
        toast_(XT.noDifference, "#F59E0B");
        return;
    } setTxs(p => [{ id: uid(), desc: accAdjNote.trim() || XT.adjustmentAutoDesc, amount: Math.abs(diff), type: diff >= 0 ? "income" : "expense", cat: "adjustment", date: TODAY, status: "paid", accountId: editAccId, recurrent: false, dueDate: TODAY }, ...p]); setModal(null); toast_(XT.adjustmentCreated, "#8B5CF6"); };
    const saveAccBaseCorrection = () => { const real = parseFloat(accRealBal); if (isNaN(real) || !editAccId)
        return; const diff = round2(real - getAccBal(editAccId)); if (Math.abs(diff) < 0.005) {
        toast_(XT.noDifference, "#F59E0B");
        return;
    } setAccs(p => p.map(a => a.id === editAccId ? { ...a, openingBalance: round2((Number(a.openingBalance) || 0) + diff) } : a)); setModal(null); toast_(XT.baseCorrected, "#3B82F6"); };
    const deleteAccountAndReconcile = () => {
        if (!editAccId)
            return;
        if (accs.length <= 1) {
            toast_(XT.cannotDeleteLastAccount, "#EF4444");
            return;
        }
        const acc = accs.find(a => a.id === editAccId);
        const targets = accs.filter(a => a.id !== editAccId);
        if (!acc)
            return;
        if (accDeleteFutureMode === "transfer" && !targets.some(a => a.id === accDeleteTargetId)) {
            toast_(XT.deleteNeedsTarget, "#EF4444");
            return;
        }
        if (accDeleteBalanceMode === "transfer" && !targets.some(a => a.id === accDeleteBalanceTargetId)) {
            toast_(XT.deleteNeedsTarget, "#EF4444");
            return;
        }
        if (!window.confirm(fill(T.confirmDeleteAcc, { name: acc.name, fut: accDeleteFutureMode === "transfer" ? T.reallocated : T.deleted, bal: accDeleteBalanceMode === "transfer" ? T.transferred : T.discarded })))
            return;
        const currentBalance = round2(getAccBal(editAccId));
        setTxs(prev => {
            const future = t => t.status === "pending"; // qualquer pendência (inclusive vencida) precisa de destino
            const removePairIds = new Set();
            for (const t of prev) {
                if (t.accountId !== editAccId || !future(t) || !t.transferPairId)
                    continue;
                const counterpart = prev.find(x => x.transferPairId === t.transferPairId && x.id !== t.id);
                if (accDeleteFutureMode === "delete" || counterpart?.accountId === accDeleteTargetId)
                    removePairIds.add(t.transferPairId);
            }
            const next = [];
            for (const t of prev) {
                if (t.transferPairId && removePairIds.has(t.transferPairId))
                    continue;
                if (t.accountId !== editAccId) {
                    next.push(t);
                    continue;
                }
                if (future(t)) {
                    if (accDeleteFutureMode === "delete")
                        continue;
                    next.push({ ...t, accountId: accDeleteTargetId });
                    continue;
                }
                next.push({ ...t, accountId: null, accountRemoved: true, accountNameSnapshot: acc.name, accountIconSnapshot: acc.icon, accountColorSnapshot: acc.color });
            }
            if (accDeleteBalanceMode === "transfer" && Math.abs(currentBalance) >= 0.005) {
                next.unshift({ id: uid(), desc: `${XT.closingTransferDesc}: ${acc.name}`, amount: Math.abs(currentBalance), type: currentBalance >= 0 ? "income" : "expense", cat: "adjustment", date: TODAY, status: "paid", accountId: accDeleteBalanceTargetId, recurrent: false, dueDate: TODAY });
            }
            return next;
        });
        setAccs(prev => prev.filter(a => a.id !== editAccId));
        setFAcc("all");
        setModal(null);
        toast_(XT.accountDeleted, "#EF4444");
    };
    // BAL ADJ
    const saveBal = () => { const v = parseFloat(tmpBal); if (isNaN(v))
        return; setBalH(p => ({ ...p, [editBM]: { adjusted: true, manual: v } })); setModal(null); toast_(T.adjSaved); };
    const rmBal = ym => { setBalH(p => ({ ...p, [ym]: { adjusted: false, manual: null } })); toast_(T.adjRemoved); };
    // CATEGORY MANAGEMENT
    const addCat = () => {
        if (!catForm.name.trim())
            return;
        const newCat = { id: "custom_" + uid(), icon: catForm.icon, color: catForm.color, txType: catForm.txType, label: catForm.name.trim().slice(0, 40), builtin: false };
        setCustomCats(p => [...(p || []), newCat]);
        setCatForm({ name: "", icon: "📦", color: "#F0A500", txType: "both" });
        setModal(null);
        toast_(T.catAdded);
    };
    const deleteCat = (catId) => {
        if (!window.confirm(T.catDeleteWarn))
            return;
        setCustomCats(p => (p || []).filter(c => c.id !== catId));
        setTxs(p => (p || []).map(t => t.cat === catId ? { ...t, cat: "other" } : t));
        toast_(T.catDeleted, "#EF4444");
    };
    const renameCat = (catId) => {
        if (!catEditName.trim())
            return;
        setCustomCats(p => (p || []).map(c => c.id === catId ? { ...c, label: catEditName.trim() } : c));
        setCatEditId(null);
        setCatEditName("");
        toast_(T.catRenamed);
    };
    useEffect(() => {
        if (!formCats.length)
            return;
        const currentValid = formCats.some(c => c.id === form.cat);
        if (!currentValid) {
            setForm(f => ({ ...f, cat: formCats[0].id }));
        }
    }, [form.type, allCats]);
    // PIN — o hash é salgado (PBKDF2); é uma trava de tela, não criptografia dos dados
    const savePin = async (n) => { try {
        localStorage.setItem("fr4_pin", await Core.hashPin(n));
        localStorage.removeItem("fr4_pin_fail");
        setUser(p => ({ ...p, pinEnabled: true }));
        setShowPin(false);
        setPinStep(1);
        setPin1("");
        setPin2("");
        toast_(T.pinSaved);
    }
    catch {
        toast_(T.storageErr, "#EF4444");
    } };
    const handlePinKey = d => { if (pinStep === 1) {
        if (pin1.length >= 4)
            return;
        const n = pin1 + d;
        setPin1(n);
        if (n.length === 4) {
            setPinStep(2);
            setPin2("");
        }
    }
    else {
        if (pin2.length >= 4)
            return;
        const n = pin2 + d;
        setPin2(n);
        if (n.length === 4) {
            if (n === pin1) {
                savePin(n);
            }
            else {
                toast_(T.pinMismatch, "#EF4444");
                setPinStep(1);
                setPin1("");
                setPin2("");
            }
        }
    } };
    const delPinKey = () => { if (pinStep === 1)
        setPin1(p => p.slice(0, -1));
    else
        setPin2(p => p.slice(0, -1)); };
    const disablePin = () => { localStorage.removeItem("fr4_pin"); localStorage.removeItem("fr4_pin_fail"); Bio.clear(); setUser(p => ({ ...p, pinEnabled: false, biometric: false })); toast_(T.pinDisabled); };
    const toggleBio = async (v) => {
        if (!v) {
            Bio.clear();
            setUser(p => ({ ...p, biometric: false }));
            return;
        }
        if (!userCfg.pinEnabled) {
            toast_(T.bioNeedsPin, "#F59E0B");
            return;
        }
        if (!Bio.supported()) {
            toast_(T.bioUnsupported, "#F59E0B");
            return;
        }
        try {
            await Bio.register();
            setUser(p => ({ ...p, biometric: true }));
            toast_(T.bioOn);
        }
        catch {
            toast_(T.bioFailed, "#EF4444");
        }
    };
    const unlockWithBio = async () => { try {
        if (await Bio.verify()) {
            setLocked(false);
            if (userCfg.tipsEnabled)
                setShowTip(true);
        }
    }
    catch { /* cancelado: segue no PIN */ } };
    // PIX de apoio — só existe se config.js trouxer uma chave PIX (nada pessoal fica no código)
    const supportVisible = DONATE.enabled !== false;
    const copyText = async (t) => { try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(t);
        }
        else {
            const ta = document.createElement("textarea");
            ta.value = t;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
        }
        toast_(T.pixCopied, "#10B981");
    }
    catch {
        toast_(T.copyFail, "#EF4444");
    } };
    // Apoio voluntário: preços em dólar; o Pix é cobrado em reais pela cotação de referência do config.js
    const SUP = { monthly: 1, yearly: 10 };
    const supRate = Number(DONATE.usdToBrl) > 0 ? Number(DONATE.usdToBrl) : 5;
    const supUsd = supMode === "once" ? Math.round(Number(supAmt) * 100) / 100 : SUP[supMode];
    const supUsdOk = Number.isFinite(supUsd) && supUsd >= 1 && supUsd <= 500;
    const supFmtUsd = n => n.toLocaleString(LOCALES[userCfg.lang] || "pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(n) ? 0 : 2 });
    const supFmtBrl = n => n.toLocaleString(LOCALES[userCfg.lang] || "pt-BR", { style: "currency", currency: "BRL" });
    const supLink = supMode === "once" ? "" : String((DONATE.recurringUrl || {})[supMode] || "");
    const supChannel = supMode === "once" ? !!DONATE.pixKey : /^https:\/\//.test(supLink);
    const supName = { once: T.sup_once_name, monthly: T.sup_monthly_name, yearly: T.sup_yearly_name }[supMode];
    const supyearPct = Math.round((1 - SUP.yearly / (12 * SUP.monthly)) * 100);
    const supPay = () => {
        if (!supUsdOk) { toast_(T.sup_invalid, "#EF4444"); return; }
        if (!supChannel) return;
        if (supMode !== "once") { window.open(supLink, "_blank", "noopener,noreferrer"); return; }
        const brl = Math.round(supUsd * supRate * 100) / 100;
        setPixModal({ label: supName, usdValue: supUsd, brlValue: brl, rate: supRate, key: DONATE.pixKey, pixCode: Core.buildPixPayload({ key: DONATE.pixKey, name: DONATE.receiverName, city: DONATE.receiverCity, amount: brl, description: "Finance Real", txid: "FINANCEREAL" }) });
    };
    // Em meses futuros, as recorrentes aparecem como "projeção" (a regra está em Core.projectMonth)
    const projectedTxsForFuture = useMemo(() => selMon > currentYM ? Core.projectMonth(txs, selMon) : [], [selMon, txs, currentYM]);
    const filtTx = [
        ...(selMon > currentYM ? projectedTxsForFuture : []),
        ...txs.filter(t => t.date.startsWith(selMon)),
    ]
        .filter(t => fAcc === "all" || t.accountId === fAcc)
        .filter(t => fStatus === "all" || t.status === fStatus)
        .sort((a, b) => b.date.localeCompare(a.date));
    if (locked)
        return React.createElement(PinLock, { T, bio: !!userCfg.biometric && Bio.enrolled() && Bio.supported(), onBio: unlockWithBio, onUnlock: () => { setLocked(false); if (userCfg.tipsEnabled)
                setShowTip(true); } });
    return (React.createElement("div", { style: { fontFamily: "'Syne',sans-serif", background: "#080C18", height: "100dvh", maxWidth: 430, margin: "0 auto", color: "#E8EDF5", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", width: "100%", boxSizing: "border-box" } },
        showTip && React.createElement(TipOverlay, { T: T, lang: userCfg.lang, onClose: () => setShowTip(false) }),
        React.createElement("input", { ref: fileRef, type: "file", accept: ".json", style: { display: "none" }, onChange: handleFile }),
        React.createElement("div", { style: { background: "#080C18", padding: "max(env(safe-area-inset-top,0px),12px) 15px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 } },
            React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
                React.createElement(AppIcon, { size: 22 }),
                React.createElement("span", { style: { fontSize: 13, fontWeight: 800, letterSpacing: .3 } }, "Finance Real"),
                React.createElement("span", { style: { fontSize: 9, fontWeight: 800, background: "#6366F120", color: "#818CF8", border: "1px solid #6366F140", borderRadius: 20, padding: "1px 6px" } }, T.privateBadge)),
            React.createElement("div", { style: { display: "flex", gap: 7, alignItems: "center" } },
                driveOn && React.createElement("span", { style: { fontSize: 9, color: "#34D399", fontWeight: 800, background: "#34D39918", border: "1px solid #34D39940", borderRadius: 8, padding: "2px 6px" } }, "\u25CFDRIVE"),
                deferPmt && React.createElement("button", { onClick: () => { deferPmt.prompt(); deferPmt.userChoice.then(() => setDeferPmt(null)); }, style: { background: "#6366F120", border: "1px solid #6366F140", color: "#818CF8", borderRadius: 9, padding: "3px 8px", fontSize: 10, cursor: "pointer", fontWeight: 700 } }, T.installBtn.split(" ")[0]))),
        (overdue.length > 0 || dueSoon.length > 0) && (React.createElement("div", { className: "fi", style: { margin: "7px 13px 0", flexShrink: 0, background: overdue.length > 0 ? "#EF444414" : "#F59E0B12", border: `1px solid ${overdue.length > 0 ? "#EF444440" : "#F59E0B40"}`, borderRadius: 13, padding: "8px 12px", display: "flex", gap: 8, alignItems: "center" } },
            React.createElement("span", { className: "pulse", style: { fontSize: 16, flexShrink: 0 } }, overdue.length > 0 ? "🚨" : "⚠️"),
            React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                React.createElement("p", { style: { fontSize: 12, fontWeight: 700, color: overdue.length > 0 ? "#EF4444" : "#F59E0B" } }, overdue.length > 0 ? `${overdue.length} ${T.overdue.replace("🚨 ", "")}` : `${dueSoon.length} ${T.dueSoon.replace("⚠️ ", "")}`),
                React.createElement("p", { style: { fontSize: 10, color: "#64748B", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, (overdue.length > 0 ? overdue : dueSoon).slice(0, 3).map(t => t.desc).join(" · "))),
            React.createElement("button", { type: "button", onClick: () => switchTab("alerts"), style: { background: "none", border: "1px solid #1F2D45", color: "#94A3B8", borderRadius: 8, padding: "3px 8px", fontSize: 9, cursor: "pointer", fontWeight: 700, flexShrink: 0 } }, "VER"))),
        React.createElement("div", { className: "scr", style: { flex: 1, padding: "0 13px 82px", paddingTop: 8, overflowX: "hidden", width: "100%", boxSizing: "border-box" } },
            tab === "home" && (React.createElement("div", { className: "fi" },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0 8px" } },
                    React.createElement("div", null,
                        React.createElement("p", { style: { fontSize: 10, color: "#475569", fontWeight: 700, letterSpacing: .8, textTransform: "uppercase" } }, T.totalAssets),
                        React.createElement("p", { className: "mono", style: { fontSize: 28, fontWeight: 700, letterSpacing: -1, lineHeight: 1.1, color: totAssets >= 0 ? "#34D399" : "#F87171" } }, fmtC(totAssets))),
                    React.createElement("button", { onClick: () => setModal("backup"), style: { background: "#0D1526", border: "1px solid #1A2640", borderRadius: 12, padding: "8px 11px", color: "#64748B", fontSize: 10, cursor: "pointer", fontWeight: 700, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flexShrink: 0 } },
                        React.createElement("span", { style: { fontSize: 17 } }, "\u2601\uFE0F"),
                        React.createElement("span", { style: { letterSpacing: .5 } }, "BKP"))),
                React.createElement("div", { style: { marginBottom: 10, flexShrink: 0 } },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 0, background: "#0D1526", border: "1px solid #1A2640", borderRadius: 14, padding: "3px 4px", marginBottom: 7 } },
                        React.createElement("button", { onClick: () => goYear(-1), style: { background: "none", border: "none", color: "#64748B", width: 32, height: 30, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0, borderRadius: 10 } }, "\u2039"),
                        React.createElement("div", { style: { flex: 1, textAlign: "center", fontSize: 13, fontWeight: 800, color: "#818CF8", letterSpacing: 1 } }, selYear),
                        React.createElement("button", { onClick: () => goYear(1), style: { background: "none", border: "none", color: "#64748B", width: 32, height: 30, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0, borderRadius: 10 } }, "\u203A")),
                    React.createElement("div", { style: { display: "flex", gap: 5, overflowX: "auto", paddingBottom: 3 } }, ALL_MONTHS.map(ym => {
                        const isFut = ym > currentYM;
                        const isNow = ym === currentYM;
                        const isSel = ym === selMon;
                        const hasTx = txs.some(t => t.date.startsWith(ym));
                        return (React.createElement("button", { key: ym, onClick: () => setSelMon(ym), style: {
                                flexShrink: 0, padding: "5px 10px", borderRadius: 20,
                                border: `1.5px ${isFut ? "dashed" : "solid"}`,
                                borderColor: isSel ? "#6366F1" : isNow ? "#2A3A70" : "#1A2640",
                                background: isSel ? "#6366F125" : isNow && !isSel ? "#1A2640" : "transparent",
                                color: isSel ? "#818CF8" : isNow ? "#94A3B8" : hasTx ? "#64748B" : "#2E3D55",
                                fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
                                position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 2
                            } },
                            MONTHS_BASE[parseInt(ym.split("-")[1]) - 1],
                            isNow && !isSel && React.createElement("span", { style: { width: 4, height: 4, borderRadius: "50%", background: "#6366F160", display: "block" } }),
                            hasTx && !isNow && !isSel && React.createElement("span", { style: { width: 4, height: 4, borderRadius: "50%", background: "#2A3A55", display: "block" } }),
                            isSel && React.createElement("span", { style: { width: 4, height: 4, borderRadius: "50%", background: "#6366F1", display: "block" } })));
                    }))),
                (() => {
                    const isFut = selMon > currentYM;
                    const proj = isFut ? projCard : null;
                    return (React.createElement("div", { style: { background: isFut ? "linear-gradient(135deg,#0D1235,#0A0E20)" : "linear-gradient(135deg,#0D1930,#0A1020)", border: `1px solid ${isFut ? "#6366F145" : "#1A2640"}`, borderRadius: 20, padding: "14px 16px", marginBottom: 11, position: "relative", overflow: "hidden", width: "100%", boxSizing: "border-box" } },
                        React.createElement("div", { style: { position: "absolute", top: -24, right: -24, width: 100, height: 100, borderRadius: "50%", background: isFut ? "radial-gradient(circle,#6366F122,transparent)" : "radial-gradient(circle,#6366F118,transparent)", pointerEvents: "none" } }),
                        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 } },
                            React.createElement("div", { style: { minWidth: 0, flex: 1 } },
                                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 3 } },
                                    React.createElement("p", { style: { fontSize: 10, color: "#475569", fontWeight: 700, letterSpacing: .8, textTransform: "uppercase" } },
                                        MONTHS_BASE[parseInt(selMon.split("-")[1]) - 1],
                                        " ",
                                        selMon.slice(0, 4)),
                                    isFut
                                        ? React.createElement("span", { className: "pill", style: { background: "#6366F120", color: "#818CF8", border: "1px solid #6366F140", fontSize: 8 } }, "▷ " + T.projection)
                                        : React.createElement("span", { className: "pill", style: { background: "#34D39915", color: "#34D399", border: "1px solid #34D39930", fontSize: 8 } }, "● " + T.actual),
                                    balH[selMon]?.adjusted && React.createElement("span", { className: "pill", style: { background: "#F59E0B15", color: "#F59E0B", border: "1px solid #F59E0B30", fontSize: 8 } }, "\u270F\uFE0F")),
                                React.createElement("p", { className: "mono", style: { fontSize: 27, fontWeight: 700, letterSpacing: -1, lineHeight: 1.1, color: isFut ? "#818CF8" : getMonBal(selMon) >= 0 ? "#34D399" : "#F87171" } }, fmtC(getMonBal(selMon))),
                                React.createElement("p", { style: { fontSize: 9, color: "#475569", marginTop: 2 } }, isFut ? T.projMonthBal : T.monthBal)),
                            React.createElement("button", { onClick: () => { setEditBM(selMon); setTmpBal(String(getMonBal(selMon))); setModal("balAdj"); }, style: { background: "none", border: "1px dashed #2A3A55", color: "#475569", borderRadius: 8, padding: "3px 8px", fontSize: 9, cursor: "pointer", fontWeight: 700, flexShrink: 0, marginLeft: 8 } }, "\u270F\uFE0F")),
                        React.createElement("div", { style: { display: "flex", gap: 5, marginBottom: isFut ? 8 : 0 } }, (isFut
                            ? [[T.income, proj.projIncome, "#818CF8"], [T.expenses, proj.projExpense, "#A78BFA"], [T.toPay, mPendTot, "#F59E0B"]]
                            : [[T.income, income, "#34D399"], [T.expenses, expenses, "#F87171"], [T.toPay, mPendTot, "#F59E0B"]]).map(([l, v, c]) => (React.createElement("div", { key: l, style: { flex: 1, background: "#080C1895", borderRadius: 10, padding: "7px 7px" } },
                            React.createElement("p", { style: { fontSize: 8, color: "#475569", marginBottom: 2, fontWeight: 700, letterSpacing: .3 } }, l),
                            React.createElement("p", { className: "mono", style: { fontSize: 11, fontWeight: 700, color: c } }, fmtC(v)))))),
                        isFut && proj && (() => {
                            const savColor = proj.savingsRate >= 20 ? "#34D399" : proj.savingsRate >= 0 ? "#F59E0B" : "#F87171";
                            return (React.createElement("div", { style: { borderTop: "1px solid #6366F120", paddingTop: 8, display: "flex", flexDirection: "column", gap: 7 } },
                                React.createElement("div", { style: { background: "#6366F112", border: "1px solid #6366F130", borderRadius: 12, padding: "9px 11px", display: "flex", justifyContent: "space-between", alignItems: "center" } },
                                    React.createElement("div", null,
                                        React.createElement("p", { style: { fontSize: 9, color: "#818CF8", fontWeight: 700, letterSpacing: .5, marginBottom: 2 } }, T.projAssets),
                                        React.createElement("p", { className: "mono", style: { fontSize: 16, fontWeight: 800, color: proj.projAssets >= totAssets ? "#34D399" : "#F87171" } }, fmtC(proj.projAssets))),
                                    React.createElement("div", { style: { textAlign: "right" } },
                                        React.createElement("p", { style: { fontSize: 9, color: "#475569", fontWeight: 700, marginBottom: 2 } }, T.vsToday),
                                        React.createElement("p", { className: "mono", style: { fontSize: 12, fontWeight: 700, color: proj.projAssets >= totAssets ? "#34D399" : "#F87171" } },
                                            proj.projAssets >= totAssets ? "+" : "",
                                            fmtC(round2(proj.projAssets - totAssets))))),
                                proj.openNet !== 0 && React.createElement("p", { style: { fontSize: 10, color: "#94A3B8", textAlign: "center" } }, `${T.openItems}: ${fmtC(proj.openNet)}`),
                                React.createElement("div", { style: { display: "flex", gap: 5 } },
                                    React.createElement("div", { style: { flex: 1, background: "#080C1895", borderRadius: 10, padding: "7px 8px" } },
                                        React.createElement("p", { style: { fontSize: 8, color: "#475569", fontWeight: 700, marginBottom: 2, letterSpacing: .3 } }, T.incomeYear),
                                        React.createElement("p", { className: "mono", style: { fontSize: 11, fontWeight: 700, color: "#818CF8" } }, fmtC(proj.cumIncome)),
                                        React.createElement("p", { style: { fontSize: 8, color: "#374151", marginTop: 1 } }, T.realProj)),
                                    React.createElement("div", { style: { flex: 1, background: "#080C1895", borderRadius: 10, padding: "7px 8px" } },
                                        React.createElement("p", { style: { fontSize: 8, color: "#475569", fontWeight: 700, marginBottom: 2, letterSpacing: .3 } }, T.expenseYear),
                                        React.createElement("p", { className: "mono", style: { fontSize: 11, fontWeight: 700, color: "#A78BFA" } }, fmtC(proj.cumExpense)),
                                        React.createElement("p", { style: { fontSize: 8, color: "#374151", marginTop: 1 } }, T.realProj)),
                                    React.createElement("div", { style: { flex: 1, background: "#080C1895", borderRadius: 10, padding: "7px 8px" } },
                                        React.createElement("p", { style: { fontSize: 8, color: "#475569", fontWeight: 700, marginBottom: 2, letterSpacing: .3 } }, T.savingsMonth),
                                        React.createElement("p", { className: "mono", style: { fontSize: 11, fontWeight: 700, color: savColor } },
                                            proj.savingsRate,
                                            "%"),
                                        React.createElement("p", { style: { fontSize: 8, color: "#374151", marginTop: 1 } }, T.ofIncome))),
                                React.createElement("div", null,
                                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 3 } },
                                        React.createElement("p", { style: { fontSize: 8, color: "#475569", fontWeight: 700 } }, T.savingsGoal),
                                        React.createElement("p", { style: { fontSize: 8, color: savColor, fontWeight: 800 } }, proj.savingsRate >= 20 ? T.great : proj.savingsRate >= 10 ? T.fair : T.below)),
                                    React.createElement("div", { style: { height: 5, background: "#111827", borderRadius: 3, overflow: "hidden" } },
                                        React.createElement("div", { style: { height: "100%", width: `${Math.min(Math.max(proj.savingsRate, 0), 100)}%`, background: `linear-gradient(90deg,${savColor},${savColor}88)`, borderRadius: 3, transition: "width .6s" } })),
                                    React.createElement("p", { style: { fontSize: 8, color: "#374151", marginTop: 2 } }, T.savingsHint))));
                        })()));
                })(),
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 } },
                    React.createElement("h3", { style: { fontSize: 13, fontWeight: 800, letterSpacing: .3 } }, T.accounts),
                    React.createElement("button", { onClick: () => switchTab("settings"), style: { background: "#6366F115", border: "1px solid #6366F130", color: "#818CF8", borderRadius: 9, padding: "3px 10px", fontSize: 10, cursor: "pointer", fontWeight: 700 } }, T.newAccount)),
                React.createElement("div", { style: { display: "flex", gap: 7, overflowX: "auto", paddingBottom: 6, marginBottom: 12 } }, accs.map(a => (React.createElement("div", { key: a.id, onClick: () => openAccAdjust(a.id), style: { minWidth: 130, background: "#0D1526", border: `1px solid ${a.color}35`, borderRadius: 16, padding: "11px 12px", flexShrink: 0, position: "relative", overflow: "hidden", cursor: "pointer" } },
                    React.createElement("div", { style: { position: "absolute", top: -12, right: -12, width: 52, height: 52, borderRadius: "50%", background: `radial-gradient(circle,${a.color}20,transparent)`, pointerEvents: "none" } }),
                    React.createElement("div", { style: { fontSize: 18, marginBottom: 4 } }, a.icon),
                    React.createElement("p", { style: { fontSize: 10, color: "#64748B", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, a.name),
                    React.createElement("p", { className: "mono", style: { fontSize: 14, fontWeight: 700, marginTop: 2, color: getAccBal(a.id) >= 0 ? a.color : "#F87171" } }, fmtC(getAccBal(a.id))),
                    React.createElement("span", { style: { fontSize: 9, color: "#2E3D55", fontWeight: 700 } }, typeLabel(a.type).replace(/^[^\s]+\s/, "")))))),
                React.createElement("div", { style: { background: "#0D1526", border: "1px solid #1A2640", borderRadius: 20, padding: "14px 14px 8px", marginBottom: 11, width: "100%", boxSizing: "border-box" } },
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showHist ? 10 : 4 } },
                        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 7 } },
                            React.createElement("h3", { style: { fontSize: 13, fontWeight: 800, letterSpacing: .3 } }, T.history),
                            showHist && (React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 2 } },
                                React.createElement("button", { onClick: () => goYear(-1), style: { background: "#111827", border: "1px solid #1A2640", color: "#64748B", borderRadius: 6, width: 22, height: 22, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" } }, "\u2039"),
                                React.createElement("span", { style: { fontSize: 11, fontWeight: 800, color: "#818CF8", minWidth: 32, textAlign: "center" } }, selYear),
                                React.createElement("button", { onClick: () => goYear(1), style: { background: "#111827", border: "1px solid #1A2640", color: "#64748B", borderRadius: 6, width: 22, height: 22, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" } }, "\u203A")))),
                        React.createElement("button", { onClick: () => setShowHist(p => !p), style: { background: "none", border: "none", color: "#475569", fontSize: 11, cursor: "pointer", fontWeight: 700 } }, showHist ? T.hide : T.show)),
                    showHist && (() => {
                        const mx = Math.max(...histMons.map(m => Math.abs(m.balance)), 1);
                        // Siglas de 1 char para o eixo X
                        const sig = MONTHS_BASE.map(m => m.charAt(0));
                        return (React.createElement("div", { style: { width: "100%" } },
                            React.createElement("div", { style: { display: "flex", gap: 3, alignItems: "flex-end", height: 60, width: "100%", marginBottom: 6 } }, histMons.map((m, i) => (React.createElement("div", { key: m.ym, onClick: () => setSelMon(m.ym), title: m.label, style: { flex: 1, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", cursor: "pointer", gap: 2 } },
                                React.createElement("div", { style: {
                                        width: "100%",
                                        height: `${Math.max(Math.abs(m.balance) / mx * 100, 6)}%`,
                                        borderRadius: "2px 2px 0 0",
                                        transition: "height .4s",
                                        opacity: m.ym === selMon ? 1 : .45,
                                        background: m.isFuture ? "linear-gradient(180deg,#6366F1,#4338CA)" : `linear-gradient(180deg,${m.balance >= 0 ? "#34D399" : "#F87171"},${m.balance >= 0 ? "#059669" : "#DC2626"})`,
                                        outline: m.ym === selMon ? "2px solid #6366F190" : "none",
                                        outlineOffset: 1,
                                        boxSizing: "border-box"
                                    } }),
                                React.createElement("span", { style: { fontSize: 8, color: m.ym === selMon ? "#818CF8" : m.isFuture ? "#6366F160" : "#374151", fontWeight: m.ym === selMon ? 800 : 600, lineHeight: 1 } }, sig[i]))))),
                            histMons.map(m => (React.createElement("div", { key: m.ym, onClick: () => setSelMon(m.ym), style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: "1px solid #111827", cursor: "pointer", opacity: m.isFuture ? .7 : 1 } },
                                React.createElement("div", { style: { display: "flex", gap: 5, alignItems: "center", minWidth: 0, flex: 1, overflow: "hidden" } },
                                    React.createElement("div", { style: { width: 3, height: 13, borderRadius: 2, flexShrink: 0, background: m.ym === selMon ? "#6366F1" : m.isFuture ? "#6366F135" : "#1A2640" } }),
                                    React.createElement("span", { style: { fontSize: 12, fontWeight: m.ym === selMon ? 800 : 600, color: m.ym === selMon ? "#E8EDF5" : m.isFuture ? "#6366F190" : "#64748B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, m.label),
                                    m.isFuture && React.createElement("span", { style: { fontSize: 8, color: "#6366F180", flexShrink: 0 } }, "\u25B7"),
                                    m.adjusted && React.createElement("span", { style: { fontSize: 8, color: "#F59E0B", flexShrink: 0 } }, "\u270F")),
                                React.createElement("div", { style: { display: "flex", gap: 4, alignItems: "center", flexShrink: 0, marginLeft: 8 } },
                                    React.createElement("span", { className: "mono", style: { fontSize: 12, fontWeight: 700, color: m.isFuture ? "#818CF8" : m.balance >= 0 ? "#34D399" : "#F87171" } }, fmtC(m.balance)),
                                    React.createElement("button", { onClick: e => { e.stopPropagation(); setEditBM(m.ym); setTmpBal(String(m.balance)); setModal("balAdj"); }, style: { background: "#111827", border: "none", color: "#475569", borderRadius: 5, padding: "2px 5px", fontSize: 10, cursor: "pointer", flexShrink: 0, lineHeight: 1 } }, "\u270F\uFE0F"),
                                    m.adjusted && React.createElement("button", { onClick: e => { e.stopPropagation(); rmBal(m.ym); }, style: { background: "#111827", border: "none", color: "#EF4444", borderRadius: 5, padding: "2px 5px", fontSize: 10, cursor: "pointer", flexShrink: 0, lineHeight: 1 } }, "\u21BA")))))));
                    })()),
                (() => {
                    const recs = txs.filter(t => t.recurrent && t.status === "pending");
                    if (!recs.length)
                        return null;
                    return (React.createElement("div", { className: "card", style: { marginBottom: 4 } },
                        React.createElement("h3", { style: { fontSize: 13, fontWeight: 800, marginBottom: 10, letterSpacing: .3 } }, T.recurringPending),
                        recs.map(t => {
                            const acc = getTxAccountMeta(t);
                            const cat = getCatById(allCats, t.cat);
                            return (React.createElement("div", { key: t.id, style: { display: "flex", gap: 9, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #0D1526" } },
                                React.createElement("div", { style: { width: 34, height: 34, borderRadius: 10, background: cat.color + "20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 } }, cat.icon),
                                React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                                    React.createElement("p", { style: { fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t.desc),
                                    React.createElement("p", { style: { fontSize: 10, color: "#64748B" } },
                                        "\uD83D\uDD01 ",
                                        t.recurrence === "monthly" ? T.monthly : t.recurrence === "weekly" ? T.weekly : T.yearly,
                                        acc ? ` · ${acc.icon} ${acc.name}` : "")),
                                React.createElement("div", { style: { textAlign: "right", flexShrink: 0 } },
                                    React.createElement("p", { className: "mono", style: { fontSize: 13, fontWeight: 700, color: "#F87171" } }, fmtC(t.amount)),
                                    React.createElement("button", { onClick: () => markPaid(t.id), style: { background: "#34D39915", border: "1px solid #34D39940", color: "#34D399", borderRadius: 7, padding: "2px 7px", fontSize: 9, cursor: "pointer", fontWeight: 700, marginTop: 3 } }, T.payBtn))));
                        })));
                })())),
            tab === "transactions" && (React.createElement("div", { className: "fi" },
                React.createElement("h2", { style: { fontSize: 19, fontWeight: 800, padding: "12px 0 10px" } }, T.transactions),
                React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 7, marginBottom: 11 } },
                    React.createElement("div", { style: { marginBottom: 2 } },
                        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 6 } },
                            React.createElement("button", { onClick: () => goYear(-1), style: { background: "#0D1526", border: "1px solid #1A2640", color: "#94A3B8", borderRadius: 9, width: 28, height: 28, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 } }, "\u2039"),
                            React.createElement("div", { style: { flex: 1, textAlign: "center", fontSize: 13, fontWeight: 800, color: "#818CF8", letterSpacing: 1 } }, selYear),
                            React.createElement("button", { onClick: () => goYear(1), style: { background: "#0D1526", border: "1px solid #1A2640", color: "#94A3B8", borderRadius: 9, width: 28, height: 28, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 } }, "\u203A")),
                        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 5 } }, ALL_MONTHS.map(ym => {
                            const isFut = ym > currentYM;
                            const hasTx = txs.some(t => t.date.startsWith(ym));
                            return (React.createElement("button", { key: ym, onClick: () => setSelMon(ym), style: { padding: "6px 4px", borderRadius: 12, border: `1.5px ${isFut ? "dashed" : "solid"}`, borderColor: selMon === ym ? "#6366F1" : hasTx ? "#2A3A55" : "#1A2640", background: selMon === ym ? "#6366F120" : "transparent", color: selMon === ym ? "#818CF8" : hasTx ? "#64748B" : "#384455", fontSize: 11, fontWeight: 700, cursor: "pointer", textAlign: "center" } },
                                MONTHS_BASE[parseInt(ym.split("-")[1]) - 1],
                                hasTx && selMon !== ym && React.createElement("span", { style: { display: "block", width: 4, height: 4, borderRadius: "50%", background: "#6366F180", margin: "2px auto 0" } })));
                        }))),
                    React.createElement("div", { className: "seg" }, [[T.all, "all"], [T.pending, "pending"], [T.paid, "paid"]].map(([l, v]) => (React.createElement("button", { key: v, className: `seg-b ${fStatus === v ? "on" : "off"}`, onClick: () => setFStatus(v) }, l)))),
                    React.createElement("div", { style: { display: "flex", gap: 5, overflowX: "auto", paddingBottom: 2 } },
                        React.createElement("button", { onClick: () => setFAcc("all"), style: { padding: "3px 9px", borderRadius: 20, border: "1.5px solid", whiteSpace: "nowrap", borderColor: fAcc === "all" ? "#6366F1" : "#1A2640", background: fAcc === "all" ? "#6366F120" : "transparent", color: fAcc === "all" ? "#818CF8" : "#475569", fontSize: 9, fontWeight: 700, cursor: "pointer" } }, T.all2),
                        accs.map(a => (React.createElement("button", { key: a.id, onClick: () => setFAcc(a.id), style: { padding: "3px 9px", borderRadius: 20, border: "1.5px solid", whiteSpace: "nowrap", borderColor: fAcc === a.id ? a.color : "#1A2640", background: fAcc === a.id ? a.color + "20" : "transparent", color: fAcc === a.id ? a.color : "#475569", fontSize: 9, fontWeight: 700, cursor: "pointer" } },
                            a.icon,
                            " ",
                            a.name))))),
                selMon > currentYM && filtTx.length > 0 && (React.createElement("div", { style: { background: "#6366F112", border: "1px dashed #6366F140", borderRadius: 13, padding: "8px 13px", marginBottom: 10, display: "flex", gap: 8, alignItems: "center" } },
                    React.createElement("span", { style: { fontSize: 16 } }, "\u25B7"),
                    React.createElement("p", { style: { fontSize: 11, color: "#818CF8", fontWeight: 700 } },
                        fill(T.projRecurringFor, { m: MONTHS_BASE[parseInt(selMon.split("-")[1]) - 1] + "/" + selMon.slice(2, 4) })))),
                filtTx.length === 0 && (React.createElement("div", { style: { textAlign: "center", padding: "50px 0", color: "#475569" } },
                    React.createElement("div", { style: { fontSize: 36, marginBottom: 10 } }, "\uD83D\uDCED"),
                    React.createElement("p", { style: { fontWeight: 700 } }, T.noTx))),
                filtTx.map(t => {
                    const cat = getCatById(allCats, t.cat);
                    const acc = getTxAccountMeta(t);
                    const d = t.status === "pending" ? ddiff(t.dueDate) : null;
                    const isTransfer = t.type === "transfer_in" || t.type === "transfer_out";
                    const isProj = !!t._isProjection;
                    return (React.createElement("div", { key: t.id, role: isProj ? undefined : "button", tabIndex: isProj ? undefined : 0, onKeyDown: e => { if (!isProj && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setDetTx(t); setModal("txDet"); } }, onClick: () => { if (!isProj) {
                            setDetTx(t);
                            setModal("txDet");
                        } }, style: { background: isProj ? "#0D152A" : "#0D1526", borderRadius: 16, padding: 12, marginBottom: 7, display: "flex", gap: 9, alignItems: "center", cursor: isProj ? "default" : "pointer", border: "1px solid", borderColor: isProj ? "#6366F130" : t.status === "pending" && d !== null && d < 0 ? "#EF444435" : "#1A2640", opacity: isProj ? 0.8 : 1 } },
                        React.createElement("div", { style: { width: 40, height: 40, borderRadius: 12, background: cat.color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 } }, cat.icon),
                        React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                            React.createElement("p", { style: { fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                                t.desc,
                                t.recurrent && React.createElement("span", { style: { marginLeft: 4, fontSize: 10, color: "#64748B" } }, "\uD83D\uDD01"),
                                isTransfer && React.createElement("span", { style: { marginLeft: 4, fontSize: 10, color: "#87CEEB" } }, "\uD83D\uDD04")),
                            React.createElement("div", { style: { display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap", alignItems: "center" } },
                                React.createElement("span", { style: { fontSize: 9, color: "#475569" } }, fmtDate(t.date)),
                                acc && React.createElement("span", { style: { fontSize: 9, color: acc.color, fontWeight: 700 } }, acc.icon),
                                isProj
                                    ? React.createElement("span", { className: "pill", style: { background: "#6366F118", color: "#818CF8", border: "1px solid #6366F130" } }, T.projTag)
                                    : React.createElement("span", { className: "pill", style: { background: t.status === "paid" ? "#34D39918" : "#F59E0B18", color: t.status === "paid" ? "#34D399" : "#F59E0B", border: `1px solid ${t.status === "paid" ? "#34D39940" : "#F59E0B40"}` } }, t.status === "paid" ? T.paidL : T.paying),
                                d !== null && d < 0 && !isProj && React.createElement("span", { className: "pill", style: { background: "#EF444418", color: "#F87171", border: "1px solid #EF444440" } }, T.overdueLbl))),
                        React.createElement("p", { className: "mono", style: { fontSize: 14, fontWeight: 700, flexShrink: 0, color: isProj ? "#818CF8" : t.type === "income" || t.type === "transfer_in" ? "#34D399" : t.status === "pending" ? "#F59E0B" : "#F87171" } },
                            t.type === "income" || t.type === "transfer_in" ? "+" : "-",
                            fmtC(t.amount))));
                }))),
            tab === "alerts" && (React.createElement("div", { className: "fi" },
                React.createElement("h2", { style: { fontSize: 19, fontWeight: 800, padding: "12px 0 10px" } }, T.alertsTitle),
                overdue.length === 0 && dueSoon.length === 0 && pending.length === 0 ? (React.createElement("div", { style: { textAlign: "center", padding: "55px 0", color: "#475569" } },
                    React.createElement("div", { style: { fontSize: 46, marginBottom: 12 } }, "\uD83C\uDF89"),
                    React.createElement("p", { style: { fontSize: 16, fontWeight: 700 } }, T.allGood),
                    React.createElement("p", { style: { fontSize: 12, marginTop: 5 } }, T.noPending))) : (React.createElement(React.Fragment, null,
                    overdue.length > 0 && React.createElement(Section, { title: T.overdue, color: "#EF4444", items: overdue, accs: accs, onPay: markPaid, T: T, fmtC: fmtC, cats: allCats, lang: userCfg.lang }),
                    dueSoon.length > 0 && React.createElement(Section, { title: T.dueSoon, color: "#F59E0B", items: dueSoon, accs: accs, onPay: markPaid, T: T, fmtC: fmtC, cats: allCats, lang: userCfg.lang }),
                    pending.filter(t => ddiff(t.dueDate) > 3).length > 0 && React.createElement(Section, { title: T.upcoming, color: "#64748B", items: pending.filter(t => ddiff(t.dueDate) > 3), accs: accs, onPay: markPaid, T: T, fmtC: fmtC, cats: allCats, lang: userCfg.lang }))))),
            tab === "settings" && (React.createElement("div", { className: "fi" },
                React.createElement("h2", { style: { fontSize: 19, fontWeight: 800, padding: "12px 0 12px" } }, T.settings2),
                React.createElement("div", { className: "card", style: { marginBottom: 10 } },
                    React.createElement("p", { className: "sh" }, T.backup),
                    driveClientConfigured
                        ? React.createElement(React.Fragment, null,
                            React.createElement(SettingRow, { icon: "\u2601\uFE0F", label: T.status, note: driveOn ? T.connected : T.disconnected, right: driveOn
                                    ? React.createElement("button", { onClick: disconnectDrive, className: "btn2", style: { padding: "6px 12px", fontSize: 11 } }, T.driveDisconnect)
                                    : React.createElement("button", { onClick: connectDrive, style: { background: "#6366F120", border: "1px solid #6366F140", color: "#818CF8", borderRadius: 10, padding: "6px 12px", fontSize: 11, cursor: "pointer", fontWeight: 700 } }, T.connect) }),
                            React.createElement("p", { style: { fontSize: 10, color: "#94A3B8", margin: "6px 0 4px", lineHeight: 1.5 } }, T.driveSessionNote))
                        : React.createElement("p", { style: { fontSize: 11, color: "#94A3B8", marginBottom: 10, lineHeight: 1.5 } }, T.driveNotConfigured),
                    React.createElement("div", { style: { marginBottom: 10, marginTop: 8 } },
                        React.createElement("label", null, T.frequency),
                        React.createElement("select", { value: bkpCfg.interval, onChange: e => setBkp(p => ({ ...p, interval: e.target.value })) }, BKP_IDS.map((id, i) => React.createElement("option", { key: id, value: id }, (BKP_LABELS[userCfg.lang] || BKP_LABELS.pt)[i]))),
                        driveClientConfigured && React.createElement("p", { style: { fontSize: 10, color: "#94A3B8", marginTop: 6, lineHeight: 1.5 } }, T.driveAutoNote)),
                    bkpCfg.lastBackup && React.createElement("p", { style: { fontSize: 11, color: "#94A3B8", marginBottom: 10 } },
                        T.lastBackup,
                        ": ",
                        new Date(bkpCfg.lastBackup).toLocaleString(LOCALES[userCfg.lang] || "pt-BR")),
                    React.createElement("button", { className: "btn", onClick: doBackupDownload, style: { marginBottom: 8 } }, T.exportNow),
                    driveOn && React.createElement("button", { className: "btn2", disabled: driveBusy, onClick: () => backupToDrive(true), style: { width: "100%", textAlign: "center", marginBottom: 8 } }, T.driveSend),
                    driveClientConfigured && React.createElement("button", { className: "btn2", disabled: driveBusy, onClick: openDriveRestore, style: { width: "100%", textAlign: "center" } }, T.driveRestore)),
                React.createElement("div", { className: "card", style: { marginBottom: 10 } },
                    React.createElement("p", { className: "sh" }, T.restore),
                    React.createElement("button", { className: "btn2", style: { width: "100%", textAlign: "center" }, onClick: triggerRestore }, T.restoreBtn)),
                React.createElement("div", { className: "card", style: { marginBottom: 10 } },
                    React.createElement("p", { className: "sh" }, T.catSect),
                    (customCats || []).length === 0 && React.createElement("p", { style: { fontSize: 11, color: "#475569", marginBottom: 10 } }, T.noCustomCats),
                    (customCats || []).map(cat => (React.createElement("div", { key: cat.id, style: { display: "flex", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #111827" } },
                        React.createElement("div", { style: { width: 34, height: 34, borderRadius: 10, background: cat.color + "25", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 } }, cat.icon),
                        React.createElement("div", { style: { flex: 1 } }, catEditId === cat.id ? (React.createElement("div", { style: { display: "flex", gap: 5 } },
                            React.createElement("input", { value: catEditName, onChange: e => setCatEditName(e.target.value), style: { fontSize: 12, padding: "4px 8px" }, onKeyDown: e => { if (e.key === "Enter")
                                    renameCat(cat.id); if (e.key === "Escape") {
                                    setCatEditId(null);
                                    setCatEditName("");
                                } } }),
                            React.createElement("button", { onClick: () => renameCat(cat.id), style: { background: "#34D39920", border: "1px solid #34D39940", color: "#34D399", borderRadius: 8, padding: "4px 8px", fontSize: 11, cursor: "pointer", fontWeight: 700, flexShrink: 0 } }, "\u2713"),
                            React.createElement("button", { onClick: () => { setCatEditId(null); setCatEditName(""); }, style: { background: "#1A2640", border: "none", color: "#64748B", borderRadius: 8, padding: "4px 8px", fontSize: 11, cursor: "pointer", flexShrink: 0 } }, "\u2715"))) : (React.createElement("div", null,
                            React.createElement("p", { style: { fontSize: 13, fontWeight: 700 } }, typeof cat.label === "object" ? getCatLabel(cat, userCfg.lang) : cat.label),
                            React.createElement("p", { style: { fontSize: 10, color: "#64748B" } },
                                cat.txType === "both" ? T.catBoth : cat.txType === "income" ? T.catIncome : T.catExpense,
                                " \u00B7 ",
                                T.catCustom)))),
                        catEditId !== cat.id && React.createElement("div", { style: { display: "flex", gap: 4, flexShrink: 0 } },
                            React.createElement("button", { onClick: () => { setCatEditId(cat.id); setCatEditName(typeof cat.label === "object" ? getCatLabel(cat, userCfg.lang) : cat.label); }, style: { background: "#1A2640", border: "none", color: "#94A3B8", borderRadius: 8, padding: "4px 8px", fontSize: 10, cursor: "pointer", fontWeight: 700 } }, "\u270F\uFE0F"),
                            React.createElement("button", { onClick: () => deleteCat(cat.id), style: { background: "#EF444415", border: "1px solid #EF444430", color: "#EF4444", borderRadius: 8, padding: "4px 8px", fontSize: 10, cursor: "pointer", fontWeight: 700 } }, "\uD83D\uDDD1"))))),
                    React.createElement("p", { style: { fontSize: 11, color: "#475569", marginTop: 10, marginBottom: 8 } },
                        T.catBuiltin,
                        ":"),
                    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 } }, DEFAULT_CATS.map(cat => (React.createElement("span", { key: cat.id, style: { display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 20, background: cat.color + "18", border: `1px solid ${cat.color}40`, fontSize: 11, fontWeight: 700, color: cat.color } },
                        cat.icon,
                        " ",
                        getCatLabel(cat, userCfg.lang))))),
                    React.createElement("button", { onClick: () => { setCatForm({ name: "", icon: "📦", color: "#F0A500", txType: "both" }); setModal("addCat"); }, className: "btn2", style: { width: "100%", textAlign: "center" } }, T.catNew)),
                React.createElement("div", { className: "card", style: { marginBottom: 10 } },
                    React.createElement("p", { className: "sh" }, T.accountsSect),
                    accs.map(a => (React.createElement("div", { key: a.id, style: { display: "flex", gap: 9, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #111827" } },
                        React.createElement("div", { style: { width: 34, height: 34, borderRadius: 10, background: a.color + "25", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 } }, a.icon),
                        React.createElement("div", { style: { flex: 1 } },
                            React.createElement("p", { style: { fontSize: 13, fontWeight: 700 } }, a.name),
                            React.createElement("p", { style: { fontSize: 10, color: "#64748B" } }, typeLabel(a.type))),
                        React.createElement("div", { style: { textAlign: "right", display: "flex", flexDirection: "column", alignItems: "stretch", gap: 4, minWidth: 92 } },
                            React.createElement("p", { className: "mono", style: { fontSize: 12, fontWeight: 700, color: getAccBal(a.id) >= 0 ? a.color : "#F87171" } }, fmtC(getAccBal(a.id))),
                            React.createElement("button", { type: "button", onClick: (e) => { e.stopPropagation(); setAccs(p => p.map(x => x.id === a.id ? { ...x, includeInTotal: !x.includeInTotal } : x)); }, style: { background: a.includeInTotal ? "#34D39920" : "#1A2640", border: `1px solid ${a.includeInTotal ? "#34D39940" : "#2A3A55"}`, color: a.includeInTotal ? "#34D399" : "#475569", borderRadius: 8, padding: "3px 7px", fontSize: 9, cursor: "pointer", fontWeight: 700, width: "100%" } }, a.includeInTotal ? "∑ ON" : "∑ OFF"),
                            React.createElement("button", { type: "button", onClick: (e) => { e.stopPropagation(); openAccAdjust(a.id); }, style: { background: "#1A2640", border: "1px solid #2A3A55", color: "#94A3B8", borderRadius: 8, padding: "3px 7px", fontSize: 9, cursor: "pointer", fontWeight: 700, width: "100%", touchAction: "manipulation" } }, XT.manageAccountBtn))))),
                    React.createElement("button", { onClick: () => setModal("addAcc"), className: "btn2", style: { marginTop: 10, width: "100%", textAlign: "center" } },
                        "+ ",
                        T.newAcc)),
                React.createElement("div", { className: "card", style: { marginBottom: 10 } },
                    React.createElement("p", { className: "sh" }, T.histSect),
                    histMons.map(m => (React.createElement("div", { key: m.ym, style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #111827" } },
                        React.createElement("div", null,
                            React.createElement("p", { style: { fontSize: 13, fontWeight: 700 } }, m.label),
                            m.adjusted && React.createElement("span", { style: { fontSize: 10, color: "#F59E0B" } }, T.manual)),
                        React.createElement("div", { style: { display: "flex", gap: 5, alignItems: "center" } },
                            React.createElement("p", { className: "mono", style: { fontSize: 12, fontWeight: 700, color: m.balance >= 0 ? "#34D399" : "#F87171" } }, fmtC(m.balance)),
                            React.createElement("button", { onClick: () => { setEditBM(m.ym); setTmpBal(String(m.balance)); setModal("balAdj"); }, style: { background: "#1A2640", border: "none", color: "#64748B", borderRadius: 7, padding: "3px 7px", fontSize: 11, cursor: "pointer" } }, "\u270F\uFE0F"),
                            m.adjusted && React.createElement("button", { onClick: () => rmBal(m.ym), style: { background: "#1A2640", border: "none", color: "#EF4444", borderRadius: 7, padding: "3px 7px", fontSize: 11, cursor: "pointer" } }, "\u21BA")))))),
                supportVisible && React.createElement("div", { className: "card", style: { marginTop: 10, background: "linear-gradient(135deg,#0D1930,#0A1020)", border: "1px solid #6366F130" } },
                    React.createElement("p", { className: "sh" }, "\uD83D\uDC96 " + T.sup_title.toUpperCase()),
                    React.createElement("p", { style: { fontSize: 13, fontWeight: 700, color: "#818CF8", marginBottom: 6 } }, T.sup_tag),
                    React.createElement("p", { style: { fontSize: 12, color: "#94A3B8", lineHeight: 1.6, marginBottom: 12 } }, T.sup_intro),
                    React.createElement("div", { className: "seg", role: "tablist", style: { marginBottom: 12 } }, [["once", T.sup_seg_once], ["monthly", T.sup_seg_monthly], ["yearly", T.sup_seg_yearly]].map(([id, l]) => React.createElement("button", { key: id, type: "button", role: "tab", "aria-selected": supMode === id, className: `seg-b ${supMode === id ? "on" : "off"}`, onClick: () => setSupMode(id) }, l))),
                    React.createElement("p", { style: { fontSize: 14, fontWeight: 800 } }, supName),
                    React.createElement("p", { style: { fontSize: 11, color: "#94A3B8", marginBottom: 10 } }, { once: T.sup_once_desc, monthly: T.sup_monthly_desc, yearly: T.sup_yearly_desc }[supMode]),
                    supMode === "once" && React.createElement("div", { style: { marginBottom: 10 } },
                        React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } }, [1, 3, 5, 10].map(v => React.createElement("button", { key: v, type: "button", "aria-pressed": !supOther && supAmt === v, className: "cat-chip", style: { background: !supOther && supAmt === v ? "#6366F125" : "transparent", borderColor: !supOther && supAmt === v ? "#6366F1" : "#1F2D45", color: !supOther && supAmt === v ? "#C7D2FE" : "#94A3B8", fontSize: 13, padding: "6px 14px" }, onClick: () => { setSupOther(false); setSupAmt(v); } }, supFmtUsd(v))).concat(React.createElement("button", { key: "o", type: "button", "aria-pressed": supOther, className: "cat-chip", style: { background: supOther ? "#6366F125" : "transparent", borderColor: supOther ? "#6366F1" : "#1F2D45", color: supOther ? "#C7D2FE" : "#94A3B8", fontSize: 13, padding: "6px 14px" }, onClick: () => { setSupOther(true); setSupAmt(""); } }, T.sup_other))),
                        supOther && React.createElement("div", { style: { marginTop: 10 } },
                            React.createElement("label", { htmlFor: "sup-amt" }, T.sup_amount),
                            React.createElement("input", { id: "sup-amt", type: "number", inputMode: "decimal", min: 1, max: 500, step: "1", placeholder: "5", value: supAmt, onChange: e => setSupAmt(e.target.value) }))),
                    React.createElement("div", { style: { background: "#111827", borderRadius: 14, padding: "12px 14px", marginBottom: 10 } },
                        React.createElement("p", { className: "mono", style: { fontSize: 22, fontWeight: 800, color: "#34D399" } }, supUsdOk ? supFmtUsd(supUsd) : "—"),
                        React.createElement("p", { style: { fontSize: 11, color: "#94A3B8" } }, { once: T.sup_per_once, monthly: T.sup_per_month, yearly: T.sup_per_year }[supMode]),
                        supUsdOk && React.createElement("p", { style: { fontSize: 11, color: "#64748B", marginTop: 4 } }, fill(T.sup_brl_hint, { v: supFmtBrl(supUsd * supRate) })),
                        supMode === "yearly" && React.createElement("p", { style: { fontSize: 11, color: "#818CF8", marginTop: 4, fontWeight: 700 } }, fill(T.sup_year_note, { m: supFmtUsd(Math.round(SUP.yearly / 12 * 100) / 100), pct: supyearPct }))),
                    supMode !== "once" && React.createElement("p", { style: { fontSize: 11, color: "#94A3B8", lineHeight: 1.5, marginBottom: 10 } }, T.sup_recur),
                    React.createElement("button", { className: "btn", disabled: !supChannel || !supUsdOk, onClick: supPay }, fill(T.sup_cta, { v: supUsdOk ? supFmtUsd(supUsd) : "" }).trim()),
                    !supChannel && React.createElement("p", { role: "status", style: { fontSize: 11, color: "#F59E0B", marginTop: 8, lineHeight: 1.5 } }, T.sup_soon),
                    React.createElement("p", { style: { fontSize: 11, color: "#94A3B8", marginTop: 10, lineHeight: 1.5 } }, T.sup_optional),
                    React.createElement("p", { style: { fontSize: 10, color: "#64748B", marginTop: 4, lineHeight: 1.5 } }, T.sup_privacy)),
                deferPmt && React.createElement("div", { className: "card", style: { marginTop: 10 } },
                    React.createElement("p", { className: "sh" }, T.installSect),
                    React.createElement("p", { style: { fontSize: 12, color: "#94A3B8", marginBottom: 10 } }, T.installDesc),
                    React.createElement("button", { className: "btn", onClick: () => { deferPmt.prompt(); deferPmt.userChoice.then(() => setDeferPmt(null)); }, style: { background: "linear-gradient(135deg,#10B981,#059669)" } }, T.installBtn)))),
            tab === "user" && (React.createElement("div", { className: "fi" },
                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "14px 0 16px" } },
                    React.createElement("div", { style: { width: 54, height: 54, borderRadius: 18, background: "linear-gradient(135deg,#6366F1,#4F46E5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 } }, "\uD83D\uDC64"),
                    React.createElement("div", null,
                        React.createElement("p", { style: { fontSize: 18, fontWeight: 800 } }, T.userTitle))),
                React.createElement("div", { className: "card", style: { marginBottom: 10 } },
                    React.createElement("p", { className: "sh" }, T.langSect),
                    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 7 } }, Object.entries(I18N).map(([k, v]) => (React.createElement("button", { key: k, onClick: () => setUser(p => ({ ...p, lang: k })), style: { padding: "7px 12px", borderRadius: 20, border: "1.5px solid", borderColor: userCfg.lang === k ? "#6366F1" : "#1A2640", background: userCfg.lang === k ? "#6366F120" : "transparent", color: userCfg.lang === k ? "#818CF8" : "#64748B", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", gap: 5, alignItems: "center" } },
                        React.createElement("span", null, v.flag),
                        React.createElement("span", null, v.lang)))))),
                React.createElement("div", { className: "card", style: { marginBottom: 10 } },
                    React.createElement("p", { className: "sh" }, T.currSect),
                    React.createElement("select", { value: userCfg.currency, onChange: e => setUser(p => ({ ...p, currency: e.target.value })) }, CURRENCIES.map(c => React.createElement("option", { key: c.id, value: c.id },
                        c.flag,
                        " ",
                        c.label)))),
                React.createElement("div", { className: "card", style: { marginBottom: 10 } },
                    React.createElement("p", { className: "sh" }, T.secSect),
                    React.createElement(SettingRow, { icon: "\uD83D\uDD10", label: T.pinEnable, right: React.createElement(Toggle, { label: T.pinEnable, val: userCfg.pinEnabled, onChange: v => { if (v) {
                                setShowPin(true);
                                setPinStep(1);
                                setPin1("");
                                setPin2("");
                            }
                            else
                                disablePin(); } }) }),
                    userCfg.pinEnabled && React.createElement("button", { onClick: () => { setShowPin(true); setPinStep(1); setPin1(""); setPin2(""); }, style: { marginTop: 8, background: "#1A2640", border: "none", color: "#64748B", borderRadius: 10, padding: "7px 14px", fontSize: 11, cursor: "pointer", fontWeight: 700 } },
                        "\uD83D\uDD11 ",
                        T.pinChange),
                    React.createElement(SettingRow, { icon: "\uD83D\uDC46", label: T.biometric, note: T.biometricNote, right: React.createElement(Toggle, { label: T.biometric, val: userCfg.biometric, onChange: toggleBio }) }),
                    React.createElement("p", { style: { fontSize: 10, color: "#94A3B8", marginTop: 8, lineHeight: 1.5 } }, T.pinHint)),
                React.createElement("div", { className: "card", style: { marginBottom: 10 } },
                    React.createElement("p", { className: "sh" }, T.tipsSect),
                    React.createElement(SettingRow, { icon: "\uD83D\uDCA1", label: T.tipsEnable, note: T.tipsNote, right: React.createElement(Toggle, { label: T.tipsEnable, val: userCfg.tipsEnabled, onChange: v => setUser(p => ({ ...p, tipsEnabled: v })) }) }),
                    React.createElement("button", { onClick: () => setShowTip(true), style: { marginTop: 8, background: "#6366F120", border: "1px solid #6366F140", color: "#818CF8", borderRadius: 10, padding: "7px 14px", fontSize: 11, cursor: "pointer", fontWeight: 700 } }, T.seeTipNow)),
                showPin && (React.createElement("div", { style: { position: "fixed", inset: 0, background: "#000D", zIndex: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 } },
                    React.createElement("p", { style: { fontSize: 18, fontWeight: 800, color: "#E8EDF5" } }, T.pinTitle),
                    React.createElement("p", { style: { fontSize: 13, color: "#64748B" } }, pinStep === 1 ? T.pinEnterNew : T.pinConfirm),
                    React.createElement("div", { style: { display: "flex", gap: 12 } }, [0, 1, 2, 3].map(i => { const cur = pinStep === 1 ? pin1 : pin2; return (React.createElement("div", { key: i, style: { width: 16, height: 16, borderRadius: "50%", background: cur.length > i ? "#6366F1" : "#1F2D45", transition: "background .2s" } })); })),
                    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(3,68px)", gap: 10 } }, [1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map((d, i) => (React.createElement("button", { key: i, onClick: () => d === "" ? null : d === "⌫" ? delPinKey() : handlePinKey(String(d)), style: { width: 68, height: 68, borderRadius: 16, fontSize: 22, fontWeight: 700, background: d === "" ? "transparent" : "#111827", border: d === "" ? "none" : "1px solid #1F2D45", color: d === "⌫" ? "#EF4444" : "#E8EDF5", cursor: d === "" ? "default" : "pointer" } }, d)))),
                    React.createElement("button", { onClick: () => { setShowPin(false); }, style: { background: "none", border: "none", color: "#64748B", fontSize: 13, cursor: "pointer", fontWeight: 700 } }, T.cancel)))))),
        React.createElement("button", { type: "button", "aria-label": T.newTx, onClick: openNewTx, style: { position: "fixed", bottom: 80, right: "max(14px, calc(50% - 215px + 14px))", width: 51, height: 51, borderRadius: "50%", background: "linear-gradient(135deg,#6366F1,#4F46E5)", border: "none", color: "white", fontSize: 26, cursor: "pointer", boxShadow: "0 8px 24px #6366F155", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 } }, "+"),
        React.createElement("div", { style: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "#080C18", borderTop: "1px solid #1A2640", display: "flex", zIndex: 40, paddingBottom: "max(env(safe-area-inset-bottom,0px),5px)" } }, [["home", "🏠", T.home], ["transactions", "📋", T.extract], ["alerts", "🔔" + (overdue.length + dueSoon.length > 0 ? " " + (overdue.length + dueSoon.length) : ""), T.alerts], ["settings", "⚙️", T.settings], ["user", "👤", T.user]].map(([id, icon, label]) => (React.createElement("button", { key: id, className: `tab ${tab === id ? "on" : ""}`, type: "button", "aria-current": tab === id ? "page" : undefined, onClick: () => switchTab(id), style: { touchAction: "manipulation" } },
            React.createElement("span", { style: { fontSize: 19 } }, icon),
            React.createElement("span", { style: { fontSize: 8 } }, label))))),
        modal === "addTx" && (React.createElement(Overlay, { onClose: closeTxModal },
            React.createElement(MH, { closeLabel: T.close, title: editId ? T.editTx : T.newTx, onClose: closeTxModal }),
            React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 12 } }, [[T.expenseBtn, "expense", "#EF4444"], [T.incomeBtn, "income", "#34D399"], [T.transferBtn, "transfer", "#87CEEB"]].filter(x => !(editId && x[1] === "transfer")).map(([l, v, c]) => (React.createElement("button", { key: v, onClick: () => { if (v === "transfer") {
                    if ((accs || []).length < 2) {
                        toast_(T.needTwoAccounts, "#EF4444");
                        return;
                    }
                    setModal("addTransfer");
                }
                else
                    setForm(f => ({ ...f, type: v })); }, style: { flex: 1, padding: "9px 4px", borderRadius: 11, border: `1.5px solid ${form.type === v && v !== "transfer" ? c : "#1F2D45"}`, background: form.type === v && v !== "transfer" ? c + "22" : "transparent", color: form.type === v && v !== "transfer" ? c : "#64748B", fontSize: 11, fontWeight: 700, cursor: "pointer" } }, l)))),
            React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 11 } },
                React.createElement("div", null,
                    React.createElement("label", null, T.description),
                    React.createElement("input", { maxLength: 120, placeholder: T.descPh, value: form.desc, onChange: e => setForm(f => ({ ...f, desc: e.target.value })) })),
                React.createElement("div", { style: { display: "flex", gap: 8 } },
                    React.createElement("div", { style: { flex: 1 } },
                        React.createElement("label", null, form.installments ? `${T.totalValue} (${CURR.symbol})` : T.amount + ` (${CURR.symbol})`),
                        React.createElement("input", { type: "number", inputMode: "decimal", min: 0, step: "0.01", placeholder: "0,00", value: form.installments ? (form.installmentTotal || "") : (form.amount), onChange: e => form.installments ? setForm(f => ({ ...f, installmentTotal: e.target.value, amount: round2((parseFloat(e.target.value) || 0) / (f.installCount || 2)) })) : setForm(f => ({ ...f, amount: e.target.value })) })),
                    React.createElement("div", { style: { flex: 1 } },
                        React.createElement("label", null, T.account),
                        React.createElement("select", { value: form.accountId, onChange: e => setForm(f => ({ ...f, accountId: e.target.value })) }, accs.map(a => React.createElement("option", { key: a.id, value: a.id },
                            a.icon,
                            " ",
                            a.name))))),
                form.installments && form.installmentTotal && parseFloat(form.installmentTotal) > 0 && (React.createElement("div", { style: { background: "#111827", borderRadius: 12, padding: "9px 13px", marginTop: -4 } },
                    React.createElement("p", { style: { fontSize: 10, color: "#64748B", marginBottom: 4, fontWeight: 700 } }, T.installPreview),
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
                        React.createElement("span", { style: { fontSize: 12, color: "#94A3B8" } },
                            fill(T.timesOf, { n: form.installCount })),
                        React.createElement("span", { className: "mono", style: { fontSize: 16, fontWeight: 800, color: "#F59E0B" } }, fmtC(round2((parseFloat(form.installmentTotal) || 0) / form.installCount)))),
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3 } },
                        React.createElement("span", { style: { fontSize: 11, color: "#94A3B8" } }, T.total),
                        React.createElement("span", { className: "mono", style: { fontSize: 12, color: "#64748B" } }, fmtC(parseFloat(form.installmentTotal) || 0))))),
                React.createElement("div", { style: { display: "flex", gap: 8 } },
                    React.createElement("div", { style: { flex: 1 } },
                        React.createElement("label", null, T.category),
                        React.createElement("select", { value: form.cat, onChange: e => setForm(f => ({ ...f, cat: e.target.value })) }, formCats.map(c => React.createElement("option", { key: c.id, value: c.id },
                            c.icon,
                            " ",
                            getCatLabel(c, userCfg.lang))))),
                    React.createElement("div", { style: { flex: 1 } },
                        React.createElement("label", null, T.statusL),
                        React.createElement("select", { value: form.status, onChange: e => setForm(f => ({ ...f, status: e.target.value })) },
                            React.createElement("option", { value: "pending" }, T.paying),
                            React.createElement("option", { value: "paid" }, T.paidL)))),
                form.status === "pending" && React.createElement("div", null,
                    React.createElement("label", null, T.dueDate),
                    React.createElement("input", { type: "date", value: form.dueDate, onChange: e => setForm(f => ({ ...f, dueDate: e.target.value })) })),
                React.createElement("div", { style: { background: "#111827", borderRadius: 12, padding: 11 } },
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: form.recurrent ? 9 : 0 } },
                        React.createElement("span", { style: { fontSize: 12, fontWeight: 700, color: "#94A3B8" } }, T.recurrent),
                        React.createElement(Toggle, { label: T.recurrent, val: form.recurrent, onChange: v => setForm(f => ({ ...f, recurrent: v, installments: v ? false : f.installments })) })),
                    form.recurrent && React.createElement("select", { value: form.recurrence, onChange: e => setForm(f => ({ ...f, recurrence: e.target.value })) },
                        React.createElement("option", { value: "weekly" }, T.weekly),
                        React.createElement("option", { value: "monthly" }, T.monthly),
                        React.createElement("option", { value: "yearly" }, T.yearly))),
                form.type === "expense" && !form.recurrent && !editId && (React.createElement("div", { style: { background: "#111827", borderRadius: 12, padding: 11 } },
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: form.installments ? 9 : 0 } },
                        React.createElement("span", { style: { fontSize: 12, fontWeight: 700, color: "#94A3B8" } }, T.installments),
                        React.createElement(Toggle, { label: T.installments, val: form.installments, onChange: v => setForm(f => ({ ...f, installments: v, installmentTotal: v ? (f.installmentTotal || f.amount) : "", amount: v ? f.amount : (f.installmentTotal || f.amount), recurrent: v ? false : f.recurrent })) })),
                    form.installments && React.createElement("div", null,
                        React.createElement("label", null, T.installCount),
                        React.createElement("input", { type: "number", inputMode: "numeric", min: 2, max: 48, value: form.installCount, onChange: e => { const n = Math.min(48, Math.max(2, parseInt(e.target.value) || 2)); setForm(f => ({ ...f, installCount: n, amount: f.installmentTotal ? round2((parseFloat(f.installmentTotal) || 0) / n) : f.amount })); } })))),
                !editId && React.createElement("div", { style: { background: "#111827", borderRadius: 12, padding: 11 } },
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: form.scheduled ? 9 : 0 } },
                        React.createElement("span", { style: { fontSize: 12, fontWeight: 700, color: "#94A3B8" } }, T.scheduled),
                        React.createElement(Toggle, { label: T.scheduled, val: form.scheduled, onChange: v => setForm(f => ({ ...f, scheduled: v })) })),
                    form.scheduled && React.createElement(React.Fragment, null, React.createElement("input", { type: "date", value: form.scheduledDate, onChange: e => setForm(f => ({ ...f, scheduledDate: e.target.value, date: e.target.value })) }), React.createElement("p", { style: { fontSize: 10, color: "#94A3B8", marginTop: 6 } }, T.scheduledNote))),
                React.createElement("button", { className: "btn", onClick: addTx }, editId ? T.saveEdit : form.installments ? fill(T.createParcels, { n: form.installCount }) : T.addTx)))),
        modal === "addTransfer" && (React.createElement(Overlay, { onClose: () => setModal(null) },
            React.createElement(MH, { closeLabel: T.close, title: T.transferBtn, onClose: () => setModal(null) }),
            React.createElement("div", { style: { background: "#87CEEB18", border: "1px solid #87CEEB40", borderRadius: 14, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 8, alignItems: "center" } },
                React.createElement("span", { style: { fontSize: 22 } }, "\uD83D\uDD04"),
                React.createElement("p", { style: { fontSize: 12, color: "#87CEEB", fontWeight: 600, lineHeight: 1.4 } },
                    T.transferSect,
                    React.createElement("br", null),
                    React.createElement("span", { style: { fontWeight: 400, color: "#64748B", fontSize: 11 } }, T.transferInfo))),
            React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 11 } },
                React.createElement("div", null,
                    React.createElement("label", null, T.description),
                    React.createElement("input", { placeholder: T.transferDescPh, value: trForm.desc, onChange: e => setTrForm(f => ({ ...f, desc: e.target.value })) })),
                React.createElement("div", null,
                    React.createElement("label", null,
                        T.amount,
                        " (",
                        CURR.symbol,
                        ")"),
                    React.createElement("input", { type: "number", inputMode: "decimal", min: 0, step: "0.01", placeholder: "0,00", value: trForm.amount, onChange: e => setTrForm(f => ({ ...f, amount: e.target.value })) })),
                React.createElement("div", null,
                    React.createElement("label", null, T.fromAccount),
                    React.createElement("select", { value: trForm.fromAccountId, onChange: e => setTrForm(f => ({ ...f, fromAccountId: e.target.value })) }, accs.map(a => React.createElement("option", { key: a.id, value: a.id },
                        a.icon,
                        " ",
                        a.name,
                        " \u2014 ",
                        fmtC(getAccBal(a.id)))))),
                React.createElement("div", { style: { display: "flex", justifyContent: "center", fontSize: 22, margin: "-4px 0" } }, "\u2B07\uFE0F"),
                React.createElement("div", null,
                    React.createElement("label", null, T.toAccount),
                    React.createElement("select", { value: trForm.toAccountId, onChange: e => setTrForm(f => ({ ...f, toAccountId: e.target.value })) }, accs.map(a => React.createElement("option", { key: a.id, value: a.id },
                        a.icon,
                        " ",
                        a.name,
                        " \u2014 ",
                        fmtC(getAccBal(a.id)))))),
                trForm.fromAccountId && trForm.toAccountId && trForm.fromAccountId === trForm.toAccountId && (React.createElement("p", { style: { fontSize: 11, color: "#EF4444", fontWeight: 700, textAlign: "center" } },
                    "\u26A0\uFE0F ",
                    T.sameAccountErr)),
                React.createElement("div", null,
                    React.createElement("label", null, T.date),
                    React.createElement("input", { type: "date", value: trForm.date, onChange: e => setTrForm(f => ({ ...f, date: e.target.value })) })),
                React.createElement("div", null,
                    React.createElement("label", null, T.statusL),
                    React.createElement("select", { value: trForm.status, onChange: e => setTrForm(f => ({ ...f, status: e.target.value })) },
                        React.createElement("option", { value: "paid" }, T.paidL),
                        React.createElement("option", { value: "pending" }, T.paying))),
                trForm.amount && parseFloat(trForm.amount) > 0 && trForm.fromAccountId && trForm.toAccountId && trForm.fromAccountId !== trForm.toAccountId && (React.createElement("div", { style: { background: "#111827", borderRadius: 12, padding: "10px 14px" } },
                    React.createElement("p", { style: { fontSize: 11, color: "#64748B", marginBottom: 6, fontWeight: 700 } }, T.preview.toUpperCase()),
                    React.createElement(Row, { label: `💸 ${(accs.find(a => a.id === trForm.fromAccountId) || {}).name || ""}`, val: React.createElement("span", { className: "mono", style: { color: "#F87171" } },
                            "-",
                            fmtC(parseFloat(trForm.amount) || 0)) }),
                    React.createElement(Row, { label: `💰 ${(accs.find(a => a.id === trForm.toAccountId) || {}).name || ""}`, val: React.createElement("span", { className: "mono", style: { color: "#34D399" } },
                            "+",
                            fmtC(parseFloat(trForm.amount) || 0)), border: false }))),
                React.createElement("button", { className: "btn", onClick: addTransfer, style: { background: "linear-gradient(135deg,#0EA5E9,#0284C7)" } }, T.addTransfer)))),
        modal === "addCat" && (React.createElement(Overlay, { onClose: () => setModal(null) },
            React.createElement(MH, { closeLabel: T.close, title: T.catNew, onClose: () => setModal(null) }),
            React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 11 } },
                React.createElement("div", null,
                    React.createElement("label", null, T.catName),
                    React.createElement("input", { maxLength: 40, placeholder: T.catNamePh, value: catForm.name, onChange: e => setCatForm(f => ({ ...f, name: e.target.value })) })),
                React.createElement("div", null,
                    React.createElement("label", null, T.catIcon),
                    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 } }, CAT_PRESET_ICONS.map(ic => (React.createElement("button", { key: ic, onClick: () => setCatForm(f => ({ ...f, icon: ic })), style: { width: 38, height: 38, borderRadius: 10, fontSize: 18, cursor: "pointer", background: catForm.icon === ic ? "#6366F130" : "#111827", border: `1.5px solid ${catForm.icon === ic ? "#6366F1" : "#1F2D45"}` } }, ic)))),
                    React.createElement("input", { placeholder: T.catEmojiPh, value: catForm.icon, onChange: e => setCatForm(f => ({ ...f, icon: e.target.value.slice(0, 4) || "📦" })), style: { fontSize: 20 } })),
                React.createElement("div", null,
                    React.createElement("label", null, T.catColor),
                    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } }, CAT_PRESET_COLORS.map(c => (React.createElement("button", { key: c, onClick: () => setCatForm(f => ({ ...f, color: c })), style: { width: 28, height: 28, borderRadius: "50%", background: c, cursor: "pointer", border: `2.5px solid ${catForm.color === c ? "#fff" : "transparent"}` } }))))),
                React.createElement("div", null,
                    React.createElement("label", null, T.catType),
                    React.createElement("div", { className: "seg" }, [["both", T.catBoth], ["income", T.catIncome], ["expense", T.catExpense]].map(([v, l]) => (React.createElement("button", { key: v, className: `seg-b ${catForm.txType === v ? "on" : "off"}`, onClick: () => setCatForm(f => ({ ...f, txType: v })) }, l))))),
                React.createElement("div", { style: { display: "flex", justifyContent: "center", padding: "8px 0" } },
                    React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 20, background: catForm.color + "22", border: `1.5px solid ${catForm.color}50`, fontSize: 14, fontWeight: 700, color: catForm.color } },
                        catForm.icon || "📦",
                        " ",
                        catForm.name || T.preview)),
                React.createElement("button", { className: "btn", onClick: addCat }, T.catAdd)))),
        modal === "addAcc" && (React.createElement(Overlay, { onClose: () => setModal(null) },
            React.createElement(MH, { closeLabel: T.close, title: T.newAcc, onClose: () => setModal(null) }),
            React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 11 } },
                React.createElement("div", null,
                    React.createElement("label", null, T.accName),
                    React.createElement("input", { placeholder: T.accNamePh, value: aForm.name, onChange: e => setAForm(f => ({ ...f, name: e.target.value })) })),
                React.createElement("div", null,
                    React.createElement("label", null, T.accType),
                    React.createElement("select", { value: aForm.type, onChange: e => setAForm(f => ({ ...f, type: e.target.value })) },
                        React.createElement("option", { value: "checking" }, T.checking),
                        React.createElement("option", { value: "savings" }, T.savings),
                        React.createElement("option", { value: "credit" }, T.credit),
                        React.createElement("option", { value: "wallet" }, XT.wallet))),
                React.createElement("div", null,
                    React.createElement("label", null, XT.openingBalance),
                    React.createElement("input", { type: "number", inputMode: "decimal", placeholder: "0,00", value: aForm.openingBalance, onChange: e => setAForm(f => ({ ...f, openingBalance: e.target.value })) })),
                React.createElement("div", null,
                    React.createElement("label", null, T.icon),
                    React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } }, ACC_ICONS.map(ic => (React.createElement("button", { key: ic, onClick: () => setAForm(f => ({ ...f, icon: ic })), style: { width: 40, height: 40, borderRadius: 10, fontSize: 20, cursor: "pointer", background: aForm.icon === ic ? "#6366F130" : "#111827", border: `1.5px solid ${aForm.icon === ic ? "#6366F1" : "#1F2D45"}` } }, ic))))),
                React.createElement("div", null,
                    React.createElement("label", null, T.color),
                    React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } }, ACC_COLORS.map(c => (React.createElement("button", { key: c, onClick: () => setAForm(f => ({ ...f, color: c })), style: { width: 30, height: 30, borderRadius: "50%", background: c, cursor: "pointer", border: `2.5px solid ${aForm.color === c ? "#fff" : "transparent"}` } }))))),
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#111827", borderRadius: 12, padding: "10px 12px" } },
                    React.createElement("span", { style: { fontSize: 12, fontWeight: 700, color: "#94A3B8" } }, T.includeTotal),
                    React.createElement(Toggle, { label: T.includeTotal, val: aForm.includeInTotal, onChange: v => setAForm(f => ({ ...f, includeInTotal: v })) })),
                React.createElement("button", { className: "btn", onClick: addAcc }, T.addAcc)))),
        modal === "backup" && (React.createElement(Overlay, { onClose: () => setModal(null) },
            React.createElement(MH, { closeLabel: T.close, title: T.backupModal, onClose: () => setModal(null) }),
            React.createElement("div", { style: { textAlign: "center", padding: "8px 0 16px" } },
                React.createElement("div", { style: { fontSize: 50, marginBottom: 8 } }, "\u2601\uFE0F"),
                React.createElement("p", { style: { fontSize: 13, fontWeight: 700, marginBottom: 5 } }, T.backupWord),
                React.createElement("p", { style: { fontSize: 12, color: "#64748B" } }, bkpCfg.driveConnected ? T.driveConnected : T.driveDisconn)),
            React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } },
                React.createElement("div", null,
                    React.createElement("label", null, T.frequency),
                    React.createElement("select", { value: bkpCfg.interval, onChange: e => setBkp(p => ({ ...p, interval: e.target.value })) }, BKP_IDS.map((id, i) => React.createElement("option", { key: id, value: id }, (BKP_LABELS[userCfg.lang] || BKP_LABELS.pt)[i])))),
                bkpCfg.lastBackup && React.createElement("div", { style: { background: "#111827", borderRadius: 12, padding: "9px 14px", textAlign: "center" } },
                    React.createElement("p", { style: { fontSize: 10, color: "#64748B" } }, T.lastBackup),
                    React.createElement("p", { style: { fontSize: 12, fontWeight: 700, marginTop: 2 } }, new Date(bkpCfg.lastBackup).toLocaleString())),
                React.createElement("button", { className: "btn", onClick: () => { doBackupDownload(); setModal(null); } }, T.exportBackup),
                driveClientConfigured && (driveOn ? React.createElement("button", { className: "btn2", disabled: driveBusy, style: { width: "100%", textAlign: "center" }, onClick: () => { backupToDrive(true); setModal(null); } }, T.driveSend) : React.createElement("button", { className: "btn2", style: { width: "100%", textAlign: "center" }, onClick: () => { connectDrive(); setModal(null); } }, T.connectDrive)),
                React.createElement("p", { style: { fontSize: 10, color: "#475569", textAlign: "center" } }, T.backupNote)))),
        modal === "restoreConfirm" && (React.createElement(Overlay, { onClose: () => { setModal(null); setRestoreConfirm(null); } },
            React.createElement(MH, { closeLabel: T.close, title: T.restore, onClose: () => { setModal(null); setRestoreConfirm(null); } }),
            React.createElement("div", { style: { textAlign: "center", padding: "10px 0 20px" } },
                React.createElement("div", { style: { fontSize: 46, marginBottom: 10 } }, "\u26A0\uFE0F"),
                React.createElement("p", { style: { fontSize: 15, fontWeight: 800, color: "#F59E0B", marginBottom: 8 } }, T.restoreWarn.split("⚠️ ")[1] || T.restoreWarn),
                restoreConfirm && React.createElement("p", { style: { fontSize: 11, color: "#94A3B8" } }, fill(T.txCount, { t: restoreConfirm.transactions.length, a: restoreConfirm.accounts.length }))),
            React.createElement("div", { style: { display: "flex", gap: 8 } },
                React.createElement("button", { className: "btn2", style: { flex: 1, textAlign: "center" }, onClick: () => { setModal(null); setRestoreConfirm(null); } }, T.restoreCancel),
                React.createElement("button", { onClick: doRestore, style: { flex: 2, background: "linear-gradient(135deg,#EF4444,#DC2626)", border: "none", color: "#fff", borderRadius: 13, padding: "13px", fontSize: 14, fontWeight: 700, cursor: "pointer" } }, T.restoreConfirm)))),
        modal === "balAdj" && (React.createElement(Overlay, { onClose: () => setModal(null) },
            React.createElement(MH, { closeLabel: T.close, title: T.adjustMonth, onClose: () => setModal(null) }),
            React.createElement("div", { style: { textAlign: "center", marginBottom: 16 } },
                React.createElement("p", { style: { fontSize: 24, marginBottom: 5 } }, "\u270F\uFE0F"),
                React.createElement("p", { style: { fontSize: 15, fontWeight: 700 } }, editBM && MONTHS_BASE[parseInt(editBM.split("-")[1]) - 1] + "/" + editBM?.slice(2, 4)),
                React.createElement("p", { style: { fontSize: 11, color: "#64748B", marginTop: 3 } },
                    T.calculated,
                    ": ",
                    React.createElement("span", { className: "mono", style: { color: "#94A3B8" } }, fmtC(getMonBal(editBM || ""))))),
            React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 11 } },
                React.createElement("div", null,
                    React.createElement("label", null,
                        T.corrected,
                        " (",
                        CURR.symbol,
                        ")"),
                    React.createElement("input", { type: "number", inputMode: "decimal", value: tmpBal, onChange: e => setTmpBal(e.target.value) })),
                React.createElement("p", { style: { fontSize: 11, color: "#64748B" } }, T.adjustHint),
                React.createElement("button", { className: "btn", onClick: saveBal }, T.save),
                balH[editBM || ""]?.adjusted && React.createElement("button", { className: "btn2", style: { textAlign: "center", width: "100%" }, onClick: () => { rmBal(editBM || ""); setModal(null); } }, T.removeAdj)))),
        modal === "accAdj" && editAccId && (() => {
            const acc = accs.find(a => a.id === editAccId);
            if (!acc)
                return null;
            const current = getAccBal(editAccId);
            const real = parseFloat(accRealBal);
            const diff = isNaN(real) ? 0 : round2(real - current);
            const otherAccs = accs.filter(a => a.id !== editAccId);
            return (React.createElement(Overlay, { onClose: () => setModal(null) },
                React.createElement(MH, { closeLabel: T.close, title: XT.adjustAccount, onClose: () => setModal(null) }),
                React.createElement("div", { style: { background: "#111827", borderRadius: 14, padding: 12, marginBottom: 12, display: "flex", gap: 10, alignItems: "center" } },
                    React.createElement("div", { style: { width: 42, height: 42, borderRadius: 12, background: acc.color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 } }, acc.icon),
                    React.createElement("div", null,
                        React.createElement("p", { style: { fontSize: 14, fontWeight: 800 } }, acc.name),
                        React.createElement("p", { style: { fontSize: 11, color: "#64748B" } }, typeLabel(acc.type)))),
                React.createElement("div", { className: "card", style: { marginBottom: 12 } },
                    React.createElement("p", { className: "sh" }, T.accData),
                    React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } },
                        React.createElement("div", null,
                            React.createElement("label", null, T.accName),
                            React.createElement("input", { value: accEditName, onChange: e => setAccEditName(e.target.value) })),
                        React.createElement("div", null,
                            React.createElement("label", null, T.accType),
                            React.createElement("select", { value: accEditType, onChange: e => setAccEditType(e.target.value) },
                                React.createElement("option", { value: "checking" }, T.checking),
                                React.createElement("option", { value: "savings" }, T.savings),
                                React.createElement("option", { value: "credit" }, T.credit),
                                React.createElement("option", { value: "wallet" }, XT.wallet))),
                        React.createElement("div", null,
                            React.createElement("label", null, T.icon),
                            React.createElement("input", { value: accEditIcon, maxLength: 8, onChange: e => setAccEditIcon(e.target.value) })),
                        React.createElement("label", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 } },
                            T.includeTotal,
                            React.createElement(Toggle, { label: T.includeTotal, val: accEditIncluded, onChange: setAccEditIncluded })),
                        React.createElement("button", { className: "btn", onClick: saveAccountDetails }, T.saveAccData))),
                React.createElement("div", { className: "card", style: { marginBottom: 12 } },
                    React.createElement("p", { className: "sh" }, XT.adjustBalanceBtn),
                    React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 11 } },
                        React.createElement("div", null,
                            React.createElement("label", null, XT.currentAccountBalance),
                            React.createElement("div", { className: "card", style: { padding: "12px 14px", borderRadius: 12 } },
                                React.createElement("span", { className: "mono", style: { fontSize: 16, fontWeight: 800, color: current >= 0 ? "#34D399" : "#F87171" } }, fmtC(current)))),
                        React.createElement("div", null,
                            React.createElement("label", null, XT.realAccountBalance),
                            React.createElement("input", { type: "number", inputMode: "decimal", value: accRealBal, onChange: e => setAccRealBal(e.target.value) })),
                        React.createElement("div", null,
                            React.createElement("label", null, XT.difference),
                            React.createElement("div", { className: "card", style: { padding: "12px 14px", borderRadius: 12 } },
                                React.createElement("span", { className: "mono", style: { fontSize: 16, fontWeight: 800, color: diff >= 0 ? "#34D399" : "#F87171" } }, fmtC(diff)))),
                        React.createElement("div", null,
                            React.createElement("label", null, XT.adjustmentNote),
                            React.createElement("input", { placeholder: XT.adjustmentNotePh, value: accAdjNote, onChange: e => setAccAdjNote(e.target.value) })),
                        React.createElement("p", { style: { fontSize: 11, color: "#64748B" } }, XT.adjustAccountHint),
                        React.createElement("button", { className: "btn", onClick: saveAccAdjustmentTx }, XT.generateAdjustment),
                        React.createElement("button", { className: "btn2", style: { width: "100%", textAlign: "center" }, onClick: saveAccBaseCorrection }, XT.correctBaseBalance))),
                React.createElement("div", { className: "card" },
                    React.createElement("p", { className: "sh" }, XT.deleteAccount),
                    React.createElement("p", { style: { fontSize: 11, color: "#64748B", marginBottom: 10 } }, XT.deleteAccountHint),
                    React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 11 } },
                        React.createElement("div", null,
                            React.createElement("label", null, XT.futurePendingAction),
                            React.createElement("div", { className: "seg" },
                                React.createElement("button", { className: `seg-b ${accDeleteFutureMode === "transfer" ? "on" : "off"}`, onClick: () => setAccDeleteFutureMode("transfer") }, XT.transferFutureTo),
                                React.createElement("button", { className: `seg-b ${accDeleteFutureMode === "delete" ? "on" : "off"}`, onClick: () => setAccDeleteFutureMode("delete") }, XT.deleteFutureTx))),
                        accDeleteFutureMode === "transfer" && React.createElement("div", null,
                            React.createElement("label", null, XT.transferTarget),
                            React.createElement("select", { value: accDeleteTargetId, onChange: e => setAccDeleteTargetId(e.target.value) }, otherAccs.map(a => React.createElement("option", { key: a.id, value: a.id },
                                a.icon,
                                " ",
                                a.name)))),
                        React.createElement("div", null,
                            React.createElement("label", null, XT.currentBalanceOnRemoval),
                            React.createElement("div", { className: "seg" },
                                React.createElement("button", { className: `seg-b ${accDeleteBalanceMode === "transfer" ? "on" : "off"}`, onClick: () => setAccDeleteBalanceMode("transfer") }, XT.transferBalanceTo),
                                React.createElement("button", { className: `seg-b ${accDeleteBalanceMode === "drop" ? "on" : "off"}`, onClick: () => setAccDeleteBalanceMode("drop") }, XT.dropBalanceOnRemoval))),
                        accDeleteBalanceMode === "transfer" && React.createElement("div", null,
                            React.createElement("label", null, XT.transferTarget),
                            React.createElement("select", { value: accDeleteBalanceTargetId, onChange: e => setAccDeleteBalanceTargetId(e.target.value) }, otherAccs.map(a => React.createElement("option", { key: a.id, value: a.id },
                                a.icon,
                                " ",
                                a.name)))),
                        React.createElement("button", { onClick: deleteAccountAndReconcile, style: { background: "linear-gradient(135deg,#EF4444,#DC2626)", border: "none", color: "#fff", borderRadius: 13, padding: "13px", fontSize: 14, fontWeight: 700, cursor: "pointer" } }, XT.deleteAccountConfirm),
                        React.createElement("p", { style: { fontSize: 10, color: "#64748B" } },
                            "\u2713 ",
                            XT.preservedHistory)))));
        })(),
        modal === "txDet" && detTx && (() => {
            const cat = getCatById(allCats, detTx.cat);
            const acc = getTxAccountMeta(detTx);
            const isTransfer = detTx.type === "transfer_in" || detTx.type === "transfer_out";
            return (React.createElement(Overlay, { onClose: () => setModal(null) },
                React.createElement(MH, { closeLabel: T.close, title: T.details, onClose: () => setModal(null) }),
                React.createElement("div", { style: { display: "flex", gap: 12, alignItems: "center", marginBottom: 14 } },
                    React.createElement("div", { style: { width: 50, height: 50, borderRadius: 14, background: cat.color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 } }, cat.icon),
                    React.createElement("div", null,
                        React.createElement("p", { style: { fontSize: 16, fontWeight: 800 } }, detTx.desc),
                        React.createElement("p", { style: { fontSize: 12, color: cat.color, fontWeight: 700 } }, getCatLabel(cat, userCfg.lang)))),
                React.createElement("div", { className: "card", style: { marginBottom: 12 } },
                    React.createElement(Row, { label: T.value, val: React.createElement("span", { className: "mono", style: { fontSize: 16, fontWeight: 800, color: detTx.type === "income" || isTransfer && detTx.type === "transfer_in" ? "#34D399" : detTx.status === "pending" ? "#F59E0B" : "#F87171" } },
                            detTx.type === "income" || detTx.type === "transfer_in" ? "+" : "-",
                            fmtC(detTx.amount)) }),
                    React.createElement(Row, { label: T.type, val: isTransfer ? T.transferL : detTx.type === "income" ? T.incomeL : T.expenseL }),
                    React.createElement(Row, { label: T.date, val: fmtDate(detTx.date) }),
                    detTx.dueDate && React.createElement(Row, { label: T.dueDate, val: fmtDate(detTx.dueDate) }),
                    React.createElement(Row, { label: T.statusL, val: React.createElement("span", { className: "pill", style: { background: detTx.status === "paid" ? "#34D39918" : "#F59E0B18", color: detTx.status === "paid" ? "#34D399" : "#F59E0B", border: `1px solid ${detTx.status === "paid" ? "#34D39940" : "#F59E0B40"}` } }, detTx.status === "paid" ? T.paidL : T.paying) }),
                    acc && React.createElement(Row, { label: T.account, val: React.createElement("span", { style: { color: acc.color } },
                            acc.icon,
                            " ",
                            acc.name) }),
                    detTx.recurrent && React.createElement(Row, { label: T.recurrence, val: detTx.recurrence === "monthly" ? T.monthly : detTx.recurrence === "weekly" ? T.weekly : T.yearly }),
                    React.createElement(Row, { label: T.category, val: React.createElement("span", { style: { color: cat.color } },
                            cat.icon,
                            " ",
                            getCatLabel(cat, userCfg.lang)), border: false })),
                React.createElement("div", { style: { display: "flex", gap: 8 } },
                    detTx.status === "pending" && React.createElement("button", { onClick: () => { markPaid(detTx.id); setModal(null); }, style: { flex: 2, background: "linear-gradient(135deg,#10B981,#059669)", border: "none", color: "#fff", borderRadius: 13, padding: "13px", fontSize: 13, fontWeight: 700, cursor: "pointer" } }, T.markPaid),
                    !isTransfer && React.createElement("button", { onClick: () => openEditTx(detTx), style: { flex: 1, background: "#6366F115", border: "1px solid #6366F140", color: "#818CF8", borderRadius: 13, padding: "13px", fontSize: 13, fontWeight: 700, cursor: "pointer" } }, T.edit),
                    React.createElement("button", { onClick: () => askDelete(detTx), style: { flex: 1, background: "#EF444415", border: "1px solid #EF444430", color: "#EF4444", borderRadius: 13, padding: "13px", fontSize: 13, fontWeight: 700, cursor: "pointer" } }, T.delete)),
                detTx.recurrent && React.createElement("button", { className: "btn2", style: { width: "100%", textAlign: "center", marginTop: 8 }, onClick: () => endSeries(detTx) }, T.endSeries)));
        })(),
        modal === "confirmDel" && delTarget && (React.createElement(Overlay, { onClose: () => { setModal(null); setDelTarget(null); } },
            React.createElement(MH, { closeLabel: T.close, title: delTarget.groupId ? T.deleteChoose : T.confirmDeleteTx, onClose: () => { setModal(null); setDelTarget(null); } }),
            React.createElement("p", { style: { fontSize: 13, fontWeight: 700, marginBottom: 14, color: "#94A3B8" } }, delTarget.desc),
            React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
                React.createElement("button", { className: "btn", style: { background: "linear-gradient(135deg,#EF4444,#DC2626)" }, onClick: () => delTx(delTarget.id, "one") }, delTarget.groupId ? T.deleteOne : "\uD83D\uDDD1 " + T.catDelete),
                delTarget.groupId && React.createElement("button", { className: "btn2", style: { width: "100%", textAlign: "center" }, onClick: () => delTx(delTarget.id, "following") }, T.deleteFollowing),
                delTarget.groupId && React.createElement("button", { className: "btn2", style: { width: "100%", textAlign: "center" }, onClick: () => delTx(delTarget.id, "all") }, T.deleteAllParcels),
                React.createElement("button", { className: "btn2", style: { width: "100%", textAlign: "center" }, onClick: () => { setModal(null); setDelTarget(null); } }, T.cancel)))),
        modal === "driveRestore" && driveFiles && (React.createElement(Overlay, { onClose: () => setModal(null) },
            React.createElement(MH, { closeLabel: T.close, title: T.drivePick, onClose: () => setModal(null) }),
            React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, driveFiles.map(f => React.createElement("button", { key: f.id, className: "btn2", disabled: driveBusy, style: { textAlign: "left", width: "100%" }, onClick: () => pickDriveBackup(f.id) }, new Date(f.createdTime).toLocaleString(LOCALES[userCfg.lang] || "pt-BR") + (f.size ? ` \u00B7 ${Math.max(1, Math.round(f.size / 1024))} KB` : "")))))),
        pixModal && (React.createElement(Overlay, { onClose: () => setPixModal(null) },
            React.createElement(MH, { closeLabel: T.close, title: T.pixTitle, onClose: () => setPixModal(null) }),
            React.createElement("div", { style: { textAlign: "center", padding: "6px 0 16px" } },
                React.createElement("div", { style: { fontSize: 42, marginBottom: 8 } }, "\uD83D\uDCA0"),
                React.createElement("p", { style: { fontSize: 16, fontWeight: 800, color: "#E8EDF5" } }, pixModal.label),
                React.createElement("p", { style: { fontSize: 12, color: "#94A3B8", marginTop: 5 } },
                    fill(T.rateLine, { n: pixModal.rate }))),
            React.createElement("div", { style: { background: "#111827", borderRadius: 16, padding: "12px 14px", marginBottom: 12 } },
                React.createElement(Row, { label: T.valueUsd, val: React.createElement("span", { className: "mono" },
                        pixModal.usdValue.toFixed(2),
                        " USD") }),
                React.createElement(Row, { label: T.valueBrl, val: React.createElement("span", { className: "mono", style: { color: "#34D399" } },
                        "R$ ",
                        pixModal.brlValue.toFixed(2)) }),
                React.createElement(Row, { label: T.pixKeyL, val: React.createElement("span", { className: "mono", style: { fontSize: 12 } }, pixModal.key), border: false })),
            React.createElement("div", { style: { marginBottom: 12 } },
                React.createElement("label", null, T.pixCodeL),
                React.createElement("textarea", { readOnly: true, value: pixModal.pixCode, style: { width: "100%", minHeight: 120, resize: "none", background: "#111827", border: "1.5px solid #1F2D45", color: "#E8EDF5", borderRadius: 14, padding: "12px", fontSize: 11, lineHeight: 1.45, fontFamily: "'JetBrains Mono',monospace" } })),
            React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
                React.createElement("button", { className: "btn", onClick: () => copyText(pixModal.pixCode) }, T.pixCopy),
                React.createElement("button", { className: "btn2", style: { width: "100%", textAlign: "center" }, onClick: () => setPixModal(null) }, T.close)))),
        toast && (React.createElement("div", { role: "status", "aria-live": "polite", style: { position: "fixed", top: 52, left: "50%", transform: "translateX(-50%)", background: toast.color, color: "#fff", padding: "9px 18px", borderRadius: 20, fontSize: 12, fontWeight: 700, zIndex: 400, whiteSpace: "nowrap", boxShadow: "0 4px 20px #0007", animation: "fi .25s ease", pointerEvents: "none" } }, toast.msg))));
}
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(ErrorBoundary, null, React.createElement(App, null)));
/* ── Service worker (offline + instalável). Só roda em http(s); no HTML único (file://) é ignorado. ── */
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    const hadController = !!navigator.serviceWorker.controller;
    const say = key => { try {
        const lang = (JSON.parse(localStorage.getItem("fr4_ucfg")) || {}).lang;
        window.dispatchEvent(new CustomEvent("fr-toast", { detail: { msg: (I18N[lang] || I18N.pt)[key], color: "#3B82F6" } }));
    }
    catch { } };
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => { }));
    navigator.serviceWorker.addEventListener("controllerchange", () => say(hadController ? "updateReady" : "offlineReady"));
}

