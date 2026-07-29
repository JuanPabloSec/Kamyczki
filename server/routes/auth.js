const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { signToken, authRequired, publicUser } = require("../auth");

const router = express.Router();

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validateRegister({ username, email, password }) {
  const errors = [];
  if (!username || username.trim().length < 3) {
    errors.push("Nazwa użytkownika musi mieć min. 3 znaki.");
  }
  if (!/^[a-zA-Z0-9_ąćęłńóśźżĄĆĘŁŃÓŚŹŻ\-]+$/u.test(username || "")) {
    errors.push("Nazwa użytkownika może zawierać litery, cyfry, _ i -.");
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Podaj poprawny e-mail.");
  }
  if (!password || password.length < 6) {
    errors.push("Hasło musi mieć min. 6 znaków.");
  }
  return errors;
}

router.post("/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  const postalCode = String(req.body.postalCode || "").trim();
  const city = String(req.body.city || "").trim();

  const errors = validateRegister({ username, email, password });
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const data = db.read();
  if (data.users.some((u) => u.email === email)) {
    return res.status(409).json({ error: "Ten e-mail jest już zajęty." });
  }
  if (data.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "Ta nazwa użytkownika jest już zajęta." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: uuid(),
    username,
    email,
    passwordHash,
    postalCode,
    city,
    createdAt: new Date().toISOString(),
  };

  db.update((d) => {
    d.users.push(user);
  });

  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

router.post("/login", async (req, res) => {
  const login = String(req.body.login || req.body.email || "").trim();
  const password = String(req.body.password || "");

  if (!login || !password) {
    return res.status(400).json({ error: "Podaj login i hasło." });
  }

  const data = db.read();
  const user = data.users.find(
    (u) =>
      u.email === normalizeEmail(login) ||
      u.username.toLowerCase() === login.toLowerCase()
  );

  if (!user) {
    return res.status(401).json({ error: "Nieprawidłowy login lub hasło." });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Nieprawidłowy login lub hasło." });
  }

  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get("/me", authRequired, (req, res) => {
  const data = db.read();
  const user = data.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "Użytkownik nie istnieje." });
  res.json({ user: publicUser(user) });
});

router.patch("/me", authRequired, (req, res) => {
  const postalCode = req.body.postalCode != null ? String(req.body.postalCode).trim() : undefined;
  const city = req.body.city != null ? String(req.body.city).trim() : undefined;

  const user = db.update((d) => {
    const u = d.users.find((x) => x.id === req.user.id);
    if (!u) return null;
    if (postalCode !== undefined) u.postalCode = postalCode;
    if (city !== undefined) u.city = city;
    return u;
  });

  if (!user) return res.status(404).json({ error: "Użytkownik nie istnieje." });
  res.json({ user: publicUser(user) });
});

module.exports = router;
