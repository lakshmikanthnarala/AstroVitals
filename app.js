const crewList = document.querySelector("#crew-list");
const alertList = document.querySelector("#alert-list");
const toast = document.querySelector("#toast");
const chartSvg = document.querySelector(".main-chart");
const reactionTestButton = document.querySelector("#reaction-test-button");
const reactionTestStatus = document.querySelector("#reaction-test-status");
const addPersonDialog = document.querySelector("#add-person-dialog");
const addPersonForm = document.querySelector("#add-person-form");
const addPersonError = document.querySelector("#add-person-error");
const settingsDialog = document.querySelector("#settings-dialog");
const settingsForm = document.querySelector("#settings-form");
const appShell = document.querySelector(".app-shell");
const zoomOutButton = document.querySelector("#zoom-out");
const zoomValue = document.querySelector("#zoom-value");
const zoomInButton = document.querySelector("#zoom-in");
const DEFAULT_SETTINGS = Object.freeze({
  defaultRange: "24H",
  compactLayout: false,
  reducedMotion: false,
});
const SETTINGS_STORAGE_KEY = "astrovitals.settings.v1";
let crew = [];
let environment;
let selectedCrewId;
let currentRange = "24H";
let pageZoom = 100;
let settings = { ...DEFAULT_SETTINGS };
let toastTimeout;
let queuedPackets = 12;
let lastTelemetryAt;
let latestAlerts = [];
let ecgFaultSimulated = false;
const acknowledgedAiAlerts = new Set();
let reactionTestState = "idle";
let reactionPromptTimeout;
let reactionPromptAt;
let reactionCrewId;

function updatePageZoom() {
  appShell.style.zoom = `${pageZoom}%`;
  zoomValue.textContent = `${pageZoom}%`;
  zoomOutButton.disabled = pageZoom <= 70;
  zoomInButton.disabled = pageZoom >= 130;
}

zoomOutButton.addEventListener("click", () => {
  pageZoom = Math.max(70, pageZoom - 10);
  updatePageZoom();
});
zoomValue.addEventListener("click", () => {
  pageZoom = 100;
  updatePageZoom();
});
zoomInButton.addEventListener("click", () => {
  pageZoom = Math.min(130, pageZoom + 10);
  updatePageZoom();
});
updatePageZoom();

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function readSettings() {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored === null) return { ...DEFAULT_SETTINGS };

    const parsed = JSON.parse(stored);
    if (!parsed || !["24H", "7D", "30D"].includes(parsed.defaultRange)
      || typeof parsed.compactLayout !== "boolean"
      || typeof parsed.reducedMotion !== "boolean") {
      throw new Error("Saved settings are invalid");
    }

    return {
      defaultRange: parsed.defaultRange,
      compactLayout: parsed.compactLayout,
      reducedMotion: parsed.reducedMotion,
    };
  } catch (error) {
    showToast(`Could not load saved settings: ${error.message}`);
    return { ...DEFAULT_SETTINGS };
  }
}

function updateTrendRangeControls(range) {
  document.querySelectorAll(".range-tab").forEach((tab) => {
    const selected = tab.dataset.range === range;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-pressed", String(selected));
  });
  document.querySelector("#chart-context").textContent = `LAST ${range === "24H" ? "24 HOURS" : range === "7D" ? "7 DAYS" : "30 DAYS"}`;
  document.querySelector("#chart-x-axis").replaceChildren(
    ...timeLabels[range].map((label) => {
      const span = document.createElement("span");
      span.textContent = label;
      return span;
    }),
  );
}

function applySettings(nextSettings) {
  settings = nextSettings;
  document.documentElement.classList.toggle("compact-layout", settings.compactLayout);
  document.documentElement.classList.toggle("reduce-motion", settings.reducedMotion);
  currentRange = settings.defaultRange;
  updateTrendRangeControls(currentRange);
  if (selectedCrewId) {
    loadTrends().catch((error) => showToast(`Could not load trends: ${error.message}`));
  }
}

function saveSettings(nextSettings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
  } catch (error) {
    showToast(`Could not save settings: ${error.message}`);
    return false;
  }
  applySettings(nextSettings);
  return true;
}

