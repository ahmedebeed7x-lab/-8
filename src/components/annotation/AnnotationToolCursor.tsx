import React, { useEffect } from 'react';
import { useAnnotationToolState } from './AnnotationContext';

type CursorImageSetMode = 'standard' | 'webkit' | 'url';

let cachedImageSetMode: CursorImageSetMode | null = null;
const cursorCssCache = new Map<string, string>();
const MAX_CURSOR_CACHE_ENTRIES = 64;

function getCursorImageSetMode(): CursorImageSetMode {
  if (cachedImageSetMode) return cachedImageSetMode;
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
    cachedImageSetMode = 'url';
    return cachedImageSetMode;
  }

  const probe =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  if (
    CSS.supports(
      'cursor',
      `image-set(url("${probe}") 1x, url("${probe}") 2x) 9 45, crosshair`
    )
  ) {
    cachedImageSetMode = 'standard';
  } else if (
    CSS.supports(
      'cursor',
      `-webkit-image-set(url("${probe}") 1x, url("${probe}") 2x) 9 45, crosshair`
    )
  ) {
    cachedImageSetMode = 'webkit';
  } else {
    cachedImageSetMode = 'url';
  }

  return cachedImageSetMode;
}

function addRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function createOffscreenCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function downsampleCanvas(
  src: HTMLCanvasElement,
  targetW: number,
  targetH: number
): HTMLCanvasElement {
  const dst = document.createElement('canvas');
  dst.width = targetW;
  dst.height = targetH;
  const ctx = dst.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, targetW, targetH);
  }
  return dst;
}

/**
 * Renders a tool cursor at 4x supersampled resolution with a baked soft studio
 * drop shadow, step-downsamples cleanly to 2x (Retina) and 1x (Standard) PNGs,
 * and returns a cached OS-Hardware `cursor` CSS string (0% CPU lag on Google Meet).
 */
function renderSupersampledHardwareCursor(
  cacheKey: string,
  logicalW: number,
  logicalH: number,
  hotspotX: number,
  hotspotY: number,
  fallback: string,
  drawTool: (ctx: CanvasRenderingContext2D, scale: number) => void
): string {
  const hit = cursorCssCache.get(cacheKey);
  if (hit) return hit;

  const ssScale = 4;
  const ssCanvas = createOffscreenCanvas(logicalW * ssScale, logicalH * ssScale);
  const ssCtx = ssCanvas?.getContext('2d');

  if (!ssCanvas || !ssCtx) {
    return fallback;
  }

  ssCtx.save();
  ssCtx.scale(ssScale, ssScale);
  drawTool(ssCtx, ssScale);
  ssCtx.restore();

  // Step-downsample 4x -> 2x -> 1x with high-quality bicubic filtering
  // for velvety 45-degree diagonal anti-aliasing without pixel stair-stepping.
  const canvas2x = downsampleCanvas(ssCanvas, logicalW * 2, logicalH * 2);
  const canvas1x = downsampleCanvas(canvas2x, logicalW, logicalH);

  const png1x = canvas1x.toDataURL('image/png');
  const png2x = canvas2x.toDataURL('image/png');
  const mode = getCursorImageSetMode();

  let cssValue: string;
  if (mode === 'standard') {
    cssValue = `image-set(url("${png1x}") 1x, url("${png2x}") 2x) ${hotspotX} ${hotspotY}, ${fallback}`;
  } else if (mode === 'webkit') {
    cssValue = `-webkit-image-set(url("${png1x}") 1x, url("${png2x}") 2x) ${hotspotX} ${hotspotY}, ${fallback}`;
  } else {
    cssValue = `url("${png1x}") ${hotspotX} ${hotspotY}, ${fallback}`;
  }

  if (cursorCssCache.size >= MAX_CURSOR_CACHE_ENTRIES) {
    cursorCssCache.clear();
  }
  cursorCssCache.set(cacheKey, cssValue);
  return cssValue;
}

function applyBakedShadow(
  ctx: CanvasRenderingContext2D,
  scale: number,
  blurLogical = 3.1,
  offsetXLogical = 0.5,
  offsetYLogical = 1.65,
  alpha = 0.25
): void {
  ctx.shadowColor = `rgba(15, 23, 42, ${alpha})`;
  ctx.shadowBlur = blurLogical * scale;
  ctx.shadowOffsetX = offsetXLogical * scale;
  ctx.shadowOffsetY = offsetYLogical * scale;
}

function clearBakedShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function drawCylindricalWrapOverlay(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const wrap = ctx.createLinearGradient(x, y, x + w, y);
  wrap.addColorStop(0, 'rgba(15, 23, 42, 0.22)');
  wrap.addColorStop(0.28, 'rgba(255, 255, 255, 0.36)');
  wrap.addColorStop(0.62, 'rgba(255, 255, 255, 0)');
  wrap.addColorStop(0.9, 'rgba(15, 23, 42, 0.22)');
  wrap.addColorStop(1, 'rgba(255, 255, 255, 0.12)');
  ctx.fillStyle = wrap;
  ctx.fillRect(x, y, w, h);
}

