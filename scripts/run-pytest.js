const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const virtualEnvPython = process.platform === "win32"
  ? path.join(projectRoot, ".venv", "Scripts", "python.exe")
  : path.join(projectRoot, ".venv", "bin", "python");

const candidates = [
  { command: virtualEnvPython, args: ["-m", "pytest"] },
  { command: process.platform === "win32" ? "py" : "python3", args: process.platform === "win32" ? ["-3", "-m", "pytest"] : ["-m", "pytest"] },
  { command: "python", args: ["-m", "pytest"] },
];

for (const candidate of candidates) {
  const result = spawnSync(candidate.command, candidate.args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (!result.error) {
    process.exit(result.status ?? 0);
  }
}

console.error("Could not find a Python interpreter to run pytest in this project.");
process.exit(1);
