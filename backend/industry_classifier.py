"""
Industry classifier for Sigma Gloves.

- Reads industry definitions from data/industry_keywords.json
- Tries Ollama llama3.1:8b to pick the best industry for a free-text prompt
- Falls back to a heuristic scorer when Ollama is unavailable or uncertain
- CLI usage:

    python backend/industry_classifier.py "I need welding gloves"
    python backend/industry_classifier.py "مکانیک هستم" --no-llm

Output example (JSON):
{
  "code": "welding",
  "name_en": "Welding",
  "name_fa": "جوشکاری",
  "score": 0.94,
  "source": "llm",
  "reason": "Matched welding related terms"
}

The module does not require Ollama to be installed to run; it will gracefully
fall back to the heuristic matcher.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Dict, List, Optional

LOGGER = logging.getLogger(__name__)
DEFAULT_DATA_PATH = os.path.join("data", "industry_keywords.json")
DEFAULT_OLLAMA_MODEL = "llama3.1:8b"
DEFAULT_OLLAMA_HOST = "http://localhost:11434"


_ARABIC_MAP = str.maketrans({"ي": "ی", "ك": "ک", "أ": "ا", "إ": "ا", "آ": "ا", "ۀ": "ه", "ة": "ه"})
_NON_WORDS = re.compile(r"[^\u0600-\u06FFa-z0-9\s\-\/]+", re.IGNORECASE)
_MULTI_SPACE = re.compile(r"\s+")


def normalize_text(text: Optional[str]) -> str:
    """Normalize Persian/English text for robust matching."""
    if text is None:
        return ""
    s = str(text)
    s = s.translate(_ARABIC_MAP)
    s = s.lower()
    s = _NON_WORDS.sub(" ", s)
    s = s.replace("-", " ").replace("/", " ")
    s = _MULTI_SPACE.sub(" ", s).strip()
    return s


def tokens_of(text: Optional[str]) -> List[str]:
    return [t for t in normalize_text(text).split(" ") if len(t) >= 2]


@dataclass
class Industry:
    code: str
    name_fa: str
    name_en: str
    keywords_fa: List[str] = field(default_factory=list)
    keywords_en: List[str] = field(default_factory=list)
    samples_fa: List[str] = field(default_factory=list)
    samples_en: List[str] = field(default_factory=list)
    keyword_tokens: set = field(default_factory=set)
    sample_tokens: set = field(default_factory=set)
    phrases: List[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, object]) -> "Industry":
        keywords_fa = data.get("keywords_fa", []) or []
        keywords_en = data.get("keywords_en", []) or []
        samples_fa = data.get("samples_fa", []) or []
        samples_en = data.get("samples_en", []) or []
        all_keywords = keywords_fa + keywords_en
        all_samples = samples_fa + samples_en
        return cls(
            code=str(data.get("code", "")).strip(),
            name_fa=str(data.get("name_fa", "")).strip(),
            name_en=str(data.get("name_en", "")).strip(),
            keywords_fa=keywords_fa,
            keywords_en=keywords_en,
            samples_fa=samples_fa,
            samples_en=samples_en,
            keyword_tokens=set(tokens_of(" ".join(all_keywords))),
            sample_tokens=set(tokens_of(" ".join(all_samples))),
            phrases=[normalize_text(p) for p in (all_keywords + all_samples)],
        )


class IndustryClassifier:
    def __init__(
        self,
        data_path: str = DEFAULT_DATA_PATH,
        ollama_model: str = DEFAULT_OLLAMA_MODEL,
        ollama_host: str = DEFAULT_OLLAMA_HOST,
        timeout: int = 15,
    ) -> None:
        self.data_path = data_path
        self.ollama_model = ollama_model
        self.ollama_host = ollama_host.rstrip("/")
        self.timeout = timeout
        self.industries: List[Industry] = self._load_industries(data_path)
        self.index: Dict[str, Industry] = {ind.code: ind for ind in self.industries}

    # ---------- Public API ----------
    def classify_industry(self, prompt: str, use_llm: bool = True, min_llm_score: float = 0.28) -> Dict[str, object]:
        """Classify a user prompt into an industry."""
        normalized = normalize_text(prompt)
        token_set = set(tokens_of(prompt))

        heuristic_best = self._heuristic_best(normalized, token_set)
        best = heuristic_best

        if use_llm and prompt and self.industries:
            llm_pick = self._llm_pick(prompt, heuristic_best)
            if llm_pick and llm_pick.get("score", 0.0) >= min_llm_score:
                best = llm_pick

        return best

    # ---------- Loading ----------
    def _load_industries(self, path: str) -> List[Industry]:
        if not os.path.exists(path):
            raise FileNotFoundError(f"Industry data not found: {path}")
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        industries: List[Industry] = []
        for item in raw:
            ind = Industry.from_dict(item)
            if ind.code:
                industries.append(ind)
        return industries

    # ---------- Heuristic scorer ----------
    def _heuristic_best(self, normalized_text: str, token_set: set) -> Dict[str, object]:
        best = None
        best_score = -1.0
        for ind in self.industries:
            score = self._score_industry(ind, normalized_text, token_set)
            if score > best_score:
                best_score = score
                best = ind
        result = (
            self._build_result(best, best_score, source="heuristic")
            if best
            else {
                "code": None,
                "name_en": None,
                "name_fa": None,
                "score": 0.0,
                "source": "heuristic",
                "reason": "No industries found",
            }
        )
        return result

    def _score_industry(self, ind: Industry, normalized_text: str, token_set: set) -> float:
        phrase_hits = sum(1 for p in ind.phrases if p and p in normalized_text)
        keyword_hits = len(token_set & ind.keyword_tokens)
        sample_hits = len(token_set & ind.sample_tokens)
        length_bonus = min(len(ind.keyword_tokens) / 80.0, 0.2)
        score = phrase_hits * 1.4 + keyword_hits * 1.0 + sample_hits * 0.6 + length_bonus
        return score

    # ---------- Ollama LLM ----------
    def _llm_pick(self, user_text: str, heuristic_best: Dict[str, object]) -> Optional[Dict[str, object]]:
        catalog = "; ".join(f"{ind.code}: {ind.name_en}" for ind in self.industries)
        prompt = "You classify a short work description into an industry code for selecting protective gloves.\n" "Choose exactly one code from the catalog below. Respond with compact JSON only.\n" "Catalog: " + catalog + "\n" "Rules: If unsure, return code=null and confidence=0. Include a short reason." "User: " + user_text
        try:
            response_text = self._ollama_generate(prompt)
        except Exception as exc:  # noqa: BLE001
            LOGGER.debug("Ollama call failed: %s", exc)
            return None

        parsed = self._extract_json_obj(response_text)
        if not parsed or "code" not in parsed:
            return None

        code = parsed.get("code")
        confidence = float(parsed.get("confidence", 0) or 0)
        if not code:
            return None

        ind = self.index.get(str(code).strip())
        if not ind:
            return None

        score = max(confidence, 0.65)  # trust LLM a bit more when it is certain
        return self._build_result(ind, score, source="llm", reason=parsed.get("reason"))

    def _ollama_generate(self, prompt: str) -> str:
        payload = {
            "model": self.ollama_model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0},
        }
        data = json.dumps(payload).encode("utf-8")
        url = f"{self.ollama_host}/api/generate"
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            content = resp.read().decode("utf-8")
        parsed = json.loads(content)
        return parsed.get("response", "")

    # ---------- Helpers ----------
    def _extract_json_obj(self, text: str) -> Optional[Dict[str, object]]:
        if not text:
            return None
        # Try to find the first JSON object in the response
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None

    def _build_result(self, ind: Industry, score: float, source: str, reason: Optional[str] = None) -> Dict[str, object]:
        return {
            "code": ind.code,
            "name_en": ind.name_en,
            "name_fa": ind.name_fa,
            "score": round(float(score), 4),
            "source": source,
            "reason": reason or "",
        }


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Industry classifier CLI (Ollama + heuristic)")
    parser.add_argument("text", nargs="?", help="User prompt / job description")
    parser.add_argument("--data-path", default=DEFAULT_DATA_PATH, help="Path to industry_keywords.json")
    parser.add_argument("--ollama-host", default=DEFAULT_OLLAMA_HOST, help="Ollama host, e.g., http://localhost:11434")
    parser.add_argument("--model", default=DEFAULT_OLLAMA_MODEL, help="Ollama model name (default: llama3.1:8b)")
    parser.add_argument("--no-llm", action="store_true", help="Disable Ollama and use heuristic only")
    parser.add_argument("--min-llm-score", type=float, default=0.28, help="Minimum LLM score to override heuristic")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = _build_arg_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.debug else logging.INFO)

    if not args.text:
        parser.error('Please provide the user prompt text, e.g., python backend/industry_classifier.py "I need welding gloves"')

    classifier = IndustryClassifier(
        data_path=args.data_path,
        ollama_model=args.model,
        ollama_host=args.ollama_host,
    )

    result = classifier.classify_industry(args.text, use_llm=not args.no_llm, min_llm_score=args.min_llm_score)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
