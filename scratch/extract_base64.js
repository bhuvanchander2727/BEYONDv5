const fs = require('fs');
const path = require('path');

const content = fs.readFileSync('BEYOND – The Gallery (3D product hero).html', 'utf8');
const regex = /url\((data:image\/[^;]+;base64,[^)]+)\)/g;

let match;
let i = 0;
while ((match = regex.exec(content)) !== null) {
  const dataUrl = match[1];
  const commaIdx = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, commaIdx);
  const base64Data = dataUrl.slice(commaIdx + 1);
  const ext = header.includes('jpeg') ? 'jpg' : (header.includes('webp') ? 'webp' : 'png');
  const buf = Buffer.from(base64Data, 'base64');
  const outPath = path.join('scratch', `extracted_${i}.${ext}`);
  fs.writeFileSync(outPath, buf);
  console.log(`Extracted ${i}: ${outPath}, size: ${buf.length} bytes, header: ${header}`);
  i++;
}
