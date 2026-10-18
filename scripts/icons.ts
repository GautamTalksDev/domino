// Renders PNG icons from the SVG logo (run once; outputs are committed).
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('src/app/icon.svg');
await sharp(svg, { density: 512 }).resize(180, 180).png().toFile('src/app/apple-icon.png');
await sharp(svg, { density: 512 }).resize(512, 512).png().toFile('public/icon-512.png');
await sharp(svg, { density: 512 }).resize(192, 192).png().toFile('public/icon-192.png');
const ico32 = await sharp(svg, { density: 256 }).resize(32, 32).png().toBuffer();
// A PNG-in-ICO favicon (supported by every current browser).
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(32, 6);
header.writeUInt8(32, 7);
header.writeUInt8(0, 8);
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(ico32.length, 14);
header.writeUInt32LE(22, 18);
writeFileSync('src/app/favicon.ico', Buffer.concat([header, ico32]));
console.log('icons written');
