/**
 * القسم التاسع - نظام إدارة الجودة (QMS)
 * الجزء الرابع (4/4) - الوحدة الأولى: التنبيهات الذكية (Smart Alerts)
 * =====================================================================================
 * تنفيذ حقيقي: يقرأ الوحدة مباشرة من مخزن بيانات QMS (qms.json) وملف الوثائق/KPIs
 * (qms_docs.json عبر qmsDocsKpis.js) ويحسب تنبيهات فعلية بناءً على تواريخ وحالات حقيقية،
 * وليس نصوصاً ثابتة. كل تنبيه له: type (نوع)، severity (خطورة)، message (رسالة عربية)،
 * entity/entityId/projectId (مرجع الكيان المسبِّب)، due/overdue (تفاصيل زمنية عند الحاجة).
 *
 * أنواع التنبيهات المطلوبة في القسم التاسع (البند 17):
 *  - رفض طلب فحص (IR نتيجته rejected)
 *  - تسجيل NCR جديد (خلال آخر 24 ساعة)
 *  - انتهاء موعد إجراء تصحيحي (CAPA متأخر عن due_date وما زال مفتوحاً)
 *  - انتهاء صلاحية شهادة (وثيقة QMS منتهية الصلاحية expiry_date)
 *  - اقتراب موعد معايرة جهاز (lab equipment next_calibration_date خلال نافذة أيام)
 *  - تأخر اعتماد مادة (MAR عالق في مراجعة لفترة تتجاوز الحد المسموح)
 *  - تأخر اعتماد رسم (SDR عالق في مراجعة لفترة تتجاوز الحد المسموح)
 *  - انخفاض مؤشرات الجودة (نسبة الالتزام العامة أو معدل نجاح الفحوصات دون حد أدنى)
 */

const QMS = require('./qmsManagement');
const QMSX = require('./qmsDocsKpis');

const MS_DAY = 24 * 60 * 60 * 1000;

function unwrap(result) {
  if (result && typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

function daysBetween(a, b) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / MS_DAY);
}

// ===================== إعدادات العتبات (قابلة للتعديل مركزياً) =====================

const THRESHOLDS = {
  ncrRecentHours: 24,           // NCR "جديدة" خلال آخر 24 ساعة
  calibrationDueWithinDays: 14, // تنبيه اقتراب المعايرة قبل 14 يوماً
  documentExpiryWithinDays: 30, // تنبيه اقتراب انتهاء الوثيقة قبل 30 يوماً
  marReviewDelayDays: 7,        // تأخر مراجعة MAR بعد 7 أيام في حالة مراجعة
  sdrReviewDelayDays: 7,        // تأخر مراجعة SDR بعد 7 أيام في حالة مراجعة
  qualityComplianceMin: 70,     // حد أدنى لنسبة الالتزام بالجودة (%)
  testPassRateMin: 80,          // حد أدنى لمعدل نجاح الاختبارات (%)
};

function pushAlert(list, alert) {
  list.push({
    id: `ALERT-${alert.type}-${alert.entityId || alert.projectId || Math.random().toString(36).slice(2, 8)}`,
    generated_at: new Date().toISOString(),
    ...alert,
  });
}

// ===================== 1. طلبات فحص مرفوضة =====================

function checkRejectedInspections(store, { projectId = null } = {}) {
  const alerts = [];
  Object.values(store.inspectionRequests || {}).forEach((ir) => {
    if (projectId && ir.project_id !== projectId) return;
    if (ir.result === 'rejected' && ir.status !== 'closed') {
      pushAlert(alerts, {
        type: 'ir_rejected',
        severity: 'high',
        entity: 'inspection_request',
        entityId: ir.id,
        projectId: ir.project_id,
        message: `طلب الفحص ${ir.code} (${ir.element}) رُفض ويحتاج متابعة`,
      });
    }
  });
  return alerts;
}

// ===================== 2. حالات عدم مطابقة جديدة =====================

function checkNewNcrs(store, { projectId = null } = {}) {
  const alerts = [];
  const now = Date.now();
  Object.values(store.ncrs || {}).forEach((n) => {
    if (projectId && n.project_id !== projectId) return;
    const ageHours = (now - new Date(n.created_at).getTime()) / (60 * 60 * 1000);
    if (ageHours <= THRESHOLDS.ncrRecentHours) {
      pushAlert(alerts, {
        type: 'ncr_new',
        severity: n.severity === 'critical' || n.severity === 'major' ? 'high' : 'medium',
        entity: 'ncr',
        entityId: n.id,
        projectId: n.project_id,
        message: `حالة عدم مطابقة جديدة ${n.code} (${n.element}) - درجة الخطورة: ${n.severity}`,
      });
    }
  });
  return alerts;
}

