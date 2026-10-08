require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");
const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const nodemailer = require("nodemailer");

const app = express();
const port = Number(process.env.PORT || 3000);
const dataDirectory = path.join(__dirname, "data");
const sessionDuration = 7 * 24 * 60 * 60 * 1000;
const adminEmail = (process.env.ADMIN_EMAIL || "erbolabdumannopovcode@gmail.com").toLowerCase();

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET kerak va kamida 32 ta belgidan iborat bo‘lishi shart.");
}

fs.mkdirSync(dataDirectory, { recursive: true });
const databasePath = path.join(dataDirectory, "portfolio.sqlite");
let db;
let statements;

function persistDatabase() {
  fs.writeFileSync(databasePath, Buffer.from(db.export()));
}

function prepare(sql) {
  return {
    get(...params) {
      const statement = db.prepare(sql);
      try {
        if (params.length) statement.bind(params);
        return statement.step() ? statement.getAsObject() : undefined;
      } finally {
        statement.free();
      }
    },
    all(...params) {
      const statement = db.prepare(sql);
      const rows = [];
      try {
        if (params.length) statement.bind(params);
        while (statement.step()) rows.push(statement.getAsObject());
        return rows;
      } finally {
        statement.free();
      }
    },
    run(...params) {
      db.run(sql, params);
      const changes = db.getRowsModified();
      const lastInsertRowid = db.exec("SELECT last_insert_rowid() AS id")[0]?.values[0][0] || 0;
      persistDatabase();
      return { changes, lastInsertRowid };
    },
  };
}

async function initializeDatabase() {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(path.dirname(require.resolve("sql.js")), file),
  });
  db = fs.existsSync(databasePath)
    ? new SQL.Database(new Uint8Array(fs.readFileSync(databasePath)))
    : new SQL.Database();
  db.run("PRAGMA foreign_keys = ON");
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    age INTEGER NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS verification_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    name TEXT,
    age INTEGER,
    mode TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    service TEXT NOT NULL,
    budget TEXT NOT NULL,
    details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Yangi',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
  persistDatabase();

  statements = {
  findUser: prepare("SELECT id, name, age, email, created_at FROM users WHERE email = ?"),
  findUserById: prepare("SELECT id, name, age, email, created_at FROM users WHERE id = ?"),
  addUser: prepare("INSERT INTO users (name, age, email) VALUES (?, ?, ?)"),
  saveCode: prepare(`
    INSERT INTO verification_codes (email, code_hash, name, age, mode, expires_at, attempts)
    VALUES (?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, name = excluded.name,
      age = excluded.age, mode = excluded.mode, expires_at = excluded.expires_at, attempts = 0
  `),
  findCode: prepare("SELECT * FROM verification_codes WHERE email = ?"),
  incrementAttempts: prepare("UPDATE verification_codes SET attempts = attempts + 1 WHERE email = ?"),
  deleteCode: prepare("DELETE FROM verification_codes WHERE email = ?"),
  saveSession: prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"),
  findSession: prepare(`
    SELECT users.id, users.name, users.age, users.email, sessions.expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `),
  deleteSession: prepare("DELETE FROM sessions WHERE token_hash = ?"),
  addOrder: prepare(`
    INSERT INTO orders (name, email, service, budget, details)
    VALUES (?, ?, ?, ?, ?)
  `),
  listOrders: prepare("SELECT id, name, email, service, budget, details, status, created_at FROM orders ORDER BY id DESC LIMIT 100"),
  updateOrder: prepare("UPDATE orders SET status = ? WHERE id = ?"),
  };
}

const sessionCookie = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: sessionDuration,
};

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
    },
  },
}));
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Juda ko‘p urinish bo‘ldi. 15 daqiqadan keyin qayta urinib ko‘ring." },
});

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function getSessionToken(req) {
  const rawCookie = req.headers.cookie || "";
  const cookie = rawCookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("portfolio_session="));
  return cookie ? decodeURIComponent(cookie.slice("portfolio_session=".length)) : "";
}

