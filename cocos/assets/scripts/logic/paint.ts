/**
 * 把对局画成与引擎无关的命令。Cocos 的 Graphics 和预览页都回放同一份命令。
 * 坐标：场地局部，原点在左下，y 向上。
 *
 * 这一版的三处关键变化：
 *   1) 穿墙（禅意）改成“环形世界投影”：先把蛇在世界坐标里连续展开，
 *      再按 ±场地宽/高 复制若干份并裁剪到场地矩形内，任何模式都不会画到场地外。
 *   2) 背景拆成静态层（渐变/光斑/边框）与动态层（星点），静态层只在尺寸变化时重建。
 *   3) 蛇身按“等宽合并”描边，并把颜色渐变量化缓存，长蛇时每帧指令数降一个数量级。
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
    op: 'poly' | 'line' | 'stroke' | 'circle' | 'ellipse';
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

/** 折线点：x, y, 半宽, 渐变相位(0..1), 弧长 */
type ClipPt = [number, number, number, number, number];

function poly(pts: Pt[], fill?: string, stroke?: string, sw = 1): DrawCmd {
    const flat: number[] = [];
    for (const p of pts) {
        flat.push(p[0], p[1]);
    }
    return { op: 'poly', pts: flat, fill, stroke, sw };
}

function line(a: Pt, b: Pt, stroke: string, sw: number): DrawCmd {
    return { op: 'line', pts: [a[0], a[1], b[0], b[1]], stroke, sw };
}

function strokePath(pts: number[], color: string, sw: number): DrawCmd {
    return { op: 'stroke', pts, stroke: color, sw };
}

function circle(x: number, y: number, r: number, fill?: string, stroke?: string, sw?: number): DrawCmd {
    return { op: 'circle', x, y, r, fill, stroke, sw };
}

function ellipse(x: number, y: number, rx: number, ry: number, fill?: string, stroke?: string, sw?: number): DrawCmd {
    return { op: 'ellipse', x, y, rx, ry, fill, stroke, sw };
}

/** 固定序列随机数：同一个场地尺寸永远得到同一片星空 */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 1831565813) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 把颜色渐变量化成固定档位，避免每帧生成大量临时字符串 */
function gradient(from: string, to: string, steps = 16): (t: number) => string {
    const cache = new Array<string>(steps + 1);
    return (t: number) => {
        const i = Math.round((t < 0 ? 0 : t > 1 ? 1 : t) * steps);
        let v = cache[i];
        if (v === undefined) {
            v = mixHex(from, to, i / steps);
            cache[i] = v;
        }
        return v;
    };
}

const bellyGrad = gradient(BELLY_B, BELLY);
const bodyGrad = gradient(BODY_B, BODY_A);

/* ------------------------------------------------------------------ *
 * 矩形裁剪（场地即视口，穿墙时用平移副本模拟环形世界）
 * ------------------------------------------------------------------ */

/** Liang–Barsky：返回线段在矩形内的参数区间 [t0, t1]，完全在外返回 null */
function clipSegment(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    w: number,
    h: number
): [number, number] | null {
    let t0 = 0;
    let t1 = 1;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const p = [-dx, dx, -dy, dy];
    const q = [x0, w - x0, y0, h - y0];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0) return null;
        } else {
            const r = q[i] / p[i];
            if (p[i] < 0) {
                if (r > t1) return null;
                if (r > t0) t0 = r;
            } else {
                if (r < t0) return null;
                if (r < t1) t1 = r;
            }
        }
    }
    return [t0, t1];
}

