const crewGrid = document.querySelector("#crew-grid");
const toast = document.querySelector("#toast");
const addPersonDialog = document.querySelector("#add-person-dialog");
const addPersonForm = document.querySelector("#add-person-form");
const addPersonError = document.querySelector("#add-person-error");
const fleetView = document.querySelector("#fleet");
const clinicalView = document.querySelector("#clinical");
const alertList = document.querySelector("#alert-list");
const packetList = document.querySelector("#packet-list");
const contactList = document.querySelector("#contact-list");
const contactRequestForm = document.querySelector("#contact-request-form");
const queuePacketButton = document.querySelector("#queue-packet-button");
const studyParticipantSelect = document.querySelector("#osd575-participant");
const studySamples = document.querySelector("#osd575-samples");
const namespace = "http://www.w3.org/2000/svg";

let crew = [];
let environment;
let alerts = [];
let packets = [];
let contactRequests = [];
let osd575Study;
let selectedCrewId;
let toastTimeout;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 2800);
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.json();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function isAttention(member) {
  return member.status !== "Normal";
}

function statusLabel(member) {
  if (!isAttention(member)) return "NOMINAL";
  return String(member.status || "REVIEW").toUpperCase();
}

function createCrewCard(member) {
  const attention = isAttention(member);
  const card = element("button", `crew-card${attention ? " attention" : ""}`);
  card.type = "button";
  card.dataset.crew = member.id;
  card.setAttribute("aria-label", `Open clinical deep dive for ${member.name}`);

  const heading = element("div", "crew-card-heading");
  const identity = element("div", "crew-identity");
  const avatar = element("span", `crew-avatar ${attention ? "amber" : member.color === "teal" ? "green" : ""}`, initials(member.name));
  avatar.setAttribute("aria-hidden", "true");
  const nameBlock = element("span");
  nameBlock.append(
    element("span", "crew-name", member.name),
    element("span", "crew-callsign", `#${member.callsign}`),
    element("span", "crew-role", member.role),
  );
  identity.append(avatar, nameBlock);
  heading.append(identity, element("span", `crew-state${attention ? " caution" : ""}`, statusLabel(member)));

  const vitals = element("div", "crew-vitals");
  const metrics = [
    ["HEART RATE", member.hr, "BPM", attention ? "" : "nominal-value"],
    ["BLOOD PRESS", member.bp, "mmHg", ""],
    ["SpO₂ LEVEL", member.spo2, "%", "oxygen-value"],
    ["CORE TEMP", member.temp, "°C", ""],
  ];
  for (const [label, value, unit, valueClass] of metrics) {
    const metric = element("div");
    metric.append(element("small", "", label));
    const reading = element("strong", valueClass, String(value));
    if (label === "BLOOD PRESS") reading.style.fontSize = "13px";
    metric.append(reading, element("em", "", unit));
    vitals.append(metric);
  }

  const waveform = element("div", "crew-wave");
  const caption = element("div", "crew-wave-caption");
  caption.append(element("span", "", `ECG TRACE · ${member.ecgSignal || "DEMO"}`), element("span", "", `${member.hrv} ms HRV`));
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 300 44");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", "M0 22H30L39 19 47 25 55 22H70L79 36 88 4 97 39 106 22H130L139 19 147 25 155 22H170L179 36 188 4 197 39 206 22H230L239 19 247 25 255 22H270L279 36 288 4 297 39");
  svg.append(path);
  waveform.append(caption, svg);

  const footer = element("span", "crew-card-footer");
  footer.append(
    element("span", "", `${member.spo2}% SpO₂ · ${member.hydration}`),
    element("strong", "", "CLINICAL DEEP-DIVE PROFILE"),
    element("span", "detail-arrow", "→"),
  );
  card.append(heading, vitals, waveform, footer);
  return card;
}

