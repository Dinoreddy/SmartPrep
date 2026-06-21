/**
 * Skill Normalization Utility
 *
 * Converts raw/inconsistent skill strings (from AI or user input) into
 * canonical names before they are persisted to the database.
 *
 * IMPORTANT: No canonical name may contain a "." — MongoDB uses dots as
 * nested path separators in Map keys, which corrupts the skillElo field.
 */

// Map of lowercase aliases -> canonical skill name (NO dots allowed in values)
const SKILL_MAP = {
  // JavaScript
  js: "JavaScript",
  javascript: "JavaScript",

  // TypeScript
  ts: "TypeScript",
  typescript: "TypeScript",

  // React
  react: "React",
  reactjs: "React",
  "react.js": "React",

  // React Native
  "react native": "React Native",
  reactnative: "React Native",

  // NodeJS (no dot — safe MongoDB key)
  node: "NodeJS",
  nodejs: "NodeJS",
  "node.js": "NodeJS",
  nodej: "NodeJS",

  // Express
  express: "Express",
  expressjs: "Express",
  "express.js": "Express",

  // MongoDB
  mongo: "MongoDB",
  mongodb: "MongoDB",
  "mongo db": "MongoDB",

  // C++ / C#
  cpp: "Cpp",
  "c++": "Cpp",
  "c plus plus": "Cpp",
  "c#": "CSharp",
  csharp: "CSharp",

  // AWS
  aws: "AWS",
  "amazon web services": "AWS",

  // HTML / CSS
  html: "HTML",
  html5: "HTML",
  css: "CSS",
  css3: "CSS",

  // Python ecosystem
  python: "Python",
  pytorch: "PyTorch",
  tensorflow: "TensorFlow",
  "scikit-learn": "ScikitLearn",
  sklearn: "ScikitLearn",
  numpy: "NumPy",
  pandas: "Pandas",
  opencv: "OpenCV",

  // Cloud / DevOps
  gcp: "GCP",
  "google cloud": "GCP",
  "google cloud platform": "GCP",
  docker: "Docker",
  kubernetes: "Kubernetes",
  k8s: "Kubernetes",

  // Databases
  sql: "SQL",
  postgresql: "PostgreSQL",
  postgres: "PostgreSQL",
  mysql: "MySQL",

  // Other
  git: "Git",
};

// Skills that should be explicitly ignored
const IGNORED_SKILLS = new Set([
  "vscode", "vs code", "visual studio code", "intellij", "eclipse", "pycharm", "vim",
  "figma", "adobe xd", "photoshop", "canva", "illustrator",
  "jira", "trello", "slack", "agile", "scrum", "notion",
  "flutterflow", "webflow", "bubble", "wordpress", "wix",
  "windows", "macos", "linux", "ubuntu",
  "microsoft office", "excel", "word", "powerpoint",
  "leadership", "communication", "teamwork", "time management", "problem solving"
]);

/**
 * Converts a raw skill string to its canonical form.
 * Falls back to Title Case if no mapping is found.
 * Dots are always stripped to keep MongoDB Map keys safe.
 *
 * @param {string} skill - Raw skill string (e.g. "reactjs", "Node.js")
 * @returns {string} Canonical skill name with no dots (e.g. "React", "NodeJS")
 */
export function normalizeSkill(skill) {
  if (!skill || typeof skill !== "string") return "";

  const key = skill.trim().toLowerCase();

  // Explicitly ignore garbage skills
  if (IGNORED_SKILLS.has(key)) return null;

  if (SKILL_MAP[key]) return SKILL_MAP[key];

  // Default: Title Case, then strip any remaining dots
  const titleCase = skill
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

  // Remove dots — MongoDB does not support dots in Map/object keys
  return titleCase.replace(/\./g, "");
}

/**
 * Normalizes an array of raw skill strings and removes duplicates.
 *
 * @param {string[]} skills - Array of raw skill strings
 * @returns {string[]} Deduplicated array of canonical skill names (no dots)
 */
export function normalizeSkillList(skills) {
  if (!Array.isArray(skills)) return [];

  const seen = new Set();
  const result = [];

  for (const skill of skills) {
    const normalized = normalizeSkill(skill);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}
