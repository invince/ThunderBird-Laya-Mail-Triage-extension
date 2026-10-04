# Laya Mail Triage — Thunderbird extension

Auto-classify and tag incoming mail with a local [Laya](https://huggingface.co/convaiinnovations/laya) decision server — category tags like Outlook/Gmail, plus an independent spam check.

## Components
- `manifest.json` — MV3; permissions `messagesRead/messagesUpdate/messagesMove/messagesTags/messagesTagsList/accountsRead/storage/notifications`; host `http://127.0.0.1/*`
- `background.js` — listens on `messages.onNewMailReceived` (monitorAllFolders), reads the body → calls Laya → applies tags / marks junk
- `popup.html` / `popup.js` — settings + Test + Scan + log

## Install
Sideloaded at: `~/snap/thunderbird/common/.thunderbird/<profile>/extensions/laya-triage@invince.local.xpi`

1. Restart Thunderbird
2. `Add-ons and Themes` → enable **Laya Mail Triage**
3. Click the Laya toolbar button → fill in Server URL + API key → **Save** → **Test connection**

If it is unsigned, use `about:debugging` → This Thunderbird → Load Temporary Add-on → pick `manifest.json` (Reload after each edit — much faster to iterate).

Build the XPI:
```bash
zip -r laya-triage.xpi manifest.json background.js popup.html popup.js
```

## Configuration (popup)
| Field | Default | Notes |
|---|---|---|
| Server URL | `http://127.0.0.1:8010` | |
| API key | `cat ~/.config/laya/api_key` | |
| **Categories** | `personal, work, shopping, ads` | **comma-separated, fully custom** (add `finance, travel, news, ...`) |
| **Spam tag name** | `Spam` | tag applied in round 2 |
| **Processed tag** | `LayaDone` | marks already-handled mail; scans skip messages carrying it |
| Spam threshold | **0.85** | P(spam) ≥ this → flagged as spam |
| Round 1: auto-tag category | on | apply the category tag |
| Round 2: flag spam (tag + junk) | on | apply the Spam tag + mark junk |
| Dry run | on (safe default) | evaluate only, change nothing; turn off to go live |

## Two-round tagging
- **Round 1 — category:** picks exactly one value from *Categories* → applies that tag
- **Round 2 — spam:** an independent check → applies the *Spam* tag (+ junk)
- The two rounds are independent, so **a single message can be both `ads` and `Spam`** (e.g. a promotional mail)

Tag resolution: an existing tag with the same display name (case-insensitive) is **reused** — including the built-in `Work`/`Personal` — otherwise a new tag is created from the label you typed. Laya-managed tags on a message are replaced, but **your own unrelated tags are left untouched**.

## Processing order & processed marker
- **Scan takes the newest N**: `messages.list(folder, {sortType:"date", sortOrder:"descending"})` → newest first (not oldest)
- **Processed tag** (default `LayaDone`): in live mode every handled message gets this marker
- **In live mode, Scan skips messages that already carry the marker** → re-clicking Scan advances to the next batch instead of reprocessing
- **Dry-run mode**: no marker, no skipping (so you can preview freely)

> Scan semantics: **dry run on = preview only**; **dry run off = really process the newest N and mark them**

## Measured results (zero-shot, threshold 0.85)
| Email | Result |
|---|---|
| Shipping update | `shopping` |
| "MEGA SALE" promo | `ads` + `Spam` |
| Newsletter | `ads` |
| Work mail | `work` |
| Personal mail | `personal` |
| Scam | `Spam` |
| Lottery scam | `Spam` |

**Spam detection 7/7, category 5/5** (for messages with a defined category). Splitting into two rounds fixed the earlier "ads swallowed by spam" problem of a single 5-way question.

## How to tell whether Thunderbird or the extension did it
1. **Server log (definitive)**: `sudo journalctl -u laya-serve | grep systemone` — Thunderbird's own filter **never** calls Laya
2. **Category tags**: Thunderbird never applies tags like `shopping` / `ads` on its own
3. **Popup log**: `mode=dry-run` means it only evaluated; the `action` column shows what actually ran

## Accuracy & learning
- Zero-shot is usable, but boundaries like *ads vs spam* are only held together by the threshold plus the two-round split — not perfect
- For production-grade accuracy, **fine-tune Laya on your own labeled mail** (base 0.362 → 0.766 on the typed-decisions benchmark)
- The extension log (`storage.local`, last 200 entries) is a ready-made source of labels

## Known limits
- `onNewMailReceived` only fires for mail arriving while Thunderbird is running; use Scan for history
- ~0.5 s/message on CPU (about 35 ms when the GPU is free)
- This Laya checkpoint's confidence is **uncalibrated** (per the model card) — tune the threshold on your own data

## ⚠️ Gotcha: host_permissions cannot include a port
Firefox/Thunderbird match patterns **do not support ports** ([bug 1362809](https://bugzilla.mozilla.org/show_bug.cgi?id=1362809)). Writing `http://127.0.0.1:8010/*` is an invalid pattern → the host permission is not granted → `fetch` fails with `NetworkError`. **Correct form:** `http://127.0.0.1/*` (no port; matches every port).
