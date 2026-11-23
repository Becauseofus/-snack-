import { DRAGON_COIL_SECONDS, type Mode } from './config';

const COIL_IN_ENDS = [0.160, 0.265, 0.375, 0.500];
const COIL_OUT_STARTS = [0.540, 0.420, 0.300, 0.160];
const MASK_SIZE = 24;
const TILE_SIZE = 448;

// [left, top, right, bottom] in atlas pixels, using alpha >= 48 to exclude faint specks.
const BODY_BOUNDS = [
    [141, 28, 306, 420],
    [92, 59, 355, 388],
    [62, 81, 385, 366],
    [91, 94, 356, 354],
    [93, 98, 356, 351],
    [75, 89, 374, 358],
    [73, 70, 374, 376],
    [115, 38, 332, 410],
    [142, 28, 307, 420],
] as const;

// The 24 rows of each mask store the visible pixels of the corresponding atlas tile.
// Bit 0 is the leftmost column. Transparent padding and holes do not collect balls.
const BODY_MASKS: readonly (readonly number[])[] = [
    [
        0x000000, 0x001800, 0x007e00, 0x00bd00, 0x00ff00, 0x01ff80,
        0x007e00, 0x007e00, 0x007e00, 0x007c00, 0x00f800, 0x00f800,
        0x00fc00, 0x00ff00, 0x003f00, 0x000f00, 0x001f00, 0x003e00,
        0x007800, 0x007800, 0x007800, 0x001800, 0x000000, 0x000000,
    ],
    [
        0x000000, 0x000000, 0x000000, 0x00d000, 0x03f800, 0x03fc00,
        0x07fc00, 0x07fc00, 0x03fe00, 0x02fe00, 0x003e00, 0x007c00,
        0x00fc00, 0x01f000, 0x01e000, 0x01e3c0, 0x01ffc0, 0x01ffe0,
        0x00ffe0, 0x0039e0, 0x000020, 0x000000, 0x000000, 0x000000,
    ],
    [
        0x000000, 0x000000, 0x000000, 0x000000, 0x003c00, 0x00fe00,
        0x01ff80, 0x03ff80, 0x0fffc0, 0x0fe3e0, 0x17c3c0, 0x1fc1f0,
        0x0fc3f0, 0x0f83f8, 0x0207f8, 0x030ff0, 0x03fff0, 0x01ff80,
        0x00ff00, 0x007c00, 0x000000, 0x000000, 0x000000, 0x000000,
    ],
    [
        0x000000, 0x000000, 0x000000, 0x000000, 0x000000, 0x01fe00,
        0x03ff00, 0x07ff80, 0x07ffc0, 0x07ffc0, 0x07ffe0, 0x07f9e0,
        0x07fde0, 0x07ffe0, 0x07fbe0, 0x07ffe0, 0x03ff80, 0x00ff80,
        0x007e00, 0x000000, 0x000000, 0x000000, 0x000000, 0x000000,
    ],
    [
        0x000000, 0x000000, 0x000000, 0x000000, 0x000000, 0x00fc00,
        0x03ff00, 0x07ff80, 0x07ffc0, 0x07ffe0, 0x07ffe0, 0x07ffe0,
        0x07ffe0, 0x07ffe0, 0x07ffe0, 0x03ffc0, 0x03ffc0, 0x01ff00,
        0x007e00, 0x000000, 0x000000, 0x000000, 0x000000, 0x000000,
    ],
    [
        0x000000, 0x000000, 0x000000, 0x000000, 0x000000, 0x033f00,
        0x077fc0, 0x0fffe0, 0x0fffe0, 0x0ffff0, 0x0ff9f0, 0x07f9f0,
        0x07fdf0, 0x0ffbf0, 0x07dff0, 0x07ffe0, 0x03ffe0, 0x01ff80,
        0x007f00, 0x000000, 0x000000, 0x000000, 0x000000, 0x000000,
    ],
    [
        0x000000, 0x000000, 0x000000, 0x000000, 0x00fc00, 0x01fe00,
        0x01ff00, 0x01ff80, 0x00ffc0, 0x01ffe0, 0x001fe0, 0x0003f0,
        0x0801f0, 0x0f01f0, 0x0f81f0, 0x0fc3f0, 0x07fff0, 0x03ffe0,
        0x00ffc0, 0x003f00, 0x000000, 0x000000, 0x000000, 0x000000,
    ],
    [
        0x000000, 0x000000, 0x00f400, 0x01fc00, 0x03fe00, 0x03fe00,
        0x01ff00, 0x01ff00, 0x007f80, 0x001fc0, 0x000fc0, 0x0007c0,
        0x001fc0, 0x007f80, 0x00ff80, 0x00fe00, 0x00f000, 0x00fe00,
        0x007e00, 0x003f00, 0x001f00, 0x000200, 0x000000, 0x000000,
    ],
    [
        0x000000, 0x001800, 0x007e00, 0x00bd00, 0x00ff00, 0x01ff00,
        0x00fe00, 0x007e00, 0x007e00, 0x007c00, 0x00f800, 0x00f800,
        0x00ff00, 0x007f00, 0x003f00, 0x000f80, 0x001f00, 0x003e00,
        0x007800, 0x007800, 0x007800, 0x003000, 0x000000, 0x000000,
    ],
];

export interface DragonCoilPose {
    x: number;
    y: number;
    dx: number;
    dy: number;
    size: number;
    frame: number;
    opacity: number;
}

