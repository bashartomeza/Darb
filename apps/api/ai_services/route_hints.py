"""Optional hint: which of Darb's predefined operating routes a request matches.

The Node API owns the route list (GET /api/v1/operating-routes, keys such as
`hebron-to-bethlehem`). The caller passes the routes it wants matched with each
analyze request; this module holds no route or city list of its own.

The hint never changes the user's typed text. It only reports a route key when
the typed pickup names the route's origin city and the typed destination names
its destination city.
"""
from __future__ import annotations

from typing import Any

from .spatial import normalize_ar

MAX_ROUTES = 100
_KEY_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789-")


def validate_routes(raw: Any) -> list[dict] | None:
    """Return a clean route list, or None when the input is malformed."""
    if not isinstance(raw, list) or len(raw) > MAX_ROUTES:
        return None
    clean: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            return None
        key, origin, destination = item.get("key"), item.get("origin_ar"), item.get("destination_ar")
        if not (isinstance(key, str) and 1 <= len(key) <= 80 and set(key) <= _KEY_CHARS):
            return None
        for value in (origin, destination):
            if not isinstance(value, str) or not 1 <= len(value.strip()) <= 60:
                return None
        clean.append({"key": key, "origin_ar": origin.strip(), "destination_ar": destination.strip()})
    return clean


def _mentions(text: str, city: str) -> bool:
    haystack, needle = f" {normalize_ar(text)} ", normalize_ar(city)
    # Whole word, allowing the one-letter Arabic prefixes people type ("للخليل", "ببيت لحم").
    return any(f" {prefix}{needle} " in haystack for prefix in ("", "ل", "ب", "و"))


def hint_route(pickup: str, destination: str, routes: list[dict]) -> dict | None:
    for route in routes:
        if _mentions(pickup, route["origin_ar"]) and _mentions(destination, route["destination_ar"]):
            return {"route_key": route["key"], "matched_on": "typed_origin_and_destination"}
    return None
