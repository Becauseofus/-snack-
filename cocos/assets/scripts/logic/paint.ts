/**
 * 把对局画成与引擎无关的命令。Cocos 的 Graphics 和预览页都回放同一份命令。
 * 坐标：场地局部，原点在左下，y 朝上。没有格子。
 */

import {
    BELLY,
    BELLY_B,
    BERRY,
    BODY_A,
    BODY_B,
    CYAN,
    EYE,
    EYE_RING,
    FIELD_BOT,
    FIELD_TOP,
    FRAME,
    GOLD,
    HEAD,
    OUTLINE,
    PANEL,
    PUPIL,
    SCALE_A,
    SCALE_B,
    TONGUE,
    VIOLET,
    mixHex,
    type FoodKind,
} from './config';
import type { FX } from './fx';
import { dedupe, resample, roundPath, roundRectPts, splitRuns, starPts, type Pt } from './path';
import type { SnakeWorld } from './SnakeWorld';

export interface DrawCmd {
    op: 'poly' | 'line' | 'circle' | 'ellipse';
    pts?: number[];
    x?: number;
    y?: number;
    r?: number;
    rx?: number;
    ry?: number;
    fill?: string;
    stroke?: string;
    sw?: number;
}

export interface FieldFrame {
    cmds: DrawCmd[];
    popups: Array<{ x: number; y: number; text: string; color: string; size: number }>;
}

const BLOBS = ['#2a1460', '#3c2078', '#1b305c', '#4a2068'];

function poly(pts: Pt[], fill?: string, stroke?: string, sw = 1): DrawCmd {
    const flat: number[] = [];
    for (const p of pts) {
        flat.push(p[0], p[1]);
    }
    return { op: 'poly', pts: flat, fill, stroke, sw };
}

function line(pts: Pt[], stroke: string, sw: number): DrawCmd {
    const flat: number[] = [];
    for (const p of pts) {
        flat.push(p[0], p[1]);
    }
    return { op: 'line', pts: flat, stroke, sw };
}

export function cellCenter(x: number, y: number, cell: number, rows: number): Pt {
    return [(x + 0.5) * cell, (rows - y - 0.5) * cell];
}

function hashKind(kind: string): number {
    let h = 0;
    for (let i = 0; i < kind.length; i++) {
        h = (h * 33 + kind.charCodeAt(i)) >>> 0;
    }
    return h;
}

function mulberry(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function snakePolylines(
    world: SnakeWorld,
    lead: number,
    cell: number,
    rows: number,
): { runs: Pt[][]; ghost: Pt[] | null; face: Pt } {
    let dx = world.direction[0];
    let dy = world.direction[1];
    let grow = false;
    let useLead = lead;
    if (world.alive) {
        grow = world.motion().will_grow;
    } else {
        dx = world.deathFace[0];
        dy = world.deathFace[1];
        useLead = 1;
        grow = world.deathGrow;
    }
    const [hx, hy] = world.snake[0];
    const pts: Pt[] = [cellCenter(hx + dx * useLead, hy + dy * useLead, cell, rows)];
    for (const [x, y] of world.snake) {
        pts.push(cellCenter(x, y, cell, rows));
    }
    if (!grow && world.snake.length >= 2 && useLead > 0) {
        const [tx, ty] = world.snake[world.snake.length - 1];
        const [px, py] = world.snake[world.snake.length - 2];
        if (Math.abs(tx - px) + Math.abs(ty - py) <= 1) {
            pts[pts.length - 1] = cellCenter(tx + (px - tx) * useLead, ty + (py - ty) * useLead, cell, rows);
        }
    }
    let ghost: Pt[] | null = null;
    if (world.alive && world.mode === 'zen' && useLead > 0) {
        const vx = hx + dx * useLead;
        const vy = hy + dy * useLead;
        const cx = (vx + 0.5) * cell;
        const cyDown = (vy + 0.5) * cell;
        const fieldW = world.cols * cell;
        const fieldH = world.rows * cell;
        if (cx < 0 || cyDown < 0 || cx > fieldW || cyDown > fieldH) {
            const gvx = ((vx % world.cols) + world.cols) % world.cols;
            const gvy = ((vy % world.rows) + world.rows) % world.rows;
            const head = cellCenter(gvx, gvy, cell, rows);
            let edge: Pt;
            if (dx < 0) {
                edge = [fieldW, head[1]];
            } else if (dx > 0) {
                edge = [0, head[1]];
            } else if (dy < 0) {
                edge = [head[0], 0];
            } else {
                edge = [head[0], fieldH];
            }
            ghost = [edge, head];
        }
    }
    const clean = dedupe(pts);
    const limit = cell * 1.75;
    const runs: Pt[][] = [];
    for (const run of splitRuns(clean, limit)) {
        if (run.length >= 2) {
            runs.push(roundPath(run, cell * 0.55));
        }
    }
    const len = Math.hypot(dx, dy) || 1;
    return { runs, ghost, face: [dx / len, -dy / len] };
}

function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
    const t2 = t * t;
    const t3 = t2 * t;
    return [
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    ];
}

