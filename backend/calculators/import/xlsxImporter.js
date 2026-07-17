/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * الجزء الثاني: طرق الاستيراد
 * ==========================================
 * استيراد Excel (.xlsx) - Parser حقيقي بدون أي مكتبات خارجية (لا XLSX ولا exceljs)
 *
 * ملف .xlsx هو في حقيقته أرشيف ZIP يحتوي ملفات XML.
 * هذا الملف يقوم بـ:
 * 1) قراءة بنية ZIP يدوياً (End of Central Directory + Central Directory + Local File Headers)
 * 2) فك ضغط DEFLATE باستخدام وحدة zlib المدمجة في Node.js (raw inflate)
 * 3) تحليل sharedStrings.xml و sheet1.xml يدوياً لاستخراج بيانات الخلايا
 */

const zlib = require('zlib');

// ---------- قراءة أرشيف ZIP يدوياً ----------

/**
 * يبحث عن توقيع End Of Central Directory (EOCD) في نهاية الملف
 * التوقيع: 0x06054b50
 */
function findEOCD(buffer) {
  const sig = 0x06054b50;
  const minLen = 22;
  for (let i = buffer.length - minLen; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === sig) {
      return i;
    }
  }
  throw new Error('ملف xlsx غير صالح: لم يتم العثور على نهاية سجل ZIP (EOCD)');
}

/**
 * يقرأ جدول Central Directory ويستخرج جميع الملفات (الاسم، الموقع، الحجم، طريقة الضغط)
 */
function readZipEntries(buffer) {
  const eocdOffset = findEOCD(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries = [];
  let offset = centralDirOffset;
  const CENTRAL_SIG = 0x02014b50;

  for (let n = 0; n < totalEntries; n++) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== CENTRAL_SIG) break;

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const fileCommentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);

    entries.push({
      fileName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
}

/**
 * يستخرج محتوى ملف واحد من الأرشيف عبر قراءة Local File Header ثم فك الضغط
 */
function extractZipEntry(buffer, entry) {
  const LOCAL_SIG = 0x04034b50;
  const offset = entry.localHeaderOffset;
  const sig = buffer.readUInt32LE(offset);
  if (sig !== 0x04034b50 && sig !== LOCAL_SIG) {
    throw new Error(`رأس الملف المحلي غير صالح للملف: ${entry.fileName}`);
  }
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraFieldLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraFieldLength;
  const compressedData = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    // بدون ضغط (Stored)
    return compressedData;
  }
  if (entry.compressionMethod === 8) {
    // DEFLATE
    return zlib.inflateRawSync(compressedData);
  }
  throw new Error(`طريقة ضغط غير مدعومة (${entry.compressionMethod}) للملف: ${entry.fileName}`);
}

function unzip(buffer) {
  const entries = readZipEntries(buffer);
  const files = {};
  for (const entry of entries) {
    if (entry.fileName.endsWith('/')) continue; // مجلد
    files[entry.fileName] = extractZipEntry(buffer, entry);
  }
  return files;
}

// ---------- تحليل XML بسيط (بدون مكتبات) ----------

function decodeXmlEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * يستخرج نصوص <si><t>...</t></si> من sharedStrings.xml
 * يتعامل أيضاً مع النصوص المنسقة (rich text) التي تحتوي عدة عناصر <r><t>
 */
function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const siRegex = /<si>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = siRegex.exec(xml)) !== null) {
    const siContent = match[1];
    const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch;
    let combined = '';
    let found = false;
    while ((tMatch = tRegex.exec(siContent)) !== null) {
      combined += decodeXmlEntities(tMatch[1]);
      found = true;
    }
    strings.push(found ? combined : '');
  }
  return strings;
}

/**
 * يحول مرجع خلية مثل "C5" إلى فهرس عمود صفري (A=0, B=1, ...)
 */
function columnLetterToIndex(letters) {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

function parseCellRef(ref) {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  return { col: columnLetterToIndex(match[1]), row: parseInt(match[2], 10) };
}

/**
 * يحلل sheetN.xml ويستخرج مصفوفة صفوف من القيم (نصوص/أرقام)
 * يدعم: القيم الرقمية (n)، النصوص المشتركة (s)، النصوص المضمنة (inlineStr/str)
 */
function parseSheet(xml, sharedStrings) {
  const rows = {};
  const rowRegex = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowNum = parseInt(rowMatch[1], 10);
    const rowContent = rowMatch[2];
    const cellRegex = /<c[^>]*r="([A-Z]+\d+)"[^>]*?(?:\st="([^"]*)")?[^>]*>([\s\S]*?)<\/c>|<c[^>]*r="([A-Z]+\d+)"[^>]*\/>/g;
    let cellMatch;
    const rowData = {};

    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const ref = cellMatch[1] || cellMatch[4];
      if (!ref) continue;
      const parsed = parseCellRef(ref);
      if (!parsed) continue;

      const cellXml = cellMatch[3] || '';
      const typeMatch = cellMatch[0].match(/\st="([^"]*)"/);
      const cellType = typeMatch ? typeMatch[1] : 'n';

      let value = '';
      if (cellType === 's') {
        const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
        if (vMatch) {
          const idx = parseInt(vMatch[1], 10);
          value = sharedStrings[idx] !== undefined ? sharedStrings[idx] : '';
        }
      } else if (cellType === 'inlineStr') {
        const tMatch = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        value = tMatch ? decodeXmlEntities(tMatch[1]) : '';
      } else if (cellType === 'str' || cellType === 'b' || cellType === 'n' || !cellType) {
        const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
        value = vMatch ? decodeXmlEntities(vMatch[1]) : '';
        if (cellType === 'n' || (!cellType && vMatch)) {
          const num = parseFloat(value);
          if (!isNaN(num)) value = num;
        }
      }
      rowData[parsed.col] = value;
    }
    rows[rowNum] = rowData;
  }

  const maxRow = Math.max(0, ...Object.keys(rows).map(Number));
  const result = [];
  for (let r = 1; r <= maxRow; r++) {
    const rowData = rows[r] || {};
    const maxCol = Math.max(-1, ...Object.keys(rowData).map(Number));
    const arr = [];
    for (let c = 0; c <= maxCol; c++) {
      arr.push(rowData[c] !== undefined ? rowData[c] : '');
    }
    result.push(arr);
  }
  return result;
}