function openSettings() {
  if (settingsDialog.open) return;
  document.querySelector("#settings-default-range").value = settings.defaultRange;
  document.querySelector("#settings-compact-layout").checked = settings.compactLayout;
  document.querySelector("#settings-reduced-motion").checked = settings.reducedMotion;
  settingsDialog.showModal();
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.json();
}

function setBackendStatus(message, isError = false) {
  const status = document.querySelector(".connection-status");
  const indicator = status.querySelector(".live-dot");
  status.replaceChildren(indicator, document.createTextNode(` ${message}`));
  status.classList.toggle("backend-error", isError);
  document.querySelector("#backend-state").textContent = isError ? "OFFLINE" : "CONNECTED";
  document.querySelector("#backend-system-state").dataset.state = isError ? "offline" : "nominal";
}

function updateVitalStatus(id, state, message) {
  const status = document.querySelector(`#${id}`);
  const indicator = status.querySelector(".status-dot");
  indicator.className = `status-dot ${state}`;
  status.lastChild.textContent = ` ${message}`;
}

function updateTelemetryTimestamp(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return;
  lastTelemetryAt = timestamp;
  const formatted = new Intl.DateTimeFormat("en", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC",
  }).format(timestamp);
  document.querySelector("#telemetry-received-at").textContent = `RX ${formatted}Z`;
  for (const id of ["heart-rate-time", "blood-pressure-time", "spo2-time", "ecg-time"]) {
    const time = document.querySelector(`#${id}`);
    time.dateTime = new Date(timestamp).toISOString();
    time.textContent = `${formatted}Z`;
  }
  updateTelemetryFreshness();
}

function updateTelemetryFreshness() {
  const state = document.querySelector("#telemetry-state");
  const ageLabel = document.querySelector("#telemetry-age");
  if (!Number.isFinite(lastTelemetryAt)) {
    state.dataset.state = "delayed";
    ageLabel.textContent = "NO DATA";
    return;
  }
  const ageSeconds = Math.max(0, Math.floor((Date.now() - lastTelemetryAt) / 1000));
  const age = ageSeconds < 60 ? `${ageSeconds}s` : `${Math.floor(ageSeconds / 60)}m`;
  const delayed = ageSeconds >= 60;
  state.dataset.state = delayed ? "delayed" : "nominal";
  ageLabel.textContent = `${delayed ? "DELAYED" : "CURRENT"} · ${age}`;
}

function renderCrew() {
  crewList.replaceChildren();
  for (const member of crew) {
    const button = document.createElement("button");
    button.className = "crew-member";
    button.type = "button";
    button.dataset.crew = member.id;
    button.setAttribute("aria-pressed", "false");

    const avatar = document.createElement("span");
    avatar.className = `crew-avatar ${member.color}`;
    avatar.textContent = member.id;
    const details = document.createElement("span");
    details.className = "crew-details";
    const name = document.createElement("strong");
    name.textContent = member.name;
    const callsign = document.createElement("small");
    callsign.textContent = member.callsign;
    details.append(name, callsign);
    button.append(avatar, details);
    crewList.append(button);
  }
  document.querySelector("#crew-count").textContent = String(crew.length).padStart(2, "0");
}

function clampRisk(value) {
  return Math.min(100, Math.max(0, value));
}

function calculateRisk(member) {
  const temperature = Number(member.temp);
  const ecgRisk = member.ecgSignal === "Good" ? 0 : 25;
  const physiology = clampRisk(
    Math.abs(member.hr - 70) * 1.5 +
    Math.max(0, 98 - member.spo2) * 8 +
    Math.abs(temperature - 36.8) * 10 +
    ecgRisk,
  );
  const environmental = clampRisk(
    Math.max(0, (environment.co2Ppm - 800) / 20) +
    environment.radiationMsv / (environment.radiationReferenceMsv / 100),
  );
  const recovery = clampRisk(
    Math.max(0, 7 - member.sleepHours) * 15 +
    Math.max(0, member.reactionMs - 250) / 5,
  );
  return {
    composite: Math.round(physiology * 0.45 + environmental * 0.35 + recovery * 0.2),
    physiology,
    environmental,
    recovery,
  };
}