/**
 * 54x54 Studio Ballpoint/Gel Pen Cursor (hotspot: 9, 45).
 */
function buildPenHardwareCursor(color: string): string {
  return renderSupersampledHardwareCursor(
    `pen:${color}`,
    54,
    54,
    9,
    45,
    'crosshair',
    (ctx, scale) => {
      ctx.translate(9, 45);
      ctx.rotate(Math.PI / 4);

      const traceOuter = () => {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-4.45, -14.2);
        ctx.lineTo(-4.6, -14.2);
        ctx.lineTo(-4.6, -40.8);
        ctx.quadraticCurveTo(-4.6, -44.2, -1.2, -44.2);
        ctx.lineTo(1.2, -44.2);
        ctx.quadraticCurveTo(4.6, -44.2, 4.6, -40.8);
        ctx.lineTo(4.6, -14.2);
        ctx.lineTo(4.45, -14.2);
        ctx.closePath();
      };

      // Pass 1: Baked soft studio drop shadow + porcelain contrast cushion
      ctx.save();
      applyBakedShadow(ctx, scale);
      traceOuter();
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      clearBakedShadow(ctx);
      ctx.lineWidth = 1.65;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.stroke();
      ctx.restore();

      // Pure saturated colored ink nib
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(1.85, -5.8);
      ctx.quadraticCurveTo(0, -6.3, -1.85, -5.8);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();

      // Sculpted porcelain cone
      ctx.beginPath();
      ctx.moveTo(-1.85, -5.8);
      ctx.quadraticCurveTo(0, -6.3, 1.85, -5.8);
      ctx.lineTo(4.45, -14.2);
      ctx.lineTo(-4.45, -14.2);
      ctx.closePath();
      const coneGrad = ctx.createLinearGradient(-4.45, -10, 4.45, -10);
      coneGrad.addColorStop(0, '#D4DEE9');
      coneGrad.addColorStop(0.28, '#FFFFFF');
      coneGrad.addColorStop(0.64, '#F4F7FA');
      coneGrad.addColorStop(0.9, '#C3CFDD');
      coneGrad.addColorStop(1, '#DCE4EE');
      ctx.fillStyle = coneGrad;
      ctx.fill();
      ctx.lineWidth = 0.65;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.28)';
      ctx.stroke();

      // Specular cone rib
      ctx.beginPath();
      ctx.moveTo(-1.55, -6.2);
      ctx.lineTo(-3.6, -13.8);
      ctx.lineTo(-2.3, -13.8);
      ctx.lineTo(-0.85, -6.2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.fill();

      // Brushed satin aluminum collar
      const collarGrad = ctx.createLinearGradient(-4.6, -15.5, 4.6, -15.5);
      collarGrad.addColorStop(0, '#B0BDCB');
      collarGrad.addColorStop(0.32, '#F8FAFC');
      collarGrad.addColorStop(0.68, '#DCE3EC');
      collarGrad.addColorStop(1, '#96A5B5');
      ctx.fillStyle = collarGrad;
      ctx.fillRect(-4.6, -16.8, 9.2, 2.6);
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.28)';
      ctx.strokeRect(-4.6, -16.8, 9.2, 2.6);

      // Rim-lit matte ceramic barrel
      ctx.beginPath();
      ctx.moveTo(-4.55, -16.8);
      ctx.lineTo(4.55, -16.8);
      ctx.lineTo(4.55, -40.8);
      ctx.quadraticCurveTo(4.55, -44.1, 1.25, -44.1);
      ctx.lineTo(-1.25, -44.1);
      ctx.quadraticCurveTo(-4.55, -44.1, -4.55, -40.8);
      ctx.closePath();
      const bodyGrad = ctx.createLinearGradient(-4.55, -30, 4.55, -30);
      bodyGrad.addColorStop(0, '#DAE3ED');
      bodyGrad.addColorStop(0.28, '#FFFFFF');
      bodyGrad.addColorStop(0.64, '#F8FAFC');
      bodyGrad.addColorStop(0.9, '#CBD6E3');
      bodyGrad.addColorStop(1, '#E1E8F0');
      ctx.fillStyle = bodyGrad;
      ctx.fill();
      ctx.lineWidth = 0.68;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.28)';
      ctx.stroke();

      // Live-color ink band + cylindrical wrap shading
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = color;
      ctx.fillRect(-4.5, -24.2, 9.0, 4.6);
      ctx.globalAlpha = 1;
      drawCylindricalWrapOverlay(ctx, -4.5, -24.2, 9.0, 4.6);

      // Vertical studio highlight strip
      addRoundedRectPath(ctx, -2.75, -41.9, 1.4, 24.1, 0.7);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.68)';
      ctx.fill();
    }
  );
}

/**
 * 54x54 Luxury Studio Fountain Pen Cursor (hotspot: 9, 45).
 */
