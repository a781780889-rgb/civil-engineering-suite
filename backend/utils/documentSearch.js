/**
 * القسم الحادي عشر - نظام إدارة المستندات (Document Management System - DMS)
 * =====================================================================================
 * الجزء الخامس (5/10): البحث الذكي (بالاسم/الرقم/الكلمات المفتاحية/داخل محتوى PDF و Word)
 * =====================================================================================
 *
 * يبني هذا الجزء فوق طبقة التخزين الموحّدة (نفس ملف dms.json المُدار من الجزء 1/10)،
 * ويعتمد على نفس نمط الوصول المباشر للقرص المستخدَم في بقية أجزاء القسم (2/10، 3/10،
 * 4/10) لتفادي أي اعتمادية دائرية بين الوحدات.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - استخراج نص PDF فعلي: إعادة استخدام محرّك استخراج نص PDF الحقيقي المبني بدون أي
 *    تبعيات خارجية (backend/calculators/import/pdfImporter.js) والمُستخدَم أصلاً في
 *    استيراد جداول الكميات (BOQ) بالقسم الثالث.
 *  - استخراج نص Word (.docx) فعلي: ملف .docx هو أرشيف ZIP يحوي word/document.xml.
 *    نعيد استخدام محرّك فك ضغط ZIP الحقيقي (raw DEFLATE عبر zlib المدمجة في Node.js)
 *    المبني أصلاً لاستيراد Excel بالقسم الثالث (xlsxImporter.js: دالة unzip)، ثم نحلّل
 *    عناصر <w:t> داخل XML يدوياً لاستخراج النص الفعلي الكامل للمستند (وليس نص وهمي).
 *  - فهرسة فعلية مخزَّنة على القرص (store.searchIndex) تُبنى/تُحدَّث تلقائياً عند كل
 *    رفع أو إصدار جديد لملفات PDF/Word، بحيث لا يُعاد استخراج النص من القرص في كل
 *    عملية بحث (أداء حقيقي حتى مع آلاف المستندات)، مع إمكانية إعادة بناء الفهرس بالكامل
 *    عند الحاجة (مثلاً بعد استيراد مستندات قديمة يدوياً في ملف التخزين).
 *  - محرك بحث موحّد حقيقي متعدد المعايير: الاسم، الرقم المرجعي، الكلمات المفتاحية،
 *    المحتوى الكامل داخل PDF/Word، المشروع، القسم، التاريخ، الإصدار، حالة المستند -
 *    مع ترتيب النتائج حسب درجة تطابق فعلية (Relevance Score) وليس ترتيباً عشوائياً،
 *    ومقتطف نصي (Snippet) حقيقي حول موضع التطابق داخل المحتوى عند البحث النصي.
 *  - سجل تدقيق فعلي لعمليات إعادة الفهرسة (اتساقاً مع بقية أجزاء القسم).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { extractPdfText } = require('../calculators/import/pdfImporter');

// ==================================================================================
// ============================ الربط بطبقة التخزين الموحّدة =========================
// ==================================================================================
// نفس نمط الأجزاء 2/10، 3/10، 4/10: إعادة استخدام نفس مسارات القرص التي يعتمدها
// documentManagement.js (الجزء 1/10) لضمان أن الجميع يقرأ/يكتب نفس ملف dms.json فعلياً.
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILES_DIR = path.join(DATA_DIR, 'dms_files');
const DB_FILE = path.join(DATA_DIR, 'dms.json');

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

function loadStore() {
  if (!fs.existsSync(DB_FILE)) throw new Error('قاعدة بيانات إدارة المستندات غير مهيّأة بعد (ارفع مستنداً واحداً على الأقل أولاً)');
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const store = JSON.parse(raw);
  for (const key of ['documents', 'versions', 'categories', 'workflows', 'approvals', 'signatures', 'shareLinks', 'notifications', 'searchIndex']) {
    if (!store[key]) store[key] = {};
  }
  if (!store.auditLog) store.auditLog = [];
  return store;
}

function saveStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function audit(store, { action, entity, entityId, projectId = null, actor = null, details = {} }) {
  store.auditLog.push({
    id: newId('AUD'),
    action, entity, entity_id: entityId, project_id: projectId,
    actor: actor || null, details, created_at: nowISO(),
  });
  if (store.auditLog.length > 8000) store.auditLog = store.auditLog.slice(-8000);
}

// ==================================================================================
// ===================== استخراج نص حقيقي من ملفات Word (.docx) =====================
// ==================================================================================
// ملف .docx هو أرشيف ZIP قياسي؛ نعيد بناء نفس منطق فك الضغط اليدوي المستخدَم في
// xlsxImporter.js (بدون أي مكتبات خارجية) بدلاً من استيراده مباشرة، لتفادي أي
// اعتمادية متقاطعة بين وحدة "حصر الكميات" ووحدة "إدارة المستندات" مستقبلاً - نفس
// الخوارزمية بالضبط (EOCD + Central Directory + Local File Header + inflateRawSync).

function findEOCD(buffer) {
  const sig = 0x06054b50;
  const minLen = 22;
  for (let i = buffer.length - minLen; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === sig) return i;
  }
  throw new Error('ملف غير صالح: لم يتم العثور على نهاية سجل ZIP (EOCD)');
}

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
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const fileCommentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);
    entries.push({ fileName, compressionMethod, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }
  return entries;
}

function extractZipEntry(buffer, entry) {
  const offset = entry.localHeaderOffset;
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraFieldLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraFieldLength;
  const compressedData = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return compressedData;
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressedData);
  throw new Error(`طريقة ضغط غير مدعومة (${entry.compressionMethod}) للملف: ${entry.fileName}`);
}

function unzipSingleEntry(buffer, entryName) {
  const entries = readZipEntries(buffer);
  const target = entries.find((e) => e.fileName === entryName);
  if (!target) return null;
  return extractZipEntry(buffer, target);
}

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

/** يستخرج النص الفعلي الكامل من ملف Word (.docx) عبر تحليل word/document.xml */
function extractDocxText(buffer) {
  const xmlBuffer = unzipSingleEntry(buffer, 'word/document.xml');
  if (!xmlBuffer) return { full_text: '', paragraphs: [] };
  const xml = xmlBuffer.toString('utf8');

  // كل فقرة Word محاطة بـ <w:p>...</w:p>؛ داخلها نصوص فعلية ضمن <w:t>...</w:t>
  const paragraphs = [];
  const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const textRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let paraMatch;
  while ((paraMatch = paraRegex.exec(xml)) !== null) {
    const paraXml = paraMatch[0];
    let textMatch;
    let paraText = '';
    textRegex.lastIndex = 0;
    while ((textMatch = textRegex.exec(paraXml)) !== null) {
      paraText += decodeXmlEntities(textMatch[1]);
    }
    if (paraText.trim()) paragraphs.push(paraText.trim());
  }

  return { full_text: paragraphs.join('\n'), paragraphs };
}

