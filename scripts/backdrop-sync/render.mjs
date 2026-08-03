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
