# Privacy Policy — Laya Mail Triage

_Last updated: 2026-10-04_

## Summary
Laya Mail Triage classifies your mail against a decision server **you** host. The developer collects nothing and operates no servers.

## What the extension reads
- The plain-text body and basic headers of incoming mail, so it can classify them.

## What it transmits, and where
- The message body is sent to the **Server URL** you set in the extension settings. The default is `http://127.0.0.1:8010` — a service on your own computer.
- Nothing else is transmitted. The developer receives no data.

## What is stored locally (in Thunderbird's extension storage)
- Your settings (server URL, API key, categories, tags, thresholds).
- A rolling log of recent classifications (subject, chosen category, spam flag, action).
- Only if you enable **Capture corrections**: the text of messages whose tags you edited, together with the predicted and corrected labels. This stays on your machine until you clear or export it.

## Third parties
None. The extension makes no network requests other than to the Server URL you configure.

## Data collection declaration
The extension declares `personalCommunications` in its manifest, because it transmits the content of your messages to the server you configure in order to classify them. It cannot function without this.

## Contact
https://github.com/invince/ThunderBird-Laya-Mail-Triage-extension/issues
