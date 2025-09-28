// serverA.js (FAST)
// Classic BnW look, HARD size cap via cwebp -size 100000
// Optimized for speed on Pi Zero 2 W: downsized capture + light processing
// Run with: sudo -E node serverA.js

const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { Gpio } = require("pigpio");

const MODE = "A (Classic • hard cap • FAST)";
const PORT = 3000;
const ROOT = __dirname;
const IMAGES_DIR = path.join(ROOT, "images");
const PUBLIC_DIR = path.join(ROOT, "public");
fs.mkdirSync(IMAGES_DIR, { recursive: true });

const BUTTON_GPIO = 13; // your working button pin (BCM numbering)

// ---------- helpers ----------
function nowStamp() {
  const d = new Date(), z = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
}

function sh(cmd, timeout = 30000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout, shell: "/bin/bash" }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(String(stderr || err.message || "exec failed"));
        e.stderr = String(stderr || "");
        return reject(e);
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function listImages() {
  return fs.readdirSync(IMAGES_DIR)
    .filter(f => [".webp",".jpg",".jpeg",".png"].includes(path.extname(f).toLowerCase()))
    .map(f => {
      const full = path.join(IMAGES_DIR, f);
      const st = fs.statSync(full);
      return { name: f, time: st.mtimeMs, bytes: st.size };
    })
    .sort((a,b)=> b.time - a.time);
}

function latest() {
  const files = listImages();
  return files.length ? files[0] : null;
}

// ---------- capture (FAST: downsized JPEG -> light BnW -> cwebp ≤100KB) ----------
async function captureClassic() {
  const out = path.join(IMAGES_DIR, `${nowStamp()}.webp`);
  const cam = fs.existsSync("/usr/bin/rpicam-still") ? "rpicam-still" : "libcamera-still";

  // SPEED WINS:
  // - ask the camera for ~1MP directly (1024x768)
  // - emit JPEG (fast)
  // - convert: grayscale + mild tonal shaping (cheap at 1MP)
  // - cwebp size cap to 100KB
  //
  // If you want a little more detail (but maybe a hair slower), bump width/height to 1280x960.
  const WIDTH = 1024;
  const HEIGHT = 768;

  const cmd = `
    set -o pipefail;
    ${cam} -n -t 200 --width ${WIDTH} --height ${HEIGHT} -e jpg -o - \
      | convert - -strip -colorspace Gray \
          -sigmoidal-contrast 3x50% -contrast-stretch 0.5%x0.5% \
          -resize '1024x1024>' JPEG:- \
      | cwebp -quiet -mt -m 5 -size 100000 - -o "${out}"
  `;

  await sh(cmd, 45000);
  return out;
}

// ---------- button ----------
const btn = new Gpio(BUTTON_GPIO, { mode: Gpio.INPUT, pullUpDown: Gpio.PUD_UP });
btn.glitchFilter(10000);
btn.enableAlert();

let isBusy = false;
console.log(`Mode ${MODE}. Ready. Press button on GPIO ${BUTTON_GPIO} to capture.`);

btn.on("alert", async (level) => {
  if (level !== 0) return;     // falling edge = press (active-low)
  if (isBusy) return;
  isBusy = true;
  try {
    console.log("Button PRESSED → capturing (FAST Classic)...");
    const file = await captureClassic();
    const bytes = fs.statSync(file).size;
    console.log(`Saved: ${file}  ${(bytes/1024).toFixed(1)} KB`);
  } catch (e) {
    console.error("Capture failed:", e.stderr || e.message || e);
  } finally {
    isBusy = false;
  }
});

// ---------- web ----------
const app = express();
app.use(express.static(PUBLIC_DIR));
app.use("/images", express.static(IMAGES_DIR));

app.get("/latest.json", (_req, res) => {
  const f = latest();
  if (!f) return res.json({ ok: false, mode: MODE });
  res.json({ ok: true, filename: f.name, bytes: f.bytes, mode: MODE });
});

app.get("/debug", (_req,res) => {
  const files = listImages();
  res.type("text/plain").send(
    [`MODE: ${MODE}`, `IMAGES_DIR: ${IMAGES_DIR}`, `COUNT: ${files.length}`,
     ...files.map(x => `${new Date(x.time).toISOString()}  ${(x.bytes/1024).toFixed(1)} KB  ${x.name}`)].join("\n")
  );
});

app.listen(PORT, () => {
  console.log(`Web: http://raspberrypi.local:${PORT}  (serving ${PUBLIC_DIR})`);
});

// ---------- cleanup ----------
process.on("SIGINT", () => {
  try { btn.disableAlert(); } catch {}
  console.log("\nBye.");
  process.exit(0);
});
