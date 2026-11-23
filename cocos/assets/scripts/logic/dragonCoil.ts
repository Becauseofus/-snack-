import { DRAGON_COIL_SECONDS } from './config';

const COIL_IN_ENDS = [0.160, 0.265, 0.375, 0.500];
const COIL_OUT_STARTS = [0.540, 0.420, 0.300, 0.160];
const MASK_SIZE = 24;

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
}

// World coordinates use cells and measure Y down from the top of the board.
export function dragonCoilPose(headX: number, headY: number, dx: number, dy: number,
    remaining: number, cols: number, rows: number, wrap: boolean): DragonCoilPose {
    const elapsed = DRAGON_COIL_SECONDS - remaining;
    const frame = COIL_IN_ENDS.filter(end => elapsed >= end).length +
        COIL_OUT_STARTS.filter(start => remaining <= start).length;
    const size = Math.min(4, cols, rows);
    const half = size / 2;
    const extent = 1 - Math.min(1, elapsed / COIL_IN_ENDS[3], remaining / COIL_OUT_STARTS[0]);
    const headOffset = size * 0.29 * extent;

    // Wrap the head first, then fit a single complete pose onto that side of the board.
    // Wrapping the sprite's centre instead makes the extended pose jump ahead of the head.
    const fit = (head: number, offset: number, span: number): number => {
        const position = wrap ? ((head % span) + span) % span : head;
        return Math.max(half, Math.min(span - half, position - offset));
    };
    return { x: fit(headX, dx * headOffset, cols), y: fit(headY, dy * headOffset, rows), dx, dy, size, frame };
}

export function dragonCoilTouches(pose: DragonCoilPose, x: number, y: number, radius: number): boolean {
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
