/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * مولّد تقارير PDF بجداول حقيقية (BOQ Table Reports)
 * ====================================================
 * يبني على نفس أسلوب nativePdfGenerator.js (كتابة PDF 1.4 خام بدون تبعيات)
 * لكن يضيف طبقة رسم جداول (أعمدة/صفوف/عناوين/تلوين متبادل) لازمة لتقارير حصر الكميات،
 * جدول الأسعار BOQ ، وتقارير المقارنة.
 */

const fs = require('fs');

const PAGE_WIDTH = 841.89;   // A4 landscape (points) - أفضل لجداول BOQ متعددة الأعمدة
const PAGE_HEIGHT = 595.28;
const MARGIN = 36;
const ROW_HEIGHT = 18;
const HEADER_HEIGHT = 22;

function escapePdfText(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// PDF الأساسي (Helvetica) لا يدعم إلا Latin-1؛ أي نص عربي/يونيكود يُستبدل بترميز يوضح المحتوى
function sanitizeForLatin1(str) {
  if (str === null || str === undefined) return '-';
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 255) return '[Arabic text]';
  }
  return s;
}

class TablePDF {
  constructor() {
    this.pages = [];
    this.newPage();
  }

  newPage() {
    this.currentPage = { commands: [], y: PAGE_HEIGHT - MARGIN };
    this.pages.push(this.currentPage);
  }

  ensureSpace(neededHeight) {
    if (this.currentPage.y - neededHeight < MARGIN + 20) {
      this.newPage();
      return true;
    }
    return false;
  }

  fillRect(x, y, w, h, r, g, b) {
    this.currentPage.commands.push(`${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re f`);
  }

  strokeRect(x, y, w, h, r = 0.7, g = 0.7, b = 0.7, width = 0.5) {
    this.currentPage.commands.push(`${width} w ${r} ${g} ${b} RG ${x} ${y} ${w} ${h} re S`);
  }

  drawLine(x1, y1, x2, y2, r = 0, g = 0, b = 0, width = 1) {
    this.currentPage.commands.push(`${width} w ${r} ${g} ${b} RG ${x1} ${y1} m ${x2} ${y2} l S`);
  }

  text(str, x, y, { size = 9, font = 'F1', color = [0, 0, 0] } = {}) {
    const [r, g, b] = color;
    this.currentPage.commands.push(
      `BT /${font} ${size} Tf ${r} ${g} ${b} rg ${x} ${y} Td (${escapePdfText(str)}) Tj ET`
    );
  }

  addLine(str, opts = {}) {
    this.ensureSpace(ROW_HEIGHT);
    this.text(str, MARGIN, this.currentPage.y, opts);
    this.currentPage.y -= (opts.lineGap || ROW_HEIGHT);
  }

  addTitle(title, subtitle) {
    this.fillRect(0, PAGE_HEIGHT - 70, PAGE_WIDTH, 70, 0.051, 0.141, 0.220);
    this.text(sanitizeForLatin1(title), MARGIN, PAGE_HEIGHT - 30, { size: 18, font: 'F2', color: [1, 1, 1] });
    if (subtitle) this.text(sanitizeForLatin1(subtitle), MARGIN, PAGE_HEIGHT - 50, { size: 10, font: 'F1', color: [0.85, 0.85, 0.85] });
    this.currentPage.y = PAGE_HEIGHT - 95;
  }

  addKeyValueRow(pairs) {
    // pairs: [[key, value], [key, value], ...] printed on one line
    this.ensureSpace(ROW_HEIGHT);
    let x = MARGIN;
    for (const [k, v] of pairs) {
      this.text(`${sanitizeForLatin1(k)}: ${sanitizeForLatin1(v)}`, x, this.currentPage.y, { size: 9, font: 'F1', color: [0.25, 0.25, 0.25] });
      x += 190;
    }
    this.currentPage.y -= ROW_HEIGHT;
  }