function buildFountainHardwareCursor(color: string): string {
  return renderSupersampledHardwareCursor(
    `fountain:${color}`,
    54,
    54,
    9,
    45,
    'crosshair',
    (ctx, scale) => {
      ctx.translate(9, 45);
      ctx.rotate(Math.PI / 4);

      const traceOuter = () => {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-3.45, -5.6, -3.35, -8.8);
        ctx.lineTo(-2.2, -14.0);
        ctx.lineTo(-3.65, -14.0);
        ctx.lineTo(-4.55, -17.2);
        ctx.lineTo(-4.55, -40.8);
        ctx.quadraticCurveTo(-4.55, -44.2, -1.2, -44.2);
        ctx.lineTo(1.2, -44.2);
        ctx.quadraticCurveTo(4.55, -44.2, 4.55, -40.8);
        ctx.lineTo(4.55, -17.2);
        ctx.lineTo(3.65, -14.0);
        ctx.lineTo(2.2, -14.0);
        ctx.lineTo(3.35, -8.8);
        ctx.quadraticCurveTo(3.45, -5.6, 0, 0);
        ctx.closePath();
      };

      // Pass 1: Baked soft studio drop shadow + cushion halo
      ctx.save();
      applyBakedShadow(ctx, scale);
      traceOuter();
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      clearBakedShadow(ctx);
      ctx.lineWidth = 1.65;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.stroke();
      ctx.restore();

      // Slender champagne-gold calligraphy nib
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(3.45, -5.6, 3.35, -8.8);
      ctx.lineTo(2.2, -14.0);
      ctx.lineTo(-2.2, -14.0);
      ctx.lineTo(-3.35, -8.8);
      ctx.quadraticCurveTo(-3.45, -5.6, 0, 0);
      ctx.closePath();
      const goldGrad = ctx.createLinearGradient(-3.35, -7, 3.35, -7);
      goldGrad.addColorStop(0, '#C29747');
      goldGrad.addColorStop(0.3, '#FFF3D3');
      goldGrad.addColorStop(0.66, '#DFBA70');
      goldGrad.addColorStop(0.9, '#976E26');
      goldGrad.addColorStop(1, '#CFA75B');
      ctx.fillStyle = goldGrad;
      ctx.fill();
      ctx.lineWidth = 0.65;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(112, 74, 18, 0.48)';
      ctx.stroke();

      // Left-wing gold specular facet
      ctx.beginPath();
      ctx.moveTo(-0.5, -2.5);
      ctx.lineTo(-2.5, -8.5);
      ctx.lineTo(-1.45, -8.7);
      ctx.lineTo(-0.15, -2.65);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.56)';
      ctx.fill();

      // Crisp ink slit + live-color breather dot
      ctx.beginPath();
      ctx.moveTo(0, -1.0);
      ctx.lineTo(0, -8.55);
      ctx.lineWidth = 0.72;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.68)';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, -8.95, 1.08, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 0.38;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.3)';
      ctx.stroke();

      // Tapered brushed-metal grip section collar
      ctx.beginPath();
      ctx.moveTo(-3.6, -14.0);
      ctx.lineTo(3.6, -14.0);
      ctx.lineTo(4.55, -17.2);
      ctx.lineTo(-4.55, -17.2);
      ctx.closePath();
      const collarGrad = ctx.createLinearGradient(-4.55, -15.6, 4.55, -15.6);
      collarGrad.addColorStop(0, '#B0BDCB');
      collarGrad.addColorStop(0.32, '#FFFFFF');
      collarGrad.addColorStop(0.7, '#D6DFE9');
      collarGrad.addColorStop(1, '#909FB0');
      ctx.fillStyle = collarGrad;
      ctx.fill();
      ctx.lineWidth = 0.62;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.28)';
      ctx.stroke();

      // Satin porcelain lacquer barrel
      ctx.beginPath();
      ctx.moveTo(-4.55, -17.2);
      ctx.lineTo(4.55, -17.2);
      ctx.lineTo(4.55, -40.8);
      ctx.quadraticCurveTo(4.55, -44.1, 1.25, -44.1);
      ctx.lineTo(-1.25, -44.1);
      ctx.quadraticCurveTo(-4.55, -44.1, -4.55, -40.8);
      ctx.closePath();
      const bodyGrad = ctx.createLinearGradient(-4.55, -30, 4.55, -30);
      bodyGrad.addColorStop(0, '#D5DEE9');
      bodyGrad.addColorStop(0.28, '#FFFFFF');
      bodyGrad.addColorStop(0.66, '#F1F5F9');
      bodyGrad.addColorStop(0.9, '#C0CCDA');
      bodyGrad.addColorStop(1, '#DCE4EE');
      ctx.fillStyle = bodyGrad;
      ctx.fill();
      ctx.lineWidth = 0.68;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.28)';
      ctx.stroke();

      // Live-color ink band + cylindrical wrap shading
      ctx.globalAlpha = 0.94;
      ctx.fillStyle = color;
      ctx.fillRect(-4.5, -24.0, 9.0, 4.3);
      ctx.globalAlpha = 1;
      drawCylindricalWrapOverlay(ctx, -4.5, -24.0, 9.0, 4.3);

      // Brushed champagne-gold trim ring
      ctx.fillStyle = goldGrad;
      ctx.fillRect(-4.6, -26.8, 9.2, 1.65);
      ctx.lineWidth = 0.35;
      ctx.strokeStyle = 'rgba(112, 74, 18, 0.3)';
      ctx.strokeRect(-4.6, -26.8, 9.2, 1.65);

      // Vertical studio highlight strip
      addRoundedRectPath(ctx, -2.7, -41.8, 1.38, 13.8, 0.69);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.66)';
      ctx.fill();
    }
  );
}

