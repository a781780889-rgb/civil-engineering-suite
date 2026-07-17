/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * مولّد ملفات CSV (متوافق مع RFC 4180 + BOM لدعم العربية في Excel)
 */

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 * @returns {Buffer}
 */
function generateCsv(headers, rows) {
  const lines = [];
  lines.push(headers.map(csvEscape).join(','));
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  const content = '\uFEFF' + lines.join('\r\n'); // BOM لضمان عرض عربي سليم في Excel
  return Buffer.from(content, 'utf-8');
}

module.exports = { generateCsv };
