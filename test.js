// bnw_button_capture.js
// Run with: sudo -E node bnw_button_capture.js

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { Gpio } = require("pigpio");

// ----- config -----
const BUTTON_GPIO = 13;                       // BCM 13 = your working button
const IMAGES_DIR = path.join(__dirname, "images");
fs.mkdirSync(IMAGES_DIR, { recursive: true });

// ----- helpers -----
function nowStamp() {
  const d = new Date();
  const z = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
}

// shell helper for piped command
function sh(cmd, timeout = 30000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout }, (err, stdout, stderr) => {
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

// ----- capture pipeline -----
// libcamera-still -> ImageMagick convert -> grayscale JPEG
async function captureBnW() {
  const out = path.join(IMAGES_DIR, `${nowStamp()}.jpg`);
  const cmd =
    `libcamera-still -n -t 1 -o - | ` +
    `convert - -resize '1024x1024>' -colorspace Gray -auto-level ` +
    `-contrast-stretch 0.5%x0.5% -quality 90 "${out}"`;

  await sh(cmd);
  return out;
}

// ----- button setup -----
let isBusy = false;

const btn = new Gpio(BUTTON_GPIO, { mode: Gpio.INPUT, pullUpDown: Gpio.PUD_UP });
// debounce via hardware glitch filter (10 µs) and alert (edge) mode
btn.glitchFilter(10000);
btn.enableAlert();

console.log(`Ready. Press button on GPIO ${BUTTON_GPIO} to take a BnW photo.`);

btn.on("alert", async (level /* 0=falling, 1=rising */) => {
  if (level !== 0) return;           // trigger on press (active-low)
  if (isBusy) {
    console.log("Busy… ignoring press");
    return;
  }
  isBusy = true;
  try {
    console.log("Capturing...");
    const file = await captureBnW();
    console.log("Saved:", file);
  } catch (e) {
    console.error("Capture failed:", e.stderr || e.message || e);
  } finally {
    isBusy = false;
  }
});

// graceful exit
process.on("SIGINT", () => {
  try { btn.disableAlert(); } catch {}
  console.log("\nBye.");
  process.exit(0);
});
