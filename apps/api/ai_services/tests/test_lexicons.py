from ai_services.lexicons import (
    apply_safety_layer,
    detect_emergency,
    detect_immediate_time,
    detect_vehicle_class,
    extract_capacity,
    extract_clock_time,
)


def test_detect_emergency_true():
    assert detect_emergency("في واحد مجروح بدنا اسعاف قوام") is True


def test_detect_emergency_false_on_ordinary_text():
    assert detect_emergency("بدي سيرفيس من بيت لحم للخليل") is False


def test_detect_immediate_time():
    assert detect_immediate_time("طير قوام لو سمحت") is True
    assert detect_immediate_time("بكرا الساعة 5") is False


def test_detect_vehicle_class_logistics():
    assert detect_vehicle_class("بدنا شاحنة تنقل بضاعة") == "Logistics"


def test_detect_vehicle_class_private():
    assert detect_vehicle_class("بدي طلب خصوصي") == "Private"


def test_detect_vehicle_class_public():
    assert detect_vehicle_class("في سيرفيس عمومي؟") == "Public"


def test_detect_vehicle_class_unspecified():
    assert detect_vehicle_class("بدي اروح عالخليل") == "Unspecified"


def test_extract_capacity_explicit_digit():
    assert extract_capacity("بدي 3 مقاعد") == 3


def test_extract_capacity_ignores_clock_time():
    # Regression test: "16:00" must not be read as capacity 16.
    assert extract_capacity("الساعة 16:00 بدون ركاب") == 1


def test_extract_capacity_dual_form_heuristic():
    assert extract_capacity("كرتونتين كبار") == 2


def test_extract_capacity_default():
    assert extract_capacity("بدي سيارة خصوصي") == 1


def test_extract_clock_time_found():
    assert extract_clock_time("الساعة 16:00 لو سمحت") == "16:00"


def test_extract_clock_time_not_found():
    assert extract_clock_time("قوام لو سمحت") is None


def test_safety_layer_forces_emergency():
    # Even if the LLM said "Low", a detected emergency keyword must win.
    assert apply_safety_layer("في واحد مجروح", "Low") == "Emergency"


def test_safety_layer_passes_through_when_no_emergency():
    assert apply_safety_layer("بدي سيرفيس عادي", "Medium") == "Medium"
