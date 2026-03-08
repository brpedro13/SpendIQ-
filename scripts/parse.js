import fs from "node:fs/promises";
import Papa from "papaparse";
import dayjs from "dayjs";
import { parseOfx } from "./ofx-parser.js";

const RULES_PATH = "./config/rules.json";
const IGNORE_PATH = "./config/ignore.json";
const OVERRIDES_PATH = "./data/overrides.json";
const DATA_DIR = "./data";
const OUTPUT_FILE = "./data/merged.json";

const readCsv = async (path) => {
  try {
    const content = await fs.readFile(path, "utf8");
    const sample = content.slice(0, 4096);
    const semiCount = (sample.match(/;/g) || []).length;
    const commaCount = (sample.match(/,/g) || []).length;
    const delimiter = semiCount > commaCount ? ";" : ",";
    const parsed = Papa.parse(content, { header: true, delimiter, skipEmptyLines: true }).data;
    return parsed.map((row) => {
      const cleaned = {};
      for (const [k, v] of Object.entries(row)) {
        const key = (k || "").replace(/^\uFEFF/, "").trim();
        cleaned[key] = v;
      }
      return cleaned;
    });
  } catch (error) {
    console.error(`Error reading ${path}:`, error.message);
    return [];
  }
};

const getField = (row, keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }
  return "";
};

const applyRules = (description, rules) => {
  if (!description) return { category: "uncategorized", for: "unknown" };
  const lowerDesc = description.toLowerCase();
  for (const [keyword, rule] of Object.entries(rules)) {
    if (lowerDesc.includes(keyword.toLowerCase())) return rule;
  }
  return { category: "uncategorized", for: "unknown" };
};