/**
 * 54x54 Studio Cedar Pencil Cursor (hotspot: 9, 45).
 */
function buildPencilHardwareCursor(color: string): string {
  return renderSupersampledHardwareCursor(
    `pencil:${color}`,
    54,
    54,
    9,
    45,
    'crosshair',
    (ctx, scale) => {
      ctx.translate(9, 45);
      ctx.rotate(Math.PI / 4);

      const traceOuter = () => {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-4.45, -14.4);
        ctx.lineTo(-4.45, -41.5);
        ctx.quadraticCurveTo(-4.45, -44.2, -1.75, -44.2);
        ctx.lineTo(1.75, -44.2);
        ctx.quadraticCurveTo(4.45, -44.2, 4.45, -41.5);
        ctx.lineTo(4.45, -14.4);
        ctx.closePath();
      };

      // Pass 1: Baked soft shadow + cushion halo
      ctx.save();
      applyBakedShadow(ctx, scale);
      traceOuter();
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      clearBakedShadow(ctx);
      ctx.lineWidth = 1.65;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.stroke();
      ctx.restore();

      // Pure saturated graphite lead tip
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(1.75, -5.65);
      ctx.quadraticCurveTo(0, -6.1, -1.75, -5.65);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();

      // Warm carved cedar wood cone
      ctx.beginPath();
      ctx.moveTo(-1.75, -5.65);
      ctx.quadraticCurveTo(0, -6.1, 1.75, -5.65);
      ctx.lineTo(4.45, -14.4);
      ctx.lineTo(-4.45, -14.4);
      ctx.closePath();
      const woodGrad = ctx.createLinearGradient(-4.45, -10, 4.45, -10);
      woodGrad.addColorStop(0, '#CCA178');
      woodGrad.addColorStop(0.32, '#F6E0C6');
      woodGrad.addColorStop(0.68, '#DFBA95');
      woodGrad.addColorStop(0.9, '#B6875C');
      woodGrad.addColorStop(1, '#CFA47C');
      ctx.fillStyle = woodGrad;
      ctx.fill();
      ctx.lineWidth = 0.62;
      ctx.strokeStyle = 'rgba(115, 68, 32, 0.34)';
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-1.45, -6.1);
      ctx.lineTo(-3.6, -14.0);
      ctx.lineTo(-2.35, -14.0);
      ctx.lineTo(-0.75, -6.1);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.46)';
      ctx.fill();

      // Hexagonal zigzag-collared body
      ctx.beginPath();
      ctx.moveTo(-4.45, -14.4);
      ctx.lineTo(-2.15, -15.6);
      ctx.lineTo(0, -14.4);
      ctx.lineTo(2.15, -15.6);
      ctx.lineTo(4.45, -14.4);
      ctx.lineTo(4.45, -38.1);
      ctx.lineTo(-4.45, -38.1);
      ctx.closePath();
      const bodyGrad = ctx.createLinearGradient(-4.45, -26, 4.45, -26);
      bodyGrad.addColorStop(0, '#DAE2EC');
      bodyGrad.addColorStop(0.28, '#FFFFFF');
      bodyGrad.addColorStop(0.65, '#F4F6FA');
      bodyGrad.addColorStop(0.9, '#C7D1DE');
      bodyGrad.addColorStop(1, '#DEE5EE');
      ctx.fillStyle = bodyGrad;
      ctx.fill();
      ctx.lineWidth = 0.65;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.28)';
      ctx.stroke();

      // Colored sleeve with cylindrical wrap shading
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = color;
      ctx.fillRect(-4.4, -23.6, 8.8, 4.5);
      ctx.globalAlpha = 1;
      drawCylindricalWrapOverlay(ctx, -4.4, -23.6, 8.8, 4.5);

      // Brushed aluminum ferrule
      const ferruleGrad = ctx.createLinearGradient(-4.5, -39.7, 4.5, -39.7);
      ferruleGrad.addColorStop(0, '#BCC7D4');
      ferruleGrad.addColorStop(0.32, '#F8FAFC');
      ferruleGrad.addColorStop(0.7, '#DCE3EC');
      ferruleGrad.addColorStop(1, '#9CAAB9');
      ctx.fillStyle = ferruleGrad;
      ctx.fillRect(-4.5, -41.3, 9.0, 3.2);
      ctx.lineWidth = 0.58;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.28)';
      ctx.strokeRect(-4.5, -41.3, 9.0, 3.2);

      // Pastel rose rounded eraser cap
      ctx.beginPath();
      ctx.moveTo(-4.2, -41.3);
      ctx.lineTo(4.2, -41.3);
      ctx.lineTo(4.2, -42.4);
      ctx.quadraticCurveTo(4.2, -44.1, 2.2, -44.1);
      ctx.lineTo(-2.2, -44.1);
      ctx.quadraticCurveTo(-4.2, -44.1, -4.2, -42.4);
      ctx.closePath();
      const capGrad = ctx.createLinearGradient(-4.2, -42.7, 4.2, -42.7);
      capGrad.addColorStop(0, '#F2B8CE');
      capGrad.addColorStop(0.32, '#FFF5F9');
      capGrad.addColorStop(0.7, '#F9A8D4');
      capGrad.addColorStop(1, '#E397B4');
      ctx.fillStyle = capGrad;
      ctx.fill();
      ctx.lineWidth = 0.58;
      ctx.strokeStyle = 'rgba(190, 24, 93, 0.3)';
      ctx.stroke();

      // Vertical sheen
      addRoundedRectPath(ctx, -3.35, -37.1, 1.05, 20.8, 0.52);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.58)';
      ctx.fill();
    }
  );
}

