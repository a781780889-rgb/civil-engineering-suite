const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { calculateConcreteMaterials } = require('./utils/materialCalculator');
const {
  calculateIsolatedFooting,
  calculateCombinedFooting,
  calculateStripFooting,
  calculateStrapFooting,
  calculateRaftFoundation,
} = require('./calculators/footings');
const { calculateColumn } = require('./calculators/columns');
const { calculateBeam } = require('./calculators/beams');
const { calculateSolidSlab, calculateHollowBlockSlab } = require('./calculators/slabs');
const { calculateWall } = require('./calculators/walls');
const { calculateStaircase } = require('./calculators/staircases');
const { calculateTank } = require('./calculators/tanks');
const { calculatePool } = require('./calculators/pools');
const { generatePDFReport } = require('./utils/nativePdfGenerator');
const {
  MIX_DESIGNS, REBAR_DIAMETERS, STEEL_GRADES, DESIGN_CODES, BAR_SURFACE,
  calculateHookLength, calculateDevelopmentLength, calculateLapSpliceLength,
  DEFAULT_STEEL_PRICING,
} = require('./utils/constants');
const { calculateTieShape } = require('./utils/tieShapesLibrary');
const { runDesignChecks } = require('./utils/rebarDesignChecks');
const { calculateSteelCost, calculateProjectSteelCost } = require('./utils/rebarPricing');
const BOQ = require('./calculators/boq');
const IMPORT = require('./calculators/import');
const PriceLib = require('./utils/priceLibrary');
const Reports = require('./utils/boqReports');
const PM = require('./utils/projectManagement');
const SCH = require('./utils/scheduling');
const BIZ = require('./utils/businessManagement');
const BIZC = require('./utils/businessContracts');
const BIZO = require('./utils/businessOperations');
const SEC = require('./utils/businessSecurity');
const GOV = require('./utils/businessGovernance');
const EQ = require('./utils/equipmentManagement');
const EQR = require('./utils/equipmentReports');
const EQI = require('./utils/equipmentIntelligence');
const HSE = require('./utils/hseManagement');
const {
  calculateFootingRebarDetailed,
  calculateColumnRebarDetailed,
  calculateBeamRebarDetailed,
  calculateSlabRebarDetailed,
  calculateWallRebarDetailed,
  calculateStaircaseRebarDetailed,
  calculateTankRebarDetailed,
  calculatePoolRebarDetailed,
  calculateCustomRebarElement,
} = require('./calculators/rebarSection');

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// يحدد مسار الفرونت إند تلقائياً بغض النظر عن Root Directory المستخدم في الاستضافة:
// يجرب أولاً '../frontend' (حالة Root Directory = backend)، ثم './frontend' (حالة Root Directory = جذر المشروع)
function resolveFrontendDir() {
  const candidates = [
    path.join(__dirname, '..', 'frontend'),
    path.join(__dirname, 'frontend'),
    path.join(process.cwd(), 'frontend'),
    path.join(process.cwd(), 'backend', '..', 'frontend'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  // لم يُعثر على المجلد بعد؛ نرجع أول احتمال ليظهر خطأ واضح في السجلات بدل فشل صامت
  return candidates[0];
}
const FRONTEND_DIR = resolveFrontendDir();
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

function sendJSON(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('الملف غير موجود');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 30 * 1024 * 1024) req.destroy(); // حد أعلى موسّع لدعم رفع ملفات Excel/PDF/DXF المشفّرة base64
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('صيغة JSON غير صحيحة في الطلب'));
      }
    });
    req.on('error', reject);
  });
}

