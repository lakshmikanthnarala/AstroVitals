import json
from time import perf_counter

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from starlette.responses import FileResponse

from backend.main import (
    ContactRequestCreate,
    CrewCreate,
    Database,
    PacketCreate,
    TelemetryAnalysis,
    _body_limit_response,
    _validation_error_response,
    create_app,
)


@pytest.fixture
def app(tmp_path):
    return create_app(db_path=tmp_path / "test.sqlite3")


def endpoint(app, path, method="GET"):
    return next(
        route.endpoint
        for route in app.routes
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set())
    )


def test_health_and_dashboard_routes_serve_local_demo(app):
    health = endpoint(app, "/api/health")()
    dashboard = endpoint(app, "/", "GET")()

    assert health["dataMode"] == "simulated-demo"
    assert health["aiMode"] == "synthetic-demo-models"
    assert isinstance(dashboard, FileResponse)
    assert str(dashboard.path).endswith("index.html")


def test_trained_models_report_versions_and_inference(app):
    ai_status = endpoint(app, "/api/ai/status")()
    crew = endpoint(app, "/api/crew")()["crew"]
    member = crew[0]

    assert ai_status["status"] == "ready"
    assert ai_status["clinicalUse"] is False
    assert ai_status["trainingSamples"] == 4900
    assert len(ai_status["models"]) == 2
    assert member["classifier"]["modelName"] == "Random Forest classifier"
    assert member["anomaly"]["modelName"] == "Isolation Forest detector"
    assert member["classifier"]["probabilities"]
    assert member["decisionEngine"]["rationale"]


def test_classifier_and_anomaly_detector_flag_known_low_oxygen_pattern(app):
    analysis = endpoint(app, "/api/ai/analyze", "POST")(
        TelemetryAnalysis(
            hr=112,
            bp="118/76",
            spo2=86,
            rr=25,
            temp=36.9,
            hrv=31,
            sleepHours=7.0,
        )
    )

    assert analysis["classifier"]["predictedClass"] == "low_oxygen"
    assert analysis["anomaly"]["isAnomalous"] is True
    assert analysis["status"] == "Critical"


def test_anomaly_detector_flags_out_of_distribution_telemetry(app):
    analysis = endpoint(app, "/api/ai/analyze", "POST")(
        TelemetryAnalysis(
            hr=240,
            bp="280/35",
            spo2=100,
            rr=3,
            temp=44.0,
            hrv=290,
            sleepHours=23.0,
        )
    )

    assert analysis["anomaly"]["isAnomalous"] is True
    assert analysis["status"] == "Critical"


def test_model_inference_meets_demo_latency_target(app):
    telemetry = TelemetryAnalysis(
        hr=72,
        bp="121/79",
        spo2=97,
        rr=15,
        temp=36.6,
        hrv=49,
        sleepHours=7.1,
    )
    analyze = endpoint(app, "/api/ai/analyze", "POST")

    started_at = perf_counter()
    result = analyze(telemetry)
    elapsed = perf_counter() - started_at

    assert result["classifier"]["predictedClass"]
    assert elapsed < 0.5


def test_crew_persistence_validation_and_trends(app):
    details = {
        "name": "Nia Long",
        "role": "MISSION SPECIALIST",
        "callsign": "ASTRA-04",
        "hr": 70,
        "bp": "120/80",
        "spo2": 98,
        "rr": 14,
        "temp": 36.8,
        "hrv": 55,
        "hydration": "Stable",
        "bmd": -0.5,
        "muscle": -0.2,
    }
    create_crew = endpoint(app, "/api/crew", "POST")
    created = create_crew(CrewCreate(**details))

    assert created["crew"]["name"] == details["name"]
    with pytest.raises(HTTPException, match="409"):
        create_crew(CrewCreate(**{**details, "name": "Duplicate"}))
    with pytest.raises(ValidationError):
        CrewCreate(**{**details, "callsign": "ASTRA-05", "spo2": 101})
    assert endpoint(app, "/api/crew")()["crew"][-1]["callsign"] == "ASTRA-04"

    trends = endpoint(app, "/api/crew/{crew_id}/trends")(
        created["crew"]["id"],
        range_value="24H",
    )
    assert trends["range"] == "24H"
    assert len(trends["points"]) == 1