function clipPolyline(pts: ClipPt[], w: number, h: number): ClipPt[][] {
    const out: ClipPt[][] = [];
    let cur: ClipPt[] | null = null;
    for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const r = clipSegment(a[0], a[1], b[0], b[1], w, h);
        if (!r) {
            cur = null;
            continue;
        }
        const [t0, t1] = r;
        const av: ClipPt = [
            a[0] + (b[0] - a[0]) * t0,
            a[1] + (b[1] - a[1]) * t0,
            a[2] + (b[2] - a[2]) * t0,
            a[3] + (b[3] - a[3]) * t0,
            a[4] + (b[4] - a[4]) * t0,
        ];
        const bv: ClipPt = [
            a[0] + (b[0] - a[0]) * t1,
            a[1] + (b[1] - a[1]) * t1,
            a[2] + (b[2] - a[2]) * t1,
            a[3] + (b[3] - a[3]) * t1,
            a[4] + (b[4] - a[4]) * t1,
        ];
        if (!cur) {
            cur = [av];
            out.push(cur);
        } else {
            const last = cur[cur.length - 1];
            if (Math.abs(last[0] - av[0]) > 1e-4 || Math.abs(last[1] - av[1]) > 1e-4) {
                cur = [av];
                out.push(cur);
            }
        }
        cur.push(bv);
        if (t1 < 1) cur = null;
    }
    const keep: ClipPt[][] = [];
    for (const piece of out) {
        if (piece.length >= 2) keep.push(piece);
    }
    return keep;
}

/** Sutherland–Hodgman：凸多边形裁剪到矩形 */
function clipPolygon(pts: Pt[], w: number, h: number): Pt[] | null {
    let out: Pt[] = pts.map((p) => [p[0], p[1]] as Pt);
    const inside = [
        (p: Pt) => p[0] >= 0,
        (p: Pt) => p[0] <= w,
        (p: Pt) => p[1] >= 0,
        (p: Pt) => p[1] <= h,
    ];
    const cut = [
        (a: Pt, b: Pt): Pt => [0, a[1] + (b[1] - a[1]) * (-a[0] / (b[0] - a[0]))],
        (a: Pt, b: Pt): Pt => [w, a[1] + (b[1] - a[1]) * ((w - a[0]) / (b[0] - a[0]))],
        (a: Pt, b: Pt): Pt => [a[0] + (b[0] - a[0]) * (-a[1] / (b[1] - a[1])), 0],
        (a: Pt, b: Pt): Pt => [a[0] + (b[0] - a[0]) * ((h - a[1]) / (b[1] - a[1])), h],
    ];
    for (let e = 0; e < 4 && out.length; e++) {
        const next: Pt[] = [];
        for (let i = 0; i < out.length; i++) {
            const cur = out[i];
            const prev = out[(i + out.length - 1) % out.length];
            const cin = inside[e](cur);
            const pin = inside[e](prev);
            if (cin) {
                if (!pin) next.push(cut[e](prev, cur));
                next.push(cur);
            } else if (pin) {
                next.push(cut[e](prev, cur));
            }
        }
        out = next;
    }
    return out.length >= 3 ? out : null;
}

/** 环形世界里，一段几何需要复制到哪些平移位置才可能可见 */
function wrapOffsets(box: { minX: number; minY: number; maxX: number; maxY: number }, w: number, h: number, zen: boolean): Pt[] {
    if (!zen) return [[0, 0]];
    const kx0 = Math.ceil(-box.maxX / w);
    const kx1 = Math.floor((w - box.minX) / w);
    const ky0 = Math.ceil(-box.maxY / h);
    const ky1 = Math.floor((h - box.minY) / h);
    const out: Pt[] = [];
    for (let kx = kx0; kx <= kx1 && out.length < 16; kx++) {
        for (let ky = ky0; ky <= ky1 && out.length < 16; ky++) out.push([kx * w, ky * h]);
    }
    return out.length ? out : [[0, 0]];
}

/* ------------------------------------------------------------------ *
 * 静态背景 / 动态星点
 * ------------------------------------------------------------------ */

