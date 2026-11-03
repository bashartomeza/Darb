"""Spatial auto-correction of vernacular place names.

* Landmarks come from the OpenStreetMap Overpass API (mirror loop, cached on
  disk, refreshed at most once per TTL, failure back-off) with a static seed so
  the engine still works offline.
* Matching is a local Levenshtein distance on Arabic-normalised strings.

Design guard-rails (the original README forbids silent "semantic drift"):
  - a correction is only applied when the best match clears MIN_SIMILARITY AND
    beats the runner-up by AMBIGUITY_MARGIN;
  - the original text is always returned next to the corrected one.

NOTE ON "98%": that figure is an accuracy *target* to be measured with the
evaluation harness, not a similarity threshold. MIN_SIMILARITY is a tunable
(default 0.80: one wrong letter in a 5-8 letter name still matches).
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .provider_pool import ProviderError, http_get

MIN_SIMILARITY = float(os.environ.get("AI_SERVICES_SPATIAL_MIN_SIMILARITY", "0.80"))
AMBIGUITY_MARGIN = 0.05
LANDMARK_TTL_SECONDS = 24 * 3600
FAILURE_BACKOFF_SECONDS = 10 * 60

OVERPASS_MIRRORS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
# West Bank / corridor bounding box (south, west, north, east).
OVERPASS_BBOX = (31.20, 34.85, 32.60, 35.60)

# Offline seed only. Real coverage comes from Overpass; curate this list
# with the operations team before relying on it.
SEED_LANDMARKS: tuple[str, ...] = (
    "دوار المنارة",
    "دوار الساعة",
    "دوار الشهداء",
    "باب الزاوية",
    "جامعة بوليتكنك فلسطين",
    "جامعة بيت لحم",
    "شارع المهد",
    "دوار بيت جالا",
    "مجمع بيت لحم",
    "مجمع الخليل",
    "مكتب البريد المركزي",
)

_PREFIX_WORDS = ("دوار", "ميدان", "محطة", "مجمع", "شارع", "مستشفى", "جامعة", "مكتب", "بوابة")
_TASHKEEL = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")


def normalize_ar(text: str) -> str:
    text = _TASHKEEL.sub("", text)
    text = (text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
                .replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي"))
    return re.sub(r"\s+", " ", text).strip().lower()


def strip_prefix(normalized: str) -> str:
    words = normalized.split(" ")
    if len(words) > 1 and words[0] in {normalize_ar(w) for w in _PREFIX_WORDS}:
        return " ".join(words[1:])
    return normalized


def levenshtein(a: str, b: str) -> int:
    """Classic two-row dynamic-programming edit distance."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def similarity(a: str, b: str) -> float:
    longest = max(len(a), len(b))
    return 1.0 if longest == 0 else 1.0 - levenshtein(a, b) / longest


@dataclass(frozen=True)
class Correction:
    original: str
    corrected: str
    applied: bool
    similarity: float
    reason: str

    def as_dict(self) -> dict:
        return {"original": self.original, "corrected": self.corrected, "applied": self.applied,
                "similarity": round(self.similarity, 4), "reason": self.reason}


def correct_location(text: str, landmarks: list[str],
                     min_similarity: float | None = None) -> Correction:
    threshold = MIN_SIMILARITY if min_similarity is None else min_similarity
    original = text
    if not text or text == "Unspecified" or not landmarks:
        return Correction(original, original, False, 0.0, "not_applicable")

    query = strip_prefix(normalize_ar(text))
    scored: list[tuple[float, str]] = []
    for name in landmarks:
        full = normalize_ar(name)
        core = strip_prefix(full)
        scored.append((max(similarity(query, core), similarity(normalize_ar(text), full)), name))
    scored.sort(key=lambda item: item[0], reverse=True)
    best_score, best_name = scored[0]

    if best_score >= 0.9999:
        return Correction(original, best_name if normalize_ar(best_name) == normalize_ar(text) else original,
                          False, best_score, "exact_match")
    if best_score < threshold:
        return Correction(original, original, False, best_score, "below_threshold")
    if len(scored) > 1 and best_score - scored[1][0] < AMBIGUITY_MARGIN and scored[1][1] != best_name:
        return Correction(original, original, False, best_score, "ambiguous")
    return Correction(original, best_name, True, best_score, "levenshtein_corrected")


