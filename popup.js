const DEFAULTS = {
  serverUrl: "http://127.0.0.1:8010",
  apiKey: "",
  categories: "personal, work, shopping, ads",
  spamLabel: "Spam",
  processedTag: "LayaDone",
  spamThreshold: 0.85,
  autoTag: true,
  autoSpam: true,
  captureCorrections: false,
  dryRun: true
};

const $ = (id) => document.getElementById(id);

function setStatus(text, cls) {
  const el = $("status");
  el.textContent = text || "";
  el.className = cls || "";
}

async function populateInboxes() {
  const sel = $("inboxSel");
  const prev = sel.value;
  try {
    const inboxes = await messenger.runtime.sendMessage({ type: "list-inboxes" });
    if (inboxes && inboxes.error) throw new Error(inboxes.error);
    sel.innerHTML = "";
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = `All inboxes (${inboxes.length})`;
    sel.appendChild(all);
    for (const f of inboxes) {
      const o = document.createElement("option");
      o.value = f.id;
      o.textContent = `${f.account} — ${f.name}`;
      sel.appendChild(o);
    }
    if (prev) sel.value = prev;
    if (sel.value === "") sel.value = "all";
  } catch (e) {
    sel.innerHTML = '<option value="all">All inboxes</option>';
  }
}

async function load() {
  const cfg = await messenger.storage.local.get(DEFAULTS);
  $("serverUrl").value = cfg.serverUrl;
  $("apiKey").value = cfg.apiKey;
  $("categories").value = cfg.categories;
  $("spamLabel").value = cfg.spamLabel;
  $("processedTag").value = cfg.processedTag;
  $("spamThreshold").value = cfg.spamThreshold;
  $("autoTag").checked = !!cfg.autoTag;
  $("autoSpam").checked = !!cfg.autoSpam;
  $("captureCorrections").checked = !!cfg.captureCorrections;
  $("dryRun").checked = !!cfg.dryRun;
  await populateInboxes();
}

async function save() {
  await messenger.storage.local.set({
    serverUrl: $("serverUrl").value.trim(),
    apiKey: $("apiKey").value.trim(),
    categories: $("categories").value.trim(),
    spamLabel: $("spamLabel").value.trim() || "Spam",
    processedTag: $("processedTag").value.trim(),
    spamThreshold: parseFloat($("spamThreshold").value) || 0.85,
    autoTag: $("autoTag").checked,
    autoSpam: $("autoSpam").checked,
    captureCorrections: $("captureCorrections").checked,
    dryRun: $("dryRun").checked
  });
  setStatus("Saved.", "ok");
}

async function test() {
  setStatus("Testing…");
  const r = await messenger.runtime.sendMessage({ type: "test" });
  if (r && r.ok) setStatus("Server OK (HTTP " + r.status + ")", "ok");
  else setStatus("Server FAILED: " + JSON.stringify(r), "junk");
}

function progress(done, total) {
  const wrap = $("pwrap");
  if (!total) {
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "block";
  $("pbar").style.width = Math.round((done / total) * 100) + "%";
}

function clearResults() {
  $("results").innerHTML = "";
}

function el(tag, text, cls) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  d.textContent = text;
  return d;
}

function appendRow(r, index) {
  const box = $("results");
  const div = document.createElement("div");
  div.className = "item";
  if (r.error) {
    div.appendChild(el("div", `${index}. ${r.subject || ""} — ERROR ${r.error}`, "junk"));
  } else {
    const where = r.folder ? `[${r.folder}] ` : "";
    const catLabel = (r.category || "?") + (r.spam ? " +Spam" : "");
    div.appendChild(
      el("div", `${index}. ${catLabel}  ${where}${r.subject || "(no subject)"}`, r.spam ? "junk" : "ok")
    );
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

const fmt = (x) => (typeof x === "number" ? x.toFixed(3) : String(x));

let scanning = false;

async function scan() {
  if (scanning) return;
  scanning = true;
  $("scan").disabled = true;
  clearResults();
  progress(0, 0);
  const sel = $("inboxSel");
  const targetLabel = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : "All inboxes";
  setStatus(`Listing ${targetLabel}…`);

  const list = await messenger.runtime.sendMessage({ type: "list-inbox", folderId: sel.value, limit: 20 });
  if (list && list.error) {
    setStatus("List failed: " + list.error, "junk");
    scanning = false;
    $("scan").disabled = false;
    return;
  }
  const total = list.length;
  if (!total) {
    setStatus("No messages found.");
    progress(0, 0);
    scanning = false;
    $("scan").disabled = false;
    return;
  }

  let spamCount = 0;
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    const h = list[i];
    const where = h.folder ? `[${h.folder}] ` : "";
    setStatus(`Processing ${i + 1}/${total}…  ${where}${h.subject.slice(0, 40)}`);
    progress(i, total);
    let r;
    try {
      r = await messenger.runtime.sendMessage({
        type: "classify-one",
        messageId: h.id,
        subject: h.subject,
        author: h.author,
        folder: h.folder
      });
      r = r && r.error ? { ...h, error: r.error } : { ...h, ...r };
    } catch (e) {
      r = { ...h, error: String(e) };
    }
    if (r.spam) spamCount++;
    appendRow(r, i + 1);
    progress(i + 1, total);
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  setStatus(`Done: ${total} newest processed, ${spamCount} spam (${secs}s).`, "ok");
  scanning = false;
  $("scan").disabled = false;
}

async function showLog() {
  clearResults();
  const log = await messenger.runtime.sendMessage({ type: "get-log" });
  if (log && log.error) {
    setStatus("Log error: " + log.error, "junk");
    return;
  }
  if (!log || !log.length) {
    setStatus("Log empty.");
    return;
  }
  setStatus(`${log.length} log entries (newest first).`);
  const box = $("results");
  for (const e of log) {
    const div = document.createElement("div");
    div.className = "item";
    const when = new Date(e.t).toLocaleTimeString();
    const head = e.error
      ? `${when}  ERROR  ${e.subject}`
      : `${when}  ${e.action}  ${e.folder ? "[" + e.folder + "] " : ""}${e.subject}`;
    const bad = e.error || e.spam || String(e.action).includes("junk");
    div.appendChild(el("div", head, bad ? "junk" : "ok"));
    if (!e.error) div.appendChild(el("div", `cat=${e.cat} spam=${!!e.spam} mode=${e.mode}`, "meta"));
    box.appendChild(div);
  }
}

async function clearLog() {
  await messenger.runtime.sendMessage({ type: "clear-log" });
  clearResults();
  setStatus("Log cleared.", "ok");
}

async function exportFixes() {
  const info = await messenger.runtime.sendMessage({ type: "corrections-info" });
  if (info && info.error) {
    setStatus("Export error: " + info.error, "junk");
    return;
  }
  if (!info || !info.count) {
    setStatus("No corrections captured yet.");
    return;
  }
  const blob = new Blob([info.jsonl + "\n"], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "laya-corrections.jsonl";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  setStatus(`Exported ${info.count} corrections.`, "ok");
}

async function clearFixes() {
  await messenger.runtime.sendMessage({ type: "clear-corrections" });
  setStatus("Corrections cleared.", "ok");
}

$("save").addEventListener("click", save);
$("test").addEventListener("click", test);
$("scan").addEventListener("click", scan);
$("showlog").addEventListener("click", showLog);
$("clearlog").addEventListener("click", clearLog);
$("exportfixes").addEventListener("click", exportFixes);
$("clearfixes").addEventListener("click", clearFixes);
load();
