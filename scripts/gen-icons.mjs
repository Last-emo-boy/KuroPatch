// Generate minimal placeholder icon PNGs for the extension
// Run: node scripts/gen-icons.mjs
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, '..', 'public', 'icons');
mkdirSync(iconsDir, { recursive: true });

// Minimal 1x1 purple PNG (we'll use SVG favicons in practice, but Chrome needs PNGs)
// This creates a valid minimal PNG with the specified dimensions
function createPNG(size) {
  // Minimal PNG: 8-byte header + IHDR + IDAT + IEND
  // For simplicity, create an SVG and note: Chrome accepts SVG in some cases
  // but we'll create proper placeholder PNGs
  
  // Actually, let's create an SVG for now and convert later
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#6c63ff"/>
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="bold" font-size="${size * 0.5}">K</text>
</svg>`;
  return svg;
}

// Chrome MV3 requires PNG icons, but for dev we'll use a workaround
// Create SVG files that can be manually converted
for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(iconsDir, `icon${size}.svg`), createPNG(size));
  console.log(`Created icon${size}.svg`);
}

console.log('\nNote: Convert SVGs to PNGs for production. For dev loading, update manifest to use .svg');
