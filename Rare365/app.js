const MIN_BASELINE_DAYS = 5;
const BASELINE_RED_THRESHOLD = 1.5;

const conditions = {
  cah: {
    name: "Congenital Adrenal Hyperplasia",
    description: "Baseline-driven daily symptom tracking for congenital adrenal hyperplasia.",
    symptoms: [
      "Fatigue",
      "Nausea",
      "Headaches",
      "Dizziness",
      "Diarrhea",
    ],
  },
};

const flarePresets = [
  { name: "Fatigue", emoji: "😴" },
  { name: "Nausea", emoji: "🤢" },
  { name: "Headaches", emoji: "🤕" },
  { name: "Dizziness", emoji: "🌀" },
  { name: "Diarrhea", emoji: "🚽" },
];

const rolePermissions = {
  patient: "Patient app mode: full access to profile, daily logs, flare logging, and sending external forms.",
  physician:
    "Physician form mode: can submit appointment summary from emailed form link; no edits to patient profile or patient-entered logs.",
  teacher: "Teacher mode: read-only weekly support summary only.",
};

const state = {
  selectedCondition: "cah",
  entriesByDay: {},
  selectedDay: toDateKey(new Date()),
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
  selectedDetailFilter: "all",
  currentRole: "patient",
  flareSelectedSymptoms: new Set(),
};

const conditionSelect = document.getElementById("conditionSelect");
const conditionDescription = document.getElementById("conditionDescription");
const symptomChips = document.getElementById("symptomChips");
const symptomSliders = document.getElementById("symptomSliders");
const dailyLogForm = document.getElementById("dailyLogForm");
const logDateInput = document.getElementById("logDateInput");
const calendarEl = document.getElementById("calendar");
const dayDetails = document.getElementById("dayDetails");
const teacherSummary = document.getElementById("teacherSummary");
const physicianSummary = document.getElementById("physicianSummary");
const todayColor = document.getElementById("todayColor");
const todayTopSymptoms = document.getElementById("todayTopSymptoms");
const baselineStatus = document.getElementById("baselineStatus");
const quickLogBtn = document.getElementById("quickLogBtn");
const flareBtn = document.getElementById("flareBtn");
const recipientRole = document.getElementById("recipientRole");
const recipientEmail = document.getElementById("recipientEmail");
const sendExternalForm = document.getElementById("sendExternalForm");
const physicianForm = document.getElementById("physicianForm");
const emailStatus = document.getElementById("emailStatus");
const roleTabs = document.getElementById("roleTabs");
const permissionBanner = document.getElementById("permissionBanner");
const patientPanel = document.getElementById("patientPanel");
const physicianPanel = document.getElementById("physicianPanel");
const teacherPanel = document.getElementById("teacherPanel");
const flareModePanel = document.getElementById("flareModePanel");
const flareIcons = document.getElementById("flareIcons");
const flareNote = document.getElementById("flareNote");
const saveFlareQuickLog = document.getElementById("saveFlareQuickLog");
const cancelFlareMode = document.getElementById("cancelFlareMode");

function init() {
  fillConditionSelect();
  hydrateConditionUI();
  renderFlareIcons();
  setRole("patient");
  wireEvents();
  seedInitialData();
  setCalendarViewFromDateKey(state.selectedDay);
  syncLogDateInput(state.selectedDay);
  renderAll();
}

function seedInitialData() {
  const now = new Date();
  const year = now.getFullYear();
  const month = 1;
  const symptomNames = conditions[state.selectedCondition].symptoms;

  for (let day = 1; day <= 26; day += 1) {
    const isRedDay = day === 8 || day === 21;
    const isYellowDay = day % 6 === 0 || day % 9 === 0;
    const base = isRedDay ? 8.2 : isYellowDay ? 5.8 : 3.6;
    const symptomMap = {};
    symptomNames.forEach((name, idx) => {
      const variation = ((day + idx) % 3) - 1;
      const score = Math.round(base + variation * 0.6);
      symptomMap[name] = Math.max(1, Math.min(10, score));
    });

    const dateKey = toDateKey(new Date(year, month, day));
    addEntry(dateKey, {
      source: "patient",
      label: "Daily log",
      severity: severityFromAbsoluteScore(averageScore(symptomMap)),
      symptoms: symptomMap,
      notes: "Daily check-in",
      attendance: isRedDay ? "none" : isYellowDay ? "partial" : "full",
      medTaken: "Hydrocortisone",
    });
  }

  addEntry(toDateKey(new Date(year, month, 14)), {
    source: "physician",
    label: "Appointment summary",
    severity: "moderate",
    notes: "Continue symptom logging and monitor hydration/electrolytes.",
    plan: "Review CAH baseline trends in one week.",
  });

  state.selectedDay = `${year}-02-28`;
  setCalendarViewFromDateKey(state.selectedDay);
}

