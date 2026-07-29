const path = require("path");
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const stoneRoutes = require("./routes/stones");
const mapRoutes = require("./routes/map");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", authRoutes);
app.use("/api/stones", stoneRoutes);
app.use("/api/map", mapRoutes);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "Kamyczki", version: "1.0.0" });
});

const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

// SPA fallback (Express 5 path syntax)
app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(publicDir, "index.html"), (err) => {
    if (err) next();
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Błąd serwera." });
});

app.listen(PORT, () => {
  console.log(`🪨 Kamyczki działa na http://localhost:${PORT}`);
});
