// assets/knowledge_engine.js
// KnowledgeEngine v1.3 — Robust intent & KB loader for Sigma Gloves
// Exposes window.KnowledgeEngine: { init, query, isKBQuestion, bestMatches, detectIntent, _debug_state }

(function () {
    if (window.KnowledgeEngine) {
        console.warn('KnowledgeEngine already present — skipping redefinition.');
        return;
    }

    // -------------------------
    // Internal state
    // -------------------------
    let _kb = [];                // array of entries {id, title, snippet, url, keywords, type, meta}
    let _indexInitialized = false;
    let _intentKeywords = [];    // loaded from assets/intent_keywords_fa.json
    let _kbPath = null;

    // config: tune weights
    const CFG = {
        tokenOverlapWeight: 0.45,
        lcsWeight: 0.35,
        keywordHitWeight: 0.20,
        minScoreThreshold: 0.1, // minimum score to consider
        defaultTopN: 6
    };

    // -------------------------
    // Utility helpers
    // -------------------------
    function ensureString(s) {
        if (s === null || s === undefined) return '';
        return String(s);
    }

    function normalizeText(s) {
        return ensureString(s)
            .toLowerCase()
            .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width cleanup
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')     // remove punctuation (unicode aware)
            .replace(/\s+/g, ' ')
            .trim();
    }

    function tokenize(s) {
        const t = normalizeText(s);
        if (!t) return [];
        return t.split(' ').filter(Boolean);
    }

    // safe LCS (longest common subsequence) length implementation
    function lcsLength(a, b) {
        a = ensureString(a);
        b = ensureString(b);
        const n = a.length;
        const m = b.length;
        if (n === 0 || m === 0) return 0;

        // If strings are long, operate on tokens instead to reduce complexity
        if (n > 300 || m > 300) {
            const ta = tokenize(a);
            const tb = tokenize(b);
            const na = ta.length;
            const nb = tb.length;
            if (na === 0 || nb === 0) return 0;
            // DP table (token-level)
            const dp = Array.from({ length: na + 1 }, () => new Array(nb + 1).fill(0));
            for (let i = 1; i <= na; i++) {
                for (let j = 1; j <= nb; j++) {
                    if (ta[i - 1] === tb[j - 1]) {
                        dp[i][j] = dp[i - 1][j - 1] + 1;
                    } else {
                        dp[i][j] = dp[i - 1][j] > dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
                    }
                }
            }
            return dp[na][nb];
        }

        // character-based LCS (classic DP)
        const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
        for (let i = 1; i <= n; i++) {
            const ai = a.charAt(i - 1);
            for (let j = 1; j <= m; j++) {
                if (ai === b.charAt(j - 1)) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = dp[i - 1][j] > dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
                }
            }
        }
        return dp[n][m];
    }

    // token overlap: Jaccard-like
    function tokenOverlapScore(a, b) {
        const A = new Set(tokenize(a));
        const B = new Set(tokenize(b));
        if (A.size === 0 || B.size === 0) return 0;
        let inter = 0;
        for (const x of A) if (B.has(x)) inter++;
        const union = new Set([...A, ...B]).size;
        return inter / union; // 0..1
    }

    // LCS ratio normalized
    function lcsRatio(a, b) {
        const len = lcsLength(a, b);
        const maxLen = Math.max(ensureString(a).length, ensureString(b).length) || 1;
        return Math.min(1, len / maxLen);
    }

    // keyword hit: count how many keywords from an entry exist in text
    function keywordHitScore(text, entry) {
        const txt = normalizeText(text);
        if (!entry || !entry.keywords || entry.keywords.length === 0) return 0;
        let hits = 0;
        for (const kw of entry.keywords) {
            if (!kw) continue;
            // escape and word-boundary aware
            const esc = String(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const rx = new RegExp('\\b' + esc + '\\b', 'iu');
            if (rx.test(txt)) hits++;
        }
        if (hits === 0) return 0;
        return Math.min(1, hits / entry.keywords.length);
    }

    // score a candidate entry against query text
    function scoreCandidate(text, entry) {
        try {
            const a = ensureString(text);
            const b = ensureString(entry.title || entry.snippet || '');
            const tOverlap = tokenOverlapScore(a, b);
            const lcsR = lcsRatio(a, b);
            const kHit = keywordHitScore(a, entry);
            const score =
                (CFG.tokenOverlapWeight * tOverlap) +
                (CFG.lcsWeight * lcsR) +
                (CFG.keywordHitWeight * kHit);
            return {
                score,
                components: { tokenOverlap: tOverlap, lcs: lcsR, keywordHit: kHit }
            };
        } catch (err) {
            console.warn('scoreCandidate error', err);
            return { score: 0, components: {} };
        }
    }

    // -------------------------
    // Intent detection (from intent_keywords_fa.json)
    // Robust loader + detector
    // -------------------------
    async function _loadIntentKeywords(path = 'assets/intent_keywords_fa.json') {
        try {
            const r = await fetch(path, { cache: 'no-cache' });
            if (!r.ok) {
                console.warn('KnowledgeEngine: intent file not found (status ' + r.status + ') at', path);
                _intentKeywords = [];
                return _intentKeywords;
            }
            const json = await r.json();
            // Support both { "intents": [...] } and direct array [...]
            let rawIntents = [];
            if (Array.isArray(json)) {
                rawIntents = json;
            } else if (json && Array.isArray(json.intents)) {
                rawIntents = json.intents;
            } else {
                console.warn('KnowledgeEngine: intent file structure unexpected, using fallback empty array.', json);
                rawIntents = [];
            }

            // defensive normalization
            _intentKeywords = rawIntents.map((it, idx) => {
                if (!it || typeof it !== 'object') {
                    return { id: `intent_${idx}`, title_fa: '', keywords: [], priority: 0 };
                }
                const kws = Array.isArray(it.keywords) ? it.keywords.slice() :
                    (it.keywords ? [String(it.keywords)] : []);
                return {
                    id: it.id || it.name || (`intent_${idx}`),
                    title_fa: it.title_fa || it.title || '',
                    keywords: kws.map(k => String(k)),
                    priority: typeof it.priority === 'number' ? it.priority : 0
                };
            });

            console.log('KnowledgeEngine: intent keywords loaded:', _intentKeywords.length);
            return _intentKeywords;
        } catch (err) {
            console.warn('KnowledgeEngine: failed to load intent keywords:', err);
            _intentKeywords = [];
            return _intentKeywords;
        }
    }

    function detectIntent(text) {
        try {
            if (!text) return null;
            const t = normalizeText(text);
            if (!t) return null;
            if (!Array.isArray(_intentKeywords) || _intentKeywords.length === 0) {
                // no intents loaded — caller should fallback
                return null;
            }
            // iterate intents (could sort by priority if desired)
            for (const intent of _intentKeywords) {
                if (!intent || !Array.isArray(intent.keywords) || intent.keywords.length === 0) continue;
                const parts = intent.keywords
                    .map(k => (String(k) || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                    .filter(Boolean);
                if (parts.length === 0) continue;
                const rx = new RegExp('\\b(' + parts.join('|') + ')\\b', 'iu');
                if (rx.test(t)) {
                    return intent.id || null;
                }
            }
            return null;
        } catch (err) {
            console.warn('KnowledgeEngine.detectIntent error:', err);
            return null;
        }
    }

    // -------------------------
    // KB load / init
    // -------------------------
    async function init(kbPath = '/assets/knowledge_base_fa.json', opts = {}) {
        _kbPath = kbPath;
        _kb = [];
        _indexInitialized = false;

        // load intents first (best-effort)
        await _loadIntentKeywords('assets/intent_keywords_fa.json').catch(() => null);

        if (!kbPath) {
            console.warn('KnowledgeEngine.init called with empty path.');
            return { ok: false, reason: 'empty_path' };
        }

        try {
            const res = await fetch(kbPath, { cache: 'no-cache' });
            if (!res.ok) {
                throw new Error('KB fetch failed: ' + res.status);
            }
            const json = await res.json();
            // accept several shapes
            if (Array.isArray(json)) {
                _kb = json;
            } else if (json && Array.isArray(json.items)) {
                _kb = json.items;
            } else if (json && json.knowledge) {
                _kb = json.knowledge;
            } else if (json && json.industries) {
                const arr = [];
                for (const k in json.industries) {
                    const item = json.industries[k];
                    arr.push(Object.assign({ id: k }, item));
                }
                _kb = arr;
            } else if (typeof json === 'object') {
                // attempt to coerce object values into array
                _kb = Array.isArray(Object.values(json)) ? Object.values(json) : [];
            } else {
                _kb = [];
            }

            // normalize entries
            _kb = _kb.map((it, idx) => {
                const out = Object.assign({}, it);
                out.id = out.id || out.code || (`kb_${idx}`);
                out.title = ensureString(out.title || out.name_fa || out.name || '');
                out.snippet = ensureString(out.snippet || out.description || out.desc || '');
                out.url = ensureString(out.url || out.link || '');
                out.type = ensureString(out.type || out.meta?.type || '');
                out.keywords = Array.isArray(out.keywords)
                    ? out.keywords.map(k => ensureString(k))
                    : (out.keywords ? [ensureString(out.keywords)] : []);
                if (!out.keywords || out.keywords.length === 0) {
                    const tk = tokenize(out.title).slice(0, 8);
                    out.keywords = tk;
                }
                return out;
            });

            _indexInitialized = true;
            console.log(`KnowledgeEngine: loaded KB — entries: ${_kb.length}`);
            return { ok: true, count: _kb.length };
        } catch (err) {
            console.error('KnowledgeEngine.init error:', err);
            _kb = [];
            _indexInitialized = false;
            return { ok: false, error: String(err) };
        }
    }

    // -------------------------
    // Query KB
    // -------------------------
    async function query(text, options = {}) {
        const topN = (options && options.topN) || CFG.defaultTopN;
        const raw = ensureString(text);
        if (!raw) return [];

        // lazy load intents if absent
        if (!Array.isArray(_intentKeywords) || _intentKeywords.length === 0) {
            _loadIntentKeywords('assets/intent_keywords_fa.json').catch(() => null);
        }

        // lazy init KB if not yet
        if (!_indexInitialized && _kbPath) {
            await init(_kbPath).catch(() => null);
        }

        try {
            const results = [];
            for (const entry of _kb) {
                const sc = scoreCandidate(raw, entry);
                if (sc.score >= CFG.minScoreThreshold) {
                    results.push({
                        id: entry.id,
                        title: entry.title,
                        snippet: entry.snippet,
                        url: entry.url,
                        type: entry.type || entry.meta?.type || '',
                        score: sc.score,
                        components: sc.components,
                        meta: entry.meta || {}
                    });
                }
            }

            results.sort((a, b) => b.score - a.score);

            // fallback substring match if nothing found
            if (results.length === 0) {
                const t = normalizeText(raw);
                for (const entry of _kb) {
                    const hay = normalizeText((entry.title + ' ' + entry.snippet + ' ' + (entry.keywords || []).join(' ')));
                    if (t && hay.indexOf(t) !== -1) {
                        results.push({
                            id: entry.id,
                            title: entry.title,
                            snippet: entry.snippet,
                            url: entry.url,
                            type: entry.type || '',
                            score: 0.05,
                            components: { fallback: true },
                            meta: entry.meta || {}
                        });
                    }
                }
                results.sort((a, b) => b.score - a.score || a.title.length - b.title.length);
            }

            return results.slice(0, topN);
        } catch (err) {
            console.error('KnowledgeEngine.query error:', err);
            return [];
        }
    }

    // thin isKBQuestion wrapper using intent detection + heuristics
    function isKBQuestion(text) {
        const t = normalizeText(text);
        if (!t) return false;
        // 1) detect intent via loaded intent keywords
        const intent = detectIntent(t);
        if (intent === 'knowledge') return true;
        // 2) check explicit KB words
        const kbWords = ['نمایندگی', 'آدرس', 'دفتر', 'پشتیبانی', 'تماس', 'شماره', 'قیمت', 'دیتاشیت', 'دیتا شیت', 'استاندارد', 'en388', 'en407', 'en511', 'iso'];
        for (const w of kbWords) {
            if (t.indexOf(w.toLowerCase()) !== -1) return true;
        }
        // 3) common info-question tokens
        const infoQ = /\b(چیست|چیه|کجاست|کجا|کدام|چه|چه‌جور|چطور)\b/iu;
        if (infoQ.test(t)) return true;
        return false;
    }

    // convenience: return best matches summarized
    async function bestMatches(text, n = 6) {
        const res = await query(text, { topN: n });
        return res.map(r => ({ id: r.id, title: r.title, snippet: r.snippet, url: r.url, score: r.score }));
    }

    // expose API
    const API = {
        init,
        query,
        isKBQuestion,
        bestMatches,
        detectIntent,
        _debug_state: () => ({
            kbCount: _kb.length,
            kbPath: _kbPath,
            intentsLoaded: Array.isArray(_intentKeywords) ? _intentKeywords.length : 0,
            indexInitialized: _indexInitialized
        })
    };

    window.KnowledgeEngine = API;

    // auto-init attempt (non-blocking): try to load default KB if available
    (async () => {
        try {
            // attempt to fetch intent keywords (best-effort)
            await _loadIntentKeywords('assets/intent_keywords_fa.json').catch(() => null);

            const testPath = '/assets/knowledge_base_fa.json';
            const r = await fetch(testPath, { method: 'HEAD' });
            if (r && r.ok) {
                await init(testPath).catch(() => null);
            }
        } catch (err) {
            // ignore silent
        }
    })();

})();
