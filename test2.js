// button_cam_web.js
// Run with: sudo -E node button_cam_web.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { Gpio } = require("pigpio");

const PORT = 3000;
const ROOT = __dirname;
const IMAGES_DIR = path.join(ROOT, "images");
fs.mkdirSync(IMAGES_DIR, { recursive: true });

// ---- helper: timestamp filename ----
function nowStamp() {
  const d = new Date();
  const z = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
}

// ---- helper: run a shell pipeline with proper failure on either side ----
function sh(cmd, timeout = 45000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout, shell: "/bin/bash" }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(String(stderr || err.message || "exec failed"));
        e.stderr = String(stderr || "");
        e.cause = err;
        return reject(e);
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

// ---- capture: rpicam-still -> convert -> grayscale JPG ----
async function captureBnW() {
  const out = path.join(IMAGES_DIR, `${nowStamp()}.jpg`);
  const cam = fs.existsSync("/usr/bin/rpicam-still") ? "rpicam-still" : "libcamera-still";
  const cmd = `
    set -o pipefail;
    ${cam} -n -t 400 -o - \
      | convert - -resize '1024x1024>' -colorspace Gray -auto-level \
        -contrast-stretch 0.5%x0.5% -quality 90 "${out}"
  `;
  await sh(cmd);
  return out;
}

// ---- newest file helper ----
function getLatestImage() {
  const exts = new Set([".jpg", ".jpeg", ".webp", ".png"]);
  const files = fs.readdirSync(IMAGES_DIR)
    .filter(f => exts.has(path.extname(f).toLowerCase()))
    .map(f => ({ name: f, time: fs.statSync(path.join(IMAGES_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  return files.length ? files[0].name : null;
}

// ---- BUTTON (BCM 13 = your “DOWN” button) ----
const BUTTON_GPIO = 13;
const btn = new Gpio(BUTTON_GPIO, { mode: Gpio.INPUT, pullUpDown: Gpio.PUD_UP });
btn.glitchFilter(10000);
btn.enableAlert();

let isBusy = false;
console.log(`Ready. Press button on GPIO ${BUTTON_GPIO} to capture.`);

btn.on("alert", async (level) => {
  if (level !== 0) return; // falling edge = pressed (active-low)
  if (isBusy) { console.log("Busy, ignoring press"); return; }
  isBusy = true;
  try {
    console.log("Button PRESSED -> capturing...");
    const file = await captureBnW();
    console.log("Saved:", file);
  } catch (e) {
    console.error("Capture failed:", e.stderr || e.message || e);
  } finally {
    isBusy = false;
  }
});

// ---- WEB SERVER ----
const app = express();
app.use("/images", express.static(IMAGES_DIR));

app.get("/latest.json", (_req, res) => {
  const latest = getLatestImage();
  if (!latest) return res.json({ ok: false });
  res.json({ ok: true, filename: latest });
});

app.get("/", (_req, res) => {
  // No meta refresh. JS polls /latest.json and only swaps the image if it changed.
  res.send(`<!doctype html>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Latest Pi Photo</title>
  <style>
    body{background:#111;color:#eee;font-family:sans-serif;text-align:center;padding:16px}
    img{max-width:90%;border:4px solid #eee;margin-top:20px}
    .muted{opacity:.7}
  </style>
  <h1>Latest BnW Photo</h1>
  <img id="photo" src="" alt="No photo yet" />
  <p id="filename" class="muted"></p>

  <script>
    let last = null;
    async function refreshOnce(){
      try{
        const res = await fetch('/latest.json', { cache: 'no-store' });
        const data = await res.json();
        if (data.ok && data.filename) {
          if (data.filename !== last) {
            last = data.filename;
            const img = document.getElementById('photo');
            img.src = '/images/' + encodeURIComponent(last) + '?ts=' + Date.now();
            document.getElementById('filename').textContent = last;
          }
        } else {
          document.getElementById('filename').textContent = 'No photos yet!';
        }
      }catch(e){ console.error(e); }
    }
    // initial load + poll every 2s
    refreshOnce();
    setInterval(refreshOnce, 2000);
  </script>
  `);
});

app.listen(PORT, () => {
  console.log(`Web page: http://raspberrypi.local:${PORT}`);
});

// ---- Cleanup ----
process.on("SIGINT", () => {
  try { btn.disableAlert(); } catch {}
  console.log("\\nBye.");
  process.exit(0);
});
