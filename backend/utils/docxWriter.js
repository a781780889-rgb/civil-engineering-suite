/**
 * مولّد ملفات Word (.docx) حقيقي بدون أي مكتبة خارجية
 * ======================================================
 * يبني حزمة OOXML صحيحة (نفس بنية .docx الحقيقية: [Content_Types].xml + _rels +
 * word/document.xml) ثم يضغطها بصيغة ZIP عبر buildZip المستخدمة أصلاً في xlsxWriter.js
 * (نفس النهج المتّبع في بقية المشروع: لا تبعيات خارجية، فقط zlib المدمجة في Node.js).
 * يدعم: فقرات نصية (عادي/عريض/عنوان)، جداول بسيطة، دعم RTL للعربية.
 */

const { buildZip } = require('./xlsxWriter');

function xmlEscape(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// يفحص إن كان النص يحتوي أحرفاً عربية لضبط اتجاه الفقرة (RTL) تلقائياً
function isRTL(str) {
  return /[\u0600-\u06FF]/.test(String(str ?? ''));
}

function paragraphXml(text, { bold = false, size = 22, heading = false, align = null } = {}) {
  const rtl = isRTL(text);
  const rPr = `${bold || heading ? '<w:b/>' : ''}<w:sz w:val="${heading ? 32 : size}"/>${rtl ? '<w:rtl/>' : ''}`;
  const jc = align || (rtl ? 'right' : 'left');
  const pPr = `<w:pPr><w:jc w:val="${jc}"/>${rtl ? '<w:bidi/>' : ''}${heading ? '<w:spacing w:before="200" w:after="120"/>' : ''}</w:pPr>`;
  return `<w:p>${pPr}<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function tableXml(headers, rows) {
  const rtl = headers.some(isRTL) || rows.some(r => r.some(isRTL));
  const colCount = headers.length;
  const colWidth = Math.floor(9000 / colCount);

  const gridCols = Array(colCount).fill(`<w:gridCol w:w="${colWidth}"/>`).join('');

  function cellXml(text, isHeader) {
    const t = text === null || text === undefined ? '-' : String(text);
    const rPr = isHeader ? '<w:b/>' : '';
    const jc = isRTL(t) ? 'right' : (typeof text === 'number' ? 'center' : 'left');
    return `<w:tc><w:tcPr><w:tcW w:w="${colWidth}" w:type="dxa"/>${isHeader ? '<w:shd w:val="clear" w:fill="0D2438"/>' : ''}</w:tcPr>` +
      `<w:p><w:pPr><w:jc w:val="${jc}"/>${rtl ? '<w:bidi/>' : ''}</w:pPr><w:r><w:rPr>${rPr}${isHeader ? '<w:color w:val="FFFFFF"/>' : ''}<w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${xmlEscape(t)}</w:t></w:r></w:p></w:tc>`;
  }

  const headerRow = `<w:tr>${headers.map(h => cellXml(h, true)).join('')}</w:tr>`;
  const bodyRows = rows.map(row => `<w:tr>${row.map(v => cellXml(v, false)).join('')}</w:tr>`).join('');

  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9000" w:type="dxa"/>${rtl ? '<w:bidiVisual/>' : ''}<w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/>` +
    `<w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/>` +
    `<w:insideH w:val="single" w:sz="4" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:color="999999"/></w:tblBorders></w:tblPr>` +
    `<w:tblGrid>${gridCols}</w:tblGrid>${headerRow}${bodyRows}</w:tbl>`;
}

/**
 * ينشئ مستند Word من عناصر مُرتَّبة (فقرات وجداول)
 * @param {Array<{type:'heading'|'text'|'table', text?:string, bold?:boolean, headers?:string[], rows?:Array}>} elements
 * @returns {Buffer}
 */
function generateDocx(elements = []) {
  const bodyParts = elements.map(el => {
    if (el.type === 'heading') return paragraphXml(el.text, { heading: true });
    if (el.type === 'table') return tableXml(el.headers, el.rows) + '<w:p/>';
    return paragraphXml(el.text, { bold: !!el.bold });
  }).join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${bodyParts}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr>
</w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  const files = [
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'word/document.xml', content: documentXml },
    { name: 'word/_rels/document.xml.rels', content: docRelsXml },
  ];

  return buildZip(files);
}

module.exports = { generateDocx };
