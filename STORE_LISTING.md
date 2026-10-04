# addons.thunderbird.net — listing copy

Ready-to-paste text for the submission form.

## Name
Laya Mail Triage

## Summary (max 250 chars)
Classify and tag incoming mail with a local Laya decision server: category tags like Outlook/Gmail, plus a separate spam check. Everything runs against a server on your own machine — no cloud, no account.

## Categories
Privacy and Security  (alt: Message and News Reading)

## Tags
`tagging`, `spam`, `classification`, `local`, `privacy`, `self-hosted`, `laya`

## Description (long)
Laya Mail Triage automatically organizes your inbox by asking a local decision model what each message is.

**Two-round tagging.** Round 1 picks exactly one category; round 2 checks for spam independently — so a single message can be both `ads` and `Spam`.

**Categories you choose.** Enter any comma-separated list (for example `personal, work, shopping, ads`). An existing tag with the same name is reused, including Thunderbird's built-in `Work` and `Personal`; otherwise a new tag is created from the label.

**Spam handling.** Messages above the spam threshold (default 0.85) get the `Spam` tag and are marked as junk using Thunderbird's native junk state.

**Works on your own machine.** The extension talks to a Laya server you run yourself — by default `http://127.0.0.1:8010`. Nothing is sent to the developer or any third party.

**Built-in tooling.** Scan the newest N messages from a chosen inbox (skipping ones already handled), watch a persistent classification log, and — optionally — capture your own tag corrections as a dataset you can use to fine-tune the model later.

**Requirements.** This extension needs a Laya decision server. See the project page for the one-line server setup.

### The two questions behind the two rounds
Round 1: *"Classify the email in `body` into exactly one category."*
Round 2: *"Is the email in `body` spam or legitimate mail?"*
Splitting them is what lets a promotional mail be tagged `ads` and `Spam` at the same time.

## Website / Support
https://github.com/invince/ThunderBird-Laya-Mail-Triage-extension

## License
MPL-2.0

## Privacy policy
See `PRIVACY.md` in the repository (paste its content into the listing's privacy-policy field).

## Reviewer notes
- The extension's sole network request is to the **Server URL configured by the user** (default `http://127.0.0.1:8010`). There is no other outbound traffic.
- `data_collection_permissions.required = ["personalCommunications"]` is declared because the message body is sent to that server to be classified. Without it the extension cannot do anything.
- No minified or obfuscated code; sources are plain JS/HTML/CSS in the repository.
- No analytics, no remote code, no third-party scripts.
- `messages.list` sort options require Thunderbird 148+, hence `strict_min_version: 148.0`.
