// Laya Mail Triage — Thunderbird MailExtension (Manifest V3)
// Sends new mail to a local Laya decision server and marks spam/phishing as junk.

const DEFAULTS = {
  serverUrl: "http://127.0.0.1:8010",
  apiKey: "",
  categories: "personal, work, shopping, ads",
  spamLabel: "Spam",
  processedTag: "LayaDone",
  spamThreshold: 0.85,
  autoTag: true, // round 1: apply the category tag
  autoSpam: true, // round 2: flag spam (tag + junk)
  captureCorrections: false, // off by default: record your tag edits as training data
  dryRun: true // safe default: never modify mail until the user opts in
};

// Descriptions for known category labels. Unknown labels fall back to the label
// text itself, so any comma-separated taxonomy works.
const CATEGORY_DESCRIPTIONS = {
  personal: "personal correspondence: friends, family, private matters, personal appointments",
  work: "work or business: colleagues, clients, projects, invoices, meetings, official/administrative notices",
  shopping: "orders and delivery: shipping/logistics updates, order confirmations, receipts, returns, marketplace and store notifications",
  ads: "advertising and marketing: promotions, newsletters, product offers, surveys, bulk announcements",
  other: "none of the above",
  finance: "banking, payments, invoices, taxes, financial statements",
  travel: "flights, hotels, bookings, reservations, travel itineraries",
  social: "social networks, forums, community notifications",
  news: "newsletters, news digests, press releases"
};

const NEW_TAG_COLOR = "#7F8C8D";

