/** 用和 Cocos 同一套绘制命令出一张对局图，方便在没有编辑器的机器上核对蛇的样子。 */
import { writeFileSync } from 'node:fs';
import { intervalMs } from '../assets/scripts/logic/config';
import { layoutChrome, type UiModel } from '../assets/scripts/logic/layout';
import { paintField, type DrawCmd } from '../assets/scripts/logic/paint';
import { FX } from '../assets/scripts/logic/fx';
import { SnakeWorld } from '../assets/scripts/logic/SnakeWorld';

const W = 1280;
const H = 720;

const model: UiModel = {
    phase: 'playing',
    help: false,
    historyOpen: false,
    selectedMode: 'classic',
    pendingMode: null,
    activeMode: 'classic',
    score: 80,
    best: 120,
    bestByMode: { classic: 120, zen: 40, challenge: 90 },
    lengthText: '16',
    buff: '慢动作 3.2s   双倍 ×2',
    speed: 5,
    soundOn: true,
    soundAvailable: true,
    resultScore: 0,
    resultLen: 0,
    resultMode: 'classic',
    newRecord: false,
    newModeRecord: false,
    victory: false,
    history: [],
    mobile: false,
    scoreHot: false,
    confirmClear: false,
    displayOpen: false,
    displayChoices: [],
    displayMode: 'window',
    displayWidth: 1280,
    displayHeight: 720,
    displayLine: '逻辑 1280×720 · 渲染 1280×720 窗口',
};

let chrome = layoutChrome(W, H, model, 1.2);
const world = new SnakeWorld(chrome.field.cols, chrome.field.rows, 'classic', undefined, false);
const midY = Math.floor(chrome.field.rows / 2);
const headX = Math.min(chrome.field.cols - 4, Math.floor(chrome.field.cols * 0.62));
world.snake = [];
for (let i = 0; i < 8; i++) {
    world.snake.push([headX - i, midY - 1]);
}
for (let i = 0; i < 4; i++) {
    world.snake.push([headX - 7, midY + i]);
}
for (let i = 1; i <= 6; i++) {
    world.snake.push([headX - 7 + i, midY + 3]);
}
world.direction = [1, 0];
world.berry = [Math.min(chrome.field.cols - 2, headX + 4), midY - 1];
world.special = { x: Math.min(chrome.field.cols - 3, headX + 2), y: Math.min(chrome.field.rows - 2, midY + 5), kind: 'star', ttl: 6.4 };
world.score = 80;
world.slowLeft = 3.2;
world.mult = 2;
world.multLeft = 2;
world.eaten = 6;
world.pendingGrow = 0;
model.lengthText = String(world.snake.length);
chrome = layoutChrome(W, H, model, 1.2);

const frame = paintField({
    world,
    cols: chrome.field.cols,
    rows: chrome.field.rows,
    cell: chrome.field.cell,
    clock: 1.2,
    lead: 0.35,
    blink: false,
    pulse: 1,
    tongue: 0.92,
    fx: new FX(),
    mascot: false,
});