function smoothClosed(pts: Pt[], slices = 5): Pt[] {
    const out: Pt[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n];
        const p1 = pts[i];
        const p2 = pts[(i + 1) % n];
        const p3 = pts[(i + 2) % n];
        for (let s = 0; s < slices; s++) {
            out.push(catmull(p0, p1, p2, p3, s / slices));
        }
    }
    return out;
}

function headLocal(): Pt[] {
    // 尖吻、宽颊、后颈与身子同宽，不收成一个点。单位稍后乘 cell。
    return smoothClosed([
        [1.28, 0],
        [0.96, 0.2],
        [0.55, 0.4],
        [0.08, 0.5],
        [-0.42, 0.46],
        [-0.82, 0.34],
        [-0.82, -0.34],
        [-0.42, -0.46],
        [0.08, -0.5],
        [0.55, -0.4],
        [0.96, -0.2],
    ]);
}

const HEAD_LOCAL = headLocal();

function rot(x: number, y: number, fx: number, fy: number): Pt {
    return [x * fx - y * fy, x * fy + y * fx];
}

function paintBody(cmds: DrawCmd[], run: Pt[], cell: number, pulse: number): void {
    const step = Math.max(3.5, cell * 0.22);
    const centers = resample(run, step);
    if (centers.length < 2) {
        return;
    }
    const base = Math.max(10, cell * 0.7) * pulse;
    const lens: number[] = [0];
    for (let i = 1; i < centers.length; i++) {
        lens.push(lens[i - 1] + Math.hypot(centers[i][0] - centers[i - 1][0], centers[i][1] - centers[i - 1][1]));
    }
    const total = lens[lens.length - 1] || 1;
    const taper = cell * 2.6;
    const widthAt = (i: number): number => {
        const fromTail = total - lens[i];
        if (fromTail >= taper) {
            return base;
        }
        const u = Math.max(0, fromTail / taper);
        return Math.max(0.8, base * Math.pow(u, 1.05));
    };
    const outlinePad = Math.max(3, cell * 0.09);
    const shift = Math.max(1.5, base * 0.12);
    // 圆头线段叠在一起，拐角是圆弧而不是斜切。先描边，再浅腹，再深背。
    for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < centers.length - 1; i++) {
            const w = (widthAt(i) + widthAt(i + 1)) / 2;
            const t = total <= 0 ? 0 : lens[i] / total;
            let sw = w;
            let color = mixHex(BELLY, BELLY_B, t);
            let oy = 0;
            if (pass === 0) {
                sw = w + outlinePad;
                color = OUTLINE;
            } else if (pass === 2) {
                sw = w * 0.62;
                color = mixHex(BODY_A, BODY_B, t);
                oy = shift;
            }
            cmds.push(line([
                [centers[i][0], centers[i][1] + oy],
                [centers[i + 1][0], centers[i + 1][1] + oy],
            ], color, sw));
        }
    }
    const end = centers[centers.length - 1];
    const prev = centers[Math.max(0, centers.length - 2)];
    let tx = end[0] - prev[0];
    let ty = end[1] - prev[1];
    const tlen = Math.hypot(tx, ty) || 1;
    tx /= tlen;
    ty /= tlen;
    const tipLen = Math.max(6, cell * 0.28);
    const tip: Pt = [end[0] + tx * tipLen, end[1] + ty * tipLen];
    const n: Pt = [-ty, tx];
    cmds.push(poly([
        [end[0] + n[0] * 1.6, end[1] + n[1] * 1.6],
        tip,
        [end[0] - n[0] * 1.6, end[1] - n[1] * 1.6],
    ], OUTLINE));
    cmds.push(poly([
        [end[0] + n[0] * 0.7, end[1] + n[1] * 0.7],
        [tip[0] - tx * 1.2, tip[1] - ty * 1.2],
        [end[0] - n[0] * 0.7, end[1] - n[1] * 0.7],
    ], BODY_B));

    let walked = 0;
    const spacing = Math.max(8, base * 0.85);
    let next = spacing * 0.7;
    let scaleI = 0;
    for (let i = 1; i < centers.length - 1; i++) {
        walked += lens[i] - lens[i - 1];
        if (walked < next) {
            continue;
        }
        next += spacing;
        const fromTail = total - lens[i];
        if (fromTail < taper * 0.45 || lens[i] < base) {
            continue;
        }
        const a = centers[i - 1];
        const b = centers[Math.min(centers.length - 1, i + 1)];
        let sx = b[0] - a[0];
        let sy = b[1] - a[1];
        const sl = Math.hypot(sx, sy) || 1;
        sx /= sl;
        sy /= sl;
        const s = widthAt(i) * 0.22;
        const c: Pt = [centers[i][0], centers[i][1] + shift * 0.45];
        cmds.push(poly([
            [c[0] + sx * s, c[1] + sy * s],
            [c[0] - sy * s * 0.72, c[1] + sx * s * 0.72],
            [c[0] - sx * s * 0.9, c[1] - sy * s * 0.9],
            [c[0] + sy * s * 0.72, c[1] - sx * s * 0.72],
        ], scaleI % 2 === 0 ? SCALE_A : SCALE_B, OUTLINE, 1));
        scaleI++;
    }
}

