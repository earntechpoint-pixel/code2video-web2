export interface SampleAnimation {
  name: string;
  code: string;
}

export const SAMPLES: SampleAnimation[] = [
  {
    name: 'Orbiting dots',
    code: `<!doctype html>
<html>
<head>
  <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#080b12}canvas{display:block;width:100%;height:100%}</style>
</head>
<body>
<canvas width="1280" height="720"></canvas>
<script>
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const TAU = Math.PI * 2;
const cycles = 2;
window.draw = (t) => {
  const p = (t / 4) % 1;
  ctx.fillStyle = '#080b12';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  for (let i = 0; i < 36; i++) {
    const a = p * TAU * cycles + i * TAU / 36;
    const r = 130 + Math.sin(a * 3) * 28;
    const x = cx + Math.cos(a) * r * 2.0;
    const y = cy + Math.sin(a) * r;
    const s = 5 + 3 * (0.5 + 0.5 * Math.sin(a * 2));
    ctx.beginPath();
    ctx.arc(x, y, s, 0, TAU);
    ctx.fillStyle = 'hsl(' + (190 + i * 4) + ' 85% 65%)';
    ctx.fill();
  }
};
</script>
</body>
</html>`,
  },
  {
    name: 'Gradient wave',
    code: `<!doctype html>
<html>
<head>
  <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050609}canvas{display:block;width:100%;height:100%}</style>
</head>
<body>
<canvas width="1280" height="720"></canvas>
<script>
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const TAU = Math.PI * 2;
window.draw = (t) => {
  const p = (t / 6) % 1;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#050609';
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, 'hsl(' + (240 + 30 * Math.sin(p * TAU)) + ' 80% 55%)');
  g.addColorStop(0.5, 'hsl(' + (300 + 35 * Math.sin(p * TAU + 1)) + ' 85% 60%)');
  g.addColorStop(1, 'hsl(' + (185 + 25 * Math.cos(p * TAU)) + ' 85% 55%)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.56);
  for (let x = 0; x <= w; x += 12) {
    const u = x / w;
    const y = h * 0.54 + Math.sin(u * TAU * 3 + p * TAU * 2) * 48 + Math.sin(u * TAU * 7 - p * TAU) * 18;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.globalAlpha = 0.82;
  ctx.fill();
  ctx.globalAlpha = 1;
};
</script>
</body>
</html>`,
  },
];
