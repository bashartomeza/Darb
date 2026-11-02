import itertools
import math
import random

import pytest

from ai_services import logistics_math as lm
from ai_services.agent_orchestrator import generate_benchmark_matrix, run_simulator_benchmark


def _order(i, w, v, zone="Z"):
    return {"order_id": f"P{i}", "weight_kg": w, "volume_m3": v, "target_zone": zone}


def _brute_force_best(orders, cap_w, cap_v):
    best = 0
    for r in range(len(orders) + 1):
        for combo in itertools.combinations(orders, r):
            if sum(o["weight_kg"] for o in combo) <= cap_w + 1e-9 and sum(o["volume_m3"] for o in combo) <= cap_v + 1e-9:
                best = max(best, r)
    return best


# ------------------------------------------------------------------ 03
def test_dp_is_optimal_against_brute_force():
    rng = random.Random(7)
    for _ in range(25):
        orders = [_order(i, round(rng.uniform(0.5, 9), 1), round(rng.uniform(0.02, 0.4), 2)) for i in range(rng.randint(3, 9))]
        vehicle = {"driver_id": "D", "max_weight_capacity": 20.0, "max_volume_capacity": 0.8}
        result = lm.smart_cargo_batching(orders, vehicle, "Z")
        assert result["batching_algorithm_used"] == "EXACT_DP_KNAPSACK"
        assert result["total_batched_orders"] == _brute_force_best(orders, 20.0, 0.8)


def test_dp_never_exceeds_capacity_even_off_grid():
    orders = [_order(1, 0.0241, 0.0241), _order(2, 0.0241, 0.0241), _order(3, 0.0241, 0.0241)]
    vehicle = {"driver_id": "D", "max_weight_capacity": 0.05, "max_volume_capacity": 0.05}
    r = lm.smart_cargo_batching(orders, vehicle, "Z")
    assert r["total_batched_orders"] * 0.0241 <= 0.05 + 1e-9 and r["total_batched_orders"] == 2


def test_more_than_20_rows_falls_back_to_greedy_and_respects_capacity():
    orders = [_order(i, 1.0 + (i % 5) * 0.5, 0.05) for i in range(35)]
    vehicle = {"driver_id": "D", "max_weight_capacity": 30.0, "max_volume_capacity": 2.0}
    result = lm.smart_cargo_batching(orders, vehicle, "Z")
    assert result["batching_algorithm_used"] == "GREEDY_FIRST_FIT_ROW_GUARD"
    picked = [o for o in orders if o["order_id"] in result["batched_order_ids"]]
    assert sum(o["weight_kg"] for o in picked) <= 30.0 and result["total_batched_orders"] > 0


def test_only_matching_zone_is_considered_and_savings_scale_20_to_40():
    orders = [_order(1, 5, 0.1, "A"), _order(2, 5, 0.1, "B")]
    vehicle = {"driver_id": "D", "max_weight_capacity": 10.0, "max_volume_capacity": 0.2}
    full = lm.smart_cargo_batching(orders, vehicle, "A")
    assert full["batched_order_ids"] == ["P1"]
    assert 20.0 <= full["projected_savings_percentage"] <= 40.0
    low = lm.smart_cargo_batching([_order(1, 0.1, 0.001)], vehicle, "Z")
    assert low["projected_savings_percentage"] == pytest.approx(20.0, abs=0.7)
    assert lm.smart_cargo_batching([], vehicle, "Z")["projected_savings_percentage"] == 0.0
    assert "payload_weight_efficiency" in full


def test_invalid_rows_and_vehicle_are_rejected_not_crashed():
    vehicle = {"driver_id": "D", "max_weight_capacity": 10.0, "max_volume_capacity": 1.0}
    r = lm.smart_cargo_batching([_order(1, float("nan"), 0.1), {"junk": 1}, _order(2, 2, 0.1)], vehicle, "Z")
    assert r["batched_order_ids"] == ["P2"] and r["rows_rejected_invalid"] == 2
    assert lm.smart_cargo_batching([], {"driver_id": "D", "max_weight_capacity": 0, "max_volume_capacity": 1}, "Z")["status"] == "REJECTED_INVALID_VEHICLE"


# ------------------------------------------------------------------ 04
HEBRON = (31.5326, 35.0998)
ROUTE = [(31.5326, 35.0998), (31.6200, 35.1500), (31.7054, 35.2024)]


def test_deviation_polyline_marginal_math_matches_spec_formula():
    driver, pickup = (31.5400, 35.1000), (31.6150, 35.1450)
    r = lm.calculate_route_deviation(driver, pickup, ROUTE)
    wp = min(ROUTE, key=lambda p: lm.haversine_km(pickup, p))
    expected = lm.haversine_km(driver, pickup) + lm.haversine_km(pickup, wp) - lm.haversine_km(driver, wp)
    assert r["calculated_deviation_km"] == pytest.approx(max(expected, 0), abs=1e-3)
    assert r["dispatch_status"] == "APPROVED_FOR_DISPATCH"


def test_far_pickup_is_vetoed_and_empty_route_uses_fallback():
    far = lm.calculate_route_deviation(HEBRON, (32.2211, 35.2544), ROUTE)
    assert far["dispatch_status"] == "REJECTED_DEVIATION_TOO_HIGH" and far["target_threshold_limit_km"] == 5.0
    empty = lm.calculate_route_deviation(HEBRON, (31.55, 35.12), [])
    assert empty["deviation_algorithm_used"] == "FALLBACK_STRAIGHT_LINE_FACTOR"


def test_deviation_rejects_corrupt_coordinates():
    assert lm.calculate_route_deviation((999, 0), HEBRON, ROUTE)["dispatch_status"] == "REJECTED_INVALID_COORDINATES"
    assert lm.calculate_route_deviation(HEBRON, (float("nan"), 1), ROUTE)["dispatch_status"] == "REJECTED_INVALID_COORDINATES"


