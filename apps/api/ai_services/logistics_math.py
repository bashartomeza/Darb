"""Logistics math: modules 03 (batching), 04 (deviation), 07 (trust),
08 (fare) and 09 (geofence). Pure Python, no I/O, no third-party imports.

All monetary / efficiency / ETA figures are SIMULATION estimates.
"""
from __future__ import annotations

import math
from typing import Any, Optional, Tuple, TypedDict

Coordinate = Tuple[float, float]


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


# =============================================================================
# MODULE 03 - Combinatorial cargo batching
# =============================================================================
class ParcelOrder(TypedDict):
    order_id: str
    weight_kg: float
    volume_m3: float
    target_zone: str


class VehicleSpec(TypedDict):
    driver_id: str
    max_weight_capacity: float
    max_volume_capacity: float


MAX_DP_ROWS = 20                 # beyond this many rows in the zone -> greedy
_MAX_DP_STATE_SPACE = 3_000_000  # ~1-2 s worst case in pure Python
_CAPACITY_SCALE = 20             # 0.05 kg / 0.05 m3 grid
SAVINGS_FLOOR_PERCENT = 20.0
SAVINGS_CEILING_PERCENT = 40.0


def _exact_scale(values: list[float], max_scale: int = 10_000) -> int | None:
    """Smallest power of ten making every value an integer (None if not possible)."""
    scale = 1
    while scale <= max_scale:
        if all(abs(v * scale - round(v * scale)) < 1e-6 for v in values):
            return scale
        scale *= 10
    return None


def _grid(values: list[float], capacity: float) -> tuple[int, bool]:
    """(scale, exact). Exact when every number lands on the grid; else a coarse conservative grid."""
    exact = _exact_scale(values + [capacity])
    return (exact, True) if exact else (_CAPACITY_SCALE, False)


def _units_up(value: float, scale: int) -> int:
    """Item size on the integer grid, rounded UP (never under-count)."""
    return int(math.ceil(value * scale - 1e-9))


def _units_down(value: float, scale: int) -> int:
    """Capacity on the integer grid, rounded DOWN (never over-promise room)."""
    return int(math.floor(value * scale + 1e-9))


def _greedy_first_fit(zone_orders: list[ParcelOrder], vehicle: VehicleSpec) -> list[ParcelOrder]:
    """First-Fit over items sorted smallest-first (maximises parcel COUNT)."""
    cap_w = max(float(vehicle["max_weight_capacity"]), 1e-9)
    cap_v = max(float(vehicle["max_volume_capacity"]), 1e-9)
    ordered = sorted(zone_orders, key=lambda o: o["weight_kg"] / cap_w + o["volume_m3"] / cap_v)
    remaining_w, remaining_v = vehicle["max_weight_capacity"], vehicle["max_volume_capacity"]
    batched: list[ParcelOrder] = []
    for order in ordered:
        if order["weight_kg"] <= remaining_w + 1e-9 and order["volume_m3"] <= remaining_v + 1e-9:
            batched.append(order)
            remaining_w -= order["weight_kg"]
            remaining_v -= order["volume_m3"]
    return batched


