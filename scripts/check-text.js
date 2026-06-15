// Guards against stray NUL / control bytes sneaking into tracked source files
// (e.g. an editor or scripted edit writing a literal 0x00 instead of a " "
// escape). Such bytes make git treat the file as binary and can corrupt source
// silently. Runs in CI; also runnable locally: node scripts/check-text.js
//
// Allowed control characters: TAB (0x09), LF (0x0a), CR (0x0d). Everything else
// below 0x20, plus DEL (0x7f), is rejected. Image/binary assets are skipped.

const fs = require("fs");
const cp = require("child_process");

const BINARY_EXT = /\.(png|ico|jpe?g|gif|webp|woff2?|ttf|otf|eot|zip|gz|pdf)$/i;
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

const files = cp
  .execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !BINARY_EXT.test(f));

let failures = 0;
for (const file of files) {
  const data = fs.readFileSync(file);
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if ((c < 0x20 && !ALLOWED.has(c)) || c === 0x7f) {
      console.error(`${file}: control byte 0x${c.toString(16).padStart(2, "0")} at offset ${i}`);
      failures++;
      break; // one report per file is enough
    }
  }
}

if (failures) {
  console.error(`\nFAIL: ${failures} file(s) contain stray control bytes.`);
  process.exit(1);
}
console.log(`OK: ${files.length} tracked text file(s) are clean.`);