function paintHead(
    cmds: DrawCmd[],
    x: number,
    y: number,
    face: Pt,
    cell: number,
    pulse: number,
    blink: boolean,
    tongue: number,
): void {
    const scale = cell * 0.5 * pulse;
    const fx = face[0];
    const fy = face[1];
    const placed = HEAD_LOCAL.map((p) => {
        const r = rot(p[0] * scale, p[1] * scale, fx, fy);
        return [x + r[0], y + r[1]] as Pt;
    });
    cmds.push(poly(placed, HEAD, OUTLINE, Math.max(2, cell / 16)));
    // 眼睛贴在头的左右两侧（相对前进方向），琥珀色，竖缝瞳孔。没有白眼仁、腮红和嘴。
    const eyeR = Math.max(4.2, cell * 0.11) * pulse;
    for (const sign of [-1, 1]) {
        const local: Pt = [-0.08 * scale, sign * 0.46 * scale];
        const p = rot(local[0], local[1], fx, fy);
        const ex = x + p[0];
        const ey = y + p[1];
        cmds.push({ op: 'ellipse', x: ex, y: ey, rx: eyeR * 0.92, ry: eyeR * 0.78, fill: EYE, stroke: EYE_RING, sw: Math.max(1, cell / 30) });
        const shut = blink ? 0.2 : 1;
        cmds.push({
            op: 'ellipse',
            x: ex,
            y: ey,
            rx: Math.max(0.8, eyeR * 0.18),
            ry: Math.max(1.6, eyeR * 0.62 * shut),
            fill: PUPIL,
        });
    }

    if (tongue > 0.04) {
        const reach = cell * 0.62 * tongue;
        const base = rot(1.22 * scale, 0, fx, fy);
        const bx = x + base[0];
        const by = y + base[1];
        const mx = bx + fx * reach * 0.62;
        const my = by + fy * reach * 0.62;
        const spread = cell * 0.14;
        const tipL: Pt = [mx + fx * reach * 0.48 - fy * spread, my + fy * reach * 0.48 + fx * spread];
        const tipR: Pt = [mx + fx * reach * 0.48 + fy * spread, my + fy * reach * 0.48 - fx * spread];
        const sw = Math.max(1.4, cell / 18);
        cmds.push(line([[bx, by], [mx, my]], TONGUE, sw));
        cmds.push(line([[mx, my], tipL], TONGUE, sw));
        cmds.push(line([[mx, my], tipR], TONGUE, sw));
    }
}

