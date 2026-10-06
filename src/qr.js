import sharp from 'sharp';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

export async function decodeQrs(input) {
  const png = PNG.sync.read(await sharp(input).ensureAlpha().png().toBuffer());
  const results = new Map();
  // Overlapping tiles preserve small codes on large displays; full frame covers larger codes.
  const regions = [{ left: 0, top: 0, width: png.width, height: png.height }];
  const tile = 700;
  for (let top = 0; top < png.height; top += 500) {
    for (let left = 0; left < png.width; left += 500) {
      regions.push({ left, top, width: Math.min(tile, png.width - left), height: Math.min(tile, png.height - top) });
    }
  }
  for (const region of regions) {
    const { data, info } = await sharp(input).extract(region).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixels = new Uint8ClampedArray(data);
    for (let count = 0; count < 8; count++) {
      const code = jsQR(pixels, info.width, info.height, { inversionAttempts: 'attemptBoth' });
      if (!code) break;
      const points = [code.location.topLeftCorner, code.location.topRightCorner, code.location.bottomLeftCorner, code.location.bottomRightCorner];
      const left = Math.max(0, Math.floor(Math.min(...points.map(p => p.x))) - 8);
      const top = Math.max(0, Math.floor(Math.min(...points.map(p => p.y))) - 8);
      const right = Math.min(info.width, Math.ceil(Math.max(...points.map(p => p.x))) + 8);
      const bottom = Math.min(info.height, Math.ceil(Math.max(...points.map(p => p.y))) + 8);
      if (code.data) results.set(code.data, { value: code.data, crop: { left: left + region.left, top: top + region.top, width: right - left, height: bottom - top } });
      for (let y = top; y < bottom; y++) pixels.fill(255, (y * info.width + left) * 4, (y * info.width + right) * 4);
    }
  }
  return [...results.values()];
}
