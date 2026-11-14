from __future__ import annotations

import csv
import io
import math
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Iterator

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.ml import HealthModels, parse_blood_pressure


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DEFAULT_DB_PATH = DATA_DIR / "astrovitals.sqlite"
JSON_BODY_LIMIT = 100 * 1024
DATA_MODE = "simulated-demo"

DEMO_ENVIRONMENT = {
    "co2Ppm": 820,
    "radiationMsv": 128,
    "radiationReferenceMsv": 600,
}

DEMO_HEALTH_METRICS = {
    "AM": {"ecgSignal": "Good", "fluidShift": "Mild", "sleepHours": 6.4, "reactionMs": 284},
    "JK": {"ecgSignal": "Good", "fluidShift": "Low", "sleepHours": 7.1, "reactionMs": 261},
    "SR": {"ecgSignal": "Good", "fluidShift": "Mild", "sleepHours": 6.8, "reactionMs": 273},
}

DEMO_CREW = [
    {"id": "AM", "name": "Ava Mitchell", "role": "COMMANDER", "callsign": "ASTRA-01", "color": "purple", "hr": 68, "bp": "118/76", "spo2": 98, "rr": 14, "temp": 36.8, "hrv": 54, "hydration": "Stable", "bmd": -1.2, "muscle": -0.3},
    {"id": "JK", "name": "Jin Kim", "role": "FLIGHT ENGINEER", "callsign": "ASTRA-02", "color": "teal", "hr": 72, "bp": "121/79", "spo2": 97, "rr": 15, "temp": 36.6, "hrv": 49, "hydration": "Stable", "bmd": -0.9, "muscle": -0.2},
    {"id": "SR", "name": "Sofia Reyes", "role": "MISSION SPECIALIST", "callsign": "ASTRA-03", "color": "orange", "hr": 64, "bp": "116/74", "spo2": 99, "rr": 13, "temp": 36.7, "hrv": 61, "hydration": "On track", "bmd": -1.0, "muscle": -0.4},
]