// ===================== 3. إجراءات تصحيحية متأخرة (CAPA) =====================

function checkOverdueCapas(store, { projectId = null } = {}) {
  const alerts = [];
  const today = new Date();
  Object.values(store.capas || {}).forEach((c) => {
    if (projectId && c.project_id !== projectId) return;
    if (!c.due_date) return;
    if (['closed', 'verified'].includes(c.status)) return;
    const overdueDays = daysBetween(c.due_date, today);
    if (overdueDays > 0) {
      pushAlert(alerts, {
        type: 'capa_overdue',
        severity: overdueDays > 14 ? 'high' : 'medium',
        entity: 'capa',
        entityId: c.id,
        projectId: c.project_id,
        overdueDays,
        message: `الإجراء التصحيحي ${c.code} متأخر عن موعده المحدد (${c.due_date}) بمقدار ${overdueDays} يوم`,
      });
    }
  });
  return alerts;
}

// ===================== 4. شهادات/وثائق منتهية أو قريبة الانتهاء =====================

function checkDocumentExpiry({ projectId = null } = {}) {
  const alerts = [];
  const expiring = unwrap(QMSX.getExpiringDocuments({
    projectId, withinDays: THRESHOLDS.documentExpiryWithinDays,
  })) || [];
  expiring.forEach((doc) => {
    const isExpired = new Date(doc.expiry_date).getTime() < Date.now();
    pushAlert(alerts, {
      type: isExpired ? 'document_expired' : 'document_expiring_soon',
      severity: isExpired ? 'high' : 'medium',
      entity: 'document',
      entityId: doc.id,
      projectId: doc.project_id,
      message: isExpired
        ? `الوثيقة "${doc.title}" منتهية الصلاحية منذ ${doc.expiry_date}`
        : `الوثيقة "${doc.title}" تقترب من انتهاء الصلاحية بتاريخ ${doc.expiry_date}`,
    });
  });
  return alerts;
}

// ===================== 5. اقتراب موعد معايرة جهاز =====================

function checkCalibrationDue(store) {
  const alerts = [];
  const today = new Date();
  Object.values(store.labEquipment || {}).forEach((eq) => {
    if (!eq.next_calibration_date || eq.status === 'retired') return;
    const daysLeft = daysBetween(today, eq.next_calibration_date);
    if (daysLeft < 0) {
      pushAlert(alerts, {
        type: 'calibration_overdue',
        severity: 'high',
        entity: 'lab_equipment',
        entityId: eq.id,
        message: `الجهاز "${eq.name}" (${eq.code}) تجاوز موعد المعايرة منذ ${Math.abs(daysLeft)} يوم`,
      });
    } else if (daysLeft <= THRESHOLDS.calibrationDueWithinDays) {
      pushAlert(alerts, {
        type: 'calibration_due_soon',
        severity: 'medium',
        entity: 'lab_equipment',
        entityId: eq.id,
        message: `الجهاز "${eq.name}" (${eq.code}) يحتاج معايرة خلال ${daysLeft} يوم`,
      });
    }
  });
  return alerts;
}

// ===================== 6. تأخر اعتماد مادة (MAR) =====================

function checkDelayedMars(store, { projectId = null } = {}) {
  const alerts = [];
  const today = new Date();
  Object.values(store.mars || {}).forEach((m) => {
    if (projectId && m.project_id !== projectId) return;
    if (!['submitted', 'under_review'].includes(m.status)) return;
    const daysInReview = daysBetween(m.updated_at || m.created_at, today);
    if (daysInReview > THRESHOLDS.marReviewDelayDays) {
      pushAlert(alerts, {
        type: 'mar_delayed',
        severity: daysInReview > 14 ? 'high' : 'medium',
        entity: 'mar',
        entityId: m.id,
        projectId: m.project_id,
        message: `طلب اعتماد المادة ${m.code} (${m.material_name}) عالق في المراجعة منذ ${daysInReview} يوم`,
      });
    }
  });
  return alerts;
}

