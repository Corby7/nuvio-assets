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

// The reference pipeline's overlay stack, reproduced exactly: a dark
// bottom-left corner, a dark left edge, a dark bottom edge, then the accent
// glow in the top-right. Same falloff curves, same alphas, same order.
//
// The two corner layers are computed at quarter resolution and scaled up, as
// the original does — that is both far cheaper and the reason the falloff
// looks soft rather than banded.
const SHADE_RGB = [6, 6, 8];

function cornerLayer(W, H, paint) {
  const w = Math.max(1, Math.floor(W / 4));
  const h = Math.max(1, Math.floor(H / 4));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(w, h);
  const maxDiag = Math.hypot(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = paint(x, y, w, h, maxDiag);
      const offset = (y * w + x) * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = a;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function applyReferenceOverlay(ctx, accent, W, H) {
  const [sr, sg, sb] = SHADE_RGB;

  // Dark bottom-left corner: alpha 230 * (1 - d/0.60)^2.2
  const bottomLeft = cornerLayer(W, H, (x, y, w, h, maxDiag) => {
    const mix = Math.hypot(x, h - y) / maxDiag;
    const base = Math.max(0, 1 - mix / 0.6);
    return [sr, sg, sb, Math.min(255, Math.round(230 * base ** 2.2))];
  });
  ctx.drawImage(bottomLeft, 0, 0, W, H);

  // Dark left edge: alpha 200 * (1 - x/(W*0.45))^1.6
  for (let x = 0; x < W; x++) {
    const mix = Math.max(0, 1 - x / (W * 0.45));
    const alpha = Math.round(200 * mix ** 1.6);
    if (!alpha) break;
    ctx.fillStyle = `rgba(${sr},${sg},${sb},${(alpha / 255).toFixed(4)})`;
    ctx.fillRect(x, 0, 1, H);
  }

  // Dark bottom edge: alpha 200 * ((y - H/2)/(H/2))^1.4
  for (let y = Math.floor(H * 0.5); y < H; y++) {
    const mix = Math.max(0, (y - H * 0.5) / (H * 0.5));
    const alpha = Math.round(200 * mix ** 1.4);
    if (!alpha) continue;
    ctx.fillStyle = `rgba(${sr},${sg},${sb},${(alpha / 255).toFixed(4)})`;
    ctx.fillRect(0, y, W, 1);
  }

  if (!accent) return;

  // Accent glow, top-right: alpha 118 * (1 - d/0.72)^1.9, blurred.
  const [ar, ag, ab] = accent;
  const glow = cornerLayer(W, H, (x, y, w, h, maxDiag) => {
    const mix = Math.hypot(w - x, y) / maxDiag;
    const base = Math.max(0, 1 - mix / 0.72);
    return [ar, ag, ab, Math.min(255, Math.round(118 * base ** 1.9))];
  });
  // No canvas blur here: it treats outside-canvas as transparent and so eats
  // the glow's peak exactly where it should be strongest (measured 137,125,118
  // at the corner against the formula's 172,115,81), while bleeding tint into
  // the centre. The original blurs because it builds this at quarter size and
  // upscales; drawImage's own smoothing on the same quarter-size layer gives
  // the soft falloff without touching the alpha.
  ctx.drawImage(glow, 0, 0, W, H);
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
  if (overlayPreset === "reference") {
    applyReferenceOverlay(ctx, accentColor, W, H);
  } else {
    applyOverlay(ctx, overlayPreset, overlayOpacity, overlayReach, W, H);
  }

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