function renderOsd575Samples() {
  if (!osd575Study) return;
  const participant = studyParticipantSelect.value;
  const samples = osd575Study.samples.filter((sample) => sample.participant === participant);
  const maxConcentration = Math.max(...samples.map((sample) => sample.crp));
  studySamples.replaceChildren();

  for (const sample of samples) {
    const point = element("article", "study-sample");
    const header = element("div", "study-sample-heading");
    header.append(
      element("strong", "", sample.timepoint),
      element("span", "", `${sample.crp.toLocaleString()} ${osd575Study.unit}`),
    );
    const bar = element("div", "study-sample-bar");
    const fill = element("span");
    fill.style.width = `${(sample.crp / maxConcentration) * 100}%`;
    fill.setAttribute("aria-hidden", "true");
    bar.append(fill);
    point.append(header, bar);
    studySamples.append(point);
  }
}

async function loadOsd575Study() {
  const payload = await requestJson("/api/studies/osd-575");
  if (!payload || !Array.isArray(payload.samples) || !payload.samples.length) {
    throw new Error("The API returned no OSD-575 sample data.");
  }
  osd575Study = payload;
  const participants = [...new Set(payload.samples.map((sample) => sample.participant))];
  studyParticipantSelect.replaceChildren(...participants.map((participant) => {
    const option = element("option", "", participant);
    option.value = participant;
    return option;
  }));
  studyParticipantSelect.disabled = false;
  document.querySelector("#osd575-source-label").textContent =
    `${payload.studyId} · ${payload.assay} · ${payload.analyte} (${payload.unit})`;
  renderOsd575Samples();
}

function renderCrew() {
  const filter = document.querySelector("#crew-filter").value;
  const visibleCrew = filter === "attention" ? crew.filter(isAttention) : crew;
  crewGrid.replaceChildren();
  const attentionCount = crew.filter(isAttention).length;
  const nominalCount = crew.length - attentionCount;
  document.querySelector("#crew-count").textContent = String(crew.length);
  document.querySelector("#nominal-count").textContent = `${nominalCount} NOMINAL`;
  document.querySelector("#crew-caution").textContent = `${attentionCount} CAUTION`;
  document.querySelector("#caution-count").textContent = `${attentionCount} CAUTION`;
  document.querySelector("#fleet-nav-status").textContent = attentionCount ? `${attentionCount} REVIEW` : "NOMINAL";
  document.querySelector("#readiness-meter").style.width = `${crew.length ? (nominalCount / crew.length) * 100 : 0}%`;
  document.querySelector("#radiation-total").textContent = `${environment.radiationMsv} mSv`;
  if (!visibleCrew.length) {
    crewGrid.append(element("div", "crew-empty", "No crew members currently require attention."));
    return;
  }
  for (const member of visibleCrew) crewGrid.append(createCrewCard(member));
}