/**
 * يحلل workbook.xml وworkbook.xml.rels لبناء قائمة أسماء الأوراق (sheets) ومساراتها الفعلية
 */
function parseWorkbookSheets(workbookXml, relsXml) {
  const sheets = [];
  const sheetRegex = /<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"[^>]*\/>/g;
  let match;
  const relMap = {};
  if (relsXml) {
    const relRegex = /<Relationship[^>]*Id="([^"]*)"[^>]*Target="([^"]*)"[^>]*\/>/g;
    let relMatch;
    while ((relMatch = relRegex.exec(relsXml)) !== null) {
      relMap[relMatch[1]] = relMatch[2];
    }
  }
  while ((match = sheetRegex.exec(workbookXml)) !== null) {
    const name = decodeXmlEntities(match[1]);
    const rId = match[2];
    const target = relMap[rId] || null;
    sheets.push({ name, rId, target });
  }
  return sheets;
}

/**
 * الدالة الرئيسية: تأخذ Buffer لملف xlsx وتعيد بيانات جميع الأوراق كمصفوفات صفوف
 */
function parseXlsxBuffer(buffer) {
  const files = unzip(buffer);

  const workbookXml = files['xl/workbook.xml'] ? files['xl/workbook.xml'].toString('utf8') : null;
  const relsXml = files['xl/_rels/workbook.xml.rels'] ? files['xl/_rels/workbook.xml.rels'].toString('utf8') : null;
  const sharedStringsXml = files['xl/sharedStrings.xml'] ? files['xl/sharedStrings.xml'].toString('utf8') : null;

  if (!workbookXml) {
    throw new Error('ملف xlsx غير صالح: لم يتم العثور على xl/workbook.xml');
  }

  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const sheetsMeta = parseWorkbookSheets(workbookXml, relsXml);

  const sheets = {};
  sheetsMeta.forEach((meta, idx) => {
    let sheetPath = meta.target ? `xl/${meta.target.replace(/^\/?xl\//, '').replace(/^\.?\//, '')}` : `xl/worksheets/sheet${idx + 1}.xml`;
    if (meta.target && meta.target.startsWith('worksheets/')) {
      sheetPath = `xl/${meta.target}`;
    }
    let sheetXml = files[sheetPath];
    if (!sheetXml) {
      // fallback: محاولة الترقيم التسلسلي
      sheetPath = `xl/worksheets/sheet${idx + 1}.xml`;
      sheetXml = files[sheetPath];
    }
    if (!sheetXml) return;
    sheets[meta.name] = parseSheet(sheetXml.toString('utf8'), sharedStrings);
  });

  return { sheetNames: sheetsMeta.map(s => s.name), sheets };
}

/**
 * يحول أول ورقة عمل إلى مصفوفة كائنات باستخدام أول صف كرؤوس أعمدة
 */
function sheetToObjects(rows) {
  if (!rows || rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map(h => String(h || '').trim());
  const records = rows.slice(1)
    .filter(r => r.some(c => c !== '' && c !== undefined))
    .map((r, idx) => {
      const obj = { _row: idx + 2 };
      headers.forEach((h, colIdx) => {
        obj[h || `عمود_${colIdx + 1}`] = r[colIdx] !== undefined ? r[colIdx] : '';
      });
      return obj;
    });
  return { headers, records };
}

const { mapColumns, toNumber } = require('./csvImporter');

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

/**
 * استيراد ملف حصر كميات كامل من Excel (.xlsx) مع استخراج البنود من أول ورقة تحتوي بيانات
 */
function importBOQFromXlsx(buffer) {
  const { sheetNames, sheets } = parseXlsxBuffer(buffer);
  if (sheetNames.length === 0) {
    return { success: false, error: 'الملف لا يحتوي على أي أوراق عمل' };
  }

  // اختيار أول ورقة تحتوي بيانات فعلية
  let targetSheetName = sheetNames[0];
  for (const name of sheetNames) {
    if (sheets[name] && sheets[name].length > 1) {
      targetSheetName = name;
      break;
    }
  }

  const rows = sheets[targetSheetName] || [];
  const { headers, records } = sheetToObjects(rows);

  if (records.length === 0) {
    return {
      success: false,
      error: 'لم يتم العثور على بيانات في ورقة العمل',
      sheet_names: sheetNames,
    };
  }

  const columnMap = mapColumns(headers);
  if (!columnMap.item) {
    return {
      success: false,
      error: 'تعذر التعرف على عمود اسم العنصر/البند في الملف',
      detected_headers: headers,
      sheet_names: sheetNames,
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
    source: 'xlsx',
    sheet_used: targetSheetName,
    sheet_names: sheetNames,
    detected_columns: columnMap,
    detected_headers: headers,
    item_count: items.length,
    items,
    total_cost: round2(totalCost),
    warnings,
  };
}

module.exports = {
  parseXlsxBuffer,
  sheetToObjects,
  importBOQFromXlsx,
  unzip,
};
