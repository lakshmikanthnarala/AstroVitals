const { createApp } = require("../server");

const app = createApp({ dbPath: ":memory:", serveStatic: false });

function normalizeApiPath(url) {
  if (url.startsWith("/api/") || url === "/api") return url;
  return `/api${url.startsWith("/") ? url : `/${url}`}`;
}

function handler(request, response) {
  request.url = normalizeApiPath(request.url);
  return app(request, response);
}

handler.locals = app.locals;
handler.normalizeApiPath = normalizeApiPath;

module.exports = handler;