def _solve_knapsack_dp(zone_orders: list[ParcelOrder], vehicle: VehicleSpec) -> tuple[list[ParcelOrder], bool] | None:
    """Exact 0/1 knapsack on two capacity dimensions, maximising item count.

    Returns (selection, grid_is_exact) or None when the state space is too big.
    """
    n = len(zone_orders)
    if n == 0:
        return None
    w_scale, w_exact = _grid([o["weight_kg"] for o in zone_orders], vehicle["max_weight_capacity"])
    v_scale, v_exact = _grid([o["volume_m3"] for o in zone_orders], vehicle["max_volume_capacity"])
    weight_cap = _units_down(vehicle["max_weight_capacity"], w_scale)
    volume_cap = _units_down(vehicle["max_volume_capacity"], v_scale)
    if (n + 1) * (weight_cap + 1) * (volume_cap + 1) > _MAX_DP_STATE_SPACE:
        # Exact grid too large: retry on the coarse conservative grid before giving up.
        w_scale = v_scale = _CAPACITY_SCALE
        w_exact = v_exact = False
        weight_cap = _units_down(vehicle["max_weight_capacity"], w_scale)
        volume_cap = _units_down(vehicle["max_volume_capacity"], v_scale)
        if (n + 1) * (weight_cap + 1) * (volume_cap + 1) > _MAX_DP_STATE_SPACE:
            return None
    weights = [_units_up(o["weight_kg"], w_scale) for o in zone_orders]
    volumes = [_units_up(o["volume_m3"], v_scale) for o in zone_orders]
    dp = [[0] * (volume_cap + 1) for _ in range(weight_cap + 1)]
    keep = [[bytearray(volume_cap + 1) for _ in range(weight_cap + 1)] for _ in range(n)]
    for i in range(n):
        w_i, v_i = weights[i], volumes[i]
        if w_i > weight_cap or v_i > volume_cap:
            continue
        for w in range(weight_cap, w_i - 1, -1):
            row, prev_row, keep_row = dp[w], dp[w - w_i], keep[i][w]
            for v in range(volume_cap, v_i - 1, -1):
                candidate = prev_row[v - v_i] + 1
                if candidate > row[v]:
                    row[v] = candidate
                    keep_row[v] = 1
    selected: list[ParcelOrder] = []
    w, v = weight_cap, volume_cap
    for i in range(n - 1, -1, -1):
        if keep[i][w][v]:
            selected.append(zone_orders[i])
            w -= weights[i]
            v -= volumes[i]
    selected.reverse()
    return selected, (w_exact and v_exact)


def _valid_order(o: Any) -> bool:
    return (isinstance(o, dict) and isinstance(o.get("order_id"), str)
            and _finite(o.get("weight_kg")) and o["weight_kg"] >= 0
            and _finite(o.get("volume_m3")) and o["volume_m3"] >= 0)


def smart_cargo_batching(orders_pool: list[ParcelOrder], vehicle: VehicleSpec, target_zone: str) -> dict:
    zone_orders = [o for o in orders_pool if _valid_order(o) and o.get("target_zone") == target_zone]
    rejected = sum(1 for o in orders_pool if not _valid_order(o))

    if not (_finite(vehicle.get("max_weight_capacity")) and _finite(vehicle.get("max_volume_capacity"))
            and vehicle["max_weight_capacity"] > 0 and vehicle["max_volume_capacity"] > 0):
        return {"status": "REJECTED_INVALID_VEHICLE", "assigned_driver": vehicle.get("driver_id"),
                "target_zone": target_zone, "total_batched_orders": 0, "batched_order_ids": []}

    if len(zone_orders) > MAX_DP_ROWS:
        batched, algorithm = _greedy_first_fit(zone_orders, vehicle), "GREEDY_FIRST_FIT_ROW_GUARD"
    else:
        dp_result = _solve_knapsack_dp(zone_orders, vehicle)
        if dp_result is None:
            batched, algorithm = _greedy_first_fit(zone_orders, vehicle), "GREEDY_FIRST_FIT_STATE_SPACE_GUARD"
        else:
            batched, exact_grid = dp_result
            algorithm = "EXACT_DP_KNAPSACK" if exact_grid else "DP_KNAPSACK_CONSERVATIVE_GRID"

    used_weight = sum(o["weight_kg"] for o in batched)
    used_volume = sum(o["volume_m3"] for o in batched)
    weight_util = used_weight / vehicle["max_weight_capacity"]
    volume_util = used_volume / vehicle["max_volume_capacity"]
    density = min(max((weight_util + volume_util) / 2.0, 0.0), 1.0)
    savings = round(SAVINGS_FLOOR_PERCENT + (SAVINGS_CEILING_PERCENT - SAVINGS_FLOOR_PERCENT) * density, 2) if batched else 0.0
    efficiency = round(weight_util * 100, 2)

    return {
        "status": "BATCH_COMPUTED" if batched else "NO_MATCHING_ORDERS",
        "assigned_driver": vehicle["driver_id"],
        "target_zone": target_zone,
        "total_batched_orders": len(batched),
        "payload_weight_efficiency": efficiency,
        "weight_efficiency_percentage": efficiency,          # legacy key (kept for existing consumers)
        "volume_efficiency_percentage": round(volume_util * 100, 2),
        "batch_density": round(density, 4),
        "projected_savings_percentage": savings,
        "batched_order_ids": [o["order_id"] for o in batched],
        "batching_algorithm_used": algorithm,
        "rows_considered": len(zone_orders),
        "rows_rejected_invalid": rejected,
        "simulation_caveat": ("projected_savings_percentage is a simulation estimate scaled 20-40% by batch "
                              "density, not a measured production cost figure."),
    }