/** 静态背景：渐变带 + 固定光斑 + 外框，只在场地尺寸变化时重建 */
export function paintBackground(w: number, h: number, cols: number, rows: number): DrawCmd[] {
    const cmds: DrawCmd[] = [];
    for (let i = 0; i < 20; i++) {
        const y0 = (h * i) / 20;
        const y1 = (h * (i + 1)) / 20 + 1;
        cmds.push(poly([[0, y0], [w, y0], [w, y1], [0, y1]], mixHex(FIELD_TOP, FIELD_BOT, i / 19)));
    }
    const rnd = rng(97 * cols + 13 * rows + 7);
    const unit = Math.max(8, Math.min(w / 20, h / 12));
    for (let i = 0; i < 5; i++) {
        const x = rnd() * w;
        const y = rnd() * h;
        const r = (0.6 + rnd()) * unit * 2.2;
        cmds.push(circle(x, y, r, BLOBS[Math.floor(rnd() * BLOBS.length)]));
    }
    cmds.push(poly(roundRectPts(2, 2, w - 4, h - 4, 10), undefined, FRAME, 2));
    return cmds;
}

/** 星点：x, y, 闪烁相位 */
export type Star = [number, number, number];

export function makeStars(w: number, h: number, cols: number, rows: number): Star[] {
    const rnd = rng(17 * cols + 3 * rows + 11);
    const list: Star[] = [];
    for (let i = 0; i < 26; i++) {
        list.push([10 + rnd() * Math.max(1, w - 20), 10 + rnd() * Math.max(1, h - 20), 6.2 * rnd()]);
    }
    return list;
}

function starsInto(cmds: DrawCmd[], stars: Star[], clock: number): void {
    for (const s of stars) {
        const rnd = s[2];
        const k = 0.5 + 0.5 * Math.sin(2.1 * clock + rnd);
        if (k < 0.42) continue;
        cmds.push(circle(s[0], s[1], 1 + 1.5 * k, '#f6eeff'));
    }
}

/* ------------------------------------------------------------------ *
 * 蛇体几何
 * ------------------------------------------------------------------ */

export function cellCenter(x: number, y: number, cell: number, rows: number): Pt {
    return [(x + 0.5) * cell, (rows - y - 0.5) * cell];
}

/** 把蛇的格子坐标沿路径“展开”，使禅意模式下的穿墙不再产生跳点 */
function unwrapCells(world: SnakeWorld, cols: number, rows: number): Pt[] {
    const zen = world.mode === 'zen';
    const cells: Pt[] = [];
    let pc = 0;
    let pr = 0;
    for (let i = 0; i < world.snake.length; i++) {
        let c = world.snake[i][0];
        let r = world.snake[i][1];
        if (zen && i > 0) {
            c += cols * Math.round((pc - c) / cols);
            r += rows * Math.round((pr - r) / rows);
        }
        cells.push([c, r]);
        pc = c;
        pr = r;
    }
    return cells;
}

interface Run {
    pts: ClipPt[];
    cell: number;
    maxW: number;
    total: number;
    span: number;
}

/** 连续路径（像素坐标），并计算尾部收缩所需的弧长信息 */
function prepareRun(path: Pt[], cell: number, pulse: number): Run | null {
    let rough = 0;
    for (let i = 1; i < path.length; i++) {
        rough += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    }
    const step = Math.max(4, 0.22 * cell, rough / 620);
    const pts = resample(path, step);
    if (pts.length < 2) return null;
    const maxW = Math.max(10, 0.7 * cell) * pulse;
    const acc: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
        acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const total = acc[acc.length - 1] || 1;
    const span = 2.2 * cell;
    // 尾端收细的比例：收得太细太长会像一根针/分叉，这里保持柔和的锥形 + 圆头
    const tipW = Math.max(5.5, maxW * 0.22);
    const out: ClipPt[] = [];
    for (let i = 0; i < pts.length; i++) {
        const d = total - acc[i];
        const w = d >= span ? maxW : Math.max(tipW, maxW * Math.pow(Math.max(0, d / span), 0.85));
        out.push([pts[i][0], pts[i][1], w, acc[i] / total, acc[i]]);
    }
    return { pts: out, cell, maxW, total, span };
}

