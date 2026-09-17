import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const source = path.resolve('public/icons/icon.svg');
const svg = await readFile(source);

for (const size of [16, 32, 48, 128]) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(path.resolve(`public/icons/icon-${size}.png`));
}
