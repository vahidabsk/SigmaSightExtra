const STORAGE_KEY = "ihaudy.fieldNotes";
const SETTINGS_KEY = "ihaudy.settings";
const APP_NAME = "iHaudy Field Notes";
const VERSION = 15;

const BASE_SECTION_TABS = [
  { id: "signal", label: "Signal Processing" },
  { id: "documentation", label: "Documentation" },
  { id: "installation", label: "Installation" },
  { id: "guard", label: "Guard Service Test" },
  { id: "device", label: "Device Test" }
];
const LINE_SECURITY_DEVICE_TYPE = "Line security test";
const LINE_SECURITY_INTERVALS = [
  ["200", "Single path - 200 seconds"],
  ["360", "Dual primary path - 360 seconds"],
  ["86400", "Secondary path - 24 hours"]
];

let state = loadState();
let view = { screen: installRouteRequested() ? "install" : "home", auditId: "", section: "signal", message: "" };
let recognition = null;
let dictationTarget = null;
let dictationBase = "";
let finalTranscript = "";
let dictationShouldRun = false;
let dictationRestartTimer = null;
let dictationFlushTimer = null;
let dictationNoResultCycles = 0;
let currentTime = timeStamp(new Date());
let cameraStream = null;

const app = document.getElementById("app");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => undefined);
}

setInterval(() => {
  currentTime = timeStamp(new Date());
  if (view.screen === "property" && ((view.section === "device" && hasRunningDeviceTimer()) || (view.section === "guard" && hasRunningGuardService()))) render();
}, 1000);

render();

function loadState() {
  return readJson(STORAGE_KEY, null) || {
    app: APP_NAME,
    version: VERSION,
    source: "iHaudy",
    exportedAt: "",
    ascKey: "",
    ascName: "",
    ascCity: "",
    ascState: "",
    psn: "",
    audits: []
  };
}