/**
 * 54x54 Studio Chisel Highlighter Cursor (hotspot: 9, 45).
 * Chisel bottom-left corner sits precisely at (9, 45).
 */
function buildHighlighterHardwareCursor(color: string): string {
  return renderSupersampledHardwareCursor(
    `hl:${color}`,
    54,
    54,
    9,
    45,
    'crosshair',
    (ctx, scale) => {
      ctx.translate(9, 45);
      ctx.rotate(Math.PI / 4);

      const traceOuter = () => {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(5.8, -2.8);
        ctx.lineTo(6.4, -9.4);
        ctx.lineTo(8.3, -14.4);
        ctx.lineTo(8.3, -38.8);
        ctx.quadraticCurveTo(8.3, -43.0, 4.1, -43.0);
        ctx.lineTo(1.7, -43.0);
        ctx.quadraticCurveTo(-2.5, -43.0, -2.5, -38.8);
        ctx.lineTo(-2.5, -14.4);
        ctx.lineTo(-0.6, -9.4);
        ctx.closePath();
      };

      // Pass 1: Baked soft studio drop shadow + cushion halo
      ctx.save();
      applyBakedShadow(ctx, scale);
      traceOuter();
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      clearBakedShadow(ctx);
      ctx.lineWidth = 1.65;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.stroke();
      ctx.restore();

      // Beveled chisel felt tip
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(5.8, -2.8);
      ctx.lineTo(6.35, -9.4);
      ctx.lineTo(-0.55, -9.4);
      ctx.closePath();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 0.62;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.3)';
      ctx.stroke();

      // Chisel bevel specular gleam
      ctx.beginPath();
      ctx.moveTo(0.6, -1.35);
      ctx.lineTo(5.2, -3.55);
      ctx.lineTo(5.35, -5.85);
      ctx.lineTo(0.5, -3.65);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.46)';
      ctx.fill();

      // Sculpted ergonomic porcelain shoulder
      ctx.beginPath();
      ctx.moveTo(-0.9, -9.4);
      ctx.lineTo(6.7, -9.4);
      ctx.lineTo(8.3, -14.4);
      ctx.lineTo(-2.5, -14.4);
      ctx.closePath();
      const shoulderGrad = ctx.createLinearGradient(-2.5, -11.9, 8.3, -11.9);
      shoulderGrad.addColorStop(0, '#D7E0EB');
      shoulderGrad.addColorStop(0.3, '#FFFFFF');
      shoulderGrad.addColorStop(0.66, '#F5F7FA');
      shoulderGrad.addColorStop(0.9, '#C4D0DD');
      shoulderGrad.addColorStop(1, '#DCE4EE');
      ctx.fillStyle = shoulderGrad;
      ctx.fill();
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.26)';
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-0.3, -9.7);
      ctx.lineTo(-1.7, -14.1);
      ctx.lineTo(-0.2, -14.1);
      ctx.lineTo(0.8, -9.7);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.68)';
      ctx.fill();

      // Satin neck collar
      const ringGrad = ctx.createLinearGradient(-2.6, -15.3, 8.4, -15.3);
      ringGrad.addColorStop(0, '#BAC6D2');
      ringGrad.addColorStop(0.32, '#F8FAFC');
      ringGrad.addColorStop(0.68, '#DCE3EC');
      ringGrad.addColorStop(1, '#A0AEBC');
      addRoundedRectPath(ctx, -2.6, -16.2, 11.0, 1.8, 0.6);
      ctx.fillStyle = ringGrad;
      ctx.fill();
      ctx.lineWidth = 0.55;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.24)';
      ctx.stroke();

      // Broad marker barrel + translucent colored sleeve
      const traceBarrel = () => {
        ctx.beginPath();
        ctx.moveTo(-2.5, -16.2);
        ctx.lineTo(8.3, -16.2);
        ctx.lineTo(8.3, -38.8);
        ctx.quadraticCurveTo(8.3, -42.9, 4.2, -42.9);
        ctx.lineTo(1.6, -42.9);
        ctx.quadraticCurveTo(-2.5, -42.9, -2.5, -38.8);
        ctx.closePath();
      };
      traceBarrel();
      const bodyGrad = ctx.createLinearGradient(-2.5, -29, 8.3, -29);
      bodyGrad.addColorStop(0, '#DCE4EE');
      bodyGrad.addColorStop(0.28, '#FFFFFF');
      bodyGrad.addColorStop(0.64, '#F8FAFC');
      bodyGrad.addColorStop(0.9, '#CED8E4');
      bodyGrad.addColorStop(1, '#E1E8F0');
      ctx.fillStyle = bodyGrad;
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-2.5, -19.2);
      ctx.lineTo(8.3, -19.2);
      ctx.lineTo(8.3, -38.8);
      ctx.quadraticCurveTo(8.3, -42.9, 4.2, -42.9);
      ctx.lineTo(1.6, -42.9);
      ctx.quadraticCurveTo(-2.5, -42.9, -2.5, -38.8);
      ctx.closePath();
      ctx.clip();

      ctx.globalAlpha = 0.86;
      ctx.fillStyle = color;
      ctx.fillRect(-2.5, -43.0, 10.8, 24.0);
      ctx.globalAlpha = 1;
      drawCylindricalWrapOverlay(ctx, -2.5, -43.0, 10.8, 24.0);
      ctx.restore();

      traceBarrel();
      ctx.lineWidth = 0.65;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.28)';
      ctx.stroke();

      // Longitudinal barrel gloss
      addRoundedRectPath(ctx, -0.7, -40.7, 1.65, 23.2, 0.82);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.52)';
      ctx.fill();
    }
  );
}

