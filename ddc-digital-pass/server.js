const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const Database = require("better-sqlite3");
const QRCode = require("qrcode");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");
const VALID_UNTIL = process.env.VALID_UNTIL || "2026-11-30";
const OFFER_TITLE = process.env.OFFER_TITLE || "A complimentary treat";
const OFFER_DESCRIPTION = process.env.OFFER_DESCRIPTION || "Enjoy a complimentary item on us at The Daily Drip Cafe. Please confirm the eligible item with our team.";
const CAFE_ADDRESS = process.env.CAFE_ADDRESS || "The Daily Drip Cafe";
const DB_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DB_DIR, { recursive: true });

if (!ADMIN_PASSWORD || !SESSION_SECRET || !BASE_URL) {
  console.warn("Set ADMIN_PASSWORD, SESSION_SECRET and BASE_URL before production use.");
}
const db = new Database(path.join(DB_DIR, "ddc.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  token TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL,
  redeemed_at TEXT,
  redeemed_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pass_per_phone ON passes(phone);
`);

const SQLiteStore = SQLiteStoreFactory(session);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: DB_DIR }),
  secret: SESSION_SECRET || "development-only-change-this",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
}));

function cleanPhone(value) {
  return String(value || "").replace(/[^\d+]/g, "").slice(0, 16);
}
function makeCode() {
  return "DDC-" + crypto.randomBytes(4).toString("hex").toUpperCase().match(/.{1,4}/g).join("-");
}
function adminOnly(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect("/staff/login");
}
function passUrl(req, token) {
  return `${BASE_URL || `${req.protocol}://${req.get("host")}`}/pass/${token}`;
}

app.get("/", (req, res) => res.render("home", { validUntil: VALID_UNTIL }));
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/claim", (req, res) => {
  res.render("claim", { error: null, validUntil: VALID_UNTIL });
});
app.post("/claim", (req, res) => {
  const name = String(req.body.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const phone = cleanPhone(req.body.phone);
  if (name.length < 2 || phone.replace(/\D/g, "").length < 10) {
    return res.status(400).render("claim", { error: "Please enter your name and a valid mobile number.", validUntil: VALID_UNTIL });
  }
  const existing = db.prepare("SELECT token FROM passes WHERE phone = ?").get(phone);
  if (existing) return res.redirect(`/pass/${existing.token}`);

  const code = makeCode();
  const token = crypto.randomBytes(24).toString("hex");
  try {
    db.prepare("INSERT INTO passes (code, token, name, phone, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(code, token, name, phone, new Date().toISOString());
  } catch (e) {
    const duplicate = db.prepare("SELECT token FROM passes WHERE phone = ?").get(phone);
    if (duplicate) return res.redirect(`/pass/${duplicate.token}`);
    throw e;
  }
  res.redirect(`/pass/${token}`);
});

app.get("/pass/:token", async (req, res) => {
  const pass = db.prepare("SELECT * FROM passes WHERE token = ?").get(req.params.token);
  if (!pass) return res.status(404).render("message", { title: "Pass not found", message: "This pass link may be incorrect." });
  const url = passUrl(req, pass.token);
  const qr = await QRCode.toDataURL(url, { width: 420, margin: 1, errorCorrectionLevel: "M", color: { dark: "#171717", light: "#FFFFFF" } });
  res.render("pass", {
    pass, qr, url, validUntil: VALID_UNTIL, offerTitle: OFFER_TITLE,
    offerDescription: OFFER_DESCRIPTION, cafeAddress: CAFE_ADDRESS
  });
});

app.get("/staff/login", (req, res) => res.render("login", { error: null }));
app.post("/staff/login", (req, res) => {
  const supplied = Buffer.from(String(req.body.password || ""));
  const expected = Buffer.from(String(ADMIN_PASSWORD || ""));
  const passwordMatches = expected.length > 0 && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  if (!passwordMatches) {
    return res.status(401).render("login", { error: "Incorrect staff password." });
  }
  req.session.isAdmin = true;
  req.session.staffName = String(req.body.staffName || "DDC Staff").trim().slice(0, 50) || "DDC Staff";
  res.redirect("/staff");
});
app.post("/staff/logout", adminOnly, (req, res) => req.session.destroy(() => res.redirect("/staff/login")));

app.get("/staff", adminOnly, (req, res) => {
  const stats = {
    total: db.prepare("SELECT COUNT(*) AS n FROM passes").get().n,
    redeemed: db.prepare("SELECT COUNT(*) AS n FROM passes WHERE redeemed_at IS NOT NULL").get().n,
    active: db.prepare("SELECT COUNT(*) AS n FROM passes WHERE redeemed_at IS NULL").get().n
  };
  const passes = db.prepare("SELECT code, name, phone, created_at, redeemed_at, redeemed_by FROM passes ORDER BY id DESC LIMIT 100").all();
  res.render("dashboard", { stats, passes, staffName: req.session.staffName || "DDC Staff", validUntil: VALID_UNTIL });
});
app.post("/staff/verify", adminOnly, (req, res) => {
  const raw = String(req.body.code || "").trim().toUpperCase();
  const pass = db.prepare("SELECT * FROM passes WHERE code = ? OR token = ?").get(raw, raw);
  if (!pass) return res.status(404).json({ ok: false, status: "not_found", message: "No matching pass found." });
  if (pass.redeemed_at) return res.json({ ok: true, status: "redeemed", message: "This pass has already been redeemed.", pass: { code: pass.code, name: pass.name, redeemedAt: pass.redeemed_at, redeemedBy: pass.redeemed_by } });
  if (new Date().toISOString().slice(0, 10) > VALID_UNTIL) return res.json({ ok: true, status: "expired", message: "This pass has expired.", pass: { code: pass.code, name: pass.name } });
  return res.json({ ok: true, status: "active", message: "Valid and unused pass.", pass: { code: pass.code, name: pass.name, phone: pass.phone } });
});
app.post("/staff/redeem", adminOnly, (req, res) => {
  const raw = String(req.body.code || "").trim().toUpperCase();
  const pass = db.prepare("SELECT * FROM passes WHERE code = ? OR token = ?").get(raw, raw);
  if (!pass) return res.status(404).json({ ok: false, message: "Pass not found." });
  if (pass.redeemed_at) return res.status(409).json({ ok: false, message: "Already redeemed.", status: "redeemed" });
  if (new Date().toISOString().slice(0, 10) > VALID_UNTIL) return res.status(410).json({ ok: false, message: "This pass has expired." });
  const now = new Date().toISOString();
  const result = db.prepare("UPDATE passes SET redeemed_at = ?, redeemed_by = ? WHERE id = ? AND redeemed_at IS NULL")
    .run(now, req.session.staffName || "DDC Staff", pass.id);
  if (result.changes !== 1) return res.status(409).json({ ok: false, message: "This pass was just redeemed by another staff member." });
  res.json({ ok: true, message: "Pass successfully redeemed.", redeemedAt: now });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send("Something went wrong. Please try again.");
});
app.listen(PORT, () => console.log(`DDC Digital Pass running on port ${PORT}`));