def simulated_savings_percentage(batched_count: int, capacity_count: int) -> float:
    """Density-scaled 20-40% savings used by UI directives when only counts exist."""
    if batched_count <= 0 or capacity_count <= 0:
        return 0.0
    density = min(batched_count / capacity_count, 1.0)
    return round(SAVINGS_FLOOR_PERCENT + (SAVINGS_CEILING_PERCENT - SAVINGS_FLOOR_PERCENT) * density, 2)


# =============================================================================
# MODULE 04 - Polyline-aware route deviation
# =============================================================================
MAX_ALLOWED_DEVIATION_KM = 5.0
DEVIATION_THRESHOLD_KM = MAX_ALLOWED_DEVIATION_KM  # legacy alias
_DETOUR_APPROXIMATION_FACTOR = 1.3


def _valid_coord(c: Any) -> bool:
    return (isinstance(c, (tuple, list)) and len(c) == 2 and _finite(c[0]) and _finite(c[1])
            and -90.0 <= c[0] <= 90.0 and -180.0 <= c[1] <= 180.0)


def haversine_km(c1: Coordinate, c2: Coordinate) -> float:
    radius = 6371.0
    lat1, lon1 = c1
    lat2, lon2 = c2
    p1, p2 = math.radians(lat1), math.radians(lat2)
    d_phi, d_lambda = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(d_lambda / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def calculate_route_deviation(driver_gps: Coordinate, pickup_gps: Coordinate,
                              primary_route_matrix: list[Coordinate]) -> dict:
    if not (_valid_coord(driver_gps) and _valid_coord(pickup_gps)):
        return {"dispatch_status": "REJECTED_INVALID_COORDINATES", "is_within_allowed_limit": False,
                "calculated_deviation_km": None, "target_threshold_limit_km": MAX_ALLOWED_DEVIATION_KM}

    route = [tuple(p) for p in (primary_route_matrix or []) if _valid_coord(p)]
    to_pickup = haversine_km(driver_gps, pickup_gps)

    if not route:
        deviation = round(to_pickup * _DETOUR_APPROXIMATION_FACTOR, 3)
        algorithm = "FALLBACK_STRAIGHT_LINE_FACTOR"
    else:
        # Full traversal of every polyline vertex; closest to the NEW pickup.
        closest = min(route, key=lambda wp: haversine_km(pickup_gps, wp))
        pickup_to_wp = haversine_km(pickup_gps, closest)
        driver_to_wp = haversine_km(driver_gps, closest)
        deviation = round(max((to_pickup + pickup_to_wp) - driver_to_wp, 0.0), 3)
        algorithm = "POLYLINE_CLOSEST_WAYPOINT"

    ok = deviation <= MAX_ALLOWED_DEVIATION_KM
    return {
        "calculated_deviation_km": deviation,
        "distance_to_new_pickup_km": round(to_pickup, 3),
        "target_threshold_limit_km": MAX_ALLOWED_DEVIATION_KM,
        "is_within_allowed_limit": ok,
        "dispatch_status": "APPROVED_FOR_DISPATCH" if ok else "REJECTED_DEVIATION_TOO_HIGH",
        "route_points_considered": len(route),
        "deviation_algorithm_used": algorithm,
        "approximation_caveat": ("Vertex-based approximation, not road-network routing. Replace with the "
                                 "routing provider's geometry (see M7D Valhalla evaluation)."),
    }


# =============================================================================
# MODULE 07 - Composite trust score
# =============================================================================
WEIGHT_STARS = 0.40
WEIGHT_DELAY = 0.30
WEIGHT_CANCEL = 0.30
assert abs(WEIGHT_STARS + WEIGHT_DELAY + WEIGHT_CANCEL - 1.0) < 1e-9, "Trust weights must sum to 1.0"
NEW_DRIVER_BASELINE_SCORE = 100.0


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def calculate_composite_trust(metrics: dict) -> dict:
    stars = metrics.get("historical_stars")
    delay = metrics.get("delay_rate")
    cancel = metrics.get("cancellation_rate")
    missing = [not _finite(x) for x in (stars, delay, cancel)]
    all_missing = all(missing)

    stars_v = 5.0 if not _finite(stars) else _clamp(float(stars), 0.0, 5.0)
    delay_v = 0.0 if not _finite(delay) else _clamp(float(delay), 0.0, 1.0)
    cancel_v = 0.0 if not _finite(cancel) else _clamp(float(cancel), 0.0, 1.0)

    if all_missing:
        score = NEW_DRIVER_BASELINE_SCORE
    else:
        score = ((stars_v / 5.0) * 100.0 * WEIGHT_STARS
                 + (1.0 - delay_v) * 100.0 * WEIGHT_DELAY
                 + (1.0 - cancel_v) * 100.0 * WEIGHT_CANCEL)
    score = round(_clamp(score, 0.0, 100.0), 2)

    if score >= 85:
        tier, priority = "ELITE_TRUST", "HIGHEST"
    elif score >= 60:
        tier, priority = "STANDARD_TRUST", "NORMAL"
    else:
        tier, priority = "SUSPENDED_RISK", "HOLD_FOR_REVIEW"
    return {
        "driver_id": metrics.get("driver_id"),
        "composite_trust_score": score,
        "operational_safety_tier": tier,
        "dispatch_priority": priority,
        "is_new_driver_baseline": all_missing,
        "missing_metric_count": sum(missing),
        "system_status": "SCORE_COMPUTED",
    }


# =============================================================================
# MODULE 08 - Route-based fare control
# =============================================================================
# ILLUSTRATIVE values: replace with the officially published tariff table
# before any real use. Pricing is also gated OFF in production by the project.
MINISTRY_BASE_FARES: dict[str, float] = {
    "ramallah_to_nablus": 25.0,
    "hebron_to_bethlehem": 15.0,
    "jenin_to_ramallah": 40.0,
}
ROUTE_ALIASES: dict[str, str] = {
    # canonical Masari corridor key -> tariff key
    "hebron_ppu_bab_al_zawiya_to_bethlehem": "hebron_to_bethlehem",
}
COMPENSATION_PER_MINUTE_MULTIPLIER = 0.50
MAX_COMPENSATION_CAP = 30.0


def enforce_route_based_fare(route_name: str, live_checkpoint_delay_mins: float) -> dict:
    key = str(route_name or "").strip().lower().replace(" ", "_").replace("-", "_")
    key = ROUTE_ALIASES.get(key, key)
    base_fare = MINISTRY_BASE_FARES.get(key)
    if base_fare is None:
        return {"route_status": "REJECTED_INVALID_ROUTE",
                "error_log": f"Route '{route_name}' is not a registered tariff route."}

    note = None
    delay = live_checkpoint_delay_mins
    if not _finite(delay):
        delay, note = 0.0, "live_checkpoint_delay_mins was missing or non-finite; reset to 0.0."
    elif delay < 0:
        note, delay = f"live_checkpoint_delay_mins was negative ({delay}); reset to 0.0.", 0.0

    raw_premium = float(delay) * COMPENSATION_PER_MINUTE_MULTIPLIER
    premium = round(min(raw_premium, MAX_COMPENSATION_CAP), 2)
    result = {
        "route_status": "FARE_LOCKED",
        "route_name_verified": key,
        "ministry_standard_base_fare": base_fare,
        "external_api_delay_minutes": live_checkpoint_delay_mins,
        "automated_checkpoint_premium_added": premium,
        "final_non_negotiable_fare_simulation": round(base_fare + premium, 2),
        "billing_interface_mode": "FIXED_NON_NEGOTIABLE",
        "compensation_cap_triggered": raw_premium > MAX_COMPENSATION_CAP,
        "max_compensation_cap": MAX_COMPENSATION_CAP,
    }
    if note:
        result["delay_anomaly_note"] = note
    return result


# =============================================================================
# MODULE 09 - Zero-knowledge privacy geofencing
# =============================================================================
# ARCHITECTURE RULE: this function must run ON THE DEVICE (see
# apps/mobile/lib/features/ai_directives/edge_geofence.dart for the shipped
# edge implementation). The server-side copy exists for tests/parity only and
# must never be fed raw GPS from the network: use `assert_no_raw_gps`.
GEOFENCE_RADIUS_METERS = 100.0
MILESTONES_MANIFEST: dict[int, str] = {
    1: "DISPATCH_INITIATED",
    2: "PICKUP_GEOFENCE_TRIGGERED",
    3: "TRANSIT_IN_PROGRESS",
    4: "DESTINATION_GEOFENCE_TRIGGERED",
}
_GEOFENCE_DEPENDENT_MILESTONES = {2, 4}
# (min_lat, min_lon, max_lat, max_lon): negative / far-away coordinates are
# treated as spoofed for this Palestine-only deployment.
OPERATING_REGION_BBOX = (29.0, 33.5, 33.5, 36.5)
# SIMULATION MOCK TOKEN - NOT A CRYPTOGRAPHIC SIGNATURE. Production must use a
# server-verifiable HMAC/attestation; this string only documents the flow.
MOCK_TOKEN_PREFIX = "SIMULATION_MOCK_TOKEN_NOT_A_SIGNATURE"
RAW_GPS_KEYS = {"lat", "lng", "lon", "latitude", "longitude", "gps", "coordinates", "coords", "location"}


def haversine_meters(c1: Coordinate, c2: Coordinate) -> float:
    return haversine_km(c1, c2) * 1000.0


def _inside_region(c: Any) -> bool:
    if not _valid_coord(c):
        return False
    s, w, n, e = OPERATING_REGION_BBOX
    return s <= c[0] <= n and w <= c[1] <= e


def _tamper(reason: str) -> dict:
    return {"privacy_protocol": "RAW_GPS_STREAMING_BANNED", "system_integrity": "SECURITY_TAMPERING_BLOCKED",
            "cloud_database_update_allowed": False, "emitted_milestone_signal": "SECURITY_TAMPERING_BLOCKED",
            "tampering_reason": reason}


def evaluate_geofence_milestones(secret_driver_gps: Coordinate, geofence_center_gps: Coordinate,
                                 milestone_id: Optional[int] = None, *,
                                 current_milestone_id: Optional[int] = None) -> dict:
    milestone_id = milestone_id if milestone_id is not None else current_milestone_id
    if milestone_id not in MILESTONES_MANIFEST:
        return {"privacy_protocol": "RAW_GPS_STREAMING_BANNED", "system_integrity": "INVALID_MILESTONE_ID",
                "cloud_database_update_allowed": False, "emitted_milestone_signal": None}
    if not (_inside_region(secret_driver_gps) and _inside_region(geofence_center_gps)):
        return _tamper("Coordinates are corrupted, negative or outside the operating region.")

    distance = round(haversine_meters(secret_driver_gps, geofence_center_gps), 2)
    inside = distance <= GEOFENCE_RADIUS_METERS
    name = MILESTONES_MANIFEST[milestone_id]
    allowed = inside if milestone_id in _GEOFENCE_DEPENDENT_MILESTONES else True
    return {
        "privacy_protocol": "RAW_GPS_STREAMING_BANNED",
        "local_computed_distance_meters": distance,
        "geofence_perimeter_limit_meters": GEOFENCE_RADIUS_METERS,
        "is_inside_geofence_zone": inside,
        "cloud_database_update_allowed": allowed,
        "emitted_milestone_signal": f"{name}::{MOCK_TOKEN_PREFIX}_{name}" if allowed else "SILENT_HOLD",
        "system_integrity": "OK",
        "verification_token_is_placeholder": True,
        "verification_token_security_note": ("Simulation mock token, not a cryptographic signature."),
    }


def assert_no_raw_gps(payload: Any, _depth: int = 0) -> None:
    """Server-side ingestion guard: raise ValueError if a payload carries GPS."""
    if _depth > 6:
        return
    if isinstance(payload, dict):
        for key, value in payload.items():
            if str(key).lower() in RAW_GPS_KEYS:
                raise ValueError("RAW_GPS_STREAMING_BANNED")
            assert_no_raw_gps(value, _depth + 1)
    elif isinstance(payload, (list, tuple)):
        for item in payload:
            assert_no_raw_gps(item, _depth + 1)