SCENARIO_LIBRARY = [
    {"id": "SC01", "title": "Sudden increase in HR", "category": "Warning", "description": "Elevated heart rate pattern in synthetic demo telemetry."},
    {"id": "SC02", "title": "Sudden decrease in HR", "category": "Warning", "description": "Reduced heart rate pattern in synthetic demo telemetry."},
    {"id": "SC03", "title": "Irregular HR pattern", "category": "Warning", "description": "Heart-rate variation should be reviewed in context."},
    {"id": "SC04", "title": "Sudden increase in BP", "category": "Warning", "description": "Blood-pressure change pattern in synthetic demo telemetry."},
    {"id": "SC05", "title": "Sudden decrease in BP", "category": "Warning", "description": "Blood-pressure change pattern in synthetic demo telemetry."},
    {"id": "SC06", "title": "Sudden decrease in SpO₂", "category": "Critical", "description": "Low oxygen saturation pattern in synthetic demo telemetry."},
    {"id": "SC07", "title": "Abnormal ECG waveform", "category": "Critical", "description": "ECG waveform analysis is not implemented in this prototype."},
    {"id": "SC08", "title": "Irregular respiratory rate", "category": "Warning", "description": "Respiratory-rate variation should be reviewed in context."},
    {"id": "SC09", "title": "Sudden body temperature increase", "category": "Warning", "description": "Elevated temperature pattern in synthetic demo telemetry."},
    {"id": "SC10", "title": "Unusual HRV decrease", "category": "Warning", "description": "Reduced HRV pattern in synthetic demo telemetry."},
    {"id": "SC11", "title": "Dehydration indication", "category": "Warning", "description": "Hydration is a demo field and is not included in the ML models."},
    {"id": "SC12", "title": "Gradual BMD reduction", "category": "Warning", "description": "Long-term bone-density trend is not modeled by this snapshot classifier."},
    {"id": "SC13", "title": "Gradual muscle mass reduction", "category": "Warning", "description": "Long-term muscle trend is not modeled by this snapshot classifier."},
    {"id": "SC14", "title": "Cardiovascular stress", "category": "Critical", "description": "Combined cardiovascular pattern in synthetic demo telemetry."},
    {"id": "SC15", "title": "Possible respiratory distress", "category": "Critical", "description": "Combined respiratory pattern in synthetic demo telemetry."},
    {"id": "SC16", "title": "Possible dehydration", "category": "Warning", "description": "Hydration is a demo field and is not included in the ML models."},
    {"id": "SC17", "title": "Thermal stress", "category": "Warning", "description": "Elevated temperature pattern in synthetic demo telemetry."},
    {"id": "SC18", "title": "Abnormal cardiac activity", "category": "Critical", "description": "ECG waveform analysis is not implemented in this prototype."},
    {"id": "SC19", "title": "Physiological exhaustion", "category": "Warning", "description": "Fatigue is not inferred as a medical finding by this prototype."},
    {"id": "SC20", "title": "Combined physiological deterioration", "category": "Critical", "description": "Combined pattern in synthetic demo telemetry."},
    {"id": "SC21", "title": "Multiple gradual changes", "category": "Warning", "description": "Long-term trends require longitudinal data, not a single reading."},
    {"id": "SC22", "title": "Astronaut starts exercising", "category": "Warning", "description": "Activity context is not included in the current model inputs."},
    {"id": "SC23", "title": "Astronaut stops exercising", "category": "Warning", "description": "Recovery trends are not included in the current model inputs."},
    {"id": "SC24", "title": "Astronaut enters sleep", "category": "Normal", "description": "Sleep is included as a synthetic model feature, not as clinical guidance."},
    {"id": "SC25", "title": "Astronaut wakes up", "category": "Normal", "description": "Sleep is included as a synthetic model feature, not as clinical guidance."},
    {"id": "SC26", "title": "Microgravity-related fluid redistribution", "category": "Warning", "description": "This effect is not modeled by the current snapshot classifier."},
    {"id": "SC27", "title": "Astronaut experiences sudden stress", "category": "Warning", "description": "Stress is not inferred as a medical finding by this prototype."},
    {"id": "SC28", "title": "Astronaut experiences prolonged inactivity", "category": "Warning", "description": "Activity history is not included in the current model inputs."},
    {"id": "SC29", "title": "Prolonged space mission", "category": "Warning", "description": "Mission duration is not included in the current model inputs."},
]


class CrewCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    role: str = Field(min_length=1, max_length=40)
    callsign: str = Field(min_length=2, max_length=20, pattern=r"^[A-Za-z0-9-]+$")
    hr: int = Field(ge=20, le=250, strict=True)
    bp: str
    spo2: int = Field(ge=0, le=100, strict=True)
    rr: int = Field(ge=1, le=80, strict=True)
    temp: float = Field(ge=25, le=45)
    hrv: int = Field(ge=1, le=300, strict=True)
    hydration: str = Field(min_length=1, max_length=40)
    bmd: float = Field(ge=-100, le=100)
    muscle: float = Field(ge=-100, le=100)

    @field_validator("bp")
    @classmethod
    def validate_bp(cls, value: str) -> str:
        parse_blood_pressure(value)
        return value.strip()

    @field_validator("name", "role", "callsign", "hydration")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("role")
    @classmethod
    def normalize_role(cls, value: str) -> str:
        return value.upper()

    @field_validator("callsign")
    @classmethod
    def normalize_callsign(cls, value: str) -> str:
        return value.upper()


class TelemetryAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hr: int = Field(ge=20, le=250, strict=True)
    bp: str
    spo2: int = Field(ge=0, le=100, strict=True)
    rr: int = Field(ge=1, le=80, strict=True)
    temp: float = Field(ge=25, le=45)
    hrv: int = Field(ge=1, le=300, strict=True)
    sleepHours: float = Field(default=7.0, ge=0, le=24)

    @field_validator("bp")
    @classmethod
    def validate_bp(cls, value: str) -> str:
        parse_blood_pressure(value)
        return value.strip()


