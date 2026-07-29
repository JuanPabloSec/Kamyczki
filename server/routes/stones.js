const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { authRequired, optionalAuth } = require("../auth");

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, "..", "..", "public", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const safe = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
    cb(null, `${Date.now()}-${uuid().slice(0, 8)}${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error("Dozwolone są tylko obrazy (JPG, PNG, WEBP, GIF)."));
  },
});

function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let part = "";
  for (let i = 0; i < 6; i++) part += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `KAM-${part}`;
}

function uniqueCode() {
  const data = db.read();
  let code;
  do {
    code = generateCode();
  } while (data.stones.some((s) => s.code === code));
  return code;
}

function enrichStone(stone, users) {
  const owner = users.find((u) => u.id === stone.userId);
  return {
    id: stone.id,
    code: stone.code,
    name: stone.name,
    description: stone.description || "",
    imageUrl: stone.imagePath ? `/uploads/${path.basename(stone.imagePath)}` : null,
    status: stone.status,
    createdAt: stone.createdAt,
    owner: owner
      ? { id: owner.id, username: owner.username, postalCode: owner.postalCode || "" }
      : null,
  };
}

router.get("/", optionalAuth, (req, res) => {
  const data = db.read();
  const mine = req.query.mine === "1";
  let list = data.stones;

  if (mine) {
    if (!req.user) return res.status(401).json({ error: "Wymagane logowanie." });
    list = list.filter((s) => s.userId === req.user.id);
  }

  if (req.query.q) {
    const q = String(req.query.q).toLowerCase();
    list = list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.description || "").toLowerCase().includes(q)
    );
  }

  list = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ stones: list.map((s) => enrichStone(s, data.users)) });
});

router.get("/code/:code", (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  const data = db.read();
  const stone = data.stones.find((s) => s.code === code);
  if (!stone) return res.status(404).json({ error: "Nie znaleziono kamyczka o tym kodzie." });

  const spots = data.spots
    .filter((sp) => sp.stoneId === stone.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((sp) => ({
      id: sp.id,
      type: sp.type,
      lat: sp.lat,
      lng: sp.lng,
      placeName: sp.placeName,
      note: sp.note,
      createdAt: sp.createdAt,
      imageUrl: sp.imagePath ? `/uploads/${path.basename(sp.imagePath)}` : null,
      user: (() => {
        const u = data.users.find((x) => x.id === sp.userId);
        return u ? { id: u.id, username: u.username } : null;
      })(),
    }));

  res.json({ stone: enrichStone(stone, data.users), journey: spots });
});

router.get("/:id", (req, res) => {
  const data = db.read();
  const stone = data.stones.find((s) => s.id === req.params.id);
  if (!stone) return res.status(404).json({ error: "Kamyczek nie istnieje." });
  res.json({ stone: enrichStone(stone, data.users) });
});

router.post("/", authRequired, (req, res) => {
  upload.single("photo")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Błąd uploadu." });

    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();
    if (!name || name.length < 2) {
      return res.status(400).json({ error: "Podaj nazwę kamyczka (min. 2 znaki)." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Dodaj zdjęcie kamyczka." });
    }

    const stone = {
      id: uuid(),
      userId: req.user.id,
      code: uniqueCode(),
      name,
      description,
      imagePath: req.file.filename,
      status: "collection", // collection | hidden | travelling
      createdAt: new Date().toISOString(),
    };

    db.update((d) => {
      d.stones.push(stone);
    });

    const data = db.read();
    res.status(201).json({ stone: enrichStone(stone, data.users) });
  });
});

router.patch("/:id", authRequired, (req, res) => {
  const name = req.body.name != null ? String(req.body.name).trim() : undefined;
  const description = req.body.description != null ? String(req.body.description).trim() : undefined;
  const status = req.body.status != null ? String(req.body.status).trim() : undefined;

  const allowed = ["collection", "hidden", "travelling"];
  if (status && !allowed.includes(status)) {
    return res.status(400).json({ error: "Nieprawidłowy status." });
  }

  const result = db.update((d) => {
    const stone = d.stones.find((s) => s.id === req.params.id);
    if (!stone) return { error: 404 };
    if (stone.userId !== req.user.id) return { error: 403 };
    if (name !== undefined) {
      if (name.length < 2) return { error: 400, message: "Nazwa za krótka." };
      stone.name = name;
    }
    if (description !== undefined) stone.description = description;
    if (status !== undefined) stone.status = status;
    return { stone };
  });

  if (result?.error === 404) return res.status(404).json({ error: "Kamyczek nie istnieje." });
  if (result?.error === 403) return res.status(403).json({ error: "To nie Twój kamyczek." });
  if (result?.error === 400) return res.status(400).json({ error: result.message });

  const data = db.read();
  res.json({ stone: enrichStone(result.stone, data.users) });
});

router.delete("/:id", authRequired, (req, res) => {
  const result = db.update((d) => {
    const idx = d.stones.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return { error: 404 };
    if (d.stones[idx].userId !== req.user.id) return { error: 403 };
    const [removed] = d.stones.splice(idx, 1);
    // remove linked spots owned by this user only? keep journey history public — drop spots for this stone
    d.spots = d.spots.filter((sp) => sp.stoneId !== removed.id);
    return { removed };
  });

  if (result?.error === 404) return res.status(404).json({ error: "Kamyczek nie istnieje." });
  if (result?.error === 403) return res.status(403).json({ error: "To nie Twój kamyczek." });

  if (result.removed?.imagePath) {
    const p = path.join(UPLOAD_DIR, path.basename(result.removed.imagePath));
    fs.promises.unlink(p).catch(() => {});
  }

  res.json({ ok: true });
});

module.exports = router;
