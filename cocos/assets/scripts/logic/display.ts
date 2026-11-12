/** 窗口分辨率和全屏选项。不依赖 Cocos，方便在 CI 里核对「不提供装不下的尺寸」。 */

export const LOGICAL_W = 1280;
export const LOGICAL_H = 720;

export const WINDOW_PRESETS: ReadonlyArray<readonly [number, number]> = [
    [960, 540],
    [1280, 720],
    [1600, 900],
    [1920, 1080],
    [2560, 1440],
    [2560, 1600],
];

export interface MonitorInfo {
    workW: number;
    workH: number;
    screenW: number;
    screenH: number;
}

export interface DisplayChoice {
    id: string;
    width: number;
    height: number;
    label: string;
}

export interface DisplaySave {
    mode: 'window' | 'fullscreen';
    width: number;
    height: number;
}

export interface NativeDisplay {
    ok: boolean;
    fullscreen: boolean;
    width: number;
    height: number;
    screenW: number;
    screenH: number;
    workW: number;
    workH: number;
    dpi: number;
    smoke: boolean;
}

export function defaultDisplay(): DisplaySave {
    return { mode: 'window', width: 0, height: 0 };
}

/** 按当前显示器的工作区取最大的偶数 16:9。宽或高为 0 表示还没读到屏幕。 */
export function fitWorkArea(monitor: MonitorInfo): { width: number; height: number } {
    const workW = Math.max(0, Math.trunc(monitor.workW));
    const workH = Math.max(0, Math.trunc(monitor.workH));
    let width = workW & ~1;
    let height = Math.floor(width * 9 / 16) & ~1;
    if (height > (workH & ~1)) {
        height = workH & ~1;
        width = Math.floor(height * 16 / 9) & ~1;
        height = Math.floor(width * 9 / 16) & ~1;
    }
    if (width < 640 || height < 360 || width > workW || height > workH) {
        width = Math.max(2, Math.min(workW, 960) & ~1);
        height = Math.max(2, Math.min(workH, 540) & ~1);
    }
    return { width, height };
}

export function windowChoices(monitor: MonitorInfo): DisplayChoice[] {
    // 允许选到整块屏幕的尺寸（不受任务栏工作区高度限制），否则 2560×1600 会被过滤掉
    const workW = Math.max(Math.trunc(monitor.workW), Math.trunc(monitor.screenW || 0));
    const workH = Math.max(Math.trunc(monitor.workH), Math.trunc(monitor.screenH || 0));
    const fit = fitWorkArea(monitor);
    const out: DisplayChoice[] = [];
    if (fit.width >= 640 && fit.height >= 360 && fit.width <= workW && fit.height <= workH) {
        out.push({ id: 'auto', width: fit.width, height: fit.height, label: `自动 ${fit.width}×${fit.height}` });
    }
    for (const [width, height] of WINDOW_PRESETS) {
        if (width <= workW && height <= workH && !(width === fit.width && height === fit.height)) {
            out.push({ id: `${width}x${height}`, width, height, label: `${width} × ${height}` });
        }
    }
    return out;
}

export function choiceFits(width: number, height: number, monitor: MonitorInfo): boolean {
    return width >= 640 && height >= 360 && width <= monitor.workW && height <= monitor.workH;
}

export function pickSavedWindow(savedW: number, savedH: number, choices: DisplayChoice[]): DisplayChoice | null {
    if (!choices.length) {
        return null;
    }
    const exact = choices.find((choice) => choice.width === savedW && choice.height === savedH);
    if (exact) {
        return exact;
    }
    const smaller = choices.filter((choice) => choice.width <= savedW && choice.height <= savedH);
    const pool = smaller.length ? smaller : choices;
    return pool[pool.length - 1];
}

export function parseNativeDisplay(raw: string): NativeDisplay | null {
    try {
        const src = JSON.parse(raw) as Record<string, unknown>;
        const num = (key: string) => {
            const value = Number(src[key]);
            return Number.isFinite(value) ? Math.trunc(value) : 0;
        };
        if (!src || src.ok !== 1 && src.ok !== true) {
            return null;
        }
        return {
            ok: true,
            fullscreen: src.fullscreen === 1 || src.fullscreen === true,
            width: num('width'),
            height: num('height'),
            screenW: num('screenW'),
            screenH: num('screenH'),
            workW: num('workW'),
            workH: num('workH'),
            dpi: num('dpi'),
            smoke: src.smoke === 1 || src.smoke === true,
        };
    } catch {
        return null;
    }
}

export function displayStatus(native: NativeDisplay | null, renderW: number, renderH: number): string {
    const logical = `逻辑 ${LOGICAL_W}×${LOGICAL_H}`;
    if (!native) {
        return `${logical} · 渲染跟随浏览器 ${Math.trunc(renderW)}×${Math.trunc(renderH)}`;
    }
    const mode = native.fullscreen ? '全屏' : '窗口';
    const dpi = native.dpi > 0 ? ` · ${native.dpi} DPI` : '';
    return `${logical} · 渲染 ${native.width}×${native.height} ${mode}${dpi}`;
}