function saveState() {
  state.exportedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  const status = state.audits.length ? `${state.audits.length} field note${state.audits.length === 1 ? "" : "s"} loaded` : "Ready";
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">iH</div>
          <div>
            <small>Haudy Field App</small>
            <h1>iHaudy Field Notes</h1>
          </div>
        </div>
        <div class="status-pill">${escapeHtml(status)}</div>
      </header>
      <main class="container">
        ${view.screen === "install" ? installView() : view.screen === "home" ? homeView() : propertyView()}
      </main>
      ${cameraView()}
    </div>
  `;
  bindEvents();
  attachCameraStream();
}

function installRouteRequested() {
  const path = window.location.pathname.toLowerCase();
  const search = window.location.search.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  return path.endsWith("/install") || path.endsWith("/install/") || search.includes("install") || hash.includes("install");
}

function isStandaloneMode() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isSafariBrowser() {
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/crios|fxios|edgios|chrome|android/i.test(ua);
}

function installView() {
  const standalone = isStandaloneMode();
  const ios = isIosDevice();
  const safari = isSafariBrowser();
  const browserNote = ios && !safari
    ? `<div class="install-warning">Open this link in Safari first. iPad and iPhone can only add iHaudy to the Home Screen from Safari.</div>`
    : "";
  return `
    <section class="panel install-portal">
      <div class="install-hero">
        <div class="install-icon">iH</div>
        <div>
          <small>Haudy Portable Field App</small>
          <h2>${standalone ? "iHaudy Is Installed" : "Install iHaudy Field Notes"}</h2>
          <p>${standalone ? "You are running from the Home Screen. Open your field-note package and keep working offline." : "Use this page to place iHaudy on an iPad or iPhone Home Screen for field work."}</p>
        </div>
      </div>
      ${browserNote}
      ${standalone ? `
        <div class="install-callout good">
          <strong>Ready for field work.</strong>
          <span>Import the field-notes file exported from Haudy Suite when you are ready.</span>
        </div>
      ` : `
        <div class="install-steps">
          <div class="install-step">
            <span>1</span>
            <strong>Open in Safari</strong>
            <p>Use Safari on the iPad or iPhone. If this page is in another browser, copy the link into Safari.</p>
          </div>
          <div class="install-step">
            <span>2</span>
            <strong>Tap Share</strong>
            <p>Tap the Safari Share button at the top or bottom of the screen.</p>
          </div>
          <div class="install-step">
            <span>3</span>
            <strong>Add to Home Screen</strong>
            <p>Choose Add to Home Screen, then tap Add. The iHaudy icon will appear like an app.</p>
          </div>
        </div>
        <div class="install-callout">
          <strong>After installing:</strong>
          <span>Open iHaudy from the Home Screen once while online so the offline files can finish caching.</span>
        </div>
      `}
      <div class="actions install-actions">
        <button class="button primary" data-action="open-field-app">${standalone ? "Open Field Notes" : "Continue in Browser"}</button>
      </div>
    </section>
  `;
}

function homeView() {
  return `
    <section class="panel hero">
      <div class="actions">
        <button class="button primary" data-action="import">Import from Haudy Suite</button>
        <button class="button success" data-action="export" ${state.audits.length ? "" : "disabled"}>Export to Haudy Suite</button>
        <button class="button danger" data-action="clear" ${state.audits.length ? "" : "disabled"}>Clear This iPad</button>
      </div>
      <input id="importFile" class="hidden" type="file" accept=".ihaudy-field-notes.json,.json,application/json" />
      ${view.message ? `<div class="message ${view.messageType || ""}">${escapeHtml(view.message)}</div>` : ""}
      ${state.audits.length ? ascSummary() : `<div class="empty-state">Import the field-notes file exported from Haudy Suite.</div>`}
    </section>
  `;
}

function ascSummary() {
  return `
    <section class="panel asc-card">
      <div>
        <p class="asc-eyebrow">Alarm Service Company</p>
        <h2>${escapeHtml(state.ascName || "ASC not set")}</h2>
        <p class="muted">${escapeHtml([state.ascCity, state.ascState].filter(Boolean).join(", ") || "City and state not detected")}</p>
      </div>
      <div class="meta-grid">
        <div class="meta"><span>PSN</span><strong>${escapeHtml(state.psn || "not detected")}</strong></div>
        <div class="meta"><span>Properties</span><strong>${state.audits.length}</strong></div>
        <div class="meta"><span>Last saved</span><strong>${escapeHtml(relativeTime(state.exportedAt))}</strong></div>
      </div>
    </section>
    <section class="grid" style="margin-top: 1rem;">
      ${state.audits.map((audit) => propertyCard(audit)).join("")}
    </section>
  `;
}

function propertyCard(audit) {
  const certificate = primaryCertificate(audit);
  const controlUnit = equipmentSummary(certificate, ["controlUnitMfr", "controlUnitModel", "controlUnitManufacturer", "controlUnit"]);
  const transmitter = equipmentSummary(certificate, ["signalTransmitterMfr", "signalTransmitterModel", "transmitterManufacturer", "transmitterModel", "primaryTransmission"]);
  const category = categoryCode(audit) || "N/A";
  return `
    <article class="panel property-card">
      <div class="property-card-head">
        <div>
          <h2>${escapeHtml(audit.protectedProperty || "Property name not set")}</h2>
          <p class="muted">${escapeHtml(certificate.propertyAddress || "Property address not detected")}</p>
        </div>
        <span class="category-badge">${escapeHtml(category)}</span>
      </div>
      <div class="meta-grid">
        <div class="meta"><span>Certificate</span><strong>${escapeHtml(audit.certificateNumber || "not detected")}</strong></div>
        <div class="meta"><span>Standard</span><strong>${escapeHtml(audit.codeEdition || "not detected")}</strong></div>
        <div class="meta"><span>Updated</span><strong>${escapeHtml(relativeTime(audit.updatedAt))}</strong></div>
      </div>
      <div class="equipment-grid">
        <div class="meta equipment-meta"><span>Control unit</span><strong>${escapeHtml(controlUnit || "not detected")}</strong></div>
        <div class="meta equipment-meta"><span>Transmitter</span><strong>${escapeHtml(transmitter || "not detected")}</strong></div>
      </div>
      <div class="actions">
        <button class="button primary" data-action="open-audit" data-audit-id="${escapeHtml(audit.id)}">Open Field Note</button>
      </div>
    </article>
  `;
}

function propertyView() {
  const audit = currentAudit();
  if (!audit) {
    view.screen = "home";
    return homeView();
  }
  const certificate = primaryCertificate(audit);
  const controlUnit = equipmentSummary(certificate, ["controlUnitMfr", "controlUnitModel", "controlUnitManufacturer", "controlUnit"]);
  const transmitter = equipmentSummary(certificate, ["signalTransmitterMfr", "signalTransmitterModel", "transmitterManufacturer", "transmitterModel", "primaryTransmission"]);
  const tabs = sectionTabsForAudit(audit);
  const activeSection = tabs.some((tab) => tab.id === view.section) ? view.section : tabs[0]?.id || "documentation";
  view.section = activeSection;
  return `
    <section class="panel hero">
      <div class="actions">
        <button class="button ghost" data-action="back-home">Back to Properties</button>
        <button class="button success" data-action="save">Save</button>
        <button class="button primary" data-action="export">Export to Haudy Suite</button>
      </div>
      <section class="property-card">
        <h2>${escapeHtml(audit.protectedProperty || "Property name not set")}</h2>
        <p class="muted">${escapeHtml(certificate.propertyAddress || "Property address not detected")}</p>
        <div class="meta-grid">
          <div class="meta"><span>Certificate</span><strong>${escapeHtml(audit.certificateNumber || "not detected")}</strong></div>
          <div class="meta"><span>File / SCN</span><strong>${escapeHtml(audit.fileScn || "not detected")}</strong></div>
          <div class="meta"><span>Standard</span><strong>${escapeHtml(audit.codeEdition || "not detected")}</strong></div>
        </div>
        <div class="equipment-grid">
          <div class="meta equipment-meta"><span>Control unit</span><strong>${escapeHtml(controlUnit || "not detected")}</strong></div>
          <div class="meta equipment-meta"><span>Transmitter</span><strong>${escapeHtml(transmitter || "not detected")}</strong></div>
        </div>
      </section>
      <nav class="tabs">
        ${tabs.map((tab) => `<button class="tab ${activeSection === tab.id ? "active" : ""}" data-action="section" data-section="${tab.id}">${tab.label}</button>`).join("")}
      </nav>
    </section>
    <section style="margin-top: 1rem;">
      ${sectionView(audit)}
    </section>
  `;
}

function sectionView(audit) {
  if (view.section === "signal") return signalView(audit);
  if (view.section === "documentation") return reviewRowsView(audit, "documentation", audit.documentation || []);
  if (view.section === "installation") return reviewRowsView(audit, "installation", audit.installation || [], { photos: true });
  if (view.section === "guard") return guardServiceView(audit);
  return deviceRowsView(audit);
}

function signalView(audit) {
  const program = auditProgram(audit);
  const isFire = program === "fire";
  const localSystem = isFire && Boolean(audit.deviceSystemLocal);
  const controlsDisabled = localSystem || !audit.signalProcessingReviewed;
  const signalOptions = program === "protectedArea"
    ? [["", "Select"], ["Alarm", "Alarm"], ["Opening/Closing", "Opening/Closing"], ["Trouble", "Trouble"], ["Comm Fail", "Comm Fail"]]
    : [["", "Select"], ["Alarm", "Alarm"], ["Supervisory", "Supervisory"], ["Trouble", "Trouble"]];
  return `
    <section class="panel section-card">
      <h2>Signal Processing Review</h2>
      <div class="signal-review-grid">
        ${isFire ? selectField("deviceSystemLocal", "Is this system local?", boolValue(audit.deviceSystemLocal), [["false", "No"], ["true", "Yes"]]) : ""}
        ${selectField("signalProcessingReviewed", "Signal processing reviewed?", boolValue(audit.signalProcessingReviewed), [["true", "Yes"], ["false", "No"]], localSystem)}
        <div class="date-pair">
          ${dateField("signalReviewStart", "Review start date", controlsDisabled ? "" : audit.signalReviewStart, controlsDisabled)}
          ${dateField("signalReviewEnd", "Review end date", controlsDisabled ? "" : audit.signalReviewEnd, controlsDisabled)}
        </div>
        ${selectField("autoTestsStatus", program === "protectedArea" ? "Independent code" : "Auto tests", controlsDisabled ? "" : audit.autoTestsStatus || "", [["", "Select"], ["OK", "OK"], ["VAR", "Variation"]], controlsDisabled)}
      </div>
      ${!localSystem && !audit.signalProcessingReviewed ? noteField("signalReviewNotes", "Signal processing review variation", audit.signalReviewNotes || "") : ""}
      ${localSystem ? `<div class="message warn">Local system selected. Signal processing review is not applicable.</div>` : ""}
      <div class="grid">
        ${(audit.signalLog || []).map((row, index) => signalRowView(row, index, controlsDisabled, signalOptions)).join("")}
      </div>
      <button class="button primary" data-action="add-signal" ${controlsDisabled ? "disabled" : ""}>Add Signal Row</button>
    </section>
  `;
}

function signalRowView(row, index, disabled = false, signalOptions = [["", "Select"], ["Alarm", "Alarm"], ["Supervisory", "Supervisory"], ["Trouble", "Trouble"]]) {
  return `
    <article class="row-card ${disabled ? "disabled-card" : ""}">
      <div class="row-head">
        <strong>Signal ${index + 1}</strong>
        <button class="button danger small" data-action="delete-signal" data-row-id="${escapeHtml(row.id)}" ${disabled ? "disabled" : ""}>Delete</button>
      </div>
      <div class="signal-row-grid">
        ${selectField(`signalType:${row.id}`, "Signal type", disabled ? "" : row.signalType || "", signalOptions, disabled)}
        <div class="date-pair">
          ${dateField(`signalDate:${row.id}`, "Event date", disabled ? "" : row.date || "", disabled)}
          ${timeField(`signalTime:${row.id}`, "Event time", disabled ? "" : row.time || "", false, disabled)}
        </div>
        ${selectField(`signalHandling:${row.id}`, "Handling", disabled ? "" : row.handlingStatus || "", [["", "Select"], ["OK", "Signal handled correctly"], ["VAR", "Variation noted"]], disabled)}
      </div>
      ${noteField(`signalNotes:${row.id}`, "Description / note", disabled ? "" : row.notes || row.description || "", disabled)}
    </article>
  `;
}

function reviewRowsView(audit, collection, rows, options = {}) {
  const title = collection === "documentation" ? "Documentation Review" : "Installation Review";
  const reviewedField = collection === "documentation" ? "documentationReviewed" : "installationReviewed";
  const noteFieldName = collection === "documentation" ? "documentationReviewNotes" : "installationReviewNotes";
  const reviewed = audit[reviewedField] !== false;
  const isFireInstallation = collection === "installation" && auditProgram(audit) === "fire";
  return `
    <section class="panel section-card">
      <h2>${title}</h2>
      <div class="field-grid">
        ${selectField(reviewedField, `${title} completed?`, boolValue(audit[reviewedField]), [["true", "Yes"], ["false", "No"]])}
        ${isFireInstallation ? statusSelectField("matchesCertificateStatus", "Matches certificate declarations?", reviewed ? audit.matchesCertificateStatus || "" : "", reviewedStatusOptions(), !reviewed) : ""}
        ${isFireInstallation ? statusSelectField("certificateDisplayedStatus", "Certificate displayed?", reviewed ? audit.certificateDisplayedStatus || "" : "", displayStatusOptions(), !reviewed) : ""}
      </div>
      ${!reviewed ? noteField(noteFieldName, `${title} variation`, audit[noteFieldName] || "") : ""}
      <div class="grid">
        ${rows.map((row) => auditRowView(collection, row, options, !reviewed)).join("")}
      </div>
      <button class="button primary" data-action="add-row" data-collection="${collection}" ${!reviewed ? "disabled" : ""}>Add Row</button>
    </section>
  `;
}

function auditRowView(collection, row, options, disabled = false) {
  const canDelete = canDeleteAuditRow(row);
  return `
    <article class="row-card ${disabled ? "disabled-card" : ""}">
      <div class="row-head">
        <strong class="audit-row-title">${escapeHtml(row.element || "Additional row")}</strong>
        ${canDelete ? `<button class="button danger small" data-action="delete-row" data-collection="${collection}" data-row-id="${escapeHtml(row.id)}" ${disabled ? "disabled" : ""}>Delete</button>` : ""}
      </div>
      <div class="status-buttons">
        ${statusButton(collection, row.id, "OK", disabled ? "" : row.status, "In Conformance", "ok", disabled)}
        ${statusButton(collection, row.id, "VAR", disabled ? "" : row.status, "Variation Noted", "var", disabled)}
        ${statusButton(collection, row.id, "NA", disabled ? "" : row.status, "Not Applicable", "na", disabled)}
        ${statusButton(collection, row.id, "NR", disabled ? "" : row.status, "Not Reviewed", "nr", disabled)}
      </div>
      ${noteField(`${collection}Notes:${row.id}`, "Field note", disabled ? "" : row.notes || "", disabled)}
      ${options.photos && !disabled ? photoTools(row) : ""}
    </article>
  `;
}

function deviceRowsView(audit) {
  const securityProgram = isSecurityProgram(audit);
  const reviewed = audit.deviceTestingReviewed !== false;
  return `
    <section class="panel section-card">
      <h2>Device Test</h2>
      <div class="field-grid">
        ${selectField("deviceTestingReviewed", "Were devices tested in the field?", boolValue(audit.deviceTestingReviewed), [["true", "Yes"], ["false", "No"]])}
        ${securityProgram ? "" : selectField("deviceSystemLocal", "Is this system local?", boolValue(audit.deviceSystemLocal), [["false", "No"], ["true", "Yes"]], !reviewed)}
      </div>
      ${!reviewed ? noteField("deviceTestingNotes", "Device testing review variation", audit.deviceTestingNotes || "") : noteField("deviceTestingNotes", "Additional comments", audit.deviceTestingNotes || "")}
      ${!reviewed ? `<div class="message warn">Device testing review marked No. Use the variation note above to explain why device testing was not completed.</div>` : ""}
      <div class="grid">
        ${(deviceRowsForProgram(audit)).map((row, index) => deviceRowView(row, index, securityProgram ? false : audit.deviceSystemLocal, audit, !reviewed)).join("")}
      </div>
      <button class="button primary" data-action="add-device" ${!reviewed ? "disabled" : ""}>Add Device Row</button>
    </section>
  `;
}

function deviceRowView(row, index, isLocal, audit, disabled = false) {
  const securityProgram = isSecurityProgram(audit);
  const isWaterflow = !securityProgram && row.deviceType === "Waterflow switch";
  const isLineSecurity = securityProgram && row.deviceType === LINE_SECURITY_DEVICE_TYPE;
  const waterflowMode = row.waterflowEntryMode || "";
  const waterflowManual = isWaterflow && waterflowMode === "manual";
  const waterflowAutomatic = isWaterflow && waterflowMode === "automatic";
  const stoppedWaterflowSeconds = typeof row.waterflowElapsedSeconds === "number" && row.waterflowElapsedSeconds > 0 ? row.waterflowElapsedSeconds : null;
  const waterflowSeconds = waterflowAutomatic ? stoppedWaterflowSeconds ?? secondsBetween(row.tripTime, row.timeReceived || currentTime) : null;
  const waterflowRunning = Boolean(waterflowAutomatic && row.tripTime && !row.timeReceived && stoppedWaterflowSeconds === null);
  const waterflowOverdue = Boolean(waterflowRunning && waterflowSeconds !== null && waterflowSeconds >= 90);
  if (isLineSecurity) return lineSecurityRowView(row, audit, disabled);
  return `
    <article class="row-card ${disabled ? "disabled-card" : ""}">
      <div class="row-head">
        <strong>Device ${index + 1}</strong>
        <button class="button danger small" data-action="delete-device" data-row-id="${escapeHtml(row.id)}" ${disabled ? "disabled" : ""}>Delete</button>
      </div>
      <div class="field-grid">
        ${selectField(`deviceType:${row.id}`, "Device type", disabled ? "" : row.deviceType || "", deviceOptions(audit), disabled)}
        ${inputField(`deviceLocation:${row.id}`, "Location", disabled ? "" : row.location || "", disabled)}
        ${inputField(`deviceId:${row.id}`, "Device ID", disabled ? "" : row.deviceId || "", disabled)}
        ${!isWaterflow ? timeField(`deviceTrip:${row.id}`, "Trip time", disabled ? "" : row.tripTime || "", true, disabled) : ""}
        ${!isWaterflow ? timeField(`deviceReceived:${row.id}`, isLocal ? "Time received / N/A" : "Time received", isLocal || disabled ? (isLocal ? "N/A" : "") : row.timeReceived || "", true, isLocal || disabled) : ""}
      </div>
      ${isWaterflow ? waterflowModePicker(row, waterflowMode, disabled) : ""}
      ${waterflowManual ? waterflowManualView(row, isLocal, disabled) : ""}
      ${waterflowAutomatic ? waterflowAutomaticView(row, isLocal, waterflowSeconds, waterflowOverdue, disabled) : ""}
      <div class="status-buttons">
        ${toggleButton("functional", row.id, disabled ? false : row.functional, "Functional", disabled)}
        ${exclusiveSignalButton(row.id, "Alarm", disabled ? false : row.alarm, "Alarm", disabled)}
        ${securityProgram ? "" : exclusiveSignalButton(row.id, "Supervisory", disabled ? false : row.supervisory, "Supervisory", disabled)}
        ${exclusiveSignalButton(row.id, "Trouble", disabled ? false : row.trouble, "Trouble", disabled)}
      </div>
      <div class="status-buttons">
        ${deviceResultButton(row.id, "OK", disabled ? "" : row.result, "In Conformance", "ok", disabled)}
        ${deviceResultButton(row.id, "VAR", disabled ? "" : row.result, "Variation Noted", "var", disabled)}
      </div>
      ${noteField(`deviceNotes:${row.id}`, "Note", disabled ? "" : row.notes || "", disabled)}
    </article>
  `;
}

function lineSecurityRowView(row, audit, disabled = false) {
  const declaredKind = lineSecurityKind(audit);
  const mode = row.waterflowEntryMode || "";
  const expectedSeconds = row.lineSecurityExpectedSeconds || defaultLineSecurityInterval(declaredKind);
  const stoppedSeconds = typeof row.waterflowElapsedSeconds === "number" && row.waterflowElapsedSeconds > 0 ? row.waterflowElapsedSeconds : null;
  const elapsedSeconds = mode === "automatic" && row.tripTime ? stoppedSeconds ?? secondsBetween(row.tripTime, row.timeReceived || currentTime) : null;
  const running = Boolean(mode === "automatic" && row.tripTime && !row.timeReceived && stoppedSeconds === null);
  const overdue = Boolean(running && elapsedSeconds !== null && elapsedSeconds >= expectedSeconds);
  return `
    <article class="row-card line-security-card ${disabled ? "disabled-card" : ""}">
      <div class="row-head">
        <div>
          <strong>Line Security Test</strong>
          <p class="muted">Certificate line security: <b>${escapeHtml(declaredKind || "declared")}</b>. Record the check-in timing before normal device tests.</p>
        </div>
      </div>
      <div class="field-grid">
        ${selectField(`lineSecurityExpected:${row.id}`, "Expected check-in", String(expectedSeconds), LINE_SECURITY_INTERVALS, disabled)}
        ${inputField(`deviceLocation:${row.id}`, "Location", disabled ? "" : row.location || "", disabled)}
        ${inputField(`deviceId:${row.id}`, "Device ID / Zone", disabled ? "" : row.deviceId || "", disabled)}
      </div>
      <div class="waterflow-panel">
        <div class="section-kicker">Line security entry method</div>
        <div class="status-buttons">
          <button type="button" class="status-button ${mode === "manual" ? "active nr" : ""}" data-action="line-security-mode" data-row-id="${escapeHtml(row.id)}" data-mode="manual" ${disabled ? "disabled" : ""}>Manual Entry</button>
          <button type="button" class="status-button ${mode === "automatic" ? "active ok" : ""}" data-action="line-security-mode" data-row-id="${escapeHtml(row.id)}" data-mode="automatic" ${disabled ? "disabled" : ""}>Automatic Stopwatch</button>
        </div>
      </div>
      ${mode === "manual" ? lineSecurityManualView(row, expectedSeconds, disabled) : ""}
      ${mode === "automatic" ? lineSecurityAutomaticView(row, elapsedSeconds, overdue, disabled) : ""}
      <div class="status-buttons">
        ${toggleButton("functional", row.id, disabled ? false : row.functional, "Functional", disabled)}
        ${toggleButton("lineSecurity", row.id, disabled ? false : row.lineSecurity, "Line Security", disabled)}
      </div>
      <div class="status-buttons">
        ${deviceResultButton(row.id, "OK", disabled ? "" : row.result, "In Conformance", "ok", disabled)}
        ${deviceResultButton(row.id, "VAR", disabled ? "" : row.result, "Variation Noted", "var", disabled)}
      </div>
      ${noteField(`deviceNotes:${row.id}`, "Note", disabled ? "" : row.notes || "", disabled)}
    </article>
  `;
}

function lineSecurityManualView(row, expectedSeconds, disabled = false) {
  return `
    <div class="waterflow-panel white">
      <div class="field-grid">
        ${timeField(`deviceTrip:${row.id}`, "Test started", disabled ? "" : row.tripTime || "", true, disabled)}
        ${timeField(`lineSecurityReceived:${row.id}`, "Check-in received", disabled ? "" : row.timeReceived || "", true, disabled)}
      </div>
    </div>
  `;
}

function lineSecurityAutomaticView(row, elapsedSeconds, overdue, disabled = false) {
  return `
    <div class="waterflow-panel blue">
      <div class="timer-grid">
        <div>
          <span>Test started</span>
          <strong>${escapeHtml(row.tripTime || "--:--:--")}</strong>
        </div>
        <div>
          <span>Check-in received</span>
          <strong>${escapeHtml(row.timeReceived || "--:--:--")}</strong>
        </div>
        <div>
          <span>Elapsed</span>
          <strong class="elapsed ${elapsedClassForLimit(elapsedSeconds, row.lineSecurityExpectedSeconds || 200)}">${elapsedSeconds === null ? "--" : formatElapsed(elapsedSeconds)}</strong>
        </div>
      </div>
      <div class="actions">
        <button class="button primary" data-action="start-line-security" data-row-id="${escapeHtml(row.id)}" ${disabled ? "disabled" : ""}>Start Line Security Test</button>
        <button class="button success" data-action="complete-line-security" data-row-id="${escapeHtml(row.id)}" ${disabled || !row.tripTime ? "disabled" : ""}>Check-In Signal Received</button>
        ${overdue ? `<button class="button danger" data-action="no-line-security" data-row-id="${escapeHtml(row.id)}" ${disabled ? "disabled" : ""}>Check-In Not Received</button>` : ""}
        <button class="button ghost" data-action="reset-line-security" data-row-id="${escapeHtml(row.id)}" ${disabled ? "disabled" : ""}>Reset Test</button>
      </div>
    </div>
  `;
}

function guardServiceView(audit) {
  const guard = audit.guardServiceTest || defaultGuardServiceTest();
  const disabled = !guard.reviewed;
  const expectedSeconds = Math.max(1, Number(guard.expectedMinutes || 20)) * 60;
  const stoppedSeconds = guard.elapsedSeconds > 0 ? guard.elapsedSeconds : null;
  const runningSeconds = guard.entryMode === "automatic" && guard.testSignalInitiationTime && !guard.investigatorArrivalTime ? secondsBetween(guard.testSignalInitiationTime, currentTime) : null;
  const elapsedSeconds = stoppedSeconds ?? runningSeconds;
  return `
    <section class="panel section-card">
      <h2>Guard Service Test</h2>
      <div class="field-grid">
        ${selectField("guardReviewed", "Guard service test completed?", boolValue(guard.reviewed), [["true", "Yes"], ["false", "No"]])}
        ${selectField("guardSignalType", "Signal type used", disabled ? "" : guard.signalType || "", [["", "Select signal type"], ["24 hour contact alarm", "24 hour contact alarm"], ["Comm. Fail", "Comm. Fail"], ["Other", "Other"]], disabled)}
        ${inputField("guardExpectedMinutes", "Response time limit (min)", disabled ? "" : guard.expectedMinutes || 20, disabled)}
        ${guard.signalType === "Other" ? inputField("guardOtherSignalType", "Other signal", disabled ? "" : guard.otherSignalType || "", disabled) : ""}
      </div>
      ${disabled ? `<div class="message warn">Guard service test marked No. Re-enable it if this CRZH audit includes a guard response test.</div>` : ""}
      <div class="waterflow-panel">
        <div class="section-kicker">Guard service entry method</div>
        <div class="status-buttons">
          <button type="button" class="status-button ${guard.entryMode === "manual" ? "active nr" : ""}" data-action="guard-mode" data-mode="manual" ${disabled ? "disabled" : ""}>Manual Entry</button>
          <button type="button" class="status-button ${guard.entryMode === "automatic" ? "active ok" : ""}" data-action="guard-mode" data-mode="automatic" ${disabled ? "disabled" : ""}>Automatic Stopwatch</button>
        </div>
      </div>
      ${guard.entryMode === "manual" ? guardManualView(guard, disabled) : ""}
      ${guard.entryMode === "automatic" ? guardAutomaticView(guard, disabled, elapsedSeconds, expectedSeconds) : ""}
      <div class="status-buttons">
        <button type="button" class="status-button ${guard.result === "PASS" ? "active ok" : ""}" data-action="guard-result" data-result="PASS" ${disabled ? "disabled" : ""}>Pass</button>
        <button type="button" class="status-button ${guard.result === "FAIL" ? "active var" : ""}" data-action="guard-result" data-result="FAIL" ${disabled ? "disabled" : ""}>Fail</button>
      </div>
      ${noteField("guardNotes", "Note", disabled ? "" : guard.notes || "")}
    </section>
  `;
}

function guardManualView(guard, disabled) {
  return `
    <div class="waterflow-panel white">
      <div class="field-grid">
        ${timeField("guardTestSignal", "Test signal initiation time", disabled ? "" : guard.testSignalInitiationTime || "", true, disabled)}
        ${timeField("guardVerification", "Verification call time", disabled ? "" : guard.verificationCallTime || "", true, disabled)}
        ${timeField("guardArrival", "Investigator arrival time", disabled ? "" : guard.investigatorArrivalTime || "", true, disabled)}
      </div>
    </div>
  `;
}

function guardAutomaticView(guard, disabled, elapsedSeconds, expectedSeconds) {
  return `
    <div class="waterflow-panel blue">
      <div class="timer-grid">
        <div><span>Test signal initiation</span><strong>${escapeHtml(guard.testSignalInitiationTime || "--:--:--")}</strong></div>
        <div><span>Verification call</span><strong>${escapeHtml(guard.verificationCallTime || "--:--:--")}</strong></div>
        <div><span>Investigator arrival</span><strong>${escapeHtml(guard.investigatorArrivalTime || "--:--:--")}</strong></div>
        <div><span>Elapsed</span><strong class="elapsed ${elapsedClassForLimit(elapsedSeconds, expectedSeconds)}">${elapsedSeconds === null ? "--" : guardFormatElapsed(elapsedSeconds)}</strong></div>
      </div>
      <div class="actions">
        <button class="button primary" data-action="start-guard" ${disabled ? "disabled" : ""}>Start Test Signal</button>
        <button class="button warning" data-action="guard-verification" ${disabled || !guard.testSignalInitiationTime ? "disabled" : ""}>Verification Call</button>
        <button class="button success" data-action="guard-arrival" ${disabled || !guard.testSignalInitiationTime ? "disabled" : ""}>Investigator Arrived</button>
        <button class="button ghost" data-action="reset-guard" ${disabled ? "disabled" : ""}>Reset Test</button>
      </div>
    </div>
  `;
}

function waterflowModePicker(row, waterflowMode, disabled = false) {
  return `
    <div class="waterflow-panel">
      <div class="section-kicker">Waterflow entry method</div>
      <div class="status-buttons">
        <button type="button" class="status-button ${waterflowMode === "manual" ? "active nr" : ""}" data-action="waterflow-mode" data-row-id="${escapeHtml(row.id)}" data-mode="manual" ${disabled ? "disabled" : ""}>Manual Entry</button>
        <button type="button" class="status-button ${waterflowMode === "automatic" ? "active ok" : ""}" data-action="waterflow-mode" data-row-id="${escapeHtml(row.id)}" data-mode="automatic" ${disabled ? "disabled" : ""}>Automatic Stopwatch</button>
      </div>
    </div>
  `;
}

function waterflowManualView(row, isLocal, disabled = false) {
  return `
    <div class="waterflow-panel white">
      <div class="field-grid">
        ${timeField(`deviceTrip:${row.id}`, "Trip time", disabled ? "" : row.tripTime || "", true, disabled)}
        ${timeField(`deviceReceived:${row.id}`, isLocal ? "Time received / N/A" : "Time received", isLocal || disabled ? (isLocal ? "N/A" : "") : row.timeReceived || "", true, isLocal || disabled)}
      </div>
    </div>
  `;
}

function waterflowAutomaticView(row, isLocal, waterflowSeconds, waterflowOverdue, disabled = false) {
  return `
    <div class="waterflow-panel blue">
      <div class="timer-grid">
        <div>
          <span>Trig time</span>
          <strong>${escapeHtml(row.tripTime || "--:--:--")}</strong>
        </div>
        <div>
          <span>Received time</span>
          <strong>${escapeHtml(row.timeReceived || "--:--:--")}</strong>
        </div>
        <div>
          <span>Elapsed</span>
          <strong class="elapsed ${elapsedClass(waterflowSeconds)}">${waterflowSeconds === null ? "--" : formatElapsed(waterflowSeconds)}</strong>
        </div>
      </div>
      <div class="actions">
        <button class="button primary" data-action="start-waterflow" data-row-id="${escapeHtml(row.id)}" ${disabled ? "disabled" : ""}>Flow Water</button>
        <button class="button success" data-action="complete-waterflow" data-row-id="${escapeHtml(row.id)}" ${disabled || isLocal || !row.tripTime ? "disabled" : ""}>Alarm Signal Received</button>
        ${waterflowOverdue ? `<button class="button danger" data-action="no-waterflow" data-row-id="${escapeHtml(row.id)}" ${disabled ? "disabled" : ""}>Signal Has Not Been Received</button>` : ""}
        <button class="button ghost" data-action="reset-waterflow" data-row-id="${escapeHtml(row.id)}" ${disabled ? "disabled" : ""}>Reset Test</button>
      </div>
    </div>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", handleAction);
  });
  document.querySelectorAll("input[data-field], select[data-field], textarea[data-field]").forEach((element) => {
    element.addEventListener("input", handleFieldInput);
    element.addEventListener("change", handleFieldInput);
  });
  document.getElementById("importFile")?.addEventListener("change", handleImport);
  document.querySelectorAll("input[data-photo-row]").forEach((element) => {
    element.addEventListener("change", handlePhotoInput);
  });
}

