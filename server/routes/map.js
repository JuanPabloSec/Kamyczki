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
    cb(null, `spot-${Date.now()}-${uuid().slice(0, 8)}${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file) return cb(null, true);
    if (/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error("Dozwolone są tylko obrazy (JPG, PNG, WEBP, GIF)."));
  },
});

function enrichSpot(spot, data) {
  const user = data.users.find((u) => u.id === spot.userId);
  const stone = spot.stoneId ? data.stones.find((s) => s.id === spot.stoneId) : null;
  return {
    id: spot.id,
    type: spot.type,
    lat: spot.lat,
    lng: spot.lng,
    placeName: spot.placeName || "",
    note: spot.note || "",
    createdAt: spot.createdAt,
    imageUrl: spot.imagePath ? `/uploads/${path.basename(spot.imagePath)}` : null,
    user: user ? { id: user.id, username: user.username } : null,
    stone: stone
      ? {
          id: stone.id,
          code: stone.code,
          name: stone.name,
          imageUrl: stone.imagePath ? `/uploads/${path.basename(stone.imagePath)}` : null,
        }
      : null,
  };
}

/** GET /api/map/spots — public list of map points */
router.get("/spots", optionalAuth, (req, res) => {
  const data = db.read();
  let spots = [...data.spots];

  if (req.query.type === "left" || req.query.type === "found") {
    spots = spots.filter((s) => s.type === req.query.type);
  }
  if (req.query.mine === "1") {
    if (!req.user) return res.status(401).json({ error: "Wymagane logowanie." });
    spots = spots.filter((s) => s.userId === req.user.id);
  }
  if (req.query.stoneId) {
    spots = spots.filter((s) => s.stoneId === req.query.stoneId);
  }
  if (req.query.code) {
    const code = String(req.query.code).trim().toUpperCase();
    const stone = data.stones.find((s) => s.code === code);
    spots = stone ? spots.filter((s) => s.stoneId === stone.id) : [];
  }

  // bbox filter: ?north=&south=&east=&west=
  const { north, south, east, west } = req.query;
  if (north && south && east && west) {
    const n = Number(north);
    const s = Number(south);
    const e = Number(east);
    const w = Number(west);
    spots = spots.filter((sp) => sp.lat <= n && sp.lat >= s && sp.lng <= e && sp.lng >= w);
  }

  spots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ spots: spots.map((sp) => enrichSpot(sp, data)) });
});

/** POST /api/map/spots — mark left or found location */
router.post("/spots", authRequired, (req, res) => {
  upload.single("photo")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Błąd uploadu." });

    const type = String(req.body.type || "").trim();
    if (type !== "left" && type !== "found") {
      return res.status(400).json({ error: 'Typ musi być "left" (zostawiłem) lub "found" (znalazłem).' });
    }

    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: "Podaj poprawne współrzędne na mapie." });
    }

    const placeName = String(req.body.placeName || "").trim();
    const note = String(req.body.note || "").trim();
    let stoneId = req.body.stoneId ? String(req.body.stoneId).trim() : null;
    const code = req.body.code ? String(req.body.code).trim().toUpperCase() : "";

    const data = db.read();

    if (code && !stoneId) {
      const byCode = data.stones.find((s) => s.code === code);
      if (!byCode) {
        return res.status(404).json({ error: `Nie ma kamyczka z kodem ${code}.` });
      }
      stoneId = byCode.id;
    }

    if (stoneId) {
      const stone = data.stones.find((s) => s.id === stoneId);
      if (!stone) return res.status(404).json({ error: "Powiązany kamyczek nie istnieje." });
      // when leaving own stone or finding any — update status
    }

    const spot = {
      id: uuid(),
      userId: req.user.id,
      stoneId: stoneId || null,
      type,
      lat,
      lng,
      placeName,
      note,
      imagePath: req.file ? req.file.filename : null,
      createdAt: new Date().toISOString(),
    };

    db.update((d) => {
      d.spots.push(spot);
      if (stoneId) {
        const stone = d.stones.find((s) => s.id === stoneId);
        if (stone) {
          stone.status = type === "left" ? "hidden" : "travelling";
        }
      }
    });

    const fresh = db.read();
    res.status(201).json({ spot: enrichSpot(spot, fresh) });
  });
});

router.delete("/spots/:id", authRequired, (req, res) => {
  const result = db.update((d) => {
    const idx = d.spots.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return { error: 404 };
    if (d.spots[idx].userId !== req.user.id) return { error: 403 };
    const [removed] = d.spots.splice(idx, 1);
    return { removed };
  });

  if (result?.error === 404) return res.status(404).json({ error: "Punkt nie istnieje." });
  if (result?.error === 403) return res.status(403).json({ error: "To nie Twój punkt na mapie." });

  if (result.removed?.imagePath) {
    const p = path.join(UPLOAD_DIR, path.basename(result.removed.imagePath));
    fs.promises.unlink(p).catch(() => {});
  }

  res.json({ ok: true });
});

/** Recent community activity */
router.get("/feed", (_req, res) => {
  const data = db.read();
  const feed = [...data.spots]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 30)
    .map((sp) => enrichSpot(sp, data));
  res.json({ feed });
});

module.exports = router;
