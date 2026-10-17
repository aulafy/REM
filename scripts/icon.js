// PNG original, dibujado con píxeles y zlib del propio Node.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const size = 1024, rows = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const dx = Math.max(180 - x, x - 843, 0), dy = Math.max(180 - y, y - 843, 0);
  const inside = x >= 32 && x <= 991 && y >= 32 && y <= 991 && dx * dx + dy * dy <= 148 * 148;
  const radius = Math.hypot(x - 512, y - 512);
  const stem = x >= 365 && x <= 445 && y >= 280 && y <= 745;
  const bowl = x >= 415 && x <= 673 && y >= 280 && y <= 548 && (x <= 620 || (x - 620) ** 2 / 53 ** 2 + (y - 414) ** 2 / 134 ** 2 <= 1);
  const hole = x >= 445 && x <= 590 && y >= 359 && y <= 469;
  const leg = y >= 520 && y <= 745 && Math.abs(x - (470 + (y - 520) * 0.85)) <= 43;
  const white = stem || leg || (bowl && !hole) || (radius >= 368 && radius <= 380);
  const at = y * (size * 4 + 1) + 1 + x * 4;
  rows[at] = white ? 255 : 42; rows[at + 1] = white ? 255 : 67; rows[at + 2] = white ? 255 : 179; rows[at + 3] = inside ? 255 : 0;
}
const table = Array.from({ length: 256 }, (_, i) => { let n = i; for (let b = 0; b < 8; b++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc = (data) => { let n = 0xffffffff; for (const byte of data) n = table[(n ^ byte) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const header = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([header, data]))); return Buffer.concat([length, header, data, checksum]); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(process.argv[2], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