function wireEvents() {
  conditionSelect.addEventListener("change", () => {
    state.selectedCondition = conditionSelect.value;
    hydrateConditionUI();
    renderPhysicianSummary(buildBaselineStats());
  });

  dailyLogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const fd = new FormData(dailyLogForm);
    const symptomScores = readSymptomScores(fd);
    const scoreAvg = averageScore(symptomScores);
    const dateKey = String(fd.get("logDate") || "").trim() || state.selectedDay || toDateKey(new Date());
    const selectedMeds = fd.getAll("meds").map((m) => String(m).trim()).filter(Boolean);

    addEntry(dateKey, {
      source: "patient",
      label: "Daily log",
      severity: severityFromAbsoluteScore(scoreAvg),
      symptoms: symptomScores,
      attendance: fd.get("attendance"),
      medTaken: selectedMeds.join(", "),
      notes: String(fd.get("notes") || "").trim(),
    });

    dailyLogForm.reset();
    syncLogDateInput(dateKey);
    hydrateConditionUI();
    renderAll();
  });

  logDateInput.addEventListener("change", () => {
    const dateKey = logDateInput.value;
    if (!dateKey) return;
    state.selectedDay = dateKey;
    state.selectedDetailFilter = "all";
    setCalendarViewFromDateKey(dateKey);
    renderAll();
  });

  quickLogBtn.addEventListener("click", () => {
    setRole("patient");
    state.selectedDay = toDateKey(new Date());
    setCalendarViewFromDateKey(state.selectedDay);
    syncLogDateInput(state.selectedDay);
    dailyLogForm.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  flareBtn.addEventListener("click", () => {
    setRole("patient");
    openFlareMode();
  });

  sendExternalForm.addEventListener("click", () => {
    const role = recipientRole.value;
    const address = recipientEmail.value.trim();
    if (!address) return;
    emailStatus.textContent = `Patient sent ${role} form link to ${address}.`;
  });

  physicianForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const fd = new FormData(physicianForm);
    const date = String(fd.get("appointmentDate") || "").trim();
    if (!date) return;

    addEntry(date, {
      source: "physician",
      label: "Appointment summary",
      severity: "moderate",
      notes: String(fd.get("summary") || "").trim(),
      plan: String(fd.get("plan") || "").trim(),
    });
    physicianForm.reset();
    renderAll();
  });

  roleTabs.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const role = target.dataset.role;
    if (!role) return;
    setRole(role);
  });

  dayDetails.addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-filter]") : null;
    if (!target) return;
    const filter = target.dataset.filter;
    if (!filter) return;
    state.selectedDetailFilter = filter;
    renderSelectedDay(buildBaselineStats());
  });

  flareIcons.addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button") : null;
    if (!target) return;
    const symptom = target.dataset.symptom;
    if (!symptom) return;

    if (state.flareSelectedSymptoms.has(symptom)) {
      state.flareSelectedSymptoms.delete(symptom);
      target.classList.remove("active");
    } else {
      state.flareSelectedSymptoms.add(symptom);
      target.classList.add("active");
    }
  });

  saveFlareQuickLog.addEventListener("click", () => {
    const symptoms = {};
    state.flareSelectedSymptoms.forEach((symptom) => {
      symptoms[symptom] = 10;
    });

    const dateKey = logDateInput.value || state.selectedDay || toDateKey(new Date());
    addEntry(dateKey, {
      source: "patient",
      label: "Flare-up",
      severity: "severe",
      symptoms,
      notes: flareNote.value.trim() || "Quick flare entry from icon interface.",
    });

    closeFlareMode();
    renderAll();
  });

  cancelFlareMode.addEventListener("click", () => {
    closeFlareMode();
  });
}