const shouldIgnoreTransaction = (transaction, ignoreConfig) => {
  if (!ignoreConfig || !ignoreConfig.rules) return false;
  const description = transaction.description || "";
  for (const rule of ignoreConfig.rules) {
    if (rule.type === "description_contains") {
      if (description.toLowerCase().includes(rule.value.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
};

const applyOverrides = (transactions, overrides) => {
  if (!overrides || !overrides.overrides) return transactions;
  let count = 0;
  const updated = transactions.map(t => {
    const key = `${t.date}|${t.description}|${t.value}`;
    if (overrides.overrides[key]) {
      count++;
      return {
        ...t,
        category: overrides.overrides[key].category || t.category,
        for: overrides.overrides[key].for || t.for,
        manual_override: true
      };
    }
    return t;
  });
  if (count > 0) console.log(`✅ Applied ${count} manual overrides`);
  return updated;
};

const normalizeDate = (dateStr) => {
  if (!dateStr) return null;
  if (dateStr.includes("/")) {
    const [day, month, year] = dateStr.split("/");
    return dayjs(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`).format("YYYY-MM-DD");
  }
  return dayjs(dateStr).format("YYYY-MM-DD");
};

const normalizeAmount = (amountStr) => {
  if (!amountStr) return 0;
  const cleaned = amountStr.toString().replace(/[^\d.,-]/g, '');
  return Number.parseFloat(cleaned.replace(",", "."));
};

const processNubankCsv = (rows, rules) => {
  return rows.map((row) => {
    const title = getField(row, ["title", "Título", "descricao", "Descrição", "description"]);
    const amount = getField(row, ["amount", "valor", "Valor"]);
    const date = getField(row, ["date", "data", "Data"]);
    const { category, for: forWhom } = applyRules(title, rules);
    const rawValue = normalizeAmount(amount);
    return {
      date: normalizeDate(date),
      description: title?.trim() || "",
      value: rawValue * -1,
      category, for: forWhom, source: "nubank_card_csv"
    };
  });
};

const processNubankDebitCsv = (rows, rules) => {
  return rows.map((row) => {
    const description = getField(row, ["Descrição", "Descricao", "descricao", "title", "description"]);
    const date = getField(row, ["Data", "data", "date"]);
    const value = getField(row, ["Valor", "valor", "amount"]);
    const transactionId = getField(row, ["Identificador", "identifier", "transaction_id", "id"]);
    const { category, for: forWhom } = applyRules(description, rules);
    return {
      date: normalizeDate(date),
      description: description?.trim() || "",
      value: normalizeAmount(value),
      transactionId: transactionId?.trim() || undefined,
      category, for: forWhom, source: "nubank_debit_csv"
    };
  });
};

// Normalize a description for dedup purposes.  We lower‑case, collapse
// whitespace (including non‑breaking spaces), unify various dash characters
// and strip off trailing bank/account details that vary between exports.
const normalizeForDedup = (desc) => {
  if (!desc) return '';
  let d = desc.toString().toLowerCase();
  // collapse NBSP and other odd spaces
  d = d.replace(/[\u00A0\u202F\u2007]/g, ' ');
  // unify dash characters to plain hyphen
  d = d.replace(/[\u2012-\u2015]/g, '-');
  d = d.replace(/\s+/g, ' ').trim();
  // remove common PIX/bank trailing info so two exports look the same
  // drop any leading bullet / CPF portion which varies per export
  d = d.replace(/ - [•\d\.\-]+.*$/i, '');
  d = d.replace(/ - bco .*$/i,'');
  d = d.replace(/ag[eê]ncia:.*$/i,'');
  d = d.replace(/conta:.*$/i,'');
  return d.trim();
};

// Deduplicate with conservative rules to avoid deleting legitimate repeated
// charges while still removing known CSV+OFX duplicates.
const deduplicateTransactions = (transactions) => {
  // 1) Remove exact duplicates only when a stable transaction id exists.
  const seenStrong = new Set();
  const withStrongDedup = transactions.filter(t => {
    const txId = t.transactionId || t.fitId;
    if (!txId) return true;
    const normDesc = normalizeForDedup(t.description);
    const normValue = Number(t.value).toFixed(2);
    const key = `${txId}|${t.date}|${normDesc}|${normValue}`;
    if (seenStrong.has(key)) return false;
    seenStrong.add(key);
    return true;
  });

  // 2) For same logical key coming from both CSV and OFX, prefer CSV.
  const groups = new Map();
  withStrongDedup.forEach((t, index) => {
    const txId = t.transactionId || t.fitId || '';
    const normDesc = normalizeForDedup(t.description);
    const absValue = Math.abs(Number(t.value || 0)).toFixed(2);
    const groupKey = `${t.date}|${normDesc}|${absValue}|${txId}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push({ t, index });
  });

  const toRemove = new Set();
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    const csvItems = items.filter(x => x.t.source?.includes('_csv'));
    const ofxItems = items.filter(x => x.t.source?.includes('_ofx'));
    if (csvItems.length === 0 || ofxItems.length === 0) continue;
    for (const o of ofxItems) {
      toRemove.add(o.index);
    }
  }

  return withStrongDedup.filter((_, idx) => !toRemove.has(idx));
};

/**
 * Try to infer the "for" field (who) from description patterns when it's unknown.
 * This covers common bank strings like "Transferência Recebida - NAME - ..." or
 * "Transferência enviada pelo Pix - NAME" and plain name-only descriptions.
 */
const inferPersonFromDescription = (transactions) => {
  const namePatterns = [
    /Transfer[ií]ncia\s+Recebida\s*-\s*([^\-–\|]+)\s*-?/i,
    /Transfer[ií]ncia\s+recebida\s+pelo\s+Pix\s*-\s*([^\-–\|]+)\s*-?/i,
    /Transfer[ií]ncia\s+enviada\s+pelo\s+Pix\s*-\s*([^\-–\|]+)\s*-?/i,
    /Transfer[ií]ncia\s+enviada\s*-\s*([^\-–\|]+)\s*-?/i,
    /Transferência\s+Recebida\s+\-\s*([^\-–\|]+)\s*/i,
    /Transferência\s+enviada\s+pelo\s+Pix\s*-\s*([^\-–\|]+)\s*/i
  ];

  // keywords that strongly suggest the "name" is actually a company/merchant
  const companyKeywords = [
    'ltda', 'me', 'pagamentos', 'banco', 'bradesco', 'inter', 'tecnologia',
    'comércio', 'pagamentos', 'nubank', 'santander', 'cia', 'ecommerce',
    'produtos', 'pagto', 'agencia', 'conta', 'unibanco', 'picpay'
  ];

  for (const t of transactions) {
    if (t.for && t.for !== 'unknown') continue;
    const desc = t.description || '';
    // If description is exactly a person's name (no other words), use it
    if (/^[A-Za-zÀ-ÖØ-öø-ÿ\s]+$/.test(desc) && desc.trim().split(/\s+/).length <= 4) {
      t.for = desc.trim().toLowerCase();
      continue;
    }

    // Try patterns
    for (const pat of namePatterns) {
      const m = desc.match(pat);
      if (m && m[1]) {
        let name = m[1].replace(/\s+\-.*$/, '').trim().toLowerCase();
        // Simplify common noise (remove CPF/dots and trailing agency/account info)
        name = name.replace(/\s+\u2022+.*$/, '').replace(/\s*-\s*$/, '').trim();
        // if the extracted text looks like a company, skip it
        if (companyKeywords.some(k => name.includes(k))) {
          break; // don't set t.for
        }
        if (name) {
          t.for = name;
          break;
        }
      }
    }
  }
};

(async () => {
  try {
    console.log("🔄 Starting parsing...");

    const rules = JSON.parse(await fs.readFile(RULES_PATH, "utf8"));

    let ignoreConfig = null;
    try {
      ignoreConfig = JSON.parse(await fs.readFile(IGNORE_PATH, "utf8"));
      console.log("📋 Loaded ignore configuration");
    } catch { console.log("⚠️  No ignore configuration found"); }

    let overrides = null;
    try {
      overrides = JSON.parse(await fs.readFile(OVERRIDES_PATH, "utf8"));
      console.log("📝 Loaded manual overrides");
    } catch { console.log("⚠️  No manual overrides found"); }

    let merged = [];

    const files = await fs.readdir(DATA_DIR);
    const csvFiles = files.filter(f => f.toLowerCase().endsWith('.csv'));
    const ofxFiles = files.filter(f => f.toLowerCase().endsWith('.ofx'));

    console.log(`📁 Found ${csvFiles.length} CSV + ${ofxFiles.length} OFX files`);

    // Process CSV files
    for (const file of csvFiles) {
      const filePath = `${DATA_DIR}/${file}`;
      console.log(`📄 Processing CSV: ${file}...`);
      const rows = await readCsv(filePath);
      if (rows.length === 0) { console.log(`⚠️  No data in ${file}`); continue; }

      let processedRows = [];
      const firstRow = rows[0];
      const hasClassicCard =
        (firstRow.date || firstRow.data || firstRow.Data) &&
        (firstRow.title || firstRow.Título || firstRow.descricao || firstRow.Descrição || firstRow.description) &&
        (firstRow.amount || firstRow.valor || firstRow.Valor);
      const hasDebit =
        (firstRow.Data || firstRow.data || firstRow.date) &&
        (firstRow.Valor || firstRow.valor || firstRow.amount) &&
        (firstRow.Descrição || firstRow.Descricao || firstRow.descricao || firstRow.title || firstRow.description);

      if (hasClassicCard) {
        processedRows = processNubankCsv(rows, rules);
      } else if (hasDebit) {
        processedRows = processNubankDebitCsv(rows, rules);
      } else {
        console.log(`⚠️  Unknown CSV format: ${file}, skipping...`);
        continue;
      }

      const filtered = processedRows.filter(t => !shouldIgnoreTransaction(t, ignoreConfig));
      const ignored = processedRows.length - filtered.length;
      if (ignored > 0) console.log(`🚫 Ignored ${ignored} transactions from ${file}`);
      merged.push(...filtered);
      console.log(`✅ ${filtered.length} transactions from ${file}`);
    }

    // Process OFX files
    for (const file of ofxFiles) {
      const filePath = `${DATA_DIR}/${file}`;
      console.log(`📄 Processing OFX: ${file}...`);
      const content = await fs.readFile(filePath, "utf8");
      const ofxTransactions = parseOfx(content, rules, applyRules);

      const filtered = ofxTransactions.filter(t => !shouldIgnoreTransaction(t, ignoreConfig));
      const ignored = ofxTransactions.length - filtered.length;
      if (ignored > 0) console.log(`🚫 Ignored ${ignored} transactions from ${file}`);
      merged.push(...filtered);
      console.log(`✅ ${filtered.length} transactions from ${file}`);
    }

  // Try to infer missing "for" values from description before deduplication
  inferPersonFromDescription(merged);

  // also attempt simple category guesses for merchants that would
  // otherwise be left uncategorized (user can add more patterns below)
  const inferCategoryFromDescription = (transactions) => {
    const list = [
      // possibly misspelled variants – the user conversation contained both z and m
      { regex: /armaze[mn] urbano/i, category: 'mercado' },
      { regex: /drive digital tecnologia/i, category: 'compras online' },
      // add additional heuristics here as needed
    ];
    for (const t of transactions) {
      if (t.category && t.category !== 'uncategorized') continue;
      const d = t.description || '';
      for (const p of list) {
        if (p.regex.test(d)) {
          t.category = p.category;
          break;
        }
      }
    }
  };
  inferCategoryFromDescription(merged);

  // Deduplicate (important when importing from both CSV and OFX)
  const beforeDedup = merged.length;
  merged = deduplicateTransactions(merged);
  if (beforeDedup !== merged.length) {
    console.log(`🔄 Deduplicated: ${beforeDedup} → ${merged.length}`);
  }

    // Sort newest first
    merged.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Apply overrides
    merged = applyOverrides(merged, overrides);

    // Remove internal IDs before saving
    merged = merged.map(({ fitId, transactionId, ...rest }) => rest);

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(merged, null, 2));

    console.log(`\n🎉 Saved ${merged.length} transactions to ${OUTPUT_FILE}`);

    // Summary
    const catSummary = {};
    const forSummary = {};
    for (const t of merged) {
      catSummary[t.category] = (catSummary[t.category] || 0) + 1;
      forSummary[t.for] = (forSummary[t.for] || 0) + 1;
    }
    console.log("\n📊 By category:");
    for (const [k, v] of Object.entries(catSummary)) console.log(`  ${k}: ${v}`);
    console.log("\n👥 By person:");
    for (const [k, v] of Object.entries(forSummary)) console.log(`  ${k}: ${v}`);

  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
})();