const html = `<!DOCTYPE html>
<meta charset="utf-8">
<title>贪吃蛇</title>
<style>
  html, body { margin: 0; background: #140c24; }
  canvas { display: block; }
</style>
<canvas id="c" width="${W}" height="${H}"></canvas>
<script>
const W = ${W}, H = ${H};
const field = ${JSON.stringify(chrome.field)};
const worldCmds = ${JSON.stringify(frame.cmds)};
const labels = ${JSON.stringify(chrome.labels)};
const buttons = ${JSON.stringify(chrome.buttons)};
const slider = ${JSON.stringify(chrome.slider)};
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
ctx.lineJoin = 'round';
ctx.lineCap = 'round';
if (!ctx.roundRect) {
  ctx.roundRect = function (x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  };
}
function Y(y) { return H - y; }
function path(pts, ox, oy) {
  ctx.beginPath();
  ctx.moveTo(ox + pts[0], Y(oy + pts[1]));
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(ox + pts[i], Y(oy + pts[i + 1]));
}
function paint(cmds, ox, oy) {
  for (const c of cmds) {
    if ((c.op === 'poly' || c.op === 'line') && c.pts) {
      path(c.pts, ox, oy);
      if (c.op === 'poly') ctx.closePath();
      if (c.fill) { ctx.fillStyle = c.fill; ctx.fill(); }
      if (c.stroke || c.op === 'line') {
        ctx.strokeStyle = c.stroke || '#fff';
        ctx.lineWidth = c.sw || 1;
        path(c.pts, ox, oy);
        if (c.op === 'poly') ctx.closePath();
        ctx.stroke();
      }
    } else if (c.op === 'circle') {
      ctx.beginPath();
      ctx.arc(ox + c.x, Y(oy + c.y), c.r, 0, Math.PI * 2);
      if (c.fill) { ctx.fillStyle = c.fill; ctx.fill(); }
      if (c.stroke) { ctx.strokeStyle = c.stroke; ctx.lineWidth = c.sw || 1; ctx.stroke(); }
    } else if (c.op === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(ox + c.x, Y(oy + c.y), c.rx, c.ry, 0, 0, Math.PI * 2);
      if (c.fill) { ctx.fillStyle = c.fill; ctx.fill(); }
      if (c.stroke) { ctx.strokeStyle = c.stroke; ctx.lineWidth = c.sw || 1; ctx.stroke(); }
    }
  }
}
ctx.fillStyle = '#140c24';
ctx.fillRect(0, 0, W, H);
paint(worldCmds, field.x, field.y);
for (const b of buttons) {
  const x = b.parent === 'field' ? field.x + b.x : b.x;
  const y = b.parent === 'field' ? field.y + b.y : b.y;
  ctx.beginPath();
  ctx.roundRect(x - b.w / 2, Y(y) - b.h / 2, b.w, b.h, 6);
  ctx.fillStyle = !b.enabled ? '#241845' : (b.primary || b.selected) ? '#ff7eb6' : '#2a1b55';
  ctx.fill();
  ctx.fillStyle = b.enabled && (b.selected || b.primary) ? '#ffffff' : '#cbbbe8';
  ctx.font = 'bold 14px "Microsoft YaHei", "WenQuanYi Micro Hei", "Noto Sans CJK SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(b.text, x, Y(y));
}
const t = (slider.value - 1) / 9;
ctx.beginPath();
ctx.roundRect(slider.x - slider.w / 2, Y(slider.y) - slider.h / 2, slider.w, slider.h, slider.h / 2);
ctx.fillStyle = '#3a2a70';
ctx.fill();
ctx.beginPath();
ctx.roundRect(slider.x - slider.w / 2, Y(slider.y) - slider.h / 2, Math.max(slider.h, slider.w * t), slider.h, slider.h / 2);
ctx.fillStyle = '#ff7eb6';
ctx.fill();
ctx.beginPath();
ctx.arc(slider.x - slider.w / 2 + slider.w * t, Y(slider.y), 9, 0, Math.PI * 2);
ctx.fillStyle = '#fff6fb';
ctx.fill();
ctx.strokeStyle = '#ff7eb6';
ctx.lineWidth = 2;
ctx.stroke();
for (const lab of labels) {
  const x = lab.parent === 'field' ? field.x + lab.x : lab.x;
  const y = lab.parent === 'field' ? field.y + lab.y : lab.y;
  ctx.fillStyle = lab.color;
  ctx.font = (lab.bold ? 'bold ' : '') + lab.size + 'px "Microsoft YaHei", "WenQuanYi Micro Hei", "Noto Sans CJK SC", sans-serif';
  ctx.textAlign = lab.align;
  ctx.textBaseline = 'middle';
  ctx.fillText(lab.text, x, Y(y));
}
</script>
`;

writeFileSync('/tmp/snake-preview.html', html);
console.log('wrote /tmp/snake-preview.html', 'cell', chrome.field.cell, 'snake', world.snake.length, 'interval', intervalMs(5, 'classic', 0, 0));
void (0 as unknown as DrawCmd);