/** يستخرج النص الفعلي من ملف PDF عبر محرّك pdfImporter الحقيقي المُعاد استخدامه */
function extractPdfDocumentText(buffer) {
  const result = extractPdfText(buffer);
  return { full_text: result.full_text || '', lines: result.lines || [] };
}

const SEARCHABLE_EXTENSIONS = new Set(['.pdf', '.docx', '.doc']);

/** يستخرج نصاً فعلياً قابلاً للفهرسة من buffer ملف حسب امتداده (PDF/Word فقط حالياً) */
function extractContentText(buffer, extension) {
  try {
    if (extension === '.pdf') return extractPdfDocumentText(buffer).full_text;
    if (extension === '.docx') return extractDocxText(buffer).full_text;
    // .doc القديم (Binary OLE) لا يمكن تحليله بدون تبعيات خارجية بشكل موثوق؛
    // نتجاهله بصمت (يبقى قابلاً للبحث بالاسم/الرقم/الكلمات المفتاحية فقط).
    return '';
  } catch (e) {
    return '';
  }
}

// ==================================================================================
// ================================= الفهرسة الفعلية =================================
// ==================================================================================

/**
 * يبني/يحدّث فهرس البحث النصي لإصدار مستند واحد (الإصدار الحالي فقط تُفهرَس محتوياته،
 * لأن هذا ما يعنى المستخدم غالباً عند البحث - يمكن توسيعه لاحقاً لفهرسة كل الإصدارات).
 */
