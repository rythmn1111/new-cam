const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;
const ROOT = __dirname;
const IMAGES_DIR = path.join(ROOT, "images");
const PUBLIC_DIR = path.join(ROOT, "public");

function getLatestImage() {
  const files = fs.readdirSync(IMAGES_DIR)
    .filter(f => f.toLowerCase().endsWith(".jpg"))
    .map(f => ({
      name: f,
      time: fs.statSync(path.join(IMAGES_DIR, f)).mtimeMs
    }))
    .sort((a, b) => b.time - a.time);

  return files.length > 0 ? files[0].name : null;
}

// Serve static HTML
app.use(express.static(PUBLIC_DIR));
// Serve images
app.use("/images", express.static(IMAGES_DIR));

// JSON endpoint to tell frontend what the latest file is
app.get("/latest.json", (req, res) => {
  const latest = getLatestImage();
  if (!latest) return res.json({ ok: false });
  res.json({ ok: true, filename: latest });
});

app.listen(PORT, () => {
  console.log(`Server running at http://raspberrypi.local:${PORT}`);
});