/**
 * 44x44 Architectural Geometric Shapes Crosshair Cursor (hotspot: 11, 11).
 */
function buildShapesHardwareCursor(color: string): string {
  return renderSupersampledHardwareCursor(
    `shapes:${color}`,
    44,
    44,
    11,
    11,
    'crosshair',
    (ctx, scale) => {
      // Crosshair with baked shadow + crisp white halo
      ctx.save();
      applyBakedShadow(ctx, scale, 2.2, 0.4, 1.2, 0.22);
      ctx.beginPath();
      ctx.moveTo(11, 4);
      ctx.lineTo(11, 18);
      ctx.moveTo(4, 11);
      ctx.lineTo(18, 11);
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(11, 4.5);
      ctx.lineTo(11, 17.5);
      ctx.moveTo(4.5, 11);
      ctx.lineTo(17.5, 11);
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(11, 11, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Overlapping rounded square
      ctx.save();
      applyBakedShadow(ctx, scale, 2.6, 0.4, 1.4, 0.22);
      addRoundedRectPath(ctx, 19, 18, 10.5, 10.5, 2.1);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.fill();
      clearBakedShadow(ctx);
      ctx.lineWidth = 1.65;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.96)';
      ctx.stroke();
      ctx.restore();

      addRoundedRectPath(ctx, 19, 18, 10.5, 10.5, 2.1);
      ctx.lineWidth = 1.55;
      ctx.strokeStyle = color;
      ctx.stroke();

      // Foreground precision circle with halo gap
      ctx.save();
      applyBakedShadow(ctx, scale, 2.6, 0.4, 1.4, 0.22);
      ctx.beginPath();
      ctx.arc(30, 29, 5.7, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      clearBakedShadow(ctx);
      ctx.lineWidth = 1.85;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.96)';
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(30, 29, 5.4, 0, Math.PI * 2);
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.stroke();
    }
  );
}

/**
 * 44x44 Masking Tape Crosshair & Serrated-Edge Ribbon Cursor (hotspot: 11, 11).
 */
function buildTapeHardwareCursor(color: string): string {
  return renderSupersampledHardwareCursor(
    `tape:${color}`,
    44,
    44,
    11,
    11,
    'crosshair',
    (ctx, scale) => {
      // Crosshair
      ctx.save();
      applyBakedShadow(ctx, scale, 2.2, 0.4, 1.2, 0.22);
      ctx.beginPath();
      ctx.moveTo(11, 4);
      ctx.lineTo(11, 18);
      ctx.moveTo(4, 11);
      ctx.lineTo(18, 11);
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(11, 4.5);
      ctx.lineTo(11, 17.5);
      ctx.moveTo(4.5, 11);
      ctx.lineTo(17.5, 11);
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(11, 11, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Clean masking-tape strip
      ctx.save();
      ctx.translate(27.5, 26.5);
      ctx.rotate((-20 * Math.PI) / 180);

      applyBakedShadow(ctx, scale, 2.6, 0.4, 1.4, 0.24);
      addRoundedRectPath(ctx, -10, -4.8, 20, 9.6, 1.7);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      clearBakedShadow(ctx);
      ctx.lineWidth = 1.65;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.stroke();

      addRoundedRectPath(ctx, -10, -4.8, 20, 9.6, 1.7);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 0.82;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.42)';
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.fillRect(-9.0, -4.2, 18.0, 1.65);

      ctx.beginPath();
      ctx.moveTo(-4.6, 3.6);
      ctx.lineTo(-0.6, -3.6);
      ctx.moveTo(2.4, 3.6);
      ctx.lineTo(6.4, -3.6);
      ctx.lineWidth = 1.55;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
      ctx.stroke();
      ctx.restore();
    }
  );
}

