/* =======================================================
   Sigma Gloves — IndustryIndexer v3.0 (Very Large, Extensible)
   - Broad Persian + English keyword coverage (~90+ industry groups)
   - Keyword → industry index for fast matching
   - Methods: bestMatch(text, opts), addIndustry(obj), loadFromJSON(url)
   - Drop-in: include as <script src="assets/industry_indexer.js"></script>
   ======================================================= */

(function () {
    // ---------- Normalizer ----------
    function normalizeText(s) {
        if (s === null || s === undefined) return '';
        s = String(s);
        s = s.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/أ|إ|آ/g, 'ا').replace(/ۀ/g, 'ه').replace(/ة/g, 'ه');
        s = s.toLowerCase();
        // keep persian/arabic letters, latin a-z, numbers, spaces
        s = s.replace(/[^\u0600-\u06FFa-z0-9\s\-\/]/gi, ' ');
        s = s.replace(/[\-\/_]/g, ' ');
        s = s.replace(/\s+/g, ' ').trim();
        return s;
    }
    function tokensOf(s) {
        return normalizeText(s).split(' ').filter(t => t && t.length >= 2);
    }

    // ---------- Base Industry List (very large) ----------
    // Each entry: { code, name_fa, name_en, keywords: [ ... ] }
    const INDUSTRIES = [
        // Metal & machining
        {
            code: "welding", name_fa: "جوشکاری", name_en: "Welding",
            keywords: ["جوشکاری", "جوشکار", "جوش", "weld", "welding", "arc welding", "mig", "tig", "ساخت جوش"]
        },

        {
            code: "machining", name_fa: "تراشکاری/ماشین‌کاری", name_en: "Machining",
            keywords: ["تراشکاری", "تراشکار", "ماشینکاری", "ماشین کار", "lathe", "turning", "milling", "cnc", "cnc operator", "فرزکاری", "فرزکار"]
        },

        {
            code: "grinding", name_fa: "سنگ‌زنی/سنباده‌کاری", name_en: "Grinding / Abrasive work",
            keywords: ["سنگ زنی", "سنگ‌زنی", "سنگ زدن", "سنگ ساب", "sanding", "grinder", "grinding", "abrasive"]
        },

        {
            code: "sheetmetal", name_fa: "ورق‌کاری/فابریکیشن", name_en: "Sheet Metal / Fabrication",
            keywords: ["ورق کاری", "ورق‌کار", "ورقکاری", "sheet metal", "fabrication", "press brake", "برش ورق", "برش لیزر"]
        },

        {
            code: "foundry", name_fa: "ریخته‌گری", name_en: "Foundry / Casting",
            keywords: ["ریخته گری", "ریخته‌گری", "foundry", "casting", "کوره", "ماتریس", "mold", "smelting"]
        },

        {
            code: "blacksmith", name_fa: "آهنگری/فورج", name_en: "Blacksmith / Forging",
            keywords: ["آهنگری", "فورج", "blacksmith", "forge", "smithing", "فلزکاری سنتی"]
        },

        {
            code: "metalfabrication", name_fa: "تولید قطعات فلزی", name_en: "Metal Fabrication",
            keywords: ["فلزکاری", "قطعه سازی", "metal fabrication", "fabricator", "welding fabrication"]
        },

        // Glass / Stone / Ceramic
        {
            code: "glasswork", name_fa: "شیشه‌گری/شیشه‌بری", name_en: "Glasswork / Glazing",
            keywords: ["شیشه گری", "شیشه‌گری", "شیشه بری", "شیشه‌بری", "glazier", "glassworker", "glass cutting", "شیشه کار"]
        },

        {
            code: "stonecut", name_fa: "سنگ‌بری/برش سنگ", name_en: "Stone Cutting / Masonry",
            keywords: ["سنگ بری", "سنگ‌بری", "سنگبری", "stone cutting", "stonemason", "سنگ کار", "marble cutting", "granite"]
        },

        {
            code: "tiler", name_fa: "کاشی‌کاری/سرامیک", name_en: "Tiler / Ceramic",
            keywords: ["کاشی کار", "کاشی‌کاری", "tiler", "tile", "ceramic", "grouting", "سرامیک کار"]
        },

        // Wood / Carpentry / Furniture
        {
            code: "carpentry", name_fa: "نجاری/چوب", name_en: "Carpentry / Woodwork",
            keywords: ["نجار", "نجاری", "چوب کاری", "carpentry", "woodwork", "cabinet maker", "furniture maker"]
        },

        {
            code: "furniture", name_fa: "تولید مبل/چرم و فوم", name_en: "Furniture / Upholstery",
            keywords: ["مبلمان", "upholstery", "foam cutting", "furniture maker", "sofa maker", "دوخت مبلمان"]
        },

        {
            code: "woodworking", name_fa: "پردازش چوب/کارگاه", name_en: "Woodworking / Joinery",
            keywords: ["کارگاه چوب", "joinery", "joiner", "woodworking", "پارکت", "پارکت کار"]
        },

        // Construction / Civil
        {
            code: "construction", name_fa: "ساختمان/عمرانی", name_en: "Construction",
            keywords: ["ساختمان", "بنایی", "عمران", "کارگر ساختمانی", "construction", "builder", "concrete", "اجر کار"]
        },

        {
            code: "concrete", name_fa: "بتن‌ریزی/قالب‌بندی", name_en: "Concrete / Formwork",
            keywords: ["بتن ریزی", "قالب بندی", "concrete", "formwork", "بتن کار"]
        },

        {
            code: "roofer", name_fa: "شیروانی/بام", name_en: "Roofer",
            keywords: ["شیروانی", "roof", "roofer", "roofing", "نصاب سقف"]
        },

        {
            code: "scaffolding", name_fa: "داربست/ایمن‌سازی ارتفاع", name_en: "Scaffolding / Heights",
            keywords: ["داربست", "scaffold", "scaffolder", "ارتفاع", "rope access", "نصاب داربست"]
        },

        {
            code: "plasterer", name_fa: "گچ‌کاری/نقاشی داخلی", name_en: "Plasterer / Interior finishing",
            keywords: ["گچ کار", "گچکاری", "plasterer", "drywall", "تِرِوکس"]
        },

        // Mechanical / Automotive / Heavy equipment
        {
            code: "mechanic", name_fa: "مکانیک/تعمیرات خودرو", name_en: "Mechanic / Automotive",
            keywords: ["مکانیک", "تعمیرکار", "خودرو", "auto mechanic", "garage", "car repair", "مکانیک خودرو"]
        },

        {
            code: "heavy", name_fa: "اپراتور ماشین‌آلات سنگین", name_en: "Heavy Equipment Operator",
            keywords: ["بیل مکانیکی", "لودر", "crane operator", "اپراتور بیل", "excavator", "crane"]
        },

        {
            code: "crane", name_fa: "جرثقیل‌کار/راکینگ", name_en: "Crane / Rigger",
            keywords: ["جرثقیل", "crane", "rigger", "باربرداری", "crane operator", "rigging"]
        },

        {
            code: "forklift", name_fa: "لیفتراک‌دار/انبار", name_en: "Forklift Operator",
            keywords: ["لیفتراک", "forklift", "پالت", "pallet jack", "انباردار", "forklift operator"]
        },

        // Oil & Gas / Energy / Mining
        {
            code: "oilgas", name_fa: "نفت و گاز/پالایش", name_en: "Oil & Gas / Refinery",
            keywords: ["نفت", "گاز", "حفاری", "پالایشگاه", "oilfield", "offshore", "refinery", "rig worker"]
        },

        {
            code: "mining", name_fa: "معدن/استخراج", name_en: "Mining / Quarry",
            keywords: ["معدن", "معدنکاری", "quarry", "mine", "excavation", "mining operator"]
        },

        {
            code: "powerplant", name_fa: "نیروگاه/تصفیه", name_en: "Power Plant / Utilities",
            keywords: ["نیروگاه", "power plant", "turbine", "boiler", "utility", "power station"]
        },

        // Chemical / Process / Laboratory
        {
            code: "chemical", name_fa: "شیمیایی/پالایش/آزمایشگاه", name_en: "Chemical / Laboratory",
            keywords: ["شیمیایی", "اسید", "حلال", "chemical", "lab", "chemist", "process plant", "فرآیند"]
        },

        {
            code: "pharma", name_fa: "داروسازی", name_en: "Pharmaceutical",
            keywords: ["داروسازی", "pharma", "pharmaceutical", "drug manufacturing", "clean room"]
        },

        {
            code: "labtech", name_fa: "تکنسین آزمایشگاه", name_en: "Lab Technician",
            keywords: ["تکنسین آزمایشگاه", "lab tech", "lab technician", "sample analysis"]
        },

        // Food / Agriculture / Animal
        {
            code: "food", name_fa: "صنایع غذایی/آشپزی", name_en: "Food Industry / Kitchen",
            keywords: ["رستوران", "آشپز", "آشپزی", "food processing", "butcher", "کشتارگاه", "chef", "bakery", "نانوایی", "baker"]
        },

        {
            code: "agriculture", name_fa: "کشاورزی/باغبانی", name_en: "Agriculture / Gardening",
            keywords: ["کشاورزی", "باغبانی", "کشاورز", "agriculture", "farmer", "gardener", "tractor", "orchard"]
        },

        {
            code: "poultry", name_fa: "مرغداری/دامداری", name_en: "Poultry / Farming",
            keywords: ["مرغداری", "دامداری", "poultry", "livestock", "farmer", "animal farm"]
        },

        // Textile / Garment / Leather
        {
            code: "textile", name_fa: "نساجی/دوخت/پوشاک", name_en: "Textile / Garment",
            keywords: ["نساجی", "خیاط", "دوخت", "garment", "textile", "sewing", "tailor", "چرم"]
        },

        {
            code: "leather", name_fa: "چرم/کفش", name_en: "Leather / Shoe making",
            keywords: ["چرم", "کفش سازی", "leather", "cobbler", "shoe maker"]
        },

        // Electronics / Electrical / Soldering
        {
            code: "electronics", name_fa: "الکترونیک/مونتاژ برد", name_en: "Electronics Manufacturing",
            keywords: ["الکترونیک", "pcb", "smd", "soldering", "electronics assembly", "assembly line", "solderer", "تراشه"]
        },

        {
            code: "electrical", name_fa: "برق/نصب/تابلو", name_en: "Electrical / Electrician",
            keywords: ["برقکار", "برق", "electrician", "wiring", "switchgear", "تابلو برق", "electrical maintenance"]
        },

        // Printing / Packaging / Logistics
        {
            code: "printing", name_fa: "چاپ/بسته‌بندی", name_en: "Printing / Packaging",
            keywords: ["چاپخانه", "چاپ", "printing press", "packaging", "labels", "palletizing"]
        },

        {
            code: "logistics", name_fa: "لجستیک/حمل و نقل", name_en: "Logistics / Transport",
            keywords: ["لجستیک", "حمل و نقل", "logistics", "courier", "delivery", "driver", "truck driver", "ترانزیت"]
        },

        // Healthcare / Dental / Pharma
        {
            code: "healthcare", name_fa: "درمان/بیمارستان", name_en: "Healthcare / Medical",
            keywords: ["بیمارستان", "پرستار", "دکتر", "clinic", "nurse", "medical", "physician", "surgeon", "healthcare"]
        },

        {
            code: "dental", name_fa: "دندان‌پزشکی", name_en: "Dental",
            keywords: ["دندانپزشک", "دندان پزشکی", "dental", "dentist", "orthodontist", "dental hygienist"]
        },

        // Safety / Inspection / Quality
        {
            code: "safety", name_fa: "ایمنی/HSE/بازرسی", name_en: "Safety / HSE / Inspection",
            keywords: ["ایمنی", "hse", "safety officer", "inspector", "safety inspection", "pallet safety"]
        },

        {
            code: "quality", name_fa: "کنترل کیفیت/QC", name_en: "Quality Control / QC",
            keywords: ["کنترل کیفیت", "qc", "qa", "inspection", "quality control", "تست کیفیت"]
        },

        // Service / Cleaning / Janitorial
        {
            code: "janitorial", name_fa: "نظافت/خدمات", name_en: "Janitorial / Cleaning",
            keywords: ["نظافت", "نظافتچی", "cleaning", "janitor", "maid", "housekeeping", "پاکسازی"]
        },

        {
            code: "grounds", name_fa: "نگهداری فضای سبز/حیاط", name_en: "Groundskeeping / Landscaping",
            keywords: ["فضای سبز", "باغبانی", "landscaping", "gardener", "groundskeeper", "چمن کاری"]
        },

        // Specialized crafts
        {
            code: "jewelry", name_fa: "طلا/جواهرسازی", name_en: "Jewelry / Goldsmith",
            keywords: ["طلا سازی", "جواهرساز", "goldsmith", "bench jeweler", "jewelry making"]
        },

        {
            code: "watchmaking", name_fa: "ساعت‌سازی/ریزکار", name_en: "Watchmaking / Precision",
            keywords: ["ساعت سازی", "ساعت‌ساز", "watchmaker", "precision work", "micromechanics"]
        },

        {
            code: "glassblowing", name_fa: "دمش شیشه/هنری", name_en: "Glassblowing / Studio",
            keywords: ["دمش شیشه", "glassblowing", "blown glass", "studio glass", "glass artist"]
        },

        {
            code: "ceramics", name_fa: "سرامیک/کوزه‌گری", name_en: "Ceramics / Pottery",
            keywords: ["سرامیک", "کوزه گری", "pottery", "ceramicist", "kiln", "clay work"]
        },

        {
            code: "printing_textile", name_fa: "چاپ پارچه/لباس", name_en: "Textile Printing",
            keywords: ["چاپ پارچه", "sublimation", "screen printing", "tshirt printing", "textile print"]
        },

        // Small manufacturing / assembly
        {
            code: "assembly", name_fa: "خط مونتاژ/بسته‌بندی", name_en: "Assembly Line / Packaging",
            keywords: ["مونتاژ", "assembly line", "packaging", "packager", "line worker", "assembly"]
        },

        {
            code: "toy", name_fa: "تولید اسباب‌بازی/کوچک‌سازی", name_en: "Toy / Small Parts Manufacturing",
            keywords: ["اسباب بازی", "toy maker", "small parts", "injection molding", "molding"]
        },

        // Maritime / Shipyard / Offshore
        {
            code: "maritime", name_fa: "دریانوردی/اسکله/کشتی", name_en: "Maritime / Shipyard",
            keywords: ["کشتی", "دریانوردی", "shipyard", "sailor", "deckhand", "marine", "boat maintenance"]
        },

        // Aviation / Airport
        {
            code: "aviation", name_fa: "هوانوردی/فرودگاه", name_en: "Aviation / Aircraft Maintenance",
            keywords: ["هواپیما", "aviation", "aircraft maintenance", "aerospace", "airline", "ground crew"]
        },

        // Retail / Sales / Customer-facing
        {
            code: "retail", name_fa: "فروشگاه/خرده‌فروشی", name_en: "Retail / Sales",
            keywords: ["فروشنده", "فروشگاه", "retail", "cashier", "store clerk", "shop assistant"]
        },

        // Office / IT / Light duty
        {
            code: "office", name_fa: "دفتر/اداری", name_en: "Office / Administrative",
            keywords: ["دفتر", "اداری", "office", "clerk", "administrative", "secretary"]
        },

        {
            code: "it", name_fa: "فناوری اطلاعات/IT", name_en: "IT / Software",
            keywords: ["کامپیوتر", "it", "software developer", "programmer", "devops", "network admin"]
        },

        // Entertainment / Event / Photography
        {
            code: "photography", name_fa: "عکاسی/استودیو", name_en: "Photography / Studio",
            keywords: ["عکاس", "عکاسی", "photographer", "photo studio", "camera"]
        },

        {
            code: "event", name_fa: "رویداد/اجرا", name_en: "Event / Stage",
            keywords: ["رویداد", "event staff", "stagehand", "sound engineer", "lighting tech"]
        },

        // Recycling / Waste / Sanitation
        {
            code: "waste", name_fa: "پسماند/بازیافت", name_en: "Waste Management / Recycling",
            keywords: ["زباله", "پسماند", "recycling", "waste management", "garbage collector"]
        },

        // Education / School / Labs
        {
            code: "education", name_fa: "آموزش/مدرسه", name_en: "Education / School",
            keywords: ["مدرسه", "معلم", "teacher", "education", "instructor", "tutor"]
        },

        // Specialist industrial roles
        {
            code: "insulation", name_fa: "عایق‌کاری/ایزولاسیون", name_en: "Insulation / Thermal",
            keywords: ["عایق کاری", "insulation", "thermal insulation", "pipe insulation"]
        },

        {
            code: "painter_industrial", name_fa: "رنگ‌کاری صنعتی/پوشش", name_en: "Industrial Painting / Coating",
            keywords: ["رنگ کاری صنعتی", "coating", "spray painter", "industrial painter", "powder coating"]
        },

        {
            code: "boilermaker", name_fa: "دیگ‌ساز/پرس‌ورک", name_en: "Boilermaker / Pressure Vessel",
            keywords: ["دیگ ساز", "boilermaker", "pressure vessel", "weld pressure"]
        },

        {
            code: "stonecarver", name_fa: "حجار/منبت‌کاری سنگ", name_en: "Stone Carver / Sculptor",
            keywords: ["حجار", "منبت کاری", "stone carving", "sculptor", "سنگ تراشی"]
        },

        {
            code: "safetygear", name_fa: "تولید تجهیزات ایمنی", name_en: "Safety Equipment Manufacturing",
            keywords: ["تولید ایمنی", "ppe manufacturing", "glove factory", "safety products"]
        },

        // Misc / catch-all
        {
            code: "general", name_fa: "عمومی/کارگر ساده", name_en: "General / Labor",
            keywords: ["کارگر ساده", "عمومی", "helper", "general labor", "worker", "کارگری"]
        }
    ];

    // ---------- Build keyword index for fast lookup ----------
    const keywordIndex = new Map(); // normalized keyword -> array of industry indices
    function buildIndex() {
        keywordIndex.clear();
        for (let i = 0; i < INDUSTRIES.length; i++) {
            const ind = INDUSTRIES[i];
            for (const k of ind.keywords) {
                const nk = normalizeText(k);
                if (!nk) continue;
                const parts = nk.split(' ').filter(Boolean);
                // index full phrase
                if (!keywordIndex.has(nk)) keywordIndex.set(nk, new Set());
                keywordIndex.get(nk).add(i);
                // index tokens too for partial match
                for (const p of parts) {
                    if (p.length >= 2) {
                        if (!keywordIndex.has(p)) keywordIndex.set(p, new Set());
                        keywordIndex.get(p).add(i);
                    }
                }
            }
        }
        // convert sets to arrays for faster iteration later
        for (const [k, s] of Array.from(keywordIndex.entries())) {
            keywordIndex.set(k, Array.from(s));
        }
    }
    buildIndex();

    // ---------- Matching Logic ----------
    function bestMatch(raw, opts = {}) {
        const threshold = (typeof opts.threshold === 'number') ? opts.threshold : 0.25;
        const txt = normalizeText(raw);
        if (!txt) return null;

        // 1) exact index lookup (highest confidence) - check for any keyword phrase match
        // iterate through all indexed keys that appear in the input
        const foundIndustries = new Map(); // idx -> score-like count
        for (const [key, inds] of keywordIndex.entries()) {
            if (txt.indexOf(key) !== -1) {
                for (const idx of inds) {
                    const cur = foundIndustries.get(idx) || 0;
                    foundIndustries.set(idx, cur + 1.5); // phrase match weight
                }
            }
        }
        if (foundIndustries.size > 0) {
            // calculate normalized score by dividing by keyword count for that industry
            let best = null;
            for (const [idx, score] of foundIndustries.entries()) {
                const ind = INDUSTRIES[idx];
                const norm = score / Math.max(1, ind.keywords.length);
                if (!best || norm > best.score) best = { idx, score: norm };
            }
            if (best && best.score >= 0.5) {
                const ind = INDUSTRIES[best.idx];
                return { code: ind.code, name_fa: ind.name_fa, name_en: ind.name_en, score: 1, matched: 'phrase-index' };
            }
            // if lower score, still tentatively return best if above threshold*2
            if (best && best.score >= threshold * 2) {
                const ind = INDUSTRIES[best.idx];
                return { code: ind.code, name_fa: ind.name_fa, name_en: ind.name_en, score: Math.min(0.9, best.score), matched: 'phrase-index-weak' };
            }
        }

        // 2) token overlap scoring
        const tkns = tokensOf(txt);
        if (tkns.length > 0) {
            const hitsByIdx = new Map();
            for (const t of tkns) {
                if (keywordIndex.has(t)) {
                    const inds = keywordIndex.get(t);
                    for (const idx of inds) {
                        hitsByIdx.set(idx, (hitsByIdx.get(idx) || 0) + 1);
                    }
                }
            }
            if (hitsByIdx.size > 0) {
                let best = null;
                for (const [idx, hits] of hitsByIdx.entries()) {
                    const ind = INDUSTRIES[idx];
                    const score = hits / Math.max(1, ind.keywords.length);
                    if (!best || score > best.score) best = { idx, score, hits };
                }
                if (best && best.score >= threshold) {
                    const ind = INDUSTRIES[best.idx];
                    return { code: ind.code, name_fa: ind.name_fa, name_en: ind.name_en, score: best.score, matched: 'token-overlap' };
                }
            }
        }

        // 3) substring fuzzy: check for any 4-char substring match in keywords
        for (const [key, inds] of keywordIndex.entries()) {
            if (key.length >= 4) {
                for (let i = 0; i <= key.length - 4; i++) {
                    const sub = key.slice(i, i + 4);
                    if (txt.indexOf(sub) !== -1) {
                        // return first reasonable match
                        const idx = inds[0];
                        const ind = INDUSTRIES[idx];
                        return { code: ind.code, name_fa: ind.name_fa, name_en: ind.name_en, score: 0.18, matched: key, matched_sub: sub };
                    }
                }
            }
        }

        // not confident
        return null;
    }

    // ---------- Extensibility API ----------
    function addIndustry(obj) {
        // obj must have: code, name_fa, name_en, keywords (array)
        if (!obj || !obj.code || !Array.isArray(obj.keywords)) throw new Error("Invalid industry object");
        INDUSTRIES.push({
            code: obj.code,
            name_fa: obj.name_fa || obj.code,
            name_en: obj.name_en || obj.code,
            keywords: obj.keywords.slice()
        });
        buildIndex();
        return true;
    }

    async function loadFromJSON(url) {
        // url should return array of industry objects {code,name_fa,name_en,keywords}
        try {
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) throw new Error("fetch failed");
            const arr = await res.json();
            if (!Array.isArray(arr)) throw new Error("invalid json format");
            for (const obj of arr) {
                try { addIndustry(obj); } catch (e) { /* skip invalid */ }
            }
            return true;
        } catch (e) {
            console.warn("IndustryIndexer.loadFromJSON error:", e);
            return false;
        }
    }

    // ---------- Exports ----------
    window.IndustryIndexer = window.IndustryIndexer || {};
    window.IndustryIndexer.bestMatch = window.IndustryIndexer.bestMatch || bestMatch;
    window.IndustryIndexer.addIndustry = window.IndustryIndexer.addIndustry || addIndustry;
    window.IndustryIndexer.loadFromJSON = window.IndustryIndexer.loadFromJSON || loadFromJSON;
    window.IndustryIndexer._DICT = INDUSTRIES;
    window.IndustryIndexer._index = keywordIndex;
    window.IndustryIndexer.normalize = normalizeText;
    window.IndustryIndexer.tokensOf = tokensOf;

    // for quick smoke testing in console
    console.info("IndustryIndexer v3.0 loaded — entries:", INDUSTRIES.length);
})();





