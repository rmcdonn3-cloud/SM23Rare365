const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    const now = new Date();
    const d1 = new Date(now);
    d1.setDate(d1.getDate() - 2);
    const d2 = new Date(now);
    d2.setDate(d2.getDate() - 1);
    const seed = {
      entries: [
        {
          dateKey: toDateKey(d1),
          source: "patient",
          label: "Daily log",
          severity: "stable",
          symptoms: { Fatigue: 2, Headache: 1 },
          notes: "Seed entry",
          sleep: 4,
          attendance: "full",
          medTaken: "Medication A",
        },
        {
          dateKey: toDateKey(d2),
          source: "physician",
          label: "Appointment summary",
          severity: "moderate",
          notes: "Seed physician summary",
          plan: "Continue tracking symptoms daily.",
        },
      ],
      forms: {},
    };
    fs.writeFileSync(STORE_FILE, JSON.stringify(seed, null, 2));
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
}

function writeStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendViaResend({ to, subject, html }) {
  return new Promise((resolve, reject) => {
    if (!RESEND_API_KEY || !FROM_EMAIL) {
      reject(new Error("Missing RESEND_API_KEY or FROM_EMAIL env var."));
      return;
    }

    const payload = JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject,
      html,
    });

    const req = https.request(
      {
        hostname: "api.resend.com",
        path: "/emails",
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Resend error (${res.statusCode}): ${body}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function handleApi(req, res, urlObj) {
  if (req.method === "GET" && urlObj.pathname === "/api/entries") {
    const store = readStore();
    return json(res, 200, { entries: store.entries });
  }

  if (req.method === "POST" && urlObj.pathname === "/api/entries") {
    try {
      const body = await parseBody(req);
      if (!body.dateKey || !body.label || !body.source || !body.severity) {
        return json(res, 400, { error: "Missing required entry fields." });
      }
      const store = readStore();
      store.entries.push(body);
      writeStore(store);
      return json(res, 201, { ok: true });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (req.method === "POST" && urlObj.pathname === "/api/send-form-link") {
    try {
      const body = await parseBody(req);
      const email = String(body.email || "").trim();
      const role = String(body.role || "").trim();
      const patientName = String(body.patientName || "Patient").trim();
      if (!email || !role) return json(res, 400, { error: "Missing email or role." });

      const token = crypto.randomBytes(16).toString("hex");
      const formUrl = `${BASE_URL}/external-form.html?token=${encodeURIComponent(token)}`;

      const store = readStore();
      store.forms[token] = {
        token,
        role,
        email,
        patientName,
        createdAt: new Date().toISOString(),
        submittedAt: null,
      };
      writeStore(store);

      await sendViaResend({
        to: email,
        subject: `Rare360 ${role} Form for ${patientName}`,
        html: `
          <p>Hello,</p>
          <p>${patientName} has shared a Rare360 form for you to complete.</p>
          <p><a href="${formUrl}">Open secure form</a></p>
          <p>If the link does not open, copy this URL: ${formUrl}</p>
        `,
      });

      return json(res, 200, { ok: true, formUrl });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (req.method === "GET" && urlObj.pathname === "/api/form-context") {
    const token = String(urlObj.searchParams.get("token") || "");
    if (!token) return json(res, 400, { error: "Missing token." });
    const store = readStore();
    const form = store.forms[token];
    if (!form) return json(res, 404, { error: "Invalid token." });
    return json(res, 200, { role: form.role, patientName: form.patientName });
  }

  if (req.method === "POST" && urlObj.pathname === "/api/form-submit") {
    try {
      const body = await parseBody(req);
      const token = String(body.token || "").trim();
      const dateKey = String(body.dateKey || "").trim() || toDateKey(new Date());
      if (!token) return json(res, 400, { error: "Missing token." });

      const store = readStore();
      const form = store.forms[token];
      if (!form) return json(res, 404, { error: "Invalid token." });

      const roleLower = form.role.toLowerCase();
      const isPhysician = roleLower.includes("physician") || roleLower.includes("doctor");

      const entry = {
        dateKey,
        source: isPhysician ? "physician" : "external",
        label: isPhysician ? "Appointment summary" : `${form.role} form response`,
        severity: String(body.severity || "moderate"),
        notes: String(body.summary || "").trim(),
        plan: String(body.plan || "").trim(),
      };

      store.entries.push(entry);
      store.forms[token].submittedAt = new Date().toISOString();
      writeStore(store);

      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  return json(res, 404, { error: "Not found" });
}

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, requested);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  if (urlObj.pathname.startsWith("/api/")) {
    await handleApi(req, res, urlObj);
    return;
  }
  serveStatic(res, urlObj.pathname);
});

ensureStore();
server.listen(PORT, () => {
  console.log(`Rare360 server running on ${BASE_URL}`);
});
