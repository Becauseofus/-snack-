/** 与 Python 版对齐的常量、配色和存档清洗。不依赖 Cocos。 */

export const APP_NAME = '贪吃蛇';
export const APP_VERSION = '1.0.8';
export const HISTORY_MAX = 10;
export const STORAGE_KEY = 'SnakeGame.settings';

export const SPEED_SLOW_MS = 160;
export const SPEED_FAST_MS = 45;

export const MODES = ['classic', 'zen', 'challenge'] as const;
export type Mode = (typeof MODES)[number];

export const MODE_NAME: Record<Mode, string> = {
    classic: '经典',
    zen: '禅意',
    challenge: '挑战',
};

export const MODE_BLURB: Record<Mode, string> = {
    classic: '撞墙结束，节奏稳定',
    zen: '穿墙环绕，节奏更从容',
    challenge: '撞墙结束，越吃越快',
};

export const MODE_COLOR: Record<Mode, string> = {
    classic: '#ff7eb6',
    zen: '#8dffc6',
    challenge: '#ffd56a',
};

export type FoodKind = 'berry' | 'star' | 'slow' | 'mult';

export const FOOD_SCORE: Record<FoodKind, number> = {
    berry: 10,
    star: 30,
    slow: 5,
    mult: 5,
};

export const FOOD_LABEL: Record<FoodKind, string> = {
    berry: '浆果',
    star: '星果',
    slow: '时砂',
    mult: '莲灯',
};

export const BG = '#140c24';
export const FIELD_TOP = '#160a2e';
export const FIELD_BOT = '#3b1d78';
export const TEXT = '#fff6fb';
export const MUTED = '#cbbbe8';
export const ACCENT = '#ff7eb6';
export const ACCENT_SOFT = '#ff9ec8';
export const HEAD = '#8dffc6';
export const HEAD_HI = '#d8ffe8';
export const HEAD_BACK = '#2f9a68';
export const BODY_A = '#6cf0b4';
export const BODY_B = '#1c8f62';
export const BELLY = '#e7fff4';
export const BELLY_B = '#b6f0d4';
export const SCALE_A = '#d8ffe9';
export const SCALE_B = '#3eae78';
export const OUTLINE = '#10241c';
export const EYE = '#e2b84a';
export const EYE_RING = '#8a6420';
export const PUPIL = '#140e08';
export const TONGUE = '#e23b55';
export const GOLD = '#ffd56a';
export const CYAN = '#7eecff';
export const VIOLET = '#c9a6ff';
export const BERRY = '#ff6b9d';
export const PANEL = '#120818';
export const FRAME = '#8b7cff';
export const BTN = '#3a2a70';
export const BTN_HOVER = '#4e3a8c';
export const BTN_OFF = '#2a1b55';

export interface HistoryItem {
    score: number;
    time: string;
    mode: Mode;
    length: number;
}

export interface DisplaySave {
    mode: 'window' | 'fullscreen';
    width: number;
    height: number;
}

/** 帧率上限。0 表示不限制，交给引擎跑满。 */
export type FpsLimit = 0 | 30 | 60 | 120 | 180;
export const FPS_OPTIONS: readonly FpsLimit[] = [30, 60, 120, 180, 0];

export function fpsLabel(v: FpsLimit): string {
    return v === 0 ? '不限' : String(v);
}

/** 引擎（pacer）只接受大于 0 的目标帧率，「不限」用一个足够大的值代替。 */
export function fpsToEngine(v: FpsLimit): number {
    return v === 0 ? 1000 : v;
}

export function sanitizeFps(raw: unknown): FpsLimit {
    const n = Number(raw);
    return (FPS_OPTIONS as readonly number[]).includes(n) ? (n as FpsLimit) : 60;
}

export interface SaveData {
    best: number;
    best_by_mode: Record<Mode, number>;
    history: HistoryItem[];
    speed: number;
    fps: FpsLimit;
    mode: Mode;
    sound: boolean;
    skin: 'classic' | 'dragon' | 'robot' | 'candy';
    display: DisplaySave;
}

export function defaultSave(): SaveData {
    return {
        best: 0,
        best_by_mode: { classic: 0, zen: 0, challenge: 0 },
        history: [],
        speed: 5,
        fps: 60,
        mode: 'classic',
        sound: true,
        skin: 'classic',
        display: { mode: 'window', width: 0, height: 0 },
    };
}

