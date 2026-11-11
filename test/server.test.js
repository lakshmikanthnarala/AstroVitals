const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createApp } = require("../server");

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

test("returns range-validated telemetry trends", () => {
  const response = callHandler(app.locals.apiHandlers.getTrends, {
    params: { id: "AM" },
    query: { range: "7D" },
  });
  const invalidResponse = callHandler(app.locals.apiHandlers.getTrends, {
    params: { id: "AM" },
    query: { range: "2D" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.range, "7D");
  assert.ok(response.body.points.length > 0);
  assert.ok(response.body.points.every((point) => Number.isInteger(point.heartRate) && Number.isInteger(point.spo2)));
  assert.equal(invalidResponse.statusCode, 400);
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