/** 一段蛇身：三段描边（描边/腹部/主体）+ 鳞片 */
function emitRun(cmds: DrawCmd[], run: Run, dx: number, dy: number, w: number, h: number): void {
    const pts: ClipPt[] = run.pts.map((p) => [p[0] + dx, p[1] + dy, p[2], p[3], p[4]] as ClipPt);
    const pieces = clipPolyline(pts, w, h);
    if (!pieces.length) return;

    const cell = run.cell;
    const maxW = run.maxW;
    const edge = Math.max(3, 0.09 * cell);
    const lift = Math.max(1.5, 0.12 * maxW);

    for (let pass = 0; pass < 3; pass++) {
        for (const piece of pieces) {
            let i = 0;
            while (i + 1 < piece.length) {
                const base = piece[i][2];
                let j = i + 1;
                while (j + 1 < piece.length && j - i < 8 && Math.abs(piece[j][2] - base) <= 0.8) j += 1;
                const width = (piece[i][2] + piece[j][2]) * 0.5;
                const ratio = (piece[i][3] + piece[j][3]) * 0.5;
                // 描边宽度、高光偏移都随粗细一起收敛，尾尖三层才会收成一点
                const taperK = Math.min(1, width / maxW);
                const offY = pass === 2 ? lift * taperK : 0;
                const flat: number[] = [];
                for (let q = i; q <= j; q++) flat.push(piece[q][0], piece[q][1] + offY);
                if (pass === 0) cmds.push(strokePath(flat, OUTLINE, width + edge * taperK));
                else if (pass === 1) cmds.push(strokePath(flat, bellyGrad(ratio), width));
                else cmds.push(strokePath(flat, bodyGrad(ratio), 0.62 * width));
                i = j;
            }
        }
    }

    // 鳞片：沿弧长等距，避开头部与尾部收尖区域
    const step = Math.max(8, 0.85 * maxW);
    let mark = 0.7 * step;
    let even = 0;
    for (const piece of pieces) {
        for (let i = 1; i + 1 < piece.length; i++) {
            const s = piece[i][4];
            while (s >= mark) {
                mark += step;
                if (run.total - s < 0.45 * run.span || s < maxW) continue;
                const prev = piece[i - 1];
                const next = piece[i + 1];
                let ax = next[0] - prev[0];
                let ay = next[1] - prev[1];
                const len = Math.hypot(ax, ay) || 1;
                ax /= len;
                ay /= len;
                const r = 0.22 * piece[i][2];
                const cx = piece[i][0];
                const cy = piece[i][1] + 0.45 * lift;
                const quad = clipPolygon(
                    [
                        [cx + ax * r, cy + ay * r],
                        [cx - ay * r * 0.72, cy + ax * r * 0.72],
                        [cx - ax * r * 0.9, cy - ay * r * 0.9],
                        [cx + ay * r * 0.72, cy - ax * r * 0.72],
                    ],
                    w,
                    h
                );
                if (quad) cmds.push(poly(quad, even % 2 === 0 ? SCALE_A : SCALE_B, OUTLINE, 1));
                even += 1;
            }
        }
    }
}

/** 蛇头轮廓（默认朝 +x 的闭合样条） */
const HEAD_OUTLINE: Pt[] = (() => {
    const ctrl: Pt[] = [
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
    ];
    const out: Pt[] = [];
    const n = ctrl.length;
    const nS = 5;
    for (let i = 0; i < n; i++) {
        const p0 = ctrl[(i + n - 1) % n];
        const p1 = ctrl[i];
        const p2 = ctrl[(i + 1) % n];
        const p3 = ctrl[(i + 2) % n];
        for (let t = 0; t < nS; t++) {
            const s = t / nS;
            const s2 = s * s;
            const s3 = s2 * s;
            out.push([
                0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * s + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * s2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * s3),
                0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * s + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3),
            ]);
        }
    }
    return out;
})();

