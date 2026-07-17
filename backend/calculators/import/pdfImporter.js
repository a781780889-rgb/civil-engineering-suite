/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * الجزء الثاني: طرق الاستيراد
 * ==========================================
 * استيراد PDF - استخراج نصوص وجداول حقيقي بدون مكتبات خارجية (لا pdf-parse ولا pdfjs)
 *
 * ملف PDF يحتوي كائنات (objects) منها Streams مضغوطة بـ FlateDecode (نفس ضغط zlib).
 * هذا الملف يقوم بـ:
 * 1) إيجاد جميع كائنات المحتوى (Content Streams) داخل الملف
 * 2) فك ضغط FlateDecode باستخدام zlib المدمجة
 * 3) تحليل عمليات رسم النص (Tj, TJ, ', ") في PDF Content Stream Language
 * 4) إعادة بناء النص مع الحفاظ على تقريب لبنية الأسطر بالاعتماد على مواقع Tm/Td
 */

const zlib = require('zlib');

function findStreams(pdfBuffer) {
  const text = pdfBuffer.toString('latin1');
  const streams = [];
  const streamRegex = /(\d+)\s+(\d+)\s+obj\s*(<<[\s\S]*?>>)\s*stream\r?\n([\s\S]*?)endstream/g;
  let match;

  while ((match = streamRegex.exec(text)) !== null) {
    const objNum = match[1];
    const dict = match[3];
    let streamData = match[4];
    streamData = streamData.replace(/\r?\n$/, '');

    const filters = [];
    const filterArrayMatch = dict.match(/\/Filter\s*\[([^\]]*)\]/);
    const filterSingleMatch = dict.match(/\/Filter\s*\/(\w+)/);
    if (filterArrayMatch) {
      const names = filterArrayMatch[1].match(/\/(\w+)/g) || [];
      names.forEach(function (n) { filters.push(n.replace('/', '')); });
    } else if (filterSingleMatch) {
      filters.push(filterSingleMatch[1]);
    }

    streams.push({ objNum: objNum, dict: dict, raw: Buffer.from(streamData, 'latin1'), filters: filters });
  }
  return streams;
}

function decodeASCII85(buffer) {
  let str = buffer.toString('latin1').replace(/[\r\n\t ]/g, '');
  if (str.indexOf('<~') === 0) str = str.slice(2);
  if (str.slice(-2) === '~>') str = str.slice(0, -2);

  const bytes = [];
  let group = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === 'z' && group.length === 0) {
      bytes.push(0, 0, 0, 0);
      continue;
    }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) {
      let value = 0;
      for (let k = 0; k < group.length; k++) value = value * 85 + group[k];
      bytes.push((value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF);
      group = [];
    }
  }
  if (group.length > 0) {
    const padCount = 5 - group.length;
    for (let i = 0; i < padCount; i++) group.push(84);
    let value = 0;
    for (let k = 0; k < group.length; k++) value = value * 85 + group[k];
    const fullBytes = [(value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF];
    for (let k = 0; k < 4 - padCount; k++) bytes.push(fullBytes[k]);
  }
  return Buffer.from(bytes);
}

function decodeASCIIHex(buffer) {
  let str = buffer.toString('latin1').replace(/>/g, '').replace(/\s/g, '');
  if (str.length % 2 !== 0) str += '0';
  return Buffer.from(str, 'hex');
}

function decodeStream(stream) {
  let data = stream.raw;
  if (!stream.filters || stream.filters.length === 0) return data;

  for (let i = 0; i < stream.filters.length; i++) {
    const filter = stream.filters[i];
    try {
      if (filter === 'ASCII85Decode') {
        data = decodeASCII85(data);
      } else if (filter === 'ASCIIHexDecode') {
        data = decodeASCIIHex(data);
      } else if (filter === 'FlateDecode') {
        try {
          data = zlib.inflateSync(data);
        } catch (e) {
          data = zlib.inflateRawSync(data);
        }
      } else {
        return null;
      }
    } catch (e) {
      return null;
    }
  }
  return data;
}

/**
 * يحلل PDF Content Stream ويستخرج نصوص عمليات إظهار النص:
 * (text) Tj
 * [(text1) -120 (text2)] TJ
 * (text) '
 * (text) "
 * كما يتتبع Td/TD/Tm لتقدير الانتقال لسطر جديد بناءً على تغير الإحداثي Y
 */