function getAuthToken(req) {
  const header = req?.headers?.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

function requirePermission(req, mod, action) {
  const token = getAuthToken(req);
  if (!token) throw new Error('يجب تسجيل الدخول للوصول إلى هذا المورد');
  if (!SEC.can(token, mod, action)) throw new Error('لا تملك صلاحية تنفيذ هذا الإجراء');
  return token;
}

// القسم السابع - إدارة المعدات - الجزء الرابع (4-أ): يعيد بناء التقرير المطلوب
// حسب reportType قبل تمريره لدوال التصدير (PDF/Excel/CSV/طباعة) في equipmentReports.js
function buildEquipmentReportFromRequest(body) {
  const { reportType } = body || {};
  if (!reportType) throw new Error('نوع التقرير (reportType) مطلوب');
  const f = {
    equipmentId: body.equipmentId || null, projectId: body.projectId || null,
    category: body.category || null, type: body.type || null, status: body.status || null,
    maintenanceType: body.maintenanceType || null, severity: body.severity || null,
    dateFrom: body.dateFrom || null, dateTo: body.dateTo || null,
  };
  switch (reportType) {
    case 'fleet_register': return EQR.buildFleetRegisterReport(f);
    case 'operations': return EQR.buildOperationsReport(f);
    case 'maintenance': return EQR.buildMaintenanceReport(f);
    case 'fuel': return EQR.buildFuelReport(f);
    case 'faults': return EQR.buildFaultsReport(f);
    case 'productivity': return EQR.buildProductivityReport(f);
    case 'costs': return EQR.buildCostsReport(f);
    case 'depreciation': return EQR.buildDepreciationReport(f);
    case 'usage_by_project':
      if (!f.projectId) throw new Error('معرّف المشروع (projectId) مطلوب لتقرير الاستخدام حسب المشروع');
      return EQR.buildUsageByProjectReport(f);
    case 'executive_summary': return EQR.buildExecutiveSummaryReport(f);
    default: throw new Error(`نوع تقرير غير معروف: ${reportType}`);
  }
}

const API_HANDLERS = {
  '/api/concrete/reference-data': {
    GET: async () => ({ success: true, data: { mix_designs: MIX_DESIGNS, rebar_diameters: REBAR_DIAMETERS } }),
  },
  '/api/concrete/footings/isolated': {
    POST: async (body) => {
      const structural = calculateIsolatedFooting(body);
      const materials = calculateConcreteMaterials({ volume_m3: structural.volume_m3, ...body });
      return { success: true, data: { structural, materials } };
    },
  },
  '/api/concrete/footings/combined': {
    POST: async (body) => {
      const structural = calculateCombinedFooting(body);
      const materials = calculateConcreteMaterials({ volume_m3: structural.volume_m3, ...body });
      return { success: true, data: { structural, materials } };
    },
  },
  '/api/concrete/footings/strip': {
    POST: async (body) => {
      const structural = calculateStripFooting(body);
      const materials = calculateConcreteMaterials({ volume_m3: structural.volume_m3, ...body });
      return { success: true, data: { structural, materials } };
    },
  },
  '/api/concrete/footings/strap': {
    POST: async (body) => {
      const structural = calculateStrapFooting(body);
      const materials = calculateConcreteMaterials({ volume_m3: structural.total_volume_m3, ...body });
      return { success: true, data: { structural, materials } };
    },
  },
  '/api/concrete/footings/raft': {
    POST: async (body) => {
      const structural = calculateRaftFoundation(body);
      const materials = calculateConcreteMaterials({ volume_m3: structural.volume_m3, ...body });
      return { success: true, data: { structural, materials } };
    },
  },
  '/api/concrete/columns': {
    POST: async (body) => {
      const structural = calculateColumn(body);
      const materials = calculateConcreteMaterials({ volume_m3: structural.volume_m3, ...body });
      return { success: true, data: { structural, materials } };
    },
  },
  '/api/concrete/beams': {
    POST: async (body) => {
      const structural = calculateBeam(body);
      const materials = calculateConcreteMaterials({ volume_m3: structural.volume_m3, ...body });
      return { success: true, data: { structural, materials } };
    },
  },
  '/api/concrete/slabs/solid': {
    POST: async (body) => {
      const structural = calculateSolidSlab(body);
      const materials = calculateConcreteMaterials({ volume_m3: structural.volume_m3, ...body });
      return { success: true, data: { structural, materials } };
    },
  },
  '/api/concrete/slabs/hollow-block': {
    POST: async (body) => {
      const structural = calculateHollowBlockSlab(body);
      const materials = calculateConcreteMaterials({ volume_m3: structural.net_concrete_volume_m3, ...body });
      return { success: true, data: { structural, materials } };
    },
  },
  '/api/concrete/walls': {
    POST: async (body) => {
      const structural = calculateWall(body);
      const materials = calculateConcreteMaterials({ volume_m3: structural.volume_m3, ...body });
      return { success: true, data: { structural, materials } };
    },
  },
  '/api/concrete/staircases': {
    POST: async (body) => {
      const structural = calculateStaircase(body);
      const materials = calculateConcreteMaterials({ volume_m3: structural.total_concrete_volume_m3, ...body });
      return { success: true, data: { structural, materials } };
    },
  },
  '/api/concrete/tanks': {
    POST: async (body) => {
      const structural = calculateTank(body);
      const materials = calculateConcreteMaterials({ volume_m3: structural.concrete_volumes.total_m3, ...body });
      return { success: true, data: { structural, materials } };
    },
  },
  '/api/concrete/pools': {
    POST: async (body) => {
      const structural = calculatePool(body);
      const materials = calculateConcreteMaterials({ volume_m3: structural.concrete_volumes.total_m3, ...body });
      return { success: true, data: { structural, materials } };
    },
  },
  '/api/concrete/materials-only': {
    POST: async (body) => ({ success: true, data: calculateConcreteMaterials(body) }),
  },
  '/api/concrete/export-pdf': {
    POST: async (body) => {
      const { projectName, engineerName, clientName, calculationType, inputs, results } = body;
      if (!results) throw new Error('لا توجد نتائج لتصديرها');
      const fileName = `report_${Date.now()}.pdf`;
      const outputPath = path.join(REPORTS_DIR, fileName);
      const { reportNumber } = await generatePDFReport({
        projectName, engineerName, clientName,
        reportTitle: 'تقرير حساب الخرسانة - Concrete Calculation Report',
        calculationType: calculationType || 'Concrete Calculation',
        inputs: inputs || {},
        results,
        outputPath,
      });
      return { success: true, reportNumber, downloadUrl: `/reports/${fileName}` };
    },
  },
  '/api/health': {
    GET: async () => ({ status: 'ok', module: 'Concrete Calculator - Section 1', time: new Date().toISOString() }),
  },

  // ===================== القسم الثاني: حاسبة حديد التسليح =====================
  '/api/rebar/reference-data': {
    GET: async () => ({
      success: true,
      data: {
        rebar_diameters: REBAR_DIAMETERS,
        steel_grades: STEEL_GRADES,
        design_codes: DESIGN_CODES,
        bar_surface_types: BAR_SURFACE,
        default_pricing: DEFAULT_STEEL_PRICING,
        tie_shapes: ['rectangular', 'square', 'circular', 'polygonal', 'double', 'custom'],
        hook_angles: [90, 135, 180],
      },
    }),
  },
  '/api/rebar/dashboard-summary': {
    GET: async () => ({
      success: true,
      data: {
        message: 'استخدم بيانات المشروع المحفوظة في الواجهة الأمامية لبناء بطاقات لوحة التحكم (الوزن الكلي، عدد الأسياخ، التكلفة، الهدر) من نتائج الحسابات المخزنة',
      },
    }),
  },

  '/api/rebar/hook-length': {
    POST: async (body) => {
      const { barDiameter_mm, hookAngle, isTie } = body;
      if (!barDiameter_mm || !hookAngle) throw new Error('يجب إدخال قطر السيخ وزاوية الخطاف');
      return { success: true, data: calculateHookLength(barDiameter_mm, hookAngle, !!isTie) };
    },
  },
  '/api/rebar/development-length': {
    POST: async (body) => ({ success: true, data: calculateDevelopmentLength(body) }),
  },
  '/api/rebar/lap-splice-length': {
    POST: async (body) => {
      const dev = calculateDevelopmentLength(body);
      const lap = calculateLapSpliceLength(dev.development_length_mm, body.spliceClass || 'B');
      return { success: true, data: { development: dev, lap_splice: lap } };
    },
  },
  '/api/rebar/tie-shape': {
    POST: async (body) => {
      const { shapeType, ...params } = body;
      if (!shapeType) throw new Error('يجب تحديد نوع شكل الكانة');
      return { success: true, data: calculateTieShape(shapeType, params) };
    },
  },
  '/api/rebar/design-checks': {
    POST: async (body) => ({ success: true, data: runDesignChecks(body) }),
  },
  '/api/rebar/cost': {
    POST: async (body) => ({ success: true, data: calculateSteelCost(body) }),
  },
  '/api/rebar/project-cost': {
    POST: async (body) => {
      const { elements, pricing } = body;
      if (!elements || !Array.isArray(elements)) throw new Error('يجب إدخال قائمة عناصر (elements) لحساب التكلفة الإجمالية');
      return { success: true, data: calculateProjectSteelCost(elements, pricing || {}) };
    },
  },

  // ----- عناصر إنشائية: حديد تفصيلي -----
  '/api/rebar/footings/isolated': {
    POST: async (body) => ({ success: true, data: calculateFootingRebarDetailed('isolated', body) }),
  },
  '/api/rebar/footings/combined': {
    POST: async (body) => ({ success: true, data: calculateFootingRebarDetailed('combined', body) }),
  },
  '/api/rebar/footings/strip': {
    POST: async (body) => ({ success: true, data: calculateFootingRebarDetailed('strip', body) }),
  },
  '/api/rebar/footings/raft': {
    POST: async (body) => ({ success: true, data: calculateFootingRebarDetailed('raft', body) }),
  },
  '/api/rebar/footings/strap': {
    POST: async (body) => ({ success: true, data: calculateFootingRebarDetailed('strap', body) }),
  },
  '/api/rebar/columns': {
    POST: async (body) => ({ success: true, data: calculateColumnRebarDetailed(body) }),
  },
  '/api/rebar/beams': {
    POST: async (body) => ({ success: true, data: calculateBeamRebarDetailed(body) }),
  },
  '/api/rebar/slabs/solid': {
    POST: async (body) => ({ success: true, data: calculateSlabRebarDetailed('solid', body) }),
  },
  '/api/rebar/slabs/hollow-block': {
    POST: async (body) => ({ success: true, data: calculateSlabRebarDetailed('hollow', body) }),
  },
  '/api/rebar/walls': {
    POST: async (body) => ({ success: true, data: calculateWallRebarDetailed(body) }),
  },
  '/api/rebar/staircases': {
    POST: async (body) => ({ success: true, data: calculateStaircaseRebarDetailed(body) }),
  },
  '/api/rebar/tanks': {
    POST: async (body) => ({ success: true, data: calculateTankRebarDetailed(body) }),
  },
  '/api/rebar/pools': {
    POST: async (body) => ({ success: true, data: calculatePoolRebarDetailed(body) }),
  },
  '/api/rebar/custom-element': {
    POST: async (body) => ({ success: true, data: calculateCustomRebarElement(body) }),
  },

  '/api/rebar/export-pdf': {
    POST: async (body) => {
      const { projectName, engineerName, clientName, calculationType, inputs, results } = body;
      if (!results) throw new Error('لا توجد نتائج لتصديرها');
      const fileName = `rebar_report_${Date.now()}.pdf`;
      const outputPath = path.join(REPORTS_DIR, fileName);
      const { reportNumber } = await generatePDFReport({
        projectName, engineerName, clientName,
        reportTitle: 'تقرير حساب حديد التسليح - Reinforcement Steel Report',
        calculationType: calculationType || 'Rebar Calculation',
        inputs: inputs || {},
        results,
        outputPath,
      });
      return { success: true, reportNumber, downloadUrl: `/reports/${fileName}` };
    },
  },

  // ===================== القسم الثالث: نظام حصر الكميات (BOQ) - الجزء الأول =====================
  '/api/boq/health': {
    GET: async () => ({ status: 'ok', module: 'BOQ System - Part 1 (Engineering Calculations)', time: new Date().toISOString() }),
  },

  // ----- أعمال التربة -----
  '/api/boq/earthworks/excavation': {
    POST: async (body) => ({ success: true, data: BOQ.earthworks.calculateExcavationVolume(body) }),
  },
  '/api/boq/earthworks/trench': {
    POST: async (body) => ({ success: true, data: BOQ.earthworks.calculateTrenchExcavation(body) }),
  },
  '/api/boq/earthworks/mass-grid': {
    POST: async (body) => ({ success: true, data: BOQ.earthworks.calculateMassExcavationGrid(body) }),
  },
  '/api/boq/earthworks/filling-compaction': {
    POST: async (body) => ({ success: true, data: BOQ.earthworks.calculateFillingCompaction(body) }),
  },
  '/api/boq/earthworks/soil-replacement': {
    POST: async (body) => ({ success: true, data: BOQ.earthworks.calculateSoilReplacement(body) }),
  },
  '/api/boq/earthworks/backfilling': {
    POST: async (body) => ({ success: true, data: BOQ.earthworks.calculateBackfilling(body) }),
  },
  '/api/boq/earthworks/spoil-disposal': {
    POST: async (body) => ({ success: true, data: BOQ.earthworks.calculateSpoilDisposal(body) }),
  },

  // ----- المباني -----
  '/api/boq/masonry/wall': {
    POST: async (body) => ({ success: true, data: BOQ.masonry.calculateWallMasonry(body) }),
  },
  '/api/boq/masonry/project': {
    POST: async (body) => ({ success: true, data: BOQ.masonry.calculateProjectMasonry(body) }),
  },
  '/api/boq/masonry/reference-data': {
    GET: async () => ({ success: true, data: { units: BOQ.masonry.MASONRY_UNITS, weights: BOQ.masonry.UNIT_WEIGHTS_KG } }),
  },

  // ----- اللياسة والعزل -----
  '/api/boq/plaster/cement': {
    POST: async (body) => ({ success: true, data: BOQ.plasterWaterproofing.calculateCementPlaster(body) }),
  },
  '/api/boq/plaster/gypsum': {
    POST: async (body) => ({ success: true, data: BOQ.plasterWaterproofing.calculateGypsumPlaster(body) }),
  },
  '/api/boq/waterproofing/general': {
    POST: async (body) => ({ success: true, data: BOQ.plasterWaterproofing.calculateWaterproofing(body) }),
  },
  '/api/boq/waterproofing/thermal': {
    POST: async (body) => ({ success: true, data: BOQ.plasterWaterproofing.calculateThermalInsulation(body) }),
  },
  '/api/boq/waterproofing/tank': {
    POST: async (body) => ({ success: true, data: BOQ.plasterWaterproofing.calculateTankInsulation(body) }),
  },
  '/api/boq/waterproofing/bathroom': {
    POST: async (body) => ({ success: true, data: BOQ.plasterWaterproofing.calculateBathroomWaterproofing(body) }),
  },

  // ----- الأرضيات والأسقف والدهانات -----
  '/api/boq/flooring/tile': {
    POST: async (body) => ({ success: true, data: BOQ.flooringCeilingPaint.calculateTileFlooring(body) }),
  },
  '/api/boq/flooring/parquet': {
    POST: async (body) => ({ success: true, data: BOQ.flooringCeilingPaint.calculateParquetFlooring(body) }),
  },
  '/api/boq/flooring/epoxy': {
    POST: async (body) => ({ success: true, data: BOQ.flooringCeilingPaint.calculateEpoxyFlooring(body) }),
  },
  '/api/boq/flooring/printed-concrete': {
    POST: async (body) => ({ success: true, data: BOQ.flooringCeilingPaint.calculatePrintedConcrete(body) }),
  },
  '/api/boq/ceiling/gypsum': {
    POST: async (body) => ({ success: true, data: BOQ.flooringCeilingPaint.calculateGypsumCeiling(body) }),
  },
  '/api/boq/ceiling/grid': {
    POST: async (body) => ({ success: true, data: BOQ.flooringCeilingPaint.calculateGridCeiling(body) }),
  },
  '/api/boq/painting': {
    POST: async (body) => ({ success: true, data: BOQ.flooringCeilingPaint.calculatePainting(body) }),
  },

  // ----- النجارة والألمنيوم والزجاج -----
  '/api/boq/carpentry/doors': {
    POST: async (body) => ({ success: true, data: BOQ.carpentryAluminum.calculateWoodenDoors(body) }),
  },
  '/api/boq/carpentry/windows': {
    POST: async (body) => ({ success: true, data: BOQ.carpentryAluminum.calculateWoodenWindows(body) }),
  },
  '/api/boq/carpentry/kitchen': {
    POST: async (body) => ({ success: true, data: BOQ.carpentryAluminum.calculateKitchenCabinets(body) }),
  },
  '/api/boq/carpentry/wardrobes': {
    POST: async (body) => ({ success: true, data: BOQ.carpentryAluminum.calculateWardrobes(body) }),
  },
  '/api/boq/aluminum/curtain-wall': {
    POST: async (body) => ({ success: true, data: BOQ.carpentryAluminum.calculateCurtainWallFacade(body) }),
  },
  '/api/boq/aluminum/windows': {
    POST: async (body) => ({ success: true, data: BOQ.carpentryAluminum.calculateAluminumWindows(body) }),
  },
  '/api/boq/aluminum/doors': {
    POST: async (body) => ({ success: true, data: BOQ.carpentryAluminum.calculateAluminumDoors(body) }),
  },
  '/api/boq/aluminum/glass-dome': {
    POST: async (body) => ({ success: true, data: BOQ.carpentryAluminum.calculateGlassDome(body) }),
  },

  // ----- الأعمال الكهربائية والصحية -----
  '/api/boq/electrical/cables': {
    POST: async (body) => ({ success: true, data: BOQ.electricalPlumbing.calculateElectricalCables(body) }),
  },
  '/api/boq/electrical/conduits': {
    POST: async (body) => ({ success: true, data: BOQ.electricalPlumbing.calculateElectricalConduits(body) }),
  },
  '/api/boq/electrical/panels': {
    POST: async (body) => ({ success: true, data: BOQ.electricalPlumbing.calculateElectricalPanels(body) }),
  },
  '/api/boq/electrical/switches-outlets': {
    POST: async (body) => ({ success: true, data: BOQ.electricalPlumbing.calculateSwitchesOutlets(body) }),
  },
  '/api/boq/electrical/earthing': {
    POST: async (body) => ({ success: true, data: BOQ.electricalPlumbing.calculateEarthingSystem(body) }),
  },
  '/api/boq/electrical/fire-alarm': {
    POST: async (body) => ({ success: true, data: BOQ.electricalPlumbing.calculateFireAlarmSystem(body) }),
  },
  '/api/boq/plumbing/water-supply': {
    POST: async (body) => ({ success: true, data: BOQ.electricalPlumbing.calculateWaterSupplyPipes(body) }),
  },
  '/api/boq/plumbing/drainage': {
    POST: async (body) => ({ success: true, data: BOQ.electricalPlumbing.calculateDrainagePipes(body) }),
  },
  '/api/boq/plumbing/vent': {
    POST: async (body) => ({ success: true, data: BOQ.electricalPlumbing.calculateVentPipes(body) }),
  },
  '/api/boq/plumbing/pumps': {
    POST: async (body) => ({ success: true, data: BOQ.electricalPlumbing.calculateWaterPumps(body) }),
  },
  '/api/boq/plumbing/tank-capacity': {
    POST: async (body) => ({ success: true, data: BOQ.electricalPlumbing.calculateWaterTankCapacity(body) }),
  },

  // ----- أعمال الطرق -----
  '/api/boq/roads/fill-layers': {
    POST: async (body) => ({ success: true, data: BOQ.roadworks.calculateRoadFillLayers(body) }),
  },
  '/api/boq/roads/base-course': {
    POST: async (body) => ({ success: true, data: BOQ.roadworks.calculateBaseCourse(body) }),
  },
  '/api/boq/roads/asphalt': {
    POST: async (body) => ({ success: true, data: BOQ.roadworks.calculateAsphaltLayers(body) }),
  },
  '/api/boq/roads/sidewalks': {
    POST: async (body) => ({ success: true, data: BOQ.roadworks.calculateSidewalks(body) }),
  },
  '/api/boq/roads/curbstones': {
    POST: async (body) => ({ success: true, data: BOQ.roadworks.calculateCurbstones(body) }),
  },
  '/api/boq/roads/markings': {
    POST: async (body) => ({ success: true, data: BOQ.roadworks.calculateRoadMarkings(body) }),
  },

  // =====================================================================
  // القسم الثالث - الجزء الثاني: طرق الاستيراد (Excel/CSV/PDF/DXF) والذكاء الاصطناعي
  // =====================================================================

  // ----- استيراد CSV -----
  '/api/import/csv': {
    POST: async (body) => {
      const text = body.csv_text || (body.file_base64 ? Buffer.from(body.file_base64, 'base64').toString('utf8') : null);
      if (!text) throw new Error('يجب إرسال csv_text أو file_base64');
      const result = IMPORT.csv.importBOQFromCSV(text, { delimiter: body.delimiter });
      return { success: result.success, data: result };
    },
  },

  // ----- استيراد Excel (.xlsx) -----
  '/api/import/xlsx': {
    POST: async (body) => {
      if (!body.file_base64) throw new Error('يجب إرسال محتوى الملف file_base64 (Base64) لملف xlsx');
      const buffer = Buffer.from(body.file_base64, 'base64');
      const result = IMPORT.xlsx.importBOQFromXlsx(buffer);
      return { success: result.success, data: result };
    },
  },

  // ----- استخراج نصوص/جداول من PDF -----
  '/api/import/pdf': {
    POST: async (body) => {
      if (!body.file_base64) throw new Error('يجب إرسال محتوى الملف file_base64 (Base64) لملف pdf');
      const buffer = Buffer.from(body.file_base64, 'base64');
      const extracted = IMPORT.pdf.extractPdfText(buffer);
      const tableGuess = IMPORT.pdf.extractBOQTableFromText(extracted.lines);
      return {
        success: true,
        data: {
          source: 'pdf',
          streams_found: extracted.streams_found,
          text_streams_decoded: extracted.text_streams_decoded,
          full_text: extracted.full_text,
          line_count: extracted.lines.length,
          boq_table_guess: tableGuess,
        },
      };
    },
  },

  // ----- استيراد وتحليل DXF -----
  '/api/import/dxf': {
    POST: async (body) => {
      const text = body.dxf_text || (body.file_base64 ? Buffer.from(body.file_base64, 'base64').toString('latin1') : null);
      if (!text) throw new Error('يجب إرسال dxf_text أو file_base64');
      const result = IMPORT.dxf.parseDxfFile(text);
      return { success: true, data: result };
    },
  },

  // ----- حالة تفعيل الذكاء الاصطناعي -----
  '/api/import/ai/status': {
    GET: async () => ({ success: true, data: { available: IMPORT.ai.isAIAvailable() } }),
  },

  // ----- تحليل بيانات مخطط مستخرجة (من PDF/DXF) بالذكاء الاصطناعي -----
  '/api/import/ai/analyze-plan': {
    POST: async (body) => {
      const result = await IMPORT.ai.analyzeExtractedPlanData({
        sourceType: body.source_type || 'unknown',
        extractedText: body.extracted_text,
        entitiesSummary: body.entities_summary,
        projectType: body.project_type,
      });
      return result;
    },
  },

  // ----- مقارنة نسختين من بيانات حصر بالذكاء الاصطناعي -----
  '/api/import/ai/compare-boq': {
    POST: async (body) => {
      if (!body.version_a || !body.version_b) throw new Error('يجب إرسال version_a و version_b للمقارنة');
      const result = await IMPORT.ai.compareBOQVersions({
        versionA: body.version_a,
        versionB: body.version_b,
        labelA: body.label_a,
        labelB: body.label_b,
      });
      return result;
    },
  },

  // ----- سؤال هندسي حر بالذكاء الاصطناعي -----
  '/api/import/ai/ask': {
    POST: async (body) => {
      if (!body.question) throw new Error('يجب إرسال question');
      const result = await IMPORT.ai.answerEngineeringQuestion({
        question: body.question,
        context: body.context,
      });
      return result;
    },
  },

  // ===================================================================
  // القسم الثالث - مكتبة الأسعار المركزية (Price Library)
  // ===================================================================
  '/api/prices/effective': {
    GET: async (_body, query) => PriceLib.getEffectivePrices({ projectId: query?.projectId || null, region: query?.region || null }),
    POST: async (body) => PriceLib.getEffectivePrices({ projectId: body.projectId || null, region: body.region || null }),
  },
  '/api/prices/global': {
    POST: async (body) => PriceLib.updateGlobalPrices(body),
  },
  '/api/prices/region': {
    POST: async (body) => {
      if (!body.region) throw new Error('اسم المنطقة مطلوب');
      return PriceLib.updateRegionPrices(body.region, body.prices || {});
    },
  },
  '/api/prices/project': {
    POST: async (body) => {
      if (!body.projectId) throw new Error('معرّف المشروع مطلوب');
      return PriceLib.updateProjectPrices(body.projectId, body.prices || {});
    },
  },
  '/api/prices/regions': {
    GET: async () => ({ regions: PriceLib.listRegions() }),
  },
  '/api/prices/projects': {
    GET: async () => ({ projects: PriceLib.listProjectsWithPricing() }),
  },
  '/api/prices/suppliers': {
    GET: async (_body, query) => ({ suppliers: PriceLib.listSuppliers({ item: query?.item || null, region: query?.region || null }) }),
    POST: async (body) => PriceLib.addSupplier(body),
  },
  '/api/prices/suppliers/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المورد مطلوب');
      return PriceLib.deleteSupplier(body.id);
    },
  },
  '/api/prices/suppliers/cheapest': {
    GET: async (_body, query) => {
      if (!query?.item) throw new Error('يجب تحديد اسم البند (item)');
      return { item: query.item, cheapest: PriceLib.findCheapestSupplier(query.item) };
    },
  },
  '/api/prices/line-item': {
    POST: async (body) => PriceLib.priceLineItem(body),
  },

  // ===================================================================
  // القسم الثالث - التقارير (BOQ Reports)
  // ===================================================================
  // body.items: [{ category, description, quantity, unit, wastePercent, priceKey, unitPrice }]
  '/api/reports/boq': {
    POST: async (body) => {
      if (!Array.isArray(body.items) || body.items.length === 0) throw new Error('يجب توفير قائمة items لا تقل عن بند واحد');
      const lineItems = body.items.map(Reports.makeLineItem);
      const priced = Reports.priceLineItems(lineItems, { projectId: body.projectId, region: body.region });
      return Reports.buildBOQTable(priced);
    },
  },
  '/api/reports/quantity': {
    POST: async (body) => {
      if (!Array.isArray(body.items) || body.items.length === 0) throw new Error('يجب توفير قائمة items لا تقل عن بند واحد');
      const lineItems = body.items.map(Reports.makeLineItem);
      return Reports.buildQuantityReport(lineItems);
    },
  },
  '/api/reports/prices': {
    POST: async (body) => {
      if (!Array.isArray(body.items) || body.items.length === 0) throw new Error('يجب توفير قائمة items لا تقل عن بند واحد');
      const lineItems = body.items.map(Reports.makeLineItem);
      const priced = Reports.priceLineItems(lineItems, { projectId: body.projectId, region: body.region });
      return Reports.buildPriceReport(priced, { projectId: body.projectId, region: body.region });
    },
  },
  '/api/reports/costs': {
    POST: async (body) => {
      if (!Array.isArray(body.items) || body.items.length === 0) throw new Error('يجب توفير قائمة items لا تقل عن بند واحد');
      const lineItems = body.items.map(Reports.makeLineItem);
      const priced = Reports.priceLineItems(lineItems, { projectId: body.projectId, region: body.region });
      return Reports.buildCostReport(priced, {
        taxPercent: body.taxPercent || 0,
        discountPercent: body.discountPercent || 0,
        laborCost: body.laborCost || 0,
        equipmentCost: body.equipmentCost || 0,
        transportCost: body.transportCost || 0,
      });
    },
  },
  '/api/reports/waste': {
    POST: async (body) => {
      if (!Array.isArray(body.items) || body.items.length === 0) throw new Error('يجب توفير قائمة items لا تقل عن بند واحد');
      const lineItems = body.items.map(Reports.makeLineItem);
      return Reports.buildWasteReport(lineItems);
    },
  },
  '/api/reports/comparison': {
    POST: async (body) => {
      if (!Array.isArray(body.previousItems) || !Array.isArray(body.currentItems)) {
        throw new Error('يجب توفير previousItems و currentItems');
      }
      const prev = body.previousItems.map(Reports.makeLineItem);
      const curr = body.currentItems.map(Reports.makeLineItem);
      return Reports.buildComparisonReport(prev, curr);
    },
  },
  '/api/reports/completion': {
    POST: async (body) => {
      if (!Array.isArray(body.plannedItems) || !Array.isArray(body.executedItems)) {
        throw new Error('يجب توفير plannedItems و executedItems');
      }
      const planned = body.plannedItems.map(Reports.makeLineItem);
      const executed = body.executedItems.map(Reports.makeLineItem);
      return Reports.buildCompletionReport(planned, executed);
    },
  },
  '/api/reports/project-summary': {
    POST: async (body) => {
      if (!Array.isArray(body.items) || body.items.length === 0) throw new Error('يجب توفير قائمة items لا تقل عن بند واحد');
      const lineItems = body.items.map(Reports.makeLineItem);
      const priced = Reports.priceLineItems(lineItems, { projectId: body.projectId, region: body.region });
      const quantityReport = Reports.buildQuantityReport(lineItems);
      const boqTable = Reports.buildBOQTable(priced);
      const wasteReport = Reports.buildWasteReport(lineItems);
      const costReport = Reports.buildCostReport(priced, {
        taxPercent: body.taxPercent || 0, discountPercent: body.discountPercent || 0,
      });
      let completionReport = null;
      if (Array.isArray(body.executedItems)) {
        const executed = body.executedItems.map(Reports.makeLineItem);
        completionReport = Reports.buildCompletionReport(lineItems, executed);
      }
      return Reports.buildProjectSummaryReport({
        projectName: body.projectName, quantityReport, boqTable, costReport, wasteReport, completionReport,
      });
    },
  },

  // ----- التصدير -----
  '/api/reports/export/pdf': {
    POST: async (body) => {
      if (!Array.isArray(body.items) || body.items.length === 0) throw new Error('يجب توفير قائمة items لا تقل عن بند واحد');
      const lineItems = body.items.map(Reports.makeLineItem);
      const priced = Reports.priceLineItems(lineItems, { projectId: body.projectId, region: body.region });
      const boqTable = Reports.buildBOQTable(priced);
      const result = Reports.exportBOQToPDF(boqTable, {
        projectName: body.projectName, engineerName: body.engineerName, clientName: body.clientName,
      });
      return { success: true, ...result };
    },
  },
  '/api/reports/export/excel': {
    POST: async (body) => {
      if (!Array.isArray(body.items) || body.items.length === 0) throw new Error('يجب توفير قائمة items لا تقل عن بند واحد');
      const lineItems = body.items.map(Reports.makeLineItem);
      const priced = Reports.priceLineItems(lineItems, { projectId: body.projectId, region: body.region });
      const boqTable = Reports.buildBOQTable(priced);
      const result = Reports.exportBOQToExcel(boqTable);
      return { success: true, ...result };
    },
  },
  '/api/reports/export/csv': {
    POST: async (body) => {
      if (!Array.isArray(body.items) || body.items.length === 0) throw new Error('يجب توفير قائمة items لا تقل عن بند واحد');
      const lineItems = body.items.map(Reports.makeLineItem);
      const priced = Reports.priceLineItems(lineItems, { projectId: body.projectId, region: body.region });
      const boqTable = Reports.buildBOQTable(priced);
      const result = Reports.exportBOQToCSV(boqTable);
      return { success: true, ...result };
    },
  },
  '/api/reports/export/print': {
    POST: async (body) => {
      if (!Array.isArray(body.items) || body.items.length === 0) throw new Error('يجب توفير قائمة items لا تقل عن بند واحد');
      const lineItems = body.items.map(Reports.makeLineItem);
      const priced = Reports.priceLineItems(lineItems, { projectId: body.projectId, region: body.region });
      const boqTable = Reports.buildBOQTable(priced);
      const result = Reports.exportBOQToPrintableHTML(boqTable, {
        projectName: body.projectName, engineerName: body.engineerName,
      });
      return { success: true, ...result };
    },
  },

  // ===================================================================
  // القسم الرابع - إدارة المشاريع (Project Management System)
  // ===================================================================

  // ----- لوحة المعلومات -----
  '/api/pm/dashboard': {
    GET: async () => PM.getDashboard(),
  },

  // ----- المشاريع (CRUD) -----
  '/api/pm/projects': {
    GET: async (_body, query) => PM.listProjects({
      status: query?.status || null,
      priority: query?.priority || null,
      q: query?.q || null,
      sortBy: query?.sortBy || 'created_at',
      sortDir: query?.sortDir || 'desc',
      page: query?.page ? Number(query.page) : 1,
      pageSize: query?.pageSize ? Number(query.pageSize) : 50,
    }),
    POST: async (body) => PM.createProject(body),
  },
  '/api/pm/projects/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف المشروع (id) مطلوب');
      return PM.getProject(query.id);
    },
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المشروع (id) مطلوب');
      return PM.getProject(body.id);
    },
  },
  '/api/pm/projects/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المشروع (id) مطلوب');
      const { id, ...rest } = body;
      return PM.updateProject(id, rest);
    },
  },
  '/api/pm/projects/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المشروع (id) مطلوب');
      return PM.deleteProject(body.id);
    },
  },

  // ----- المراحل -----
  '/api/pm/phases': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.listPhases(query.projectId);
    },
  },
  '/api/pm/phases/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المرحلة (id) مطلوب');
      const { id, ...rest } = body;
      return PM.updatePhase(id, rest);
    },
  },

  // ----- المهام -----
  '/api/pm/tasks': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.listTasks(query.projectId, { status: query.status, assignee: query.assignee, phaseId: query.phaseId });
    },
    POST: async (body) => PM.createTask(body),
  },
  '/api/pm/tasks/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المهمة (id) مطلوب');
      const { id, ...rest } = body;
      return PM.updateTask(id, rest);
    },
  },
  '/api/pm/tasks/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المهمة (id) مطلوب');
      return PM.deleteTask(body.id);
    },
  },
  '/api/pm/tasks/comment': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المهمة (id) مطلوب');
      return PM.addTaskComment(body.id, { author: body.author, text: body.text });
    },
  },

  // ----- الجدول الزمني -----
  '/api/pm/schedule/critical-path': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.computeCriticalPath(query.projectId);
    },
  },
  '/api/pm/schedule/comparison': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.compareScheduleVsActual(query.projectId);
    },
  },

  // ----- الفريق -----
  '/api/pm/team': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.listTeam(query.projectId);
    },
    POST: async (body) => PM.addTeamMember(body),
  },
  '/api/pm/team/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف العضو (id) مطلوب');
      const { id, ...rest } = body;
      return PM.updateTeamMember(id, rest);
    },
  },
  '/api/pm/team/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف العضو (id) مطلوب');
      return PM.removeTeamMember(body.id);
    },
  },

  // ----- الميزانية والمعاملات المالية -----
  '/api/pm/finance/transactions': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.listTransactions(query.projectId, { type: query.type });
    },
    POST: async (body) => PM.addTransaction(body),
  },
  '/api/pm/finance/transactions/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المعاملة (id) مطلوب');
      return PM.deleteTransaction(body.id);
    },
  },
  '/api/pm/finance/summary': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.getFinancialSummary(query.projectId);
    },
  },

  // ----- الموارد -----
  '/api/pm/resources': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.listResources(query.projectId, { resourceType: query.resourceType });
    },
    POST: async (body) => PM.assignResource(body),
  },
  '/api/pm/resources/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المورد (id) مطلوب');
      const { id, ...rest } = body;
      return PM.updateResource(id, rest);
    },
  },

  // ----- المخاطر -----
  '/api/pm/risks': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.listRisks(query.projectId, { level: query.level, status: query.status });
    },
    POST: async (body) => PM.addRisk(body),
  },
  '/api/pm/risks/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف الخطر (id) مطلوب');
      const { id, ...rest } = body;
      return PM.updateRisk(id, rest);
    },
  },

  // ----- الجودة -----
  '/api/pm/quality': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.listQualityRecords(query.projectId);
    },
    POST: async (body) => PM.addQualityRecord(body),
  },

  // ----- السلامة -----
  '/api/pm/safety': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.listSafetyRecords(query.projectId);
    },
    POST: async (body) => PM.addSafetyRecord(body),
  },

  // ----- المستندات -----
  '/api/pm/documents': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.listDocuments(query.projectId, { docType: query.docType, q: query.q });
    },
    POST: async (body) => PM.addDocument(body),
  },
  '/api/pm/documents/new-version': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المستند (id) مطلوب');
      return PM.updateDocumentVersion(body.id, { url: body.url, uploaded_by: body.uploaded_by });
    },
  },

  // ----- الاجتماعات -----
  '/api/pm/meetings': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.listMeetings(query.projectId);
    },
    POST: async (body) => PM.createMeeting(body),
  },

  // ----- الإشعارات -----
  '/api/pm/notifications': {
    GET: async (_body, query) => PM.listNotifications(query?.projectId || null, { unreadOnly: query?.unreadOnly === 'true' }),
  },
  '/api/pm/notifications/read': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف الإشعار (id) مطلوب');
      return PM.markNotificationRead(body.id);
    },
  },

  // ----- سجل التدقيق -----
  '/api/pm/audit-log': {
    GET: async (_body, query) => PM.getAuditLog(query?.projectId || null, { limit: query?.limit ? Number(query.limit) : 200 }),
  },

  // ----- التكامل مع بقية الأقسام -----
  '/api/pm/integration/snapshot': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.getIntegrationSnapshot(query.projectId);
    },
  },

  // ----- التقارير -----
  '/api/pm/reports/daily': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.buildDailyReport(query.projectId, query.date || null);
    },
  },
  '/api/pm/reports/executive': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.buildExecutiveReport(query.projectId);
    },
  },
  '/api/pm/reports/export/pdf': {
    POST: async (body) => {
      if (!body.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      const report = body.reportType === 'daily' ? PM.buildDailyReport(body.projectId, body.date) : PM.buildExecutiveReport(body.projectId);
      const project = PM.getProject(body.projectId, { includeRelations: false });
      const result = PM.exportReportToPDF(report, { title: body.title || 'Project Management Report', projectName: project.name });
      return { success: true, ...result };
    },
  },
  '/api/pm/reports/export/excel': {
    POST: async (body) => {
      if (!body.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      const report = body.reportType === 'daily' ? PM.buildDailyReport(body.projectId, body.date) : PM.buildExecutiveReport(body.projectId);
      const result = PM.exportReportToExcel(report, { title: body.title || 'PM Report' });
      return { success: true, ...result };
    },
  },
  '/api/pm/reports/export/csv': {
    POST: async (body) => {
      if (!body.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      const report = body.reportType === 'daily' ? PM.buildDailyReport(body.projectId, body.date) : PM.buildExecutiveReport(body.projectId);
      const result = PM.exportReportToCSV(report);
      return { success: true, ...result };
    },
  },

  // ----- الذكاء الاصطناعي -----
  '/api/pm/ai/analyze-project': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.aiAnalyzeProject(query.projectId);
    },
    POST: async (body) => {
      if (!body.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return PM.aiAnalyzeProject(body.projectId);
    },
  },
  '/api/pm/ai/summarize-meeting': {
    POST: async (body) => {
      if (!body.meetingId) throw new Error('معرّف الاجتماع (meetingId) مطلوب');
      return PM.aiSummarizeMeeting(body.meetingId);
    },
  },
  '/api/pm/ai/ask': {
    POST: async (body) => {
      if (!body.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      if (!body.question) throw new Error('يجب إرسال question');
      return PM.aiAnswerProjectQuestion(body.projectId, body.question);
    },
  },

  // ================================================================
  // القسم الخامس - نظام الجدول الزمني الاحترافي (Scheduling System)
  // ================================================================

  // ----- لوحة المعلومات -----
  '/api/schedule/dashboard': {
    GET: async (_body, query) => SCH.getDashboard(query?.projectId || null),
  },

  // ----- الجداول الزمنية (CRUD) -----
  '/api/schedule/schedules': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return SCH.listSchedules(query.projectId);
    },
    POST: async (body) => SCH.createSchedule(body),
  },
  '/api/schedule/schedules/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف الجدول (id) مطلوب');
      return SCH.getSchedule(query.id);
    },
  },
  '/api/schedule/schedules/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف الجدول (id) مطلوب');
      const { id, ...rest } = body;
      return SCH.updateSchedule(id, rest);
    },
  },
  '/api/schedule/schedules/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف الجدول (id) مطلوب');
      return SCH.deleteSchedule(body.id);
    },
  },

  // ----- الأنشطة / هيكل تقسيم العمل (WBS) -----
  '/api/schedule/activities': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.listActivities(query.scheduleId, { status: query.status, assignee: query.assignee, wbsLevel: query.wbsLevel, parentId: query.parentId });
    },
    POST: async (body) => SCH.createActivity(body),
  },
  '/api/schedule/activities/tree': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.buildWbsTree(query.scheduleId);
    },
  },
  '/api/schedule/activities/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف النشاط (id) مطلوب');
      return SCH.getActivity(query.id);
    },
  },
  '/api/schedule/activities/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف النشاط (id) مطلوب');
      const { id, ...rest } = body;
      return SCH.updateActivity(id, rest);
    },
  },
  '/api/schedule/activities/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف النشاط (id) مطلوب');
      return SCH.deleteActivity(body.id);
    },
  },
  '/api/schedule/activities/reorder': {
    POST: async (body) => {
      if (!body.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.reorderActivities(body.scheduleId, body.orderedIds || []);
    },
  },

  // ----- العلاقات بين الأنشطة -----
  '/api/schedule/relations': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.listRelations(query.scheduleId);
    },
    POST: async (body) => SCH.createRelation(body),
  },
  '/api/schedule/relations/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف العلاقة (id) مطلوب');
      const { id, ...rest } = body;
      return SCH.updateRelation(id, rest);
    },
  },
  '/api/schedule/relations/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف العلاقة (id) مطلوب');
      return SCH.deleteRelation(body.id);
    },
  },

  // ----- المسار الحرج (CPM) -----
  '/api/schedule/cpm': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.computeCPM(query.scheduleId);
    },
  },
  '/api/schedule/recalculate': {
    POST: async (body) => {
      if (!body.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.recalculateSchedule(body.scheduleId);
    },
  },

  // ----- إعادة الجدولة والإصدارات (Baselines) -----
  '/api/schedule/baselines': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.listBaselines(query.scheduleId);
    },
    POST: async (body) => {
      if (!body.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.saveBaseline(body.scheduleId, { name: body.name, note: body.note });
    },
  },
  '/api/schedule/reschedule': {
    POST: async (body) => {
      if (!body.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.rescheduleActivities(body.scheduleId, {
        shiftDays: Number(body.shiftDays) || 0,
        fromDate: body.fromDate || null,
        activityIds: body.activityIds || null,
      });
    },
  },

  // ----- متابعة التنفيذ (المخطط مقابل الفعلي) -----
  '/api/schedule/comparison': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.compareScheduleVsActual(query.scheduleId);
    },
  },

  // ----- الموارد -----
  '/api/schedule/resources': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.listResourceAssignments(query.scheduleId, { resourceType: query.resourceType, activityId: query.activityId });
    },
    POST: async (body) => SCH.assignResourceToActivity(body),
  },
  '/api/schedule/resources/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف تخصيص المورد (id) مطلوب');
      const { id, ...rest } = body;
      return SCH.updateResourceAssignment(id, rest);
    },
  },
  '/api/schedule/resources/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف تخصيص المورد (id) مطلوب');
      return SCH.deleteResourceAssignment(body.id);
    },
  },
  '/api/schedule/resources/histogram': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.computeResourceHistogram(query.scheduleId);
    },
  },

  // ----- منحنى S-Curve / Burndown -----
  '/api/schedule/scurve': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.computeSCurve(query.scheduleId);
    },
  },

  // ----- التقويمات -----
  '/api/schedule/calendars': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return SCH.listCalendars(query.projectId);
    },
    POST: async (body) => SCH.createCalendar(body),
  },
  '/api/schedule/calendars/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف التقويم (id) مطلوب');
      const { id, ...rest } = body;
      return SCH.updateCalendar(id, rest);
    },
  },

  // ----- الإشعارات -----
  '/api/schedule/notifications': {
    GET: async (_body, query) => SCH.listNotifications(query?.projectId || null, { unreadOnly: query?.unreadOnly === 'true' }),
  },
  '/api/schedule/notifications/read': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف الإشعار (id) مطلوب');
      return SCH.markNotificationRead(body.id);
    },
  },
  '/api/schedule/notifications/scan': {
    POST: async (body) => {
      if (!body.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.scanAndPushAutomaticNotifications(body.scheduleId);
    },
  },

  // ----- سجل التدقيق -----
  '/api/schedule/audit-log': {
    GET: async (_body, query) => SCH.getAuditLog(query?.projectId || null, { limit: query?.limit ? Number(query.limit) : 200 }),
  },

  // ----- التكامل مع بقية الأقسام -----
  '/api/schedule/integration/snapshot': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return SCH.getIntegrationSnapshot(query.projectId);
    },
  },

  // ----- التقارير -----
  '/api/schedule/reports/schedule': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.buildScheduleReport(query.scheduleId);
    },
  },
  '/api/schedule/reports/progress': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.buildProgressReport(query.scheduleId);
    },
  },
  '/api/schedule/reports/delay': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.buildDelayReport(query.scheduleId);
    },
  },
  '/api/schedule/reports/critical-path': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.buildCriticalPathReport(query.scheduleId);
    },
  },
  '/api/schedule/reports/resources': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.buildResourceReport(query.scheduleId);
    },
  },
  '/api/schedule/reports/executive': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.buildExecutiveReport(query.scheduleId);
    },
  },
  '/api/schedule/reports/export/pdf': {
    POST: async (body) => {
      if (!body.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      const reportBuilders = {
        schedule: SCH.buildScheduleReport, progress: SCH.buildProgressReport, delay: SCH.buildDelayReport,
        critical_path: SCH.buildCriticalPathReport, resources: SCH.buildResourceReport, executive: SCH.buildExecutiveReport,
      };
      const builder = reportBuilders[body.reportType] || SCH.buildExecutiveReport;
      const report = builder(body.scheduleId);
      const schedule = SCH.getSchedule(body.scheduleId);
      const result = SCH.exportReportToPDF(report, { title: body.title || 'Schedule Report', projectName: schedule.name });
      return { success: true, ...result };
    },
  },
  '/api/schedule/reports/export/excel': {
    POST: async (body) => {
      if (!body.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      const reportBuilders = {
        schedule: SCH.buildScheduleReport, progress: SCH.buildProgressReport, delay: SCH.buildDelayReport,
        critical_path: SCH.buildCriticalPathReport, resources: SCH.buildResourceReport, executive: SCH.buildExecutiveReport,
      };
      const builder = reportBuilders[body.reportType] || SCH.buildExecutiveReport;
      const report = builder(body.scheduleId);
      const result = SCH.exportReportToExcel(report, { title: body.title || 'Schedule Report' });
      return { success: true, ...result };
    },
  },
  '/api/schedule/reports/export/csv': {
    POST: async (body) => {
      if (!body.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      const reportBuilders = {
        schedule: SCH.buildScheduleReport, progress: SCH.buildProgressReport, delay: SCH.buildDelayReport,
        critical_path: SCH.buildCriticalPathReport, resources: SCH.buildResourceReport, executive: SCH.buildExecutiveReport,
      };
      const builder = reportBuilders[body.reportType] || SCH.buildExecutiveReport;
      const report = builder(body.scheduleId);
      const result = SCH.exportReportToCSV(report);
      return { success: true, ...result };
    },
  },

  // ----- الذكاء الاصطناعي -----
  '/api/schedule/ai/analyze': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.aiAnalyzeSchedule(query.scheduleId);
    },
    POST: async (body) => {
      if (!body.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.aiAnalyzeSchedule(body.scheduleId);
    },
  },
  '/api/schedule/ai/suggest-reschedule': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.aiSuggestRescheduling(query.scheduleId);
    },
  },
  '/api/schedule/ai/optimize-resources': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.aiOptimizeResourceDistribution(query.scheduleId);
    },
  },
  '/api/schedule/ai/predict-finish': {
    GET: async (_body, query) => {
      if (!query?.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      return SCH.aiPredictFinishDate(query.scheduleId);
    },
  },
  '/api/schedule/ai/ask': {
    POST: async (body) => {
      if (!body.scheduleId) throw new Error('معرّف الجدول (scheduleId) مطلوب');
      if (!body.question) throw new Error('يجب إرسال question');
      return SCH.aiAnswerScheduleQuestion(body.scheduleId, body.question);
    },
  },

  // ===================================================================
  // القسم السادس - إدارة الأعمال - الجزء الأول: العملاء (CRM) والموردون
  // ===================================================================
  '/api/biz/clients/dashboard': {
    GET: async () => BIZ.getClientsDashboard(),
  },
  '/api/biz/clients': {
    GET: async (_body, query) => BIZ.listClients({
      status: query?.status || null,
      type: query?.type || null,
      q: query?.q || null,
      sortBy: query?.sortBy || 'created_at',
      sortDir: query?.sortDir || 'desc',
      page: query?.page ? Number(query.page) : 1,
      pageSize: query?.pageSize ? Number(query.pageSize) : 50,
    }),
    POST: async (body) => BIZ.createClient(body),
  },
  '/api/biz/clients/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف العميل (id) مطلوب');
      return BIZ.getClient(query.id);
    },
  },
  '/api/biz/clients/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف العميل (id) مطلوب');
      const { id, ...rest } = body;
      return BIZ.updateClient(id, rest);
    },
  },
  '/api/biz/clients/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف العميل (id) مطلوب');
      return BIZ.deleteClient(body.id);
    },
  },
  '/api/biz/clients/meetings': {
    POST: async (body) => {
      if (!body.clientId) throw new Error('معرّف العميل (clientId) مطلوب');
      return BIZ.addClientMeeting(body.clientId, body);
    },
  },
  '/api/biz/clients/communications': {
    POST: async (body) => {
      if (!body.clientId) throw new Error('معرّف العميل (clientId) مطلوب');
      return BIZ.addClientCommunication(body.clientId, body);
    },
  },
  '/api/biz/clients/notes': {
    POST: async (body) => {
      if (!body.clientId) throw new Error('معرّف العميل (clientId) مطلوب');
      return BIZ.addClientNote(body.clientId, body);
    },
  },
  '/api/biz/clients/attachments': {
    POST: async (body) => {
      if (!body.clientId) throw new Error('معرّف العميل (clientId) مطلوب');
      return BIZ.addClientAttachment(body.clientId, body);
    },
  },
  '/api/biz/clients/activity-log': {
    GET: async (_body, query) => {
      if (!query?.clientId) throw new Error('معرّف العميل (clientId) مطلوب');
      return BIZ.getClientActivityLog(query.clientId);
    },
  },

  '/api/biz/suppliers/dashboard': {
    GET: async () => BIZ.getSuppliersDashboard(),
  },
  '/api/biz/suppliers': {
    GET: async (_body, query) => BIZ.listSuppliers({
      category: query?.category || null,
      q: query?.q || null,
      sortBy: query?.sortBy || 'created_at',
      sortDir: query?.sortDir || 'desc',
      page: query?.page ? Number(query.page) : 1,
      pageSize: query?.pageSize ? Number(query.pageSize) : 50,
    }),
    POST: async (body) => BIZ.createSupplier(body),
  },
  '/api/biz/suppliers/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف المورد (id) مطلوب');
      return BIZ.getSupplier(query.id);
    },
  },
  '/api/biz/suppliers/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المورد (id) مطلوب');
      const { id, ...rest } = body;
      return BIZ.updateSupplier(id, rest);
    },
  },
  '/api/biz/suppliers/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المورد (id) مطلوب');
      return BIZ.deleteSupplier(body.id);
    },
  },
  '/api/biz/suppliers/products': {
    POST: async (body) => {
      if (!body.supplierId) throw new Error('معرّف المورد (supplierId) مطلوب');
      return BIZ.addSupplierProduct(body.supplierId, body);
    },
  },
  '/api/biz/suppliers/products/price': {
    POST: async (body) => {
      if (!body.supplierId || !body.productId) throw new Error('معرّف المورد (supplierId) ومعرّف المنتج (productId) مطلوبان');
      return BIZ.updateSupplierProductPrice(body.supplierId, body.productId, body.price);
    },
  },
  '/api/biz/suppliers/payments': {
    POST: async (body) => {
      if (!body.supplierId) throw new Error('معرّف المورد (supplierId) مطلوب');
      return BIZ.addSupplierPayment(body.supplierId, body);
    },
  },
  '/api/biz/suppliers/deliveries': {
    POST: async (body) => {
      if (!body.supplierId) throw new Error('معرّف المورد (supplierId) مطلوب');
      return BIZ.addSupplierDelivery(body.supplierId, body);
    },
  },
  '/api/biz/suppliers/quality-score': {
    POST: async (body) => {
      if (!body.supplierId) throw new Error('معرّف المورد (supplierId) مطلوب');
      return BIZ.setSupplierQualityScore(body.supplierId, body.score);
    },
  },
  '/api/biz/suppliers/activity-log': {
    GET: async (_body, query) => {
      if (!query?.supplierId) throw new Error('معرّف المورد (supplierId) مطلوب');
      return BIZ.getSupplierActivityLog(query.supplierId);
    },
  },

  '/api/biz/audit-log': {
    GET: async (_body, query) => BIZ.getAuditLog({
      module: query?.module || null,
      page: query?.page ? Number(query.page) : 1,
      pageSize: query?.pageSize ? Number(query.pageSize) : 100,
    }),
  },

  // ===================================================================
  // القسم السادس - إدارة الأعمال - الجزء الثاني: العقود + الفواتير + المشتريات
  // ===================================================================

  // ----- العقود -----
  '/api/biz/contracts/dashboard': {
    GET: async () => BIZC.getContractsDashboard(),
  },
  '/api/biz/contracts': {
    GET: async (_body, query) => BIZC.listContracts({
      status: query?.status || null,
      party_type: query?.party_type || null,
      party_id: query?.party_id || null,
      project_id: query?.project_id || null,
      q: query?.q || null,
      page: query?.page ? Number(query.page) : 1,
      pageSize: query?.pageSize ? Number(query.pageSize) : 50,
    }),
    POST: async (body) => BIZC.createContract(body),
  },
  '/api/biz/contracts/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف العقد (id) مطلوب');
      return BIZC.getContract(query.id);
    },
  },
  '/api/biz/contracts/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف العقد (id) مطلوب');
      const { id, ...rest } = body;
      return BIZC.updateContract(id, rest);
    },
  },
  '/api/biz/contracts/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف العقد (id) مطلوب');
      return BIZC.deleteContract(body.id);
    },
  },
  '/api/biz/contracts/attachments': {
    POST: async (body) => {
      if (!body.contractId) throw new Error('معرّف العقد (contractId) مطلوب');
      return BIZC.addContractAttachment(body.contractId, body);
    },
  },

  // ----- الفواتير -----
  '/api/biz/invoices/dashboard': {
    GET: async () => BIZC.getInvoicesDashboard(),
  },
  '/api/biz/invoices': {
    GET: async (_body, query) => BIZC.listInvoices({
      type: query?.type || null,
      party_id: query?.party_id || null,
      payment_status: query?.payment_status || null,
      contract_id: query?.contract_id || null,
      page: query?.page ? Number(query.page) : 1,
      pageSize: query?.pageSize ? Number(query.pageSize) : 50,
    }),
    POST: async (body) => BIZC.createInvoice(body),
  },
  '/api/biz/invoices/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف الفاتورة (id) مطلوب');
      return BIZC.getInvoice(query.id);
    },
  },
  '/api/biz/invoices/payments': {
    POST: async (body) => {
      if (!body.invoiceId) throw new Error('معرّف الفاتورة (invoiceId) مطلوب');
      return BIZC.recordInvoicePayment(body.invoiceId, body);
    },
  },
  '/api/biz/invoices/pdf': {
    POST: async (body) => {
      if (!body.invoiceId) throw new Error('معرّف الفاتورة (invoiceId) مطلوب');
      return BIZC.generateInvoicePDF(body.invoiceId);
    },
  },

  // ----- المشتريات: طلبات الشراء -----
  '/api/biz/purchasing/dashboard': {
    GET: async () => BIZC.getPurchasingDashboard(),
  },
  '/api/biz/purchasing/requests': {
    GET: async (_body, query) => BIZC.listPurchaseRequests({ status: query?.status || null, project_id: query?.project_id || null }),
    POST: async (body) => BIZC.createPurchaseRequest(body),
  },
  '/api/biz/purchasing/requests/decide': {
    POST: async (body) => {
      if (!body.requestId) throw new Error('معرّف طلب الشراء (requestId) مطلوب');
      return BIZC.decidePurchaseRequest(body.requestId, body);
    },
  },
  '/api/biz/purchasing/requests/compare-quotes': {
    GET: async (_body, query) => {
      if (!query?.requestId) throw new Error('معرّف طلب الشراء (requestId) مطلوب');
      return BIZC.compareQuotesForRequest(query.requestId);
    },
  },

  // ----- المشتريات: أوامر الشراء -----
  '/api/biz/purchasing/orders': {
    GET: async (_body, query) => BIZC.listPurchaseOrders({
      status: query?.status || null,
      supplier_id: query?.supplier_id || null,
      project_id: query?.project_id || null,
    }),
    POST: async (body) => BIZC.createPurchaseOrder(body),
  },
  '/api/biz/purchasing/orders/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف أمر الشراء (id) مطلوب');
      return BIZC.getPurchaseOrder(query.id);
    },
  },
  '/api/biz/purchasing/orders/receive': {
    POST: async (body) => {
      if (!body.poId) throw new Error('معرّف أمر الشراء (poId) مطلوب');
      return BIZC.receivePurchaseOrder(body.poId, body);
    },
  },

  // ===================================================================
  // القسم السادس - إدارة الأعمال - الجزء الثالث: المخازن + الموارد
  // البشرية + الاجتماعات + المهام + المراسلات + الأصول
  // ===================================================================

  // ----- المخازن -----
  '/api/biz/warehouse/dashboard': { GET: async () => BIZO.getWarehouseDashboard() },
  '/api/biz/warehouse/items': {
    GET: async (_body, query) => BIZO.listStockItems({
      category: query?.category || null, q: query?.q || null,
      lowStockOnly: query?.lowStockOnly === 'true', page: query?.page, pageSize: query?.pageSize,
    }),
    POST: async (body) => BIZO.addStockItem(body),
  },
  '/api/biz/warehouse/items/get': {
    GET: async (_body, query) => { if (!query?.id) throw new Error('معرّف الصنف (id) مطلوب'); return BIZO.getStockItem(query.id); },
  },
  '/api/biz/warehouse/items/update': {
    POST: async (body) => { const { id, ...rest } = body; if (!id) throw new Error('معرّف الصنف (id) مطلوب'); return BIZO.updateStockItem(id, rest); },
  },
  '/api/biz/warehouse/items/delete': {
    POST: async (body) => BIZO.deleteStockItem(body.id),
  },
  '/api/biz/warehouse/movements': {
    POST: async (body) => {
      if (!body.itemId) throw new Error('معرّف الصنف (itemId) مطلوب');
      return BIZO.recordMovement(body.itemId, body);
    },
  },
  '/api/biz/warehouse/receive-po': {
    POST: async (body) => {
      if (!body.poId) throw new Error('معرّف أمر الشراء (poId) مطلوب');
      return BIZO.receiveStockFromPurchaseOrder(body.poId, body.lines || []);
    },
  },

  // ----- الموارد البشرية -----
  '/api/biz/hr/dashboard': { GET: async () => BIZO.getHrDashboard() },
  '/api/biz/hr/employees': {
    GET: async (_body, query) => BIZO.listEmployees({
      status: query?.status || null, department: query?.department || null, q: query?.q || null,
      page: query?.page, pageSize: query?.pageSize,
    }),
    POST: async (body) => BIZO.createEmployee(body),
  },
  '/api/biz/hr/employees/get': {
    GET: async (_body, query) => { if (!query?.id) throw new Error('معرّف الموظف (id) مطلوب'); return BIZO.getEmployee(query.id); },
  },
  '/api/biz/hr/employees/update': {
    POST: async (body) => { const { id, ...rest } = body; if (!id) throw new Error('معرّف الموظف (id) مطلوب'); return BIZO.updateEmployee(id, rest); },
  },
  '/api/biz/hr/employees/delete': {
    POST: async (body) => BIZO.deleteEmployee(body.id),
  },
  '/api/biz/hr/attendance/clock-in': {
    POST: async (body) => { if (!body.employeeId) throw new Error('معرّف الموظف (employeeId) مطلوب'); return BIZO.clockIn(body.employeeId, body); },
  },
  '/api/biz/hr/attendance/clock-out': {
    POST: async (body) => { if (!body.employeeId) throw new Error('معرّف الموظف (employeeId) مطلوب'); return BIZO.clockOut(body.employeeId, body); },
  },
  '/api/biz/hr/leaves/request': {
    POST: async (body) => { if (!body.employeeId) throw new Error('معرّف الموظف (employeeId) مطلوب'); return BIZO.requestLeave(body.employeeId, body); },
  },
  '/api/biz/hr/leaves/decide': {
    POST: async (body) => {
      if (!body.employeeId || !body.leaveId) throw new Error('employeeId و leaveId مطلوبان');
      return BIZO.decideLeave(body.employeeId, body.leaveId, body);
    },
  },
  '/api/biz/hr/allowances': {
    POST: async (body) => { if (!body.employeeId) throw new Error('معرّف الموظف (employeeId) مطلوب'); return BIZO.addAllowance(body.employeeId, body); },
  },
  '/api/biz/hr/bonuses': {
    POST: async (body) => { if (!body.employeeId) throw new Error('معرّف الموظف (employeeId) مطلوب'); return BIZO.addBonus(body.employeeId, body); },
  },
  '/api/biz/hr/deductions': {
    POST: async (body) => { if (!body.employeeId) throw new Error('معرّف الموظف (employeeId) مطلوب'); return BIZO.addDeduction(body.employeeId, body); },
  },
  '/api/biz/hr/advances': {
    POST: async (body) => { if (!body.employeeId) throw new Error('معرّف الموظف (employeeId) مطلوب'); return BIZO.addAdvance(body.employeeId, body); },
  },
  '/api/biz/hr/annual-reviews': {
    POST: async (body) => { if (!body.employeeId) throw new Error('معرّف الموظف (employeeId) مطلوب'); return BIZO.addAnnualReview(body.employeeId, body); },
  },
  '/api/biz/hr/trainings': {
    POST: async (body) => { if (!body.employeeId) throw new Error('معرّف الموظف (employeeId) مطلوب'); return BIZO.addTraining(body.employeeId, body); },
  },
  '/api/biz/hr/documents': {
    POST: async (body) => { if (!body.employeeId) throw new Error('معرّف الموظف (employeeId) مطلوب'); return BIZO.addEmployeeDocument(body.employeeId, body); },
  },
  '/api/biz/hr/payroll/compute': {
    POST: async (body) => { if (!body.employeeId) throw new Error('معرّف الموظف (employeeId) مطلوب'); return BIZO.computePayroll(body.employeeId, body); },
  },

  // ----- الاجتماعات -----
  '/api/biz/meetings': {
    GET: async (_body, query) => BIZO.listMeetings({
      project_id: query?.project_id || null, status: query?.status || null, page: query?.page, pageSize: query?.pageSize,
    }),
    POST: async (body) => BIZO.createMeeting(body),
  },
  '/api/biz/meetings/get': {
    GET: async (_body, query) => { if (!query?.id) throw new Error('معرّف الاجتماع (id) مطلوب'); return BIZO.getMeeting(query.id); },
  },
  '/api/biz/meetings/attendance': {
    POST: async (body) => { if (!body.meetingId) throw new Error('معرّف الاجتماع (meetingId) مطلوب'); return BIZO.recordAttendance(body.meetingId, body); },
  },
  '/api/biz/meetings/minutes': {
    POST: async (body) => { if (!body.meetingId) throw new Error('معرّف الاجتماع (meetingId) مطلوب'); return BIZO.recordMinutes(body.meetingId, body); },
  },
  '/api/biz/meetings/decisions': {
    POST: async (body) => { if (!body.meetingId) throw new Error('معرّف الاجتماع (meetingId) مطلوب'); return BIZO.addDecision(body.meetingId, body); },
  },
  '/api/biz/meetings/attachments': {
    POST: async (body) => { if (!body.meetingId) throw new Error('معرّف الاجتماع (meetingId) مطلوب'); return BIZO.addMeetingAttachment(body.meetingId, body); },
  },

  // ----- المهام -----
  '/api/biz/tasks/dashboard': { GET: async () => BIZO.getTasksDashboard() },
  '/api/biz/tasks': {
    GET: async (_body, query) => BIZO.listTasks({
      project_id: query?.project_id || null, assignee_id: query?.assignee_id || null,
      status: query?.status || null, priority: query?.priority || null, page: query?.page, pageSize: query?.pageSize,
    }),
    POST: async (body) => BIZO.createTask(body),
  },
  '/api/biz/tasks/get': {
    GET: async (_body, query) => { if (!query?.id) throw new Error('معرّف المهمة (id) مطلوب'); return BIZO.getTask(query.id); },
  },
  '/api/biz/tasks/update': {
    POST: async (body) => { const { id, ...rest } = body; if (!id) throw new Error('معرّف المهمة (id) مطلوب'); return BIZO.updateTask(id, rest); },
  },
  '/api/biz/tasks/delete': {
    POST: async (body) => BIZO.deleteTask(body.id),
  },
  '/api/biz/tasks/comments': {
    POST: async (body) => { if (!body.taskId) throw new Error('معرّف المهمة (taskId) مطلوب'); return BIZO.addTaskComment(body.taskId, body); },
  },
  '/api/biz/tasks/attachments': {
    POST: async (body) => { if (!body.taskId) throw new Error('معرّف المهمة (taskId) مطلوب'); return BIZO.addTaskAttachment(body.taskId, body); },
  },

  // ----- المراسلات -----
  '/api/biz/correspondence': {
    GET: async (_body, query) => BIZO.listCorrespondence({
      type: query?.type || null, archived: query?.archived, q: query?.q || null, page: query?.page, pageSize: query?.pageSize,
    }),
    POST: async (body) => BIZO.createCorrespondence(body),
  },
  '/api/biz/correspondence/archive': {
    POST: async (body) => { if (!body.id) throw new Error('معرّف المراسلة (id) مطلوب'); return BIZO.archiveCorrespondence(body.id, body); },
  },
  '/api/biz/correspondence/read': {
    POST: async (body) => { if (!body.id) throw new Error('معرّف المراسلة (id) مطلوب'); return BIZO.markCorrespondenceRead(body.id, body); },
  },

  // ----- الأصول -----
  '/api/biz/assets/dashboard': { GET: async () => BIZO.getAssetsDashboard() },
  '/api/biz/assets': {
    GET: async (_body, query) => BIZO.listAssets({
      category: query?.category || null, status: query?.status || null, q: query?.q || null, page: query?.page, pageSize: query?.pageSize,
    }),
    POST: async (body) => BIZO.createAsset(body),
  },
  '/api/biz/assets/get': {
    GET: async (_body, query) => { if (!query?.id) throw new Error('معرّف الأصل (id) مطلوب'); return BIZO.getAsset(query.id); },
  },
  '/api/biz/assets/update': {
    POST: async (body) => { const { id, ...rest } = body; if (!id) throw new Error('معرّف الأصل (id) مطلوب'); return BIZO.updateAsset(id, rest); },
  },
  '/api/biz/assets/delete': {
    POST: async (body) => BIZO.deleteAsset(body.id),
  },
  '/api/biz/assets/maintenance': {
    POST: async (body) => { if (!body.assetId) throw new Error('معرّف الأصل (assetId) مطلوب'); return BIZO.addMaintenanceRecord(body.assetId, body); },
  },

  // ===================================================================
  // ===== الجزء الرابع (4/4) - الوحدة الأولى: الصلاحيات والأمان ======
  // ===================================================================

  '/api/biz/security/login': {
    POST: async (body, _query, req) => SEC.login({ ...body, ip: req?.socket?.remoteAddress || null }),
  },
  '/api/biz/security/logout': {
    POST: async (_body, _query, req) => SEC.logout(getAuthToken(req)),
  },
  '/api/biz/security/me': {
    GET: async (_body, _query, req) => {
      const token = getAuthToken(req);
      const session = SEC.getSessionUser(token);
      if (!session) throw new Error('الجلسة غير صالحة أو منتهية');
      return { success: true, data: session };
    },
  },

  '/api/biz/security/roles': {
    GET: async () => SEC.listRoles(),
    POST: async (body, _query, req) => { requirePermission(req, 'security', 'manage'); return SEC.upsertRole(body.key, body); },
  },
  '/api/biz/security/roles/delete': {
    POST: async (body, _query, req) => { requirePermission(req, 'security', 'manage'); return SEC.deleteRole(body.key); },
  },

  '/api/biz/security/users': {
    GET: async (_body, _query, req) => { requirePermission(req, 'security', 'view'); return SEC.listUsers(); },
    POST: async (body, _query, req) => { requirePermission(req, 'security', 'manage'); return SEC.createUser(body); },
  },
  '/api/biz/security/users/get': {
    GET: async (_body, query, req) => { requirePermission(req, 'security', 'view'); if (!query?.id) throw new Error('معرّف المستخدم (id) مطلوب'); return SEC.getUserSafe(query.id); },
  },
  '/api/biz/security/users/update': {
    POST: async (body, _query, req) => { requirePermission(req, 'security', 'manage'); const { id, ...rest } = body; if (!id) throw new Error('معرّف المستخدم (id) مطلوب'); return SEC.updateUser(id, rest); },
  },
  '/api/biz/security/users/delete': {
    POST: async (body, _query, req) => { requirePermission(req, 'security', 'manage'); return SEC.deleteUser(body.id); },
  },

  '/api/biz/security/2fa/start': {
    POST: async (body) => { if (!body.userId) throw new Error('معرّف المستخدم (userId) مطلوب'); return SEC.start2FAEnrollment(body.userId); },
  },
  '/api/biz/security/2fa/confirm': {
    POST: async (body) => { if (!body.userId || !body.code) throw new Error('userId وcode مطلوبان'); return SEC.confirm2FAEnrollment(body.userId, body.code); },
  },
  '/api/biz/security/2fa/disable': {
    POST: async (body) => { if (!body.userId) throw new Error('معرّف المستخدم (userId) مطلوب'); return SEC.disable2FA(body.userId); },
  },

  '/api/biz/security/audit-log': {
    GET: async (_body, query, req) => {
      requirePermission(req, 'security', 'view');
      return SEC.getGlobalAuditLog({
        module: query?.module || null, userId: query?.userId || null, action: query?.action || null,
        from: query?.from || null, to: query?.to || null, page: query?.page, pageSize: query?.pageSize,
      });
    },
  },

  '/api/biz/security/backup': {
    GET: async (_body, _query, req) => { requirePermission(req, 'security', 'manage'); return SEC.listBackups(); },
    POST: async (body, _query, req) => { requirePermission(req, 'security', 'manage'); return SEC.createBackup(body || {}); },
  },
  '/api/biz/security/backup/restore': {
    POST: async (body, _query, req) => { requirePermission(req, 'security', 'manage'); if (!body.fileName) throw new Error('اسم ملف النسخة الاحتياطية (fileName) مطلوب'); return SEC.restoreBackup(body.fileName); },
  },

  // ===================================================================
  // ============ الجزء الرابع (4/4) - الوحدة الثانية: الجودة =========
  // ===================================================================

  '/api/biz/quality/dashboard': { GET: async () => GOV.getQualityDashboard() },
  '/api/biz/quality/plans': {
    GET: async (_body, query) => GOV.listQualityPlans({ project_id: query?.project_id || null }),
    POST: async (body) => GOV.createQualityPlan(body),
  },
  '/api/biz/quality/audits': {
    GET: async (_body, query) => GOV.listQualityAudits({ project_id: query?.project_id || null, result: query?.result || null }),
    POST: async (body) => GOV.createQualityAudit(body),
  },
  '/api/biz/quality/audits/approve': {
    POST: async (body) => { if (!body.auditId) throw new Error('معرّف الفحص (auditId) مطلوب'); return GOV.approveQualityAudit(body.auditId, body); },
  },

  // ===================================================================
  // ============ الجزء الرابع (4/4) - الوحدة الثانية: السلامة ========
  // ===================================================================

  '/api/biz/safety/dashboard': { GET: async () => GOV.getSafetyDashboard() },
  '/api/biz/safety/incidents': {
    GET: async (_body, query) => GOV.listSafetyIncidents({ project_id: query?.project_id || null, severity: query?.severity || null, status: query?.status || null }),
    POST: async (body) => GOV.createSafetyIncident(body),
  },
  '/api/biz/safety/incidents/close': {
    POST: async (body) => { if (!body.id) throw new Error('معرّف الحادثة (id) مطلوب'); return GOV.closeSafetyIncident(body.id, body); },
  },
  '/api/biz/safety/risks': {
    GET: async (_body, query) => GOV.listSafetyRisks({ project_id: query?.project_id || null }),
    POST: async (body) => GOV.createSafetyRisk(body),
  },
  '/api/biz/safety/inspections': {
    GET: async (_body, query) => GOV.listSafetyInspections({ project_id: query?.project_id || null, type: query?.type || null }),
    POST: async (body) => GOV.createSafetyInspection(body),
  },

  // ===================================================================
  // ============ الجزء الرابع (4/4) - الوحدة الثانية: الوثائق ========
  // ===================================================================

  '/api/biz/documents': {
    GET: async (_body, query) => GOV.listDocuments({
      entity_type: query?.entity_type || null, entity_id: query?.entity_id || null,
      type: query?.type || null, code: query?.code || null,
      latestOnly: query?.latestOnly !== 'false',
    }),
    POST: async (body) => GOV.uploadDocument(body),
  },
  '/api/biz/documents/versions': {
    GET: async (_body, query) => { if (!query?.code) throw new Error('رمز الوثيقة (code) مطلوب'); return GOV.getDocumentVersionHistory(query.code); },
  },
  '/api/biz/documents/delete': {
    POST: async (body) => GOV.deleteDocument(body.id),
  },

  // ===================================================================
  // ======== الجزء الرابع (4/4) - الوحدة الثانية: التقارير والتصدير ==
  // ===================================================================

  '/api/biz/reports/list': { GET: async () => GOV.listAvailableReports() },
  '/api/biz/reports/export': {
    GET: async (_body, query) => {
      if (!query?.report) throw new Error('نوع التقرير (report) مطلوب');
      return GOV.exportReport(query.report, { format: query.format || 'pdf' });
    },
    POST: async (body) => {
      if (!body.report) throw new Error('نوع التقرير (report) مطلوب');
      return GOV.exportReport(body.report, { format: body.format || 'pdf' });
    },
  },

  // ===================================================================
  // ======== الجزء الرابع (4/4) - الوحدة الثانية: التكامل الموحّد ====
  // ===================================================================

  '/api/biz/integration/snapshot': { GET: async () => ({ success: true, data: GOV.integrationSnapshot() }) },
  '/api/biz/dashboard/executive': { GET: async () => GOV.getExecutiveDashboard() },

  // ===================================================================
  // ===== الجزء الرابع (4/4) - الوحدة الثانية: الذكاء الاصطناعي ======
  // ===================================================================

  '/api/biz/ai/status': { GET: async () => ({ success: true, data: { available: GOV.isAIAvailable() } }) },
  '/api/biz/ai/financial-analysis': { GET: async () => ({ success: true, data: await GOV.analyzeFinancialPerformance() }) },
  '/api/biz/ai/abnormal-expenses': { GET: async () => ({ success: true, data: await GOV.detectAbnormalExpenses() }) },
  '/api/biz/ai/employee-performance': { GET: async () => ({ success: true, data: await GOV.analyzeEmployeePerformance() }) },
  '/api/biz/ai/supplier-performance': { GET: async () => ({ success: true, data: await GOV.analyzeSupplierPerformance() }) },
  '/api/biz/ai/process-improvements': { GET: async () => ({ success: true, data: await GOV.suggestProcessImprovements() }) },
  '/api/biz/ai/cash-flow-forecast': {
    GET: async (_body, query) => ({ success: true, data: await GOV.forecastCashFlow({ months: Number(query?.months) || 3 }) }),
  },
  '/api/biz/ai/summarize-meeting': {
    POST: async (body) => { if (!body.meetingId) throw new Error('معرّف الاجتماع (meetingId) مطلوب'); return { success: true, data: await GOV.summarizeMeetingMinutes(body.meetingId) }; },
  },
  '/api/biz/ai/ask': {
    POST: async (body) => { if (!body.question) throw new Error('السؤال (question) مطلوب'); return { success: true, data: await GOV.answerManagementQuestion(body.question) }; },
  },

  // ===================================================================
  // ===== القسم السابع (الجزء 1/4) - إدارة المعدات: البيانات الأساسية،
  // ===== إدارة التشغيل، إدارة الحجز، تتبع المعدات
  // ===================================================================

  '/api/equipment/reference-data': {
    GET: async () => ({
      success: true,
      data: {
        categories: EQ.EQUIPMENT_CATEGORIES,
        type_labels: EQ.EQUIPMENT_TYPE_LABELS,
        statuses: EQ.EQUIPMENT_STATUSES,
        status_labels: EQ.EQUIPMENT_STATUS_LABELS,
        ownership_types: EQ.OWNERSHIP_TYPES,
        fuel_types: EQ.FUEL_TYPES,
      },
    }),
  },
  '/api/equipment/dashboard': {
    GET: async (_body, query) => EQ.getBasicDashboard(query?.projectId || null),
  },

  // ----- سجل المعدات (CRUD) -----
  '/api/equipment/items': {
    GET: async (_body, query) => EQ.listEquipment({
      category: query?.category, type: query?.type, status: query?.status,
      projectId: query?.projectId, ownership: query?.ownership, search: query?.search,
    }),
    POST: async (body) => EQ.createEquipment(body),
  },
  '/api/equipment/items/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف المعدة (id) مطلوب');
      return EQ.getEquipment(query.id);
    },
  },
  '/api/equipment/items/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المعدة (id) مطلوب');
      const { id, ...rest } = body;
      return EQ.updateEquipment(id, rest);
    },
  },
  '/api/equipment/items/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المعدة (id) مطلوب');
      return EQ.deleteEquipment(body.id);
    },
  },

  // ----- إدارة التشغيل -----
  '/api/equipment/operations/start': {
    POST: async (body) => EQ.startOperation(body),
  },
  '/api/equipment/operations/end': {
    POST: async (body) => EQ.endOperation(body),
  },
  '/api/equipment/operations': {
    GET: async (_body, query) => EQ.listOperations({
      equipmentId: query?.equipmentId, projectId: query?.projectId,
      openOnly: query?.openOnly, dateFrom: query?.dateFrom, dateTo: query?.dateTo,
    }),
  },
  '/api/equipment/operations/stats': {
    GET: async (_body, query) => {
      if (!query?.equipmentId) throw new Error('معرّف المعدة (equipmentId) مطلوب');
      return EQ.getOperationStats(query.equipmentId, { period: query.period || 'all' });
    },
  },

  // ----- إدارة الحجز -----
  '/api/equipment/reservations': {
    GET: async (_body, query) => EQ.listReservations({
      equipmentId: query?.equipmentId, projectId: query?.projectId, status: query?.status,
    }),
    POST: async (body) => EQ.createReservation(body),
  },
  '/api/equipment/reservations/cancel': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف الحجز (id) مطلوب');
      return EQ.cancelReservation(body.id);
    },
  },
  '/api/equipment/reservations/calendar': {
    GET: async (_body, query) => {
      if (!query?.equipmentId) throw new Error('معرّف المعدة (equipmentId) مطلوب');
      return EQ.getReservationCalendar(query.equipmentId);
    },
  },

  // ----- تتبع المعدات -----
  '/api/equipment/tracking/movement': {
    POST: async (body) => EQ.logMovement(body),
  },
  '/api/equipment/tracking/history': {
    GET: async (_body, query) => {
      if (!query?.equipmentId) throw new Error('معرّف المعدة (equipmentId) مطلوب');
      return EQ.getEquipmentTrackingHistory(query.equipmentId);
    },
  },

  // ===================================================================
  // ===== القسم السابع (الجزء 2/4) - إدارة المعدات: الوقود، الصيانة
  // ===== (الدورية والطارئة)، قطع الغيار، إدارة المشغلين
  // ===================================================================

  '/api/equipment/reference-data-p2': {
    GET: async () => ({
      success: true,
      data: {
        maintenance_frequencies: EQ.MAINTENANCE_FREQUENCIES,
        maintenance_frequency_labels: EQ.MAINTENANCE_FREQUENCY_LABELS,
        maintenance_types: EQ.MAINTENANCE_TYPES,
        maintenance_type_labels: EQ.MAINTENANCE_TYPE_LABELS,
        maintenance_severities: EQ.MAINTENANCE_SEVERITIES,
        maintenance_severity_labels: EQ.MAINTENANCE_SEVERITY_LABELS,
        maintenance_statuses: EQ.MAINTENANCE_STATUSES,
        maintenance_status_labels: EQ.MAINTENANCE_STATUS_LABELS,
        license_types: EQ.LICENSE_TYPES,
        license_type_labels: EQ.LICENSE_TYPE_LABELS,
      },
    }),
  },

  // ----- إدارة الوقود -----
  '/api/equipment/fuel/log': {
    POST: async (body) => EQ.logFuelEntry(body),
  },
  '/api/equipment/fuel/logs': {
    GET: async (_body, query) => EQ.listFuelLogs({
      equipmentId: query?.equipmentId, projectId: query?.projectId,
      dateFrom: query?.dateFrom, dateTo: query?.dateTo,
    }),
  },
  '/api/equipment/fuel/stats': {
    GET: async (_body, query) => {
      if (!query?.equipmentId) throw new Error('معرّف المعدة (equipmentId) مطلوب');
      return EQ.getFuelStats(query.equipmentId, { period: query.period || 'all' });
    },
  },

  // ----- إدارة الصيانة: الجدولة الدورية -----
  '/api/equipment/maintenance/schedules': {
    GET: async (_body, query) => EQ.listMaintenanceSchedules({ equipmentId: query?.equipmentId }),
    POST: async (body) => EQ.createMaintenanceSchedule(body),
  },
  '/api/equipment/maintenance/schedules/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف جدول الصيانة (id) مطلوب');
      const { id, ...rest } = body;
      return EQ.updateMaintenanceSchedule(id, rest);
    },
  },
  '/api/equipment/maintenance/schedules/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف جدول الصيانة (id) مطلوب');
      return EQ.deleteMaintenanceSchedule(body.id);
    },
  },
  '/api/equipment/maintenance/alerts': {
    GET: async (_body, query) => EQ.getUpcomingMaintenanceAlerts({ withinDays: query?.withinDays || 14 }),
  },

  // ----- إدارة الصيانة: السجلات (دورية منفذة / طارئة) -----
  '/api/equipment/maintenance/records': {
    GET: async (_body, query) => EQ.listMaintenanceRecords({
      equipmentId: query?.equipmentId, projectId: query?.projectId,
      maintenanceType: query?.maintenanceType, status: query?.status,
    }),
    POST: async (body) => EQ.createMaintenanceRecord(body),
  },
  '/api/equipment/maintenance/records/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف سجل الصيانة (id) مطلوب');
      const { id, ...rest } = body;
      return EQ.updateMaintenanceRecord(id, rest);
    },
  },
  '/api/equipment/maintenance/stats': {
    GET: async (_body, query) => {
      if (!query?.equipmentId) throw new Error('معرّف المعدة (equipmentId) مطلوب');
      return EQ.getMaintenanceStats(query.equipmentId);
    },
  },

  // ----- إدارة قطع الغيار -----
  '/api/equipment/spare-parts': {
    GET: async (_body, query) => EQ.listSpareParts({
      equipmentType: query?.equipmentType, lowStockOnly: query?.lowStockOnly, search: query?.search,
    }),
    POST: async (body) => EQ.createSparePart(body),
  },
  '/api/equipment/spare-parts/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف قطعة الغيار (id) مطلوب');
      const { id, ...rest } = body;
      return EQ.updateSparePart(id, rest);
    },
  },
  '/api/equipment/spare-parts/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف قطعة الغيار (id) مطلوب');
      return EQ.deleteSparePart(body.id);
    },
  },
  '/api/equipment/spare-parts/restock': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف قطعة الغيار (id) مطلوب');
      return EQ.restockSparePart(body.id, body.quantity);
    },
  },
  '/api/equipment/spare-parts/low-stock': {
    GET: async () => EQ.getLowStockParts(),
  },

  // ----- إدارة المشغلين -----
  '/api/equipment/operators': {
    GET: async (_body, query) => EQ.listOperators({
      equipmentType: query?.equipmentType, licenseExpiringWithinDays: query?.licenseExpiringWithinDays, search: query?.search,
    }),
    POST: async (body) => EQ.createOperator(body),
  },
  '/api/equipment/operators/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف المشغل (id) مطلوب');
      return EQ.getOperator(query.id);
    },
  },
  '/api/equipment/operators/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المشغل (id) مطلوب');
      const { id, ...rest } = body;
      return EQ.updateOperator(id, rest);
    },
  },
  '/api/equipment/operators/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المشغل (id) مطلوب');
      return EQ.deleteOperator(body.id);
    },
  },
  '/api/equipment/operators/violations/add': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المشغل (id) مطلوب');
      const { id, ...rest } = body;
      return EQ.addOperatorViolation(id, rest);
    },
  },
  '/api/equipment/operators/rate': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المشغل (id) مطلوب');
      return EQ.rateOperatorPerformance(body.id, body.rating);
    },
  },
  '/api/equipment/operators/license-alerts': {
    GET: async (_body, query) => EQ.getOperatorLicenseAlerts({ withinDays: query?.withinDays || 30 }),
  },

  // ----- الجزء الثالث (3/4) من القسم السابع: التكاليف + الإنتاجية + التنبيهات -----
  '/api/equipment/costs/breakdown': {
    GET: async (_body, query) => {
      if (!query?.equipmentId) throw new Error('معرّف المعدة (equipmentId) مطلوب');
      return EQ.getEquipmentCostBreakdown(query.equipmentId, { dateFrom: query.dateFrom || null, dateTo: query.dateTo || null });
    },
  },
  '/api/equipment/costs/fleet-summary': {
    GET: async (_body, query) => EQ.getFleetCostSummary({
      projectId: query?.projectId || null, dateFrom: query?.dateFrom || null, dateTo: query?.dateTo || null,
    }),
  },
  '/api/equipment/costs/transport/log': {
    POST: async (body) => EQ.logTransportCost(body),
  },

  '/api/equipment/productivity': {
    GET: async (_body, query) => {
      if (!query?.equipmentId) throw new Error('معرّف المعدة (equipmentId) مطلوب');
      return EQ.getEquipmentProductivity(query.equipmentId, { dateFrom: query.dateFrom || null, dateTo: query.dateTo || null });
    },
  },
  '/api/equipment/productivity/compare': {
    GET: async (_body, query) => EQ.compareEquipmentProductivity({
      type: query?.type || null, category: query?.category || null,
      dateFrom: query?.dateFrom || null, dateTo: query?.dateTo || null,
    }),
  },

  '/api/equipment/alerts/center': {
    GET: async (_body, query) => EQ.getAlertsCenter({
      withinDays: query?.withinDays ? Number(query.withinDays) : 14,
      fuelLowThresholdPercent: query?.fuelLowThresholdPercent ? Number(query.fuelLowThresholdPercent) : 15,
    }),
  },

  // ===================================================================
  // القسم السابع - إدارة المعدات - الجزء الرابع (4-أ من 4-ب): التقارير
  // ===================================================================

  '/api/equipment/reports/fleet-register': {
    GET: async (_body, query) => ({ success: true, data: EQR.buildFleetRegisterReport({
      category: query?.category || null, type: query?.type || null,
      status: query?.status || null, projectId: query?.projectId || null,
    }) }),
  },
  '/api/equipment/reports/operations': {
    GET: async (_body, query) => ({ success: true, data: EQR.buildOperationsReport({
      equipmentId: query?.equipmentId || null, projectId: query?.projectId || null,
      dateFrom: query?.dateFrom || null, dateTo: query?.dateTo || null,
    }) }),
  },
  '/api/equipment/reports/maintenance': {
    GET: async (_body, query) => ({ success: true, data: EQR.buildMaintenanceReport({
      equipmentId: query?.equipmentId || null, projectId: query?.projectId || null,
      maintenanceType: query?.maintenanceType || null, status: query?.status || null,
      dateFrom: query?.dateFrom || null, dateTo: query?.dateTo || null,
    }) }),
  },
  '/api/equipment/reports/fuel': {
    GET: async (_body, query) => ({ success: true, data: EQR.buildFuelReport({
      equipmentId: query?.equipmentId || null, projectId: query?.projectId || null,
      dateFrom: query?.dateFrom || null, dateTo: query?.dateTo || null,
    }) }),
  },
  '/api/equipment/reports/faults': {
    GET: async (_body, query) => ({ success: true, data: EQR.buildFaultsReport({
      equipmentId: query?.equipmentId || null, projectId: query?.projectId || null,
      severity: query?.severity || null, dateFrom: query?.dateFrom || null, dateTo: query?.dateTo || null,
    }) }),
  },
  '/api/equipment/reports/productivity': {
    GET: async (_body, query) => ({ success: true, data: EQR.buildProductivityReport({
      type: query?.type || null, category: query?.category || null,
      dateFrom: query?.dateFrom || null, dateTo: query?.dateTo || null,
    }) }),
  },
  '/api/equipment/reports/costs': {
    GET: async (_body, query) => ({ success: true, data: EQR.buildCostsReport({
      projectId: query?.projectId || null, dateFrom: query?.dateFrom || null, dateTo: query?.dateTo || null,
    }) }),
  },
  '/api/equipment/reports/depreciation': {
    GET: async (_body, query) => ({ success: true, data: EQR.buildDepreciationReport({
      category: query?.category || null, type: query?.type || null,
    }) }),
  },
  '/api/equipment/reports/usage-by-project': {
    GET: async (_body, query) => {
      if (!query?.projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
      return { success: true, data: EQR.buildUsageByProjectReport({
        projectId: query.projectId, dateFrom: query?.dateFrom || null, dateTo: query?.dateTo || null,
      }) };
    },
  },
  '/api/equipment/reports/executive-summary': {
    GET: async (_body, query) => ({ success: true, data: EQR.buildExecutiveSummaryReport({
      projectId: query?.projectId || null, dateFrom: query?.dateFrom || null, dateTo: query?.dateTo || null,
    }) }),
  },

  // ----- تصدير تقارير المعدات (PDF / Excel / CSV / طباعة) -----
  // كل مسار يستقبل: { reportType, ...filters, meta: { projectName } } ويبني التقرير من جديد ثم يصدّره
  '/api/equipment/reports/export/pdf': {
    POST: async (body) => {
      const report = buildEquipmentReportFromRequest(body);
      const result = EQR.exportReportToPDF(report, body.meta || {});
      return { success: true, ...result };
    },
  },
  '/api/equipment/reports/export/excel': {
    POST: async (body) => {
      const report = buildEquipmentReportFromRequest(body);
      const result = EQR.exportReportToExcel(report);
      return { success: true, ...result };
    },
  },
  '/api/equipment/reports/export/csv': {
    POST: async (body) => {
      const report = buildEquipmentReportFromRequest(body);
      const result = EQR.exportReportToCSV(report);
      return { success: true, ...result };
    },
  },
  '/api/equipment/reports/export/print': {
    POST: async (body) => {
      const report = buildEquipmentReportFromRequest(body);
      const result = EQR.exportReportToPrintableHTML(report, body.meta || {});
      return { success: true, ...result };
    },
  },

  // ===================== الجزء الرابع (4-ب): الذكاء الاصطناعي =====================
  '/api/equipment/ai/status': {
    GET: async () => ({ success: true, data: { available: EQI.isAIAvailable() } }),
  },
  '/api/equipment/ai/predict-failures': {
    GET: async (_body, query, req) => {
      requirePermission(req, 'ai', 'use');
      if (!query?.equipmentId) throw new Error('معرّف المعدة (equipmentId) مطلوب');
      return EQI.predictEquipmentFailures(query.equipmentId);
    },
  },
  '/api/equipment/ai/predict-fleet-risk': {
    GET: async (_body, query, req) => {
      requirePermission(req, 'ai', 'use');
      return EQI.predictFleetFailureRisk({ projectId: query?.projectId || null });
    },
  },
  '/api/equipment/ai/fuel-analysis': {
    GET: async (_body, query, req) => {
      requirePermission(req, 'ai', 'use');
      if (!query?.equipmentId) throw new Error('معرّف المعدة (equipmentId) مطلوب');
      return EQI.analyzeFuelConsumptionPatterns(query.equipmentId);
    },
  },
  '/api/equipment/ai/suggest-maintenance-schedule': {
    GET: async (_body, query, req) => {
      requirePermission(req, 'ai', 'use');
      if (!query?.equipmentId) throw new Error('معرّف المعدة (equipmentId) مطلوب');
      return EQI.suggestPreventiveMaintenanceSchedule(query.equipmentId);
    },
  },
  '/api/equipment/ai/efficiency-vs-peers': {
    GET: async (_body, query, req) => {
      requirePermission(req, 'ai', 'use');
      if (!query?.equipmentId) throw new Error('معرّف المعدة (equipmentId) مطلوب');
      return EQI.analyzeEquipmentEfficiencyVsPeers(query.equipmentId);
    },
  },
  '/api/equipment/ai/suggest-allocation': {
    GET: async (_body, _query, req) => {
      requirePermission(req, 'ai', 'use');
      return EQI.suggestFleetAllocation();
    },
  },
  '/api/equipment/ai/estimate-future-cost': {
    GET: async (_body, query, req) => {
      requirePermission(req, 'ai', 'use');
      if (!query?.equipmentId) throw new Error('معرّف المعدة (equipmentId) مطلوب');
      return EQI.estimateFutureOperatingCost(query.equipmentId, { horizonMonths: query.horizonMonths ? Number(query.horizonMonths) : 3 });
    },
  },
  '/api/equipment/ai/proactive-alerts': {
    GET: async (_body, query, req) => {
      requirePermission(req, 'ai', 'use');
      return EQI.generateProactiveEfficiencyAlerts({ efficiencyThresholdPercent: query?.threshold ? Number(query.threshold) : 60 });
    },
  },
  '/api/equipment/ai/fleet-summary': {
    GET: async (_body, query, req) => {
      requirePermission(req, 'ai', 'use');
      return EQI.generateFleetAnalyticalSummary({ projectId: query?.projectId || null });
    },
  },
  '/api/equipment/ai/ask': {
    POST: async (body, _query, req) => {
      requirePermission(req, 'ai', 'use');
      return EQI.askEquipmentAssistant(body.question, { equipmentId: body.equipmentId || null, projectId: body.projectId || null });
    },
  },

  // ===================== الجزء الرابع (4-ب): التكامل =====================
  '/api/equipment/integration/snapshot': {
    GET: async (_body, query) => ({ success: true, data: EQI.equipmentIntegrationSnapshot({ projectId: query?.projectId || null }) }),
  },
  '/api/equipment/maintenance/critical-fault': {
    POST: async (body, _query, req) => {
      requirePermission(req, 'equipment', 'maintenance');
      return EQI.logCriticalFaultWithIntegration(body);
    },
  },

  // ===================== الجزء الرابع (4-ب): الصلاحيات المتقدمة =====================
  '/api/equipment/roles/seed': {
    POST: async (_body, _query, req) => {
      requirePermission(req, 'security', 'manage');
      return EQI.ensureEquipmentRolesSeeded();
    },
  },

  // ===================================================================
  // ===== القسم الثامن (الجزء 1/4) - إدارة السلامة المهنية (HSE):
  // ===== البنية الأساسية، لوحة التحكم، خطط السلامة، إدارة المخاطر،
  // ===== إدارة الحوادث والإصابات
  // ===================================================================

  '/api/hse/reference-data': {
    GET: async () => ({
      success: true,
      data: {
        safety_plan_types: HSE.SAFETY_PLAN_TYPES,
        safety_plan_type_labels: HSE.SAFETY_PLAN_TYPE_LABELS,
        safety_plan_statuses: HSE.SAFETY_PLAN_STATUSES,
        safety_plan_status_labels: HSE.SAFETY_PLAN_STATUS_LABELS,
        risk_categories: HSE.RISK_CATEGORIES,
        risk_category_labels: HSE.RISK_CATEGORY_LABELS,
        likelihood_levels: HSE.LIKELIHOOD_LEVELS,
        severity_levels: HSE.SEVERITY_LEVELS,
        risk_statuses: HSE.RISK_STATUSES,
        risk_status_labels: HSE.RISK_STATUS_LABELS,
        control_hierarchy: HSE.CONTROL_HIERARCHY,
        control_hierarchy_labels: HSE.CONTROL_HIERARCHY_LABELS,
        control_action_statuses: HSE.CONTROL_ACTION_STATUSES,
        control_action_status_labels: HSE.CONTROL_ACTION_STATUS_LABELS,
        incident_types: HSE.INCIDENT_TYPES,
        incident_type_labels: HSE.INCIDENT_TYPE_LABELS,
        injury_severities: HSE.INJURY_SEVERITIES,
        injury_severity_labels: HSE.INJURY_SEVERITY_LABELS,
        injury_types: HSE.INJURY_TYPES,
        injury_type_labels: HSE.INJURY_TYPE_LABELS,
        incident_statuses: HSE.INCIDENT_STATUSES,
        incident_status_labels: HSE.INCIDENT_STATUS_LABELS,

        inspection_types: HSE.INSPECTION_TYPES,
        inspection_type_labels: HSE.INSPECTION_TYPE_LABELS,
        inspection_statuses: HSE.INSPECTION_STATUSES,
        inspection_status_labels: HSE.INSPECTION_STATUS_LABELS,
        checklist_item_results: HSE.CHECKLIST_ITEM_RESULTS,
        checklist_item_result_labels: HSE.CHECKLIST_ITEM_RESULT_LABELS,
        finding_severities: HSE.FINDING_SEVERITIES,
        finding_severity_labels: HSE.FINDING_SEVERITY_LABELS,
        finding_statuses: HSE.FINDING_STATUSES,
        finding_status_labels: HSE.FINDING_STATUS_LABELS,

        permit_types: HSE.PERMIT_TYPES,
        permit_type_labels: HSE.PERMIT_TYPE_LABELS,
        permit_statuses: HSE.PERMIT_STATUSES,
        permit_status_labels: HSE.PERMIT_STATUS_LABELS,
        permit_standard_precautions: HSE.PERMIT_STANDARD_PRECAUTIONS,

        ppe_types: HSE.PPE_TYPES,
        ppe_type_labels: HSE.PPE_TYPE_LABELS,
        ppe_conditions: HSE.PPE_CONDITIONS,
        ppe_condition_labels: HSE.PPE_CONDITION_LABELS,
        ppe_item_statuses: HSE.PPE_ITEM_STATUSES,
        ppe_item_status_labels: HSE.PPE_ITEM_STATUS_LABELS,
      },
    }),
  },

  '/api/hse/dashboard': {
    GET: async (_body, query) => HSE.getDashboard(query?.projectId || null),
  },

  '/api/hse/safety-plans': {
    GET: async (_body, query) => HSE.listSafetyPlans({
      projectId: query?.projectId, type: query?.type, status: query?.status, search: query?.search,
    }),
    POST: async (body) => HSE.createSafetyPlan(body),
  },
  '/api/hse/safety-plans/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف الخطة (id) مطلوب');
      return HSE.getSafetyPlan(query.id);
    },
  },
  '/api/hse/safety-plans/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف الخطة (id) مطلوب');
      const { id, ...rest } = body;
      return HSE.updateSafetyPlan(id, rest);
    },
  },
  '/api/hse/safety-plans/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف الخطة (id) مطلوب');
      return HSE.deleteSafetyPlan(body.id);
    },
  },
  '/api/hse/safety-plans/approve': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف الخطة (id) مطلوب');
      return HSE.approveSafetyPlan(body.id, { approved_by: body.approved_by || null });
    },
  },

  '/api/hse/risks': {
    GET: async (_body, query) => HSE.listRisks({
      projectId: query?.projectId, category: query?.category, level: query?.level,
      status: query?.status, search: query?.search,
    }),
    POST: async (body) => HSE.createRisk(body),
  },
  '/api/hse/risks/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف الخطر (id) مطلوب');
      return HSE.getRisk(query.id);
    },
  },
  '/api/hse/risks/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف الخطر (id) مطلوب');
      const { id, ...rest } = body;
      return HSE.updateRisk(id, rest);
    },
  },
  '/api/hse/risks/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف الخطر (id) مطلوب');
      return HSE.deleteRisk(body.id);
    },
  },
  '/api/hse/risks/matrix': {
    GET: async (_body, query) => HSE.getRiskMatrix(query?.projectId || null),
  },
  '/api/hse/risks/control-actions': {
    GET: async (_body, query) => HSE.listRiskControlActions({
      riskId: query?.riskId, projectId: query?.projectId, status: query?.status, responsiblePerson: query?.responsiblePerson,
    }),
    POST: async (body) => HSE.addRiskControlAction(body),
  },
  '/api/hse/risks/control-actions/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف الإجراء (id) مطلوب');
      const { id, ...rest } = body;
      return HSE.updateRiskControlAction(id, rest);
    },
  },

  '/api/hse/incidents': {
    GET: async (_body, query) => HSE.listIncidents({
      projectId: query?.projectId, type: query?.type, severity: query?.severity, status: query?.status,
      dateFrom: query?.dateFrom, dateTo: query?.dateTo, search: query?.search,
    }),
    POST: async (body) => HSE.createIncident(body),
  },
  '/api/hse/incidents/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف الحادث (id) مطلوب');
      return HSE.getIncident(query.id);
    },
  },
  '/api/hse/incidents/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف الحادث (id) مطلوب');
      const { id, ...rest } = body;
      return HSE.updateIncident(id, rest);
    },
  },
  '/api/hse/incidents/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف الحادث (id) مطلوب');
      return HSE.deleteIncident(body.id);
    },
  },
  '/api/hse/incidents/kpis': {
    GET: async (_body, query) => HSE.calculateSafetyKPIs({
      projectId: query?.projectId || null,
      totalManHours: query?.totalManHours ? Number(query.totalManHours) : null,
      periodFrom: query?.periodFrom || null,
      periodTo: query?.periodTo || null,
    }),
  },

  // ===================================================================
  // ===== القسم الثامن (الجزء 2/4) - إدارة السلامة المهنية (HSE):
  // ===== إدارة التفتيشات، تصاريح العمل (Permit to Work)، معدات
  // ===== الوقاية الشخصية (PPE)
  // ===================================================================

  '/api/hse/inspections': {
    GET: async (_body, query) => HSE.listInspections({
      projectId: query?.projectId, type: query?.type, status: query?.status,
      dateFrom: query?.dateFrom, dateTo: query?.dateTo, search: query?.search,
    }),
    POST: async (body) => HSE.createInspection(body),
  },
  '/api/hse/inspections/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف جولة التفتيش (id) مطلوب');
      return HSE.getInspection(query.id);
    },
  },
  '/api/hse/inspections/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف جولة التفتيش (id) مطلوب');
      const { id, ...rest } = body;
      return HSE.updateInspection(id, rest);
    },
  },
  '/api/hse/inspections/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف جولة التفتيش (id) مطلوب');
      return HSE.deleteInspection(body.id);
    },
  },
  '/api/hse/inspections/approve': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف جولة التفتيش (id) مطلوب');
      return HSE.approveInspection(body.id, { approved_by: body.approved_by || null });
    },
  },

  '/api/hse/inspections/findings': {
    GET: async (_body, query) => HSE.listInspectionFindings({
      inspectionId: query?.inspectionId, projectId: query?.projectId, status: query?.status, severity: query?.severity,
    }),
    POST: async (body) => HSE.addInspectionFinding(body),
  },
  '/api/hse/inspections/findings/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف المخالفة (id) مطلوب');
      const { id, ...rest } = body;
      return HSE.updateInspectionFinding(id, rest);
    },
  },

  '/api/hse/permits': {
    GET: async (_body, query) => HSE.listPermits({
      projectId: query?.projectId, type: query?.type, status: query?.status, search: query?.search,
    }),
    POST: async (body) => HSE.createPermit(body),
  },
  '/api/hse/permits/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف التصريح (id) مطلوب');
      return HSE.getPermit(query.id);
    },
  },
  '/api/hse/permits/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف التصريح (id) مطلوب');
      const { id, ...rest } = body;
      return HSE.updatePermit(id, rest);
    },
  },
  '/api/hse/permits/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف التصريح (id) مطلوب');
      return HSE.deletePermit(body.id);
    },
  },
  '/api/hse/permits/approve': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف التصريح (id) مطلوب');
      return HSE.approvePermit(body.id, { approver_name: body.approver_name, approver_role: body.approver_role || null, notes: body.notes || null });
    },
  },
  '/api/hse/permits/activate': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف التصريح (id) مطلوب');
      return HSE.activatePermit(body.id);
    },
  },
  '/api/hse/permits/close': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف التصريح (id) مطلوب');
      return HSE.closePermit(body.id, { closed_by: body.closed_by || null, closing_notes: body.closing_notes || null });
    },
  },
  '/api/hse/permits/expiring': {
    GET: async (_body, query) => HSE.getExpiringPermits({
      projectId: query?.projectId || null, withinDays: query?.withinDays ? Number(query.withinDays) : 3,
    }),
  },

  '/api/hse/ppe': {
    GET: async (_body, query) => HSE.listPpeItems({
      projectId: query?.projectId, type: query?.type, status: query?.status,
      employeeName: query?.employeeName, search: query?.search,
    }),
    POST: async (body) => HSE.createPpeItem(body),
  },
  '/api/hse/ppe/get': {
    GET: async (_body, query) => {
      if (!query?.id) throw new Error('معرّف سجل معدة الوقاية (id) مطلوب');
      return HSE.getPpeItem(query.id);
    },
  },
  '/api/hse/ppe/update': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف سجل معدة الوقاية (id) مطلوب');
      const { id, ...rest } = body;
      return HSE.updatePpeItem(id, rest);
    },
  },
  '/api/hse/ppe/delete': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف سجل معدة الوقاية (id) مطلوب');
      return HSE.deletePpeItem(body.id);
    },
  },
  '/api/hse/ppe/replace': {
    POST: async (body) => {
      if (!body.id) throw new Error('معرّف سجل معدة الوقاية (id) مطلوب');
      return HSE.replacePpeItem(body.id, { condition_note: body.condition_note || null, issue_date: body.issue_date || null });
    },
  },
  '/api/hse/ppe/due-for-replacement': {
    GET: async (_body, query) => HSE.getPpeDueForReplacement({
      projectId: query?.projectId || null, withinDays: query?.withinDays ? Number(query.withinDays) : 14,
    }),
  },
  '/api/hse/ppe/compliance-summary': {
    GET: async (_body, query) => HSE.getPpeComplianceSummary({ projectId: query?.projectId || null }),
  },
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (pathname.startsWith('/api/')) {
    const handlerSet = API_HANDLERS[pathname];
    if (!handlerSet || !handlerSet[req.method]) {
      return sendJSON(res, 404, { success: false, error: 'المسار غير موجود' });
    }
    try {
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const query = Object.fromEntries(parsedUrl.searchParams.entries());
      const result = await handlerSet[req.method](body, query, req);
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, 400, { success: false, error: err.message });
    }
  }

  if (pathname.startsWith('/reports/')) {
    const filePath = path.join(REPORTS_DIR, pathname.replace('/reports/', ''));
    if (!filePath.startsWith(REPORTS_DIR)) {
      res.writeHead(403); res.end('ممنوع'); return;
    }
    return sendFile(res, filePath);
  }

  let staticPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(FRONTEND_DIR, staticPath);
  if (!filePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403); res.end('ممنوع'); return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return sendFile(res, filePath);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('الصفحة غير موجودة');
});

