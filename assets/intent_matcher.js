// intent_matcher.js — simple intent matcher for Sigma chat (FA).
// Usage: IntentMatcher.init('/assets/intent_keywords_fa.json').then(()=> IntentMatcher.matchIntent("متن کاربر"));

const IntentMatcher = (function () {
    let dict = null;

    function normalizeFa(s) {
        if (!s) return "";
        s = String(s).trim().toLowerCase();
        // Persian normalization
        s = s.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[۰-۹]/g, (d) => String.fromCharCode(48 + '۰'.charCodeAt(0) - d.charCodeAt(0))); // simple approach
        s = s.replace(/[^\p{L}\p{N}\s]/gu, ' '); // remove punctuation (unicode-aware)
        s = s.replace(/\s+/g, ' ');
        return s;
    }

    function loadJSON(path) {
        return fetch(path).then(r => {
            if (!r.ok) throw new Error('intent json load failed');
            return r.json();
        });
    }

    function tokenSet(s) {
        return normalizeFa(s).split(' ').filter(Boolean);
    }

    function scoreForTextAgainstList(textTokens, list) {
        // list: array of keywords/aliases; simple presence-based scoring
        let score = 0;
        const tset = new Set(textTokens);
        for (const k of list) {
            const nk = normalizeFa(k);
            if (!nk) continue;
            // exact token match
            const parts = nk.split(' ').filter(Boolean);
            // if multi-word phrase, check substring
            if (parts.length > 1) {
                const joined = textTokens.join(' ');
                if (joined.includes(nk)) score += 1.0;
            } else {
                if (tset.has(nk)) score += 1.0;
                else {
                    // substring tolerant
                    for (const tk of textTokens) {
                        if (tk.includes(nk) && nk.length >= 3) { score += 0.6; break; }
                    }
                }
            }
        }
        return score;
    }

    function computeIntentScores(text) {
        if (!dict) throw new Error('Intent dictionary not loaded');
        const txt = normalizeFa(text);
        const tokens = tokenSet(txt);

        const intentScores = {};
        for (const [intentName, intentObj] of Object.entries(dict.intents)) {
            const kw = intentObj.keywords || [];
            let s = 0;
            s += scoreForTextAgainstList(tokens, kw);
            // also check example phrases (gives boost)
            s += scoreForTextAgainstList(tokens, intentObj.examples || []) * 0.8;
            intentScores[intentName] = s;
        }

        // industry and hazard boosting
        const industryScores = {};
        for (const [code, aliases] of Object.entries(dict.industries)) {
            const sc = scoreForTextAgainstList(tokens, aliases);
            if (sc > 0) industryScores[code] = sc;
        }
        const hazardScores = {};
        for (const [h, aliases] of Object.entries(dict.hazards)) {
            const sc = scoreForTextAgainstList(tokens, aliases);
            if (sc > 0) hazardScores[h] = sc;
        }

        return { intentScores, industryScores, hazardScores, tokens, rawText: txt };
    }

    function bestIntent(matchObj) {
        const s = matchObj.intentScores;
        let best = { name: "unknown", score: 0 };
        for (const k of Object.keys(s)) {
            if (s[k] > best.score) {
                best = { name: k, score: s[k] };
            }
        }
        return best;
    }

    // public
    return {
        init: async function (jsonPath) {
            dict = await loadJSON(jsonPath);
            return dict;
        },
        matchIntent: function (text) {
            if (!dict) throw new Error('not initialized');
            const m = computeIntentScores(text);
            const best = bestIntent(m);
            // normalize numeric scoring to 0..1-ish based on heuristics
            const maxPossible = 6; // heuristic
            const normalized = Math.min(1, best.score / maxPossible);

            // attach top industries / hazards
            const topIndustry = Object.entries(m.industryScores).sort((a, b) => b[1] - a[1]).slice(0, 3);
            const topHazards = Object.entries(m.hazardScores).sort((a, b) => b[1] - a[1]).slice(0, 3);

            // decide fallback vs confident
            const min = dict.settings && dict.settings.min_intent_score ? dict.settings.min_intent_score : 0.28;
            const high = dict.settings && dict.settings.high_confidence ? dict.settings.high_confidence : 0.65;
            const result = {
                intent: best.name,
                raw_score: best.score,
                score: normalized,
                confident: normalized >= high,
                needsClarify: normalized < min,
                industries: topIndustry.map(x => ({ code: x[0], score: x[1] })),
                hazards: topHazards.map(x => ({ code: x[0], score: x[1] })),
                tokens: m.tokens
            };
            return result;
        },
        // small helper for debugging
        dumpDict: function () { return dict; }
    };

})();
