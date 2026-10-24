const fs = require('fs');

const f1 = 'BEYOND – The Gallery (3D product hero).html';
if (fs.existsSync(f1)) {
  const content = fs.readFileSync(f1, 'utf8');
  console.log('File size:', content.length);
  const imgs = content.match(/<img[^>]+>/gi) || [];
  console.log('Found <img> tags:', imgs.length);
  imgs.forEach(img => console.log('IMG:', img.slice(0, 150)));

  const urls = content.match(/url\([^)]+\)/gi) || [];
  console.log('Found url() in CSS:', urls.length);
  urls.forEach(u => console.log('URL:', u.slice(0, 150)));

  const srcMatches = content.match(/src\s*=\s*["']([^"']+)["']/gi) || [];
  console.log('src matches:', srcMatches.slice(0, 20));
} else {
  console.log('File does not exist');
}