function emitHead(
    cmds: DrawCmd[],
    head: { x: number; y: number; face: Pt },
    cell: number,
    pulse: number,
    blink: boolean,
    tongue: number,
    dx: number,
    dy: number,
    w: number,
    h: number
): void {
    const x = head.x + dx;
    const y = head.y + dy;
    const fx = head.face[0];
    const fy = head.face[1];
    const a = 0.5 * cell * pulse;
    const outline: Pt[] = [];
    for (const p of HEAD_OUTLINE) {
        const px = p[0] * a;
        const py = p[1] * a;
        outline.push([x + px * fx - py * fy, y + px * fy + py * fx]);
    }
    const clipped = clipPolygon(outline, w, h);
    if (clipped) cmds.push(poly(clipped, HEAD, OUTLINE, Math.max(2, cell / 16)));

    // 眼睛/舌头只在头部中心仍处于场地内时绘制，避免在墙边被切出半个眼球
    if (!(x >= 0 && x <= w && y >= 0 && y <= h)) return;

    const p = Math.max(4.2, 0.11 * cell) * pulse;
    for (let e = -1; e <= 1; e += 2) {
        const lx = -0.08 * a;
        const ly = 0.46 * e * a;
        const ex = x + lx * fx - ly * fy;
        const ey = y + lx * fy + ly * fx;
        cmds.push(ellipse(ex, ey, 0.92 * p, 0.78 * p, EYE, EYE_RING, Math.max(1, cell / 30)));
        const look = blink ? 0.2 : 1;
        cmds.push(ellipse(ex, ey, Math.max(0.8, 0.18 * p), Math.max(1.6, 0.62 * p * look), PUPIL));
    }

    if (tongue > 0.04) {
        const len = 0.62 * cell * tongue;
        const bx = 1.22 * a;
        const tx = x + bx * fx;
        const ty = y + bx * fy;
        const ux = tx + fx * len * 0.62;
        const uy = ty + fy * len * 0.62;
        const spread = 0.14 * cell;
        const a0: Pt = [ux + fx * len * 0.48 - fy * spread, uy + fy * len * 0.48 + fx * spread];
        const a1: Pt = [ux + fx * len * 0.48 + fy * spread, uy + fy * len * 0.48 - fx * spread];
        const sw = Math.max(1.4, cell / 18);
        const arms: Array<[number, number, number, number]> = [
            [tx, ty, ux, uy],
            [ux, uy, a0[0], a0[1]],
            [ux, uy, a1[0], a1[1]],
        ];
        for (const seg of arms) {
            const r = clipSegment(seg[0], seg[1], seg[2], seg[3], w, h);
            if (!r) continue;
            cmds.push(
                line(
                    [seg[0] + (seg[2] - seg[0]) * r[0], seg[1] + (seg[3] - seg[1]) * r[0]],
                    [seg[0] + (seg[2] - seg[0]) * r[1], seg[1] + (seg[3] - seg[1]) * r[1]],
                    TONGUE,
                    sw
                )
            );
        }
    }
}

export interface SnakeGeometry {
    runs: Run[];
    head: { x: number; y: number; face: Pt };
    box: { minX: number; minY: number; maxX: number; maxY: number };
}