function extractTextFromContentStream(streamText) {
  const lines = [];
  let currentLine = '';
  let lastY = null;

  // معالجة سلاسل PDF النصية (escape: \(, \), \\, \n, \r, \t, أوكتال \ddd)
  function unescapePdfString(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\') {
        const next = s[i + 1];
        if (next === 'n') { out += '\n'; i++; }
        else if (next === 'r') { out += '\r'; i++; }
        else if (next === 't') { out += '\t'; i++; }
        else if (next === '(' || next === ')' || next === '\\') { out += next; i++; }
        else if (/[0-7]/.test(next)) {
          let oct = '';
          let j = i + 1;
          while (j < s.length && oct.length < 3 && /[0-7]/.test(s[j])) { oct += s[j]; j++; }
          out += String.fromCharCode(parseInt(oct, 8));
          i = j - 1;
        } else { out += next; i++; }
      } else {
        out += s[i];
      }
    }
    return out;
  }

  // مطابقة عمليات Tm/Td/TD لتتبع الإحداثي Y (لتحديد الانتقال بين الأسطر)
  const opRegex = /(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+Td|(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+Tm|\[((?:[^\[\]]|\\.)*)\]\s*TJ|\((?:[^()\\]|\\.)*\)\s*Tj|\((?:[^()\\]|\\.)*\)\s*'|\((?:[^()\\]|\\.)*\)\s*"/g;

  let match;
  while ((match = opRegex.exec(streamText)) !== null) {
    const full = match[0];

    if (/Td$/.test(full) || /TD$/.test(full)) {
      const y = parseFloat(match[2] || match[4]);
      if (lastY !== null && Math.abs(y) > 0.01) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = '';
      }
      lastY = y;
      continue;
    }
    if (/Tm$/.test(full)) {
      continue;
    }
    if (/TJ$/.test(full)) {
      const arrContent = match[8] || '';
      const strRegex = /\(((?:[^()\\]|\\.)*)\)/g;
      let sMatch;
      let lineText = '';
      while ((sMatch = strRegex.exec(arrContent)) !== null) {
        lineText += unescapePdfString(sMatch[1]);
      }
      currentLine += lineText;
      continue;
    }
    if (/Tj$/.test(full) || /'$/.test(full) || /"$/.test(full)) {
      const strMatch = full.match(/\(((?:[^()\\]|\\.)*)\)/);
      if (strMatch) {
        currentLine += unescapePdfString(strMatch[1]);
      }
      if (/'$/.test(full) || /"$/.test(full)) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = '';
      }
    }
  }
  if (currentLine.trim()) lines.push(currentLine.trim());
  return lines;
}

/**
 * الدالة الرئيسية: تأخذ Buffer لملف PDF كامل وتعيد كل النصوص المستخرجة مرتبة حسب الكائنات
 */
function extractPdfText(pdfBuffer) {
  const streams = findStreams(pdfBuffer);
  const allLines = [];
  let decodedCount = 0;

  for (const stream of streams) {
    const decoded = decodeStream(stream);
    if (!decoded) continue;
    const text = decoded.toString('latin1');
    // نتجاهل streams التي لا تحتوي عمليات نص PDF واضحة (صور، خطوط مضمنة...)
    if (!/\bTj\b|\bTJ\b/.test(text)) continue;
    decodedCount++;
    const lines = extractTextFromContentStream(text);
    allLines.push(...lines);
  }

  return {
    lines: allLines,
    full_text: allLines.join('\n'),
    streams_found: streams.length,
    text_streams_decoded: decodedCount,
  };
}

/**
 * يحاول التعرف على جدول كميات (BOQ) داخل نص PDF مستخرج
 * يبحث عن أسطر تحتوي: اسم بند + رقم (كمية) + وحدة + سعر اختياري
 * هذا استدلال نصي عملي (heuristic) لأن PDF لا يحتفظ ببنية جدول صريحة إلا نادراً (Tagged PDF)
 */
const UNIT_KEYWORDS = ['م2', 'م3', 'م.ط', 'متر', 'طن', 'كجم', 'كغم', 'قطعة', 'عدد', 'م²', 'م³', 'sqm', 'cbm', 'kg', 'ton', 'no', 'pcs', 'lm'];

function extractBOQTableFromText(lines) {
  const items = [];
  const numberRegex = /-?\d+[.,]?\d*/g;

  lines.forEach((line, idx) => {
    const numbers = line.match(numberRegex);
    const hasUnit = UNIT_KEYWORDS.some(u => line.includes(u));
    if (numbers && numbers.length >= 1 && (hasUnit || numbers.length >= 2)) {
      const nameOnly = line.replace(numberRegex, '').replace(/[|,]/g, ' ').trim();
      if (nameOnly.length < 2) return;
      const parsedNumbers = numbers.map(n => parseFloat(n.replace(',', '.')));
      items.push({
        row: idx + 1,
        raw_line: line,
        item_guess: nameOnly,
        numbers_found: parsedNumbers,
        unit_detected: UNIT_KEYWORDS.find(u => line.includes(u)) || null,
      });
    }
  });

  return items;
}

module.exports = {
  extractPdfText,
  extractBOQTableFromText,
  findStreams,
  decodeStream,
};
