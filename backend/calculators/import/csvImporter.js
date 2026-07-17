/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * الجزء الثاني: طرق الاستيراد
 * ==========================================
 * استيراد CSV - Parser حقيقي متوافق مع معيار RFC 4180
 * يدعم: الفواصل المخصصة، القيم المقتبسة، الأسطر الجديدة داخل القيم، BOM، الترميز العربي (UTF-8)
 * بدون أي مكتبات خارجية.
 */

/**
 * إزالة BOM (Byte Order Mark) الذي تضيفه برامج مثل Excel عند حفظ ملفات UTF-8
 */
function stripBOM(text) {
  if (text.charCodeAt(0) === 0xFEFF) return text.slice(1);
  return text;
}

/**
 * اكتشاف الفاصل المستخدم في الملف تلقائياً (فاصلة، فاصلة منقوطة، تاب)
 * بعض إصدارات Excel العربية تستخدم الفاصلة المنقوطة (;) بدلاً من الفاصلة (,)
 */
function detectDelimiter(sampleLine) {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const count = sampleLine.split(d).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * محلل CSV حقيقي على مستوى الأحرف (character-level state machine)
 * يتعامل بشكل صحيح مع:
 * - قيم بين علامتي اقتباس تحتوي فواصل
 * - علامات اقتباس مزدوجة داخل القيمة ("" تعني ")
 * - أسطر جديدة (\n) داخل قيمة مقتبسة
 * - نهايات أسطر مختلطة (\r\n, \n, \r)
 */
function parseCSV(rawText, options = {}) {
  const text = stripBOM(rawText);
  const firstLineEnd = text.search(/\r\n|\r|\n/);
  const sampleLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const delimiter = options.delimiter || detectDelimiter(sampleLine);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === delimiter) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      if (ch === '\r' && text[i + 1] === '\n') i += 2;
      else i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmptyRows = rows.filter(r => r.some(c => c !== undefined && c.trim() !== ''));
  return { delimiter, rows: nonEmptyRows };
}

/**
 * تحويل صفوف CSV إلى مصفوفة كائنات (objects) باستخدام أول صف كرؤوس أعمدة
 */
function csvToObjects(rawText, options = {}) {
  const { delimiter, rows } = parseCSV(rawText, options);
  if (rows.length === 0) {
    return { delimiter, headers: [], records: [] };
  }
  const headers = rows[0].map(h => (h || '').trim());
  const records = rows.slice(1).map((r, idx) => {
    const obj = { _row: idx + 2 };
    headers.forEach((h, colIdx) => {
      obj[h || `عمود_${colIdx + 1}`] = (r[colIdx] !== undefined ? r[colIdx].trim() : '');
    });
    return obj;
  });
  return { delimiter, headers, records };
}

/**
 * تحويل قيمة نصية إلى رقم بأمان (يدعم الفاصلة العربية والفاصلة العشرية)
 */
function toNumber(value) {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const cleaned = String(value)
    .replace(/[٬,]/g, '')
    .replace(/٫/g, '.')
    .trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * محاولة ربط أعمدة CSV بأعمدة حصر كميات قياسية (اسم العنصر، الكمية، الوحدة، السعر)
 * باستخدام مطابقة أسماء تقريبية عربية/إنجليزية شائعة
 */
const COLUMN_ALIASES = {
  item: ['item', 'name', 'description', 'العنصر', 'الاسم', 'البند', 'الوصف', 'اسم العنصر'],
  quantity: ['quantity', 'qty', 'amount', 'الكمية', 'كمية', 'عدد'],
  unit: ['unit', 'uom', 'الوحدة', 'وحدة'],
  unit_price: ['unit_price', 'price', 'rate', 'سعر الوحدة', 'السعر', 'سعر'],
  category: ['category', 'type', 'الفئة', 'النوع', 'التصنيف'],
};

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase();
}

function mapColumns(headers) {
  const mapping = {};
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    const found = headers.find(h => aliases.some(a => normalizeHeader(h) === normalizeHeader(a)));
    if (found) mapping[key] = found;
  }
  return mapping;
}

/**
 * استيراد ملف حصر كميات كامل من CSV مع استخراج البنود، الكميات، الأسعار، والتكلفة الإجمالية
 */
function importBOQFromCSV(rawText, options = {}) {
  const { delimiter, headers, records } = csvToObjects(rawText, options);
  if (records.length === 0) {
    return {
      success: false,
      error: 'الملف فارغ أو لا يحتوي على بيانات صالحة',
    };
  }

  const columnMap = mapColumns(headers);
  if (!columnMap.item) {
    return {
      success: false,
      error: 'تعذر التعرف على عمود اسم العنصر/البند في الملف',
      detected_headers: headers,
    };
  }

  const items = [];
  let totalCost = 0;
  const warnings = [];

  records.forEach((rec) => {
    const itemName = rec[columnMap.item];
    if (!itemName) return;
    const quantity = columnMap.quantity ? toNumber(rec[columnMap.quantity]) : 0;
    const unitPrice = columnMap.unit_price ? toNumber(rec[columnMap.unit_price]) : 0;
    const unit = columnMap.unit ? rec[columnMap.unit] : '';
    const category = columnMap.category ? rec[columnMap.category] : 'عام';
    const lineCost = round2(quantity * unitPrice);
    totalCost += lineCost;

    if (columnMap.quantity && quantity === 0) {
      warnings.push(`الصف ${rec._row}: الكمية صفر أو غير صالحة للبند "${itemName}"`);
    }

    items.push({
      row: rec._row,
      item: itemName,
      category,
      quantity,
      unit,
      unit_price: unitPrice,
      line_cost: lineCost,
    });
  });

  return {
    success: true,
    source: 'csv',
    delimiter,
    detected_columns: columnMap,
    detected_headers: headers,
    item_count: items.length,
    items,
    total_cost: round2(totalCost),
    warnings,
  };
}

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

module.exports = {
  parseCSV,
  csvToObjects,
  importBOQFromCSV,
  mapColumns,
  toNumber,
};
