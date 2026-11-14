const { spawn } = require("node:child_process");
const path = require("node:path");

function createLauncher({
  mode = process.env.ASTROVITALS_BACKEND || "auto",
  platform = process.platform,
  spawnProcess = spawn,
  env = process.env,
  log = (message) => console.error(message),
  onExit = (code) => {
    process.exitCode = code;
  },
} = {}) {
  const selectedMode = mode.trim().toLowerCase();
  const port = String(env.PORT || 3000);
  const virtualenvPython = platform === "win32"
    ? path.join(__dirname, ".venv", "Scripts", "python.exe")
    : path.join(__dirname, ".venv", "bin", "python");
  const pythonCommands = platform === "win32"
    ? [
      { command: virtualenvPython, prefix: [] },
      { command: "py", prefix: ["-3"] },
      { command: "python", prefix: [] },
    ]
    : [
      { command: virtualenvPython, prefix: [] },
      { command: "python3", prefix: [] },
      { command: "python", prefix: [] },
    ];
  let activeChild;
  let stoppingSignal;
  let finished = false;

  function finish(code) {
    if (finished) return;
    finished = true;
    onExit(code);
  }

  function launchChild(command, args, onFailure) {
    if (stoppingSignal || finished) return;

    let child;
    try {
      child = spawnProcess(command, args, {
        cwd: __dirname,
        env,
        stdio: "inherit",
      });
    } catch (error) {
      onFailure(error);
      return;
    }

    activeChild = child;
    let handled = false;

    child.once("error", (error) => {
      if (handled) return;
      handled = true;
      onFailure(error);
    });

    child.once("close", (code, signal) => {
      if (handled) return;
      handled = true;
      if (stoppingSignal) {
        finish(stoppingSignal === "SIGINT" ? 130 : 143);
      } else if (code === 0) {
        finish(0);
      } else {
        onFailure(new Error(signal
          ? `process terminated by ${signal}`
          : `process exited with code ${code}`));
      }
    });
  }

  function startNode() {
    launchChild(
      process.execPath,
      [path.join(__dirname, "server.js")],
      (error) => {
        log(`Node.js backend failed: ${error.message}`);
        finish(1);
      },
    );
  }

  function startPython(index = 0) {
    if (stoppingSignal || finished) return;
    if (index >= pythonCommands.length) {
      if (selectedMode === "auto") {
        log("Python backend is unavailable; falling back to the Node.js compatibility backend.");
        startNode();
      } else {
        log("Could not start the required Python backend.");
        finish(1);
      }
      return;
    }

    const { command, prefix } = pythonCommands[index];
    launchChild(
      command,
      [...prefix, "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", port],
      (error) => {
        log(`Python backend attempt using ${command} failed: ${error.message}`);
        startPython(index + 1);
      },
    );
  }

  return {
    start() {
      if (!["auto", "python", "node"].includes(selectedMode)) {
        log("ASTROVITALS_BACKEND must be auto, python, or node.");
        finish(1);
      } else if (selectedMode === "node") {
        startNode();
      } else {
        startPython();
      }
    },
    stop(signal) {
      if (finished || stoppingSignal) return;
      stoppingSignal = signal;
      if (activeChild) {
        activeChild.kill(signal);
      } else {
        finish(signal === "SIGINT" ? 130 : 143);
      }
    },
  };
}

if (require.main === module) {
  const launcher = createLauncher();
  process.on("SIGINT", () => launcher.stop("SIGINT"));
  process.on("SIGTERM", () => launcher.stop("SIGTERM"));
  launcher.start();
}

module.exports = { createLauncher };