// ===================== 7. تأخر اعتماد رسم (SDR) =====================

function checkDelayedSdrs(store, { projectId = null } = {}) {
  const alerts = [];
  const today = new Date();
  Object.values(store.sdrs || {}).forEach((s) => {
    if (projectId && s.project_id !== projectId) return;
    if (!['submitted', 'under_review'].includes(s.status)) return;
    const daysInReview = daysBetween(s.updated_at || s.created_at, today);
    if (daysInReview > THRESHOLDS.sdrReviewDelayDays) {
      pushAlert(alerts, {
        type: 'sdr_delayed',
        severity: daysInReview > 14 ? 'high' : 'medium',
        entity: 'sdr',
        entityId: s.id,
        projectId: s.project_id,
        message: `طلب اعتماد الرسم ${s.code} (${s.drawing_title}) عالق في المراجعة منذ ${daysInReview} يوم`,
      });
    }
  });
  return alerts;
}

// ===================== 8. انخفاض مؤشرات الجودة =====================

function checkQualityKpiDrops({ projectId = null } = {}) {
  const alerts = [];
  const kpis = unwrap(QMSX.getQualityKpis({ projectId }));
  if (!kpis) return alerts;
  const general = kpis.general || {};
  if (typeof general.inspection_pass_rate === 'number'
    && general.inspection_pass_rate < THRESHOLDS.qualityComplianceMin) {
    pushAlert(alerts, {
      type: 'kpi_compliance_low',
      severity: 'high',
      entity: 'kpi',
      entityId: 'inspection_pass_rate',
      projectId,
      message: `نسبة نجاح الفحوصات انخفضت إلى ${general.inspection_pass_rate}% (الحد الأدنى ${THRESHOLDS.qualityComplianceMin}%)`,
    });
  }
  if (typeof general.test_pass_rate === 'number'
    && general.test_pass_rate < THRESHOLDS.testPassRateMin) {
    pushAlert(alerts, {
      type: 'kpi_test_pass_rate_low',
      severity: 'medium',
      entity: 'kpi',
      entityId: 'test_pass_rate',
      projectId,
      message: `معدل نجاح الاختبارات انخفض إلى ${general.test_pass_rate}% (الحد الأدنى ${THRESHOLDS.testPassRateMin}%)`,
    });
  }
  return alerts;
}

// ===================== التجميع النهائي =====================

const SEVERITY_ORDER = { high: 3, medium: 2, low: 1 };

/** يُرجع كل التنبيهات النشطة الآن، مُرتّبة حسب الخطورة (الأعلى أولاً) ثم التاريخ (الأحدث أولاً) */
function getActiveAlerts({ projectId = null } = {}) {
  const store = QMS.loadStore();
  const all = [
    ...checkRejectedInspections(store, { projectId }),
    ...checkNewNcrs(store, { projectId }),
    ...checkOverdueCapas(store, { projectId }),
    ...checkDocumentExpiry({ projectId }),
    ...checkCalibrationDue(store),
    ...checkDelayedMars(store, { projectId }),
    ...checkDelayedSdrs(store, { projectId }),
    ...checkQualityKpiDrops({ projectId }),
  ];
  all.sort((a, b) => {
    const sevDiff = (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0);
    if (sevDiff !== 0) return sevDiff;
    return new Date(b.generated_at) - new Date(a.generated_at);
  });
  return all;
}

/** ملخّص عددي للتنبيهات (لعرضه في لوحة التحكم كبطاقات) */
function getAlertsSummary({ projectId = null } = {}) {
  const alerts = getActiveAlerts({ projectId });
  const byType = {};
  const bySeverity = { high: 0, medium: 0, low: 0 };
  alerts.forEach((a) => {
    byType[a.type] = (byType[a.type] || 0) + 1;
    bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
  });
  return {
    total: alerts.length,
    by_severity: bySeverity,
    by_type: byType,
    alerts,
  };
}

module.exports = {
  THRESHOLDS,
  getActiveAlerts,
  getAlertsSummary,
  // مُصدَّرة أيضاً بشكل منفرد لأغراض الاختبار أو الاستخدام الجزئي
  checkRejectedInspections,
  checkNewNcrs,
  checkOverdueCapas,
  checkDocumentExpiry,
  checkCalibrationDue,
  checkDelayedMars,
  checkDelayedSdrs,
  checkQualityKpiDrops,
};