// industry_indexer.js
// Sigma — lightweight industry / job matcher (FA)
// Usage:
//   await IndustryIndexer.init('/assets/intent_keywords_fa.json');
//   const r = IndustryIndexer.bestMatch('من جوشکارم و با الکترود کار میکنم');
//   console.log(r);

const IndustryIndexer = (function () {
    let dict = null;
    let industryIndex = {}; // code -> normalized aliases[]
    const MIN_SCORE = 0.10; // floor for reporting (tunable)

    /* -----------------------
       Helper: normalization
       ----------------------- */
    function normalize(s) {
        if (!s) return "";
        s = String(s).trim().toLowerCase();
        // Persian normalizations
        s = s.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
        // translate Persian digits to Latin (if needed)
        s = s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
        // remove punctuation but keep letters/numbers/spaces (unicode-aware)
        s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');
        s = s.replace(/\s+/g, ' ');
        return s;
    }

    /* -----------------------
       Tokenize
       ----------------------- */
    function tokensOf(s) {
        return normalize(s).split(' ').filter(Boolean);
    }

    /* -----------------------
       Levenshtein (simple)
       ----------------------- */
    function levenshtein(a, b) {
        if (a === b) return 0;
        a = String(a); b = String(b);
        const al = a.length, bl = b.length;
        if (al === 0) return bl;
        if (bl === 0) return al;
        const prev = new Array(bl + 1);
        for (let j = 0; j <= bl; j++) prev[j] = j;
        for (let i = 1; i <= al; i++) {
            let cur = [i];
            for (let j = 1; j <= bl; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            }
            for (let j = 0; j <= bl; j++) prev[j] = cur[j];
        }
        return prev[bl];
    }

    /* normalized similarity from 0..1 based on edit distance */
    function levSim(a, b) {
        a = String(a); b = String(b);
        const maxL = Math.max(a.length, b.length);
        if (maxL === 0) return 1.0;
        const d = levenshtein(a, b);
        return Math.max(0, 1 - d / maxL);
    }

    /* -----------------------
       load dict (intent_keywords_fa.json)
       ----------------------- */
    async function loadJSON(path) {
        const r = await fetch(path);
        if (!r.ok) throw new Error('industry_indexer: failed to load json');
        return r.json();
    }

    /* -----------------------
       build index from dict.industries
       ----------------------- */
    function buildIndex(d) {
        industryIndex = {};
        const raw = d && d.industries ? d.industries : {};
        for (const [code, aliases] of Object.entries(raw)) {
            industryIndex[code] = (aliases || []).map(a => normalize(a)).filter(Boolean);
            // ensure unique
            industryIndex[code] = Array.from(new Set(industryIndex[code]));
        }
    }

    /* -----------------------
       score text against a single alias
       returns [score, reason]
       ----------------------- */
    function scoreAgainstAlias(textTokens, joinedText, alias) {
        // alias is normalized already
        const aliasTokens = alias.split(' ').filter(Boolean);
        // exact phrase match (strong)
        if (joinedText.includes(alias)) return { score: 1.0, reason: `phrase:${alias}` };

        // token matches: count how many tokens of alias are in textTokens
        let hitCount = 0;
        for (const at of aliasTokens) {
            if (textTokens.includes(at)) { hitCount += 1; continue; }
            // substring tolerant
            for (const tt of textTokens) {
                if (tt.includes(at) && at.length >= 3) { hitCount += 0.9; break; }
            }
        }
        const tokenRatio = aliasTokens.length ? (hitCount / aliasTokens.length) : 0;

        // if short alias (1 token) but not exact, try fuzzy on tokens
        if (aliasTokens.length === 1) {
            const a = aliasTokens[0];
            // try best token fuzzy similarity
            let bestSim = 0;
            for (const tt of textTokens) {
                const sim = levSim(a, tt);
                if (sim > bestSim) bestSim = sim;
            }
            // if very similar, give it weight
            if (bestSim >= 0.75) return { score: Math.max(tokenRatio, bestSim * 0.9), reason: `fuzzy:${a}` };
        }

        // composite score: tokenRatio * 0.75 (scale down a bit)
        const sc = Math.min(1, tokenRatio * 0.85);
        return { score: sc, reason: `tokens:${hitCount}/${aliasTokens.length}` };
    }

    /* -----------------------
       score text against an industry (all aliases)
       returns {score, details: [{alias,score,reason}]}
       ----------------------- */
    function scoreAgainstIndustry(text) {
        const txt = normalize(text);
        const textTokens = tokensOf(txt);
        const joinedText = textTokens.join(' ');
        let best = { score: 0, alias: null, reason: null };
        const details = [];
        for (const alias of (industryIndex[text.industryCode] ? [] : [])) { } // noop to appease lint

        for (const [code, aliases] of Object.entries(industryIndex)) {
            let localBest = { score: 0, alias: null, reason: null };
            for (const alias of aliases) {
                const res = scoreAgainstAlias(textTokens, joinedText, alias);
                if (res.score > localBest.score) {
                    localBest = { score: res.score, alias, reason: res.reason };
                }
            }
            details.push({ code, alias: localBest.alias, score: localBest.score, reason: localBest.reason });
            if (localBest.score > best.score) {
                best = { code, alias: localBest.alias, score: localBest.score, reason: localBest.reason };
            }
        }

        return { best, details };
    }

    /* -----------------------
       public: init
       ----------------------- */
    async function init(jsonPath) {
        const data = await loadJSON(jsonPath);
        dict = data;
        buildIndex(dict);
        return dict;
    }

    /* -----------------------
       improved scoring function:
       - direct alias phrase -> 1.0
       - token overlap aggregated
       - fuzzy token boost for long tokens
       - length-based penalty (too generic aliases get slight penalty)
       returns normalized score 0..1
       ----------------------- */
    function industryScoreForText(text) {
        const txt = normalize(text);
        const textTokens = tokensOf(txt);
        const joinedText = textTokens.join(' ');
        const results = [];

        for (const [code, aliases] of Object.entries(industryIndex)) {
            let topAliasScore = 0;
            let topReason = '';
            for (const alias of aliases) {
                const res = scoreAgainstAlias(textTokens, joinedText, alias);
                if (res.score > topAliasScore) {
                    topAliasScore = res.score;
                    topReason = res.reason;
                }
            }
            // length penalty: if alias is extremely short (1 char) or extremely generic, reduce
            const genericPenalty = (aliases.some(a => a.length <= 2) ? 0.9 : 1.0);
            let sc = topAliasScore * genericPenalty;

            // small boost if multiple alias hits exist (measure rough)
            // count how many aliases are substring matched
            let multiHit = 0;
            for (const alias of aliases) {
                if (joinedText.includes(alias)) multiHit++;
            }
            if (multiHit > 1) sc = Math.min(1, sc + Math.min(0.12, 0.03 * multiHit));

            results.push({ code, score: sc, aliasMatched: topAliasScore > 0 ? aliases.find(a => true && joinedText.includes(a) || true) : null, reason: topReason });
        }

        // sort desc
        results.sort((a, b) => b.score - a.score);
        // normalize top score to 0..1 (they already ~0..1 but ensure)
        const top = results[0] || { score: 0, code: null };
        // If top score is tiny, keep as is
        return results;
    }

    /* -----------------------
       bestMatch: returns topN matches with normalized score
       { matches: [{code, name_fa, score, reason, aliasesMatched[] }], rawText }
       ----------------------- */
    function bestMatch(text, opts = {}) {
        if (!dict) throw new Error('IndustryIndexer not initialized. call init(path) first.');
        const topN = opts.topN || 3;
        const txt = normalize(String(text || ''));
        const results = industryScoreForText(txt);
        // map to include friendly name: take first alias as display name if exists
        const mapped = results.slice(0, topN).map(r => {
            const code = r.code;
            const aliases = industryIndex[code] || [];
            return {
                code,
                name_fa: aliases.length ? aliases[0] : code,
                score: Number((r.score).toFixed(3)),
                reason: r.reason || '',
                aliases: aliases.slice(0, 5)
            };
        }).filter(m => m.score >= MIN_SCORE);

        return { rawText: txt, matches: mapped, all: results.slice(0, topN) };
    }

    /* -----------------------
       convenience: bestSingle(text)
       returns {code,name_fa,score,reason} or null
       ----------------------- */
    function bestSingle(text) {
        const r = bestMatch(text, { topN: 1 });
        return r.matches && r.matches.length ? r.matches[0] : { code: 'unknown', name_fa: null, score: 0, reason: 'low' };
    }

    /* -----------------------
       expose
       ----------------------- */
    return {
        init,
        bestMatch,
        bestSingle,
        _debug_index: () => industryIndex
    };
})();