function parseCategories(cfg) {
  return String(cfg.categories || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Two independent questions so one message can be e.g. both "ads" and "Spam".
function buildQuestions(cats) {
  const criteria = {};
  for (const c of cats) criteria[c] = CATEGORY_DESCRIPTIONS[c.toLowerCase()] || c;
  return {
    category: {
      type: "choice",
      instructions: "Classify the email in `body` into exactly one category.",
      criteria
    },
    spam: {
      type: "choice",
      instructions: "Is the email in `body` spam or legitimate mail?",
      criteria: {
        spam: "unsolicited junk, scam, phishing, fraud, or a fake prize",
        legitimate: "legitimate mail: personal, work, orders/shipping, or a real business's newsletter"
      }
    }
  };
}

async function getCfg() {
  return await messenger.storage.local.get(DEFAULTS);
}

// --- body extraction -------------------------------------------------------
function partText(part, out) {
  if (!part) return out;
  const ct = String(part.contentType || "").toLowerCase();
  if (ct.startsWith("text/plain") && typeof part.body === "string") out.push(part.body);
  if (Array.isArray(part.parts)) for (const p of part.parts) partText(p, out);
  return out;
}

async function messageText(header) {
  let full;
  try {
    full = await messenger.messages.getFull(header.id);
  } catch (e) {
    full = null;
  }
  let text = "";
  if (full) text = partText(full, []).join("\n").trim();
  // Fallback: HTML-only mail -> strip tags from the html part.
  if (!text && full) {
    const html = (function find(p) {
      if (!p) return "";
      if (String(p.contentType || "").toLowerCase().startsWith("text/html") && typeof p.body === "string")
        return p.body;
      if (Array.isArray(p.parts)) for (const c of p.parts) { const r = find(c); if (r) return r; }
      return "";
    })(full);
    if (html) text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  if (!text) {
    const from = header.author || "";
    text = `Subject: ${header.subject || ""}\nFrom: ${from}`;
  }
  return text.slice(0, 8000);
}

// --- Laya call -------------------------------------------------------------
async function classify(text, questions) {
  const cfg = await getCfg();
  const headers = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["Authorization"] = "Bearer " + cfg.apiKey;
  const res = await fetch(cfg.serverUrl.replace(/\/+$/, "") + "/v1/systemone", {
    method: "POST",
    headers,
    body: JSON.stringify({ state: text, questions })
  });
  if (!res.ok) throw new Error("Laya HTTP " + res.status + " " + (await res.text()).slice(0, 200));
  return await res.json();
}

function verdict(r) {
  const a = r.answers || {};
  const s = a.spam || {};
  return {
    category: a.category ? a.category.choice : null,
    spamProb: s.probabilities && typeof s.probabilities.spam === "number" ? s.probabilities.spam : null
  };
}

async function scoreHeader(header) {
  const cfg = await getCfg();
  const text = await messageText(header);
  const r = await classify(text, buildQuestions(parseCategories(cfg)));
  return { header, ...verdict(r) };
}

async function appendLog(entry) {
  try {
    const { layaLog = [] } = await messenger.storage.local.get({ layaLog: [] });
    layaLog.unshift(entry);
    if (layaLog.length > 200) layaLog.length = 200;
    await messenger.storage.local.set({ layaLog });
  } catch (e) {
    /* ignore */
  }
}

// Resolve a label to a Thunderbird tag key: reuse an existing tag with the same
// (case-insensitive) display name (e.g. the built-in "Work"/"Personal"), else
// create a new one named exactly as the user typed it.
async function resolveTagKey(label) {
  const tags = await messenger.messages.tags.list();
  const hit = tags.find((t) => (t.tag || "").toLowerCase() === String(label).toLowerCase());
  if (hit) return hit.key;
  const key =
    "laya-" +
    String(label)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w]+/g, "-")
      .replace(/^-|-$/g, "");
  if (tags.some((t) => t.key === key)) return key;
  await messenger.messages.tags.create(key, String(label), NEW_TAG_COLOR);
  return key;
}

// Set the Laya-managed tags on a message to exactly `keys` (category + spam),
// leaving unrelated tags (e.g. the user's own) untouched.
async function setManagedTags(header, keys, managed) {
  let tags = [];
  try {
    tags = (await messenger.messages.get(header.id)).tags || [];
  } catch (e) {
    /* ignore */
  }
  tags = tags.filter((t) => !managed.has(t));
  for (const k of keys) if (k && !tags.includes(k)) tags.push(k);
  await messenger.messages.update(header.id, { tags });
}

// Look up an existing tag key by display name (no creation).
async function findTagKey(label) {
  try {
    const tags = await messenger.messages.tags.list();
    const hit = tags.find((t) => (t.tag || "").toLowerCase() === String(label).toLowerCase());
    return hit ? hit.key : null;
  } catch (e) {
    return null;
  }
}

// --- correction capture (opt-in) -------------------------------------------
// Predictions are keyed by the stable Message-ID header so a later edit can be
// matched even after a restart (internal message ids do not survive one).
async function rememberPrediction(header, cat, spam, appliedCat, appliedSpam) {
  let mid = header.headerMessageId;
  if (!mid) {
    try {
      mid = (await messenger.messages.get(header.id)).headerMessageId;
    } catch (e) {
      return;
    }
  }
  if (!mid) return;
  const { layaPred = [] } = await messenger.storage.local.get({ layaPred: [] });
  const rec = { mid, cat, spam, appliedCat: !!appliedCat, appliedSpam: !!appliedSpam, t: Date.now() };
  const idx = layaPred.findIndex((p) => p.mid === mid);
  if (idx >= 0) layaPred[idx] = rec;
  else layaPred.push(rec);
  while (layaPred.length > 2000) layaPred.shift();
  await messenger.storage.local.set({ layaPred });
}

async function getPrediction(mid) {
  const { layaPred = [] } = await messenger.storage.local.get({ layaPred: [] });
  return layaPred.find((p) => p.mid === mid) || null;
}

async function recordCorrection(rec) {
  const { layaFixes = [] } = await messenger.storage.local.get({ layaFixes: [] });
  const i = layaFixes.findIndex((f) => f.mid === rec.mid);
  if (i >= 0) layaFixes[i] = rec;
  else layaFixes.push(rec);
  while (layaFixes.length > 1000) layaFixes.shift();
  await messenger.storage.local.set({ layaFixes });
}

async function handleMessage(header, { apply, folder }) {
  const cfg = await getCfg();
  let v;
  try {
    v = await scoreHeader(header);
  } catch (e) {
    console.error("[laya] classify failed", header.subject, e);
    await appendLog({ t: Date.now(), subject: header.subject || "", error: String(e), mode: cfg.dryRun ? "dry-run" : "live" });
    return { subject: header.subject, error: String(e) };
  }
  const cats = parseCategories(cfg);
  const spamLabel = cfg.spamLabel || "Spam";
  // Round 2: spam is independent, so a mail can be both e.g. "ads" and "Spam".
  const spam = v.spamProb !== null && v.spamProb >= cfg.spamThreshold;

  const applied = [];
  if (cfg.autoTag && v.category) applied.push(v.category);
  if (cfg.autoSpam && spam) applied.push(spamLabel);

  // Remember what we decided (and whether we actually wrote it) so a later
  // manual tag edit can be diffed into a training sample.
  if (cfg.captureCorrections) {
    const appliedCat = !cfg.dryRun && apply && cfg.autoTag && !!v.category;
    const appliedSpam = !cfg.dryRun && apply && cfg.autoSpam && spam;
    try {
      await rememberPrediction(header, v.category, spam, appliedCat, appliedSpam);
    } catch (e) {
      /* ignore */
    }
  }

  let action;
  if (cfg.dryRun) {
    action = (applied.length ? applied.join("+") : "noop") + (cfg.autoSpam && spam ? " (+junk)" : "");
  } else if (apply) {
    const managed = new Set();
    for (const c of cats) managed.add(await resolveTagKey(c));
    managed.add(await resolveTagKey(spamLabel));
    const processedKey = cfg.processedTag ? await resolveTagKey(cfg.processedTag) : null;
    if (processedKey) managed.add(processedKey);
    const keys = [];
    if (cfg.autoTag && v.category) keys.push(await resolveTagKey(v.category));
    if (cfg.autoSpam && spam) keys.push(await resolveTagKey(spamLabel));
    if (processedKey) keys.push(processedKey); // done-marker
    try {
      await setManagedTags(header, keys, managed);
      if (cfg.autoSpam && spam) await messenger.messages.update(header.id, { junk: true });
      action = keys.length ? applied.join("+") + (cfg.autoSpam && spam ? "+junk" : "") : "noop";
    } catch (e) {
      console.error("[laya] apply failed", e);
      action = "error";
    }
  } else {
    action = "scan";
  }

  console.log(`[laya] "${header.subject}" cat=${v.category} spam=${spam} -> ${action}`);
  await appendLog({
    t: Date.now(),
    subject: header.subject || "",
    from: header.author || "",
    folder: folder || "",
    cat: v.category,
    spam,
    action,
    mode: cfg.dryRun ? "dry-run" : "live"
  });
  return { subject: header.subject, category: v.category, spam, spamProb: v.spamProb, action };
}

// --- auto: new mail --------------------------------------------------------
messenger.messages.onNewMailReceived.addListener(async (folder, messages) => {
  const cfg = await getCfg();
  if (!cfg.autoTag && !cfg.autoSpam) return;
  const where = folder ? folder.path || folder.name || "" : "";
  for (const h of messages.messages) {
    // Sequential to stay gentle on a CPU-backed server.
    await handleMessage(h, { apply: true, folder: where });
  }
}, true /* monitorAllFolders */);

// --- correction capture: diff the user's own tag edits ----------------------
messenger.messages.onUpdated.addListener(async (message) => {
  const cfg = await getCfg();
  if (!cfg.captureCorrections) return;
  if (!message || !message.headerMessageId) return;

  const pred = await getPrediction(message.headerMessageId);
  if (!pred) return;

  const cats = parseCategories(cfg);
  const tags = Array.isArray(message.tags) ? message.tags : [];
  let correctedCat = null;
  for (const c of cats) {
    const k = await findTagKey(c);
    if (k && tags.includes(k)) {
      correctedCat = c;
      break;
    }
  }
  const spamKey = await findTagKey(cfg.spamLabel || "Spam");
  const correctedSpam = !!(spamKey && tags.includes(spamKey));

  // Only compare the rounds we actually wrote, unless the user added something.
  const catChanged = pred.appliedCat ? correctedCat !== pred.cat : correctedCat !== null;
  const spamChanged = pred.appliedSpam ? !correctedSpam : correctedSpam;
  if (!catChanged && !spamChanged) return;

  let text = "";
  try {
    text = await messageText({ id: message.id });
  } catch (e) {
    /* ignore */
  }
  await recordCorrection({
    mid: message.headerMessageId,
    t: Date.now(),
    subject: message.subject || "",
    from: message.author || "",
    text: text.slice(0, 8000),
    predicted: { cat: pred.cat, spam: pred.spam },
    corrected: { cat: correctedCat, spam: correctedSpam }
  });
  console.log(
    `[laya] correction: "${message.subject}" ${pred.cat}/${pred.spam} -> ${correctedCat}/${correctedSpam}`
  );
});

// --- manual scan from popup ------------------------------------------------
async function inboxFolders() {
  // Preferred: query by special use (TB 121+).
  try {
    const f = await messenger.folders.query({ specialUse: ["inbox"] });
    if (f && f.length) return f;
  } catch (e) {
    console.warn("[laya] folders.query failed, falling back to account walk", e);
  }
  // Fallback: walk accounts looking for inbox folders.
  const accounts = await messenger.accounts.list();
  const found = [];
  const walk = (f) => {
    if (!f) return;
    const sp = Array.isArray(f.specialUse) ? f.specialUse : [];
    if (sp.includes("inbox") || (f.name || "").toLowerCase() === "inbox") found.push(f);
    (f.subFolders || []).forEach(walk);
  };
  for (const acc of accounts) {
    (acc.folders || []).forEach(walk);
    if (acc.rootFolder) walk(acc.rootFolder);
  }
  const seen = new Set();
  return found.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}

// List inbox folders across all accounts (for the popup selector).
async function listInboxes() {
  const accounts = await messenger.accounts.list();
  const nameById = {};
  for (const a of accounts) nameById[a.id] = a.name;

  let folders = [];
  try {
    folders = await messenger.folders.query({ specialUse: ["inbox"] });
  } catch (e) {
    console.warn("[laya] folders.query failed", e);
  }
  if (!folders || !folders.length) {
    const walk = (f, accName) => {
      if (!f) return;
      const sp = Array.isArray(f.specialUse) ? f.specialUse : [];
      if (sp.includes("inbox") || (f.name || "").toLowerCase() === "inbox") folders.push({ ...f, _acc: accName });
      (f.subFolders || []).forEach((x) => walk(x, accName));
    };
    for (const acc of accounts) {
      (acc.folders || []).forEach((f) => walk(f, acc.name));
      if (acc.rootFolder) walk(acc.rootFolder, acc.name);
    }
  }
  const seen = new Set();
  return folders
    .filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)))
    .map((f) => ({
      id: f.id,
      name: f.name || "Inbox",
      path: f.path || f.name || "",
      account: f._acc || nameById[f.accountId] || "?"
    }));
}