  /**
   * رسم جدول كامل مع عناوين أعمدة وصفوف بيانات، مع تكرار العناوين عند تجاوز الصفحة
   * @param {string[]} headers
   * @param {Array<Array<string|number>>} rows
   * @param {number[]} [colWidths] - عرض كل عمود (points)؛ إن لم يُحدد يُوزَّع بالتساوي
   */
  addTable(headers, rows, colWidths) {
    const usableWidth = PAGE_WIDTH - 2 * MARGIN;
    const widths = colWidths && colWidths.length === headers.length
      ? colWidths
      : headers.map(() => usableWidth / headers.length);

    const drawHeader = () => {
      this.ensureSpace(HEADER_HEIGHT);
      let x = MARGIN;
      this.fillRect(MARGIN, this.currentPage.y - HEADER_HEIGHT + 4, usableWidth, HEADER_HEIGHT, 0.051, 0.141, 0.220);
      headers.forEach((h, i) => {
        this.text(sanitizeForLatin1(h), x + 4, this.currentPage.y - 12, { size: 8.5, font: 'F2', color: [1, 1, 1] });
        x += widths[i];
      });
      this.currentPage.y -= HEADER_HEIGHT;
    };

    drawHeader();

    rows.forEach((row, rowIdx) => {
      if (this.ensureSpace(ROW_HEIGHT)) drawHeader();
      let x = MARGIN;
      if (rowIdx % 2 === 0) {
        this.fillRect(MARGIN, this.currentPage.y - ROW_HEIGHT + 4, usableWidth, ROW_HEIGHT, 0.96, 0.97, 0.98);
      }
      row.forEach((cell, i) => {
        const text = typeof cell === 'number' ? String(cell) : sanitizeForLatin1(cell);
        this.text(text.length > 40 ? text.slice(0, 37) + '...' : text, x + 4, this.currentPage.y - 12, { size: 8, font: 'F1', color: [0.15, 0.15, 0.15] });
        x += widths[i];
      });
      this.strokeRect(MARGIN, this.currentPage.y - ROW_HEIGHT + 4, usableWidth, ROW_HEIGHT);
      this.currentPage.y -= ROW_HEIGHT;
    });
  }

  addSpacing(px) { this.currentPage.y -= px; }

  addSectionBar(title) {
    this.ensureSpace(24);
    this.fillRect(MARGIN, this.currentPage.y - 16, PAGE_WIDTH - 2 * MARGIN, 18, 0.91, 0.93, 0.96);
    this.text(sanitizeForLatin1(title), MARGIN + 6, this.currentPage.y - 11, { size: 10, font: 'F2', color: [0.05, 0.14, 0.22] });
    this.currentPage.y -= 26;
  }

  _buildFinal() {
    const objects = [];
    const addObj = (str) => { objects.push(str); return objects.length; };

    const fontRegularId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const fontBoldId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

    const pageIds = [];
    const contentIds = [];
    for (const page of this.pages) {
      const stream = page.commands.join('\n');
      const contentId = addObj(`<< /Length ${Buffer.byteLength(stream, 'utf-8')} >>\nstream\n${stream}\nendstream`);
      contentIds.push(contentId);
    }

    const pagesObjPlaceholderIndex = objects.length + 1;
    for (let i = 0; i < this.pages.length; i++) {
      const pageId = addObj(
        `<< /Type /Page /Parent ${pagesObjPlaceholderIndex} /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> ` +
        `/Contents ${contentIds[i]} 0 R >>`
      );
      pageIds.push(pageId);
    }

    const pagesObjId = addObj(
      `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
    );
    // إعادة كتابة مرجع /Parent بالقيمة الصحيحة لأننا احتجنا معرفها مسبقاً
    for (let i = 0; i < pageIds.length; i++) {
      const idx = pageIds[i] - 1;
      objects[idx] = objects[idx].replace(`/Parent ${pagesObjPlaceholderIndex}`, `/Parent ${pagesObjId} 0 R`);
    }

    const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesObjId} 0 R >>`);

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((obj, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    });

    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    return Buffer.from(pdf, 'binary');
  }
}

/**
 * توليد تقرير PDF لجدول حصر كميات (BOQ)
 * @param {Object} p
 * @param {string} p.title
 * @param {Object} p.meta - { projectName, engineerName, clientName, reportDate }
 * @param {string[]} p.headers
 * @param {Array<Array<string|number>>} p.rows
 * @param {Object} [p.totals] - { label, value } لصف الإجمالي
 * @param {string} p.outputPath
 */
function generateBoqTablePDF({ title, meta = {}, headers, rows, totals = null, outputPath, colWidths = null }) {
  const doc = new TablePDF();
  const reportNumber = `BOQ-${Date.now().toString().slice(-8)}`;

  doc.addTitle(title, `Report ${reportNumber} | ${new Date().toLocaleDateString('en-GB')}`);
  doc.addKeyValueRow([
    ['Project', meta.projectName || '-'],
    ['Engineer', meta.engineerName || '-'],
    ['Client', meta.clientName || '-'],
  ]);
  doc.addSpacing(6);
  doc.drawLine(MARGIN, doc.currentPage.y, PAGE_WIDTH - MARGIN, doc.currentPage.y, 0.05, 0.14, 0.22, 1);
  doc.addSpacing(14);

  doc.addTable(headers, rows, colWidths);

  if (totals) {
    doc.addSpacing(10);
    doc.addSectionBar(`${totals.label}: ${totals.value}`);
  }

  for (const page of doc.pages) {
    page.commands.push(
      `BT /F1 7 Tf 0.5 0.5 0.5 rg ${MARGIN} 20 Td (Civil Engineering Suite | BOQ Report ${reportNumber}) Tj ET`
    );
  }

  const buffer = doc._buildFinal();
  fs.writeFileSync(outputPath, buffer);
  return { reportNumber, outputPath };
}

module.exports = { generateBoqTablePDF, TablePDF };
