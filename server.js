const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

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

function formatCrew(row) {
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
    ...(DEMO_HEALTH_METRICS[row.id] || {}),
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

function createApiHandlers(db) {
  return {
    health(_request, response) {
      response.json({ status: "ok", dataMode: "simulated-demo" });
    },
    listCrew(_request, response) {
      const crew = db.prepare("SELECT * FROM crew ORDER BY callsign").all().map(formatCrew);
      response.json({ crew, environment: DEMO_ENVIRONMENT, dataMode: "simulated-demo" });
    },
    getTrends(request, response) {
      const member = db.prepare("SELECT id FROM crew WHERE id = ?").get(request.params.id);
      if (!member) {
        response.status(404).json({ error: "Crew member not found" });
        return;
      }

      const rangeHours = { "24H": 24, "7D": 24 * 7, "30D": 24 * 30 };
      const range = request.query.range || "24H";
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
      response.json({ alerts });
    },
    acknowledgeAlert(request, response) {
      const result = db.prepare(`
        UPDATE alerts
        SET acknowledged_at = COALESCE(acknowledged_at, ?)
        WHERE id = ?
      `).run(new Date().toISOString(), request.params.id);
      if (result.changes === 0) {
        response.status(404).json({ error: "Alert not found" });
        return;
      }

      const alert = db.prepare("SELECT * FROM alerts WHERE id = ?").get(request.params.id);
      response.json({ alert: formatAlert(alert) });
    },
    exportReport(request, response) {
      const row = db.prepare("SELECT * FROM crew WHERE id = ?").get(request.params.id);
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

function createApp({ dbPath = process.env.DB_PATH || path.join(__dirname, "data", "astrovitals.sqlite"), serveStatic = true } = {}) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  initializeDatabase(db);

  const app = express();
  app.disable("x-powered-by");
  app.locals.closeDatabase = () => db.close();
  app.locals.apiHandlers = createApiHandlers(db);

  app.get("/api/health", app.locals.apiHandlers.health);
  app.get("/api/crew", app.locals.apiHandlers.listCrew);
  app.get("/api/crew/:id/trends", app.locals.apiHandlers.getTrends);
  app.get("/api/alerts", app.locals.apiHandlers.listAlerts);
  app.post("/api/alerts/:id/acknowledge", app.locals.apiHandlers.acknowledgeAlert);
  app.get("/api/crew/:id/report.csv", app.locals.apiHandlers.exportReport);

  if (serveStatic) {
    app.use(express.static(__dirname));
  }

  app.use((error, _request, response, _next) => {
    console.error("AstroVitals request failed:", error);
    if (!response.headersSent) {
      response.status(500).json({ error: "Internal server error" });
    }
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`AstroVitals demo server listening at http://127.0.0.1:${port}`);
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

module.exports = { createApp, createApiHandlers };
