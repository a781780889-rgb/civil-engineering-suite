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
      const result = await handlerSet[req.method](body, query);
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
});
