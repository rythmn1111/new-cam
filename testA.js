// serverA.js
// Mode A: Classic BnW look, HARD size cap via cwebp -size 100000
// Run with: sudo -E node serverA.js

const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { Gpio } = require("pigpio");

const MODE = "A (Classic • hard cap)";
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

function sh(cmd, timeout = 60000) {
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

// ---------- capture (classic look, hard ≤100 KB) ----------
async function captureClassic() {
  const out = path.join(IMAGES_DIR, `${nowStamp()}.webp`);
  const cam = fs.existsSync("/usr/bin/rpicam-still") ? "rpicam-still" : "libcamera-still";

  // rpicam-still → ImageMagick (grayscale + tone + sharpen) → PNM → cwebp (size cap)
  // tip: if scenes are very busy, you can lower 1024→960 to keep a bit more detail under 100KB.
  const cmd = `
    set -o pipefail;
    ${cam} -n -t 400 -o - \
      | convert - -strip -resize '1024x1024>' -colorspace Gray \
          -sigmoidal-contrast 3x50% -contrast-stretch 0.5%x0.5% \
          -unsharp 0x0.75+0.75+0.02 PNM:- \
      | cwebp -quiet -mt -m 6 -size 100000 -o "${out}" --
  `;

  await sh(cmd);
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
    console.log("Button PRESSED → capturing (Classic)...");
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

// JSON for the frontend to poll
app.get("/latest.json", (_req, res) => {
  const f = latest();
  if (!f) return res.json({ ok: false, mode: MODE });
  res.json({ ok: true, filename: f.name, bytes: f.bytes, mode: MODE });
});

// debug list
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