# --------------------------------------------------------------------------
# Overpass landmark provider
# --------------------------------------------------------------------------
def build_overpass_query(bbox: tuple[float, float, float, float] = OVERPASS_BBOX) -> str:
    s, w, n, e = bbox
    box = f"({s},{w},{n},{e})"
    return (
        "[out:json][timeout:25];("
        f'node["amenity"="bus_station"]["name"]{box};'
        f'node["public_transport"~"station|stop_position|platform"]["name"]{box};'
        f'node["highway"="bus_stop"]["name"]{box};'
        f'way["junction"="roundabout"]["name"]{box};'
        f'node["amenity"~"hospital|university|post_office"]["name"]{box};'
        ");out tags center 3000;"
    )


def parse_overpass(payload: dict) -> list[str]:
    names: list[str] = []
    for element in payload.get("elements", []):
        tags = element.get("tags") or {}
        for key in ("name:ar", "name"):
            value = tags.get(key)
            if isinstance(value, str) and re.search(r"[\u0600-\u06FF]", value) and 2 <= len(value) <= 60:
                if value not in names:
                    names.append(value.strip())
                break
    return names


class LandmarkProvider:
    def __init__(self, fetch: Callable[[str], bytes] | None = None,
                 cache_path: str | os.PathLike | None = None,
                 clock: Callable[[], float] = time.time, background: bool = False) -> None:
        self._background = background
        self._refreshing = False
        self._fetch = fetch or http_get
        default = Path(os.environ.get("AI_SERVICES_LANDMARK_CACHE", "")) if os.environ.get(
            "AI_SERVICES_LANDMARK_CACHE") else Path(os.environ.get("TMPDIR", "/tmp")) / "darb_landmarks.json"
        self._cache_path = Path(cache_path) if cache_path else default
        self._clock = clock
        self._lock = threading.Lock()
        self._names: list[str] | None = None
        self._loaded_at = 0.0
        self._failed_at = -FAILURE_BACKOFF_SECONDS
        self.source = "seed"

    def _load_disk(self) -> bool:
        try:
            data = json.loads(self._cache_path.read_text(encoding="utf-8"))
            names = [n for n in data["names"] if isinstance(n, str)]
            if names and self._clock() - float(data["fetched_at"]) < LANDMARK_TTL_SECONDS:
                self._names, self._loaded_at, self.source = names, float(data["fetched_at"]), "cache"
                return True
        except (OSError, ValueError, KeyError, TypeError):
            pass
        return False

    def _refresh_overpass(self) -> bool:
        from urllib.parse import quote
        query = quote(build_overpass_query())
        for mirror in OVERPASS_MIRRORS:  # the "Overpass loop"
            try:
                names = parse_overpass(json.loads(self._fetch(f"{mirror}?data={query}").decode("utf-8")))
            except (ProviderError, ValueError, UnicodeDecodeError):
                continue
            if names:
                self._names, self._loaded_at, self.source = names, self._clock(), "overpass"
                try:
                    self._cache_path.write_text(
                        json.dumps({"fetched_at": self._loaded_at, "names": names}, ensure_ascii=False),
                        encoding="utf-8")
                except OSError:
                    pass
                return True
        return False

    def _refresh_blocking(self) -> None:
        ok = self._load_disk() or self._refresh_overpass()
        with self._lock:
            if not ok:
                self._failed_at = self._clock()
            self._refreshing = False

    def get(self) -> list[str]:
        """Landmarks (seed + OSM). With background=True a stale cache never blocks a request."""
        start = False
        with self._lock:
            now = self._clock()
            fresh = self._names is not None and now - self._loaded_at < LANDMARK_TTL_SECONDS
            if not fresh and not self._refreshing and now - self._failed_at >= FAILURE_BACKOFF_SECONDS:
                self._refreshing = True
                start = True
        if start:
            if self._background:
                threading.Thread(target=self._refresh_blocking, daemon=True).start()
            else:
                self._refresh_blocking()
        with self._lock:
            names = list(self._names) if self._names else []
        return list(SEED_LANDMARKS) + [n for n in names if n not in SEED_LANDMARKS]


_DEFAULT_PROVIDER = LandmarkProvider(background=True)


def default_landmarks() -> list[str]:
    return _DEFAULT_PROVIDER.get()
