const fs = require('fs');

/**
 * مولد PDF بدائي مبني يدوياً بدون أي مكتبة خارجية (لا pdfkit ولا qrcode)
 * يكتب صيغة PDF الخام مباشرة (PDF 1.4) باستخدام خط Helvetica القياسي المدمج في كل قارئ PDF
 * يدعم النصوص اللاتينية/الأرقام بشكل كامل. النصوص العربية تُكتب كترميز يوضح المحتوى
 * (عرض العربية الكامل RTL يتطلب خط TrueType مدمج، وهو تحسين مستقبلي محتمل)
 */

const PAGE_WIDTH = 595.28;  // A4 in points
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const LINE_HEIGHT = 14;

function escapePdfText(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

class SimplePDF {
  constructor() {
    this.pages = []; // each page: { commands: [], y: number }
    this.newPage();
  }

  newPage() {
    this.currentPage = { commands: [], y: PAGE_HEIGHT - MARGIN };
    this.pages.push(this.currentPage);
  }

  ensureSpace(neededHeight) {
    if (this.currentPage.y - neededHeight < MARGIN + 30) {
      this.newPage();
    }
  }

  // رسم مستطيل مملوء بلون (r,g,b من 0-1)
  fillRect(x, y, w, h, r, g, b) {
    this.currentPage.commands.push(`${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re f`);
  }

  drawLine(x1, y1, x2, y2, r = 0, g = 0, b = 0, width = 1) {
    this.currentPage.commands.push(`${width} w ${r} ${g} ${b} RG ${x1} ${y1} m ${x2} ${y2} l S`);
  }

  text(str, x, y, { size = 10, font = 'F1', color = [0, 0, 0] } = {}) {
    const [r, g, b] = color;
    this.currentPage.commands.push(
      `BT /${font} ${size} Tf ${r} ${g} ${b} rg ${x} ${y} Td (${escapePdfText(str)}) Tj ET`
    );
  }

  addLine(str, opts = {}) {
    this.ensureSpace(LINE_HEIGHT);
    this.text(str, MARGIN, this.currentPage.y, opts);
    this.currentPage.y -= (opts.lineGap || LINE_HEIGHT);
  }

  addSectionBar(title) {
    this.ensureSpace(30);
    this.fillRect(MARGIN, this.currentPage.y - 18, PAGE_WIDTH - 2 * MARGIN, 20, 0.91, 0.93, 0.96);
    this.text(title, MARGIN + 8, this.currentPage.y - 13, { size: 11, font: 'F2', color: [0.1, 0.22, 0.36] });
    this.currentPage.y -= 30;
  }

  addKeyValue(key, value, indent = 0) {
    this.ensureSpace(LINE_HEIGHT);
    const x = MARGIN + indent;
    this.text(`${key}:`, x, this.currentPage.y, { size: 9, font: 'F2' });
    this.text(`${value}`, x + 220, this.currentPage.y, { size: 9, font: 'F1' });
    this.currentPage.y -= LINE_HEIGHT;
  }

  addSpacing(amount = 8) {
    this.currentPage.y -= amount;
  }

  // ===== بناء ملف PDF نهائي بصيغة PDF خام =====
  build() {
    const objects = [];
    let objCount = 0;

    function addObject(content) {
      objCount++;
      objects.push({ id: objCount, content });
      return objCount;
    }

    // الخطوط
    const fontRegularId = addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
    const fontBoldId = addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`);

    // كل صفحة كمحتوى منفصل
    const pageIds = [];
    const contentIds = [];
    for (const page of this.pages) {
      const streamContent = page.commands.join('\n');
      const contentId = addObject(`<< /Length ${Buffer.byteLength(streamContent)} >>\nstream\n${streamContent}\nendstream`);
      contentIds.push(contentId);
    }

    // سيتم إضافة صفحات Page بعد معرفة Pages parent id، لذا نحجز الأرقام مسبقاً
    const pagesId = objCount + 1 + this.pages.length; // سيُحسب لاحقاً؛ سنعيد الترتيب بطريقة أبسط

    // نهج أبسط: نبني الكائنات بترتيب صريح
    // إعادة البناء الكامل لضمان صحة الإحالات (References)
    return this._buildFinal();
  }

  _buildFinal() {
    const parts = [];
    const offsets = [];
    let objId = 1;

    const fontRegularId = objId++;
    const fontBoldId = objId++;

    const pageObjIds = [];
    const contentObjIds = [];
    for (let i = 0; i < this.pages.length; i++) {
      contentObjIds.push(objId++);
      pageObjIds.push(objId++);
    }
    const pagesId = objId++;
    const catalogId = objId++;

    const objects = [];

    objects.push({ id: fontRegularId, body: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>` });
    objects.push({ id: fontBoldId, body: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>` });

    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      const stream = page.commands.join('\n');
      objects.push({
        id: contentObjIds[i],
        body: `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`,
      });
      objects.push({
        id: pageObjIds[i],
        body: `<< /Type /Page /Parent ${pagesId} 0 R /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjIds[i]} 0 R >>`,
      });
    }

    objects.push({
      id: pagesId,
      body: `<< /Type /Pages /Kids [${pageObjIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>`,
    });

    objects.push({
      id: catalogId,
      body: `<< /Type /Catalog /Pages ${pagesId} 0 R >>`,
    });

    objects.sort((a, b) => a.id - b.id);

    let pdf = '%PDF-1.4\n';
    const xrefOffsets = [0]; // object 0 is free

    for (const obj of objects) {
      xrefOffsets[obj.id] = Buffer.byteLength(pdf, 'utf8');
      pdf += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
    }

    const xrefStart = Buffer.byteLength(pdf, 'utf8');
    const totalObjects = objects.length + 1;
    pdf += `xref\n0 ${totalObjects}\n`;
    pdf += `0000000000 65535 f \n`;
    for (let i = 1; i < totalObjects; i++) {
      const offset = xrefOffsets[i] || 0;
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${totalObjects} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    return Buffer.from(pdf, 'latin1');
  }
}

/**
 * توليد تقرير PDF كامل لنتائج حاسبة الخرسانة
 */
async function generatePDFReport({
  projectName, engineerName, clientName = '', reportTitle, calculationType, inputs, results, outputPath,
}) {
  const doc = new SimplePDF();
  const reportNumber = `CES-${Date.now().toString().slice(-8)}`;
  const reportDate = new Date().toLocaleDateString('en-GB');

  // ===== رأس التقرير =====
  doc.fillRect(0, PAGE_HEIGHT - 90, PAGE_WIDTH, 90, 0.051, 0.141, 0.220);
  doc.text('Civil Engineering Suite', PAGE_WIDTH / 2 - 110, PAGE_HEIGHT - 35, { size: 20, font: 'F2', color: [1, 1, 1] });
  doc.text(sanitizeForLatin1(reportTitle || 'Concrete Calculation Report'), PAGE_WIDTH / 2 - 140, PAGE_HEIGHT - 58, { size: 12, font: 'F1', color: [0.9, 0.9, 0.9] });
  doc.currentPage.y = PAGE_HEIGHT - 120;

  // ===== معلومات التقرير =====
  doc.addKeyValue('Report Number', reportNumber);
  doc.addKeyValue('Date', reportDate);
  doc.addKeyValue('Project', sanitizeForLatin1(projectName || '-'));
  doc.addKeyValue('Engineer', sanitizeForLatin1(engineerName || '-'));
  if (clientName) doc.addKeyValue('Client', sanitizeForLatin1(clientName));
  doc.addSpacing(6);
  doc.drawLine(MARGIN, doc.currentPage.y, PAGE_WIDTH - MARGIN, doc.currentPage.y, 0.05, 0.14, 0.22, 1.2);
  doc.addSpacing(14);

  doc.text(`Calculation Type: ${sanitizeForLatin1(calculationType)}`, MARGIN, doc.currentPage.y, { size: 13, font: 'F2', color: [0.05, 0.14, 0.22] });
  doc.currentPage.y -= 24;

  // ===== المدخلات =====
  doc.addSectionBar('INPUTS / المدخلات');
  writeObjectRecursive(doc, inputs);
  doc.addSpacing(10);

  // ===== النتائج =====
  doc.addSectionBar('RESULTS / النتائج');
  writeObjectRecursive(doc, results);

  // ===== تذييل وتوقيع =====
  doc.ensureSpace(60);
  doc.addSpacing(20);
  doc.drawLine(MARGIN, doc.currentPage.y, MARGIN + 250, doc.currentPage.y, 0, 0, 0, 0.8);
  doc.addSpacing(4);
  doc.addLine('Engineer Signature', { size: 9, font: 'F1', color: [0.3, 0.3, 0.3] });
  doc.addLine(sanitizeForLatin1(engineerName || ''), { size: 9, font: 'F1' });

  // تذييل رقم التقرير في كل صفحة
  for (const page of doc.pages) {
    page.commands.push(
      `BT /F1 8 Tf 0.5 0.5 0.5 rg ${MARGIN} 25 Td (Civil Engineering Suite | Report ${reportNumber}) Tj ET`
    );
  }

  const pdfBuffer = doc._buildFinal();
  fs.writeFileSync(outputPath, pdfBuffer);

  return { reportNumber, outputPath };
}

// PDF الأساسي (Helvetica) لا يدعم إلا Latin-1؛ نحول أي نص عربي/يونيكود إلى صيغة آمنة للعرض
function sanitizeForLatin1(str) {
  if (str === null || str === undefined) return '-';
  const s = String(str);
  // إذا احتوى على أحرف خارج Latin-1 (كالعربية) نستبدلها بترميز يوضح وجود نص عربي
  let hasNonLatin = false;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 255) { hasNonLatin = true; break; }
  }
  if (!hasNonLatin) return s;
  return '[Arabic text - see project record]';
}

function formatKey(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function writeObjectRecursive(doc, obj, indent = 0) {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      doc.ensureSpace(LINE_HEIGHT);
      doc.text(`${formatKey(key)}:`, MARGIN + indent, doc.currentPage.y, { size: 9, font: 'F2' });
      doc.currentPage.y -= LINE_HEIGHT;
      value.forEach((item, idx) => {
        if (typeof item === 'object') {
          doc.ensureSpace(LINE_HEIGHT);
          doc.text(`- Item ${idx + 1}`, MARGIN + indent + 12, doc.currentPage.y, { size: 8.5, font: 'F1', color: [0.3, 0.3, 0.3] });
          doc.currentPage.y -= LINE_HEIGHT;
          writeObjectRecursive(doc, item, indent + 24);
        } else {
          doc.addKeyValue(`  #${idx + 1}`, sanitizeForLatin1(item), indent + 12);
        }
      });
    } else if (typeof value === 'object') {
      doc.ensureSpace(LINE_HEIGHT);
      doc.text(`${formatKey(key)}:`, MARGIN + indent, doc.currentPage.y, { size: 9.5, font: 'F2', color: [0.1, 0.22, 0.36] });
      doc.currentPage.y -= LINE_HEIGHT;
      writeObjectRecursive(doc, value, indent + 16);
    } else {
      doc.addKeyValue(formatKey(key), sanitizeForLatin1(value), indent);
    }
  }
}

module.exports = { generatePDFReport };