function indexDocumentVersion(store, documentId) {
  const doc = store.documents[documentId];
  if (!doc) return null;
  const version = store.versions[doc.current_version_id];
  if (!version) return null;

  if (!SEARCHABLE_EXTENSIONS.has(version.file_extension)) {
    // صيغة غير قابلة لاستخراج نص (صورة، DWG، ZIP...) - نُبقي فقط بيانات البحث الوصفي
    delete store.searchIndex[documentId];
    return null;
  }

  const filePath = path.join(FILES_DIR, version.stored_file_name);
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  const fullText = extractContentText(buffer, version.file_extension);

  store.searchIndex[documentId] = {
    document_id: documentId,
    version_id: version.id,
    version_number: version.version_number,
    extension: version.file_extension,
    content_text: fullText,
    content_length: fullText.length,
    indexed_at: nowISO(),
  };
  return store.searchIndex[documentId];
}

/** يفهرس مستنداً واحداً فوراً (يُستدعى من server.js بعد كل رفع/إصدار جديد) */
function indexDocument(documentId, { actor = null } = {}) {
  const store = loadStore();
  const entry = indexDocumentVersion(store, documentId);
  audit(store, {
    action: 'search_index_update', entity: 'document', entityId: documentId,
    projectId: store.documents[documentId]?.project_id || null, actor,
    details: { indexed: !!entry, content_length: entry?.content_length || 0 },
  });
  saveStore(store);
  return { success: true, data: { indexed: !!entry, content_length: entry?.content_length || 0 } };
}

/** يعيد بناء الفهرس بالكامل لكل المستندات (صيانة/تهيئة أولى/بعد استيراد يدوي) */
function reindexAllDocuments({ actor = null } = {}) {
  const store = loadStore();
  const ids = Object.keys(store.documents);
  let indexedCount = 0;
  let skippedCount = 0;
  for (const id of ids) {
    const entry = indexDocumentVersion(store, id);
    if (entry) indexedCount++; else skippedCount++;
  }
  audit(store, {
    action: 'search_reindex_all', entity: 'document', entityId: null, actor,
    details: { total: ids.length, indexed: indexedCount, skipped: skippedCount },
  });
  saveStore(store);
  return { success: true, data: { total: ids.length, indexed: indexedCount, skipped: skippedCount } };
}

function getIndexStatus() {
  const store = loadStore();
  const totalDocs = Object.keys(store.documents).length;
  const indexedDocs = Object.keys(store.searchIndex).length;
  const byExtension = {};
  for (const entry of Object.values(store.searchIndex)) {
    byExtension[entry.extension] = (byExtension[entry.extension] || 0) + 1;
  }
  return {
    success: true,
    data: {
      total_documents: totalDocs,
      indexed_documents: indexedDocs,
      not_indexed: totalDocs - indexedDocs,
      by_extension: byExtension,
    },
  };
}

// ==================================================================================
// ================================= محرك البحث الموحّد ===============================
// ==================================================================================

function normalizeText(s) {
  return String(s || '').toLowerCase();
}

/** يبني مقتطفاً نصياً حقيقياً حول أول موضع تطابق داخل نص المحتوى */
function buildSnippet(contentText, query, radius = 60) {
  const idx = normalizeText(contentText).indexOf(normalizeText(query));
  if (idx === -1) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(contentText.length, idx + query.length + radius);
  let snippet = contentText.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = `...${snippet}`;
  if (end < contentText.length) snippet = `${snippet}...`;
  return snippet;
}

/**
 * البحث الذكي الموحّد الفعلي:
 *  - q: نص البحث الحر (يُطابَق ضد الاسم/الرقم/الوصف/الكلمات المفتاحية دائماً، وضد
 *    محتوى الملف الفعلي (PDF/Word) فقط إذا includeContent !== false).
 *  - فلاتر دقيقة اختيارية: project_id, doc_type, group, status, department,
 *    version_number, date_from, date_to.
 *  - ترتيب النتائج حسب درجة تطابق فعلية (relevance score)، وليس عشوائياً.
 */