// List inbox message headers (for progress-driven scanning from the popup).
// `sel` is a folderId, or "all"/falsy for every inbox.
// Newest first; skips messages already carrying `processedKey` (our done-marker).
async function listInboxMessages(sel, limitPerFolder, processedKey) {
  let folders;
  if (sel && sel !== "all") {
    let f = { id: sel, path: "", name: "" };
    try {
      f = await messenger.folders.get(sel);
    } catch (e) {
      /* keep minimal */
    }
    folders = [f];
  } else {
    folders = await inboxFolders();
  }

  const out = [];
  for (const f of folders) {
    let list;
    try {
      list = await messenger.messages.list(f.id, { sortType: "date", sortOrder: "descending" });
    } catch (e) {
      continue;
    }
    let kept = 0;
    for (const m of list.messages) {
      if (kept >= limitPerFolder) break;
      if (processedKey && Array.isArray(m.tags) && m.tags.includes(processedKey)) continue;
      kept++;
      out.push({
        id: m.id,
        subject: m.subject || "(no subject)",
        author: m.author || "",
        folder: f.path || f.name || "",
        folderId: f.id
      });
    }
  }
  return out;
}

async function testConnection() {
  const cfg = await getCfg();
  const res = await fetch(cfg.serverUrl.replace(/\/+$/, "") + "/health");
  return { ok: res.ok, status: res.status };
}

