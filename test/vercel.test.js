const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const app = require("../api/[...route]");

after(() => {
  app.locals.closeDatabase();
});

test("initializes the Vercel API with simulated demo health data", () => {
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
  app.locals.apiHandlers.health({}, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.dataMode, "simulated-demo");
});

test("normalizes Vercel API paths with or without the function prefix", () => {
  for (const route of ["/api/health", "/api/crew", "/api/crew/AM/trends?range=24H"]) {
    assert.equal(app.normalizeApiPath(route), route);
  }
  for (const route of ["/health", "/crew", "/crew/AM/trends?range=24H"]) {
    assert.equal(app.normalizeApiPath(route), `/api${route}`);
  }
});
