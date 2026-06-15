// Builds the Chrome Web Store upload ZIP from the shippable extension files
// only — manifest.json, src/, and icons/ — leaving out dev-only stuff (.git,
// scripts/, docs/, README, etc.). Run before uploading a new version:
//
//   node scripts/package.js
//
// Output: dist/retro-web-<version>.zip  (version read from manifest.json).
// Requires the `zip` command (preinstalled on macOS and most Linux).

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

// Exactly what the extension loads at runtime. Keep in sync with manifest.json.
const INCLUDE = ["manifest.json", "src", "icons"];

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const version = manifest.version;

const distDir = path.join(root, "dist");
fs.mkdirSync(distDir, { recursive: true });

const outName = `retro-web-${version}.zip`;
const outPath = path.join(distDir, outName);
fs.rmSync(outPath, { force: true });

for (const entry of INCLUDE) {
  if (!fs.existsSync(path.join(root, entry))) {
    console.error(`missing expected entry: ${entry}`);
    process.exit(1);
  }
}

// -r recurse, -X strip extra macOS attributes, exclude .DS_Store noise.
execFileSync("zip", ["-r", "-X", outPath, ...INCLUDE, "-x", "*.DS_Store"], {
  cwd: root,
  stdio: "inherit",
});

const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`\nwrote dist/${outName} (${kb} KB)`);
console.log("Upload this file in the Chrome Web Store Developer Dashboard.");