function fillConditionSelect() {
  conditionSelect.innerHTML = "";
  Object.entries(conditions).forEach(([id, def]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = def.name;
    conditionSelect.appendChild(option);
  });
  conditionSelect.value = state.selectedCondition;
}

function hydrateConditionUI() {
  const def = conditions[state.selectedCondition];
  conditionDescription.textContent = def.description;
  symptomChips.innerHTML = "";
  symptomSliders.innerHTML = "";

  def.symptoms.forEach((name) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = name;
    symptomChips.appendChild(chip);

    const wrapper = document.createElement("label");
    wrapper.innerHTML = `
      ${name} (1-10)
      <div class="range-control">
        <input class="symptom-range" type="range" min="1" max="10" value="1" name="symptom:${name}" />
        <span class="range-value">1</span>
      </div>
      <div class="ticks" aria-hidden="true">
        <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>10</span>
      </div>
      <div class="range-extremes" aria-hidden="true">
        <span>1 = Not present</span>
        <span>10 = Severe</span>
      </div>
    `;
    symptomSliders.appendChild(wrapper);
  });

  bindSymptomRangeReadouts();
}

function renderFlareIcons() {
  flareIcons.innerHTML = "";
  flarePresets.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "flare-icon";
    button.dataset.symptom = preset.name;
    button.innerHTML = `<span class="emoji">${preset.emoji}</span>${preset.name}`;
    flareIcons.appendChild(button);
  });
}

function setRole(role) {
  state.currentRole = role;
  permissionBanner.textContent = rolePermissions[role] || "";
  patientPanel.classList.toggle("hidden", role !== "patient");
  physicianPanel.classList.toggle("hidden", role !== "physician");
  teacherPanel.classList.toggle("hidden", role !== "teacher");

  roleTabs.querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.role === role);
  });
}

function openFlareMode() {
  flareModePanel.classList.remove("hidden");
  flareModePanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function closeFlareMode() {
  flareModePanel.classList.add("hidden");
  flareNote.value = "";
  state.flareSelectedSymptoms.clear();
  flareIcons.querySelectorAll(".flare-icon").forEach((button) => button.classList.remove("active"));
}

function renderAll() {
  const baselineStats = buildBaselineStats();
  renderCalendar(new Date(state.viewYear, state.viewMonth, 1), baselineStats);
  renderSelectedDay(baselineStats);
  renderTeacherSummary(baselineStats);
  renderPhysicianSummary(baselineStats);
  refreshTodayCard(baselineStats);
}

function renderCalendar(date, baselineStats) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  calendarEl.innerHTML = "";

  for (let i = 0; i < firstDay; i += 1) {
    const filler = document.createElement("div");
    filler.className = "day";
    filler.style.visibility = "hidden";
    calendarEl.appendChild(filler);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = toDateKey(new Date(year, month, day));
    const entries = state.entriesByDay[dateKey] || [];
    const dayClass = classifyDay(entries, dateKey, baselineStats).level;

    const cell = document.createElement("div");
    cell.className = `day ${dayClass}`;
    if (state.selectedDay === dateKey) cell.classList.add("selected");

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(day);
    button.addEventListener("click", () => {
      state.selectedDay = dateKey;
      state.selectedDetailFilter = "all";
      setCalendarViewFromDateKey(dateKey);
      syncLogDateInput(dateKey);
      renderSelectedDay(baselineStats);
      renderCalendar(new Date(state.viewYear, state.viewMonth, 1), baselineStats);
    });

    const meta = document.createElement("div");
    meta.className = "day-meta";
    meta.textContent = entries.length ? `${entries.length} event(s)` : "No logs";

    const tags = deriveDayTags(entries);
    if (tags.length) {
      const tagWrap = document.createElement("div");
      tagWrap.className = "day-tags";
      tags.forEach((tag) => {
        const tagButton = document.createElement("button");
        tagButton.type = "button";
        tagButton.className = "day-tag";
        tagButton.textContent = detailFilterLabel(tag);
        tagButton.addEventListener("click", () => {
          state.selectedDay = dateKey;
          state.selectedDetailFilter = tag;
          setCalendarViewFromDateKey(dateKey);
          syncLogDateInput(dateKey);
          renderSelectedDay(baselineStats);
          renderCalendar(new Date(state.viewYear, state.viewMonth, 1), baselineStats);
        });
        tagWrap.appendChild(tagButton);
      });
      cell.appendChild(button);
      cell.appendChild(meta);
      cell.appendChild(tagWrap);
    } else {
      cell.appendChild(button);
      cell.appendChild(meta);
    }

    calendarEl.appendChild(cell);
  }
}

