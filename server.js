const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");

const OSD575_CRP_DATA = require("./data/osd-575-crp.json");

const DEMO_ENVIRONMENT = {
  co2Ppm: 820,
  radiationMsv: 128,
  radiationReferenceMsv: 600,
};

const DEMO_HEALTH_METRICS = {
  AM: { ecgSignal: "Good", fluidShift: "Mild", sleepHours: 6.4, reactionMs: 284 },
  JK: { ecgSignal: "Good", fluidShift: "Low", sleepHours: 7.1, reactionMs: 261 },
  SR: { ecgSignal: "Good", fluidShift: "Mild", sleepHours: 6.8, reactionMs: 273 },
};

const DEMO_CREW = [
  { id: "AM", name: "Ava Mitchell", role: "COMMANDER", callsign: "ASTRA-01", color: "purple", hr: 68, bp: "118/76", spo2: 98, rr: 14, temp: 36.8, hrv: 54, hydration: "Stable", bmd: -1.2, muscle: -0.3 },
  { id: "JK", name: "Jin Kim", role: "FLIGHT ENGINEER", callsign: "ASTRA-02", color: "teal", hr: 72, bp: "121/79", spo2: 97, rr: 15, temp: 36.6, hrv: 49, hydration: "Stable", bmd: -0.9, muscle: -0.2 },
  { id: "SR", name: "Sofia Reyes", role: "MISSION SPECIALIST", callsign: "ASTRA-03", color: "orange", hr: 64, bp: "116/74", spo2: 99, rr: 13, temp: 36.7, hrv: 61, hydration: "On track", bmd: -1.0, muscle: -0.4 },
];

const SCENARIO_LIBRARY = [
  { id: "SC01", title: "Sudden increase in HR", category: "Warning", description: "Elevated heart rate indicates cardiovascular stress." },
  { id: "SC02", title: "Sudden decrease in HR", category: "Warning", description: "Reduced heart rate indicates a possible physiologic change." },
  { id: "SC03", title: "Irregular HR pattern", category: "Warning", description: "Cardiac rhythm is variable and needs evaluation." },
  { id: "SC04", title: "Sudden increase in BP", category: "Warning", description: "Blood pressure is elevated relative to baseline." },
  { id: "SC05", title: "Sudden decrease in BP", category: "Warning", description: "Blood pressure is reduced relative to baseline." },
  { id: "SC06", title: "Sudden decrease in SpO₂", category: "Critical", description: "Oxygen saturation is below the expected range." },
  { id: "SC07", title: "Abnormal ECG waveform", category: "Critical", description: "The waveform deviates from the expected rhythm pattern." },
  { id: "SC08", title: "Irregular respiratory rate", category: "Warning", description: "Breathing pattern is irregular or abnormal." },
  { id: "SC09", title: "Sudden body temperature increase", category: "Warning", description: "Temperature elevation may reflect environmental or physiologic stress." },
  { id: "SC10", title: "Unusual HRV decrease", category: "Warning", description: "Reduced HRV suggests stress or recovery concerns." },
  { id: "SC11", title: "Dehydration indication", category: "Warning", description: "Hydration markers suggest a concern that may affect work capacity." },
  { id: "SC12", title: "Gradual BMD reduction", category: "Warning", description: "Bone-density deterioration indicates a long-term mission risk." },
  { id: "SC13", title: "Gradual muscle mass reduction", category: "Warning", description: "Muscle loss suggests declining mission fitness or adaptation stress." },
  { id: "SC14", title: "Cardiovascular stress", category: "Critical", description: "Heart rate, blood pressure, and HRV indicate combined stress." },
  { id: "SC15", title: "Possible respiratory distress", category: "Critical", description: "Low oxygen with elevated RR and HR requires urgent review." },
  { id: "SC16", title: "Possible dehydration", category: "Warning", description: "Hydration loss coincides with elevated heart rate and falling blood pressure." },
  { id: "SC17", title: "Thermal stress", category: "Warning", description: "Temperature, HR, and RR all suggest heat-related strain." },
  { id: "SC18", title: "Abnormal cardiac activity", category: "Critical", description: "ECG irregularity and HR variability changes point to cardiac concerns." },
  { id: "SC19", title: "Physiological exhaustion", category: "Warning", description: "Lower HRV with elevated HR may reflect fatigue or recovery issues." },
  { id: "SC20", title: "Combined physiological deterioration", category: "Critical", description: "Multiple physiologic variables indicate a high-priority medical alert." },
  { id: "SC21", title: "Multiple gradual changes", category: "Warning", description: "Long-term changes in bone density, muscle mass, and HRV require monitoring." },
  { id: "SC22", title: "Astronaut starts exercising", category: "Warning", description: "Activity-related HR and RR changes are expected but should be monitored." },
  { id: "SC23", title: "Astronaut stops exercising", category: "Warning", description: "Recovery toward baseline should be observed after exertion." },
  { id: "SC24", title: "Astronaut enters sleep", category: "Normal", description: "Sleep-related changes are part of expected circadian adaptation." },
  { id: "SC25", title: "Astronaut wakes up", category: "Normal", description: "A wake transition should return physiology toward the active baseline." },
  { id: "SC26", title: "Microgravity-related fluid redistribution", category: "Warning", description: "Physiologic response reflects adaptation or stress in orbit." },
  { id: "SC27", title: "Astronaut experiences sudden stress", category: "Warning", description: "Unexpected physiology may reflect acute mission stress." },
  { id: "SC28", title: "Astronaut experiences prolonged inactivity", category: "Warning", description: "Long-term inactivity trends may affect muscle and cardiovascular status." },
  { id: "SC29", title: "Prolonged space mission", category: "Warning", description: "Cumulative changes may require long-term monitoring." },
];