def test_alert_acknowledgement_is_idempotent_and_handles_missing_ids(app):
    acknowledge = endpoint(app, "/api/alerts/{alert_id}/acknowledge", "POST")
    first = acknowledge("alert-hydration-checkin")
    second = acknowledge("alert-hydration-checkin")

    assert first["alert"]["acknowledged"] is True
    assert second["alert"]["acknowledged"] is True
    with pytest.raises(HTTPException, match="404"):
        acknowledge("missing")


def test_packet_queue_and_contact_requests_persist_as_local_actions(app):
    queue_packet = endpoint(app, "/api/packets", "POST")
    packet = queue_packet(PacketCreate(crewId="am"))
    packet_id = packet["packet"]["id"]

    assert packet["packet"]["crewId"] == "AM"
    assert packet["packet"]["packetType"] == "health-summary"
    assert packet["packet"]["payload"]["dataMode"] == "simulated-demo"
    assert endpoint(app, "/api/packets")()["packets"][0]["id"] == packet_id
    acknowledged = endpoint(app, "/api/packets/{packet_id}/acknowledge", "POST")(packet_id)
    assert acknowledged["packet"]["acknowledged"] is True
    assert endpoint(app, "/api/packets/{packet_id}/acknowledge", "POST")(packet_id)["packet"]["acknowledged"]

    schedule_request = endpoint(app, "/api/contact-requests", "POST")
    request = schedule_request(ContactRequestCreate(
        crewId="AM",
        message="  Review the synthetic readings  ",
        delayMinutes=15,
    ))
    request_id = request["contactRequest"]["id"]
    assert request["contactRequest"]["message"] == "Review the synthetic readings"
    assert request["contactRequest"]["status"] == "scheduled-local"
    assert request["externalDelivery"] is False
    assert endpoint(app, "/api/contact-requests")()["contactRequests"][0]["id"] == request_id

    cancel_request = endpoint(app, "/api/contact-requests/{request_id}/cancel", "POST")
    cancelled = cancel_request(request_id)
    assert cancelled["contactRequest"]["status"] == "cancelled-local"
    assert cancel_request(request_id)["contactRequest"]["status"] == "cancelled-local"
    with pytest.raises(HTTPException, match="404"):
        cancel_request("missing")

    reopened = Database(app.state.database.path)
    with reopened.connection() as connection:
        assert connection.execute("SELECT id FROM packets WHERE id = ?", (packet_id,)).fetchone()
        persisted_request = connection.execute(
            "SELECT status FROM contact_requests WHERE id = ?",
            (request_id,),
        ).fetchone()
    assert persisted_request["status"] == "cancelled-local"


def test_packet_and_contact_requests_reject_unknown_crew_and_invalid_input(app):
    with pytest.raises(HTTPException, match="404"):
        endpoint(app, "/api/packets", "POST")(PacketCreate(crewId="UNKNOWN"))
    with pytest.raises(ValidationError):
        ContactRequestCreate(crewId="AM", message="Review", delayMinutes=1441)


def test_client_error_shapes_for_invalid_json_and_large_bodies():
    malformed = _validation_error_response(
        [{"type": "json_invalid", "loc": ("body", 0), "msg": "Invalid JSON"}]
    )
    invalid_fields = _validation_error_response(
        [{"type": "int_type", "loc": ("body", "hr"), "msg": "Input should be a valid integer"}]
    )
    oversized = _body_limit_response(str(100 * 1024 + 1))

    assert malformed.status_code == 400
    assert json.loads(malformed.body) == {"error": "Request body must be valid JSON"}
    assert invalid_fields.status_code == 400
    assert json.loads(invalid_fields.body)["error"] == "Request validation failed"
    assert oversized.status_code == 413
    assert json.loads(oversized.body) == {"error": "Request body is too large"}


def test_scenario_api_and_report_include_model_results(app):
    scenario = endpoint(app, "/api/crew/{crew_id}/scenario")("am")
    report = endpoint(app, "/api/crew/{crew_id}/report.csv")("am")
    scenarios = endpoint(app, "/api/scenarios")()

    assert scenario["classifier"]["modelName"] == "Random Forest classifier"
    assert any(item["id"] == "SC06" for item in scenarios["scenarios"])
    assert "not for clinical use" in report.body.decode()
    assert endpoint(app, "/api/ai/scenarios")()["scenarios"] == scenarios["scenarios"]
