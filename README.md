# 🧮 Personal Finance Tracker

A lightweight, privacy-first expense tracker for family expenses. Data is parsed from bank and credit card CSVs → categorized automatically → visualized in a local web dashboard.

## ✨ Features

- **CSV Import**: Automatically parse bank and credit card CSV files
- **Smart Categorization**: Rule-based categorization system
- **Interactive Dashboard**: Beautiful charts and visualizations
- **Privacy-First**: All data stays local, no cloud dependencies
- **Family Tracking**: Track expenses by person (both, family, dog, etc.)
- **Security**: Built-in `.gitignore` to protect sensitive financial data

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Add Your CSV Files

Place your bank and credit card CSV files in the `data/` directory. The parser supports multiple formats:

- **Nubank format**: `date,title,amount`
- **Nubank debit format**: `Data,Valor,Identificador,Descrição`

### 3. Run the Parser

```bash
npm run parse
```

This will:
- Read all CSV files from the `data/` directory
- Apply categorization rules from `config/rules.json`
- Generate `data/merged.json` with all transactions

### 4. View the Dashboard

```bash
npm run serve
```

Then open your browser to `http://localhost:3000` (or the URL shown in the terminal).

## 🛠️ Available Scripts

| Command | Description |
|---------|-------------|
| `npm run parse` | Parse CSV files and generate merged.json |
| `npm run serve` | Start the dashboard server |
| `npm run dev` | Parse data and start server (development workflow) |
| `npm run start` | Start the dashboard server (production) |
| `npm run build` | Parse and prepare data for deployment |
| `npm run clean` | Remove generated data files |
| `npm run reset` | Clean and re-parse all data |
| `npm run stats` | Show quick statistics about your data |

**Quick Development Workflow**
```bash
# Parse your CSV files and start the dashboard
npm run dev

# Or step by step:
npm run parse    # Parse CSV files
npm run serve    # Start dashboard
```

## 📁 Project Structure

```
personal-finance-tracker/
├── data/                          # CSV files and generated data
│   ├── *.csv                     # Your bank/credit card CSV files
│   └── merged.json               # Generated unified data
├── config/
│   └── rules.json                # Categorization rules
├── scripts/
│   └── parse.js                  # CSV parser script
├── dashboard/                    # Web dashboard
│   ├── index.html
│   ├── style.css
│   └── app.js
├── package.json
└── README.md
```

## ⚙️ Configuration

### Categorization Rules

Edit `config/rules.json` to customize how transactions are categorized:

```json
{
  "ifd": { "category": "delivery", "for": "both" },
  "uber": { "category": "transport", "for": "both" },
  "netflix": { "category": "streaming", "for": "family" },
  "petlove": { "category": "dog", "for": "dog" }
}
```

Rules use substring matching (case-insensitive) on transaction descriptions.

### Ignore Rules

Edit `config/ignore.json` to exclude specific transactions from your analysis:

```json
{
  "description": "Configuration for ignoring specific transactions",
  "rules": [
    {
      "type": "description_contains",
      "value": "Pagamento de fatura",
      "reason": "Ignore credit card bill payments"
    }
  ]
}
```

This is useful for filtering out:
- Credit card bill payments
- Large transfers
- Investment transactions
- Refunds or reversals

## ✏️ Inline Editing

### Manual Categorization
You can edit individual transactions directly in the dashboard:

1. **Click on any category or "for" field** in the transaction table
2. **Select a new value** from the dropdown
3. **Changes are saved automatically** and persist through re-parsing

### How It Works
- **Individual Overrides**: Changes apply only to specific transactions
- **Persistent Storage**: Manual categorizations are saved in `data/overrides.json`
- **Visual Indicators**: Manually edited fields show a ✏️ icon and green border
- **Re-parsing Safe**: Your manual changes won't be lost when running `npm run parse`

### Usage Tips
- **Start with rules**: Use `config/rules.json` for bulk categorization
- **Fine-tune individually**: Use inline editing for exceptions and corrections
- **Visual feedback**: Green borders and ✏️ icons show which records you've manually edited

## 🔒 Security & Privacy

### Data Protection
- **Local Storage**: All data stays on your computer
- **No Cloud**: No data is sent to external servers
- **Git Protection**: `.gitignore` prevents accidental commits of sensitive data

### What's Protected
- CSV files with bank statements
- Generated `merged.json` file
- Personal financial data
- API keys and credentials

### Best Practices
1. **Never commit CSV files** - They contain sensitive financial data
2. **Use `.gitignore`** - Automatically excludes sensitive files
3. **Local development only** - Don't deploy to public servers
4. **Regular backups** - Keep local backups of your data

## 📊 Dashboard Features

- **Statistics**: Total transactions, spending, averages (filtered by selection)
- **Category Breakdown**: Pie chart of spending by category (filtered by selection)
- **Person Breakdown**: Bar chart of spending by person (filtered by selection)
- **Monthly Trends**: Line chart showing spending over time (filtered by selection)
- **Transaction Table**: Filterable list of all transactions
- **Global Filters**: All filters apply to the entire dashboard - statistics, charts, and table
- **Inline Editing**: Click on category or "for" fields to edit them directly in the table
- **Manual Overrides**: Individual transaction categorizations persist through re-parsing

## 🛠️ Development

### Adding New CSV Formats

To support new CSV formats, modify `scripts/parse.js`:

1. Add a new processing function
2. Update the format detection logic
3. Test with your CSV files

### Customizing the Dashboard

- **Styling**: Edit `dashboard/style.css`
- **Charts**: Modify `dashboard/app.js`
- **Layout**: Update `dashboard/index.html`

## 📝 Supported CSV Formats

### Nubank Credit Card
```csv
date,title,amount
2025-06-02,Ifd*Nutrimia,30.49
2025-06-02,Ifd*Prado Pimentel Ali,103.99
```

### Nubank Debit Account
```csv
Data,Valor,Identificador,Descrição
01/05/2025,-145.00,6813e349-e879-4634-ab71-f47f927ddcbf,Transferência enviada pelo Pix
```

## 🔧 Troubleshooting

### Parser Issues
- Check CSV file format matches supported formats
- Verify file encoding is UTF-8
- Check console output for specific errors

### Dashboard Issues
- Ensure `data/merged.json` exists (run parser first)
- Check browser console for JavaScript errors
- Verify all dependencies are installed

## 🚀 Future Enhancements

- [ ] Rules editor in dashboard
- [ ] Monthly import automation
- [ ] SQLite storage option
- [ ] Budget planning features
- [ ] Mobile-responsive improvements
- [ ] Cloud sync capabilities

## 📄 License

ISC License - Feel free to use and modify for your personal needs.

## 🤝 Contributing

This is a personal project, but suggestions and improvements are welcome!

---

**Happy tracking! 📈💰**
