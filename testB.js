// serverB.js
// Run with: sudo -E node serverB.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const { Gpio } = require("pigpio");

const MODE = "B (Film-ish • adaptive ≤100 KB)";
const PORT = 3000;
const ROOT = __dirname;
const IMAGES_DIR = path.join(ROOT, "images");
const PUBLIC_DIR = path.join(ROOT, "public");
fs.mkdirSync(IMAGES_DIR, { recursive: true });

const BUTTON_GPIO = 13;

function nowStamp() {
  const d = new Date(), z = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
}
function sh(cmd, timeout = 90000) {
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

const TARGET = 100_000;              // ≤ 100 KB
const QUALS  = [85, 80, 75, 70, 65]; // quality steps
const SIZES  = [960, 900, 840];      // fallback resizes

async function captureFilmish() {
  const cam = fs.existsSync("/usr/bin/rpicam-still") ? "rpicam-still" : "libcamera-still";
  const tmpPng = path.join(os.tmpdir(), `filmish_${process.pid}_${Date.now()}.png`);

  // Capture → process to PNG once (film-ish tone)
  const baseSize = SIZES[0];
  const toPngCmd = `
    set -o pipefail;
    ${cam} -n -t 400 -o - \
      | convert - -resize '${baseSize}x${baseSize}>' -colorspace Gray \
          -sigmoidal-contrast 5x50% -contrast-stretch 0.3%x0.3% \
          -unsharp 0x1+1+0.02 PNG24:"${tmpPng}"
  `;
  await sh(toPngCmd);

  let chosen = null;
  async function tryQualities(pngPath, sizeTag) {
    for (const q of QUALS) {
      const out = path.join(IMAGES_DIR, `${nowStamp()}_${sizeTag}_q${q}.webp`);
      await sh(`convert "${pngPath}" -define webp:method=6 -quality ${q} "${out}"`, 60000);
      const bytes = fs.statSync(out).size;
      console.log(`  -> ${path.basename(out)}  ${(bytes/1024).toFixed(1)} KB`);
      if (!chosen || fs.statSync(out).size <= TARGET) chosen = out; // keep best candidate (first ≤100KB or latest attempt)
      if (bytes <= TARGET) return true;
    }
    return false;
  }

  let ok = await tryQualities(tmpPng, `${baseSize}`);
  if (!ok) {
    for (let i = 1; i < SIZES.length && !ok; i++) {
      const sz = SIZES[i];
      const smaller = path.join(os.tmpdir(), `filmish_${process.pid}_${sz}_${Date.now()}.png`);
      await sh(`convert "${tmpPng}" -resize '${sz}x${sz}>' PNG24:"${smaller}"`, 40000);
      ok = await tryQualities(smaller, `${sz}`);
      try { fs.unlinkSync(smaller); } catch {}
    }
  }
  try { fs.unlinkSync(tmpPng); } catch {}

  if (!chosen) throw new Error("No candidate produced");
  return chosen;
}

function listImages() {
  return fs.readdirSync(IMAGES_DIR)
    .filter(f => [".webp",".jpg",".jpeg",".png"].includes(path.extname(f).toLowerCase()))
    .map(f => ({ name: f, time: fs.statSync(path.join(IMAGES_DIR, f)).mtimeMs, bytes: fs.statSync(path.join(IMAGES_DIR, f)).size }))
    .sort((a,b)=> b.time - a.time);
}
function latest() {
  const files = listImages();
  return files.length ? files[0] : null;
}

// Button
const btn = new Gpio(BUTTON_GPIO, { mode: Gpio.INPUT, pullUpDown: Gpio.PUD_UP });
btn.glitchFilter(10000);
btn.enableAlert();

let isBusy = false;
console.log(`Mode ${MODE}. Ready. Press button on GPIO ${BUTTON_GPIO} to capture.`);

btn.on("alert", async (level) => {
  if (level !== 0) return;
  if (isBusy) return;
  isBusy = true;
  try {
    console.log("Button PRESSED → capturing (Film-ish)...");
    const file = await captureFilmish();
    const bytes = fs.statSync(file).size;
    console.log(`Saved: ${file}  ${(bytes/1024).toFixed(1)} KB`);
  } catch (e) {
    console.error("Capture failed:", e.stderr || e.message || e);
  } finally {
    isBusy = false;
  }
});

// Web
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

process.on("SIGINT", () => { try { btn.disableAlert(); } catch {} console.log("\nBye."); process.exit(0); });
