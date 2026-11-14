const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createApp, handleApiError } = require("../server");

let app;

function callHandler(handler, request = {}) {
  const response = {
    statusCode: 200,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    type(value) {
      this.headers["content-type"] = value;
      return this;
    },
    attachment(value) {
      this.headers["content-disposition"] = value;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
  handler({ params: {}, query: {}, ...request }, response);
  return response;
}

function callErrorHandler(error) {
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  handleApiError(error, {}, response, () => {});
  return response;
}

before(() => {
  app = createApp({ dbPath: ":memory:", serveStatic: false });
});

after(() => {
  app.locals.closeDatabase();
});

test("serves the seeded crew as simulated demo data", () => {
  const response = callHandler(app.locals.apiHandlers.listCrew);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.dataMode, "simulated-demo");
  assert.deepEqual(response.body.environment, {
    co2Ppm: 820,
    radiationMsv: 128,
    radiationReferenceMsv: 600,
  });
  assert.equal(response.body.crew.length, 3);
  assert.equal(response.body.crew[0].callsign, "ASTRA-01");
  assert.equal(response.body.crew[0].ecgSignal, "Good");
  assert.equal(response.body.crew[0].fluidShift, "Mild");
  assert.equal(response.body.crew[0].sleepHours, 6.4);
  assert.equal(response.body.crew[0].reactionMs, 284);
});

test("adds a person with persisted vitals and an initial trend point", () => {
  const details = {
    name: "Nia Long",
    role: "MISSION SPECIALIST",
    callsign: "ASTRA-04",
    hr: 70,
    bp: "120/80",
    spo2: 98,
    rr: 14,
    temp: 36.8,
    hrv: 55,
    hydration: "Stable",
    bmd: -0.5,
    muscle: -0.2,
  };
  const response = callHandler(app.locals.apiHandlers.addCrew, { body: details });
  const crewResponse = callHandler(app.locals.apiHandlers.listCrew);
  const trendsResponse = callHandler(app.locals.apiHandlers.getTrends, {
    params: { id: response.body.crew.id },
    query: { range: "24H" },
  });
  const duplicateResponse = callHandler(app.locals.apiHandlers.addCrew, {
    body: { ...details, name: "Nia Long Duplicate" },
  });
  const invalidResponse = callHandler(app.locals.apiHandlers.addCrew, {
    body: { ...details, callsign: "ASTRA-05", spo2: 101 },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.crew.name, details.name);
  assert.equal(response.body.crew.hr, details.hr);
  assert.equal(response.body.crew.bp, details.bp);
  assert.equal(response.body.crew.spo2, details.spo2);
  assert.equal(response.body.crew.rr, details.rr);
  assert.equal(response.body.crew.temp, details.temp.toFixed(1));
  assert.equal(response.body.crew.hrv, details.hrv);
  assert.equal(response.body.crew.hydration, details.hydration);
  assert.equal(response.body.crew.bmd, details.bmd.toFixed(1));
  assert.equal(response.body.crew.muscle, details.muscle.toFixed(1));
  assert.ok(crewResponse.body.crew.some((member) => member.id === response.body.crew.id));
  assert.equal(trendsResponse.statusCode, 200);
  assert.equal(trendsResponse.body.points.length, 1);
  assert.equal(duplicateResponse.statusCode, 409);
  assert.equal(invalidResponse.statusCode, 400);
});

test("returns range-validated telemetry trends", () => {
  const response = callHandler(app.locals.apiHandlers.getTrends, {
    params: { id: "AM" },
    query: { range: "7D" },
  });
  const lowercaseResponse = callHandler(app.locals.apiHandlers.getTrends, {
    params: { id: "am" },
    query: { range: "7d" },
  });
  const invalidResponse = callHandler(app.locals.apiHandlers.getTrends, {
    params: { id: "AM" },
    query: { range: "2D" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.range, "7D");
  assert.ok(response.body.points.length > 0);
  assert.ok(response.body.points.every((point) => Number.isInteger(point.heartRate) && Number.isInteger(point.spo2)));
  assert.equal(lowercaseResponse.statusCode, 200);
  assert.equal(lowercaseResponse.body.range, "7D");
  assert.equal(invalidResponse.statusCode, 400);
});

test("exports a report and acknowledges alerts with normalized IDs", () => {
  const reportResponse = callHandler(app.locals.apiHandlers.exportReport, { params: { id: "am" } });
  const acknowledgeResponse = callHandler(app.locals.apiHandlers.acknowledgeAlert, {
    params: { id: " alert-hydration-checkin " },
  });

  assert.equal(reportResponse.statusCode, 200);
  assert.equal(acknowledgeResponse.statusCode, 200);
  assert.equal(acknowledgeResponse.body.alert.acknowledged, true);
});

test("classifies crew telemetry against the scenario library and exposes scenario APIs", () => {
  const crewResponse = callHandler(app.locals.apiHandlers.listCrew);
  const scenarioResponse = callHandler(app.locals.apiHandlers.getScenario, { params: { id: "AM" } });
  const libraryResponse = callHandler(app.locals.apiHandlers.listScenarios);

  assert.equal(crewResponse.statusCode, 200);
  assert.ok(["Normal", "Warning", "Critical", "Uncertain"].includes(crewResponse.body.crew[0].status));
  assert.equal(scenarioResponse.statusCode, 200);
  assert.ok(["Normal", "Warning", "Critical", "Uncertain"].includes(scenarioResponse.body.status));
  assert.ok(Array.isArray(libraryResponse.body.scenarios));
  assert.ok(libraryResponse.body.scenarios.some((scenario) => scenario.id === "SC06"));
});

test("persists an alert acknowledgement and handles unknown alerts", () => {
  const response = callHandler(app.locals.apiHandlers.acknowledgeAlert, {
    params: { id: "alert-hydration-checkin" },
  });
  const alertsResponse = callHandler(app.locals.apiHandlers.listAlerts);
  const missingResponse = callHandler(app.locals.apiHandlers.acknowledgeAlert, {
    params: { id: "missing" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.alert.acknowledged, true);
  assert.equal(
    alertsResponse.body.alerts.find((alert) => alert.id === "alert-hydration-checkin").acknowledged,
    true,
  );
  assert.equal(missingResponse.statusCode, 404);
});

test("exports a simulated CSV report and rejects unknown crew", () => {
  const response = callHandler(app.locals.apiHandlers.exportReport, { params: { id: "AM" } });
  const missingResponse = callHandler(app.locals.apiHandlers.exportReport, { params: { id: "XX" } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/csv");
  assert.match(response.body, /not for clinical use/);
  assert.match(response.body, /Headward fluid shift/);
  assert.match(response.body, /Cabin carbon dioxide/);
  assert.match(response.body, /Reaction time/);
  assert.equal(missingResponse.statusCode, 404);
});

test("maps malformed and oversized JSON errors to client responses", () => {
  const malformedResponse = callErrorHandler({ type: "entity.parse.failed" });
  const oversizedResponse = callErrorHandler({ type: "entity.too.large" });

  assert.equal(malformedResponse.statusCode, 400);
  assert.deepEqual(malformedResponse.body, { error: "Request body must be valid JSON" });
  assert.equal(oversizedResponse.statusCode, 413);
  assert.deepEqual(oversizedResponse.body, { error: "Request body is too large" });
});