function updateMissionRisk(member) {
  const scores = calculateRisk(member);
  const band = scores.composite < 25
    ? { label: "Low", color: "#62d9a1" }
    : scores.composite < 50
      ? { label: "Watch", color: "#f0bc67" }
      : { label: "Elevated", color: "#ff887b" };
  const gauge = document.querySelector("#risk-gauge");
  document.querySelector("#risk-score").textContent = String(scores.composite);
  const bandLabel = document.querySelector("#risk-band");
  bandLabel.textContent = band.label;
  bandLabel.style.color = band.color;
  document.querySelector("#risk-kicker").textContent = `MISSION HEALTH RISK · ${band.label.toUpperCase()}`;
  gauge.style.setProperty("--risk-score", `${scores.composite}%`);
  gauge.style.setProperty("--risk-color", band.color);
  gauge.setAttribute("aria-label", `Illustrative risk score ${scores.composite} out of 100, ${band.label}`);

  for (const [factor, score] of Object.entries({
    physiology: scores.physiology,
    environment: scores.environmental,
    recovery: scores.recovery,
  })) {
    document.querySelector(`#${factor}-risk-value`).textContent = String(Math.round(score));
    document.querySelector(`#${factor}-risk-bar`).style.width = `${score}%`;
  }
}

function updateAiHealthStatus(member) {
  const classifier = member.classifier;
  const anomaly = member.anomaly;
  const decision = member.decisionEngine;
  document.querySelector("#ai-status-live").textContent = classifier?.predictedScenario || "Unavailable";
  document.querySelector("#ai-status-quality").textContent =
    Number.isFinite(classifier?.confidence) ? `${classifier.confidence.toFixed(1)}%` : "--";
  document.querySelector("#ai-status-latency").textContent =
    Number.isFinite(anomaly?.anomalyScore) ? `${anomaly.anomalyScore.toFixed(1)}%` : "--";
  document.querySelector("#ai-status-anomaly").textContent = member.status || "Unavailable";
  document.querySelector("#model-known-pattern").textContent = classifier?.predictedScenario || "Unavailable";
  document.querySelector("#model-known-confidence").textContent =
    Number.isFinite(classifier?.confidence) ? `${classifier.confidence.toFixed(1)}% classifier confidence` : "Classifier unavailable";
  document.querySelector("#model-anomaly-state").textContent =
    anomaly?.isAnomalous ? "Outlier flagged" : anomaly ? "No outlier flag" : "Unavailable";
  document.querySelector("#model-anomaly-score").textContent =
    Number.isFinite(anomaly?.anomalyScore) ? `Outlier score ${anomaly.anomalyScore.toFixed(1)}%` : "Anomaly model unavailable";
  document.querySelector("#model-decision-status").textContent = decision?.modelSummary || member.status || "Unavailable";
  document.querySelector("#model-decision-rationale").textContent =
    member.scenarioSummary
      ? `${decision?.rationale || ""} ${member.scenarioSummary}`.trim()
      : decision?.rationale || "Decision details unavailable";

  const modelsAvailable = Boolean(classifier?.modelVersion && anomaly?.modelVersion);
  document.querySelector("#model-stack-state").textContent = modelsAvailable ? "ACTIVE" : "DEGRADED";
  document.querySelector("#model-system-state").dataset.state = modelsAvailable ? "nominal" : "warning";
  const contributorList = document.querySelector("#model-contributors");
  const contributors = anomaly?.referenceFlags?.length
    ? anomaly.referenceFlags
    : classifier?.globalFeatureImportances?.slice(0, 3).map((item) =>
      `${item.feature.replaceAll("_", " ")} · ${(item.importance * 100).toFixed(0)}% model weight`,
    ) || [];
  contributorList.replaceChildren();
  for (const contributor of contributors.length ? contributors : ["No material deviation flagged"]) {
    const item = document.createElement("span");
    item.textContent = contributor;
    contributorList.append(item);
  }
}