/** 蛇的完整几何：连续展开后的若干条折线 + 头部信息 + 包围盒 */
export function snakePolylines(world: SnakeWorld, lead: number, cell: number, cols: number, rows: number, pulse = 1): SnakeGeometry {
    const alive = world.alive;
    const dir = alive ? world.direction : world.deathFace;
    const glide = alive ? lead : 1;
    const grown = alive ? world.motion().will_grow : world.deathGrow;

    const cells = unwrapCells(world, cols, rows);
    const head = cells[0];
    const raw: Pt[] = [[head[0] + dir[0] * glide, head[1] + dir[1] * glide]];
    for (const c of cells) raw.push([c[0], c[1]]);

    const tail = cells[cells.length - 1];
    const before = cells[cells.length - 2];
    if (!grown && glide > 0 && before && Math.abs(tail[0] - before[0]) + Math.abs(tail[1] - before[1]) <= 1) {
        raw[raw.length - 1] = [tail[0] + (before[0] - tail[0]) * glide, tail[1] + (before[1] - tail[1]) * glide];
    }

    const px: Pt[] = raw.map((c) => cellCenter(c[0], c[1], cell, rows));

    const runs: Run[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const piece of splitRuns(dedupe(px), 1.75 * cell)) {
        // 直接对格子中心的折线做圆角，不能提前重采样：重采样会跳过拐角点，转弯会“削角”
        const smooth = roundPath(piece, 0.55 * cell);
        const run = prepareRun(smooth, cell, pulse);
        if (!run) continue;
        runs.push(run);
        for (const p of run.pts) {
            const pad = p[2] + Math.max(3, 0.12 * cell);
            if (p[0] - pad < minX) minX = p[0] - pad;
            if (p[0] + pad > maxX) maxX = p[0] + pad;
            if (p[1] - pad < minY) minY = p[1] - pad;
            if (p[1] + pad > maxY) maxY = p[1] + pad;
        }
    }

    const m = Math.hypot(dir[0], dir[1]) || 1;
    return {
        runs,
        head: { x: px[0][0], y: px[0][1], face: [dir[0] / m, -dir[1] / m] },
        box: { minX, minY, maxX, maxY },
    };
}

/* ------------------------------------------------------------------ *
 * 目标物
 * ------------------------------------------------------------------ */

const FOOD_STYLE: Record<FoodKind, [string, string, string]> = {
    berry: [BERRY, '#ffd0e2', '#ff4f86'],
    star: [GOLD, '#fff3c4', '#e0a020'],
    slow: [CYAN, '#e7fbff', '#3ec8e0'],
    mult: [VIOLET, '#f3e8ff', '#9a78e0'],
};

function hashOf(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (33 * h + s.charCodeAt(i)) >>> 0;
    return h;
}

function paintFood(cmds: DrawCmd[], x: number, y: number, kind: FoodKind, cell: number, clock: number, blink: boolean): void {
    const l = 0.3 * cell * (1 + 0.07 * Math.sin(4 * clock + (hashOf(kind) % 5)));
    const [main, hi, dark] = FOOD_STYLE[kind];
    cmds.push(circle(x, y, 2.15 * l, undefined, main, 1));
    cmds.push(circle(x, y, 1.55 * l, undefined, main, 2));
    if (blink) return;

    if (kind === 'star') {
        cmds.push(poly(starPts(x, y, 1.35 * l, 0.58 * l), main, dark, 1));
        cmds.push(ellipse(x - 0.12 * l, y + 0.28 * l, 0.16 * l, 0.2 * l, hi));
        return;
    }

    cmds.push(circle(x, y, l, main, dark, 1));
    cmds.push(ellipse(x - 0.28 * l, y + 0.32 * l, 0.22 * l, 0.16 * l, hi));
    if (kind === 'berry') {
        cmds.push(poly([[x, y + 1.05 * l], [x + 0.45 * l, y + 1.55 * l], [x + 0.15 * l, y + 0.7 * l]], '#7dffb0'));
    } else if (kind === 'slow') {
        cmds.push(ellipse(x, y + 0.32 * l, 0.38 * l, 0.28 * l, '#14515c'));
        cmds.push(ellipse(x, y - 0.32 * l, 0.38 * l, 0.28 * l, '#14515c'));
        cmds.push(poly([[x - 0.12 * l, y + 0.08 * l], [x + 0.12 * l, y + 0.08 * l], [x, y - 0.02 * l]], '#e7fbff'));
    } else if (kind === 'mult') {
        for (let i = 0; i < 6; i++) {
            const ang = (i / 6) * Math.PI * 2 + 0.4 * clock;
            cmds.push(ellipse(x + Math.cos(ang) * l * 0.28, y + Math.sin(ang) * l * 0.28, 0.28 * l, 0.16 * l, i % 2 ? '#f3e8ff' : '#9a78e0'));
        }
    }
}

