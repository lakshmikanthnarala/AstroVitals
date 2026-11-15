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