function updateCrewPanel(member) {
  document.querySelectorAll(".crew-member").forEach((button) => {
    const selected = button.dataset.crew === member.id;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelector("#selected-avatar").textContent = member.id;
  document.querySelector("#crew-name").textContent = member.name;
  document.querySelector("#crew-role").textContent = member.role;
  document.querySelector("#crew-callsign").textContent = member.callsign;
  document.querySelector(".ecg-reading strong").textContent = member.ecgSignal;
  const statusText = document.querySelector(".status-text");
  const statusIcon = document.createElement("span");
  statusIcon.className = "status-check";
  statusIcon.textContent = member.status === "Normal" ? "✓" : "!";
  statusText.replaceChildren(statusIcon, ` ${member.status}`);
  document.querySelector(".profile-stat-right .stat-foot").textContent =
    member.status === "Normal" ? "No flagged demo readings" : "Review simulated readings";
  document.querySelector("#heart-rate-value").textContent = member.hr;
  const [systolic, diastolic] = member.bp.split("/");
  document.querySelector("#blood-pressure-value").innerHTML = `${systolic}<span>/</span>${diastolic}`;
  document.querySelector("#spo2-value").textContent = member.spo2;
  const oxygenPosition = Math.min(100, Math.max(0, (member.spo2 - 90) * 10));
  document.querySelector("#spo2-bar").style.width = `${oxygenPosition}%`;
  document.querySelector(".oxygen-track i").style.left = `${oxygenPosition}%`;
  document.querySelector("#respiratory-rate-value").textContent = member.rr;
  updateVitalStatus("heart-rate-status", member.hr < 50 || member.hr > 100 ? "bad" : "good",
    member.hr < 50 || member.hr > 100 ? "Outside demo band · 50–100 BPM" : "Within demo band");
  const bpOutOfBand = Number(systolic) < 90 || Number(systolic) > 140 || Number(diastolic) < 60 || Number(diastolic) > 90;
  updateVitalStatus("blood-pressure-status", bpOutOfBand ? "bad" : "good",
    bpOutOfBand ? "Outside demo band · 90–140 / 60–90" : "Within demo band");
  updateVitalStatus("spo2-status", member.spo2 < 94 ? "bad" : "good",
    member.spo2 < 94 ? "Below demo threshold · 94%" : "Within demo band");
  const ecgDisconnected = ecgFaultSimulated || member.ecgSignal === "Disconnected";
  const ecgGood = member.ecgSignal === "Good" && !ecgDisconnected;
  const ecgState = ecgGood ? "good" : ecgDisconnected ? "bad" : "warning";
  updateVitalStatus("ecg-status", ecgState,
    ecgGood ? "Signal quality adequate" : ecgDisconnected ? "Sensor disconnected" : "Signal degraded · review");
  document.querySelector("#ecg-sensor-state").dataset.state =
    ecgGood ? "nominal" : ecgDisconnected ? "offline" : "warning";
  document.querySelector("#ecg-sensor-state b").textContent =
    ecgGood ? "LOCKED · GOOD" : ecgDisconnected ? "DISCONNECTED" : "DEGRADED";
  document.querySelector("#vitals-bus-state b").textContent = "LOCKED · 3/3";
  document.querySelector("#heart-rate-quality").textContent = "QUALITY 96% · DEMO";
  document.querySelector("#blood-pressure-quality").textContent = "QUALITY 94% · DEMO";
  document.querySelector("#spo2-quality").textContent = "QUALITY 98% · DEMO";
  document.querySelector("#ecg-quality").textContent = ecgGood ? "QUALITY 97% · DEMO" : ecgDisconnected ? "NO SIGNAL" : "QUALITY DEGRADED";
  const ecgLinkTest = document.querySelector("#ecg-link-test");
  ecgLinkTest.textContent = ecgFaultSimulated ? "Restore ECG link" : "Run ECG link test";
  ecgLinkTest.setAttribute("aria-pressed", String(ecgFaultSimulated));
  document.querySelector("#temperature-value").innerHTML = `${member.temp} <small>°C</small>`;
  document.querySelector("#hrv-value").innerHTML = `${member.hrv} <small>MS</small>`;
  document.querySelector("#hydration-value").textContent = member.hydration;
  document.querySelector("#bmd-value").innerHTML = `${member.bmd.replace("-", "−")} <small>%</small>`;
  document.querySelector("#muscle-value").innerHTML = `${member.muscle.replace("-", "−")} <small>%</small>`;
  document.querySelector("#fluid-shift-value").textContent = member.fluidShift;
  document.querySelector("#radiation-value").innerHTML = `${environment.radiationMsv} <small>mSv</small>`;
  document.querySelector("#radiation-reference-label").textContent =
    `${Math.round(environment.radiationMsv / environment.radiationReferenceMsv * 100)}% of demo ref.`;
  document.querySelector("#environment-inputs").textContent =
    `CO₂ ${environment.co2Ppm} ppm · ${environment.radiationMsv} mSv`;
  document.querySelector("#sleep-value").innerHTML = `${member.sleepHours.toFixed(1)} <small>h</small>`;
  document.querySelector("#sleep-goal-label").textContent =
    member.sleepHours >= 7 ? "At demo goal" : "Below demo goal";
  document.querySelector("#reaction-value").innerHTML = `${member.reactionMs} <small>ms</small>`;
  updateAiHealthStatus(member);
  updateMissionRisk(member);
}

document.querySelector("#ecg-link-test").addEventListener("click", () => {
  const member = crew.find((person) => person.id === selectedCrewId);
  if (!member) return;
  ecgFaultSimulated = !ecgFaultSimulated;
  updateCrewPanel(member);
  showToast(ecgFaultSimulated
    ? "ECG disconnect simulated locally; model readings are unchanged"
    : "ECG link restored in the local display");
});

function cancelReactionTest() {
  if (reactionTestState === "idle") return;
  clearTimeout(reactionPromptTimeout);
  reactionTestState = "idle";
  reactionTestButton.classList.remove("waiting", "ready");
  reactionTestButton.textContent = "Run check";
  reactionTestStatus.textContent = "Crew selection changed; reaction check canceled.";
}

function selectCrew(id) {
  const member = crew.find((person) => person.id === id);
  if (!member) return;
  if (selectedCrewId !== member.id) {
    cancelReactionTest();
    ecgFaultSimulated = false;
  }
  selectedCrewId = member.id;
  updateCrewPanel(member);
  loadTrends().catch((error) => showToast(`Could not load trends: ${error.message}`));
  loadAlerts().catch((error) => showToast(`Could not load alerts: ${error.message}`));
}

crewList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-crew]");
  if (button) selectCrew(button.dataset.crew);
});

