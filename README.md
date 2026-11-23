# X Document Manager

A private WhatsApp assistant that files every document you send it, reads what is inside,
and hands the right paper back the moment you ask for it — in the chat, as the actual file.

You send a rent agreement, a legal notice, a court order, an FIR, an invoice, a scanned
photo of a stamp paper. The bot reads it, gives it a proper name, notes the parties, dates,
amounts, case number and court, puts it in the right folder under the right case, and keeps
a searchable copy. Later you type `rent agreement Sharma` or `notices from last month` and
the PDF comes straight back to you.

It also:

- **answers questions from inside a document** — “what is the notice period in the rent agreement”
  gets the actual clause quoted back, with the page number;
- **drafts documents** — legal notice, cheque-bounce notice, rent agreement, NDA, affidavit,
  vakalatnama, power of attorney, sale deed outline, employment letter, police complaint,
  consumer complaint, loan agreement — as an editable Word file plus a PDF;
- **compiles a case file** — one zip with a numbered index page and a CSV manifest, in date order;
- **keeps your dates** — hearing dates, limitation dates, “remind me 3 days before”;
- **undoes mistakes** — every delete, move, rename, retag can be reversed.

Everything runs on your own machine. No account, no subscription, no cloud. Add an AI key
later if you want nicer wording — it is optional.

---

## 1. Start it (2 minutes)

