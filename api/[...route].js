const { createApp } = require("../server");

module.exports = createApp({ dbPath: ":memory:", serveStatic: false });
