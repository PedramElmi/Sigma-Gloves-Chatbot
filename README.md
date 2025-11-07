
---

## 🧤 2️⃣ Sigma Gloves Chatbot

```markdown
# Sigma Gloves Chatbot

**Status:** 🧩 Under Development  
**Type:** Bilingual Rule-Based Chatbot for PPE Selection  

## Overview
Sigma Gloves Chatbot is an intelligent assistant that recommends suitable protective gloves based on industry type and hazard conditions.  
It communicates in English and Persian and uses a structured knowledge base for accurate recommendations.

## Features
- 💬 Conversational interface (FA / EN)  
- 🧠 Hazard → PPE mapping engine (JSON knowledge base)  
- 🌐 Responsive chat UI (index-fa / index-en pages)  
- 🔄 Modular design for future LLM integration (GPT API)  

## Tech Stack
- **Backend:** Python (Flask prototype)  
- **Frontend:** HTML / CSS / JS  
- **Data:** JSON knowledge graphs for hazard indexing  

# Sigma Gloves Assistant — README

A lightweight, static web app to help users choose the right **Sigma** safety gloves via either a **form-style wizard** or a **chat-style assistant**. Multilingual (FA/EN) with data stored in JSON (and CSV for editing).

---

## 1) Project Structure

```
project-root/
├─ assets/
│  ├─ sigma-logo.png
│  ├─ sigma.css          # shared styling for form-style pages
│  └─ sigma-chat.css     # styling for chat-style pages
├─ data/
│  ├─ fa_catalog.json    # Persian catalog (source of truth for FA)
│  ├─ en_catalog.json    # English catalog (source of truth for EN)
│  ├─ fa_catalog.csv     # optional, for spreadsheet editing
│  └─ en_catalog.csv     # optional, for spreadsheet editing
├─ index-fa.html         # FA form-style assistant
├─ index-en.html         # EN form-style assistant
├─ chat-fa.html          # FA chat-style assistant
└─ chat-en.html          # EN chat-style assistant
```

> The **HTML pages load product data via `fetch()`** from `data/*.json`.
> For this reason, you **must run a local web server** (opening with `file://` will fail due to browser security/CORS).

---

## 2) Quick Start

### Option A — VS Code Live Server (recommended)

1. Open `project-root` in VS Code.
2. Install the **Live Server** extension.
3. Right–click `index-fa.html` → **Open with Live Server**.
4. Open:

   * FA form: `http://127.0.0.1:5500/index-fa.html`
   * EN form: `http://127.0.0.1:5500/index-en.html`
   * FA chat: `http://127.0.0.1:5500/chat-fa.html`
   * EN chat: `http://127.0.0.1:5500/chat-en.html`

### Option B — Python 3 built-in server

```bash
cd project-root
python -m http.server 8000
```

Then visit:

* FA form:  `http://localhost:8000/index-fa.html`
* EN form:  `http://localhost:8000/index-en.html`
* FA chat:  `http://localhost:8000/chat-fa.html`
* EN chat:  `http://localhost:8000/chat-en.html`

### Option C — npx serve (Node)

```bash
cd project-root
npx serve .
```

Open the URL printed in the terminal (often `http://localhost:3000`).

---

## 3) Pages Overview

* **`index-fa.html` / `index-en.html`**
  Form-style wizard (four steps: Industry → Hazard → Environment → Preference).
  Renders a shortlist of 1–3 models with EN388 line, features, “Why this model”, and product link.

* **`chat-fa.html` / `chat-en.html`**
  Conversational assistant (bubbles, typing indicator, quick replies).
  Same recommendation logic, more natural UX.
  Ends with cards + optional direct product links.

Both variants read from their respective `data/<lang>_catalog.json`.

---

## 4) Data Model (JSON)

Each item in `fa_catalog.json` / `en_catalog.json` has:

```json
{
  "code": "+921",
  "name": "Sigma +921",
  "category": "Cut Resistant",
  "standards": { "en388": "2X43", "en407": "—", "en511": "—", "note": "optional" },
  "materials": { "liner": "HPPE", "coating": "Latex/Nitrile/—" },
  "features": ["Feature 1", "Feature 2"],
  "best_for": ["Use case A", "Use case B"],
  "why": "One-sentence product rationale for this language.",
  "link": "https://example.com/product-page"
}
```

**Notes**

* Keep `why` **language-specific** in each JSON.
* Use `"—"` if a standard score is unknown and fill it later.
* `features` / `best_for` are arrays (rendered as comma/Arabic comma separated lists).

---

## 5) CSV Format (Optional Editing)

CSV headers mirror the JSON fields:

```
code,name,category,standards.en388,standards.en407,standards.en511,standards.note,materials.liner,materials.coating,features,best_for,why,link
```

* For multi-value fields (`features`, `best_for`) use **`; `** as separator, e.g.
  `Feature A; Feature B; Feature C`
* CSV files are **not read by the app**; they are provided for spreadsheet editing.
  After editing, convert back to JSON to be used by the app.

---

## 6) Adding or Updating Products

1. Edit `data/fa_catalog.json` and/or `data/en_catalog.json`.
2. Keep the same `code` across both languages.
3. Add a meaningful `why` string tailored to the language.
4. Save and **hard refresh** the page:

   * Windows/Linux: `Ctrl + F5`
   * macOS: `Cmd + Shift + R`

---

## 7) Recommendation Logic (MVP)

Heuristic scoring uses the user’s answers:

* **Hazard: “Cut”/«برش»** → prioritize HPPE cut-resistant set (`+921`, `+911`, `922`)
* **Environment: “Oily”/«روغنی»** → prioritize nitrile family (`348`, `342`, `344`, `332`, `312`, `346`)
* **Environment: “Wet”/«مرطوب»** → latex/foam (`+485`, `412`, `+422`, `418`, `432`)
* **Environment: “Cold”/«سرد»** → winter/insulated (`+446`, `+434`)
* **Preference: “Dexterity”/«مهارت و نرمی»** → prefer lighter/softer models
* **Preference: “Durability”/«دوام و محافظت بیشتر»** → prefer heavy-duty/nitrile models

Top 3 unique matches are shown. You can refine this in the HTML files (search for `pickModels`).

---

## 8) Troubleshooting

* **Nothing loads / “CORS / Fetch” error**
  You opened the HTML with `file://`. Run a local server (see Quick Start).
* **Logo missing**
  Ensure `assets/sigma-logo.png` exists and path is correct.
* **JSON parse error**
  Validate the JSON (trailing commas, quotes, etc.). Use a JSON linter.
* **Changes not visible**
  Hard refresh (cache). See Section 6.
* **Fonts look different offline**
  Pages load `Vazirmatn` from Google Fonts; offline fallback is system fonts.

---

## 9) Browser Support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari).
No build step, no frameworks required; pure HTML/CSS/JS.

---

## 10) Future Enhancements (optional)

* Replace heuristic with a rules engine or LLM prompt (server-side or API-based).
* Datasheet popovers and EN/ISO standard badges.
* PDF export of the final recommendation (FA/EN).
* Analytics on choices (anonymous) to improve scoring.

---

## 11) License & Attribution

* The code in this project is intended for internal/partner use with Sigma Gloves product data.
* Product names, logos, and links are the property of their respective owners.

---

**Enjoy!**
If you run into any issue, start the local server, check the console (`F12 → Console`), and verify JSON paths.
