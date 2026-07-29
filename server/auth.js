const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "kamyczki-dev-secret-change-me";
const JWT_DAYS = 30;

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    JWT_SECRET,
    { expiresIn: `${JWT_DAYS}d` }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Wymagane logowanie." });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Sesja wygasła. Zaloguj się ponownie." });
  }
}

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      req.user = null;
    }
  }
  next();
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    postalCode: user.postalCode || "",
    city: user.city || "",
    createdAt: user.createdAt,
  };
}

module.exports = { signToken, authRequired, optionalAuth, publicUser, JWT_SECRET };