function openAddPersonDialog() {
  addPersonError.textContent = "";
  addPersonDialog.showModal();
}

document.querySelector("#add-person-button").addEventListener("click", openAddPersonDialog);
document.querySelector("#add-person-sidebar-button").addEventListener("click", openAddPersonDialog);
document.querySelector("#close-add-person").addEventListener("click", () => addPersonDialog.close());
document.querySelector("#cancel-add-person").addEventListener("click", () => addPersonDialog.close());

addPersonForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  addPersonError.textContent = "";
  const submitButton = addPersonForm.querySelector('button[type="submit"]');
  const formValues = Object.fromEntries(new FormData(addPersonForm).entries());
  for (const field of ["hr", "spo2", "rr", "temp", "hrv", "bmd", "muscle"]) {
    formValues[field] = Number(formValues[field]);
  }

  submitButton.disabled = true;
  try {
    const payload = await requestJson("/api/crew", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formValues),
    });
    crew = [...crew, payload.crew].sort((first, second) => first.callsign.localeCompare(second.callsign));
    renderCrew();
    addPersonForm.reset();
    addPersonDialog.close();
    selectCrew(payload.crew.id);
    showToast(`${payload.crew.name} added to mission crew`);
  } catch (error) {
    addPersonError.textContent = `Could not add person: ${error.message}`;
  } finally {
    submitButton.disabled = false;
  }
});

const timeLabels = {
  "24H": ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "NOW"],
  "7D": ["DAY 1", "DAY 2", "DAY 3", "DAY 4", "DAY 5", "DAY 6", "TODAY"],
  "30D": ["−30D", "−25D", "−20D", "−15D", "−10D", "−5D", "TODAY"],
};

settings = readSettings();
document.documentElement.classList.toggle("compact-layout", settings.compactLayout);
document.documentElement.classList.toggle("reduce-motion", settings.reducedMotion);
currentRange = settings.defaultRange;
updateTrendRangeControls(currentRange);