async function handleAction(event) {
  const button = event.currentTarget;
  const action = button.dataset.action;
  if (action === "open-field-app") {
    view = { screen: "home", auditId: "", section: "signal", message: "" };
    if (window.history?.replaceState) window.history.replaceState(null, "", "./index.html");
    render();
  }
  if (action === "import") document.getElementById("importFile")?.click();
  if (action === "export") await exportToHaudySuite();
  if (action === "clear") clearDevice();
  if (action === "open-audit") openAudit(button.dataset.auditId);
  if (action === "back-home") {
    saveState();
    view = { screen: "home", auditId: "", section: "signal", message: "Saved on this device.", messageType: "good" };
    render();
  }
  if (action === "save") {
    touchAudit();
    saveState();
    view.message = "Saved on this device.";
    view.messageType = "good";
    render();
  }
  if (action === "section") {
    view.section = button.dataset.section || "signal";
    render();
  }
  if (action === "dictate") startOrStopDictation(button.dataset.target || "");
  if (action === "add-signal") addSignalRow();
  if (action === "delete-signal") deleteFromCollection("signalLog", button.dataset.rowId);
  if (action === "add-row") addAuditRow(button.dataset.collection);
  if (action === "delete-row") deleteFromCollection(button.dataset.collection, button.dataset.rowId);
  if (action === "set-status") setRowStatus(button.dataset.collection, button.dataset.rowId, button.dataset.status);
  if (action === "add-device") addDeviceRow();
  if (action === "delete-device") deleteFromCollection("deviceTests", button.dataset.rowId);
  if (action === "toggle-device") toggleDevice(button.dataset.rowId, button.dataset.field);
  if (action === "signal-device") setDeviceSignal(button.dataset.rowId, button.dataset.signal);
  if (action === "device-result") setDeviceResult(button.dataset.rowId, button.dataset.result);
  if (action === "waterflow-mode") setWaterflowMode(button.dataset.rowId, button.dataset.mode);
  if (action === "start-waterflow") startWaterflow(button.dataset.rowId);
  if (action === "complete-waterflow") completeWaterflow(button.dataset.rowId);
  if (action === "no-waterflow") markWaterflowNotReceived(button.dataset.rowId);
  if (action === "reset-waterflow") resetWaterflow(button.dataset.rowId);
  if (action === "line-security-mode") setLineSecurityMode(button.dataset.rowId, button.dataset.mode);
  if (action === "start-line-security") startLineSecurity(button.dataset.rowId);
  if (action === "complete-line-security") completeLineSecurity(button.dataset.rowId);
  if (action === "no-line-security") markLineSecurityNotReceived(button.dataset.rowId);
  if (action === "reset-line-security") resetLineSecurity(button.dataset.rowId);
  if (action === "guard-mode") setGuardMode(button.dataset.mode);
  if (action === "start-guard") startGuardService();
  if (action === "guard-verification") markGuardVerification();
  if (action === "guard-arrival") markGuardArrival();
  if (action === "reset-guard") resetGuardService();
  if (action === "guard-result") setGuardResult(button.dataset.result);
  if (action === "remove-photo") removePhoto(button.dataset.rowId, Number(button.dataset.index || "-1"));
  if (action === "open-camera") await openCamera(button.dataset.rowId || "");
  if (action === "capture-camera") captureCameraPhoto();
  if (action === "close-camera") closeCamera();
}

