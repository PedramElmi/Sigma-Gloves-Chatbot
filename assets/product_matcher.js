/**
 * product_matcher.js
 *
 * Usage:
 *   await ProductMatcher.init('/data/products.json');
 *   const picks = ProductMatcher.pickProducts({ hazard: 'برش', env: 'روغنی', pref: 'راحتی' }, { topN:5 });
 *
 * Exports global ProductMatcher when loaded in browser.
 */

const ProductMatcher = (function () {
    let products = [];
    let ready = false;

    // ---- config weights (tweakable) ----
    const WEIGHTS = {
        hazardMatch: 0.45,   // match between hazard tokens and product features/materials/standards
        envMatch: 0.22,      // environment (oily/wet/cold/heat) match
        prefMatch: 0.15,     // user preference (comfort/durability/grip/breathability)
        standardsScore: 0.12,// numeric boost from EN388 (cut level / puncture etc.)
        baseScore: 0.06      // small base so nothing is zero
    };

    // mapping simple hazard keywords to semantic categories
    const HAZARD_CATS = {
        cut: ['cut', 'برش', 'sharp', 'knife', 'laceration', 'لبه', 'تیغ', 'blade'],
        puncture: ['puncture', 'pierce', 'سوراخ', 'نوک', 'needle', 'punctur'],
        heat: ['heat', 'hot', 'حرارت', 'burn', 'گرما', 'سوختگی'],
        cold: ['cold', 'سرد', 'freeze', 'frozen', 'سرما'],
        chemical: ['chemical', 'acid', 'solvent', 'chem', 'حلال', 'اسید', 'خورنده', 'chemical'],
        abrasion: ['abrasion', 'abrasive', 'سایش', 'ساییدگی', 'abrasive'],
        impact: ['impact', 'crush', 'ضربه', 'impact', 'shock', 'ضربه'],
        oil: ['oil', 'oily', 'grease', 'روغن', 'چرب', 'oil', 'grease', 'روغنی'],
        vibration: ['vibration', 'لرز', 'لرزش']
    };

    // environment keyword sets
    const ENV_CATS = {
        oily: ['oil', 'oily', 'grease', 'روغن', 'روغنی', 'greasy'],
        wet: ['wet', 'moist', 'مرطوب', 'wet', 'humid', 'مرطوب'],
        cold: ['cold', 'سرد', 'freezer', 'freeze', 'فریزر'],
        hot: ['hot', 'گرم', 'warm', 'داغ'],
        dusty: ['dust', 'غبار', 'گرد و غبار', 'گردوخاک'],
        indoors: ['indoor', 'داخل', 'داخل ساختمان'],
        outdoors: ['outdoor', 'خارج', 'محیط باز', 'محیط بیرون']
    };

    // preference keywords
    const PREF_CATS = {
        comfort: ['comfort', 'راحتی', 'comfortable', 'نرمی'],
        durability: ['durability', 'دوام', 'مقاوم', 'با دوام'],
        grip: ['grip', 'anti-slip', 'چسبندگی', 'ضد لغزش', 'چسبنده', 'grip'],
        breathability: ['breathable', 'تهویه', 'تنفس', 'breathability']
    };

    // -- helpers: normalize text (basic, works for fa/en) --
    function normalize(s) {
        if (!s) return '';
        s = s.toString().trim();
        s = s.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
        s = s.replace(/[\u064B-\u065F]/g, ''); // remove diacritics
        s = s.toLowerCase();
        s = s.replace(/[^0-9\u0600-\u06FFa-z\s\-]+/g, ' '); // keep Arabic/Persian letters, latins, digits, spaces, hyphen
        s = s.replace(/\s+/g, ' ').trim();
        return s;
    }

    function tokenize(s) {
        s = normalize(s);
        if (!s) return [];
        return Array.from(new Set(s.split(' ').filter(Boolean)));
    }

    // parse cut_level which in products.json can be "5+" or number or null
    function parseCutLevel(v) {
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') return v;
        if (typeof v === 'string') {
            const m = v.match(/(\d+)/);
            if (m) return Number(m[1]);
        }
        return null;
    }

    // compute standards-derived score for a given product and hazard category
    function computeStandardsScore(prod, hazardCats) {
        // heuristics:
        // - if hazard includes cut and product has cut_level numeric -> scale to [0..1]
        // - if hazard includes puncture and product.puncture numeric -> scale
        // - else 0
        const s = prod.standards && prod.standards.en388 ? prod.standards.en388 : null;
        if (!s) return 0;
        let best = 0;
        if (hazardCats.has('cut')) {
            const cutVal = parseCutLevel(s.cut_level ?? s.cutLevel ?? s.cut); // try multiple keys
            if (cutVal !== null && !isNaN(cutVal)) {
                // EN388 cut levels 1..5 typically. Normalize by 5
                best = Math.max(best, Math.min(1, cutVal / 5));
            }
            // if tdm_newton is present (ISO 13997), can scale: typical protective > 1000N is high
            const tdm = s.tdm_newton || s.tdm || s.iso13997 || null;
            if (tdm) {
                const val = Number(tdm);
                if (!isNaN(val)) {
                    // use 2000N as a high reference (scale accordingly)
                    best = Math.max(best, Math.min(1, val / 2000));
                }
            }
        }
        if (hazardCats.has('puncture')) {
            const punct = s.puncture ?? s.puncture_resistance ?? null;
            if (typeof punct === 'number') best = Math.max(best, Math.min(1, punct / 5));
        }
        // clamp
        return Math.min(1, best);
    }

    // match tokens to product features/materials/name
    function featureMatchScore(prod, tokens) {
        if (!tokens || tokens.length === 0) return 0;
        const hay = [
            prod.name_en || '',
            prod.name_fa || '',
            (prod.features_en || []).join(' '),
            (prod.features_fa || []).join(' '),
            (prod.materials || []).join(' ')
        ].join(' ').toLowerCase();
        let hits = 0;
        tokens.forEach(t => {
            if (!t) return;
            if (hay.includes(t)) hits += 1;
            // partial matching: match stems like 'cut' inside 'cut-resistant'
            else {
                const patt = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                if (patt.test(hay)) hits += 0.8; // partial less weight
            }
        });
        return hits / Math.max(1, tokens.length);
    }

    // semantic category detection for an input string (hazard/env/pref)
    function detectCats(text, catMap) {
        const tokens = tokenize(text);
        const cats = new Set();
        for (const [cat, kwlist] of Object.entries(catMap)) {
            for (const kw of kwlist) {
                if (tokens.some(t => t.includes(kw) || kw.includes(t))) { cats.add(cat); break; }
            }
        }
        return cats;
    }

    // load products JSON
    async function init(jsonUrlOrObj) {
        let arr;
        if (typeof jsonUrlOrObj === 'string') {
            const res = await fetch(jsonUrlOrObj);
            if (!res.ok) throw new Error('Failed to load products.json: ' + res.status);
            arr = await res.json();
        } else if (Array.isArray(jsonUrlOrObj)) {
            arr = jsonUrlOrObj;
        } else {
            throw new Error('init expects URL string or parsed array');
        }
        products = arr.map(p => Object.assign({}, p));
        ready = true;
        return { count: products.length };
    }

    // main scoring & picking function
    function pickProducts(input = {}, opts = { topN: 6 }) {
        if (!ready) throw new Error('ProductMatcher not initialized. Call await ProductMatcher.init("/data/products.json") first.');
        const topN = opts.topN || 6;

        const hazard = (input.hazard || '').toString();
        const env = (input.env || '').toString();
        const pref = (input.pref || '').toString();

        // detect semantic categories
        const hazardCats = detectCats(hazard, HAZARD_CATS);
        const envCats = detectCats(env, ENV_CATS);
        const prefCats = detectCats(pref, PREF_CATS);

        // candidate scoring
        const scored = products.map(prod => {
            // 1) feature/hazard match
            // create tokens from hazard and product features
            const hazardTokens = tokenize(hazard);
            const fScoreHazard = featureMatchScore(prod, hazardTokens);

            // 2) env matching: check materials and features for oil resistance, cold, heat, etc.
            const envTokens = tokenize(env);
            const fScoreEnv = featureMatchScore(prod, envTokens);

            // 3) pref matching
            const prefTokens = tokenize(pref);
            const fScorePref = featureMatchScore(prod, prefTokens);

            // 4) standards-based boost
            const sScore = computeStandardsScore(prod, hazardCats);

            // 5) additional heuristics: if hazardCats contains 'cut' then products with 'cut' in features or HPPE/aramid/Kevlar in materials get boost
            let specialBoost = 0;
            if (hazardCats.has('cut')) {
                const mats = (prod.materials || []).join(' ').toLowerCase();
                if (/hppe|kevlar|aramid|steel mesh|stainless mesh|mesh/i.test(mats)) specialBoost += 0.12;
                const feats = (prod.features_en || []).join(' ').toLowerCase() + ' ' + (prod.features_fa || []).join(' ').toLowerCase();
                if (/cut|cut-resistant|cut resistant|anti-cut|anti cut|cut level/.test(feats)) specialBoost += 0.10;
            }
            if (hazardCats.has('chemical') || envCats.has('oily')) {
                const mats = (prod.materials || []).join(' ').toLowerCase();
                if (/nitrile|neoprene|butyl|viton|polyvinyl/.test(mats)) specialBoost += 0.12;
            }
            if (envCats.has('cold')) {
                const mats = (prod.materials || []).join(' ').toLowerCase();
                if (/fleece|towel|insulated|thermal|wool|fleece lining/.test(mats)) specialBoost += 0.12;
            }

            // compute final weighted score
            const finalScore =
                WEIGHTS.baseScore +
                WEIGHTS.hazardMatch * fScoreHazard +
                WEIGHTS.envMatch * fScoreEnv +
                WEIGHTS.prefMatch * fScorePref +
                WEIGHTS.standardsScore * sScore +
                specialBoost;

            // prepare explanation snippets
            const reasons = [];
            if (fScoreHazard > 0) reasons.push(`hazard match:${(fScoreHazard).toFixed(2)}`);
            if (fScoreEnv > 0) reasons.push(`env match:${(fScoreEnv).toFixed(2)}`);
            if (fScorePref > 0) reasons.push(`pref match:${(fScorePref).toFixed(2)}`);
            if (sScore > 0) reasons.push(`standards:${(sScore).toFixed(2)}`);
            if (specialBoost > 0) reasons.push(`specialBoost:${specialBoost.toFixed(2)}`);

            return {
                product: prod,
                score: Math.min(1, Number(finalScore.toFixed(4))),
                reasons
            };
        });

        // sort by score desc then by product id fallback
        scored.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return (a.product.id || '').localeCompare(b.product.id || '');
        });

        // return topN with simplified object
        const top = scored.slice(0, topN).map(s => ({
            id: s.product.id,
            title_en: s.product.name_en,
            title_fa: s.product.name_fa,
            url: s.product.url,
            score: s.score,
            reasons: s.reasons,
            metadata: s.product
        }));

        // if nothing seems relevant (all scores very low), return empty array to let caller fallback
        const highEnough = top.filter(t => t.score >= 0.12);
        if (highEnough.length === 0) return top.slice(0, Math.min(3, top.length)); // still return a few low-scored choices for UX

        return top;
    }

    function getAll() { return products.slice(); }

    return {
        init,
        pickProducts,
        pickProductsSynonym: pickProducts, // alias
        getAll,
        _internals: { WEIGHTS, HAZARD_CATS, ENV_CATS, PREF_CATS } // exposed for tuning in console
    };