/* ------------------------------------------------------------------ *
 * 菜单里的装饰蛇
 * ------------------------------------------------------------------ */

function paintMascot(cmds: DrawCmd[], w: number, h: number, cell: number, clock: number, tongue: number): void {
    const n = 22;
    const path: Pt[] = [];
    for (let i = 0; i < n; i++) {
        const x = 0.86 * w - (i / (n - 1)) * w * 0.7;
        const y = 0.78 * h + Math.sin(1.35 * clock + 0.48 * i) * h * 0.03;
        path.push([x, h - y]);
    }
    const slope = 0.35 * Math.cos(1.35 * clock);
    const len = Math.hypot(1, slope) || 1;
    const face: Pt = [1 / len, -slope / len];
    const size = Math.max(16, Math.min(cell, 34));
    const run = prepareRun(roundPath(path, 0.45 * size), size, 1);
    if (run) emitRun(cmds, run, 0, 0, w, h);
    emitHead(cmds, { x: path[0][0], y: path[0][1], face }, size, 1, false, tongue, 0, 0, w, h);

    const fx = 0.42 * w + 10 * Math.sin(1.2 * clock);
    const fy = h - (0.62 * h + 8 * Math.sin(1.8 * clock));
    paintFood(cmds, fx, fy, 'berry', size, clock, false);
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

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
    hideSnake?: boolean;
    /** 每帧闪烁的星点（由 makeStars 生成，静态层里不重复算） */
    stars?: Star[];
}

export function paintField(input: PaintInput): FieldFrame {
    const { world, cols, rows, cell, clock, fx, mascot } = input;
    const w = cols * cell;
    const h = rows * cell;
    const cmds: DrawCmd[] = [];
    const popups: FieldFrame['popups'] = [];

    if (input.stars && input.stars.length) starsInto(cmds, input.stars, clock);

    if (mascot || !world) {
        paintMascot(cmds, w, h, cell, clock, input.tongue);
        return { cmds, popups };
    }

    if (world.berry) {
        const p = cellCenter(world.berry[0], world.berry[1], cell, rows);
        paintFood(cmds, p[0], p[1], 'berry', cell, clock, false);
    }
    if (world.special) {
        const p = cellCenter(world.special.x, world.special.y, cell, rows);
        const blink = world.special.ttl < 2.2 && Math.floor(8 * clock) % 2 === 0;
        paintFood(cmds, p[0], p[1], world.special.kind, cell, clock, blink);
    }

    const geo = snakePolylines(world, input.lead, cell, cols, rows, input.pulse);
    if (!input.hideSnake && geo.box.minX < Infinity) {
        const offsets = wrapOffsets(geo.box, w, h, world.mode === 'zen');
        for (const off of offsets) {
            for (const run of geo.runs) emitRun(cmds, run, off[0], off[1], w, h);
            emitHead(cmds, geo.head, cell, input.pulse, input.blink, input.tongue, off[0], off[1], w, h);
        }
    }

    for (const p of fx.particles) {
        if (p.kind === 'ring') {
            cmds.push(circle(p.x, p.y, Math.max(1, p.r), undefined, p.color, 2));
        } else {
            const k = 1 - p.age / Math.max(0.001, p.life);
            cmds.push(circle(p.x, p.y, Math.max(0.6, p.r * (0.45 + 0.55 * k)), p.color));
        }
    }

    const size = Math.max(12, cell / 3);
    for (const p of fx.popups) {
        popups.push({ x: p.x, y: p.y, text: p.text, color: p.color, size });
    }

    return { cmds, popups };
}

export function paintDim(w: number, h: number): DrawCmd {
    return poly([[0, 0], [w, 0], [w, h], [0, h]], '#0c0616aa');
}

export function paintCard(cx: number, cy: number, cw: number, ch: number, accent: string): DrawCmd[] {
    return [poly(roundRectPts(cx - cw / 2, cy - ch / 2, cw, ch, 18), PANEL, accent, 2)];
}