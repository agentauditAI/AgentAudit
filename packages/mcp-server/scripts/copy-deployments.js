// The server reads deployments/phase7-<network>.json relative to its own
// directory (src/../deployments), so ship them at dist/deployments.
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "..", "..", "deployments");
const out = path.join(__dirname, "..", "dist", "deployments");
fs.mkdirSync(out, { recursive: true });

const files = fs.readdirSync(src).filter((f) => /^phase7-.*\.json$/.test(f));
if (files.length !== 5) throw new Error(`expected 5 phase7 deployment files, found ${files.length}`);
for (const f of files) fs.copyFileSync(path.join(src, f), path.join(out, f));
console.log(`copied ${files.length} deployment files to dist/deployments`);