function renderSelectedDay(baselineStats) {
  const dateKey = state.selectedDay;
  const entries = state.entriesByDay[dateKey] || [];
  if (!entries.length) {
    dayDetails.innerHTML = `<p><strong>${dateKey}</strong></p><p>No entries logged.</p>`;
    return;
  }

  const status = classifyDay(entries, dateKey, baselineStats);
  const filterOptions = ["all", ...deriveDayTags(entries)];
  const filteredEntries =
    state.selectedDetailFilter === "all"
      ? entries
      : entries.filter((entry) => entryMatchesFilter(entry, state.selectedDetailFilter));

  const filterBar = `
    <div class="detail-filters">
      ${filterOptions
        .map(
          (filter) =>
            `<button type="button" data-filter="${filter}" class="${
              filter === state.selectedDetailFilter ? "active-filter" : ""
            }">${detailFilterLabel(filter)}</button>`
        )
        .join("")}
    </div>
  `;

  const baselineLine = `<p><strong>Baseline comparison:</strong> ${status.reason}</p>`;

  const chunks = filteredEntries.map((entry) => {
    const symptomString = entry.symptoms
      ? Object.entries(entry.symptoms)
          .map(([name, score]) => `${name}: ${score}/10`)
          .join(", ")
      : "No symptom scores";

    return `
      <div>
        <p><strong>${entry.label}</strong> (${entry.source})</p>
        <p>Color band: ${entry.severity || "-"}</p>
        <p>Symptoms: ${symptomString}</p>
        <p>Attendance: ${entry.attendance ?? "-"}</p>
        <p>Meds: ${entry.medTaken || "-"}</p>
        <p>Notes: ${entry.notes || "-"}</p>
        <p>Plan: ${entry.plan || "-"}</p>
      </div>
    `;
  });

  dayDetails.innerHTML = `<p><strong>${dateKey}</strong></p>${baselineLine}${filterBar}${
    chunks.length ? chunks.join("<hr />") : "<p>No entries for this filter.</p>"
  }`;
}

function renderTeacherSummary(baselineStats) {
  const lastWeekDays = recentDateKeys(7);
  const recentPatientEntries = [];
  let recentDailyLogCount = 0;
  const dayCounts = { stable: 0, moderate: 0, severe: 0 };
  const recentSymptomBucket = {};
  let flareInPastWeek = false;

  lastWeekDays.forEach((dateKey) => {
    const entries = state.entriesByDay[dateKey] || [];
    entries.forEach((entry) => {
      if (entry.source !== "patient") return;
      recentPatientEntries.push(entry);
      if (entry.label === "Daily log") recentDailyLogCount += 1;
    });
    const level = classifyDay(entries, dateKey, baselineStats).level;
    if (level === "stable" || level === "moderate" || level === "severe") dayCounts[level] += 1;
    if (entries.some((entry) => entry.label === "Flare-up")) flareInPastWeek = true;
  });

  recentDateKeys(3).forEach((dateKey) => {
    const entries = state.entriesByDay[dateKey] || [];
    entries.forEach((entry) => {
      if (entry.source !== "patient" || !entry.symptoms) return;
      Object.entries(entry.symptoms).forEach(([name, score]) => {
        if (!recentSymptomBucket[name]) recentSymptomBucket[name] = [];
        recentSymptomBucket[name].push(Number(score));
      });
    });
  });

  const topRecentSymptoms = Object.entries(recentSymptomBucket)
    .map(([name, values]) => ({ name, avg: averageScore(values) }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3)
    .map((item) => `${item.name} (${item.avg.toFixed(1)}/10)`)
    .join(", ");

  const limitedAttendance = recentPatientEntries.filter(
    (entry) => entry.attendance === "partial" || entry.attendance === "none"
  ).length;

  const suggestion = flareInPastWeek
    ? "Flare-up occurred this week; expect altered performance, schedule lighter workload, and allow extra recovery breaks."
    : dayCounts.severe >= 2
      ? "Multiple high-symptom days this week; consider reduced workload and flexibility."
      : dayCounts.moderate >= 3
        ? "Symptoms elevated on several days; use regular check-ins and short breaks."
        : "No major escalation pattern this week; continue standard support with check-ins.";

  teacherSummary.innerHTML = `
    <p>Last 7 days: ${recentDailyLogCount} patient logs</p>
    <p>Week color totals: Green ${dayCounts.stable}, Yellow ${dayCounts.moderate}, Red ${dayCounts.severe}</p>
    <p>Past few days symptom summary: ${topRecentSymptoms || "No recent symptom details."}</p>
    <p>${flareInPastWeek ? "Flare-up reported in the past week: expect altered performance." : "No flare-up reported in the past week."}</p>
    <p>Limited attendance days: ${limitedAttendance}</p>
    <p>Classroom guidance: ${suggestion}</p>
  `;
}

function renderPhysicianSummary(baselineStats) {
  const patientName = document.getElementById("patientName").value || "Patient";
  const meds = document.getElementById("medicationsInput").value || "Not listed";
  const severeDays = Object.keys(state.entriesByDay).filter((dateKey) => {
    const entries = state.entriesByDay[dateKey] || [];
    return classifyDay(entries, dateKey, baselineStats).level === "severe";
  }).length;

  const topBaselines = Object.entries(baselineStats.perSymptomBaseline)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, value]) => `${name}: ${value.toFixed(2)}/10`)
    .join("<br />");

  physicianSummary.innerHTML = `
    <p><strong>${patientName}</strong> · ${conditions[state.selectedCondition].name}</p>
    <p>Current meds: ${meds}</p>
    <p>Baseline days logged: ${baselineStats.loggedDays} (minimum ${MIN_BASELINE_DAYS})</p>
    <p>Significantly above baseline days: ${severeDays}</p>
    <p>Current symptom baseline (avg 1-10):<br />${topBaselines || "Insufficient symptom data."}</p>
  `;
}

function refreshTodayCard(baselineStats) {
  const dateKey = toDateKey(new Date());
  const entries = state.entriesByDay[dateKey] || [];
  if (!entries.length) {
    todayColor.textContent = "Status: Not logged";
    todayTopSymptoms.textContent = "Top symptoms: -";
    baselineStatus.textContent = `Baseline: ${baselineStats.loggedDays}/${MIN_BASELINE_DAYS} days collected`;
    return;
  }

  const status = classifyDay(entries, dateKey, baselineStats);
  todayColor.textContent = `Status: ${status.reason}`;

  const symptoms = {};
  entries.forEach((entry) => {
    if (!entry.symptoms) return;
    Object.entries(entry.symptoms).forEach(([name, score]) => {
      symptoms[name] = Math.max(symptoms[name] || 0, score);
    });
  });

  const top = Object.entries(symptoms)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name, score]) => `${name} (${score}/10)`)
    .join(", ");

  todayTopSymptoms.textContent = `Top symptoms: ${top || "No symptom scores"}`;
  baselineStatus.textContent = baselineStats.ready
    ? `Baseline symptom average: ${baselineStats.baselineSeverity.toFixed(2)}/10`
    : `Baseline building: ${baselineStats.loggedDays}/${MIN_BASELINE_DAYS} symptom days`;
}

function addEntry(dateKey, entry) {
  if (!state.entriesByDay[dateKey]) state.entriesByDay[dateKey] = [];
  state.entriesByDay[dateKey].push({ ...entry, dateKey });
  state.selectedDay = dateKey;
  state.selectedDetailFilter = "all";
  setCalendarViewFromDateKey(dateKey);
  syncLogDateInput(dateKey);
}

function readSymptomScores(formData) {
  const out = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("symptom:")) continue;
    out[key.replace("symptom:", "")] = Number(value);
  }
  return out;
}

function averageScore(scores) {
  const values = Array.isArray(scores) ? scores : Object.values(scores);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function severityFromAbsoluteScore(avg) {
  if (avg <= 4.2) return "stable";
  if (avg <= 7.0) return "moderate";
  return "severe";
}

function buildBaselineStats() {
  const symptomTotals = {};
  const symptomCounts = {};
  const daySeverity = [];

  Object.entries(state.entriesByDay).forEach(([dateKey, entries]) => {
    const symptomValues = extractPatientSymptomValues(entries);
    if (!symptomValues.length) return;

    const dayAvg = averageScore(symptomValues);
    daySeverity.push({ dateKey, value: dayAvg });

    entries.forEach((entry) => {
      if (entry.source !== "patient" || !entry.symptoms) return;
      Object.entries(entry.symptoms).forEach(([name, score]) => {
        symptomTotals[name] = (symptomTotals[name] || 0) + Number(score);
        symptomCounts[name] = (symptomCounts[name] || 0) + 1;
      });
    });
  });

  const perSymptomBaseline = {};
  Object.keys(symptomTotals).forEach((name) => {
    perSymptomBaseline[name] = symptomTotals[name] / symptomCounts[name];
  });

  const baselineSeverity = daySeverity.length ? averageScore(daySeverity.map((d) => d.value)) : 0;
  const perDaySeverity = Object.fromEntries(daySeverity.map((d) => [d.dateKey, d.value]));

  return {
    loggedDays: daySeverity.length,
    ready: daySeverity.length >= MIN_BASELINE_DAYS,
    baselineSeverity,
    perDaySeverity,
    perSymptomBaseline,
  };
}

function classifyDay(entries, dateKey, baselineStats) {
  const hasFlare = entries.some((entry) => entry.label === "Flare-up");
  if (hasFlare) {
    return { level: "severe", reason: "Flare-up reported: immediately flagged red." };
  }

  const symptomValues = extractPatientSymptomValues(entries);
  if (!symptomValues.length) {
    return { level: "", reason: "No patient symptom scores for this day." };
  }

  const dayAvg = averageScore(symptomValues);

  if (!baselineStats.ready) {
    const provisional = severityFromAbsoluteScore(dayAvg);
    const reason = `Baseline building (${baselineStats.loggedDays}/${MIN_BASELINE_DAYS}). Provisional score: ${dayAvg.toFixed(
      2
    )}/10`;
    return { level: provisional, reason };
  }

  const delta = dayAvg - baselineStats.baselineSeverity;
  if (delta <= 0) {
    return { level: "stable", reason: `Low / at baseline (delta ${delta.toFixed(2)})` };
  }
  if (delta < BASELINE_RED_THRESHOLD) {
    return { level: "moderate", reason: `Above baseline (delta +${delta.toFixed(2)})` };
  }
  return { level: "severe", reason: `Significantly above baseline (delta +${delta.toFixed(2)})` };
}

function extractPatientSymptomValues(entries) {
  const values = [];
  entries.forEach((entry) => {
    if (entry.source !== "patient" || !entry.symptoms) return;
    Object.values(entry.symptoms).forEach((score) => values.push(Number(score)));
  });
  return values;
}

function recentEntries(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffKey = toDateKey(cutoff);
  const list = [];

  Object.entries(state.entriesByDay).forEach(([dateKey, entries]) => {
    if (dateKey >= cutoffKey) list.push(...entries);
  });

  return list.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function recentDateKeys(days) {
  const keys = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    keys.push(toDateKey(d));
  }
  return keys;
}

function deriveDayTags(entries) {
  return [...new Set(entries.map(entryToFilterTag))];
}

function entryToFilterTag(entry) {
  if (entry.source === "physician") return "physician";
  if (entry.label === "Flare-up") return "flare";
  return "patient";
}

function detailFilterLabel(filter) {
  if (filter === "all") return "All";
  if (filter === "patient") return "Patient logs";
  if (filter === "flare") return "Flare events";
  if (filter === "physician") return "Physician forms";
  return filter;
}

function entryMatchesFilter(entry, filter) {
  return entryToFilterTag(entry) === filter;
}

function syncLogDateInput(dateKey) {
  if (logDateInput) logDateInput.value = dateKey;
}

function setCalendarViewFromDateKey(dateKey) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return;
  state.viewYear = parsed.getFullYear();
  state.viewMonth = parsed.getMonth();
}

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

function bindSymptomRangeReadouts() {
  symptomSliders.querySelectorAll(".range-control").forEach((control) => {
    const input = control.querySelector("input[type='range']");
    const valueEl = control.querySelector(".range-value");
    if (!input || !valueEl) return;
    valueEl.textContent = input.value;
    input.addEventListener("input", () => {
      valueEl.textContent = input.value;
    });
  });
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function offsetDateKey(base, offset) {
  const d = new Date(base);
  d.setDate(d.getDate() + offset);
  return toDateKey(d);
}

init();