class Database:
    def __init__(self, path: str | Path):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS crew (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    role TEXT NOT NULL,
                    callsign TEXT NOT NULL UNIQUE,
                    color TEXT NOT NULL,
                    heart_rate INTEGER NOT NULL,
                    blood_pressure TEXT NOT NULL,
                    spo2 INTEGER NOT NULL,
                    respiratory_rate INTEGER NOT NULL,
                    temperature REAL NOT NULL,
                    hrv INTEGER NOT NULL,
                    hydration TEXT NOT NULL,
                    bmd REAL NOT NULL,
                    muscle REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS measurements (
                    id INTEGER PRIMARY KEY,
                    crew_id TEXT NOT NULL REFERENCES crew(id),
                    recorded_at TEXT NOT NULL,
                    heart_rate INTEGER NOT NULL,
                    spo2 INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS measurements_crew_time
                    ON measurements (crew_id, recorded_at);
                CREATE TABLE IF NOT EXISTS alerts (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    acknowledged_at TEXT
                );
                """
            )
            if connection.execute("SELECT COUNT(*) FROM crew").fetchone()[0] == 0:
                self._seed_crew(connection)
            if connection.execute("SELECT COUNT(*) FROM alerts").fetchone()[0] == 0:
                self._seed_alerts(connection)

    @staticmethod
    def _seed_crew(connection: sqlite3.Connection) -> None:
        now = datetime.now(timezone.utc)
        for member in DEMO_CREW:
            connection.execute(
                """
                INSERT INTO crew (
                    id, name, role, callsign, color, heart_rate, blood_pressure, spo2,
                    respiratory_rate, temperature, hrv, hydration, bmd, muscle
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    member["id"], member["name"], member["role"], member["callsign"], member["color"],
                    member["hr"], member["bp"], member["spo2"], member["rr"], member["temp"],
                    member["hrv"], member["hydration"], member["bmd"], member["muscle"],
                ),
            )
            for hour in range(719, -1, -1):
                variation = math.sin(hour * 0.19 + member["hr"]) * 4 + math.sin(hour * 0.047 + member["spo2"]) * 2
                heart_rate = round(member["hr"] + variation)
                spo2 = max(90, min(100, round(member["spo2"] + math.sin(hour * 0.13) * 1.2)))
                recorded_at = (now - timedelta(hours=hour)).isoformat()
                connection.execute(
                    "INSERT INTO measurements (crew_id, recorded_at, heart_rate, spo2) VALUES (?, ?, ?, ?)",
                    (member["id"], recorded_at, heart_rate, spo2),
                )

    @staticmethod
    def _seed_alerts(connection: sqlite3.Connection) -> None:
        now = datetime.now(timezone.utc)
        alerts = (
            ("alert-exercise-hr", "Elevated HR during exercise", "Heart rate reached 142 BPM during scheduled activity.", now - timedelta(minutes=22), now - timedelta(minutes=18)),
            ("alert-hydration-checkin", "Hydration check-in due", "Routine fluid balance check-in is due for this shift.", now - timedelta(minutes=64), None),
        )
        for alert_id, title, description, occurred_at, acknowledged_at in alerts:
            connection.execute(
                "INSERT INTO alerts (id, title, description, occurred_at, acknowledged_at) VALUES (?, ?, ?, ?, ?)",
                (
                    alert_id,
                    title,
                    description,
                    occurred_at.isoformat(),
                    acknowledged_at.isoformat() if acknowledged_at else None,
                ),
            )


@lru_cache(maxsize=1)
def _default_models() -> HealthModels:
    return HealthModels.train()


def _model_input(member: dict) -> dict:
    bp = parse_blood_pressure(str(member["bp"]))
    return {
        "hr": int(member["hr"]),
        "bp": f"{bp[0]:g}/{bp[1]:g}",
        "spo2": int(member["spo2"]),
        "rr": int(member["rr"]),
        "temp": float(member["temp"]),
        "hrv": int(member["hrv"]),
        "sleepHours": float(member.get("sleepHours", member.get("sleep_hours", 7.0))),
    }


def _evaluate(models: HealthModels, member: dict) -> dict:
    telemetry = _model_input(member)
    result = models.analyze(telemetry)
    classifier = result["classifier"]
    anomaly = result["anomaly"]
    bp_systolic, bp_diastolic = parse_blood_pressure(telemetry["bp"])
    hard_critical = (
        telemetry["hr"] > 120
        or telemetry["hr"] < 45
        or telemetry["spo2"] < 90
        or bp_systolic < 85
        or bp_diastolic < 50
        or telemetry["rr"] > 30
        or telemetry["rr"] < 6
    )
    predicted_class = classifier["predictedClass"]
    confidence = classifier["confidence"]
    triggers = {
        "elevated_heart_rate": "SC01",
        "low_oxygen": "SC06",
        "blood_pressure_change": "SC04",
        "respiratory_distress": "SC15",
        "thermal_stress": "SC09",
        "combined_stress": "SC20",
    }
    triggered_scenarios = [triggers[predicted_class]] if predicted_class in triggers else []
    observations = anomaly["referenceFlags"]

    if hard_critical or predicted_class in {"respiratory_distress", "combined_stress"} and confidence >= 70:
        status = "Critical"
        summary = "The demo models flagged a high-priority pattern; review the synthetic readings."
        rationale = "A safety rule or the supervised model identified a high-priority pattern. This is a demo flag, not a diagnosis."
        model_summary = "Critical review path"
        triggered_scenarios = list(dict.fromkeys([*triggered_scenarios, "SC20"]))[:4]
    elif anomaly["isAnomalous"] and predicted_class == "normal":
        status = "Uncertain"
        summary = "The anomaly detector found an unfamiliar pattern that needs review."
        rationale = "The Isolation Forest flagged an outlier while the classifier did not match a known synthetic class."
        model_summary = "Unfamiliar pattern / review"
    elif predicted_class != "normal" and confidence >= 50:
        status = "Warning"
        summary = "The classifier matched a known synthetic pattern; review the contributing readings."
        rationale = f"The Random Forest matched {classifier['predictedScenario']} in its synthetic training set."
        model_summary = "Known pattern / review"
    elif anomaly["isAnomalous"]:
        status = "Uncertain"
        summary = "The anomaly detector found an unfamiliar pattern that needs review."
        rationale = "The Isolation Forest detected a deviation that did not produce a confident known-class result."
        model_summary = "Unfamiliar pattern / review"
    elif confidence < 45:
        status = "Uncertain"
        summary = "Model confidence was low; review telemetry quality and context."
        rationale = "The classifier did not produce a confident match and the anomaly detector did not cross its threshold."
        model_summary = "Insufficient model evidence"
    else:
        status = "Normal"
        summary = "The demo models found no high-scoring known pattern or outlier."
        rationale = "The Random Forest and Isolation Forest did not flag this synthetic reading."
        model_summary = "No model flag"

    risk_score = min(
        100,
        round(
            max(
                confidence if status in {"Warning", "Critical"} else 0,
                anomaly["anomalyScore"] if anomaly["isAnomalous"] else 0,
                75 if hard_critical else 0,
            )
        ),
    )
    return {
        "status": status,
        "score": risk_score,
        "summary": summary,
        "triggeredScenarios": triggered_scenarios,
        "observations": observations,
        "classifier": classifier,
        "anomaly": anomaly,
        "decisionEngine": {"rationale": rationale, "modelSummary": model_summary},
    }


def _format_crew(row: sqlite3.Row, models: HealthModels) -> dict:
    data = dict(row)
    health_metrics = DEMO_HEALTH_METRICS.get(
        data["id"],
        {"ecgSignal": "Good", "fluidShift": "None", "sleepHours": 7.0, "reactionMs": 250},
    )
    member = {
        "hr": data["heart_rate"],
        "bp": data["blood_pressure"],
        "spo2": data["spo2"],
        "rr": data["respiratory_rate"],
        "temp": data["temperature"],
        "hrv": data["hrv"],
        **health_metrics,
    }
    evaluation = _evaluate(models, member)
    return {
        "id": data["id"],
        "name": data["name"],
        "role": data["role"],
        "callsign": data["callsign"],
        "color": data["color"],
        "hr": data["heart_rate"],
        "bp": data["blood_pressure"],
        "spo2": data["spo2"],
        "rr": data["respiratory_rate"],
        "temp": f"{data['temperature']:.1f}",
        "hrv": data["hrv"],
        "hydration": data["hydration"],
        "bmd": f"{data['bmd']:.1f}",
        "muscle": f"{data['muscle']:.1f}",
        "status": evaluation["status"],
        "riskLevel": evaluation["status"],
        "riskScore": evaluation["score"],
        "scenarioSummary": evaluation["summary"],
        "triggeredScenarios": evaluation["triggeredScenarios"],
        "classifier": evaluation["classifier"],
        "anomaly": evaluation["anomaly"],
        "decisionEngine": evaluation["decisionEngine"],
        **health_metrics,
    }


def _format_alert(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "occurredAt": row["occurred_at"],
        "acknowledged": row["acknowledged_at"] is not None,
    }


def _crew_id(value: str) -> str:
    return value.strip().upper()


def _body_limit_response(content_length: str | None) -> JSONResponse | None:
    if not content_length:
        return None
    try:
        if int(content_length) > JSON_BODY_LIMIT:
            return JSONResponse(status_code=413, content={"error": "Request body is too large"})
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "Invalid Content-Length header"})
    return None


