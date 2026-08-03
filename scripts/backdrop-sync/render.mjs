// Ported from paytonjewell/Nuvio-Backdrop-Generator's src/lib/canvas.js
// (rotated masonry grid of backdrop cards + gradient overlay), swapped from
// browser <canvas> to node-canvas. Text overlay and per-card exclusion are
// dropped — not needed for an unattended hero-backdrop sync.
// @napi-rs/canvas ships prebuilt binaries, so CI needs no cairo/pango/librsvg
// apt packages and no native build step (near drop-in for node-canvas).
import { createCanvas, loadImage } from "@napi-rs/canvas";

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;

function getColOrder(numCols, visibleCols, centerCol) {
  const colOrder = [];
  for (let d = 0; d < visibleCols; d++) {
    if (d === 0) {
      colOrder.push(centerCol);
      continue;
    }
    if (centerCol + d < visibleCols) colOrder.push(centerCol + d);
    if (centerCol - d >= 0) colOrder.push(centerCol - d);
  }
  for (let col = visibleCols; col < numCols; col++) colOrder.push(col);
  return colOrder;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function applyOverlay(ctx, preset, opacity, reach = 0.6, W = CANVAS_W, H = CANVAS_H) {
  if (preset === "none") return;

  let grad;
  if (preset === "dark-left") {
    grad = ctx.createLinearGradient(0, 0, W * reach, 0);
    grad.addColorStop(0, `rgba(0,0,0,${opacity})`);
    grad.addColorStop(0.5, `rgba(0,0,0,${(opacity * 0.5).toFixed(2)})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
  } else if (preset === "dark-right") {
    grad = ctx.createLinearGradient(W, 0, W * (1 - reach), 0);
    grad.addColorStop(0, `rgba(0,0,0,${opacity})`);
    grad.addColorStop(0.5, `rgba(0,0,0,${(opacity * 0.5).toFixed(2)})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
  } else if (preset === "bottom") {
    grad = ctx.createLinearGradient(0, H, 0, H * (1 - reach));
    grad.addColorStop(0, `rgba(0,0,0,${opacity})`);
    grad.addColorStop(0.5, `rgba(0,0,0,${(opacity * 0.5).toFixed(2)})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
  } else if (preset === "vignette") {
    const outerR = Math.max(W, H) * (0.9 - reach * 0.5);
    grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, outerR);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.5, `rgba(0,0,0,${(opacity * 0.3).toFixed(2)})`);
    grad.addColorStop(1, `rgba(0,0,0,${opacity})`);
  } else if (preset === "cinematic") {
    const lg = ctx.createLinearGradient(0, 0, W * reach, 0);
    lg.addColorStop(0, `rgba(0,0,0,${opacity})`);
    lg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H);
    const barH = H * 0.1;
    const tg = ctx.createLinearGradient(0, 0, 0, barH * 2);
    tg.addColorStop(0, `rgba(0,0,0,${opacity})`);
    tg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = tg;
    ctx.fillRect(0, 0, W, barH * 2);
    const bg = ctx.createLinearGradient(0, H, 0, H - barH * 2);
    bg.addColorStop(0, `rgba(0,0,0,${opacity})`);
    bg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, H - barH * 2, W, barH * 2);
    return;
  }
  if (grad) {
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }
}

// Brand-coloured glow in the top-right, the counterpart to the dark left/bottom
// gradients. A radial gradient is already smooth, so unlike a pixel-shaded
// version this needs no blur pass.
function applyAccentGlow(ctx, accent, W, H, { opacity = 0.46, reach = 0.72 } = {}) {
  if (!accent) return;
  const [r, g, b] = accent;
  const radius = Math.hypot(W, H) * reach;
  const grad = ctx.createRadialGradient(W, 0, 0, W, 0, radius);
  grad.addColorStop(0, `rgba(${r},${g},${b},${opacity})`);
  grad.addColorStop(0.45, `rgba(${r},${g},${b},${(opacity * 0.35).toFixed(3)})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max ? delta / max : 0, max];
}

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const table = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q]
  ][i % 6];
  return table.map((channel) => Math.round(channel * 255));
}