/**
 * 52x52 Frosted Target Ring + Studio Architectural Eraser Cursor (hotspot: 15, 37).
 */
function buildEraserHardwareCursor(): string {
  return renderSupersampledHardwareCursor(
    'eraser',
    52,
    52,
    15,
    37,
    'default',
    (ctx, scale) => {
      // Crystal-clear transparent target ring with crisp contrast
      ctx.save();
      applyBakedShadow(ctx, scale, 2.2, 0.3, 1.1, 0.2);
      ctx.beginPath();
      ctx.arc(15, 37, 10.2, 0, Math.PI * 2);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(15, 37, 10.2, 0, Math.PI * 2);
      ctx.lineWidth = 1.08;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(15, 37, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#E11D48';
      ctx.fill();

      // Studio pastel-rose & porcelain eraser
      ctx.save();
      ctx.translate(33.2, 16.8);
      ctx.rotate((-36 * Math.PI) / 180);

      applyBakedShadow(ctx, scale, 3.0, 0.4, 1.5, 0.25);
      addRoundedRectPath(ctx, -9.5, -5.4, 19.0, 10.8, 2.6);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      clearBakedShadow(ctx);
      ctx.lineWidth = 1.55;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.stroke();

      ctx.save();
      addRoundedRectPath(ctx, -9.5, -5.4, 19.0, 10.8, 2.6);
      ctx.clip();

      // Rose rubber
      const rubberGrad = ctx.createLinearGradient(-5, -5.4, -5, 5.4);
      rubberGrad.addColorStop(0, '#FFF5F9');
      rubberGrad.addColorStop(0.34, '#FCDCE8');
      rubberGrad.addColorStop(0.75, '#F2B4CC');
      rubberGrad.addColorStop(1, '#E397B4');
      ctx.fillStyle = rubberGrad;
      ctx.fillRect(-9.5, -5.4, 8.9, 10.8);

      // Crown highlight on rubber
      ctx.fillStyle = 'rgba(255, 255, 255, 0.56)';
      addRoundedRectPath(ctx, -8.3, -4.4, 6.8, 1.65, 0.8);
      ctx.fill();

      // Brushed aluminum ferrule
      const ferruleGrad = ctx.createLinearGradient(0.9, -5.4, 0.9, 5.4);
      ferruleGrad.addColorStop(0, '#F8FAFC');
      ferruleGrad.addColorStop(0.35, '#FFFFFF');
      ferruleGrad.addColorStop(0.68, '#CBD5E1');
      ferruleGrad.addColorStop(1, '#94A3B8');
      ctx.fillStyle = ferruleGrad;
      ctx.fillRect(-0.6, -5.4, 3.0, 10.8);

      // Porcelain architectural sleeve
      const sleeveGrad = ctx.createLinearGradient(5.9, -5.4, 5.9, 5.4);
      sleeveGrad.addColorStop(0, '#FFFFFF');
      sleeveGrad.addColorStop(0.32, '#F8FAFC');
      sleeveGrad.addColorStop(0.88, '#CED8E4');
      sleeveGrad.addColorStop(1, '#E1E8F0');
      ctx.fillStyle = sleeveGrad;
      ctx.fillRect(2.4, -5.4, 7.1, 10.8);
      ctx.restore();

      addRoundedRectPath(ctx, -9.5, -5.4, 19.0, 10.8, 2.6);
      ctx.lineWidth = 0.72;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.34)';
      ctx.stroke();
      ctx.restore();
    }
  );
}

/**
 * 44x44 Coiled Blue Lasso Selection Cursor (hotspot: 10, 11).
 */
function buildLassoHardwareCursor(): string {
  return renderSupersampledHardwareCursor(
    'lasso',
    44,
    44,
    10,
    11,
    'crosshair',
    (ctx, scale) => {
      const traceLoop = () => {
        ctx.beginPath();
        ctx.moveTo(10.6, 11.7);
        ctx.bezierCurveTo(10.8, 20.0, 16.5, 27.6, 25.0, 27.6);
        ctx.bezierCurveTo(32.0, 27.6, 35.6, 23.0, 34.0, 18.0);
        ctx.bezierCurveTo(32.5, 13.0, 25.6, 12.8, 21.4, 17.0);
        ctx.bezierCurveTo(17.6, 20.8, 20.4, 28.4, 26.8, 32.4);
        ctx.lineTo(29.8, 35.4);
      };

      // Crosshair + loop white halo + baked shadow
      ctx.save();
      applyBakedShadow(ctx, scale, 2.4, 0.4, 1.3, 0.22);
      ctx.beginPath();
      ctx.moveTo(10, 4);
      ctx.lineTo(10, 18);
      ctx.moveTo(3, 11);
      ctx.lineTo(17, 11);
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.stroke();

      traceLoop();
      ctx.lineWidth = 2.85;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.stroke();
      ctx.restore();

      // Crosshair foreground
      ctx.beginPath();
      ctx.moveTo(10, 4.5);
      ctx.lineTo(10, 17.5);
      ctx.moveTo(3.5, 11);
      ctx.lineTo(16.5, 11);
      ctx.lineWidth = 1.45;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#007AFF';
      ctx.stroke();

      // Subtle slate under-stroke for contrast on light backgrounds
      traceLoop();
      ctx.lineWidth = 1.55;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.4)';
      ctx.stroke();

      // Dashed blue lasso cord
      ctx.save();
      traceLoop();
      ctx.setLineDash([3.3, 2.4]);
      ctx.lineWidth = 1.55;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#007AFF';
      ctx.stroke();
      ctx.restore();
    }
  );
}