function setView(view) {
  const isClinical = view === "clinical";
  fleetView.hidden = isClinical;
  clinicalView.hidden = !isClinical;
  document.querySelector("#export-button").hidden = !isClinical;
  document.querySelector("#fleet-nav").classList.toggle("active", !isClinical);
  document.querySelector("#clinical-nav").classList.toggle("active", isClinical);
  if (isClinical) {
    document.querySelector("#clinical-nav").setAttribute("aria-current", "page");
    document.querySelector("#fleet-nav").removeAttribute("aria-current");
  } else {
    document.querySelector("#fleet-nav").setAttribute("aria-current", "page");
    document.querySelector("#clinical-nav").removeAttribute("aria-current");
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setText(id, value) {
  document.querySelector(`#${id}`).textContent = value;
}

function formatPercentChange(value) {
  const number = Number(value);
  return `${number < 0 ? "−" : "+"}${Math.abs(number).toFixed(1)}%`;
}

function updateClinicalProfile(member) {
  const attention = isAttention(member);
  setText("profile-avatar", initials(member.name));
  setText("crew-name", member.name);
  setText("crew-role", member.role);
  setText("crew-callsign", member.callsign);
  setText("profile-status", attention ? statusLabel(member) : "T-0 NOMINAL");
  document.querySelector("#profile-status").className = `status-tag${attention ? " caution" : ""}`;
  setText("observation-copy", attention
    ? `Illustrative model review: ${member.scenarioSummary || member.status}. This is not a clinical finding.`
    : "No flagged demo readings. Values are simulated and are not a clinical assessment.");

  setText("vector-hr", String(member.hr));
  setText("vector-hr-label", member.hr < 50 || member.hr > 100 ? "REVIEW" : "NOMINAL");
  setText("vector-bp", member.bp);
  setText("vector-spo2", String(member.spo2));
  setText("vector-temp", `${Number(member.temp).toFixed(1)}°`);
  setText("detail-hrv", `${member.hrv} ms HRV`);
  setText("recovery-hrv", String(member.hrv));
  document.querySelector("#hrv-meter").style.width = `${Math.max(3, Math.min(100, Number(member.hrv)))}%`;
  setText("detail-ecg", member.ecgSignal || "Unavailable");
  setText("ecg-readout", `SIGNAL TRACE · ${String(member.ecgSignal || "DEMO").toUpperCase()}`);
  setText("ecg-status", `SIGNAL ${String(member.ecgSignal || "UNKNOWN").toUpperCase()}`);

  setText("fluid-shift", member.fluidShift || "Not recorded");
  setText("fluid-shift-badge", "SIMULATED");
  setText("fluid-observation", member.scenarioSummary || "This prototype does not perform an SANS or clinical assessment.");
  setText("detail-radiation", `${environment.radiationMsv} mSv`);
  setText("muscle-change", formatPercentChange(member.muscle));
  setText("bone-change", formatPercentChange(member.bmd));
  document.querySelector("#muscle-meter").style.width = `${Math.max(3, Math.min(100, 100 + Number(member.muscle) * 4))}%`;
  document.querySelector("#bone-meter").style.width = `${Math.max(3, Math.min(100, 100 + Number(member.bmd) * 4))}%`;
  setText("hydration-status", member.hydration);
  setText("reaction-time", Number.isFinite(member.reactionMs) ? String(member.reactionMs) : "—");
  setText("sleep-duration", Number.isFinite(member.sleepHours) ? Number(member.sleepHours).toFixed(1) : "—");
}

function createTrendPath(points, valueForPoint) {
  if (!points.length) return "";
  return points.map((point, index) => {
    const x = points.length === 1 ? 780 : (index / (points.length - 1)) * 780;
    const y = Math.max(0, Math.min(190, valueForPoint(point)));
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

async function loadTrends(member) {
  const payload = await requestJson(`/api/crew/${encodeURIComponent(member.id)}/trends?range=24H`);
  const points = payload.points;
  const heartPath = createTrendPath(points, (point) => 190 - ((point.heartRate - 40) / 80) * 180);
  const oxygenPath = createTrendPath(points, (point) => 190 - ((point.spo2 - 90) / 10) * 160);
  document.querySelector("#heart-line").setAttribute("d", heartPath);
  document.querySelector("#oxygen-line").setAttribute("d", oxygenPath);
  const last = points.at(-1);
  if (!last) {
    setText("last-updated", "NO TREND DATA");
    return;
  }
  for (const [id, value] of [["heart-point", last.heartRate], ["oxygen-point", last.spo2]]) {
    const point = document.querySelector(`#${id}`);
    point.setAttribute("cx", "780");
    point.setAttribute("cy", String(id === "heart-point"
      ? 190 - ((value - 40) / 80) * 180
      : 190 - ((value - 90) / 10) * 160));
  }
  const date = new Date(last.recordedAt);
  setText("last-updated", `LAST PACKET ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
}

function openCrew(id) {
  const member = crew.find((person) => person.id === id);
  if (!member) return;
  selectedCrewId = member.id;
  updateClinicalProfile(member);
  setView("clinical");
  loadTrends(member).catch((error) => showToast(`Could not load crew trends: ${error.message}`));
  loadLocalActions(member).catch((error) => showToast(`Could not load local action queue: ${error.message}`));
}

function formatAlertTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "TIME UNAVAILABLE" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function createAlert(alert) {
  const row = element("article", `alert-item${alert.acknowledged ? " acknowledged" : ""}${alert.title.toLowerCase().includes("critical") ? " critical" : ""}`);
  const marker = element("span", "alert-marker", alert.acknowledged ? "✓" : "!");
  const copy = element("div", "alert-copy");
  const heading = element("div", "alert-topline");
  heading.append(element("strong", "", alert.title), element("span", "alert-time", formatAlertTime(alert.occurredAt)));
  copy.append(heading, element("p", "", alert.description));
  const actions = element("div", "alert-actions");
  actions.append(element("span", "alert-tag", alert.acknowledged ? "ACKNOWLEDGED · DEMO" : "AWAITING FLIGHT CREW REVIEW"));
  if (!alert.acknowledged) {
    const button = element("button", "ack-button", "ACKNOWLEDGE");
    button.type = "button";
    button.dataset.alert = alert.id;
    actions.append(button);
  }
  copy.append(actions);
  row.append(marker, copy);
  return row;
}

function renderAlerts() {
  alertList.replaceChildren();
  if (!alerts.length) {
    alertList.append(element("div", "crew-empty", "No active mission alerts."));
    return;
  }
  for (const alert of alerts) alertList.append(createAlert(alert));
}

async function loadAlerts() {
  const payload = await requestJson("/api/alerts");
  alerts = payload.alerts;
  renderAlerts();
}

function renderLocalActions() {
  const memberPackets = packets.filter((packet) => packet.crewId === selectedCrewId);
  packetList.replaceChildren();
  if (!memberPackets.length) {
    packetList.append(element("li", "", "No health snapshots queued for this crew member."));
  }
  for (const packet of memberPackets) {
    const item = element("li");
    const copy = element("span");
    copy.append(
      element("strong", "", `HEALTH SNAPSHOT · ${packet.acknowledged ? "REVIEWED LOCALLY" : "QUEUED LOCALLY"}`),
      element("span", "", `Stored ${formatAlertTime(packet.queuedAt)} · not transmitted`),
    );
    item.append(copy);
    if (!packet.acknowledged) {
      const button = element("button", "", "MARK REVIEWED");
      button.type = "button";
      button.dataset.packet = packet.id;
      item.append(button);
    }
    packetList.append(item);
  }

  const memberRequests = contactRequests.filter((request) => request.crewId === selectedCrewId);
  contactList.replaceChildren();
  if (!memberRequests.length) {
    contactList.append(element("li", "", "No local contact drafts for this crew member."));
  }
  for (const request of memberRequests) {
    const item = element("li");
    const copy = element("span");
    copy.append(
      element("strong", "", `${request.status === "cancelled-local" ? "CANCELLED" : "SCHEDULED"} · ${request.delayMinutes} MIN`),
      element("span", "", `${request.message} · due ${formatAlertTime(request.scheduledFor)} · local only`),
    );
    item.append(copy);
    if (request.status === "scheduled-local") {
      const button = element("button", "", "CANCEL");
      button.type = "button";
      button.dataset.contactRequest = request.id;
      item.append(button);
    }
    contactList.append(item);
  }
}

async function loadLocalActions(member) {
  const [packetPayload, contactPayload] = await Promise.all([
    requestJson("/api/packets"),
    requestJson("/api/contact-requests"),
  ]);
  if (selectedCrewId !== member.id) return;
  packets = packetPayload.packets;
  contactRequests = contactPayload.contactRequests;
  renderLocalActions();
}

async function scheduleLocalContactRequest(request) {
  await requestJson("/api/contact-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (selectedCrewId === request.crewId) {
    await loadLocalActions(crew.find((member) => member.id === request.crewId));
  }
}

crewGrid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-crew]");
  if (card) openCrew(card.dataset.crew);
});

document.querySelector("#crew-filter").addEventListener("change", renderCrew);
document.querySelector("#fleet-nav").addEventListener("click", (event) => {
  event.preventDefault();
  setView("fleet");
});
document.querySelector("#clinical-nav").addEventListener("click", (event) => {
  event.preventDefault();
  if (selectedCrewId) openCrew(selectedCrewId);
  else showToast("Select a crew member to open the clinical deep dive.");
});
for (const [selector, target] of [["#radiation", "#radiation"], ["#actions", "#actions"]]) {
  const link = document.querySelector(`.console-link[href="${selector}"]`);
  link.addEventListener("click", (event) => {
    event.preventDefault();
    if (!selectedCrewId) {
      showToast("Select a crew member to open their clinical dashboard.");
      return;
    }
    openCrew(selectedCrewId);
    requestAnimationFrame(() => document.querySelector(target).scrollIntoView({ behavior: "smooth" }));
  });
}
document.querySelector("#back-to-fleet").addEventListener("click", () => setView("fleet"));
document.querySelector(".brand").addEventListener("click", () => setView("fleet"));

alertList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-alert]");
  if (!button) return;
  button.disabled = true;
  try {
    await requestJson(`/api/alerts/${encodeURIComponent(button.dataset.alert)}/acknowledge`, { method: "POST" });
    await loadAlerts();
    showToast("Mission alert acknowledged.");
  } catch (error) {
    button.disabled = false;
    showToast(`Could not acknowledge alert: ${error.message}`);
  }
});

document.querySelector("#acknowledge-all").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    for (const alert of alerts.filter((item) => !item.acknowledged)) {
      await requestJson(`/api/alerts/${encodeURIComponent(alert.id)}/acknowledge`, { method: "POST" });
    }
    await loadAlerts();
    showToast("All mission alerts acknowledged.");
  } catch (error) {
    showToast(`Could not acknowledge all alerts: ${error.message}`);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#dispatch-note").addEventListener("click", async () => {
  const member = crew.find((person) => person.id === selectedCrewId);
  if (!member) {
    showToast("Select a crew member before queuing a local surgeon note.");
    return;
  }
  try {
    await scheduleLocalContactRequest({
      crewId: member.id,
      message: "Review request queued from the fleet alert log.",
      delayMinutes: 0,
    });
    showToast("Surgeon review draft saved locally; nothing was transmitted.");
  } catch (error) {
    showToast(`Could not save local review draft: ${error.message}`);
  }
});
document.querySelector("#sync-button").addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  try {
    await requestJson("/api/health");
    const member = crew.find((person) => person.id === selectedCrewId);
    await Promise.all([
      loadAlerts(),
      member ? Promise.all([loadTrends(member), loadLocalActions(member)]) : Promise.resolve(),
    ]);
    setText("connection-label", "BIO-MONITOR BUS ACTIVE");
    showToast("Local demo telemetry synchronized.");
  } catch (error) {
    showToast(`Could not synchronize telemetry: ${error.message}`);
  } finally {
    event.currentTarget.disabled = false;
  }
});

document.querySelector("#audio-button").addEventListener("click", (event) => {
  const enabled = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", String(enabled));
  const icon = element("span", "", enabled ? "♫" : "♪");
  icon.setAttribute("aria-hidden", "true");
  event.currentTarget.replaceChildren(icon, document.createTextNode(" AUDIO COMMS"));
  showToast(enabled ? "Audio communications enabled in the local display." : "Audio communications muted in the local display.");
});
document.querySelector("#mute-button").addEventListener("click", () => showToast("Audio is not connected in this local demo."));
document.querySelector("#compose-contact-request").addEventListener("click", () => {
  document.querySelector("#contact-message").focus();
});

queuePacketButton.addEventListener("click", async () => {
  const member = crew.find((person) => person.id === selectedCrewId);
  if (!member) {
    showToast("Select a crew member before queuing a telemetry snapshot.");
    return;
  }
  queuePacketButton.disabled = true;
  try {
    await requestJson("/api/packets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crewId: member.id }),
    });
    await loadLocalActions(member);
    showToast("Simulated health snapshot stored locally; not transmitted.");
  } catch (error) {
    showToast(`Could not queue health snapshot: ${error.message}`);
  } finally {
    queuePacketButton.disabled = false;
  }
});

packetList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-packet]");
  if (!button) return;
  button.disabled = true;
  try {
    await requestJson(`/api/packets/${encodeURIComponent(button.dataset.packet)}/acknowledge`, { method: "POST" });
    const member = crew.find((person) => person.id === selectedCrewId);
    if (member) await loadLocalActions(member);
    showToast("Packet marked reviewed locally.");
  } catch (error) {
    button.disabled = false;
    showToast(`Could not update packet: ${error.message}`);
  }
});

contactList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-contact-request]");
  if (!button) return;
  button.disabled = true;
  try {
    await requestJson(`/api/contact-requests/${encodeURIComponent(button.dataset.contactRequest)}/cancel`, { method: "POST" });
    const member = crew.find((person) => person.id === selectedCrewId);
    if (member) await loadLocalActions(member);
    showToast("Local contact draft cancelled.");
  } catch (error) {
    button.disabled = false;
    showToast(`Could not cancel local draft: ${error.message}`);
  }
});

contactRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const member = crew.find((person) => person.id === selectedCrewId);
  if (!member) {
    showToast("Select a crew member before saving a local contact draft.");
    return;
  }
  const submitButton = contactRequestForm.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(contactRequestForm).entries());
  submitButton.disabled = true;
  try {
    await scheduleLocalContactRequest({
      crewId: member.id,
      message: values.message,
      delayMinutes: Number(values.delayMinutes),
    });
    contactRequestForm.reset();
    showToast("Delayed-contact draft saved locally; nothing was transmitted.");
  } catch (error) {
    showToast(`Could not save local contact draft: ${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#add-person-button").addEventListener("click", () => {
  addPersonError.textContent = "";
  addPersonDialog.showModal();
});
document.querySelector("#close-add-person").addEventListener("click", () => addPersonDialog.close());
document.querySelector("#cancel-add-person").addEventListener("click", () => addPersonDialog.close());
addPersonDialog.addEventListener("click", (event) => {
  if (event.target === addPersonDialog) addPersonDialog.close();
});

addPersonForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  addPersonError.textContent = "";
  const submitButton = addPersonForm.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(addPersonForm).entries());
  for (const field of ["hr", "spo2", "rr", "temp", "hrv", "bmd", "muscle"]) values[field] = Number(values[field]);
  submitButton.disabled = true;
  try {
    const payload = await requestJson("/api/crew", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    crew = [...crew, payload.crew].sort((first, second) => first.callsign.localeCompare(second.callsign));
    addPersonForm.reset();
    addPersonDialog.close();
    renderCrew();
    openCrew(payload.crew.id);
    showToast(`${payload.crew.name} added to the mission crew.`);
  } catch (error) {
    addPersonError.textContent = `Could not add crew member: ${error.message}`;
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#export-button").addEventListener("click", async () => {
  const member = crew.find((person) => person.id === selectedCrewId);
  if (!member) return;
  try {
    const response = await fetch(`/api/crew/${encodeURIComponent(member.id)}/report.csv`);
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `astra-health-${member.callsign.toLowerCase()}-demo-report.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
    showToast("Simulated crew report exported.");
  } catch (error) {
    showToast(`Could not export crew report: ${error.message}`);
  }
});

document.querySelector("#actions").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) showToast(button.dataset.action);
});

studyParticipantSelect.addEventListener("change", renderOsd575Samples);

async function initializeDashboard() {
  try {
    const [crewPayload, alertPayload] = await Promise.all([requestJson("/api/crew"), requestJson("/api/alerts")]);
    crew = crewPayload.crew;
    environment = crewPayload.environment;
    alerts = alertPayload.alerts;
    if (!crew.length) throw new Error("The API returned no crew members.");
    if (!environment || !Number.isFinite(environment.radiationMsv)) throw new Error("The API returned invalid environmental demo data.");
    renderCrew();
    renderAlerts();
    setText("connection-label", "BIO-MONITOR BUS ACTIVE");
  } catch (error) {
    setText("connection-label", "BIO-MONITOR LINK OFFLINE");
    document.querySelector(".mission-ribbon .live-dot").style.background = "#ef4444";
    crewGrid.replaceChildren(element("div", "crew-empty", `Could not load mission data: ${error.message}`));
    showToast(`Could not load dashboard data: ${error.message}`);
  }
  loadOsd575Study().catch((error) => {
    studySamples.replaceChildren(element("div", "loading-state", `Could not load OSD-575 study data: ${error.message}`));
  });
}

initializeDashboard();