// Picks the most saturated, reasonably lit colour out of a cover image, which
// is what makes each service's backdrop carry its own brand tint.
export function accentFromImage(image) {
  const size = 64;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    if (v < 0.18 || v > 0.97 || s < 0.25) continue;
    const key = `${Math.round(h * 36)}:${Math.round(s * 4)}:${Math.round(v * 4)}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  if (!buckets.size) return null;

  let bestKey = null;
  let bestScore = -1;
  for (const [key, count] of buckets) {
    const s = Number(key.split(":")[1]);
    // Weight saturation over sheer pixel count so a large muted background
    // does not beat a smaller, vivid brand colour.
    const score = (s / 4) * Math.pow(count, 0.25);
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  const [h, s, v] = bestKey.split(":").map(Number);
  return hsvToRgb(h / 36, Math.min(1, (s / 4) * 1.1), Math.max(0.62, v / 4));
}

export function parseAccent(value) {
  const text = String(value || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(text)) {
    return [0, 2, 4].map((offset) => parseInt(text.slice(offset, offset + 2), 16));
  }
  const parts = text.split(",").map((part) => Number(part.trim()));
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    return parts.map((part) => Math.max(0, Math.min(255, Math.round(part))));
  }
  return null;
}

// images: array of loaded node-canvas Image objects (backdrops, in priority
// order — earlier images are placed nearer the grid's center column).
export function renderBackdropCollage(images, settings) {
  const {
    gap,
    scale,
    radius,
    stagger,
    autoStagger = true,
    angleDeg,
    bgColor = "#0b0b0f",
    overlayPreset = "cinematic",
    overlayOpacity = 0.85,
    overlayReach = 0.6,
    offsetX = 0,
    offsetY = 0,
    imageType = "backdrop",
    imageOpacity = 1,
    accentColor = null,
    accentOpacity = 0.46,
    accentReach = 0.72,
    width = CANVAS_W,
    height = CANVAS_H
  } = settings;
  const W = width;
  const H = height;

  const dpr = W / 1920;
  const cardW = Math.round(320 * scale * dpr);
  const cardH = imageType === "poster" ? Math.round((cardW * 3) / 2) : Math.round((cardW * 9) / 16);
  const scaledGap = Math.round(gap * dpr);
  const scaledRadius = Math.round(radius * dpr);
  const effectiveStagger = autoStagger
    ? Math.round((cardH + scaledGap) / 2)
    : Math.round(stagger * dpr);
  const angleRad = -(angleDeg * Math.PI) / 180;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  if (bgColor !== "transparent") {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);
  }

  const diag = Math.ceil(Math.sqrt(W * W + H * H));
  const numCols = Math.ceil(diag / (cardW + scaledGap)) + 4;
  const numRows = Math.ceil(diag / (cardH + scaledGap)) + 4;
  const visibleCols = numCols - 4;
  const centerCol = Math.min(
    Math.round((diag - cardW) / (2 * (cardW + scaledGap))),
    visibleCols - 1
  );

  const colOrder = getColOrder(numCols, visibleCols, centerCol);

  // Cycles through the image pool with modulo indexing (rather than the
  // upstream tool's "stop when the pool runs out") since our pool is a
  // couple dozen trending items, not a user-curated set of 100+ — cycling
  // keeps the grid fully covered instead of leaving bare background.
  let imgIdx = 0;
  ctx.save();
  ctx.translate(W / 2 + offsetX, H / 2 + offsetY);
  ctx.rotate(angleRad);
  ctx.translate(-diag / 2, -diag / 2);

  for (const col of colOrder) {
    const rowOffset = col % 2 === 0 ? 0 : effectiveStagger;
    for (let row = -1; row < numRows; row++) {
      const gx = col * (cardW + scaledGap) + cardW / 2;
      const gy = row * (cardH + scaledGap) + cardH / 2 + rowOffset;
      const canvasY =
        (gx - diag / 2) * Math.sin(angleRad) + (gy - diag / 2) * Math.cos(angleRad) + H / 2;
      if (canvasY < -(cardH / 2) || canvasY > H + cardH / 2) continue;

      if (images.length === 0) continue;
      const img = images[imgIdx % images.length];
      imgIdx++;
      const x = col * (cardW + scaledGap);
      const y = row * (cardH + scaledGap) + rowOffset;
      ctx.save();
      roundRect(ctx, x, y, cardW, cardH, scaledRadius);
      ctx.clip();
      ctx.globalAlpha = imageOpacity;
      ctx.drawImage(img, x, y, cardW, cardH);
      ctx.restore();
    }
  }

  ctx.restore();
  applyOverlay(ctx, overlayPreset, overlayOpacity, overlayReach, W, H);
  // After the dark gradients so the tint sits over them, matching the
  // reference backdrops' coloured top-right corner.
  applyAccentGlow(ctx, accentColor, W, H, { opacity: accentOpacity, reach: accentReach });

  return canvas;
}

// WebP rather than PNG: a 1920x1080 photographic collage is megabytes as PNG
// and ~220 KB as WebP, and this lands on a TV over wifi.
export async function encodeWebp(canvas, quality = 82) {
  return canvas.encode("webp", quality);
}

export async function loadImagesFromUrls(urls, { concurrency = 5 } = {}) {
  const images = [];
  let cursor = 0;
  async function worker() {
    while (cursor < urls.length) {
      const index = cursor++;
      try {
        const res = await fetch(urls[index]);
        if (!res.ok) continue;
        const buffer = Buffer.from(await res.arrayBuffer());
        images[index] = await loadImage(buffer);
      } catch {
        // Skip images that fail to download/decode — the grid just reuses
        // the remaining pool for those slots.
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return images.filter(Boolean);
}
