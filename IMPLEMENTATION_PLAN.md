# 🧮 Personal Finance Tracker — Implementation Plan

A lightweight, privacy-first expense tracker for family expenses.  
Data is parsed from bank and credit card CSVs → categorized automatically → visualized in a local web dashboard.

---

## 📁 Project Structure

```
personal-finance-tracker/
├── data/
│   ├── Nubank_2025-06-10.csv
│   ├── Nubank_2025-10-10.csv
│   ├── NU_26447691_01MAI2025_31MAI2025.csv
│   ├── NU_26447691_01OUT2025_05OUT2025.csv
│   └── merged.json
├── config/
│   └── rules.json
├── scripts/
│   └── parse.js
├── dashboard/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── chart.js
├── package.json
└── README.md
```

---

## 🧰 Tech Stack

| Purpose | Tool / Library |
|----------|----------------|
| CSV parsing | [PapaParse](https://www.npmjs.com/package/papaparse) |
| Date handling | [Day.js](https://day.js.org/) |
| File I/O | Node.js `fs/promises` |
| Data visualization | [Chart.js](https://www.chartjs.org/) |
| Web framework | Plain HTML + JS (no backend) |
| Static hosting (optional) | GitHub Pages or local browser |

---

## 🧩 Core Workflow

1. **Input CSVs** → `data/debit.csv` + `data/credit.csv`  
   - Format: `Date;Description;Value;`
2. **Run parser script (`scripts/parse.js`)**
   - Merges both CSVs
   - Normalizes data (dates, numeric values)
   - Applies categorization and "for whom" tagging rules
   - Outputs a unified JSON dataset → `data/merged.json`
3. **Open `dashboard/index.html`**
   - Loads `merged.json`
   - Displays interactive charts:  
     - Expenses by Category  
     - Expenses by Person  
     - Monthly totals  
     - Top merchants/descriptions

---

## 🧠 Categorization Logic

### 1. Rule Matching

Rules are defined in `config/rules.json`, e.g.:

```json
{
  "ifd": { "category": "delivery", "for": "both" },
  "uber": { "category": "transport", "for": "both" },
  "netflix": { "category": "streaming", "for": "family" },
  "petlove": { "category": "dog", "for": "dog" },
  "paiol": { "category": "restaurant", "for": "both" },
  "mercado": { "category": "groceries", "for": "both" }
}
```

### 2. Matching Strategy
- Lowercase both the transaction description and all rule keys.  
- Perform **substring matching** (not regex, unless needed for performance).  
- First rule that matches wins.  
- If no match found → category = `"uncategorized"`, for = `"unknown"`.

### 3. Example

Input CSV:

```
Date;Description;Value
2025-05-29;Ifd*Cafe Paiol Nordest;86.89
```

Output JSON entry:

```json
{
  "date": "2025-05-29",
  "description": "Ifd*Cafe Paiol Nordest",
  "value": 86.89,
  "category": "delivery",
  "for": "both"
}
```

---

## ⚙️ Parser Script (`scripts/parse.js`)

**Responsibilities:**
1. Read both CSVs.
2. Normalize and merge.
3. Apply categorization.
4. Save as `merged.json`.

**Pseudocode Outline:**

```js
import fs from "fs/promises";
import Papa from "papaparse";
import dayjs from "dayjs";

const RULES_PATH = "./config/rules.json";
const INPUT_FILES = ["./data/debit.csv", "./data/credit.csv"];
const OUTPUT_FILE = "./data/merged.json";

const readCsv = async (path) => {
  const content = await fs.readFile(path, "utf8");
  return Papa.parse(content, { header: true, delimiter: ";", skipEmptyLines: true }).data;
};

const applyRules = (description, rules) => {
  const lowerDesc = description.toLowerCase();
  for (const [keyword, rule] of Object.entries(rules)) {
    if (lowerDesc.includes(keyword.toLowerCase())) {
      return rule;
    }
  }
  return { category: "uncategorized", for: "unknown" };
};

(async () => {
  const rules = JSON.parse(await fs.readFile(RULES_PATH, "utf8"));
  let merged = [];

  for (const file of INPUT_FILES) {
    const rows = await readCsv(file);
    merged.push(...rows.map((row) => {
      const { category, for: forWhom } = applyRules(row.Description, rules);
      return {
        date: dayjs(row.Date).format("YYYY-MM-DD"),
        description: row.Description.trim(),
        value: parseFloat(row.Value.replace(",", ".")),
        category,
        for: forWhom
      };
    }));
  }

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(merged, null, 2));
  console.log(`✅ Parsed and saved ${merged.length} transactions.`);
})();
```

---

## 📊 Dashboard

### 1. Data Loading
`app.js` fetches `../data/merged.json` and stores it in memory.

### 2. Visualizations (`chart.js`)
Use [Chart.js](https://www.chartjs.org/docs/latest/) for:
- **Pie chart** — Spending by category  
- **Bar chart** — Spending by “for whom”  
- **Line chart** — Total per month  
- **Table view** — Filterable list of expenses

Example snippet:
```js
const renderCategoryChart = (data) => {
  const totals = {};
  data.forEach(d => totals[d.category] = (totals[d.category] || 0) + d.value);

  new Chart(document.getElementById("categoryChart"), {
    type: "pie",
    data: {
      labels: Object.keys(totals),
      datasets: [{ data: Object.values(totals) }]
    }
  });
};
```

---

## 🧩 Future Enhancements

| Feature | Description |
|----------|--------------|
| ✅ Categorization rules editor | Web UI to edit `rules.json` directly |
| 🕒 Monthly import automation | Watch folder for new CSVs and auto-run parser |
| 💾 SQLite storage | Optional persistence beyond JSON |
| 📈 Budget planner | Compare spending vs budget per category |
| 📱 Mobile dashboard | Responsive layout or PWA |
| ☁️ Cloud sync | Push data to Google Drive or Supabase for backup |

---

## 🧪 Development Commands

**Setup**
```bash
npm init -y
npm install papaparse dayjs chart.js
```

**Run parser**
```bash
node scripts/parse.js
```

**View dashboard**
Just open `dashboard/index.html` in a browser (no server required).

Optionally:
```bash
npx serve dashboard
```

---

## 🧾 Summary

| Goal | Achieved by |
|------|--------------|
| Unified expenses from bank + credit card | Node CSV parser |
| Categorization & “for whom” tagging | Keyword rules in `config/rules.json` |
| Charts & insights | Chart.js dashboard |
| Local, private, simple updates | JSON + static HTML |
| Extensible for future automation | Node modular architecture |
