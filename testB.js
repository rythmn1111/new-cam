// testB.js
// Run: sudo -E node testB.js
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const IMAGES_DIR = path.join(__dirname, "images");
fs.mkdirSync(IMAGES_DIR, { recursive: true });

function nowStamp() {
  const d = new Date(), z = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
}
function sh(cmd, timeout = 90000) {
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
  const TARGET = 100_000; // ≤ 100 KB
  const QUAL_STEPS = [85, 80, 75, 70, 65];
  const SIZES = [960, 900, 840]; // fallback sizes if quality steps alone can't hit target

  const tmpPng = path.join(os.tmpdir(), `filmish_${process.pid}.png`);

  try {
    const cam = fs.existsSync("/usr/bin/rpicam-still") ? "rpicam-still" : "libcamera-still";

    // Capture to PNG once (film-ish tone, start at 960 longest side)
    const baseSize = SIZES[0];
    const toPngCmd = `
      set -o pipefail;
      ${cam} -n -t 400 -o - \
        | convert - -resize '${baseSize}x${baseSize}>' -colorspace Gray \
            -sigmoidal-contrast 5x50% -contrast-stretch 0.3%x0.3% \
            -unsharp 0x1+1+0.02 PNG24:"${tmpPng}"
    `;
    console.log("Capturing (Film-ish, adaptive)...");
    await sh(toPngCmd);

    let final = path.join(IMAGES_DIR, `${nowStamp()}.webp`);
    let hit = false, sizeUsed = baseSize;

    // Try qualities on current size
    async function tryQualities(pngPath, sizeTag) {
      for (const q of QUAL_STEPS) {
        const out = path.join(IMAGES_DIR, `${nowStamp()}_${sizeTag}_q${q}.webp`);
        // re-encode from processed PNG
        await sh(`convert "${pngPath}" -define webp:method=6 -quality ${q} "${out}"`, 60000);
        const bytes = fs.statSync(out).size;
        console.log(`  -> ${path.basename(out)}  ${(bytes/1024).toFixed(1)} KB`);
        if (bytes <= TARGET) {
          final = out;
          return true;
        } else {
          // keep the smallest so far (overwrite final if this is smaller)
          if (!fs.existsSync(final) || fs.statSync(final).size > bytes) final = out;
        }
      }
      return false;
    }

    // First, try quality steps on the base processed PNG
    hit = await tryQualities(tmpPng, `${baseSize}`);

    // If still not ≤100 KB, progressively downsize and retry qualities
    if (!hit) {
      for (let i = 1; i < SIZES.length && !hit; i++) {
        sizeUsed = SIZES[i];
        const smallerPng = path.join(os.tmpdir(), `filmish_${process.pid}_${sizeUsed}.png`);
        await sh(`convert "${tmpPng}" -resize '${sizeUsed}x${sizeUsed}>' PNG24:"${smallerPng}"`, 40000);
        hit = await tryQualities(smallerPng, `${sizeUsed}`);
        try { fs.unlinkSync(smallerPng); } catch {}
      }
    }

    const bytes = fs.statSync(final).size;
    console.log(`Chosen: ${path.basename(final)}  ${(bytes/1024).toFixed(1)} KB (≤ 100 KB = ${bytes <= TARGET})`);
  } catch (e) {
    console.error("testB failed:", e.stderr || e.message || e);
  } finally {
    try { fs.unlinkSync(tmpPng); } catch {}
  }
})();
