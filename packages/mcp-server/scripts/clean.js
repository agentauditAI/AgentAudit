// Removes dist/ so a build never ships stale files
const fs = require("fs");
const path = require("path");

fs.rmSync(path.join(__dirname, "..", "dist"), { recursive: true, force: true });