messenger.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === "test") {
    testConnection().then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === "list-inboxes") {
    listInboxes().then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg.type === "list-inbox") {
    (async () => {
      const cfg = await getCfg();
      // Live mode: skip messages we already processed. Dry-run: list everything.
      const processedKey = !cfg.dryRun && cfg.processedTag ? await resolveTagKey(cfg.processedTag) : null;
      return listInboxMessages(msg.folderId, msg.limit || 20, processedKey);
    })()
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg.type === "classify-one") {
    handleMessage({ id: msg.messageId, subject: msg.subject, author: msg.author }, { apply: true, folder: msg.folder })
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg.type === "get-log") {
    messenger.storage.local
      .get({ layaLog: [] })
      .then((s) => sendResponse(s.layaLog))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg.type === "clear-log") {
    messenger.storage.local
      .set({ layaLog: [] })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg.type === "corrections-info") {
    messenger.storage.local
      .get({ layaFixes: [] })
      .then((s) => {
        const fixes = s.layaFixes || [];
        const lines = fixes.map((f) =>
          JSON.stringify({
            text: f.text,
            category: f.corrected.cat,
            spam: f.corrected.spam,
            predicted_category: f.predicted.cat,
            predicted_spam: f.predicted.spam,
            subject: f.subject,
            from: f.from,
            t: f.t
          })
        );
        sendResponse({ count: lines.length, jsonl: lines.join("\n") });
      })
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg.type === "clear-corrections") {
    messenger.storage.local
      .set({ layaFixes: [] })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
});