function handleFieldInput(event) {
  const field = event.currentTarget.dataset.field;
  const value = event.currentTarget.type === "checkbox" ? event.currentTarget.checked : event.currentTarget.value;
  updateField(field, value);
}

async function handleImport(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const parsed = parseFieldNotesImport(await readFileText(file));
    if (!parsed.audits.length) {
      throw new Error("This field-notes file contains 0 properties. In Haudy Suite, open the ASC card and use Export Field Notes for iHaudy again.");
    }
    state = {
      app: APP_NAME,
      version: parsed.version || VERSION,
      source: "iHaudy",
      exportedAt: new Date().toISOString(),
      ascKey: parsed.ascKey || "",
      ascName: parsed.ascName || "",
      ascCity: parsed.ascCity || "",
      ascState: parsed.ascState || "",
      psn: parsed.psn || "",
      audits: parsed.audits
    };
    state.audits = state.audits.map(ensureAuditDefaults);
    saveState();
    view = { screen: "home", auditId: "", section: "signal", message: `Imported ${parsed.audits.length} field note${parsed.audits.length === 1 ? "" : "s"} from Haudy Suite.`, messageType: "good" };
  } catch (error) {
    view.message = error instanceof Error ? error.message : "Could not read this file. Please import the field-notes file exported from Haudy Suite.";
    view.messageType = "warn";
  }
  render();
}

async function readFileText(file) {
  try {
    return await file.text();
  } catch {
    const buffer = await file.arrayBuffer();
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function parseFieldNotesImport(rawText) {
  const text = String(rawText || "").replace(/^\uFEFF/, "").trim();
  const candidates = [
    text,
    unwrapDataUrl(text),
    extractJsonObject(text)
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const payload = normalizeFieldNotesPayload(parsed);
      if (payload) return payload;
    } catch {
      // Try the next shape. Some iPad/cloud file providers add wrappers.
    }
  }

  throw new Error("Could not read this file. In Haudy Suite, use Export Field Notes for iHaudy, then import that .ihaudy-field-notes.json file here.");
}

function normalizeFieldNotesPayload(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  if (Array.isArray(parsed.audits)) return { ...parsed, audits: parsed.audits.filter(Boolean) };
  if (parsed.app === "Haudy" && parsed.entries && typeof parsed.entries["haudy.audits"] === "string") {
    try {
      return {
        app: APP_NAME,
        version: VERSION,
        source: "Haudy Suite",
        exportedAt: parsed.exportedAt || "",
        ascKey: "",
        ascName: "",
        ascCity: "",
        ascState: "",
        psn: "",
        audits: JSON.parse(parsed.entries["haudy.audits"])
      };
    } catch {
      return null;
    }
  }
  return null;
}

function unwrapDataUrl(value) {
  const match = value.match(/^data:[^,]*,(.*)$/s);
  if (!match) return "";
  const payload = match[1];
  try {
    return value.includes(";base64,") ? atob(payload) : decodeURIComponent(payload);
  } catch {
    return "";
  }
}

function extractJsonObject(value) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  return value.slice(start, end + 1);
}