export function sanitizeSave(raw: unknown): SaveData {
    const d = defaultSave();
    const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const speed = Number(src.speed);
    d.speed = Number.isFinite(speed) ? Math.max(1, Math.min(10, Math.trunc(speed))) : 5;
    d.fps = sanitizeFps(src.fps);
    const best = Number(src.best);
    d.best = Number.isFinite(best) ? Math.max(0, Math.trunc(best)) : 0;
    d.mode = (MODES as readonly string[]).includes(String(src.mode)) ? (src.mode as Mode) : 'classic';
    d.sound = src.sound === undefined ? true : Boolean(src.sound);
    d.skin = src.skin === 'dragon' || src.skin === 'robot' || src.skin === 'candy' ? src.skin : 'classic';
    const display = src.display;
    if (display && typeof display === 'object') {
        const row = display as Record<string, unknown>;
        const width = Number(row.width);
        const height = Number(row.height);
        d.display = {
            mode: row.mode === 'fullscreen' ? 'fullscreen' : 'window',
            width: Number.isFinite(width) ? Math.max(0, Math.trunc(width)) : 0,
            height: Number.isFinite(height) ? Math.max(0, Math.trunc(height)) : 0,
        };
    }
    const modes = src.best_by_mode;
    if (modes && typeof modes === 'object') {
        const bag = modes as Record<string, unknown>;
        for (const key of MODES) {
            const n = Number(bag[key]);
            d.best_by_mode[key] = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
        }
    }
    if (Array.isArray(src.history)) {
        const hist: HistoryItem[] = [];
        for (const item of src.history) {
            if (!item || typeof item !== 'object') {
                continue;
            }
            const row = item as Record<string, unknown>;
            const mode = (MODES as readonly string[]).includes(String(row.mode)) ? (row.mode as Mode) : 'classic';
            const score = Number(row.score);
            const length = Number(row.length);
            hist.push({
                score: Number.isFinite(score) ? Math.max(0, Math.trunc(score)) : 0,
                time: typeof row.time === 'string' ? row.time : '',
                mode,
                length: Number.isFinite(length) ? Math.max(0, Math.trunc(length)) : 0,
            });
        }
        d.history = hist.slice(0, HISTORY_MAX);
    }
    return d;
}

export function intervalMs(level: number, mode: Mode, eaten: number, slowLeft: number): number {
    let base = speedToMs(level);
    if (mode === 'zen') {
        base = Math.trunc(base * 1.18);
    } else if (mode === 'challenge') {
        base = Math.trunc(base * 0.95 ** Math.min(eaten, 22));
    }
    if (slowLeft > 0) {
        base = Math.trunc(base * 1.75);
    }
    return Math.max(32, base);
}

export function speedToMs(level: number): number {
    const clamped = Math.max(1, Math.min(10, Math.trunc(level)));
    const t = (clamped - 1) / 9;
    return Math.trunc(SPEED_SLOW_MS + (SPEED_FAST_MS - SPEED_SLOW_MS) * t);
}

export function fitGrid(availW: number, availH: number): [number, number, number] {
    let aw = Math.max(96, Math.trunc(availW));
    let ah = Math.max(96, Math.trunc(availH));
    let cell = Math.trunc(Math.min(aw / 24, ah / 15));
    cell = Math.max(18, Math.min(cell, 64));
    let cols = Math.max(12, Math.trunc(aw / cell));
    let rows = Math.max(10, Math.trunc(ah / cell));
    if (cols * cell > aw) {
        cols = Math.max(8, Math.trunc(aw / cell));
    }
    if (rows * cell > ah) {
        rows = Math.max(8, Math.trunc(ah / cell));
    }
    cell = Math.min(cell, Math.trunc(aw / Math.max(1, cols)), Math.trunc(ah / Math.max(1, rows)));
    cell = Math.max(8, Math.trunc(cell));
    cols = Math.max(8, Math.min(cols, Math.trunc(aw / cell)));
    rows = Math.max(8, Math.min(rows, Math.trunc(ah / cell)));
    return [cols, rows, cell];
}

export function mixHex(a: string, b: string, t: number): string {
    const u = t < 0 ? 0 : t > 1 ? 1 : t;
    const ai = parseInt(a.slice(1), 16);
    const bi = parseInt(b.slice(1), 16);
    const ar = (ai >> 16) & 255;
    const ag = (ai >> 8) & 255;
    const ab = ai & 255;
    const br = (bi >> 16) & 255;
    const bg = (bi >> 8) & 255;
    const bb = bi & 255;
    const r = Math.round(ar + (br - ar) * u);
    const g = Math.round(ag + (bg - ag) * u);
    const bl = Math.round(ab + (bb - ab) * u);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

export function stampNow(date = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** Only ordinary keyboard keys may start a title-screen game.
 * Native backends can report unsupported system keys as 0 or an SDL code.
 */
export function isTitleStartKey(key: number): boolean {
    return [8, 9, 13, 32, 186, 187, 188, 189, 190, 191, 192, 219, 220, 221, 222].includes(key)
        || (key >= 33 && key <= 40) || key === 45 || key === 46
        || (key >= 48 && key <= 57) || (key >= 65 && key <= 90)
        || (key >= 96 && key <= 111);
}
export function enterAction(phase: string): 'start' | 'resume' | 'none' {
    return phase === 'menu' || phase === 'over' ? 'start' : phase === 'paused' ? 'resume' : 'none';
}
