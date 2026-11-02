from ai_services.pipeline import parse_dispatch_request
from ai_services.schema import DispatchRequest


def test_emergency_message_flags_review_and_urgency():
    result = parse_dispatch_request("في واحد مجروح عند الشفاا بدنا اسعاف قوام")
    assert isinstance(result, DispatchRequest)
    assert result.urgency_profile == "Emergency"
    assert result.needs_review is True
    # Misspelled location must be preserved exactly, never auto-corrected.
    assert result.pickup_location == "الشفاا"


def test_logistics_message_extracts_vehicle_and_capacity():
    result = parse_dispatch_request(
        "بدنا تكتك قوام يسحب كرتونتين كبار من عند دوار المناررة وننزلهم بمكتب البريد المركزي والوضع مستعجل"
    )
    assert result.vehicle_class == "Logistics"
    assert result.temporal_element == "Immediate"
    assert result.capacity_requirements == 2
    assert result.urgency_profile == "High"


def test_public_transport_message_extracts_clock_time():
    result = parse_dispatch_request("بدي سيرفيس من بيت لحم للخليل الساعة 16:00")
    assert result.vehicle_class == "Public"
    assert result.temporal_element == "16:00"
    # Regression: capacity must default to 1, not be confused with "16:00".
    assert result.capacity_requirements == 1


def test_result_always_includes_raw_text_and_confidence():
    text = "بدي سيارة خصوصي بسرعة"
    result = parse_dispatch_request(text)
    assert result.raw_text == text
    assert 0.0 <= result.confidence <= 1.0


def test_low_confidence_triggers_review():
    # A vague message with no clear locations should end up low-confidence
    # in heuristic (MOCK_MODE) extraction and therefore flagged for review.
    result = parse_dispatch_request("ممكن مساعدة؟")
    assert result.needs_review is True