function fitTravellingCoil(head: number, offset: number, span: number, min: number, max: number) {
    const range = span - 1;
    const position = Math.max(0.5, Math.min(span - 0.5, head));
    const nearStart = position < span / 2;
    const edge = nearStart ? 0.5 : span - 0.5;
    const ideal = edge + offset;
    const adjustment = Math.max(min, Math.min(max, ideal)) - ideal;
    const distance = Math.abs(position - edge);
    const zone = Math.min(range / 2, Math.max(2, 2.5 * Math.abs(adjustment)));
    if (!adjustment || distance >= zone) return { center: position + offset, speed: 1 };

    // Spread the correction across the approach, before the art would otherwise hit a hard clamp.
    const compression = Math.abs(adjustment) / zone;
    if (compression >= 1) {
        const speed = (max - min) / range;
        return { center: min + (position - 0.5) * speed, speed };
    }
    const t = 1 - distance / zone;
    const quadratic = Math.max(0, Math.min(1, 0.9 / compression - 1));
    return {
        center: position + offset + adjustment * t * (1 - quadratic + quadratic * t),
        speed: 1 - compression * (1 - quadratic + 2 * quadratic * t),
    };
}

function slideCoil(from: number, to: number, startSpeed: number, endSpeed: number, t: number): number {
    const rest = 1 - t;
    return from + (to - from) * t * t * (3 - 2 * t) +
        startSpeed * t * rest * rest - endSpeed * t * t * rest;
}

// World coordinates use cells and measure Y down from the top of the board.
export function dragonCoilPose([headX, headY]: readonly [number, number], [dx, dy]: readonly [number, number],
    remaining: number, {cols, rows, mode}: {cols: number; rows: number; mode: Mode}, lead: number,
    arrival: readonly [number, number] | null): DragonCoilPose {
    const elapsed = DRAGON_COIL_SECONDS - remaining;
    const frame = COIL_IN_ENDS.filter(end => elapsed >= end).length +
        COIL_OUT_STARTS.filter(start => remaining <= start).length;
    const size = Math.min(4, cols, rows);
    const extent = 1 - Math.min(1, elapsed / COIL_IN_ENDS[3], remaining / COIL_OUT_STARTS[0]);
    const headOffset = size * 0.29 * extent;

    const [left, top, right, bottom] = BODY_BOUNDS[frame];
    const scale = size / TILE_SIZE;
    const centerX = (left + right - TILE_SIZE) * scale / 2;
    const centerY = (top + bottom - TILE_SIZE) * scale / 2;
    const halfWidth = (right - left) * scale / 2;
    const halfHeight = (bottom - top) * scale / 2;

    const xCenter = -dy * centerX - dx * centerY;
    const yCenter = dx * centerX - dy * centerY;
    const xHalf = Math.abs(dy) * halfWidth + Math.abs(dx) * halfHeight;
    const yHalf = Math.abs(dx) * halfWidth + Math.abs(dy) * halfHeight;
    const wraps = mode === 'zen';
    const exitX = wraps && (headX + dx < 0 || headX + dx >= cols);
    const exitY = wraps && (headY + dy < 0 || headY + dy >= rows);
    const place = (head: number, dir: number, span: number, center: number, half: number,
        entry: number, exits: boolean): number => {
        const min = half - center, max = span - half - center;
        const offset = -dir * headOffset;
        const fit = (at: number) => {
            if (wraps && dir && span > 1) return fitTravellingCoil(head + 0.5 + dir * at, offset, span, min, max);
            return { center: Math.max(min, Math.min(max, head + 0.5 + dir * at + offset)), speed: 0 };
        };
        if (!entry && !exits) return fit(lead).center;

        // Match the speed at the visible ends of each slide. Only switch sides while invisible.
        const travel = entry || dir;
        const side = entry ? -entry : dir;
        const hidden = side > 0 ? max + 2 * half : min - 2 * half;
        const transitSpeed = travel * 2.7 * half;
        const inside = fit(entry ? 1 : 0);
        return entry
            ? slideCoil(hidden, inside.center, transitSpeed, dir * inside.speed, lead)
            : slideCoil(inside.center, hidden, dir * inside.speed, transitSpeed, lead);
    };
    const x = place(headX, dx, cols, xCenter, xHalf, arrival?.[0] ?? 0, exitX);
    const y = place(headY, dy, rows, yCenter, yHalf, arrival?.[1] ?? 0, exitY);
    // Fade the faint atlas fringe near the handoff, after most of the sprite has slid off.
    const opacity = Math.round(255 * Math.min(1, arrival ? lead * 6 : 1, exitX || exitY ? (1 - lead) * 6 : 1));
    return { x, y, dx, dy, size, frame, opacity };
}

export function dragonCoilTouches(pose: DragonCoilPose, x: number, y: number, radius: number): boolean {
    if (pose.opacity === 0) return false;
    const rx = x - pose.x, ry = y - pose.y;
    const half = pose.size / 2;
    const localX = half - pose.dy * rx + pose.dx * ry;
    const localY = half - pose.dx * rx - pose.dy * ry;
    const pixel = pose.size / MASK_SIZE;
    const left = Math.max(0, Math.floor((localX - radius) / pixel));
    const right = Math.min(MASK_SIZE - 1, Math.floor((localX + radius) / pixel));
    const top = Math.max(0, Math.floor((localY - radius) / pixel));
    const bottom = Math.min(MASK_SIZE - 1, Math.floor((localY + radius) / pixel));
    const mask = BODY_MASKS[pose.frame];
    for (let row = top; row <= bottom; row++) {
        const dy = Math.max(row * pixel - localY, localY - (row + 1) * pixel, 0);
        for (let col = left; col <= right; col++) {
            if ((mask[row] & (1 << col)) === 0) continue;
            const dx = Math.max(col * pixel - localX, localX - (col + 1) * pixel, 0);
            if (dx * dx + dy * dy <= radius * radius) return true;
        }
    }
    return false;
}