server.listen(PORT, () => {
  console.log(`✅ خادم منصة الهندسة المدنية يعمل على المنفذ ${PORT}`);
  console.log(`📁 مجلد الواجهة الأمامية: ${FRONTEND_DIR} (index.html موجود: ${fs.existsSync(path.join(FRONTEND_DIR, 'index.html'))})`);
  console.log(`   افتح المتصفح على: http://localhost:${PORT}`);

  // الجزء الرابع (4/4) من القسم السادس: تهيئة مدير نظام افتراضي عند أول تشغيل + جدولة نسخ احتياطي تلقائي
  try {
    SEC.ensureDefaultAdmin();
    SEC.scheduleAutoBackup({ intervalHours: 24 });
  } catch (e) {
    console.error('⚠️  تعذّرت تهيئة وحدة الأمان (المستخدم الافتراضي/النسخ الاحتياطي التلقائي):', e.message);
  }

  // الجزء الرابع (4-ب) من القسم السابع: زرع أدوار قسم المعدات عند أول تشغيل
  // (احتياطي: الأدوار أصلاً ضمن DEFAULT_ROLES في businessSecurity.js؛ هذا يضمن
  // زرعها أيضاً في تنصيبات سابقة تملك ملف أدوار محفوظ لا يحتوي عليها بعد)
  try {
    EQI.ensureEquipmentRolesSeeded();
  } catch (e) {
    console.error('⚠️  تعذّرت تهيئة أدوار قسم إدارة المعدات:', e.message);
  }
});