function paintOrb(cmds: DrawCmd[], x: number, y: number, kind: FoodKind, cell: number, clock: number, blinkOff: boolean): void {
    const pulse = 1 + 0.07 * Math.sin(clock * 4 + (hashKind(kind) % 5));
    const r = cell * 0.3 * pulse;
    const palette: Record<FoodKind, [string, string, string]> = {
        berry: [BERRY, '#ffd0e2', '#ff4f86'],
        star: [GOLD, '#fff3c4', '#e0a020'],
        slow: [CYAN, '#e7fbff', '#3ec8e0'],
        mult: [VIOLET, '#f3e8ff', '#9a78e0'],
    };
    const [main, hi, edge] = palette[kind];
    cmds.push({ op: 'circle', x, y, r: r * 2.15, stroke: main, sw: 1 });
    cmds.push({ op: 'circle', x, y, r: r * 1.55, stroke: main, sw: 2 });
    if (blinkOff) {
        return;
    }
    if (kind === 'star') {
        cmds.push(poly(starPts(x, y, r * 1.35, r * 0.58), main, edge, 1));
        cmds.push({ op: 'ellipse', x: x - r * 0.12, y: y + r * 0.28, rx: r * 0.16, ry: r * 0.2, fill: hi });
        return;
    }
    cmds.push({ op: 'circle', x, y, r, fill: main, stroke: edge, sw: 1 });
    cmds.push({ op: 'ellipse', x: x - r * 0.28, y: y + r * 0.32, rx: r * 0.22, ry: r * 0.16, fill: hi });
    if (kind === 'berry') {
        cmds.push(poly([
            [x, y + r * 1.05],
            [x + r * 0.45, y + r * 1.55],
            [x + r * 0.15, y + r * 0.7],
        ], '#7dffb0'));
    } else if (kind === 'slow') {
        // 沙漏：两小团，中间收细。
        cmds.push({ op: 'ellipse', x, y: y + r * 0.32, rx: r * 0.38, ry: r * 0.28, fill: '#14515c' });
        cmds.push({ op: 'ellipse', x, y: y - r * 0.32, rx: r * 0.38, ry: r * 0.28, fill: '#14515c' });
        cmds.push(poly([
            [x - r * 0.12, y + r * 0.08],
            [x + r * 0.12, y + r * 0.08],
            [x, y - r * 0.02],
        ], '#e7fbff'));
    } else if (kind === 'mult') {
        // 莲灯：几片花瓣，倍率用弹出的字说明。
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + clock * 0.4;
            cmds.push({
                op: 'ellipse',
                x: x + Math.cos(a) * r * 0.28,
                y: y + Math.sin(a) * r * 0.28,
                rx: r * 0.28,
                ry: r * 0.16,
                fill: i % 2 ? '#f3e8ff' : '#9a78e0',
            });
        }
    }
}

export function paintBackground(w: number, h: number, cols: number, rows: number, clock: number): DrawCmd[] {
    const cmds: DrawCmd[] = [];
    const steps = 20;
    for (let i = 0; i < steps; i++) {
        const y0 = (h * i) / steps;
        const y1 = (h * (i + 1)) / steps + 1;
        const col = mixHex(FIELD_BOT, FIELD_TOP, i / Math.max(1, steps - 1));
        cmds.push(poly([[0, y0], [w, y0], [w, y1], [0, y1]], col));
    }
    const rng = mulberry(cols * 97 + rows * 13 + 7);
    for (let i = 0; i < 5; i++) {
        const cx = rng() * w;
        const cy = rng() * h;
        const r = (0.6 + rng()) * Math.max(cellGuess(w, h), 28) * 2.2;
        cmds.push({ op: 'circle', x: cx, y: cy, r, fill: BLOBS[Math.floor(rng() * BLOBS.length)] });
    }
    const twinkleRng = mulberry(cols * 17 + rows * 3 + 11);
    const twinkles: Array<[number, number, number]> = [];
    for (let i = 0; i < 26; i++) {
        twinkles.push([
            10 + twinkleRng() * Math.max(1, w - 20),
            10 + twinkleRng() * Math.max(1, h - 20),
            twinkleRng() * 6.2,
        ]);
    }
    for (const [x, y, ph] of twinkles) {
        const a = 0.5 + 0.5 * Math.sin(clock * 2.1 + ph);
        if (a < 0.42) {
            continue;
        }
        const r = 1 + a * 1.5;
        cmds.push({ op: 'circle', x, y, r, fill: '#f6eeff' });
    }
    cmds.push(poly(roundRectPts(2, 2, w - 4, h - 4, 10), undefined, FRAME, 2));
    return cmds;
}

