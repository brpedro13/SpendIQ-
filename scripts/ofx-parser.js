// OFX Parser - Parses Nubank OFX files into transaction objects

/**
 * Parse an OFX file content string into an array of transactions
 * @param {string} content - Raw OFX file content
 * @param {object} rules - Categorization rules
 * @param {function} applyRules - Function to apply rules to description
 * @returns {Array} Array of transaction objects
 */
export function parseOfx(content, rules, applyRules) {
    const transactions = [];

    // Extract all STMTTRN blocks
    const txnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/g;
    let match;

    while ((match = txnRegex.exec(content)) !== null) {
        const block = match[1];

        const type = extractTag(block, 'TRNTYPE');
        const dateRaw = extractTag(block, 'DTPOSTED');
        const amount = parseFloat(extractTag(block, 'TRNAMT') || '0');
        const memo = extractTag(block, 'MEMO') || '';
        const fitId = extractTag(block, 'FITID') || '';

        // Parse date: 20260301000000[-3:BRT] → 2026-03-01
        const date = parseOfxDate(dateRaw);
        if (!date) continue;

        // Clean up description
        const description = memo.trim();
        if (!description) continue;

        // Apply categorization rules
        const { category, for: forWhom } = applyRules(description, rules);

        transactions.push({
            date,
            description,
            value: amount,
            category,
            for: forWhom,
            source: 'nubank_debit',
            fitId // unique ID to avoid duplicates
        });
    }

    return transactions;
}

function extractTag(block, tag) {
    // OFX SGML format: <TAG>value\n or <TAG>value<
    const regex = new RegExp(`<${tag}>([^<\\n]+)`);
    const match = block.match(regex);
    return match ? match[1].trim() : null;
}

function parseOfxDate(dateStr) {
    if (!dateStr) return null;
    // Format: 20260301000000[-3:BRT] or 20260301
    const match = dateStr.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!match) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
}