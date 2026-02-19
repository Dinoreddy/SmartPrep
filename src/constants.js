export const DB_NAME = "SmartPrep";

// Converts JWT expiry strings like "15m", "7d", "10s" → milliseconds for cookie maxAge
const parseExpiry = (str = "15m") => {
  const units = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 };
  const [, n, unit] = String(str).match(/^(\d+)([smhd])$/) || [];
  return n ? Number(n) * units[unit] : 15 * 6e4;
};

// Base options shared by all auth cookies
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
};

// Access token cookie — expires with the token
export const ACCESS_COOKIE_OPTIONS = {
  ...COOKIE_OPTIONS,
  maxAge: parseExpiry(process.env.ACCESS_TOKEN_EXPIRY),
};

// Refresh token cookie — long-lived
export const REFRESH_COOKIE_OPTIONS = {
  ...COOKIE_OPTIONS,
  maxAge: parseExpiry(process.env.REFRESH_TOKEN_EXPIRY),
};

// Core skills for AI generation
export const CORE_SKILLS = [
  "Data Structures",
  "Algorithms",
  "Design Patterns",
  "System Design",
  "REST APIs",
  "Web Security",
  "Git",
  "Agile Methodologies",
  "Software Testing",
  "CI/CD"
];