// product_matcher.js — simple rule-based product recommender for Sigma
// Usage:
//   await ProductMatcher.init(); // optional if you want to load remote catalog
//   const picks = ProductMatcher.pickProducts({ hazard: 'cut', env: 'oily', pref: 'grip' }, { topN: 6 });
//   console.log(picks);

    // internal product catalog (seed). Add/replace with remote load if needed.
    const defaultCatalog = [
        {
            id: "911",
            title_fa: "دستکش ضد برش HPPE 911",
            title_en: "Sigma 911 — HPPE Cut Resistant Gloves",
            url: "https://sigmagloves.com/products/sigma-911-cut-resistant-work-gloves/",
            tags: ["cut", "hppe", "high_cut", "dexterity"],
            std: { en388: "5 - CUT 5 (TDM high)", raw: "CUT 5" },
            why: "HPPE با سطح مقاومت برش بالا (CUT 5). مناسب برای کار با سطوح تیز و برنده؛ سبک و با حس لمسی خوب."
        },
        {
            id: "921",
            title_fa: "دستکش ضد برش HPPE 921",
            title_en: "Sigma 921 — HPPE Cut Resistant Gloves",
            url: "https://sigmagloves.com/products/sigma-921-cut-resistant-work-gloves/",
            tags: ["cut", "hppe", "high_cut"],
            std: { en388: "5 - CUT 5 (TDM high)", raw: "CUT 5" },
            why: "نسخه‌ای از دستکش HPPE با مقاومت برش سطح بالا؛ مناسب برای سازندگان قطعات فلزی و شیشه‌برها."
        },
        {
            id: "922",
            title_fa: "دستکش ضد برش HPPE 922",
            title_en: "Sigma 922 — HPPE Cut Resistant Gloves",
            url: "https://sigmagloves.com/products/sigma-931-cut-resistant-work-gloves/",
            tags: ["cut", "hppe"],
            std: { en388: "5 - CUT 5", raw: "CUT 5" },
            why: "مناسب برای کار با اجسام برنده؛ تعادل بین محافظت و انعطاف."
        },
        {
            id: "412",
            title_fa: "دستکش لاتکس 412",
            title_en: "Sigma 412 — Latex Work Gloves",
            url: "https://sigmagloves.com/products/sigma-412-latex-work-gloves/",
            tags: ["latex", "general", "grip", "chemical_resistance_light"],
            std: { en388: "—", raw: "EN388" },
            why: "پوشش لاتکس برای چسبندگی و حفاظت عمومی. مناسب کارهای سبک تا متوسط و محیط‌های خشک یا کمی روغنی."
        },
        {
            id: "418",
            title_fa: "دستکش لاتکس 418",
            title_en: "Sigma 418 — Latex Work Gloves",
            url: "https://sigmagloves.com/products/sigma-418-latex-work-gloves/",
            tags: ["latex", "general", "grip"],
            std: { en388: "EN388" },
            why: "لاتکس با چنگش خوب؛ مناسب کارهای عمومی و ساختمانی سبک."
        },
        {
            id: "422",
            title_fa: "دستکش لاتکس +422",
            title_en: "Sigma +422 — Latex Work Gloves",
            url: "https://sigmagloves.com/products/sigma-422-latex-work-gloves/",
            tags: ["latex", "general", "grip"],
            std: { en388: "EN388" },
            why: "نسخه‌ی قوی‌تر لاتکس با دوام و مقاومت مناسب."
        },
        {
            id: "432",
            title_fa: "دستکش لاتکس 432",
            title_en: "Sigma 432 — Latex Towel-lined (Warm) Gloves",
            url: "https://sigmagloves.com/products/sigma-432-latex-work-gloves/",
            tags: ["latex", "warm", "insulated"],
            std: { en388: "EN388" },
            why: "آستر حوله‌ای گرم؛ مناسب محیط‌های سرد و کارهای بیرونی در زمستان."
        },
        {
            id: "434",
            title_fa: "دستکش لاتکس +434 (آستر دار)",
            title_en: "Sigma +434 — Towel-lined Latex Gloves",
            url: "https://sigmagloves.com/products/sigma-434-latex-work-gloves/",
            tags: ["latex", "warm", "grip"],
            std: { en388: "EN388" },
            why: "آستر داخلی گرم و ضدلغزش لاتکس؛ مناسب کار در سرما و کارهای عمومی."
        },
        {
            id: "446",
            title_fa: "دستکش شیاردار +446",
            title_en: "Sigma +446 — Ribbbed Latex Grip Gloves",
            url: "https://sigmagloves.com/products/sigma-446-latex-work-gloves/",
            tags: ["latex", "grip", "general", "durable"],
            std: { en388: "2142", raw: "EN388: 2142" },
            why: "پوشش لاتکس شیاردار، مناسب کارهای خشن مثل باغبانی، شیشه‌گری و ساختمانی؛ دوام خوب و ضد لغزش."
        },
        {
            id: "485",
            title_fa: "دستکش فومی +485",
            title_en: "Sigma +485 — Foam Latex Work Gloves",
            url: "https://sigmagloves.com/products/sigma-485-latex-work-gloves/",
            tags: ["foam", "latex", "grip", "general"],
            std: { en388: "2242", raw: "EN388: 2242" },
            why: "اولین دستکش فومی با کیفیت ایرانی؛ چنگش قوی و انعطاف بالا، مناسب محیط‌های روغنی/نسبتاً مرطوب."
        },
        {
            id: "342",
            title_fa: "دستکش نیتریل 342",
            title_en: "Sigma 342 — Nitrile Work Gloves",
            url: "https://sigmagloves.com/products/sigma-486-nitrile-work-gloves/",
            tags: ["nitrile", "oil", "chemical_resistance", "puncture"],
            std: { en388: "EN388" },
            why: "نیتریل برای مقاومت در برابر روغن و برخی حلال‌ها؛ مناسب صنایع نفتی و کار با حلال."
        },
        {
            id: "344",
            title_fa: "دستکش نیتریل +344",
            title_en: "Sigma +344 — Nitrile Work Gloves",
            url: "https://sigmagloves.com/products/sigma-344-nitrile-work-gloves/",
            tags: ["nitrile", "oil", "chemical_resistance"],
            std: { en388: "EN388" },
            why: "نسخه نیتریل با مقاومت بالا در برابر روغن و حلال؛ مناسب محیط‌های نفتی و پتروشیمی."
        },
        {
            id: "348",
            title_fa: "دستکش نیتریل +348",
            title_en: "Sigma 986 / 348 — Nitrile / Cut Assist",
            url: "https://sigmagloves.com/products/sigma-986-cut-resistant-work-gloves/",
            tags: ["nitrile", "puncture", "cut_resistant"],
            std: { en388: "EN388" },
            why: "ترکیب نیتریل با مقاومت مکانیکی؛ مناسب کارهای روغنی که نیاز به محافظت در برابر سوراخ شدن دارند."
        },
        {
            id: "346",
            title_fa: "دستکش نیتریل 346",
            title_en: "Sigma 346 — Nitrile Work Gloves (Reinforced)",
            url: "https://sigmagloves.com/products/sigma-334-nitrile-work-gloves/",
            tags: ["nitrile", "oil", "reinforced", "puncture"],
            std: { en388: "EN388" },
            why: "تقویت سر انگشت و مقاومت در برابر سوراخ شدن؛ کاربرد صنعتی سنگین."
        },
        {
            id: "332",
            title_fa: "دستکش نیتریل 332",
            title_en: "Sigma 332 — Nitrile Work Gloves",
            url: "https://sigmagloves.com/products/sigma-332-nitrile-work-gloves/",
            tags: ["nitrile", "chemical_resistance", "oil"],
            std: { en388: "EN388" },
            why: "مناسب برای کار با مواد نفتی و بعضی حلال‌ها؛ ضدحساسیت."
        },
        {
            id: "312",
            title_fa: "دستکش نیتریل 312",
            title_en: "Sigma 312 — Nitrile Work Gloves",
            url: "https://sigmagloves.com/products/sigma-312-nitrile-work-gloves/",
            tags: ["nitrile", "oil", "durable"],
            std: { en388: "EN388" },
            why: "دستکش نیتریل عمومی با دوام خوب؛ کاربردهای چندمنظوره."
        }
    ];

    let catalog = []; // will hold active catalog (copy of defaultCatalog or loaded)

    /* -------------------------
       normalization helpers
       ------------------------- */
    function norm(s) {
        if (!s) return "";
        return String(s).trim().toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک');
    }

    /* -------------------------
       utility: get numeric cut level if present in std.raw or tags
       returns integer or null
       ------------------------- */
    function extractCutLevel(prod) {
        // look in tags
        if (prod.tags && prod.tags.includes('high_cut')) return 5;
        // check std.raw like "CUT 5" or en388 strings
        const raw = (prod.std && (prod.std.raw || prod.std.en388) || "").toString().toLowerCase();
        const m = raw.match(/cut\s*[:\-]?\s*([0-9])/i) || raw.match(/cut\s*([0-9])/i) || raw.match(/\b([0-9])\b/);
        if (m && m[1]) {
            const v = parseInt(m[1], 10);
            if (!isNaN(v)) return v;
        }
        return null;
    }

    /* -------------------------
       init(catalogOverridePath?) — optional remote JSON load
       ------------------------- */
    async function init(remoteJsonPath) {
        if (remoteJsonPath) {
            try {
                const r = await fetch(remoteJsonPath);
                if (r.ok) {
                    const data = await r.json();
                    if (Array.isArray(data.products)) catalog = data.products;
                    else catalog = defaultCatalog.slice();
                } else {
                    catalog = defaultCatalog.slice();
                }
            } catch (e) {
                console.warn('ProductMatcher:init remote load failed', e);
                catalog = defaultCatalog.slice();
            }
        } else {
            catalog = defaultCatalog.slice();
        }
        // ensure normalized tags
        catalog.forEach(p => {
            p._tags = (p.tags || []).map(t => norm(t));
            p._id = String(p.id);
            p._cutLevel = extractCutLevel(p);
        });
        return catalog;
    }

    /* -------------------------
       score a single product given query
       query: { hazard, env, pref, industryCode, text }
       returns numeric score (0..1) and reasons array
       ------------------------- */
    function scoreProduct(prod, query) {
        const reasons = [];
        let score = 0;

        const qHaz = norm(query.hazard || "");
        const qEnv = norm(query.env || "");
        const qPref = norm(query.pref || "");
        const qIndustry = norm(query.industry || query.industryCode || "");

        // 1) hazard match (strong)
        if (qHaz) {
            // if any prod tag equals hazard -> strong
            if (prod._tags.includes(qHaz)) { score += 1.0; reasons.push(`hazard_exact:${qHaz}`); }
            else {
                // partial mapping: map synonyms: cut -> cut, puncture->puncture, oil->oil
                // check if any tag contains qHaz substring
                for (const t of prod._tags) {
                    if (t.includes(qHaz) || qHaz.includes(t)) { score += 0.6; reasons.push(`hazard_partial:${t}`); break; }
                }
            }
        }

        // 2) environment match (medium)
        if (qEnv) {
            if (qEnv === 'oily' || qEnv.includes('oil') || qEnv.includes('روغن')) {
                if (prod._tags.includes('oil') || prod._tags.includes('nitrile') || prod._tags.includes('foam')) { score += 0.6; reasons.push('env:oily'); }
            } else if (qEnv === 'wet' || qEnv.includes('مرطوب')) {
                if (prod._tags.includes('foam') || prod._tags.includes('latex') || prod._tags.includes('nitrile')) { score += 0.45; reasons.push('env:wet'); }
            } else if (qEnv === 'cold') {
                if (prod._tags.includes('insulated') || prod._tags.includes('warm')) { score += 0.5; reasons.push('env:cold'); }
            } else {
                // generic
                for (const t of prod._tags) {
                    if (t === qEnv) { score += 0.4; reasons.push(`env_exact:${qEnv}`); break; }
                }
            }
        }

        // 3) preference match (comfort/dexterity/grip/durability etc.)
        if (qPref) {
            if (qPref.includes('grip') && prod._tags.includes('grip')) { score += 0.5; reasons.push('pref:grip'); }
            if (qPref.includes('comfort') && (prod._tags.includes('foam') || prod._tags.includes('dexterity') || prod._tags.includes('warm'))) { score += 0.45; reasons.push('pref:comfort'); }
            if (qPref.includes('durab') && (prod._tags.includes('durable') || prod._tags.includes('reinforced'))) { score += 0.45; reasons.push('pref:durability'); }
            if (qPref.includes('cut') && (prod._tags.includes('cut') || prod._tags.includes('high_cut'))) { score += 0.9; reasons.push('pref:cut_protection'); }
            if (qPref.includes('chemical') && prod._tags.includes('chemical_resistance')) { score += 0.8; reasons.push('pref:chemical_resistance'); }
            if (qPref.includes('dexter') && prod._tags.includes('dexterity')) { score += 0.6; reasons.push('pref:dexterity'); }
        }

        // 4) industry hint (small)
        if (qIndustry) {
            // heuristic: if industry mentions 'chemical' then nitrile more valuable
            if (qIndustry.includes('chemical') && (prod._tags.includes('nitrile') || prod._tags.includes('chemical_resistance'))) { score += 0.35; reasons.push('industry:chemical'); }
            if (qIndustry.includes('welding') && prod._tags.includes('hppe') && prod._tags.includes('cut')) { score += 0.2; reasons.push('industry:welding'); }
            if (qIndustry.includes('glass') && prod._tags.includes('cut')) { score += 0.25; reasons.push('industry:glass'); }
            if (qIndustry.includes('warehouse') && prod._tags.includes('dexterity')) { score += 0.2; reasons.push('industry:warehouse'); }
        }

        // 5) cut-level bonus (if user asked for cut protection and product has numeric cut level)
        if ((qHaz && qHaz.includes('cut')) || (qPref && qPref.includes('cut'))) {
            if (prod._cutLevel) {
                // scale: each cut level point adds 0.12
                score += Math.min(1, prod._cutLevel * 0.12);
                reasons.push(`cutLevel:${prod._cutLevel}`);
            } else {
                // small penalty if product doesn't explicitly mention cut-level
                // no change
            }
        }

        // 6) small baseline for general-purpose (so non-matching items can still surface)
        // baseline = 0.05
        score += 0.05;

        // final normalization: cap at 1
        const finalScore = Math.min(1, score);
        return { score: Number(finalScore.toFixed(3)), reasons };
    }

    /* -------------------------
       pickProducts(query, opts)
       query: { hazard, env, pref, industry, industryCode, text }
       opts: { topN:6 }
       returns array sorted by score desc
       ------------------------- */
    function pickProducts(query = {}, opts = {}) {
        const topN = (opts && opts.topN) || 6;
        const scored = catalog.map(p => {
            const s = scoreProduct(p, query);
            return Object.assign({}, {
                id: p._id,
                title_fa: p.title_fa,
                title_en: p.title_en,
                url: p.url,
                tags: p.tags,
                std: p.std,
                why: p.why,
                matchScore: s.score,
                reasons: s.reasons
            });
        });

        // sort by score desc, then by whether product matches hazard tag exactly
        scored.sort((a, b) => {
            if (b.matchScore === a.matchScore) return (b.title_fa > a.title_fa) ? 1 : -1;
            return b.matchScore - a.matchScore;
        });

        // return topN non-zero
        const filtered = scored.filter(x => x.matchScore > 0).slice(0, topN);
        return filtered;
    }

    /* -------------------------
       helper: get product by id
       ------------------------- */
    function getProductById(id) {
        if (!id) return null;
        return catalog.find(p => String(p._id) === String(id)) || null;
    }

    /* -------------------------
       expose
       ------------------------- */
    return {
        init,
        pickProducts,
        getProductById,
        _catalog: () => catalog // debug
    };
})();


// expose to window
if (typeof window !== 'undefined') window.ProductMatcher = ProductMatcher;