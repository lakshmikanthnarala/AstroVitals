const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { test } = require("node:test");
const { createLauncher } = require("../start");

test("prefers the project virtualenv when starting the Python backend", () => {
  const calls = [];
  const child = new EventEmitter();
  child.kill = () => {};
  const exits = [];
  const launcher = createLauncher({
    mode: "python",
    platform: "win32",
    spawnProcess(command, args) {
      calls.push({ command, args });
      return child;
    },
    onExit: (code) => exits.push(code),
    log: () => {},
  });

  launcher.start();

  assert.equal(calls[0].command, path.join(__dirname, "..", ".venv", "Scripts", "python.exe"));
  assert.deepEqual(calls[0].args.slice(0, 2), ["-m", "uvicorn"]);
  child.emit("close", 0, null);
  assert.deepEqual(exits, [0]);
});

test("falls back to Node when Python backends fail", () => {
  const calls = [];
  const children = [];
  const exits = [];
  const messages = [];
  const launcher = createLauncher({
    mode: "auto",
    platform: "win32",
    env: { PORT: "4321" },
    spawnProcess(command, args, options) {
      const child = new EventEmitter();
      child.kill = () => {};
      calls.push({ command, args, options });
      children.push(child);
      return child;
    },
    onExit: (code) => exits.push(code),
    log: (message) => messages.push(message),
  });

  launcher.start();
  assert.equal(calls[0].command, path.join(__dirname, "..", ".venv", "Scripts", "python.exe"));
  assert.deepEqual(calls[0].args.slice(0, 2), ["-m", "uvicorn"]);
  children[0].emit("close", 1, null);

  assert.equal(calls[1].command, "py");
  assert.deepEqual(calls[1].args.slice(0, 3), ["-3", "-m", "uvicorn"]);
  children[1].emit("error", Object.assign(new Error("not found"), { code: "ENOENT" }));

  assert.equal(calls[2].command, "python");
  children[2].emit("close", 1, null);

  assert.equal(calls[3].command, process.execPath);
  assert.deepEqual(calls[3].args, [path.join(__dirname, "..", "server.js")]);
  assert.equal(calls[3].options.env.PORT, "4321");
  assert.match(messages.at(-1), /falling back to the Node\.js/);
  children[3].emit("close", 0, null);
  assert.deepEqual(exits, [0]);
});

test("does not fall back when a required Python backend fails", () => {
  const calls = [];
  const children = [];
  const exits = [];
  const launcher = createLauncher({
    mode: "python",
    platform: "win32",
    spawnProcess(command) {
      const child = new EventEmitter();
      child.kill = () => {};
      calls.push(command);
      children.push(child);
      return child;
    },
    onExit: (code) => exits.push(code),
    log: () => {},
  });

  launcher.start();
  children[0].emit("close", 1, null);
  children[1].emit("close", 1, null);
  children[2].emit("close", 1, null);

  assert.deepEqual(calls, [
    path.join(__dirname, "..", ".venv", "Scripts", "python.exe"),
    "py",
    "python",
  ]);
  assert.deepEqual(exits, [1]);
});
