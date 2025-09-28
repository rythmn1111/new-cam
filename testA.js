// testA.js
// Run: sudo -E node testA.js
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const IMAGES_DIR = path.join(__dirname, "images");
fs.mkdirSync(IMAGES_DIR, { recursive: true });

function nowStamp() {
  const d = new Date(), z = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
}

function sh(cmd, timeout = 60000) {
  return new Promise((res, rej) => {
    exec(cmd, { timeout, shell: "/bin/bash" }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(String(stderr || err.message || "exec failed"));
        e.stderr = String(stderr || "");
        return rej(e);
      }
      res({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

(async () => {
  try {
    const out = path.join(IMAGES_DIR, `${nowStamp()}.webp`);
    const cam = fs.existsSync("/usr/bin/rpicam-still") ? "rpicam-still" : "libcamera-still";

    // Classic BnW pipeline, longest side 1024, capped at 100 KB
    const cmd = `
      set -o pipefail;
      ${cam} -n -t 400 -o - \
        | convert - -resize '1024x1024>' -colorspace Gray \
            -sigmoidal-contrast 3x50% -contrast-stretch 0.5%x0.5% \
            -unsharp 0x0.75+0.75+0.02 \
            -define webp:method=6 -define webp:target-size=100000 "${out}"
    `;

    console.log("Capturing (Classic, hard 100 KB cap)...");
    await sh(cmd);
    const bytes = fs.statSync(out).size;
    console.log(`Saved: ${out}  (${(bytes/1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error("testA failed:", e.stderr || e.message || e);
  }
})();
