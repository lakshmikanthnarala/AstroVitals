const crewList = document.querySelector("#crew-list");
const alertList = document.querySelector("#alert-list");
const toast = document.querySelector("#toast");
const chartSvg = document.querySelector(".main-chart");
const reactionTestButton = document.querySelector("#reaction-test-button");
const reactionTestStatus = document.querySelector("#reaction-test-status");
let crew = [];
let environment;
let selectedCrewId;
let currentRange = "24H";
let toastTimeout;
let queuedPackets = 12;
let reactionTestState = "idle";
let reactionPromptTimeout;
let reactionPromptAt;
let reactionCrewId;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 2600);
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
  status.textContent = message;
  status.classList.toggle("backend-error", isError);
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
  document.querySelector(".crew-label span").textContent = String(crew.length).padStart(2, "0");
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
  document.querySelector("#heart-rate-value").textContent = member.hr;
  const [systolic, diastolic] = member.bp.split("/");
  document.querySelector("#blood-pressure-value").innerHTML = `${systolic}<span>/</span>${diastolic}`;
  document.querySelector("#spo2-value").textContent = member.spo2;
  document.querySelector("#spo2-bar").style.width = `${(member.spo2 - 90) * 10}%`;
  document.querySelector(".oxygen-track i").style.left = `${(member.spo2 - 90) * 10}%`;
  document.querySelector("#respiratory-rate-value").textContent = member.rr;
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
  updateMissionRisk(member);
}

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
  if (selectedCrewId !== member.id) cancelReactionTest();
  selectedCrewId = member.id;
  updateCrewPanel(member);
  loadTrends().catch((error) => showToast(`Could not load trends: ${error.message}`));
}

crewList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-crew]");
  if (button) selectCrew(button.dataset.crew);
});

const timeLabels = {
  "24H": ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "NOW"],
  "7D": ["DAY 1", "DAY 2", "DAY 3", "DAY 4", "DAY 5", "DAY 6", "TODAY"],
  "30D": ["−30D", "−25D", "−20D", "−15D", "−10D", "−5D", "TODAY"],
};

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
    chartSvg.querySelector(".heart-point").setAttribute("cx", "780");
    chartSvg.querySelector(".heart-point").setAttribute("cy", String(200 - ((lastPoint.heartRate - 40) / 80) * 200));
    chartSvg.querySelector(".oxygen-point").setAttribute("cx", "780");
    chartSvg.querySelector(".oxygen-point").setAttribute("cy", String(200 - (lastPoint.spo2 - 90) * 15));
  }
}

document.querySelectorAll(".range-tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".range-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
    currentRange = button.dataset.range;
    document.querySelector("#chart-context").textContent = `LAST ${currentRange === "24H" ? "24 HOURS" : currentRange === "7D" ? "7 DAYS" : "30 DAYS"}`;
    document.querySelector("#chart-x-axis").replaceChildren(
      ...timeLabels[currentRange].map((label) => {
        const span = document.createElement("span");
        span.textContent = label;
        return span;
      }),
    );
    loadTrends().catch((error) => showToast(`Could not load trends: ${error.message}`));
  });
});

function formatAlertTime(value) {
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function renderAlerts(alerts) {
  alertList.replaceChildren();
  for (const alert of alerts) {
    const row = document.createElement("article");
    row.className = `alert-row${alert.acknowledged ? " acknowledged" : ""}`;
    const indicator = document.createElement("span");
    indicator.className = `alert-indicator ${alert.acknowledged ? "info-alert" : "routine-alert"}`;
    indicator.textContent = alert.acknowledged ? "!" : "◷";
    const copy = document.createElement("div");
    copy.className = "alert-copy";
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
    row.append(indicator, copy);
    alertList.append(row);
  }

  const remaining = alerts.filter((alert) => !alert.acknowledged).length;
  document.querySelector("#alert-count").textContent = String(remaining);
  document.querySelector("#nav-alert-count").textContent = String(remaining);
}

async function loadAlerts() {
  const payload = await requestJson("/api/alerts");
  renderAlerts(payload.alerts);
}

alertList.addEventListener("click", async (event) => {
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
document.querySelector(".settings-link").addEventListener("click", () => showToast("Settings are not available in this demo"));
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
    setBackendStatus("ALL SYSTEMS NOMINAL");
  } catch (error) {
    setBackendStatus("BACKEND UNAVAILABLE", true);
    showToast(`Could not load dashboard data: ${error.message}`);
  }
}

initializeDashboard();