function makeChartPath(points, valueForPoint) {
  if (!points.length) return "";
  return points.map((point, index) => {
    const x = points.length === 1 ? 780 : (index / (points.length - 1)) * 780;
    const y = Math.max(0, Math.min(200, valueForPoint(point)));
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

async function loadTrends() {
  if (!selectedCrewId) return;
  const payload = await requestJson(`/api/crew/${encodeURIComponent(selectedCrewId)}/trends?range=${currentRange}`);
  const heartPath = makeChartPath(payload.points, (point) => 200 - ((point.heartRate - 40) / 80) * 200);
  const oxygenPath = makeChartPath(payload.points, (point) => 200 - (point.spo2 - 90) * 15);
  chartSvg.querySelector(".heart-line").setAttribute("d", heartPath);
  chartSvg.querySelector(".chart-area-fill").setAttribute("d", heartPath ? `${heartPath}V200H0Z` : "");
  chartSvg.querySelector(".oxygen-line").setAttribute("d", oxygenPath);

  const lastPoint = payload.points.at(-1);
  if (lastPoint) {
    updateTelemetryTimestamp(lastPoint.recordedAt);
    chartSvg.querySelector(".heart-point").setAttribute("cx", "780");
    chartSvg.querySelector(".heart-point").setAttribute("cy", String(200 - ((lastPoint.heartRate - 40) / 80) * 200));
    chartSvg.querySelector(".oxygen-point").setAttribute("cx", "780");
    chartSvg.querySelector(".oxygen-point").setAttribute("cy", String(200 - (lastPoint.spo2 - 90) * 15));
  }
}

document.querySelectorAll(".range-tab").forEach((button) => {
  button.addEventListener("click", () => {
    currentRange = button.dataset.range;
    updateTrendRangeControls(currentRange);
    loadTrends().catch((error) => showToast(`Could not load trends: ${error.message}`));
  });
});

function formatAlertTime(value) {
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function renderAlerts(alerts) {
  latestAlerts = alerts;
  const selectedMember = crew.find((member) => member.id === selectedCrewId);
  const aiAlert = selectedMember && selectedMember.status !== "Normal"
    ? {
      id: `ai-model-review-${selectedMember.id}`,
      title: `MODEL REVIEW · ${selectedMember.status.toUpperCase()}`,
      description: selectedMember.scenarioSummary,
      occurredAt: new Date().toISOString(),
      acknowledged: acknowledgedAiAlerts.has(selectedMember.id),
      isAi: true,
      parameters: [
        `${selectedMember.hr} HR · BPM`,
        `${selectedMember.bp} BP · mmHg`,
        `${selectedMember.spo2}% SpO₂`,
        `ECG ${selectedMember.ecgSignal}`,
      ],
    }
    : null;

  const visibleAlerts = aiAlert ? [aiAlert, ...alerts] : alerts;
  alertList.replaceChildren();
  for (const alert of visibleAlerts) {
    const row = document.createElement("article");
    row.className = `alert-row${alert.acknowledged ? " acknowledged" : ""}${alert.isAi ? " ai-alert-row" : ""}`;
    const indicator = document.createElement("span");
    indicator.className = `alert-indicator ${alert.isAi ? "ai-alert-indicator" : alert.acknowledged ? "info-alert" : "routine-alert"}`;
    indicator.textContent = alert.isAi ? "!" : alert.acknowledged ? "!" : "◷";
    const copy = document.createElement("div");
    copy.className = `alert-copy${alert.isAi ? " ai-alert-copy" : ""}`;

    if (alert.isAi) {
      const heading = document.createElement("div");
      heading.className = "alert-summary";
      const title = document.createElement("strong");
      title.textContent = alert.title;
      const tag = document.createElement("span");
      tag.className = "alert-tag";
      tag.textContent = alert.title.includes("CRITICAL") ? "CRITICAL · REVIEW" : "MODEL REVIEW";
      heading.append(title, tag);
      const time = document.createElement("span");
      time.className = "alert-time";
      time.textContent = "NOW";
      const description = document.createElement("p");
      description.className = "alert-body";
      description.textContent = alert.description;
      const metrics = document.createElement("div");
      metrics.className = "alert-parameters";
      alert.parameters.forEach((value) => {
        const metric = document.createElement("span");
        metric.className = "alert-parameter";
        metric.textContent = value;
        metrics.append(metric);
      });
      const footer = document.createElement("div");
      footer.className = "alert-actions";
      const status = document.createElement("span");
      status.className = "alert-ack-status";
      status.textContent = alert.acknowledged ? "ACKNOWLEDGED · THIS SESSION" : "AWAITING FLIGHT CREW ACK";
      footer.append(status);
      if (!alert.acknowledged) {
        const acknowledge = document.createElement("button");
        acknowledge.className = "ack-button";
        acknowledge.type = "button";
        acknowledge.dataset.aiAlert = selectedMember.id;
        acknowledge.textContent = "Acknowledge for this session";
        footer.append(acknowledge);
      }
      copy.append(heading, time, description, metrics, footer);
    } else {
      const heading = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = alert.title;
      const time = document.createElement("span");
      time.className = "alert-time";
      time.textContent = formatAlertTime(alert.occurredAt);
      heading.append(title, time);
      const description = document.createElement("p");
      description.textContent = alert.description;
      copy.append(heading, description);
      if (alert.acknowledged) {
        const tag = document.createElement("span");
        tag.className = "alert-tag";
        tag.textContent = "REVIEWED · DEMO";
        copy.append(tag);
      } else {
        const button = document.createElement("button");
        button.className = "ack-button";
        button.type = "button";
        button.dataset.alert = alert.id;
        button.innerHTML = "Acknowledge <span>→</span>";
        copy.append(button);
      }
    }
    row.append(indicator, copy);
    alertList.append(row);
  }

  const remaining = alerts.filter((alert) => !alert.acknowledged).length + (aiAlert && !aiAlert.acknowledged ? 1 : 0);
  document.querySelector("#alert-count").textContent = String(remaining);
  document.querySelector("#nav-alert-count").textContent = String(remaining);
}

async function loadAlerts() {
  const payload = await requestJson("/api/alerts");
  renderAlerts(payload.alerts);
}

alertList.addEventListener("click", async (event) => {
  const aiButton = event.target.closest("[data-ai-alert]");
  if (aiButton) {
    acknowledgedAiAlerts.add(aiButton.dataset.aiAlert);
    renderAlerts(latestAlerts);
    showToast("Model review acknowledged for this session");
    return;
  }
  const button = event.target.closest("[data-alert]");
  if (!button) return;

  button.disabled = true;
  try {
    await requestJson(`/api/alerts/${encodeURIComponent(button.dataset.alert)}/acknowledge`, { method: "POST" });
    await loadAlerts();
    showToast("Alert acknowledged");
  } catch (error) {
    button.disabled = false;
    showToast(`Could not acknowledge alert: ${error.message}`);
  }
});

document.querySelector("#export-button").addEventListener("click", async () => {
  const member = crew.find((person) => person.id === selectedCrewId);
  if (!member) return;
  try {
    const response = await fetch(`/api/crew/${encodeURIComponent(member.id)}/report.csv`);
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(await response.blob());
    link.download = `astra-health-${member.callsign.toLowerCase()}-demo-report.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
    showToast("Simulated health report exported");
  } catch (error) {
    showToast(`Could not export report: ${error.message}`);
  }
});

const queueCount = document.querySelector("#queue-count");
const queueBatchButton = document.querySelector("#queue-batch-button");
const uplinkButton = document.querySelector("#uplink-button");
const earthLinkStatus = document.querySelector("#earth-link-status");

queueBatchButton.addEventListener("click", () => {
  queuedPackets += 6;
  queueCount.textContent = String(queuedPackets);
  showToast("6 demo packets queued on this device only");
});

uplinkButton.addEventListener("click", () => {
  if (queuedPackets === 0) {
    showToast("No local demo packets are waiting");
    return;
  }
  uplinkButton.disabled = true;
  uplinkButton.textContent = "Simulating delayed contact…";
  earthLinkStatus.textContent = "UPLINK DEMO · NO LINK";
  showToast("Contact-window simulation started; no data is being sent");
  setTimeout(() => {
    queuedPackets = 0;
    queueCount.textContent = "0";
    earthLinkStatus.textContent = "DELAYED · SIMULATED";
    uplinkButton.disabled = false;
    uplinkButton.textContent = "Simulate contact window";
    showToast("Demo complete; packets remain local, no Earth transfer occurred");
  }, 1400);
});

reactionTestButton.addEventListener("click", () => {
  const member = crew.find((person) => person.id === selectedCrewId);
  if (!member) return;

  if (reactionTestState === "waiting") {
    clearTimeout(reactionPromptTimeout);
    reactionTestState = "idle";
    reactionTestButton.classList.remove("waiting");
    reactionTestButton.textContent = "Run check";
    reactionTestStatus.textContent = "Too soon. Retry and tap only when prompted.";
    return;
  }

  if (reactionTestState === "ready") {
    const result = Math.round(performance.now() - reactionPromptAt);
    member.reactionMs = result;
    reactionTestState = "idle";
    reactionTestButton.classList.remove("ready");
    reactionTestButton.textContent = "Run again";
    document.querySelector("#reaction-value").innerHTML = `${result} <small>ms</small>`;
    reactionTestStatus.textContent = `${result} ms · sample saved on this page only; demo test is not validated.`;
    updateMissionRisk(member);
    return;
  }

  reactionCrewId = member.id;
  reactionTestState = "waiting";
  reactionTestButton.classList.add("waiting");
  reactionTestButton.textContent = "Wait…";
  reactionTestStatus.textContent = "Tap when the prompt changes.";
  reactionPromptTimeout = setTimeout(() => {
    if (selectedCrewId !== reactionCrewId) {
      cancelReactionTest();
      return;
    }
    reactionTestState = "ready";
    reactionPromptAt = performance.now();
    reactionTestButton.classList.remove("waiting");
    reactionTestButton.classList.add("ready");
    reactionTestButton.textContent = "TAP NOW";
  }, 1500 + Math.random() * 2000);
});

document.querySelector("#chart-menu").addEventListener("click", () => showToast("Trend chart uses simulated demonstration data"));
document.querySelector("#all-indicators").addEventListener("click", () => showToast("All prioritized mission health indicators are shown"));
document.querySelector("#view-alerts").addEventListener("click", () => showToast("Showing recent demonstration alerts"));
document.querySelector(".settings-link").addEventListener("click", openSettings);
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === ",") {
    event.preventDefault();
    openSettings();
  }
});
document.querySelector("#close-settings").addEventListener("click", () => settingsDialog.close());
document.querySelector("#cancel-settings").addEventListener("click", () => settingsDialog.close());
document.querySelector("#reset-settings").addEventListener("click", () => {
  if (!saveSettings({ ...DEFAULT_SETTINGS })) return;
  settingsDialog.close();
  showToast("Settings reset to defaults");
});
settingsDialog.addEventListener("click", (event) => {
  if (event.target === settingsDialog) settingsDialog.close();
});
settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const nextSettings = {
    defaultRange: document.querySelector("#settings-default-range").value,
    compactLayout: document.querySelector("#settings-compact-layout").checked,
    reducedMotion: document.querySelector("#settings-reduced-motion").checked,
  };
  if (!["24H", "7D", "30D"].includes(nextSettings.defaultRange)) {
    showToast("Choose a valid default trend range");
    return;
  }
  if (!saveSettings(nextSettings)) return;
  settingsDialog.close();
  showToast("Settings saved");
});
document.querySelector(".avatar-button").addEventListener("click", () => showToast("Mission Control operator"));

document.querySelector("#current-date").textContent = new Intl.DateTimeFormat("en", {
  weekday: "short", month: "short", day: "2-digit", year: "numeric",
}).format(new Date()).toUpperCase();

async function initializeDashboard() {
  try {
    const [crewPayload, alertsPayload] = await Promise.all([
      requestJson("/api/crew"),
      requestJson("/api/alerts"),
    ]);
    crew = crewPayload.crew;
    environment = crewPayload.environment;
    renderCrew();
    if (!crew.length) throw new Error("The API returned no crew members");
    if (!environment || !Number.isFinite(environment.co2Ppm)
      || !Number.isFinite(environment.radiationMsv)
      || !Number.isFinite(environment.radiationReferenceMsv)) {
      throw new Error("The API returned invalid environmental demo data");
    }
    if (crew.some((member) => !member.ecgSignal || !member.fluidShift
      || !Number.isFinite(member.sleepHours)
      || !Number.isFinite(member.reactionMs))) {
      throw new Error("The API returned incomplete space-health demo metrics");
    }
    selectedCrewId = crew[0].id;
    updateCrewPanel(crew[0]);
    renderAlerts(alertsPayload.alerts);
    await loadTrends();
    setBackendStatus("API CONNECTED");
  } catch (error) {
    setBackendStatus("API OFFLINE", true);
    showToast(`Could not load dashboard data: ${error.message}`);
  }
}

initializeDashboard();
setInterval(updateTelemetryFreshness, 10_000);
setInterval(async () => {
  try {
    await requestJson("/api/health");
    setBackendStatus("API CONNECTED");
  } catch {
    setBackendStatus("API OFFLINE", true);
  }
}, 15_000);
