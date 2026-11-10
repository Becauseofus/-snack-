/** 拐角收圆、折线切段。逻辑与 Python 版 round_path / _split_runs / _dedupe 一致。 */

export type Pt = [number, number];

export function dedupe(pts: Pt[], minD = 1.2): Pt[] {
    if (!pts.length) {
        return [];
    }
    const out: Pt[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        const q = out[out.length - 1];
        if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) >= minD) {
            out.push(p);
        }
    }
    return out;
}

export function splitRuns(pts: Pt[], limit: number): Pt[][] {
    if (!pts.length) {
        return [];
    }
    const runs: Pt[][] = [[pts[0]]];
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        const run = runs[runs.length - 1];
        const q = run[run.length - 1];
        if (Math.abs(p[0] - q[0]) > limit || Math.abs(p[1] - q[1]) > limit) {
            runs.push([p]);
        } else {
            run.push(p);
        }
    }
    return runs;
}

export function roundPath(pts: Pt[], radius: number): Pt[] {
    if (pts.length < 3 || radius <= 0) {
        return pts.slice();
    }
    const out: Pt[] = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const c = pts[i + 1];
        const v1x = b[0] - a[0];
        const v1y = b[1] - a[1];
        const v2x = c[0] - b[0];
        const v2y = c[1] - b[1];
        const l1 = Math.hypot(v1x, v1y);
        const l2 = Math.hypot(v2x, v2y);
        if (l1 < 1 || l2 < 1) {
            out.push(b);
            continue;
        }
        const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
        if (dot > 0.82) {
            out.push(b);
            continue;
        }
        const r = Math.min(radius, l1 * 0.46, l2 * 0.46);
        const u1x = v1x / l1;
        const u1y = v1y / l1;
        const u2x = v2x / l2;
        const u2y = v2y / l2;
        const p1: Pt = [b[0] - u1x * r, b[1] - u1y * r];
        const p2: Pt = [b[0] + u2x * r, b[1] + u2y * r];
        out.push(p1);
        for (const s of [0.2, 0.4, 0.6, 0.8]) {
            const u = 1 - s;
            out.push([
                u * u * p1[0] + 2 * u * s * b[0] + s * s * p2[0],
                u * u * p1[1] + 2 * u * s * b[1] + s * s * p2[1],
            ]);
        }
        out.push(p2);
    }
    out.push(pts[pts.length - 1]);
    return out;
}

export function resample(pts: Pt[], step: number): Pt[] {
    if (pts.length < 2) {
        return pts.slice();
    }
    const out: Pt[] = [pts[0]];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.001) {
            continue;
        }
        let dist = step - carry;
        while (dist <= len) {
            const t = dist / len;
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            dist += step;
        }
        carry = len - (dist - step);
    }
    const last = pts[pts.length - 1];
    const tail = out[out.length - 1];
    if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > 0.4) {
        out.push(last);
    }
    return out;
}

export function roundRectPts(x: number, y: number, w: number, h: number, r: number): Pt[] {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    const steps = 5;
    const corners: Array<[number, number, number, number]> = [
        [x + w - radius, y + h - radius, 0, Math.PI / 2],
        [x + radius, y + h - radius, Math.PI / 2, Math.PI],
        [x + radius, y + radius, Math.PI, Math.PI * 1.5],
        [x + w - radius, y + radius, Math.PI * 1.5, Math.PI * 2],
    ];
    const pts: Pt[] = [];
    if (radius <= 0) {
        return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    }
    for (const [cx, cy, a0, a1] of corners) {
        for (let i = 0; i <= steps; i++) {
            const a = a0 + ((a1 - a0) * i) / steps;
            pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
        }
    }
    return pts;
}

export function starPts(cx: number, cy: number, rOut: number, rIn: number, rot = -Math.PI / 2): Pt[] {
    const pts: Pt[] = [];
    for (let i = 0; i < 10; i++) {
        const ang = rot + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? rOut : rIn;
        pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
    }
    return pts;
}