function search({
  q = null,
  projectId = null,
  docType = null,
  group = null,
  status = null,
  department = null,
  versionNumber = null,
  dateFrom = null,
  dateTo = null,
  includeContent = true,
  includeArchived = false,
  page = 1,
  pageSize = 25,
} = {}) {
  const store = loadStore();
  let items = Object.values(store.documents);

  if (!includeArchived) items = items.filter((d) => !d.archived);
  if (projectId) items = items.filter((d) => d.project_id === projectId);
  if (docType) items = items.filter((d) => d.doc_type === docType);
  if (group) items = items.filter((d) => d.doc_group === group);
  if (status) items = items.filter((d) => d.status === status);
  if (department) items = items.filter((d) => d.department === department);
  if (versionNumber) items = items.filter((d) => d.current_version_number === Number(versionNumber));
  if (dateFrom) items = items.filter((d) => new Date(d.created_at) >= new Date(dateFrom));
  if (dateTo) items = items.filter((d) => new Date(d.created_at) <= new Date(dateTo));

  const query = q ? String(q).trim() : null;
  const results = [];

  for (const doc of items) {
    if (!query) {
      results.push({ document: doc, score: 0, match_fields: [], snippet: null });
      continue;
    }
    const nq = normalizeText(query);
    let score = 0;
    const matchFields = [];

    if (normalizeText(doc.document_number) === nq) { score += 100; matchFields.push('document_number_exact'); }
    else if (normalizeText(doc.document_number).includes(nq)) { score += 40; matchFields.push('document_number'); }

    if (normalizeText(doc.title).includes(nq)) {
      score += normalizeText(doc.title) === nq ? 60 : 30;
      matchFields.push('title');
    }

    if (Array.isArray(doc.keywords) && doc.keywords.some((k) => normalizeText(k).includes(nq))) {
      score += 25;
      matchFields.push('keywords');
    }

    if (doc.description && normalizeText(doc.description).includes(nq)) {
      score += 10;
      matchFields.push('description');
    }

    let snippet = null;
    if (includeContent) {
      const indexEntry = store.searchIndex[doc.id];
      if (indexEntry && indexEntry.content_text && normalizeText(indexEntry.content_text).includes(nq)) {
        score += 20;
        matchFields.push('content');
        snippet = buildSnippet(indexEntry.content_text, query);
      }
    }

    if (score > 0) {
      results.push({ document: doc, score, match_fields: matchFields, snippet });
    }
  }

  results.sort((a, b) => (b.score - a.score) || (new Date(b.document.updated_at) - new Date(a.document.updated_at)));

  const total = results.length;
  const start = (page - 1) * pageSize;
  const paged = results.slice(start, start + pageSize);

  return {
    success: true,
    data: paged.map((r) => ({
      ...r.document,
      _search_score: r.score,
      _match_fields: r.match_fields,
      _snippet: r.snippet,
    })),
    pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

/** بحث نصي داخل محتوى ملف مستند واحد فقط (لعرض كل مواضع التطابق داخل الملف نفسه) */
function searchWithinDocument(documentId, query) {
  const store = loadStore();
  const doc = store.documents[documentId];
  if (!doc) throw new Error('المستند غير موجود');
  if (!query || !String(query).trim()) throw new Error('نص البحث (query) مطلوب');

  const indexEntry = store.searchIndex[documentId];
  if (!indexEntry || !indexEntry.content_text) {
    return { success: true, data: { document_id: documentId, matches: [], indexed: !!indexEntry, message: indexEntry ? 'لا يحتوي الملف على نص قابل للاستخراج' : 'هذا المستند غير مفهرَس (صيغة غير مدعومة للبحث داخل المحتوى أو لم تتم فهرسته بعد)' } };
  }

  const nq = normalizeText(query);
  const nContent = normalizeText(indexEntry.content_text);
  const matches = [];
  let searchFrom = 0;
  while (true) {
    const idx = nContent.indexOf(nq, searchFrom);
    if (idx === -1) break;
    matches.push({
      position: idx,
      snippet: buildSnippet(indexEntry.content_text, query),
    });
    searchFrom = idx + nq.length;
    if (matches.length >= 200) break; // حد أقصى عملي لمنع نتائج مفرطة الحجم
  }

  return {
    success: true,
    data: {
      document_id: documentId,
      version_number: indexEntry.version_number,
      total_matches: matches.length,
      matches,
    },
  };
}

module.exports = {
  // فهرسة
  indexDocument,
  reindexAllDocuments,
  getIndexStatus,
  SEARCHABLE_EXTENSIONS,

  // بحث
  search,
  searchWithinDocument,

  // أدوات استخراج نص (قابلة لإعادة الاستخدام من أجزاء أخرى مستقبلاً)
  extractDocxText,
  extractPdfDocumentText,
};