function cellGuess(w: number, h: number): number {
    return Math.max(8, Math.min(w / 20, h / 12));
}

export interface PaintInput {
    world: SnakeWorld | null;
    cols: number;
    rows: number;
    cell: number;
    clock: number;
    lead: number;
    blink: boolean;
    pulse: number;
    tongue: number;
    fx: FX;
    mascot: boolean;
}

export function paintField(input: PaintInput): FieldFrame {
    const { world, cols, rows, cell, clock, fx } = input;
    const w = cols * cell;
    const h = rows * cell;
    const cmds = paintBackground(w, h, cols, rows, clock);
    const popups: FieldFrame['popups'] = [];
    if (input.mascot || !world) {
        paintMascot(cmds, w, h, cell, clock, input.tongue);
        return { cmds, popups };
    }
    if (world.berry) {
        const [x, y] = cellCenter(world.berry[0], world.berry[1], cell, rows);
        paintOrb(cmds, x, y, 'berry', cell, clock, false);
    }
    if (world.special) {
        const [x, y] = cellCenter(world.special.x, world.special.y, cell, rows);
        const blinkOff = world.special.ttl < 2.2 && Math.floor(clock * 8) % 2 === 0;
        paintOrb(cmds, x, y, world.special.kind, cell, clock, blinkOff);
    }
    const geo = snakePolylines(world, input.lead, cell, rows);
    for (const run of geo.runs) {
        paintBody(cmds, run, cell, input.pulse);
    }
    if (geo.runs.length && geo.runs[0].length) {
        const head = geo.runs[0][0];
        paintHead(cmds, head[0], head[1], geo.face, cell, input.pulse, input.blink, input.tongue);
    }
    if (geo.ghost) {
        paintBody(cmds, geo.ghost, cell, input.pulse);
        const head = geo.ghost[geo.ghost.length - 1];
        paintHead(cmds, head[0], head[1], geo.face, cell, input.pulse, input.blink, 0);
    }
    for (const p of fx.particles) {
        if (p.kind === 'ring') {
            cmds.push({ op: 'circle', x: p.x, y: p.y, r: Math.max(1, p.r), stroke: p.color, sw: 2 });
        } else {
            const k = 1 - p.age / Math.max(0.001, p.life);
            const r = Math.max(0.6, p.r * (0.45 + 0.55 * k));
            cmds.push({ op: 'circle', x: p.x, y: p.y, r, fill: p.color });
        }
    }
    const font = Math.max(12, cell / 3);
    for (const p of fx.popups) {
        popups.push({ x: p.x, y: p.y, text: p.text, color: p.color, size: font });
    }
    return { cmds, popups };
}

function paintMascot(cmds: DrawCmd[], w: number, h: number, cell: number, clock: number, tongue: number): void {
    const n = 22;
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x = w * 0.86 - t * w * 0.7;
        const yDown = h * 0.78 + Math.sin(clock * 1.35 + i * 0.48) * h * 0.03;
        pts.push([x, h - yDown]);
    }
    const look = Math.cos(clock * 1.35) * 0.35;
    const norm = Math.hypot(1, look) || 1;
    const face: Pt = [1 / norm, -look / norm];
    const c = Math.max(16, Math.min(cell, 34));
    paintBody(cmds, roundPath(pts, c * 0.45), c, 1);
    paintHead(cmds, pts[0][0], pts[0][1], face, c, 1, false, tongue);
    const bx = w * 0.42 + Math.sin(clock * 1.2) * 10;
    const by = h - (h * 0.62 + Math.sin(clock * 1.8) * 8);
    paintOrb(cmds, bx, by, 'berry', c, clock, false);
}

export function paintDim(w: number, h: number): DrawCmd {
    return poly([[0, 0], [w, 0], [w, h], [0, h]], '#0c0616aa');
}

export function paintCard(cx: number, cy: number, cw: number, ch: number, accent: string): DrawCmd[] {
    const pts = roundRectPts(cx - cw / 2, cy - ch / 2, cw, ch, 18);
    return [poly(pts, PANEL, accent, 2)];
}