# ------------------------------------------------------------------ 05
def test_simulator_floor_and_gain_math():
    orders, drivers = generate_benchmark_matrix()
    r = run_simulator_benchmark(orders, drivers, strict=True)
    assert (r["processed_orders_count"], r["processed_drivers_count"]) == (10, 5)
    assert r["high_urgency_orders_detected"] == 3 and r["ai_system_simulated_target_eta_mins"] == pytest.approx(7.1)
    assert r["projected_time_saved_mins"] == pytest.approx(4.9) and r["simulated_efficiency_gain_percentage"] == pytest.approx(40.83)
    flood = run_simulator_benchmark([{"order_id": str(i), "urgency": "High"} for i in range(30)], drivers)
    assert flood["ai_system_simulated_target_eta_mins"] == 4.5 and flood["eta_floor_reached"]
    with pytest.raises(ValueError):
        run_simulator_benchmark(orders[:3], drivers, strict=True)


# ------------------------------------------------------------------ 07
def test_trust_weights_new_driver_and_clamping():
    perfect = lm.calculate_composite_trust({"driver_id": "a", "historical_stars": 5, "delay_rate": 0, "cancellation_rate": 0})
    assert perfect["composite_trust_score"] == 100.0
    mid = lm.calculate_composite_trust({"driver_id": "b", "historical_stars": 2.5, "delay_rate": 0.5, "cancellation_rate": 0.5})
    assert mid["composite_trust_score"] == pytest.approx(50.0)           # .4*50 + .3*50 + .3*50
    new = lm.calculate_composite_trust({"driver_id": "c", "historical_stars": None, "delay_rate": None, "cancellation_rate": None})
    assert new["composite_trust_score"] == 100.0 and new["is_new_driver_baseline"]
    dirty = lm.calculate_composite_trust({"driver_id": "d", "historical_stars": 7.2, "delay_rate": -0.1, "cancellation_rate": float("nan")})
    assert 0.0 <= dirty["composite_trust_score"] <= 100.0 and dirty["composite_trust_score"] == 100.0


# ------------------------------------------------------------------ 08
def test_fare_locked_premium_cap_and_negative_reset():
    r = lm.enforce_route_based_fare("Ramallah To Nablus", 12.0)
    assert r["automated_checkpoint_premium_added"] == 6.0 and r["final_non_negotiable_fare_simulation"] == 31.0
    capped = lm.enforce_route_based_fare("ramallah_to_nablus", 500.0)
    assert capped["automated_checkpoint_premium_added"] == 30.0 and capped["compensation_cap_triggered"]
    neg = lm.enforce_route_based_fare("ramallah_to_nablus", -15.0)
    assert neg["automated_checkpoint_premium_added"] == 0.0 and "delay_anomaly_note" in neg
    assert lm.enforce_route_based_fare("ramallah_to_nablus", float("inf"))["automated_checkpoint_premium_added"] == 0.0
    assert lm.enforce_route_based_fare("Gaza_To_Jerusalem", 1)["route_status"] == "REJECTED_INVALID_ROUTE"


def test_canonical_corridor_key_maps_to_tariff():
    r = lm.enforce_route_based_fare("hebron-ppu-bab-al-zawiya-to-bethlehem", 0)
    assert r["route_status"] == "FARE_LOCKED" and r["ministry_standard_base_fare"] == 15.0


# ------------------------------------------------------------------ 09
CENTER = (31.9038, 35.2034)


def test_geofence_milestones_and_tamper_blocking():
    inside = lm.evaluate_geofence_milestones((31.90385, 35.20345), CENTER, 2)
    assert inside["cloud_database_update_allowed"] and "SIMULATION_MOCK_TOKEN" in inside["emitted_milestone_signal"]
    assert lm.evaluate_geofence_milestones((31.92, 35.22), CENTER, 2)["emitted_milestone_signal"] == "SILENT_HOLD"
    assert lm.evaluate_geofence_milestones((31.92, 35.22), CENTER, 3)["cloud_database_update_allowed"]      # not geofence-bound
    for bad in [(-31.9, 35.2), (999.0, 35.2), (float("nan"), 35.2), (0.0, 0.0)]:
        assert lm.evaluate_geofence_milestones(bad, CENTER, 2)["emitted_milestone_signal"] == "SECURITY_TAMPERING_BLOCKED"
    assert lm.evaluate_geofence_milestones(CENTER, CENTER, 9)["system_integrity"] == "INVALID_MILESTONE_ID"
    assert lm.evaluate_geofence_milestones(CENTER, CENTER, current_milestone_id=1)["system_integrity"] == "OK"   # legacy kwarg


def test_server_ingestion_guard_refuses_raw_gps():
    for payload in ({"lat": 31.9}, {"a": {"coordinates": [1, 2]}}, [{"gps": 1}], {"Longitude": 5}):
        with pytest.raises(ValueError):
            lm.assert_no_raw_gps(payload)
    lm.assert_no_raw_gps({"milestone": "PICKUP_GEOFENCE_TRIGGERED"})


def test_conservative_grid_never_overpacks_when_numbers_do_not_land_on_grid():
    orders = [_order(i, 0.024111, 0.024111) for i in range(4)]
    vehicle = {"driver_id": "D", "max_weight_capacity": 0.05, "max_volume_capacity": 0.05}
    r = lm.smart_cargo_batching(orders, vehicle, "Z")
    assert r["batching_algorithm_used"] == "DP_KNAPSACK_CONSERVATIVE_GRID"
    assert r["total_batched_orders"] * 0.024111 <= 0.05