/**
 * 32x32 Sleek Optical Laser Dot OS-Hardware Cursor (hotspot: 16, 16).
 * Clean Apple Keynote-style luminous bead with soft aura & contrast rim; zero crosshairs.
 */
function buildLaserHardwareCursor(color: string): string {
  const parseRgb = (hex: string): [number, number, number] => {
    const clean = hex.replace('#', '').trim();
    if (clean.length === 3) {
      return [
        parseInt(clean[0] + clean[0], 16) || 239,
        parseInt(clean[1] + clean[1], 16) || 68,
        parseInt(clean[2] + clean[2], 16) || 68,
      ];
    }
    if (clean.length >= 6) {
      return [
        parseInt(clean.slice(0, 2), 16) || 239,
        parseInt(clean.slice(2, 4), 16) || 68,
        parseInt(clean.slice(4, 6), 16) || 68,
      ];
    }
    return [239, 68, 68];
  };

  return renderSupersampledHardwareCursor(
    `laser:${color}`,
    32,
    32,
    16,
    16,
    'crosshair',
    (ctx, scale) => {
      const [r, g, b] = parseRgb(color);

      // Soft translucent optical halo (cleanly fades well inside 32x32)
      const aura = ctx.createRadialGradient(16, 16, 2.2, 16, 16, 13.5);
      aura.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.56)`);
      aura.addColorStop(0.42, `rgba(${r}, ${g}, ${b}, 0.24)`);
      aura.addColorStop(0.76, `rgba(${r}, ${g}, ${b}, 0.06)`);
      aura.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(16, 16, 13.5, 0, Math.PI * 2);
      ctx.fill();

      // Subtle white contrast cushion + saturated laser jewel
      ctx.save();
      applyBakedShadow(ctx, scale, 1.8, 0, 0.9, 0.22);
      ctx.beginPath();
      ctx.arc(16, 16, 5.1, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      clearBakedShadow(ctx);
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.stroke();
      ctx.restore();

      // Crisp incandescent pinpoint core
      ctx.beginPath();
      ctx.arc(16, 16, 1.9, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
    }
  );
}

/**
 * Pure Native OS-Hardware Tool Cursor Controller.
 *
 * Uses 4x-supersampled HiDPI PNG cursors with baked soft studio drop shadows
 * and zero pointermove listeners or DOM overlays for 0.00ms Google Meet lag.
 */
export const AnnotationToolCursor: React.FC = () => {
  const {
    activeTool,
    penSettings,
    fountainSettings,
    pencilSettings,
    highlighterSettings,
    shapesSettings,
    tapeSettings,
    laserSettings,
  } = useAnnotationToolState();

  useEffect(() => {
    const isDrawingTool = activeTool !== 'cursor';
    document.body.classList.toggle('is-annotation-tool-active', isDrawingTool);
    return () => {
      document.body.classList.remove('is-annotation-tool-active');
    };
  }, [activeTool]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--annotation-pen-cursor',
      buildPenHardwareCursor(penSettings.color)
    );
  }, [penSettings.color]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--annotation-fountain-cursor',
      buildFountainHardwareCursor(fountainSettings.color)
    );
  }, [fountainSettings.color]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--annotation-pencil-cursor',
      buildPencilHardwareCursor(pencilSettings.color)
    );
  }, [pencilSettings.color]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--annotation-hl-cursor',
      buildHighlighterHardwareCursor(highlighterSettings.color)
    );
  }, [highlighterSettings.color]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--annotation-shapes-cursor',
      buildShapesHardwareCursor(shapesSettings.color)
    );
  }, [shapesSettings.color]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--annotation-tape-cursor',
      buildTapeHardwareCursor(tapeSettings.color)
    );
  }, [tapeSettings.color]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--annotation-laser-cursor',
      buildLaserHardwareCursor(laserSettings.color)
    );
  }, [laserSettings.color]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--annotation-eraser-cursor',
      buildEraserHardwareCursor()
    );
    document.documentElement.style.setProperty(
      '--annotation-lasso-cursor',
      buildLassoHardwareCursor()
    );
  }, []);

  return null;
};