You need [Node.js](https://nodejs.org) 20.6 or newer (22 recommended). Then, in this folder:

```bash
npm install
npm start
```

The terminal prints:

```
  X DOCUMENT MANAGER — your documents, on demand
  Dashboard   http://localhost:3000
  Access code 334-5E7-9C6
  Documents   10 filed · 4 cases · 0 needs reviews
  WhatsApp    not connected — opens in demo mode (dashboard chat works)
  Data folder /path/to/data
```

Open **http://localhost:3000** in your browser and enter the access code. That code is also
saved in `data/dashboard-token.txt` (change it any time by setting `DASHBOARD_TOKEN` in `.env`).

The dashboard has six tabs — **Chat**, **Library**, **Cases**, **Dates**, **Draft**, **Setup** —
and the Chat tab is the same bot that will answer you on WhatsApp.

> **Demo data:** the first run includes 10 sample documents and 4 cases so you can try
> everything straight away. Clear them whenever you like with `npm run seed -- --clear`.

### Try it without WhatsApp

```bash
npm run sim
```

That is the same bot in your terminal. Type `help`, then try
`rent agreement`, `cheque bounce`, `notices from last month`, `case 1`, `bundle`.
Type `upload /full/path/to/file.pdf` to file a real document.

---

## 2. Connect WhatsApp (optional, 15 minutes)

The bot speaks the **official WhatsApp Cloud API**. You need a free Meta developer account,
a phone number, and a public HTTPS address that Meta can reach (a tunnel is fine).

1. Go to <https://developers.facebook.com/apps> → **Create app** → type **Business** →
   add the **WhatsApp** product.
2. Meta gives you a **test number** and a temporary token. Copy:
   - **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - **Temporary access token** → `WHATSAPP_TOKEN`
3. Put the bot on a public address. Easiest with a tunnel:

   ```bash
   npx localtunnel --port 3000      # or: cloudflared tunnel --url http://localhost:3000
   ```

   You get a URL like `https://your-name.loca.lt`.
4. In Meta → **WhatsApp → Configuration → Webhook**:
   - **Callback URL**: `https://your-name.loca.lt/webhook/whatsapp`
   - **Verify token**: `xdocmanager-verify` (or whatever you set in `WHATSAPP_VERIFY_TOKEN`)
   - Click **Verify and save**, then **Subscribe** to the `messages` field.
5. Copy `.env.example` to `.env` and fill in:

   ```ini
   OWNER_NAME=Adv. Your Name
   OWNER_PHONE=919876543210          # your number, digits only
   WHATSAPP_TOKEN=EAAG...
   WHATSAPP_PHONE_NUMBER_ID=1234567890
   WHATSAPP_VERIFY_TOKEN=xdocmanager-verify
   WHATSAPP_APP_SECRET=...            # optional but recommended
   ```

6. Restart (`Ctrl+C`, then `npm start`). The banner should now say
   `WhatsApp connected`.

Now message the bot from your own number. Only numbers in `OWNER_PHONE` / `ALLOWED_PHONES`
are answered; everybody else is ignored, so your files stay private.

> **Tunnel notes.** A free tunnel URL changes each time you restart it — update the webhook
> URL in Meta when that happens. For daily use, a small always-on server (or a paid fixed
> tunnel) is calmer. Keep `npm start` running: it is the program that receives your messages.

---

## 3. Everyday use

Send any PDF, Word file, text file, photo or scanned page. Then:

| You type | What happens |
| --- | --- |
| `rent agreement` | The newest matching document comes back as a file |
| `rent agreement Sharma` | Same, narrowed by name |
| `notices from last month` | All matching notices in that period |
| `D12` | Opens document D12 |
| `cases` / `case 2` | Your cases / one case with its file index |
| `index` | Printable index of the open case |
| `bundle` | Zips the open case: `00_INDEX.pdf`, `00_MANIFEST.csv`, then the papers in order |
| `what is the notice period in the rent agreement` | Quotes the clause, with page number |
| `draft legal notice for Rs 2,50,000 from Rakesh Mehta for unpaid invoice dated 12/04/2025 at Jaipur` | Drafts it, sends the editable Word file |
| `remind me 3 days before 12/12/2026 hearing` | Adds a reminder |
| `deadlines` | Everything coming up |
| `rename D4 to Notice to Prakash final` | Renames, re-files the PDF on disk |
| `move D9 to 2` | Moves the document into case 2 (number as shown by `cases`) |
| `type D11 as sale deed` | Corrects the document type |
| `date D11 12/03/2025` | Corrects the date |
| `tag D11 urgent` | Adds a tag |
| `note D11 client will send the original` | Adds a searchable note |
| `delete D11` then `yes` | Removes it (kept in the archive) |
| `undo` | Reverses the last delete/move/rename/retag |

The bot replies in plain English (and understands common Hindi words like *kiraya*,
*notice bhejo*, *case dikhao*). It never invents a document: if it cannot find something it
says so and suggests a wider search.

### Where your files live

```
data/
  library/owner-<you>/<M1-Case-name|00-Unfiled>/<06-Notices>/2026-10-16_Legal-Notice-to-Prakash_D4.pdf
  imports/     original uploads, untouched
  exports/     bundles and drafts you generated
  trash/       deleted documents (restorable)
  logs/
  xdocmanager.db   the catalogue (titles, dates, parties, full text)
  dashboard-token.txt
```

Copy the whole `data` folder to back up. Copy it back to restore — no other step needed.

---

## 4. Settings

Copy `.env.example` to `.env`; every line is optional.

| Setting | Meaning |
| --- | --- |
| `OWNER_NAME` | Your name, used in greetings |
| `OWNER_PHONE` | Your WhatsApp number, digits only — the only number that gets answers |
| `ALLOWED_PHONES` | Extra numbers, comma separated (junior, clerk) |
| `DASHBOARD_TOKEN` | Password for the dashboard; auto-generated if empty |
| `PORT` | Web port, default 3000 |
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | Optional AI upgrade — `openai`, `anthropic`, `openrouter` or `ollama`. Better summaries and conversational answers. Read-only: it never changes your files |
| `TESSERACT_BIN` | Path to Tesseract if you installed it, for reading photographed pages without an AI key |
| `MAX_UPLOAD_MB` | Upload limit, default 64 |

**Hindi and other Indian languages** work: the text is read and searched, and drafts come out
as Word files (the PDF writer is Latin-only, so Hindi drafts are sent as `.docx`).

---

## 5. If something goes wrong

- **“Port 3000 is already in use”** — another copy is running. Close it, or set `PORT=3001`
  in `.env`.
- **The dashboard asks for a code I lost** — it is in `data/dashboard-token.txt`, or set
  `DASHBOARD_TOKEN` in `.env` and restart.
- **A scanned PDF came back “needs review”** — there was no text layer. Send the photo
  instead (with `TESSERACT_BIN` set or an AI key), or type its details:
  `rename D12 to ...`, `date D12 ...`, `type D12 ...`.
- **WhatsApp is silent** — the webhook URL in Meta must match your current tunnel address,
  and `npm start` must be running. Check `data/logs/`.
- **A document landed in the wrong case** — `move D12 to 3`, and `undo` always works.

---

## 6. For the curious

- Fully offline analysis: document type (40+ Indian types), parties and their roles, dates,
  amounts with labels, case numbers, courts, statutes, clause extraction, blanks to fill,
  duplicate detection by SHA-256.
- Search: SQLite FTS5 (porter stemming, prefix indexes), synonyms, typo correction, date and
  type filters, and passage highlighting for questions.
- Security: dashboard cookie + access code, WhatsApp signature check (HMAC), owner-only
  replies, message de-duplication, path checks on every file download.
- Tests: `npm test` (40 tests — analysis, search, drafts, bundles, full chat flows, HTTP API).
- Demo data: `npm run seed` to load, `npm run seed -- --clear` to remove.

Built for one desk, not a thousand: everything is a folder and a database you can copy.

## Hindi and Urdu

Documents in **Hindi** and **Urdu** are read with the same fields as English — type,
date, parties with roles, amounts, court, case numbers and sections. The title stays
in the document's own script (for example `किराया अनुबंध — शर्मा बनाम मेहता (2026)`),
searches work with Devanagari or Urdu words (`पिछले महीने के नोटिस`, `گزشتہ ماہ کے نوٹس`),
and the dashboard has a language switch that also sets right-to-left layout for Urdu.
PDF export is Latin-only, so Hindi/Urdu exports are produced as **DOCX**.

## eCourts memory

Send the eCourts **Case Status** page saved as a `.txt` file **once** — from the chat,
from WhatsApp, or with:

```
npm run ecourts -- path/to/ecourts.txt
```

Every CNR, case number, court, party, stage, status and next hearing date in the file is
stored in SQLite (`ecourts_cases`) and the raw file is kept in `data/ecourts/`. It survives
restarts, so the file never has to be sent again. Ask `ecourts`, `next hearing`, or send a
CNR number to get a case back. The dashboard shows the same data under **Setup → eCourts memory**,
and `GET /api/ecourts` returns it as JSON.

## A permanent link (recommended for daily phone use)

The preview URL inside a development sandbox changes whenever the sandbox is
recycled. For a link you can keep on your phone's home screen, deploy this repo
once — it is a single Node service with one persistent volume:

| Where | How |
| --- | --- |
| **Render** | New → Blueprint → pick this repo. `render.yaml` creates the service, a 5 GB disk at `/data` and a generated `DASHBOARD_TOKEN`. |
| **Railway** | New Project → Deploy from repo (Dockerfile is detected). Add a volume mounted at `/data`, and set `DATA_DIR=/data`, `DASHBOARD_TOKEN=…`. |
| **Any VPS** | `docker build -t xdm . && docker run -d -p 80:3000 -v /srv/xdm:/data -e DASHBOARD_TOKEN=ABC-DEF-GHI --restart unless-stopped --name xdm xdm` |

Then open `https://<your-domain>/?token=<DASHBOARD_TOKEN>` on the iPhone and use
**Share → Add to Home Screen**. Documents, the SQLite database and the eCourts
memory all live inside `DATA_DIR`, so they survive redeploys as long as the
volume is kept. `GET /healthz` answers `{"ok":true}` for uptime checks.