async function exportToHaudySuite() {
  saveState();
  view.message = "Preparing photos for Haudy Suite...";
  view.messageType = "good";
  render();
  const { payload, failedPhotos } = await exportPayloadWithPortablePhotos();
  const fileName = `import it to Haudy - ${safeFile(state.ascName || "ASC")} - ${timestamp()}.ihaudy-field-notes.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  view.message = failedPhotos
    ? `Export file created, but ${failedPhotos} photo${failedPhotos === 1 ? "" : "s"} could not be converted. Re-add those photos and export again.`
    : "Export file created for Haudy Suite.";
  view.messageType = failedPhotos ? "warn" : "good";
  render();
}

async function exportPayloadWithPortablePhotos() {
  const payload = JSON.parse(JSON.stringify({ ...state, source: "iHaudy", exportedAt: new Date().toISOString() }));
  let failedPhotos = 0;
  for (const audit of payload.audits || []) {
    const rowSets = [audit.documentation || [], audit.installation || [], audit.deviceTests || []];
    for (const rows of rowSets) {
      for (const row of rows) {
        const converted = [];
        for (const photo of row.photos || []) {
          const portable = await portablePhotoDataUrl(photo);
          if (portable) converted.push(portable);
          else failedPhotos += 1;
        }
        row.photos = converted;
      }
    }
  }
  return { payload, failedPhotos };
}

async function portablePhotoDataUrl(photo) {
  if (!photo) return "";
  if (!isDataUrl(photo)) return photo;
  const normalized = normalizeImageDataUrl(photo);
  if (/^data:image\/(jpeg|jpg|png|webp);/i.test(normalized)) return normalized;
  try {
    return await imageSourceToJpeg(normalized);
  } catch {
    return "";
  }
}

function clearDevice() {
  if (!confirm("Clear all iHaudy field notes from this device?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = loadState();
  view = { screen: "home", auditId: "", section: "signal", message: "iHaudy data cleared from this device.", messageType: "warn" };
  render();
}

function openAudit(auditId) {
  const audit = state.audits.find((item) => item.id === auditId);
  if (audit) {
    state.audits = state.audits.map((item) => item.id === auditId ? ensureAuditDefaults(item) : item);
    saveState();
  }
  view = { screen: "property", auditId, section: firstSectionForAudit(audit || {}), message: "" };
  render();
}

function currentAudit() {
  return state.audits.find((audit) => audit.id === view.auditId);
}

function updateCurrentAudit(updater) {
  state.audits = state.audits.map((audit) => {
    if (audit.id !== view.auditId) return audit;
    const next = updater(structuredClone(audit));
    next.updatedAt = new Date().toISOString();
    return next;
  });
  saveState();
}

function touchAudit() {
  updateCurrentAudit((audit) => audit);
}

function updateField(field, value) {
  updateCurrentAudit((audit) => {
    const [kind, id] = field.split(":");
    if (kind === "signalType") updateRow(audit.signalLog, id, (row) => row.signalType = value);
    else if (kind === "signalDate") updateRow(audit.signalLog, id, (row) => row.date = value);
    else if (kind === "signalTime") updateRow(audit.signalLog, id, (row) => row.time = value);
    else if (kind === "signalHandling") updateRow(audit.signalLog, id, (row) => row.handlingStatus = value);
    else if (kind === "signalDescription") updateRow(audit.signalLog, id, (row) => row.description = value);
    else if (kind === "signalNotes") updateRow(audit.signalLog, id, (row) => row.notes = value);
    else if (kind === "documentationNotes") updateRow(audit.documentation, id, (row) => row.notes = value);
    else if (kind === "installationNotes") updateRow(audit.installation, id, (row) => row.notes = value);
    else if (kind === "deviceType") updateRow(audit.deviceTests, id, (row) => {
      row.deviceType = value;
      row.waterflowEntryMode = value === "Waterflow switch" || value === LINE_SECURITY_DEVICE_TYPE ? row.waterflowEntryMode || "manual" : "";
      row.waterflowElapsedSeconds = 0;
      row.tripTime = "";
      row.timeReceived = "";
      row.result = "";
      row.notes = "";
    });
    else if (kind === "deviceLocation") updateRow(audit.deviceTests, id, (row) => row.location = value);
    else if (kind === "deviceId") updateRow(audit.deviceTests, id, (row) => row.deviceId = value);
    else if (kind === "deviceTrip") updateRow(audit.deviceTests, id, (row) => row.tripTime = value);
    else if (kind === "deviceReceived") updateRow(audit.deviceTests, id, (row) => row.timeReceived = value);
    else if (kind === "lineSecurityExpected") updateRow(audit.deviceTests, id, (row) => {
      row.lineSecurityExpectedSeconds = Number(value) || defaultLineSecurityInterval(lineSecurityKind(audit));
      row.result = "";
      row.notes = "";
    });
    else if (kind === "lineSecurityReceived") updateRow(audit.deviceTests, id, (row) => applyManualLineSecurity(row, value));
    else if (kind === "deviceNotes") updateRow(audit.deviceTests, id, (row) => row.notes = value);
    else if (kind === "guardReviewed") audit.guardServiceTest = { ...defaultGuardServiceTest(), ...(audit.guardServiceTest || {}), reviewed: value === "true", updatedAt: new Date().toISOString() };
    else if (kind === "guardSignalType") patchGuard(audit, { signalType: value });
    else if (kind === "guardExpectedMinutes") patchGuard(audit, { expectedMinutes: Number(value) || 20, result: "" });
    else if (kind === "guardOtherSignalType") patchGuard(audit, { otherSignalType: value });
    else if (kind === "guardTestSignal") patchGuard(audit, { testSignalInitiationTime: value, elapsedSeconds: 0, result: "" });
    else if (kind === "guardVerification") patchGuard(audit, { verificationCallTime: value });
    else if (kind === "guardArrival") applyManualGuardArrival(audit, value);
    else if (kind === "guardNotes") patchGuard(audit, { notes: value });
    else if (kind === "deviceSystemLocal") {
      const deviceSystemLocal = value === "true";
      audit.deviceSystemLocal = deviceSystemLocal;
      if (deviceSystemLocal) {
        audit.signalProcessingReviewed = false;
        audit.signalReviewStart = "";
        audit.signalReviewEnd = "";
        audit.autoTestsStatus = "";
        audit.signalLog = (audit.signalLog || []).map((row) => ({ ...row, signalType: "", handlingStatus: "", date: "", time: "", description: "", notes: "", updatedAt: new Date().toISOString() }));
        audit.deviceTests = (audit.deviceTests || []).map((row) => ({ ...row, timeReceived: "", updatedAt: new Date().toISOString() }));
      }
      audit.editedFields = { ...(audit.editedFields || {}), signalProcessingReviewed: true };
    }
    else if (["signalProcessingReviewed", "documentationReviewed", "installationReviewed", "deviceTestingReviewed"].includes(kind)) {
      audit[kind] = value === "true";
      audit.editedFields = { ...(audit.editedFields || {}), [kind]: true };
    }
    else if (kind === "matchesCertificateStatus") {
      audit.matchesCertificateStatus = value;
      audit.matchesCertificate = value === "OK";
    }
    else if (kind === "certificateDisplayedStatus") {
      audit.certificateDisplayedStatus = value;
      audit.certificateDisplayed = value === "OK";
    }
    else audit[field] = value === "true" ? true : value === "false" ? false : value;
    return audit;
  });
}

function updateRow(rows, id, updater) {
  const row = rows.find((item) => item.id === id);
  if (!row) return;
  updater(row);
  row.updatedAt = new Date().toISOString();
}

function addSignalRow() {
  updateCurrentAudit((audit) => {
    audit.signalLog = audit.signalLog || [];
    audit.signalLog.push({
      id: uid("signal"),
      signalType: "",
      handlingStatus: "",
      date: "",
      time: "",
      description: "",
      notes: "",
      reportFinding: "",
      reportRequiredAction: "",
      reportCodeStandard: "NFPA 72",
      reportCodeEdition: "",
      reportCodeSection: "",
      updatedAt: new Date().toISOString()
    });
    return audit;
  });
  render();
}

function addAuditRow(collection) {
  const name = prompt("Row title");
  if (!name) return;
  updateCurrentAudit((audit) => {
    audit[collection].push({
      id: uid("row"),
      element: name.trim(),
      status: "",
      notes: "",
      reportFinding: "",
      reportRequiredAction: "",
      reportCodeStandard: "NFPA 72",
      reportCodeEdition: "",
      reportCodeSection: "",
      photos: [],
      userAdded: true,
      updatedAt: new Date().toISOString(),
      updatedBy: ""
    });
    return audit;
  });
  render();
}

function addDeviceRow() {
  updateCurrentAudit((audit) => {
    audit.deviceTests = audit.deviceTests || [];
    audit.deviceTests.push(createDeviceRow());
    return audit;
  });
  render();
}

function deleteFromCollection(collection, rowId) {
  updateCurrentAudit((audit) => {
    audit[collection] = (audit[collection] || []).filter((row) => row.id !== rowId);
    return audit;
  });
  render();
}

function setRowStatus(collection, rowId, status) {
  updateCurrentAudit((audit) => {
    updateRow(audit[collection], rowId, (row) => row.status = status);
    return audit;
  });
  render();
}

function toggleDevice(rowId, field) {
  updateCurrentAudit((audit) => {
    updateRow(audit.deviceTests, rowId, (row) => row[field] = !row[field]);
    return audit;
  });
  render();
}

function setDeviceSignal(rowId, signal) {
  updateCurrentAudit((audit) => {
    updateRow(audit.deviceTests, rowId, (row) => {
      row.signalType = signal;
      row.alarm = signal === "Alarm";
      row.supervisory = signal === "Supervisory";
      row.trouble = signal === "Trouble";
      row.lineSecurity = signal === "Line Security";
    });
    return audit;
  });
  render();
}

function setDeviceResult(rowId, result) {
  updateCurrentAudit((audit) => {
    updateRow(audit.deviceTests, rowId, (row) => {
      row.result = row.result === result ? "" : result;
    });
    return audit;
  });
  render();
}

function setWaterflowMode(rowId, mode) {
  updateCurrentAudit((audit) => {
    updateRow(audit.deviceTests, rowId, (row) => {
      row.waterflowEntryMode = mode;
      row.waterflowElapsedSeconds = 0;
      row.tripTime = "";
      row.timeReceived = "";
      row.result = "";
      row.notes = "";
    });
    return audit;
  });
  render();
}

function startWaterflow(rowId) {
  updateCurrentAudit((audit) => {
    updateRow(audit.deviceTests, rowId, (row) => {
      row.tripTime = timeStamp(new Date());
      row.timeReceived = "";
      row.waterflowElapsedSeconds = 0;
      row.result = "";
      row.notes = "";
    });
    return audit;
  });
  render();
}

function completeWaterflow(rowId) {
  const receivedTime = timeStamp(new Date());
  updateCurrentAudit((audit) => {
    updateRow(audit.deviceTests, rowId, (row) => {
      const duration = secondsBetween(row.tripTime, receivedTime);
      const passed = duration !== null && duration < 90;
      row.timeReceived = receivedTime;
      row.waterflowElapsedSeconds = 0;
      row.result = passed ? "OK" : "VAR";
      if (!passed) row.notes = `Waterflow test failed; exceeded 90 seconds${duration === null ? "." : ` (${duration} seconds).`}`;
    });
    return audit;
  });
  render();
}

function markWaterflowNotReceived(rowId) {
  const stoppedTime = timeStamp(new Date());
  updateCurrentAudit((audit) => {
    updateRow(audit.deviceTests, rowId, (row) => {
      const duration = secondsBetween(row.tripTime, stoppedTime);
      row.timeReceived = "";
      row.waterflowElapsedSeconds = duration ?? 0;
      row.result = "VAR";
      row.notes = `The waterflow is not functioning; after waiting ${duration ?? 0} seconds, no alarm signal was received.`;
    });
    return audit;
  });
  render();
}

function resetWaterflow(rowId) {
  updateCurrentAudit((audit) => {
    updateRow(audit.deviceTests, rowId, (row) => {
      row.tripTime = "";
      row.timeReceived = "";
      row.waterflowElapsedSeconds = 0;
      row.result = "";
      row.notes = "";
    });
    return audit;
  });
  render();
}

function setLineSecurityMode(rowId, mode) {
  updateCurrentAudit((audit) => {
    updateRow(audit.deviceTests, rowId, (row) => {
      row.waterflowEntryMode = mode;
      row.waterflowElapsedSeconds = 0;
      row.tripTime = "";
      row.timeReceived = "";
      row.result = "";
      row.notes = "";
      row.functional = true;
      row.lineSecurity = true;
      row.lineSecurityExpectedSeconds = row.lineSecurityExpectedSeconds || defaultLineSecurityInterval(lineSecurityKind(audit));
    });
    return audit;
  });
  render();
}

function startLineSecurity(rowId) {
  updateCurrentAudit((audit) => {
    updateRow(audit.deviceTests, rowId, (row) => {
      row.tripTime = timeStamp(new Date());
      row.timeReceived = "";
      row.waterflowElapsedSeconds = 0;
      row.functional = true;
      row.lineSecurity = true;
      row.result = "";
      row.notes = "";
    });
    return audit;
  });
  render();
}

function completeLineSecurity(rowId) {
  const receivedTime = timeStamp(new Date());
  updateCurrentAudit((audit) => {
    updateRow(audit.deviceTests, rowId, (row) => {
      applyManualLineSecurity(row, receivedTime);
    });
    return audit;
  });
  render();
}

function markLineSecurityNotReceived(rowId) {
  const stoppedTime = timeStamp(new Date());
  updateCurrentAudit((audit) => {
    updateRow(audit.deviceTests, rowId, (row) => {
      const expectedSeconds = row.lineSecurityExpectedSeconds || defaultLineSecurityInterval(lineSecurityKind(audit));
      const duration = secondsBetween(row.tripTime, stoppedTime);
      row.timeReceived = "";
      row.waterflowElapsedSeconds = duration ?? expectedSeconds;
      row.functional = true;
      row.lineSecurity = true;
      row.result = "VAR";
      row.notes = `Line security check-in was not received after waiting ${duration ?? expectedSeconds} seconds.`;
    });
    return audit;
  });
  render();
}

function resetLineSecurity(rowId) {
  updateCurrentAudit((audit) => {
    updateRow(audit.deviceTests, rowId, (row) => {
      row.tripTime = "";
      row.timeReceived = "";
      row.waterflowElapsedSeconds = 0;
      row.result = "";
      row.notes = "";
    });
    return audit;
  });
  render();
}

function patchGuard(audit, update) {
  audit.guardServiceTest = { ...defaultGuardServiceTest(), ...(audit.guardServiceTest || {}), ...update, updatedAt: new Date().toISOString() };
}

function setGuardMode(mode) {
  updateCurrentAudit((audit) => {
    patchGuard(audit, {
      entryMode: mode,
      testSignalInitiationTime: "",
      verificationCallTime: "",
      investigatorArrivalTime: "",
      elapsedSeconds: 0,
      result: "",
      notes: ""
    });
    return audit;
  });
  render();
}

function startGuardService() {
  updateCurrentAudit((audit) => {
    patchGuard(audit, {
      testSignalInitiationTime: timeStamp(new Date()),
      verificationCallTime: "",
      investigatorArrivalTime: "",
      elapsedSeconds: 0,
      result: "",
      notes: ""
    });
    return audit;
  });
  render();
}

function markGuardVerification() {
  updateCurrentAudit((audit) => {
    patchGuard(audit, { verificationCallTime: timeStamp(new Date()) });
    return audit;
  });
  render();
}

function markGuardArrival() {
  const arrivalTime = timeStamp(new Date());
  updateCurrentAudit((audit) => {
    applyManualGuardArrival(audit, arrivalTime);
    return audit;
  });
  render();
}

function resetGuardService() {
  updateCurrentAudit((audit) => {
    patchGuard(audit, {
      testSignalInitiationTime: "",
      verificationCallTime: "",
      investigatorArrivalTime: "",
      elapsedSeconds: 0,
      result: "",
      notes: ""
    });
    return audit;
  });
  render();
}

function setGuardResult(result) {
  updateCurrentAudit((audit) => {
    const guard = { ...defaultGuardServiceTest(), ...(audit.guardServiceTest || {}) };
    patchGuard(audit, { result: guard.result === result ? "" : result });
    return audit;
  });
  render();
}

async function handlePhotoInput(event) {
  const rowId = event.currentTarget.dataset.photoRow;
  const files = Array.from(event.currentTarget.files || []);
  event.currentTarget.value = "";
  if (!files.length) return;
  const photos = await Promise.all(files.map(fileToDataUrl));
  updateCurrentAudit((audit) => {
    updateRow(audit.installation, rowId, (row) => {
      row.photos = [...(row.photos || []), ...photos];
    });
    return audit;
  });
  render();
}

function removePhoto(rowId, index) {
  updateCurrentAudit((audit) => {
    updateRow(audit.installation, rowId, (row) => {
      row.photos = (row.photos || []).filter((_, itemIndex) => itemIndex !== index);
    });
    return audit;
  });
  render();
}

async function openCamera(rowId) {
  if (!rowId) return;
  view.cameraRowId = rowId;
  render();
  try {
    closeCameraStream();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1600 }, height: { ideal: 1200 } },
      audio: false
    });
    attachCameraStream();
  } catch {
    view.cameraRowId = "";
    view.message = "Camera could not open. Use Photo Library, or allow camera access and try again.";
    view.messageType = "warn";
    render();
  }
}

function attachCameraStream() {
  const video = document.getElementById("cameraPreview");
  if (video && cameraStream) video.srcObject = cameraStream;
}

function captureCameraPhoto() {
  const rowId = view.cameraRowId;
  const video = document.getElementById("cameraPreview");
  if (!rowId || !video || !video.videoWidth || !video.videoHeight) return;
  const photo = canvasImageToJpeg(video.videoWidth, video.videoHeight, (ctx, width, height) => {
    ctx.drawImage(video, 0, 0, width, height);
  });
  updateCurrentAudit((audit) => {
    updateRow(audit.installation, rowId, (row) => {
      row.photos = [...(row.photos || []), photo];
    });
    return audit;
  });
  closeCamera();
}

function closeCamera() {
  view.cameraRowId = "";
  closeCameraStream();
  render();
}

function closeCameraStream() {
  if (!cameraStream) return;
  cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
}

function setDictationButtonState(target, active) {
  document.querySelectorAll(`[data-action="dictate"][data-target="${CSS.escape(target)}"]`).forEach((button) => {
    button.textContent = active ? "Stop Dictation" : "Start Dictation";
    button.classList.toggle("warning", active);
  });
}

function joinTranscriptParts(...parts) {
  return parts.map((part) => String(part || "").trim()).filter(Boolean).join(" ");
}

function stopRecognitionSafely() {
  if (!recognition) return;
  try {
    recognition.stop();
  } catch {
    // iOS may already be ending the recognition session.
  }
}

function beginDictationRecognition(target) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const input = document.querySelector(`[data-field="${CSS.escape(target)}"]`);
  if (!SpeechRecognition || !input || !dictationShouldRun) return;
  const ios = isIosDevice();

  recognition = new SpeechRecognition();
  recognition.continuous = !ios;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    setDictationButtonState(target, true);
    window.clearTimeout(dictationFlushTimer);
    if (ios) {
      dictationFlushTimer = window.setTimeout(() => {
        if (recognition && dictationShouldRun && dictationTarget === target) stopRecognitionSafely();
      }, 6500);
    }
  };
  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0].transcript;
      if (event.results[index].isFinal) finalTranscript = joinTranscriptParts(finalTranscript, transcript);
      else interim = joinTranscriptParts(interim, transcript);
    }
    dictationNoResultCycles = 0;
    input.value = joinTranscriptParts(dictationBase, finalTranscript, interim);
    updateField(target, input.value);
  };
  recognition.onspeechend = () => {
    if (ios && recognition && dictationShouldRun) stopRecognitionSafely();
  };
  recognition.onsoundend = () => {
    if (ios && recognition && dictationShouldRun) stopRecognitionSafely();
  };
  recognition.onerror = (event) => {
    if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
      dictationShouldRun = false;
      setDictationButtonState(target, false);
      alert("iHaudy could not access dictation. Check microphone permission for Safari/iHaudy, then try again.");
    }
  };
  recognition.onend = () => {
    window.clearTimeout(dictationFlushTimer);
    recognition = null;
    if (dictationShouldRun && dictationTarget === target) {
      if (ios && !finalTranscript.trim() && input.value === dictationBase) {
        dictationNoResultCycles += 1;
        if (dictationNoResultCycles >= 2 && isStandaloneMode()) {
          dictationShouldRun = false;
          dictationTarget = null;
          setDictationButtonState(target, false);
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
          alert("iPad Home Screen accepted the microphone but did not return text. The note box is ready; use the iPad keyboard microphone for this field.");
          return;
        }
      }
      dictationRestartTimer = window.setTimeout(() => beginDictationRecognition(target), ios ? 450 : 250);
      return;
    }
    dictationTarget = null;
    setDictationButtonState(target, false);
  };

  try {
    recognition.start();
  } catch {
    dictationShouldRun = false;
    dictationTarget = null;
    recognition = null;
    setDictationButtonState(target, false);
  }
}

function startOrStopDictation(target) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Dictation is not available in this browser.");
    return;
  }
  if (dictationShouldRun && dictationTarget === target) {
    dictationShouldRun = false;
    window.clearTimeout(dictationRestartTimer);
    window.clearTimeout(dictationFlushTimer);
    stopRecognitionSafely();
    recognition = null;
    dictationTarget = null;
    setDictationButtonState(target, false);
    return;
  }
  if (recognition) {
    dictationShouldRun = false;
    stopRecognitionSafely();
  }
  window.clearTimeout(dictationRestartTimer);
  window.clearTimeout(dictationFlushTimer);
  const input = document.querySelector(`[data-field="${CSS.escape(target)}"]`);
  if (!input) return;
  if (isIosDevice()) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  dictationTarget = target;
  dictationBase = input.value || "";
  finalTranscript = "";
  dictationNoResultCycles = 0;
  dictationShouldRun = true;
  beginDictationRecognition(target);
}

function selectField(field, label, value, options, disabled = false) {
  return `
    <label>${escapeHtml(label)}
      <select data-field="${escapeHtml(field)}" ${disabled ? "disabled" : ""}>
        ${options.map(([optionValue, text]) => `<option value="${escapeHtml(optionValue)}" ${String(value) === String(optionValue) ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}
      </select>
    </label>
  `;
}

function inputField(field, label, value, disabled = false) {
  return `<label>${escapeHtml(label)}<input data-field="${escapeHtml(field)}" value="${escapeHtml(value || "")}" ${disabled ? "disabled" : ""} /></label>`;
}

function dateField(field, label, value, disabled = false) {
  return `<label>${escapeHtml(label)}<input type="date" data-field="${escapeHtml(field)}" value="${escapeHtml(value || "")}" ${disabled ? "disabled" : ""} /></label>`;
}

function timeField(field, label, value, seconds = false, disabled = false) {
  return `<label>${escapeHtml(label)}<input type="${disabled ? "text" : "time"}" ${seconds && !disabled ? "step=\"1\"" : ""} data-field="${escapeHtml(field)}" value="${escapeHtml(value || "")}" ${disabled ? "disabled" : ""} /></label>`;
}

function textAreaField(field, label, value, disabled = false) {
  return `<label>${escapeHtml(label)}<textarea data-field="${escapeHtml(field)}" ${disabled ? "disabled" : ""}>${escapeHtml(value || "")}</textarea></label>`;
}

function noteField(field, label, value, disabled = false) {
  const active = dictationShouldRun && dictationTarget === field;
  return `
    <div class="grid">
      ${textAreaField(field, label, value, disabled)}
      <button type="button" class="button small ${active ? "warning" : ""}" data-action="dictate" data-target="${escapeHtml(field)}" ${disabled ? "disabled" : ""}>${active ? "Stop Dictation" : "Start Dictation"}</button>
    </div>
  `;
}

function statusButton(collection, rowId, status, current, label, className, disabled = false) {
  return `<button type="button" class="status-button ${current === status ? `active ${className}` : ""}" data-action="set-status" data-collection="${collection}" data-row-id="${escapeHtml(rowId)}" data-status="${status}" ${disabled ? "disabled" : ""}>${label}</button>`;
}

function toggleButton(field, rowId, active, label, disabled = false) {
  return `<button type="button" class="status-button ${active ? "active ok" : ""}" data-action="toggle-device" data-row-id="${escapeHtml(rowId)}" data-field="${field}" ${disabled ? "disabled" : ""}>${label}</button>`;
}

function exclusiveSignalButton(rowId, signal, active, label, disabled = false) {
  const className = signal === "Alarm" ? "var" : signal === "Supervisory" ? "na" : "nr";
  return `<button type="button" class="status-button ${active ? `active ${className}` : ""}" data-action="signal-device" data-row-id="${escapeHtml(rowId)}" data-signal="${signal}" ${disabled ? "disabled" : ""}>${label}</button>`;
}

function deviceResultButton(rowId, result, current, label, className, disabled = false) {
  return `<button type="button" class="status-button ${current === result ? `active ${className}` : ""}" data-action="device-result" data-row-id="${escapeHtml(rowId)}" data-result="${result}" ${disabled ? "disabled" : ""}>${label}</button>`;
}

function statusSelectField(field, label, value, options, disabled = false) {
  return selectField(field, label, value, options, disabled);
}

function reviewedStatusOptions() {
  return [["", "Select"], ["OK", "In Conformance"], ["VAR", "Variation Noted"], ["NA", "Not Applicable"], ["NR", "Not Reviewed"]];
}

function displayStatusOptions() {
  return [["", "Select"], ["OK", "In Conformance"], ["VAR", "Variation Noted"], ["NA", "Not Applicable"]];
}

function photoTools(row) {
  return `
    <div class="grid">
      <div class="actions">
        <button type="button" class="button small primary" data-action="open-camera" data-row-id="${escapeHtml(row.id)}">Take Photo</button>
        <label class="button small ghost">Photo Library<input class="hidden" type="file" accept="image/*" data-photo-row="${escapeHtml(row.id)}" /></label>
      </div>
      <div class="photo-grid">
        ${(row.photos || []).map((photo, index) => `
          <div class="photo">
            <img src="${escapeHtml(photo)}" alt="Captured deficiency" />
            <button type="button" data-action="remove-photo" data-row-id="${escapeHtml(row.id)}" data-index="${index}">x</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function cameraView() {
  if (!view.cameraRowId) return "";
  return `
    <div class="camera-backdrop">
      <section class="camera-panel">
        <div class="row-head">
          <strong>Capture installation photo</strong>
          <button type="button" class="button small ghost" data-action="close-camera">Close</button>
        </div>
        <video id="cameraPreview" autoplay playsinline></video>
        <div class="actions">
          <button type="button" class="button success" data-action="capture-camera">Use This Photo</button>
          <button type="button" class="button ghost" data-action="close-camera">Cancel</button>
        </div>
      </section>
    </div>
  `;
}

function primaryCertificate(audit) {
  return audit.certificates?.[audit.primaryCertificateIndex || 0] || audit.certificates?.[0] || {};
}

function canDeleteAuditRow(row) {
  return Boolean(row?.userAdded || row?.isUserAdded || row?.custom || row?.isCustom || String(row?.id || "").startsWith("row"));
}

function equipmentSummary(source, keys) {
  const parts = keys
    .map((key) => String(source?.[key] || "").trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).join(" ");
}

function deviceOptions(audit) {
  const fireDeviceTypes = [
    ["", "Select"],
    ["Backup battery", "Backup battery"],
    ["Communication fail", "Communication fail"],
    ["Ground fault", "Ground fault"],
    ["AC fail", "AC fail"],
    ["NAC disable", "NAC disable"],
    ["NAC trouble", "NAC trouble"],
    ["Smoke detector", "Smoke detector"],
    ["Heat detector", "Heat detector"],
    ["Carbon monoxide detector", "Carbon monoxide detector"],
    ["Duct-type smoke detector", "Duct-type smoke detector"],
    ["Tamper switch", "Tamper switch"],
    ["Control valve", "Control valve"],
    ["Waterflow switch", "Waterflow switch"],
    ["PIV", "PIV"],
    ["OS & Y", "OS & Y"],
    ["Manual pull station", "Manual pull station"]
  ];
  const securityDeviceTypes = [
    ["", "Select"],
    ["Door Contact", "Door Contact"],
    ["Roll-Up Contact", "Roll-Up Contact"],
    ["Window Contact", "Window Contact"],
    ["Motion", "Motion"],
    ["Glass Break", "Glass Break"],
    ["Beam", "Beam"],
    ["Vibration", "Vibration"],
    ["Shock", "Shock"],
    ["Safe Contact", "Safe Contact"],
    ["Vault Contact", "Vault Contact"],
    ["Hold-Up", "Hold-Up"],
    ["Panic", "Panic"],
    ["Money Clip", "Money Clip"],
    ["Foil", "Foil"],
    ["Roof Hatch", "Roof Hatch"],
    ["Trap", "Trap"],
    ["Panel Tamper", "Panel Tamper"],
    ["Device Tamper", "Device Tamper"],
    ["Bell/Siren Tamper", "Bell/Siren Tamper"],
    ["Power Tamper", "Power Tamper"],
    ["Comm Tamper", "Comm Tamper"],
    ["Bell/Siren", "Bell/Siren"],
    ["Strobe", "Strobe"],
    ["Communicator", "Communicator"],
    ["Battery", "Battery"],
    ["AC Fail", "AC Fail"],
    ["Comm Fail", "Comm Fail"],
    ["Ground Fault", "Ground Fault"]
  ];
  return isSecurityProgram(audit) ? securityDeviceTypes : fireDeviceTypes;
}

function sectionTabsForAudit(audit) {
  const program = auditProgram(audit);
  return BASE_SECTION_TABS.filter((tab) => {
    if (program === "mercantile" && tab.id === "signal") return false;
    if (program !== "protectedArea" && tab.id === "guard") return false;
    return true;
  });
}

function firstSectionForAudit(audit) {
  return sectionTabsForAudit(audit)[0]?.id || "documentation";
}

function categoryCode(audit) {
  const certificate = primaryCertificate(audit);
  const direct = String(audit.categoryCode || audit.ccn || audit.certificateCategory || certificate.categoryCode || certificate.ccn || certificate.category || "").trim().toUpperCase();
  if (/\bCVSG\b/.test(direct)) return "CVSG";
  if (/\bCRZH\b/.test(direct)) return "CRZH";
  if (/\bUUFX\b/.test(direct)) return "UUFX";
  if (/\bUUJS\b/.test(direct)) return "UUJS";
  if (direct && !/[\s/,-]/.test(direct)) return direct;
  const haystack = [
    audit.fileScn,
    audit.fileNo,
    audit.standard,
    audit.codeEdition,
    audit.systemType,
    audit.certificateType,
    certificate.fileScn,
    certificate.fileNo,
    certificate.standard,
    certificate.codeEdition,
    certificate.systemType,
    certificate.certificateType,
    certificate.rawText
  ].filter(Boolean).join(" ").toUpperCase();
  if (/\bCVSG\b/.test(haystack) || /\bUL\s*681\b/.test(haystack)) return "CVSG";
  if (/\bCRZH\b/.test(haystack)) return "CRZH";
  if (/\bUUFX\b/.test(haystack)) return "UUFX";
  if (/\bUUJS\b/.test(haystack)) return "UUJS";
  return "";
}

function auditProgram(audit) {
  const code = categoryCode(audit);
  if (code === "CVSG") return "mercantile";
  if (code === "CRZH") return "protectedArea";
  return "fire";
}

function isSecurityProgram(audit) {
  const program = auditProgram(audit);
  return program === "mercantile" || program === "protectedArea";
}

function lineSecurityKind(audit) {
  const certificate = primaryCertificate(audit);
  return String(audit.lineSecurity || certificate.lineSecurity || certificate.lineSecurityKind || "").trim();
}

function hasLineSecurityRequirement(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(normalized && !["no", "none", "n/a", "na", "not applicable", "without line security"].includes(normalized));
}

function defaultLineSecurityInterval(value) {
  return /dual/i.test(String(value || "")) ? 360 : 200;
}

function deviceRowsForProgram(audit) {
  const rows = audit.deviceTests || [];
  return isSecurityProgram(audit) ? rows.filter((row) => row.deviceType !== LINE_SECURITY_DEVICE_TYPE || hasLineSecurityRequirement(lineSecurityKind(audit))) : rows;
}

function ensureAuditDefaults(audit) {
  const next = structuredClone(audit);
  const program = auditProgram(next);
  next.editedFields = next.editedFields || {};
  next.signalLog = Array.isArray(next.signalLog) ? next.signalLog : [];
  next.documentation = Array.isArray(next.documentation) ? next.documentation : [];
  next.installation = Array.isArray(next.installation) ? next.installation : [];
  next.deviceTests = next.deviceTests || [];
  next.signalProcessingReviewed = next.signalProcessingReviewed !== false;
  next.documentationReviewed = next.documentationReviewed !== false;
  next.installationReviewed = next.installationReviewed !== false;
  next.deviceTestingReviewed = next.deviceTestingReviewed !== false;
  next.deviceSystemLocal = Boolean(next.deviceSystemLocal);
  if (program === "fire" && next.deviceSystemLocal) next.signalProcessingReviewed = false;
  next.signalReviewStart = next.signalReviewStart || "";
  next.signalReviewEnd = next.signalReviewEnd || "";
  next.autoTestsStatus = next.autoTestsStatus || "";
  next.signalReviewNotes = next.signalReviewNotes || "";
  next.documentationReviewNotes = next.documentationReviewNotes || "";
  next.installationReviewNotes = next.installationReviewNotes || "";
  next.deviceTestingNotes = next.deviceTestingNotes || "";
  next.matchesCertificateStatus = next.matchesCertificateStatus || (next.matchesCertificate === true ? "OK" : next.matchesCertificate === false ? "VAR" : "");
  next.certificateDisplayedStatus = next.certificateDisplayedStatus || (next.certificateDisplayed === true ? "OK" : next.certificateDisplayed === false ? "VAR" : "");
  next.signalLog = next.signalLog.map((row) => ({
    id: row.id || uid("signal"),
    signalType: row.signalType || "",
    date: row.date || "",
    time: row.time || "",
    handlingStatus: row.handlingStatus || row.status || "",
    description: row.description || "",
    notes: row.notes || "",
    updatedAt: row.updatedAt || new Date().toISOString()
  }));
  next.documentation = next.documentation.map((row) => ({
    id: row.id || uid("doc"),
    element: row.element || "Additional row",
    status: row.status || "",
    notes: row.notes || "",
    userAdded: Boolean(row.userAdded || row.isUserAdded || row.custom || row.isCustom || String(row.id || "").startsWith("row")),
    updatedBy: row.updatedBy || "",
    updatedAt: row.updatedAt || new Date().toISOString()
  }));
  next.installation = next.installation.map((row) => ({
    id: row.id || uid("install"),
    element: row.element || "Additional row",
    status: row.status || "",
    notes: row.notes || "",
    photos: Array.isArray(row.photos) ? row.photos : [],
    userAdded: Boolean(row.userAdded || row.isUserAdded || row.custom || row.isCustom || String(row.id || "").startsWith("row")),
    updatedBy: row.updatedBy || "",
    updatedAt: row.updatedAt || new Date().toISOString()
  }));
  next.deviceTests = next.deviceTests.map((row) => ({
    ...createDeviceRow(),
    ...row,
    id: row.id || uid("device"),
    deviceType: row.deviceType || "",
    waterflowEntryMode: row.waterflowEntryMode || "",
    waterflowElapsedSeconds: Number(row.waterflowElapsedSeconds || 0),
    lineSecurityExpectedSeconds: Number(row.lineSecurityExpectedSeconds || defaultLineSecurityInterval(lineSecurityKind(next))),
    location: row.location || "",
    deviceId: row.deviceId || "",
    tripTime: row.tripTime || "",
    timeReceived: row.timeReceived || "",
    result: row.result || "",
    notes: row.notes || "",
    photos: Array.isArray(row.photos) ? row.photos : [],
    updatedAt: row.updatedAt || new Date().toISOString()
  }));
  if (program === "protectedArea") next.guardServiceTest = { ...defaultGuardServiceTest(), ...(next.guardServiceTest || {}) };
  if (isSecurityProgram(next)) {
    const needsLineSecurity = hasLineSecurityRequirement(lineSecurityKind(next));
    const hasLineSecurityRow = next.deviceTests.some((row) => row.deviceType === LINE_SECURITY_DEVICE_TYPE);
    if (needsLineSecurity && !hasLineSecurityRow) next.deviceTests = [createLineSecurityDeviceRow(next), ...next.deviceTests];
    if (!needsLineSecurity) next.deviceTests = next.deviceTests.filter((row) => row.deviceType !== LINE_SECURITY_DEVICE_TYPE || hasCompletedDeviceData(row));
  }
  return next;
}

function hasCompletedDeviceData(row) {
  return Boolean(row.tripTime || row.timeReceived || row.result || row.notes || (row.photos || []).length);
}

function createDeviceRow() {
  return {
    id: uid("device"),
    deviceType: "",
    waterflowEntryMode: "",
    waterflowElapsedSeconds: 0,
    lineSecurityExpectedSeconds: 200,
    location: "",
    deviceId: "",
    signalType: "",
    functional: false,
    alarm: false,
    supervisory: false,
    trouble: false,
    lineSecurity: false,
    notApplicable: false,
    tripTime: "",
    timeReceived: "",
    signalReceived: false,
    restoralReceived: false,
    localIndication: false,
    result: "",
    notes: "",
    reportFinding: "",
    reportRequiredAction: "",
    reportCodeStandard: "NFPA 72",
    reportCodeEdition: "",
    reportCodeSection: "",
    photos: [],
    updatedAt: new Date().toISOString()
  };
}

function createLineSecurityDeviceRow(audit) {
  return {
    ...createDeviceRow(),
    id: uid("line-security"),
    deviceType: LINE_SECURITY_DEVICE_TYPE,
    waterflowEntryMode: "manual",
    lineSecurityExpectedSeconds: defaultLineSecurityInterval(lineSecurityKind(audit)),
    functional: true,
    lineSecurity: true
  };
}

function defaultGuardServiceTest() {
  return {
    reviewed: true,
    signalType: "",
    otherSignalType: "",
    entryMode: "",
    expectedMinutes: 20,
    testSignalInitiationTime: "",
    verificationCallTime: "",
    investigatorArrivalTime: "",
    elapsedSeconds: 0,
    result: "",
    notes: "",
    updatedAt: new Date().toISOString()
  };
}

function applyManualLineSecurity(row, receivedTime) {
  const expectedSeconds = row.lineSecurityExpectedSeconds || 200;
  const duration = secondsBetween(row.tripTime, receivedTime);
  const passed = duration !== null && duration <= expectedSeconds;
  row.timeReceived = receivedTime;
  row.waterflowElapsedSeconds = 0;
  row.functional = true;
  row.lineSecurity = true;
  row.result = duration === null ? row.result : passed ? "OK" : "VAR";
  if (duration !== null && !passed) row.notes = `Line security check-in exceeded the expected ${expectedSeconds} second interval (${duration} seconds).`;
}

function applyManualGuardArrival(audit, arrivalTime) {
  const guard = { ...defaultGuardServiceTest(), ...(audit.guardServiceTest || {}) };
  const expectedSeconds = Math.max(1, Number(guard.expectedMinutes || 20)) * 60;
  const duration = secondsBetween(guard.testSignalInitiationTime, arrivalTime);
  const passed = duration !== null && duration <= expectedSeconds;
  patchGuard(audit, {
    investigatorArrivalTime: arrivalTime,
    elapsedSeconds: duration || 0,
    result: duration === null ? guard.result : passed ? "PASS" : "FAIL",
    notes: duration === null || passed ? guard.notes : `Guard service response exceeded ${guard.expectedMinutes || 20} minutes (${guardFormatElapsed(duration)}).`
  });
}

function boolValue(value) {
  return value ? "true" : "false";
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

async function fileToDataUrl(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const bitmap = await createImageBitmap(file);
    try {
      return canvasImageToJpeg(bitmap.width, bitmap.height, (ctx, width, height) => {
        ctx.drawImage(bitmap, 0, 0, width, height);
      });
    } finally {
      if (typeof bitmap.close === "function") bitmap.close();
    }
  } catch {
    try {
      return await imageSourceToJpeg(objectUrl);
    } catch {
      return rawFileToDataUrl(file);
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function imageSourceToJpeg(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        resolve(canvasImageToJpeg(image.naturalWidth || image.width, image.naturalHeight || image.height, (ctx, width, height) => {
          ctx.drawImage(image, 0, 0, width, height);
        }));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error("Could not convert photo."));
    image.src = source;
  });
}

function isDataUrl(value) {
  return /^data:[^,]*,/i.test(String(value || ""));
}

function normalizeImageDataUrl(value) {
  const text = String(value || "");
  const match = text.match(/^data:([^,]*),(.*)$/s);
  if (!match) return text;
  const meta = match[1] || "";
  const payload = match[2] || "";
  if (/^image\//i.test(meta)) return text;
  if (!/;base64/i.test(meta)) return text;
  const mime = sniffImageMime(payload);
  return mime ? `data:${mime};base64,${payload}` : text;
}

function sniffImageMime(base64Payload) {
  const sample = base64Payload.slice(0, 32);
  try {
    const binary = atob(sample);
    const bytes = Array.from(binary, (char) => char.charCodeAt(0));
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (binary.startsWith("RIFF") && binary.slice(8, 12) === "WEBP") return "image/webp";
  } catch {
    return "";
  }
  return "";
}

function canvasImageToJpeg(sourceWidth, sourceHeight, draw) {
  const longEdge = Math.max(sourceWidth, sourceHeight);
  const scale = Math.min(1, 1400 / longEdge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");
  draw(ctx, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

function rawFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeFile(value) {
  return String(value).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "iHaudy";
}

function timestamp() {
  const now = new Date();
  return [
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    `${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`
  ].join(" ");
}

function hasRunningDeviceTimer() {
  const audit = currentAudit();
  if (!audit) return false;
  return (audit.deviceTests || []).some((row) => (
    (row.deviceType === "Waterflow switch" || row.deviceType === LINE_SECURITY_DEVICE_TYPE) &&
    row.waterflowEntryMode === "automatic" &&
    row.tripTime &&
    !row.timeReceived &&
    !(typeof row.waterflowElapsedSeconds === "number" && row.waterflowElapsedSeconds > 0)
  ));
}

function hasRunningGuardService() {
  const audit = currentAudit();
  const guard = audit?.guardServiceTest;
  return Boolean(guard && guard.entryMode === "automatic" && guard.testSignalInitiationTime && !guard.investigatorArrivalTime && !(guard.elapsedSeconds > 0));
}

function secondsBetween(start, end) {
  const startSeconds = timeToSeconds(start);
  const endSeconds = timeToSeconds(end);
  if (startSeconds === null || endSeconds === null) return null;
  return endSeconds >= startSeconds ? endSeconds - startSeconds : endSeconds + 86400 - startSeconds;
}

function timeToSeconds(value) {
  const parts = String(value || "").split(":").map(Number);
  if (parts.length < 2 || parts.some(Number.isNaN)) return null;
  const [hours, minutes, seconds = 0] = parts;
  return hours * 3600 + minutes * 60 + seconds;
}

function timeStamp(value) {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}:${String(value.getSeconds()).padStart(2, "0")}`;
}

function formatElapsed(seconds) {
  return `${seconds}s`;
}

function elapsedClass(seconds) {
  if (seconds === null) return "elapsed-idle";
  if (seconds < 60) return "elapsed-good";
  if (seconds < 75) return "elapsed-lime";
  if (seconds < 85) return "elapsed-amber";
  if (seconds < 90) return "elapsed-orange";
  return "elapsed-red";
}

function elapsedClassForLimit(seconds, limit) {
  if (seconds === null) return "elapsed-idle";
  const ratio = seconds / Math.max(1, Number(limit) || 1);
  if (ratio < 0.65) return "elapsed-good";
  if (ratio < 0.8) return "elapsed-lime";
  if (ratio < 0.92) return "elapsed-amber";
  if (ratio < 1) return "elapsed-orange";
  return "elapsed-red";
}

function guardFormatElapsed(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function relativeTime(value) {
  if (!value) return "not saved yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "saved";
  const seconds = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
