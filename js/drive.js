/*!
 * Finance Real — backup no Google Drive (pasta oculta "appDataFolder": só este app enxerga os arquivos).
 * Recebe o token de acesso por parâmetro; a autorização (Google Identity Services) fica em app.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FRDrive = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const API = "https://www.googleapis.com";
  const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  const PREFIX = "FinanceRealBackup";

  async function api(token, path, opts) {
    const res = await fetch(API + path, { ...opts, headers: { Authorization: "Bearer " + token, ...((opts && opts.headers) || {}) } });
    if (res.status === 401) { const e = new Error("auth"); e.code = 401; throw e; }
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 140); } catch (_) { /* ignora */ }
      const e = new Error("HTTP " + res.status + (detail ? " — " + detail : ""));
      e.code = res.status;
      throw e;
    }
    return res;
  }

  /** Envia um backup JSON para a pasta oculta do app. */
  async function uploadBackup(token, name, jsonString) {
    const boundary = "frb" + Math.random().toString(36).slice(2);
    const meta = { name, parents: ["appDataFolder"], mimeType: "application/json" };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${jsonString}\r\n--${boundary}--`;
    const res = await api(token, "/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime", {
      method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
    });
    return res.json();
  }

  /** Lista os backups, do mais novo para o mais antigo. */
  async function listBackups(token) {
    const qs = new URLSearchParams({
      spaces: "appDataFolder", q: `name contains '${PREFIX}' and trashed=false`,
      orderBy: "createdTime desc", pageSize: "30", fields: "files(id,name,createdTime,size)",
    });
    const res = await api(token, "/drive/v3/files?" + qs.toString());
    return (await res.json()).files || [];
  }

  async function downloadBackup(token, id) {
    const res = await api(token, `/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
    return res.text();
  }

  async function deleteFile(token, id) {
    await api(token, `/drive/v3/files/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  /** Mantém só os `keep` backups mais recentes (a pasta oculta não tem limpeza automática). */
  async function pruneOld(token, keep) {
    const files = await listBackups(token);
    for (const f of files.slice(keep)) { try { await deleteFile(token, f.id); } catch (_) { /* melhor esforço */ } }
  }

  return { SCOPE, PREFIX, uploadBackup, listBackups, downloadBackup, deleteFile, pruneOld };
});