function requireUser(req, res, next) {
  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: "Davom etish uchun tizimga kiring." });

  const user = statements.findSession.get(hash(token), Date.now());
  if (!user) {
    res.clearCookie("portfolio_session", { ...sessionCookie, maxAge: undefined });
    return res.status(401).json({ error: "Sessiya tugagan. Qayta kiring." });
  }
  req.user = user;
  req.sessionToken = token;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.email.toLowerCase() !== adminEmail) {
    return res.status(403).json({ error: "Bu sahifaga kirish huquqi yo‘q." });
  }
  next();
}

function validString(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function sendEmailCode(email, code) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !MAIL_FROM) {
    throw new Error("Email yuborish sozlanmagan. SMTP sozlamalarini .env fayliga kiriting.");
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: process.env.SMTP_SECURE !== "false",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter.sendMail({
    from: MAIL_FROM,
    to: email,
    subject: "Portfolio — tasdiqlash kodi",
    text: `Tasdiqlash kodingiz: ${code}\nKod 10 daqiqa davomida amal qiladi. Uni hech kimga bermang.`,
  });
}

async function notifyTelegram(order) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error("Telegram xabari yuborilmadi: TELEGRAM_BOT_TOKEN yoki TELEGRAM_CHAT_ID sozlanmagan.");
  }

  const text = [
    "🆕 Yangi portfolio buyurtmasi",
    `👤 Ism: ${order.name}`,
    `✉️ Email: ${order.email}`,
    `🧩 Xizmat: ${order.service}`,
    `💰 Budjet: ${order.budget}`,
    `📝 Loyiha: ${order.details}`,
  ].join("\n");
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram API xatosi (${response.status}): ${JSON.stringify(result)}`);
  }
}

app.post("/api/auth/request-code", authLimiter, async (req, res) => {
  const mode = req.body.mode;
  const email = normalizeEmail(req.body.email);
  const existingUser = statements.findUser.get(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: "To‘g‘ri email manzilini kiriting." });
  }
  if (mode !== "register" && mode !== "login") {
    return res.status(400).json({ error: "Kirish turini tanlang." });
  }
  if (mode === "register") {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const age = Number(req.body.age);
    if (!validString(name, 80) || !Number.isInteger(age) || age < 13 || age > 120) {
      return res.status(400).json({ error: "Ism (1–80 belgi) va to‘g‘ri yoshni kiriting." });
    }
    if (existingUser) return res.status(409).json({ error: "Bu email allaqachon ro‘yxatdan o‘tgan. Kirish bo‘limini tanlang." });
  } else if (!existingUser) {
    return res.status(404).json({ error: "Bu email hali ro‘yxatdan o‘tmagan. Avval hisob yarating." });
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const name = mode === "register" ? req.body.name.trim() : null;
  const age = mode === "register" ? Number(req.body.age) : null;
  try {
    await sendEmailCode(email, code);
    statements.saveCode.run(email, hash(code), name, age, mode, Date.now() + 10 * 60 * 1000);
    return res.json({ message: "Tasdiqlash kodi emailingizga yuborildi." });
  } catch (error) {
    console.error("Tasdiqlash kodi yuborilmadi:", error);
    return res.status(503).json({ error: "Emailga kod yuborilmadi. SMTP sozlamalarini tekshirib, qayta urinib ko‘ring." });
  }
});

app.post("/api/auth/verify-code", authLimiter, (req, res) => {
  const email = normalizeEmail(req.body.email);
  const code = typeof req.body.code === "string" ? req.body.code.trim() : "";
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Emailga kelgan 6 xonali kodni kiriting." });

  const verification = statements.findCode.get(email);
  if (!verification || verification.expires_at < Date.now()) {
    statements.deleteCode.run(email);
    return res.status(400).json({ error: "Kod muddati tugagan yoki topilmadi. Yangi kod so‘rang." });
  }
  if (verification.attempts >= 5) {
    statements.deleteCode.run(email);
    return res.status(429).json({ error: "Kod 5 marta noto‘g‘ri kiritildi. Yangi kod so‘rang." });
  }
  if (hash(code) !== verification.code_hash) {
    statements.incrementAttempts.run(email);
    return res.status(400).json({ error: "Kod noto‘g‘ri. Qayta tekshirib kiriting." });
  }

  let user = statements.findUser.get(email);
  if (verification.mode === "register") {
    if (user) {
      statements.deleteCode.run(email);
      return res.status(409).json({ error: "Bu emailda hisob mavjud. Kirish bo‘limidan foydalaning." });
    }
    const created = statements.addUser.run(verification.name, verification.age, email);
    user = statements.findUserById.get(created.lastInsertRowid);
  }
  statements.deleteCode.run(email);

  const token = crypto.randomBytes(32).toString("hex");
  statements.saveSession.run(hash(token), user.id, Date.now() + sessionDuration);
  res.cookie("portfolio_session", token, sessionCookie);
  return res.json({ user: { name: user.name, age: user.age, email: user.email, isAdmin: user.email.toLowerCase() === adminEmail } });
});

app.get("/api/auth/me", (req, res) => {
  const token = getSessionToken(req);
  const user = token ? statements.findSession.get(hash(token), Date.now()) : null;
  if (!user) {
    if (token) res.clearCookie("portfolio_session", { ...sessionCookie, maxAge: undefined });
    return res.json({ user: null });
  }
  res.json({
    user: {
      name: user.name,
      age: user.age,
      email: user.email,
      isAdmin: user.email.toLowerCase() === adminEmail,
    },
  });
});

app.post("/api/auth/logout", requireUser, (req, res) => {
  statements.deleteSession.run(hash(req.sessionToken));
  res.clearCookie("portfolio_session", { ...sessionCookie, maxAge: undefined });
  res.json({ message: "Tizimdan chiqildi." });
});

app.post("/api/orders", async (req, res) => {
  const { name, service, budget, details } = req.body;
  const email = normalizeEmail(req.body.email);
  if (!validString(name, 80) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
    || !validString(service, 80) || !validString(budget, 50) || !validString(details, 2000)) {
    return res.status(400).json({ error: "Barcha maydonlarni to‘g‘ri to‘ldiring. Loyiha tavsifi 2000 belgidan oshmasin." });
  }
  const order = {
    name: name.trim(),
    email,
    service: service.trim(),
    budget: budget.trim(),
    details: details.trim(),
  };
  const result = statements.addOrder.run(order.name, order.email, order.service, order.budget, order.details);
  const savedOrder = { id: Number(result.lastInsertRowid), ...order };
  try {
    await notifyTelegram(savedOrder);
  } catch (error) {
    console.error("Buyurtma bazaga saqlandi, lekin Telegram xabari yuborilmadi:", error);
    return res.status(502).json({ error: "Buyurtma saqlandi, ammo Telegramga xabar yuborilmadi. Iltimos, Telegram orqali ham xabar bering." });
  }
  res.status(201).json({ message: "Buyurtmangiz yuborildi. Tez orada siz bilan bog‘lanaman." });
});

app.get("/api/admin/orders", requireUser, requireAdmin, (req, res) => {
  res.json({ orders: statements.listOrders.all() });
});

app.patch("/api/admin/orders/:id", requireUser, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const allowedStatuses = ["Yangi", "Jarayonda", "Yakunlandi"];
  if (!Number.isInteger(id) || id < 1 || !allowedStatuses.includes(req.body.status)) {
    return res.status(400).json({ error: "Buyurtma yoki holat noto‘g‘ri." });
  }
  const updated = statements.updateOrder.run(req.body.status, id);
  if (!updated.changes) return res.status(404).json({ error: "Buyurtma topilmadi." });
  res.json({ message: "Buyurtma holati yangilandi." });
});

app.use("/api", (req, res) => res.status(404).json({ error: "API manzili topilmadi." }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

initializeDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Portfolio tayyor: http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Portfolio server ishga tushmadi:", error);
    process.exitCode = 1;
  });
