const params = new URLSearchParams(window.location.search);
const token = params.get("token") || "";
const contextEl = document.getElementById("formContext");
const form = document.getElementById("externalForm");
const submitStatus = document.getElementById("submitStatus");

form.dateKey.value = new Date().toISOString().slice(0, 10);

async function init() {
  if (!token) {
    contextEl.textContent = "Missing token. Please use the email link.";
    form.classList.add("hidden");
    return;
  }

  try {
    const data = await apiRequest(`/api/form-context?token=${encodeURIComponent(token)}`, {
      method: "GET",
    });
    contextEl.textContent = `Form recipient role: ${data.role} | Patient: ${data.patientName}`;
  } catch (err) {
    contextEl.textContent = `Invalid form link: ${err.message}`;
    form.classList.add("hidden");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fd = new FormData(form);
  try {
    await apiRequest("/api/form-submit", {
      method: "POST",
      body: {
        token,
        dateKey: String(fd.get("dateKey") || ""),
        summary: String(fd.get("summary") || ""),
        plan: String(fd.get("plan") || ""),
        severity: String(fd.get("severity") || "moderate"),
      },
    });
    submitStatus.textContent = "Response submitted. This has been added to the patient timeline.";
    form.reset();
  } catch (err) {
    submitStatus.textContent = `Submit failed: ${err.message}`;
  }
});

async function apiRequest(url, options) {
  const config = {
    method: options.method,
    headers: { "Content-Type": "application/json" },
  };
  if (options.body) config.body = JSON.stringify(options.body);

  const response = await fetch(url, config);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

init();