def _validation_error_response(errors: list[dict]) -> JSONResponse:
    if any(item.get("type") == "json_invalid" for item in errors):
        return JSONResponse(status_code=400, content={"error": "Request body must be valid JSON"})
    return JSONResponse(
        status_code=400,
        content={
            "error": "Request validation failed",
            "details": [
                {"type": item.get("type"), "location": item.get("loc"), "message": item.get("msg")}
                for item in errors
            ],
        },
    )


def create_app(
    db_path: str | Path | None = None,
    serve_static: bool = True,
    models: HealthModels | None = None,
) -> FastAPI:
    selected_db_path = db_path or os.environ.get("DB_PATH", str(DEFAULT_DB_PATH))
    database = Database(selected_db_path)
    model_engine = models or _default_models()
    app = FastAPI(title="AstroVitals local demo API", version="1.0.0")
    app.state.database = database
    app.state.models = model_engine

    @app.middleware("http")
    async def enforce_json_body_limit(request: Request, call_next):
        response = _body_limit_response(request.headers.get("content-length"))
        if response is not None:
            return response
        return await call_next(request)

    @app.exception_handler(RequestValidationError)
    async def request_validation_error(_request: Request, error: RequestValidationError):
        return _validation_error_response(error.errors())

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, error: HTTPException):
        return JSONResponse(status_code=error.status_code, content={"error": error.detail}, headers=error.headers)

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "dataMode": DATA_MODE,
            "aiMode": "synthetic-demo-models",
        }

    @app.get("/api/ai/status")
    def ai_status():
        return {
            "status": "ready",
            "trainingData": "deterministic synthetic demonstration records",
            "trainingSamples": model_engine.training_samples,
            "models": [
                {"name": "Random Forest classifier", "version": model_engine.classifier_version},
                {"name": "Isolation Forest detector", "version": model_engine.anomaly_version},
            ],
            "clinicalUse": False,
        }

    @app.get("/api/crew")
    def list_crew():
        with database.connection() as connection:
            rows = connection.execute("SELECT * FROM crew ORDER BY callsign").fetchall()
        return {
            "crew": [_format_crew(row, model_engine) for row in rows],
            "environment": DEMO_ENVIRONMENT,
            "dataMode": DATA_MODE,
        }

    @app.post("/api/crew", status_code=201)
    def add_crew(details: CrewCreate):
        payload = details.model_dump()
        payload["name"] = payload["name"].strip()
        payload["hydration"] = payload["hydration"].strip()
        if not payload["name"] or not payload["hydration"]:
            raise HTTPException(status_code=400, detail="Name and hydration status are required")
        with database.connection() as connection:
            if connection.execute("SELECT id FROM crew WHERE callsign = ? COLLATE NOCASE", (payload["callsign"],)).fetchone():
                raise HTTPException(status_code=409, detail="Callsign is already in use")
            initials = re.sub(r"[^A-Z0-9]", "", "".join(part[0] for part in payload["name"].split()).upper())[:3] or "CR"
            crew_id = initials
            suffix = 2
            while connection.execute("SELECT id FROM crew WHERE id = ?", (crew_id,)).fetchone():
                crew_id = f"{initials}{suffix}"
                suffix += 1
            color = ("purple", "teal", "orange")[
                connection.execute("SELECT COUNT(*) FROM crew").fetchone()[0] % 3
            ]
            connection.execute(
                """
                INSERT INTO crew (
                    id, name, role, callsign, color, heart_rate, blood_pressure, spo2,
                    respiratory_rate, temperature, hrv, hydration, bmd, muscle
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    crew_id, payload["name"], payload["role"], payload["callsign"], color,
                    payload["hr"], payload["bp"], payload["spo2"], payload["rr"], payload["temp"],
                    payload["hrv"], payload["hydration"], payload["bmd"], payload["muscle"],
                ),
            )
            connection.execute(
                "INSERT INTO measurements (crew_id, recorded_at, heart_rate, spo2) VALUES (?, ?, ?, ?)",
                (crew_id, datetime.now(timezone.utc).isoformat(), payload["hr"], payload["spo2"]),
            )
            row = connection.execute("SELECT * FROM crew WHERE id = ?", (crew_id,)).fetchone()
        return {"crew": _format_crew(row, model_engine), "dataMode": DATA_MODE}

    @app.get("/api/crew/{crew_id}/trends")
    def get_trends(
        crew_id: str,
        range_value: Annotated[str, Query(alias="range")] = "24H",
    ):
        normalized_id = _crew_id(crew_id)
        selected_range = range_value.strip().upper()
        range_hours = {"24H": 24, "7D": 168, "30D": 720}
        if selected_range not in range_hours:
            raise HTTPException(status_code=400, detail="range must be one of 24H, 7D, or 30D")
        with database.connection() as connection:
            member = connection.execute("SELECT id FROM crew WHERE id = ?", (normalized_id,)).fetchone()
            if not member:
                raise HTTPException(status_code=404, detail="Crew member not found")
            since = (datetime.now(timezone.utc) - timedelta(hours=range_hours[selected_range])).isoformat()
            rows = connection.execute(
                """
                SELECT recorded_at AS recordedAt, heart_rate AS heartRate, spo2
                FROM measurements
                WHERE crew_id = ? AND recorded_at >= ?
                ORDER BY recorded_at
                """,
                (normalized_id, since),
            ).fetchall()
        return {
            "crewId": normalized_id,
            "range": selected_range,
            "points": [dict(row) for row in rows],
            "dataMode": DATA_MODE,
        }

    @app.get("/api/scenarios")
    @app.get("/api/ai/scenarios")
    def list_scenarios():
        return {"scenarios": SCENARIO_LIBRARY, "dataMode": DATA_MODE}

    @app.get("/api/crew/{crew_id}/scenario")
    def get_scenario(crew_id: str):
        normalized_id = _crew_id(crew_id)
        with database.connection() as connection:
            row = connection.execute("SELECT * FROM crew WHERE id = ?", (normalized_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Crew member not found")
        member = _format_crew(row, model_engine)
        return {
            "crewId": member["id"],
            "status": member["status"],
            "riskScore": member["riskScore"],
            "summary": member["scenarioSummary"],
            "triggeredScenarios": member["triggeredScenarios"],
            "observations": member["anomaly"]["referenceFlags"],
            "classifier": member["classifier"],
            "anomaly": member["anomaly"],
            "decisionEngine": member["decisionEngine"],
            "dataMode": DATA_MODE,
        }

    @app.post("/api/ai/analyze")
    def analyze_telemetry(telemetry: TelemetryAnalysis):
        evaluation = _evaluate(model_engine, telemetry.model_dump())
        return {**evaluation, "dataMode": DATA_MODE, "clinicalUse": False}

    @app.get("/api/alerts")
    def list_alerts():
        with database.connection() as connection:
            rows = connection.execute("SELECT * FROM alerts ORDER BY occurred_at DESC").fetchall()
        return {"alerts": [_format_alert(row) for row in rows], "dataMode": DATA_MODE}

    @app.post("/api/alerts/{alert_id}/acknowledge")
    def acknowledge_alert(alert_id: str):
        normalized_id = alert_id.strip()
        with database.connection() as connection:
            result = connection.execute(
                "UPDATE alerts SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE id = ?",
                (datetime.now(timezone.utc).isoformat(), normalized_id),
            )
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="Alert not found")
            row = connection.execute("SELECT * FROM alerts WHERE id = ?", (normalized_id,)).fetchone()
        return {"alert": _format_alert(row), "dataMode": DATA_MODE}

    @app.get("/api/crew/{crew_id}/report.csv")
    def export_report(crew_id: str):
        normalized_id = _crew_id(crew_id)
        with database.connection() as connection:
            row = connection.execute("SELECT * FROM crew WHERE id = ?", (normalized_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Crew member not found")
        member = _format_crew(row, model_engine)
        rows = [
            ["AstroVitals - Simulated mission health report"],
            ["Mission", "Odyssey-07"],
            ["Crew member", member["name"]],
            ["Crew ID", member["callsign"]],
            ["Data status", "Simulated demonstration data - not for clinical use"],
            [],
            ["Parameter", "Reading", "Unit"],
            ["Heart rate", member["hr"], "BPM"],
            ["Blood pressure", member["bp"], "mmHg"],
            ["Blood oxygen saturation (SpO2)", member["spo2"], "%"],
            ["ECG signal", member["ecgSignal"], "Signal quality"],
            ["Respiratory rate", member["rr"], "breaths/min"],
            ["Body temperature", member["temp"], "C"],
            ["Heart rate variability", member["hrv"], "ms"],
            ["Hydration status", member["hydration"], ""],
            ["Bone mineral density change", member["bmd"], "% since baseline"],
            ["Muscle mass change", member["muscle"], "% since baseline"],
            ["Headward fluid shift", member["fluidShift"], "illustrative proxy"],
            ["Cumulative radiation", DEMO_ENVIRONMENT["radiationMsv"], "mSv - simulated"],
            ["Cabin carbon dioxide", DEMO_ENVIRONMENT["co2Ppm"], "ppm - simulated"],
            ["Sleep duration", member["sleepHours"], "hours - simulated"],
            ["Reaction time", member["reactionMs"], "ms - sample/demo"],
            ["Model classification", member["classifier"]["predictedScenario"], "synthetic model output"],
            ["Anomaly score", member["anomaly"]["anomalyScore"], "synthetic model output"],
        ]
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        writer.writerows(rows)
        filename = f"astra-health-{member['callsign'].lower()}-demo-report.csv"
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    if serve_static:
        @app.get("/", include_in_schema=False)
        def dashboard():
            return FileResponse(ROOT / "index.html")

        app.mount("/", StaticFiles(directory=ROOT, html=True), name="static")

    return app


app = create_app()