function normalizeCrewId(rawId) {
  if (typeof rawId !== "string") return undefined;
  const normalized = rawId.trim();
  return normalized ? normalized.toUpperCase() : undefined;
}

function normalizeRange(rawRange) {
  if (typeof rawRange !== "string") return undefined;
  const normalized = rawRange.trim().toUpperCase();
  return normalized || undefined;
}

function initializeDatabase(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
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
    CREATE TABLE IF NOT EXISTS packets (
      id TEXT PRIMARY KEY,
      crew_id TEXT NOT NULL REFERENCES crew(id) ON DELETE CASCADE,
      packet_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      queued_at TEXT NOT NULL,
      acknowledged_at TEXT
    );
    CREATE TABLE IF NOT EXISTS contact_requests (
      id TEXT PRIMARY KEY,
      crew_id TEXT NOT NULL REFERENCES crew(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      delay_minutes INTEGER NOT NULL CHECK(delay_minutes BETWEEN 0 AND 1440),
      created_at TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('scheduled-local', 'cancelled-local'))
    );
  `);

  const crewCount = db.prepare("SELECT COUNT(*) AS count FROM crew").get().count;
  if (crewCount === 0) {
    const insertCrew = db.prepare(`
      INSERT INTO crew (
        id, name, role, callsign, color, heart_rate, blood_pressure, spo2,
        respiratory_rate, temperature, hrv, hydration, bmd, muscle
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMeasurement = db.prepare(`
      INSERT INTO measurements (crew_id, recorded_at, heart_rate, spo2)
      VALUES (?, ?, ?, ?)
    `);
    const now = Date.now();

    for (const member of DEMO_CREW) {
      insertCrew.run(
        member.id, member.name, member.role, member.callsign, member.color,
        member.hr, member.bp, member.spo2, member.rr, member.temp, member.hrv,
        member.hydration, member.bmd, member.muscle,
      );

      for (let hour = 719; hour >= 0; hour -= 1) {
        const variation = Math.sin(hour * 0.19 + member.hr) * 4
          + Math.sin(hour * 0.047 + member.spo2) * 2;
        const heartRate = Math.round(member.hr + variation);
        const spo2 = Math.max(90, Math.min(100, Math.round(member.spo2 + Math.sin(hour * 0.13) * 1.2)));
        insertMeasurement.run(
          member.id,
          new Date(now - hour * 60 * 60 * 1000).toISOString(),
          heartRate,
          spo2,
        );
      }
    }
  }

  const measurementCount = db.prepare("SELECT COUNT(*) AS count FROM measurements").get().count;
  if (measurementCount === 0 && crewCount > 0) {
    const now = Date.now();
    const insertMeasurement = db.prepare(`
      INSERT INTO measurements (crew_id, recorded_at, heart_rate, spo2)
      VALUES (?, ?, ?, ?)
    `);

    for (const member of DEMO_CREW) {
      for (let hour = 719; hour >= 0; hour -= 1) {
        const variation = Math.sin(hour * 0.19 + member.hr) * 4
          + Math.sin(hour * 0.047 + member.spo2) * 2;
        const heartRate = Math.round(member.hr + variation);
        const spo2 = Math.max(90, Math.min(100, Math.round(member.spo2 + Math.sin(hour * 0.13) * 1.2)));
        insertMeasurement.run(
          member.id,
          new Date(now - hour * 60 * 60 * 1000).toISOString(),
          heartRate,
          spo2,
        );
      }
    }
  }

  const alertCount = db.prepare("SELECT COUNT(*) AS count FROM alerts").get().count;
  if (alertCount === 0) {
    const now = Date.now();
    const insertAlert = db.prepare(`
      INSERT INTO alerts (id, title, description, occurred_at, acknowledged_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertAlert.run(
      "alert-exercise-hr",
      "Elevated HR during exercise",
      "Heart rate reached 142 BPM during scheduled activity.",
      new Date(now - 22 * 60 * 1000).toISOString(),
      new Date(now - 18 * 60 * 1000).toISOString(),
    );
    insertAlert.run(
      "alert-hydration-checkin",
      "Hydration check-in due",
      "Routine fluid balance check-in is due for this shift.",
      new Date(now - 64 * 60 * 1000).toISOString(),
      null,
    );
  }
}

function parseBloodPressure(value) {
  if (typeof value !== "string") return null;
  const parts = value.trim().split("/");
  if (parts.length !== 2) return null;
  const systolic = Number(parts[0]);
  const diastolic = Number(parts[1]);
  return Number.isFinite(systolic) && Number.isFinite(diastolic) ? { systolic, diastolic } : null;
}

function validateTelemetryInput(body) {
  const allowedFields = new Set(["hr", "bp", "spo2", "rr", "temp", "hrv", "sleepHours"]);
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((field) => !allowedFields.has(field))) {
    return { error: "Telemetry must be a JSON object with supported fields" };
  }

  const telemetry = { sleepHours: 7, ...body };
  const integerLimits = { hr: [20, 250], spo2: [0, 100], rr: [1, 80], hrv: [1, 300] };
  for (const [field, [minimum, maximum]] of Object.entries(integerLimits)) {
    if (!Number.isInteger(telemetry[field]) || telemetry[field] < minimum || telemetry[field] > maximum) {
      return { error: `${field} is outside the accepted input range` };
    }
  }
  if (typeof telemetry.bp !== "string") {
    return { error: "Blood pressure must be a systolic/diastolic string" };
  }
  const pressure = parseBloodPressure(telemetry.bp);
  if (!pressure || pressure.systolic < 50 || pressure.systolic > 300
    || pressure.diastolic < 30 || pressure.diastolic > 200) {
    return { error: "Blood pressure is outside the accepted input range" };
  }
  if (typeof telemetry.temp !== "number" || !Number.isFinite(telemetry.temp)
    || telemetry.temp < 25 || telemetry.temp > 45
    || typeof telemetry.sleepHours !== "number" || !Number.isFinite(telemetry.sleepHours)
    || telemetry.sleepHours < 0 || telemetry.sleepHours > 24) {
    return { error: "Temperature or sleepHours is outside the accepted input range" };
  }
  return { telemetry };
}

function buildSupervisedClassifier(member) {
  const bp = parseBloodPressure(member?.bp);
  const heartRate = Number(member?.hr ?? 0);
  const spo2 = Number(member?.spo2 ?? 0);
  const respiratoryRate = Number(member?.rr ?? 0);
  const temperature = Number(member?.temp ?? 0);
  const hrv = Number(member?.hrv ?? 0);
  const sleepHours = Number(member?.sleepHours ?? member?.sleep_hours ?? 0);

  const featureVector = [
    heartRate,
    bp?.systolic ?? 0,
    bp?.diastolic ?? 0,
    spo2,
    respiratoryRate,
    temperature,
    hrv,
    sleepHours,
  ];

  const abnormalityScore = (
    (heartRate > 90 ? 1 : 0) +
    (spo2 < 96 ? 1 : 0) +
    (respiratoryRate > 18 ? 1 : 0) +
    (temperature > 37.2 ? 1 : 0) +
    (hrv < 40 ? 1 : 0) +
    (sleepHours < 7 ? 1 : 0)
  );

  const scenarioLabel = abnormalityScore >= 3
    ? "Known physiological abnormality"
    : abnormalityScore >= 1
      ? "Monitor for deviation"
      : "Normal physiological profile";

  const confidence = Math.min(99, 52 + abnormalityScore * 9 + (spo2 >= 96 ? 12 : 0));

  return {
    modelName: "Rule-based demo classifier",
    modelVersion: "rule-based-demo-v1",
    predictedClass: abnormalityScore >= 3
      ? "physiological_abnormality"
      : abnormalityScore >= 1 ? "monitor_deviation" : "normal",
    predictedScenario: scenarioLabel,
    confidence: Math.round(confidence),
    features: featureVector,
  };
}

function buildAnomalyDetector(member, environment = DEMO_ENVIRONMENT) {
  const bp = parseBloodPressure(member?.bp);
  const heartRate = Number(member?.hr ?? 0);
  const spo2 = Number(member?.spo2 ?? 0);
  const respiratoryRate = Number(member?.rr ?? 0);
  const temperature = Number(member?.temp ?? 0);
  const hrv = Number(member?.hrv ?? 0);

  const deviations = [];
  if (heartRate > 90 || heartRate < 50) deviations.push("heart-rate drift");
  if (bp && (bp.systolic > 125 || bp.diastolic > 80 || bp.systolic < 100 || bp.diastolic < 70)) deviations.push("blood-pressure drift");
  if (spo2 < 96) deviations.push("oxygen saturation drift");
  if (respiratoryRate > 18 || respiratoryRate < 12) deviations.push("respiratory drift");
  if (temperature > 37.2 || temperature < 36.2) deviations.push("temperature drift");
  if (hrv < 40) deviations.push("HRV deviation");
  if (environment && (environment.co2Ppm > 900 || environment.radiationMsv > 200)) deviations.push("environmental load");

  const score = Math.min(100, deviations.length * 18 + (spo2 < 95 ? 18 : 0));

  return {
    modelName: "Threshold-based deviation detector",
    modelVersion: "threshold-deviation-demo-v1",
    anomalyScore: score,
    isAnomalous: score >= 35,
    referenceFlags: deviations,
    contributingFactors: deviations,
  };
}

function evaluateHealthScenario(member, environment = DEMO_ENVIRONMENT) {
  if (!member || typeof member !== "object") {
    return {
      status: "Uncertain",
      score: 100,
      summary: "No crew metrics available for classification.",
      triggeredScenarios: ["SC00"],
      observations: ["Insufficient data"],
      classifier: buildSupervisedClassifier({}),
      anomaly: buildAnomalyDetector({}, environment),
      decisionEngine: {
        rationale: "No telemetry available for a reliable assessment.",
        modelSummary: "Awaiting data",
      },
    };
  }

  const observations = [];
  const bp = parseBloodPressure(member.bp);
  const heartRate = Number(member.hr);
  const spo2 = Number(member.spo2);
  const respiratoryRate = Number(member.rr);
  const temperature = Number(member.temp);
  const hrv = Number(member.hrv);
  const sleepHours = Number(member.sleepHours ?? member.sleep_hours ?? 0);

  if (!Number.isFinite(heartRate) || !Number.isFinite(spo2) || !Number.isFinite(respiratoryRate)
    || !Number.isFinite(temperature) || !Number.isFinite(hrv) || !member.bp || !Number.isFinite(sleepHours)) {
    return {
      status: "Uncertain",
      score: 100,
      summary: "Insufficient or conflicting physiology data prevented a confident classification.",
      triggeredScenarios: ["SC00"],
      observations: ["Unreliable telemetry"],
      classifier: buildSupervisedClassifier(member),
      anomaly: buildAnomalyDetector(member, environment),
      decisionEngine: {
        rationale: "Telemetry quality gate failed, so the system recommended review rather than a definitive diagnosis.",
        modelSummary: "Signal quality issue",
      },
    };
  }

  if (heartRate > 110 || heartRate < 45) observations.push("heart-rate variance");
  if (bp && (bp.systolic > 130 || bp.systolic < 90 || bp.diastolic > 90 || bp.diastolic < 60)) observations.push("blood-pressure variance");
  if (spo2 < 95) observations.push("oxygen saturation reduction");
  if (respiratoryRate > 20 || respiratoryRate < 10) observations.push("respiratory rate variance");
  if (temperature > 37.5 || temperature < 36.0) observations.push("temperature variance");
  if (hrv < 30) observations.push("HRV reduction");
  if (sleepHours < 6.5 || sleepHours > 9) observations.push("sleep pattern disruption");
  if (environment && (environment.co2Ppm > 1000 || environment.radiationMsv > 250)) observations.push("environmental load increase");

  const criticalTriggers = [];
  if (heartRate > 120 || heartRate < 45) criticalTriggers.push("SC01");
  if (spo2 < 90) criticalTriggers.push("SC06");
  if (bp && (bp.systolic > 140 || bp.diastolic > 95 || bp.systolic < 90 || bp.diastolic < 60)) criticalTriggers.push("SC04");
  if (respiratoryRate > 25 || respiratoryRate < 8) criticalTriggers.push("SC15");
  const combinedCritical = (heartRate > 90 && respiratoryRate > 20 && spo2 < 95)
    || (heartRate > 100 && bp && bp.systolic > 130 && hrv < 35);
  if (combinedCritical) criticalTriggers.push("SC20");

  const warningTriggers = [];
  if (heartRate > 90 || heartRate < 50) warningTriggers.push("SC01");
  if (bp && (bp.systolic > 125 || bp.diastolic > 80 || bp.systolic < 100 || bp.diastolic < 70)) warningTriggers.push("SC04");
  if (spo2 < 96) warningTriggers.push("SC06");
  if (respiratoryRate > 18 || respiratoryRate < 12) warningTriggers.push("SC15");
  if (temperature > 37.2 || temperature < 36.2) warningTriggers.push("SC09");
  if (hrv < 40) warningTriggers.push("SC10");
  if (sleepHours < 7 || sleepHours > 8) warningTriggers.push("SC24");
  if (environment && (environment.co2Ppm > 900 || environment.radiationMsv > 200)) warningTriggers.push("SC26");

  const triggeredScenarios = [...new Set([...criticalTriggers, ...warningTriggers])].slice(0, 4);
  const riskScore = Math.min(100, Math.max(0, observations.length * 12 + (criticalTriggers.length * 18) + (warningTriggers.length * 8)));
  const classifier = buildSupervisedClassifier(member);
  const anomaly = buildAnomalyDetector(member, environment);

  let status = "Normal";
  let summary = "All monitored parameters remain within the expected operational range.";
  let rationale = "The classifier and anomaly detector agree that this pattern remains within the expected mission envelope.";
  let modelSummary = "Normal operating envelope";

  if (criticalTriggers.length > 0 || riskScore >= 70 || combinedCritical) {
    status = "Critical";
    summary = "Multiple physiologic indicators suggest a high-priority medical alert.";
    rationale = "The supervised classifier identified a known critical pattern and the anomaly detector independently scored a high deviation.";
    modelSummary = "Critical alert path";
  } else if (warningTriggers.length > 0 || riskScore >= 35) {
    status = "Warning";
    summary = "One or more physiologic parameters deviate from expected baseline values.";
    rationale = "The classifier flagged a monitored abnormality while the anomaly detector indicated a moderate unexplained deviation.";
    modelSummary = "Warning review path";
  } else if (observations.length === 0 && riskScore === 0) {
    status = "Normal";
    summary = "All monitored parameters remain within the expected operational range.";
    rationale = "No major deviations were observed by either model.";
    modelSummary = "Normal operating envelope";
  } else {
    status = "Uncertain";
    summary = "The telemetry pattern is ambiguous and could reflect a sensor-quality issue or an unfamiliar scenario.";
    rationale = "The supervised classifier and anomaly detector disagree or are inconclusive for this physiology profile.";
    modelSummary = "Uncertain / review required";
  }

  return {
    status,
    score: riskScore,
    summary,
    triggeredScenarios,
    observations,
    classifier,
    anomaly,
    decisionEngine: {
      rationale,
      modelSummary,
    },
  };
}

function formatCrew(row) {
  const healthMetrics = DEMO_HEALTH_METRICS[row.id] || {
    ecgSignal: "Good",
    fluidShift: "None",
    sleepHours: 7,
    reactionMs: 250,
  };
  const scenario = evaluateHealthScenario({
    ...row,
    hr: row.heart_rate,
    bp: row.blood_pressure,
    spo2: row.spo2,
    rr: row.respiratory_rate,
    temp: row.temperature,
    hrv: row.hrv,
    sleepHours: healthMetrics.sleepHours,
  });

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    callsign: row.callsign,
    color: row.color,
    hr: row.heart_rate,
    bp: row.blood_pressure,
    spo2: row.spo2,
    rr: row.respiratory_rate,
    temp: row.temperature.toFixed(1),
    hrv: row.hrv,
    hydration: row.hydration,
    bmd: row.bmd.toFixed(1),
    muscle: row.muscle.toFixed(1),
    status: scenario.status,
    riskLevel: scenario.status,
    riskScore: scenario.score,
    scenarioSummary: scenario.summary,
    triggeredScenarios: scenario.triggeredScenarios,
    observations: scenario.observations,
    classifier: scenario.classifier,
    anomaly: scenario.anomaly,
    decisionEngine: scenario.decisionEngine,
    ...healthMetrics,
  };
}

function formatAlert(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    occurredAt: row.occurred_at,
    acknowledged: row.acknowledged_at !== null,
  };
}

function formatPacket(row) {
  return {
    id: row.id,
    crewId: row.crew_id,
    packetType: row.packet_type,
    payload: JSON.parse(row.payload),
    queuedAt: row.queued_at,
    acknowledged: row.acknowledged_at !== null,
  };
}

function formatContactRequest(row) {
  return {
    id: row.id,
    crewId: row.crew_id,
    message: row.message,
    delayMinutes: row.delay_minutes,
    createdAt: row.created_at,
    scheduledFor: row.scheduled_for,
    status: row.status,
  };
}

function createApiHandlers(db) {
  return {
    health(_request, response) {
      response.json({
        status: "ok",
        dataMode: "simulated-demo",
        aiMode: "rule-based-demo-fallback",
      });
    },
    getOsd575Study(_request, response) {
      response.json({
        studyId: OSD575_CRP_DATA.studyId,
        studyTitle: OSD575_CRP_DATA.studyTitle,
        assay: OSD575_CRP_DATA.assay,
        analyte: OSD575_CRP_DATA.analyte,
        unit: OSD575_CRP_DATA.unit,
        source: OSD575_CRP_DATA.source,
        sourceFile: OSD575_CRP_DATA.sourceFile,
        samples: OSD575_CRP_DATA.samples,
        dataMode: "public-study-data",
      });
    },
    aiStatus(_request, response) {
      response.json({
        status: "ready",
        mode: "rule-based-demo-fallback",
        trainingData: "threshold rules; no model training",
        trainingSamples: 0,
        models: [
          { name: "Rule-based demo classifier", version: "rule-based-demo-v1" },
          { name: "Threshold-based deviation detector", version: "threshold-deviation-demo-v1" },
        ],
        clinicalUse: false,
      });
    },
    analyzeTelemetry(request, response) {
      const { telemetry, error } = validateTelemetryInput(request.body);
      if (error) {
        response.status(400).json({ error });
        return;
      }
      const evaluation = evaluateHealthScenario(telemetry);
      response.json({
        ...evaluation,
        dataMode: "simulated-demo",
        clinicalUse: false,
      });
    },
    listCrew(_request, response) {
      const crew = db.prepare("SELECT * FROM crew ORDER BY callsign").all().map(formatCrew);
      response.json({ crew, environment: DEMO_ENVIRONMENT, dataMode: "simulated-demo" });
    },
    addCrew(request, response) {
      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        response.status(400).json({ error: "Person details are required" });
        return;
      }

      const name = typeof body.name === "string" ? body.name.trim() : "";
      const role = typeof body.role === "string" ? body.role.trim().toUpperCase() : "";
      const callsign = typeof body.callsign === "string" ? body.callsign.trim().toUpperCase() : "";
      const hydration = typeof body.hydration === "string" ? body.hydration.trim() : "";
      const bp = typeof body.bp === "string" ? body.bp.trim() : "";
      const numericFields = {
        hr: body.hr,
        spo2: body.spo2,
        rr: body.rr,
        temp: body.temp,
        hrv: body.hrv,
        bmd: body.bmd,
        muscle: body.muscle,
      };
      const limits = {
        hr: [20, 250, true],
        spo2: [0, 100, true],
        rr: [1, 80, true],
        temp: [25, 45, false],
        hrv: [1, 300, true],
        bmd: [-100, 100, false],
        muscle: [-100, 100, false],
      };

      if (!name || name.length > 80 || !role || role.length > 40
        || !/^[A-Z0-9-]{2,20}$/.test(callsign) || !hydration || hydration.length > 40) {
        response.status(400).json({ error: "Name, role, callsign, or hydration status is invalid" });
        return;
      }

      const bloodPressure = /^(\d{2,3})\/(\d{2,3})$/.exec(bp);
      if (!bloodPressure || Number(bloodPressure[1]) < 50 || Number(bloodPressure[1]) > 300
        || Number(bloodPressure[2]) < 30 || Number(bloodPressure[2]) > 200) {
        response.status(400).json({ error: "Blood pressure must be a valid systolic/diastolic reading" });
        return;
      }

      for (const [field, [minimum, maximum, integer]] of Object.entries(limits)) {
        const value = numericFields[field];
        if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum
          || (integer && !Number.isInteger(value))) {
          response.status(400).json({ error: `${field} is outside the accepted input range` });
          return;
        }
      }

      if (db.prepare("SELECT id FROM crew WHERE callsign = ? COLLATE NOCASE").get(callsign)) {
        response.status(409).json({ error: "Callsign is already in use" });
        return;
      }

      const idBase = name.split(/\s+/).map((part) => part[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "CR";
      let id = idBase;
      let suffix = 2;
      while (db.prepare("SELECT id FROM crew WHERE id = ?").get(id)) {
        id = `${idBase}${suffix}`;
        suffix += 1;
      }

      const colors = ["purple", "teal", "orange"];
      const colorIndex = db.prepare("SELECT COUNT(*) AS count FROM crew").get().count % colors.length;
      const member = {
        id,
        name,
        role,
        callsign,
        color: colors[colorIndex],
        hr: numericFields.hr,
        bp,
        spo2: numericFields.spo2,
        rr: numericFields.rr,
        temp: numericFields.temp,
        hrv: numericFields.hrv,
        hydration,
        bmd: numericFields.bmd,
        muscle: numericFields.muscle,
      };

      db.exec("BEGIN");
      try {
        db.prepare(`
          INSERT INTO crew (
            id, name, role, callsign, color, heart_rate, blood_pressure, spo2,
            respiratory_rate, temperature, hrv, hydration, bmd, muscle
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          member.id, member.name, member.role, member.callsign, member.color,
          member.hr, member.bp, member.spo2, member.rr, member.temp, member.hrv,
          member.hydration, member.bmd, member.muscle,
        );
        db.prepare(`
          INSERT INTO measurements (crew_id, recorded_at, heart_rate, spo2)
          VALUES (?, ?, ?, ?)
        `).run(member.id, new Date().toISOString(), member.hr, member.spo2);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      const row = db.prepare("SELECT * FROM crew WHERE id = ?").get(member.id);
      response.status(201).json({ crew: formatCrew(row), dataMode: "simulated-demo" });
    },
    getTrends(request, response) {
      const crewId = normalizeCrewId(request.params?.id);
      const member = crewId ? db.prepare("SELECT id FROM crew WHERE id = ?").get(crewId) : null;
      if (!member) {
        response.status(404).json({ error: "Crew member not found" });
        return;
      }

      const rangeHours = { "24H": 24, "7D": 24 * 7, "30D": 24 * 30 };
      const range = normalizeRange(request.query?.range || "24H");
      if (!Object.hasOwn(rangeHours, range)) {
        response.status(400).json({ error: "range must be one of 24H, 7D, or 30D" });
        return;
      }

      const since = new Date(Date.now() - rangeHours[range] * 60 * 60 * 1000).toISOString();
      const points = db.prepare(`
        SELECT recorded_at AS recordedAt, heart_rate AS heartRate, spo2
        FROM measurements
        WHERE crew_id = ? AND recorded_at >= ?
        ORDER BY recorded_at
      `).all(member.id, since);
      response.json({ crewId: member.id, range, points, dataMode: "simulated-demo" });
    },
    listAlerts(_request, response) {
      const alerts = db.prepare("SELECT * FROM alerts ORDER BY occurred_at DESC").all().map(formatAlert);
      response.json({ alerts, dataMode: "simulated-demo" });
    },
    listScenarios(_request, response) {
      response.json({ scenarios: SCENARIO_LIBRARY, dataMode: "simulated-demo" });
    },
    getScenario(request, response) {
      const crewId = normalizeCrewId(request.params?.id);
      const row = crewId ? db.prepare("SELECT * FROM crew WHERE id = ?").get(crewId) : null;
      if (!row) {
        response.status(404).json({ error: "Crew member not found" });
        return;
      }

      const member = formatCrew(row);
      const evaluation = evaluateHealthScenario({
        ...member,
        hr: member.hr,
        bp: member.bp,
        spo2: member.spo2,
        rr: member.rr,
        temp: Number(member.temp),
        hrv: member.hrv,
        sleepHours: DEMO_HEALTH_METRICS[row.id]?.sleepHours ?? 7,
      }, DEMO_ENVIRONMENT);
      response.json({
        crewId: member.id,
        status: evaluation.status,
        riskScore: evaluation.score,
        summary: evaluation.summary,
        triggeredScenarios: evaluation.triggeredScenarios,
        observations: evaluation.observations,
        classifier: evaluation.classifier,
        anomaly: evaluation.anomaly,
        decisionEngine: evaluation.decisionEngine,
        dataMode: "simulated-demo",
      });
    },
    acknowledgeAlert(request, response) {
      const alertId = String(request.params?.id || "").trim();
      const result = db.prepare(`
        UPDATE alerts
        SET acknowledged_at = COALESCE(acknowledged_at, ?)
        WHERE id = ?
      `).run(new Date().toISOString(), alertId);
      if (result.changes === 0) {
        response.status(404).json({ error: "Alert not found" });
        return;
      }

      const alert = db.prepare("SELECT * FROM alerts WHERE id = ?").get(alertId);
      response.json({ alert: formatAlert(alert), dataMode: "simulated-demo" });
    },
    listPackets(_request, response) {
      const packets = db.prepare("SELECT * FROM packets ORDER BY queued_at DESC").all().map(formatPacket);
      response.json({ packets, dataMode: "simulated-demo" });
    },
    queuePacket(request, response) {
      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).some((field) => field !== "crewId")
        || typeof body.crewId !== "string" || body.crewId.length < 1 || body.crewId.length > 20) {
        response.status(400).json({ error: "Packet details are invalid" });
        return;
      }
      const crewId = normalizeCrewId(body.crewId);
      const row = crewId ? db.prepare("SELECT * FROM crew WHERE id = ?").get(crewId) : null;
      if (!row) {
        response.status(404).json({ error: "Crew member not found" });
        return;
      }
      const member = formatCrew(row);
      const payload = {
        name: member.name,
        callsign: member.callsign,
        hr: member.hr,
        bp: member.bp,
        spo2: member.spo2,
        rr: member.rr,
        temp: member.temp,
        hrv: member.hrv,
        dataMode: "simulated-demo",
      };
      const packetId = randomUUID();
      const queuedAt = new Date().toISOString();
      db.prepare(`
        INSERT INTO packets (id, crew_id, packet_type, payload, queued_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(packetId, crewId, "health-summary", JSON.stringify(payload), queuedAt);
      const packet = db.prepare("SELECT * FROM packets WHERE id = ?").get(packetId);
      response.status(201).json({ packet: formatPacket(packet), dataMode: "simulated-demo" });
    },
    acknowledgePacket(request, response) {
      const packetId = String(request.params?.id || "");
      const result = db.prepare(`
        UPDATE packets SET acknowledged_at = COALESCE(acknowledged_at, ?)
        WHERE id = ?
      `).run(new Date().toISOString(), packetId);
      if (result.changes === 0) {
        response.status(404).json({ error: "Packet not found" });
        return;
      }
      const packet = db.prepare("SELECT * FROM packets WHERE id = ?").get(packetId);
      response.json({ packet: formatPacket(packet), dataMode: "simulated-demo" });
    },
    listContactRequests(_request, response) {
      const contactRequests = db.prepare("SELECT * FROM contact_requests ORDER BY created_at DESC")
        .all().map(formatContactRequest);
      response.json({ contactRequests, dataMode: "simulated-demo", externalDelivery: false });
    },
    scheduleContactRequest(request, response) {
      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).some((field) => !["crewId", "message", "delayMinutes"].includes(field))
        || typeof body.crewId !== "string" || body.crewId.length < 1 || body.crewId.length > 20
        || typeof body.message !== "string" || body.message.length > 1000) {
        response.status(400).json({ error: "Contact request details are invalid" });
        return;
      }
      const crewId = normalizeCrewId(body?.crewId);
      const member = crewId ? db.prepare("SELECT id FROM crew WHERE id = ?").get(crewId) : null;
      const message = typeof body?.message === "string" ? body.message.trim() : "";
      const delayMinutes = body?.delayMinutes ?? 0;
      if (!member) {
        response.status(404).json({ error: "Crew member not found" });
        return;
      }
      if (!message || message.length > 1000
        || !Number.isInteger(delayMinutes) || delayMinutes < 0 || delayMinutes > 1440) {
        response.status(400).json({ error: "Message or delayMinutes is outside the accepted input range" });
        return;
      }
      const now = new Date();
      const requestId = randomUUID();
      const scheduledFor = new Date(now.getTime() + delayMinutes * 60 * 1000).toISOString();
      db.prepare(`
        INSERT INTO contact_requests (
          id, crew_id, message, delay_minutes, created_at, scheduled_for, status
        ) VALUES (?, ?, ?, ?, ?, ?, 'scheduled-local')
      `).run(requestId, crewId, message, delayMinutes, now.toISOString(), scheduledFor);
      const contactRequest = db.prepare("SELECT * FROM contact_requests WHERE id = ?").get(requestId);
      response.status(201).json({
        contactRequest: formatContactRequest(contactRequest),
        dataMode: "simulated-demo",
        externalDelivery: false,
      });
    },
    cancelContactRequest(request, response) {
      const requestId = String(request.params?.id || "");
      const existing = db.prepare("SELECT * FROM contact_requests WHERE id = ?").get(requestId);
      if (!existing) {
        response.status(404).json({ error: "Contact request not found" });
        return;
      }
      db.prepare(`
        UPDATE contact_requests SET status = 'cancelled-local'
        WHERE id = ? AND status = 'scheduled-local'
      `).run(requestId);
      const contactRequest = db.prepare("SELECT * FROM contact_requests WHERE id = ?").get(requestId);
      response.json({
        contactRequest: formatContactRequest(contactRequest),
        dataMode: "simulated-demo",
        externalDelivery: false,
      });
    },
    exportReport(request, response) {
      const crewId = normalizeCrewId(request.params?.id);
      const row = crewId ? db.prepare("SELECT * FROM crew WHERE id = ?").get(crewId) : null;
      if (!row) {
        response.status(404).json({ error: "Crew member not found" });
        return;
      }

      const member = formatCrew(row);
      const rows = [
        ["AstroVitals - Simulated mission health report"],
        ["Mission", "Odyssey-07"],
        ["Crew member", member.name],
        ["Crew ID", member.callsign],
        ["Data status", "Simulated demonstration data - not for clinical use"],
        [],
        ["Parameter", "Reading", "Unit"],
        ["Heart rate", member.hr, "BPM"],
        ["Blood pressure", member.bp, "mmHg"],
        ["Blood oxygen saturation (SpO2)", member.spo2, "%"],
        ["ECG signal", "Good", "Signal quality"],
        ["Respiratory rate", member.rr, "breaths/min"],
        ["Body temperature", member.temp, "C"],
        ["Heart rate variability", member.hrv, "ms"],
        ["Hydration status", member.hydration, ""],
        ["Bone mineral density change", member.bmd, "% since baseline"],
        ["Muscle mass change", member.muscle, "% since baseline"],
        ["Headward fluid shift", member.fluidShift, "illustrative proxy"],
        ["Cumulative radiation", DEMO_ENVIRONMENT.radiationMsv, "mSv - simulated"],
        ["Cabin carbon dioxide", DEMO_ENVIRONMENT.co2Ppm, "ppm - simulated"],
        ["Sleep duration", member.sleepHours, "hours - simulated"],
        ["Reaction time", member.reactionMs, "ms - sample/demo"],
      ];
      const csv = rows
        .map((values) => values.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
        .join("\r\n");

      response
        .type("text/csv")
        .attachment(`astra-health-${member.callsign.toLowerCase()}-demo-report.csv`)
        .send(csv);
    },
  };
}

function handleApiError(error, _request, response, _next) {
  if (error.type === "entity.parse.failed" || error.code === "ERR_INVALID_ARG_TYPE") {
    response.status(400).json({ error: "Request body must be valid JSON" });
    return;
  }
  if (error.type === "entity.too.large" || error.code === "LIMIT_JSON_SIZE") {
    response.status(413).json({ error: "Request body is too large" });
    return;
  }

  console.error("AstroVitals request failed:", error);
  if (!response.headersSent) {
    response.status(500).json({ error: "Internal server error" });
  }
}

function createApp({ dbPath = process.env.DB_PATH || path.join(__dirname, "data", "astrovitals.sqlite"), serveStatic = true } = {}) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  initializeDatabase(db);

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.locals.closeDatabase = () => db.close();
  app.locals.apiHandlers = createApiHandlers(db);

  app.get("/api/health", app.locals.apiHandlers.health);
  app.get("/api/studies/osd-575", app.locals.apiHandlers.getOsd575Study);
  app.get("/api/ai/status", app.locals.apiHandlers.aiStatus);
  app.post("/api/ai/analyze", app.locals.apiHandlers.analyzeTelemetry);
  app.get("/api/crew", app.locals.apiHandlers.listCrew);
  app.post("/api/crew", app.locals.apiHandlers.addCrew);
  app.get("/api/crew/:id/trends", app.locals.apiHandlers.getTrends);
  app.get("/api/crew/:id/scenario", app.locals.apiHandlers.getScenario);
  app.get("/api/scenarios", app.locals.apiHandlers.listScenarios);
  app.get("/api/ai/scenarios", app.locals.apiHandlers.listScenarios);
  app.get("/api/alerts", app.locals.apiHandlers.listAlerts);
  app.post("/api/alerts/:id/acknowledge", app.locals.apiHandlers.acknowledgeAlert);
  app.get("/api/packets", app.locals.apiHandlers.listPackets);
  app.post("/api/packets", app.locals.apiHandlers.queuePacket);
  app.post("/api/packets/:id/acknowledge", app.locals.apiHandlers.acknowledgePacket);
  app.get("/api/contact-requests", app.locals.apiHandlers.listContactRequests);
  app.post("/api/contact-requests", app.locals.apiHandlers.scheduleContactRequest);
  app.post("/api/contact-requests/:id/cancel", app.locals.apiHandlers.cancelContactRequest);
  app.get("/api/crew/:id/report.csv", app.locals.apiHandlers.exportReport);

  if (serveStatic) {
    app.use(express.static(__dirname));
  }

  app.use(handleApiError);

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`AstroVitals demo server listening on all interfaces at port ${port}`);
  });

  const shutdown = () => {
    server.close(() => {
      app.locals.closeDatabase();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = { createApp, createApiHandlers, SCENARIO_LIBRARY, evaluateHealthScenario, normalizeCrewId, handleApiError };
