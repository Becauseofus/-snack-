/** 顶栏、底栏、卡片的位置。窗口坐标原点在左下，y 朝上。 */

import {
    ACCENT,
    GOLD,
    MODE_BLURB,
    MODE_NAME,
    MUTED,
    TEXT,
    fitGrid,
    type FoodKind,
    type HistoryItem,
    type Mode,
} from './config';
import type { DrawCmd } from './paint';
import { paintCard, paintDim } from './paint';

export type Phase = 'menu' | 'playing' | 'paused' | 'dying' | 'over';

export interface UiModel {
    phase: Phase;
    help: boolean;
    historyOpen: boolean;
    selectedMode: Mode;
    pendingMode: Mode | null;
    activeMode: Mode;
    score: number;
    best: number;
    bestByMode: Record<Mode, number>;
    lengthText: string;
    buff: string;
    speed: number;
    soundOn: boolean;
    soundAvailable: boolean;
    resultScore: number;
    resultLen: number;
    resultMode: Mode;
    newRecord: boolean;
    newModeRecord: boolean;
    victory: boolean;
    history: HistoryItem[];
    mobile: boolean;
    scoreHot: boolean;
    confirmClear: boolean;
}

export interface LabelSpec {
    id: string;
    text: string;
    x: number;
    y: number;
    size: number;
    color: string;
    bold: boolean;
    align: 'left' | 'center' | 'right';
    w: number;
    parent: 'screen' | 'field';
}

export interface ButtonSpec {
    id: string;
    text: string;
    x: number;
    y: number;
    w: number;
    h: number;
    enabled: boolean;
    primary: boolean;
    selected: boolean;
    parent: 'screen' | 'field';
}

export interface SliderSpec {
    x: number;
    y: number;
    w: number;
    h: number;
    value: number;
}

export interface FieldRect {
    x: number;
    y: number;
    w: number;
    h: number;
    cols: number;
    rows: number;
    cell: number;
}

export interface Chrome {
    field: FieldRect;
    labels: LabelSpec[];
    buttons: ButtonSpec[];
    slider: SliderSpec;
    overlay: DrawCmd[];
}

export function measure(text: string, size: number): number {
    let w = 0;
    for (const ch of text) {
        const code = ch.codePointAt(0) ?? 0;
        w += code > 255 ? size : size * 0.56;
    }
    return w;
}

function label(
    list: LabelSpec[],
    id: string,
    text: string,
    x: number,
    y: number,
    size: number,
    color: string,
    align: LabelSpec['align'],
    bold = false,
    parent: LabelSpec['parent'] = 'screen',
    w = 0,
): void {
    list.push({ id, text, x, y, size, color, bold, align, w: w || measure(text, size) + 4, parent });
}

function button(
    list: ButtonSpec[],
    id: string,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    opts: Partial<Pick<ButtonSpec, 'enabled' | 'primary' | 'selected' | 'parent'>> = {},
): void {
    list.push({
        id,
        text,
        x,
        y,
        w,
        h,
        enabled: opts.enabled ?? true,
        primary: opts.primary ?? false,
        selected: opts.selected ?? false,
        parent: opts.parent ?? 'screen',
    });
}

function startLabel(phase: Phase): string {
    if (phase === 'menu') {
        return '开始游戏';
    }
    if (phase === 'over') {
        return '再来一局';
    }
    return '重新开始';
}

function pauseLabel(phase: Phase): string {
    return phase === 'paused' ? '继续' : '暂停';
}

function pauseEnabled(phase: Phase): boolean {
    return phase === 'playing' || phase === 'paused';
}

export function layoutChrome(W: number, H: number, ui: UiModel, clock = 0): Chrome {
    const padX = 16;
    const hudH = H < 560 ? 40 : 46;
    const footerH = H < 640 ? 108 : 100;
    const availW = Math.max(160, W - padX * 2);
    const availH = Math.max(160, H - hudH - footerH - 8);
    let [cols, rows, cell] = fitGrid(availW, availH);
    while (rows * cell > availH && rows > 8) {
        rows -= 1;
    }
    while (cols * cell > availW && cols > 8) {
        cols -= 1;
    }
    const fw = cols * cell;
    const fh = rows * cell;
    const field: FieldRect = {
        x: padX + Math.max(0, (availW - fw) / 2),
        y: footerH + Math.max(0, (availH - fh) / 2),
        w: fw,
        h: fh,
        cols,
        rows,
        cell,
    };
    const labels: LabelSpec[] = [];
    const buttons: ButtonSpec[] = [];
    const hudY = H - hudH / 2;
    let x = padX;
    label(labels, 'title', '贪吃蛇', x, hudY, 20, ACCENT, 'left', true);
    x += measure('贪吃蛇', 20) + 18;
    label(labels, 'score', `分数 ${ui.phase === 'menu' ? 0 : ui.score}`, x, hudY, 20, ui.scoreHot ? GOLD : TEXT, 'left', true);
    x += measure(`分数 ${ui.phase === 'menu' ? 0 : ui.score}`, 20) + 16;
    label(labels, 'best', `最高 ${ui.best}`, x, hudY, 15, MUTED, 'left');
    x += measure(`最高 ${ui.best}`, 15) + 16;
    label(labels, 'length', `长度 ${ui.lengthText}`, x, hudY, 15, MUTED, 'left');
    x += measure(`长度 ${ui.lengthText}`, 15) + 16;
    const modeName = MODE_NAME[ui.activeMode];
    const modeColor = ui.activeMode === 'zen' ? '#8dffc6' : ui.activeMode === 'challenge' ? GOLD : ACCENT;
    label(labels, 'mode', modeName, x, hudY, 15, modeColor, 'left', true);
    if (ui.buff) {
        label(labels, 'buff', ui.buff, W - padX, hudY, 15, GOLD, 'right', true);
    }

    const row1 = footerH - 28;
    const row2 = 46;
    const hintY = 16;
    let mx = padX;
    label(labels, 'mode-tag', '模式', mx, row1, 13, MUTED, 'left');
    mx += measure('模式', 13) + 8;
    const chosen = ui.pendingMode ?? (ui.phase === 'menu' || ui.phase === 'over' ? ui.selectedMode : ui.activeMode);
    for (const key of ['classic', 'zen', 'challenge'] as Mode[]) {
        const bw = 64;
        const bh = 26;
        button(buttons, `mode-${key}`, MODE_NAME[key], mx + bw / 2, row1, bw, bh, { selected: key === chosen });
        mx += bw + 6;
    }
    const blurb = ui.pendingMode && (ui.phase === 'playing' || ui.phase === 'paused')
        ? `下局切换为${MODE_NAME[ui.pendingMode]} · ${MODE_BLURB[ui.pendingMode]}`
        : MODE_BLURB[ui.phase === 'menu' ? ui.selectedMode : ui.activeMode];
    const soundText = ui.soundAvailable ? '音效' : '音效（系统不支持）';
    const soundW = Math.max(72, measure(soundText, 13) + 28);
    const histW = 64;
    const right = W - padX;
    button(buttons, 'sound', ui.soundOn && ui.soundAvailable ? `☑ ${soundText}` : `☐ ${soundText}`, right - soundW / 2, row1, soundW, 26, {
        enabled: ui.soundAvailable,
    });
    button(buttons, 'history', '记录', right - soundW - 8 - histW / 2, row1, histW, 26);
    const descW = Math.max(40, right - soundW - histW - 24 - mx);
    label(labels, 'blurb', blurb, mx + 8, row1, 13, MUTED, 'left', false, 'screen', descW);

    label(labels, 'speed-tag', '速度', padX, row2, 13, MUTED, 'left');
    const sliderW = W >= 1100 ? 200 : 130;
    const sliderX = padX + measure('速度', 13) + 10 + sliderW / 2;
    const slider: SliderSpec = { x: sliderX, y: row2, w: sliderW, h: 14, value: ui.speed };
    const numX = sliderX + sliderW / 2 + 16;
    label(labels, 'speed-num', String(ui.speed), numX, row2, 15, TEXT, 'left', true);
    label(labels, 'slow', '慢', numX + 22, row2, 12, MUTED, 'left');
    label(labels, 'fast', '快', numX + 22 + measure('慢', 12) + 4, row2, 12, MUTED, 'left');

    const bh = 30;
    let bx = W - padX;
    const specs: Array<[string, string, boolean, boolean]> = [
        ['quit', '退出', true, false],
        ['help', '帮助', true, false],
        ['pause', pauseLabel(ui.phase), pauseEnabled(ui.phase), false],
        ['start', startLabel(ui.phase), true, true],
    ];
    for (const [id, text, enabled, primary] of specs) {
        const bw = Math.max(72, measure(text, 14) + 28);
        bx -= bw;
        button(buttons, id, text, bx + bw / 2, row2, bw, bh, { enabled, primary });
        bx -= 8;
    }
    label(labels, 'hint', '方向键 / WASD 转向（可预存两次）· 空格暂停 · R 重开 · H 帮助 · F11 全屏 · N 音效 · 滑动转向', padX, hintY, 12, MUTED, 'left', false, 'screen', W - padX * 2);

    const overlay: DrawCmd[] = [];
    const showHelp = ui.help;
    const showPause = !ui.help && ui.phase === 'paused';
    const showOver = !ui.help && ui.phase === 'over';
    const showHist = ui.historyOpen && !ui.help;
    if (showHelp || showPause || showOver || showHist) {
        overlay.push(paintDim(field.w, field.h));
    }
    if (ui.phase === 'menu' && !ui.help && !ui.historyOpen) {
        paintMenu(labels, field, ui, clock);
    }
    if (showHelp) {
        paintHelp(labels, buttons, overlay, field);
    } else if (showPause) {
        paintPause(labels, overlay, field, ui);
    } else if (showOver) {
        paintOver(labels, overlay, field, ui);
    } else if (showHist) {
        paintHistory(labels, buttons, overlay, field, ui);
    }
    if (ui.mobile && (ui.phase === 'playing' || ui.phase === 'paused')) {
        paintPad(buttons, field);
    }
    return { field, labels, buttons, slider, overlay };
}

function paintMenu(labels: LabelSpec[], field: FieldRect, ui: UiModel, clock: number): void {
    const bob = Math.sin(clock * 1.6) * 4;
    const titleSize = Math.max(28, Math.min(68, field.cell * 1.35));
    const cx = field.w / 2;
    const y = field.h * 0.7 + bob;
    label(labels, 'menu-shadow', '贪 吃 蛇', cx + 2, y - 3, titleSize, '#2a1248', 'center', true, 'field');
    label(labels, 'menu-title', '贪 吃 蛇', cx, y, titleSize, TEXT, 'center', true, 'field');
    label(labels, 'menu-sub', '无方格  ·  连续蛇身  ·  三种节奏', cx, y - titleSize * 0.72, Math.max(11, field.cell / 3), MUTED, 'center', false, 'field');
    label(labels, 'menu-best', `历史最高  ${ui.best}    ·    ${MODE_BLURB[ui.selectedMode]}`, cx, y - titleSize * 1.15, Math.max(11, field.cell / 3), ACCENT, 'center', false, 'field', field.w - 40);
    label(labels, 'menu-go', '按 Enter 开始', cx, y - titleSize * 1.55, Math.max(12, field.cell / 2.6), TEXT, 'center', true, 'field');
}

function paintPause(labels: LabelSpec[], overlay: DrawCmd[], field: FieldRect, ui: UiModel): void {
    const cw = Math.min(field.w - 40, 420);
    const ch = Math.min(field.h - 40, 220);
    const cx = field.w / 2;
    const cy = field.h / 2;
    overlay.push(...paintCard(cx, cy, cw, ch, ACCENT));
    label(labels, 'pause-title', '暂停', cx, cy + ch * 0.22, Math.max(22, field.cell * 0.7), TEXT, 'center', true, 'field');
    label(labels, 'pause-keys', '空格继续    ·    R 重新开始    ·    H 帮助', cx, cy - 8, Math.max(11, field.cell / 3), MUTED, 'center', false, 'field', cw - 24);
    label(labels, 'pause-blurb', MODE_BLURB[ui.activeMode], cx, cy - ch * 0.26, Math.max(10, field.cell / 3.4), ACCENT, 'center', false, 'field', cw - 24);
}

function paintOver(labels: LabelSpec[], overlay: DrawCmd[], field: FieldRect, ui: UiModel): void {
    const cw = Math.min(field.w - 36, 460);
    const ch = Math.min(field.h - 28, 340);
    const cx = field.w / 2;
    const cy = field.h / 2;
    const accent = ui.newRecord || ui.victory ? GOLD : ACCENT;
    overlay.push(...paintCard(cx, cy, cw, ch, accent));
    const top = cy + ch / 2;
    const title = ui.victory ? '清台' : '游戏结束';
    label(labels, 'over-title', title, cx, top - 36, Math.max(18, field.cell * 0.55), accent, 'center', true, 'field');
    label(labels, 'over-score', String(ui.resultScore), cx, top - ch * 0.4, Math.max(28, field.cell * 0.95), TEXT, 'center', true, 'field');
    let banner = '本局得分';
    let bannerColor = MUTED;
    if (ui.newRecord) {
        banner = '新纪录';
        bannerColor = GOLD;
    } else if (ui.newModeRecord) {
        banner = `${MODE_NAME[ui.resultMode]}新纪录`;
        bannerColor = GOLD;
    }
    label(labels, 'over-banner', banner, cx, top - ch * 0.4 - Math.max(28, field.cell * 0.55), Math.max(12, field.cell / 2.8), bannerColor, 'center', true, 'field');
    const modeBest = ui.bestByMode[ui.resultMode] ?? 0;
    label(
        labels,
        'over-meta',
        `最高 ${ui.best}    ·    ${MODE_NAME[ui.resultMode]} ${modeBest}    ·    长度 ${ui.resultLen}`,
        cx,
        top - ch * 0.68,
        Math.max(10, field.cell / 3.5),
        MUTED,
        'center',
        false,
        'field',
        cw - 20,
    );
    label(labels, 'over-hint', 'Enter / R 再来一局     Esc 返回标题', cx, top - ch * 0.84, Math.max(10, field.cell / 3.4), TEXT, 'center', false, 'field', cw - 16);
}

function paintHelp(labels: LabelSpec[], buttons: ButtonSpec[], overlay: DrawCmd[], field: FieldRect): void {
    const cw = Math.min(field.w - 28, 560);
    const ch = Math.min(field.h - 24, 460);
    const cx = field.w / 2;
    const cy = field.h / 2;
    overlay.push(...paintCard(cx, cy, cw, ch, '#8b7cff'));
    const left = cx - cw / 2 + 28;
    const top = cy + ch / 2 - 28;
    const size = ch >= 400 ? 12 : 10;
    const gap = ch >= 400 ? 22 : 18;
    const keyX = left + Math.min(168, cw * 0.34);
    label(labels, 'help-title', '怎么玩', left, top, size + 4, ACCENT, 'left', true, 'field');
    const rows: Array<[string, string, string]> = [
        ['方向键 / WASD', '转向，可提前存两次', GOLD],
        ['空格 / P', '暂停或继续', GOLD],
        ['R', '重新开始', GOLD],
        ['H / F1', '打开或关闭本页', GOLD],
        ['Esc', '关帮助 / 退出全屏 / 回标题', GOLD],
        ['F11', '全屏切换', GOLD],
        ['N', '音效开关', GOLD],
        ['经典', '撞墙结束，速度听滑条的', ACCENT],
        ['禅意', '从对面穿出，节奏更慢', ACCENT],
        ['挑战', '撞墙结束，吃得越多越快', ACCENT],
        ['浆果', '+10', TEXT],
        ['星果', '+30，多长一节', TEXT],
        ['时砂', '慢动作几秒', TEXT],
        ['莲灯', '接下来三次双倍', TEXT],
    ];
    let y = top - 30;
    const bottom = cy - ch / 2 + 36;
    rows.forEach((row, i) => {
        if (y < bottom) {
            return;
        }
        label(labels, `help-k-${i}`, row[0], left, y, size, row[2], 'left', true, 'field');
        label(labels, `help-v-${i}`, row[1], keyX, y, size, i >= 10 ? MUTED : TEXT, 'left', false, 'field');
        y -= gap;
    });
    button(buttons, 'close-help', '关闭', cx, cy - ch / 2 + 22, 72, 26, { parent: 'field' });
}

function paintHistory(labels: LabelSpec[], buttons: ButtonSpec[], overlay: DrawCmd[], field: FieldRect, ui: UiModel): void {
    const cw = Math.min(field.w - 36, 460);
    const ch = Math.min(field.h - 28, 420);
    const cx = field.w / 2;
    const cy = field.h / 2;
    overlay.push(...paintCard(cx, cy, cw, ch, ACCENT));
    const left = cx - cw / 2 + 22;
    const top = cy + ch / 2 - 28;
    label(labels, 'hist-title', `历史最高  ${ui.best}`, left, top, 18, ACCENT, 'left', true, 'field');
    const bits = (['classic', 'zen', 'challenge'] as Mode[]).map((k) => `${MODE_NAME[k]} ${ui.bestByMode[k]}`).join('    ');
    label(labels, 'hist-modes', bits, left, top - 28, 13, MUTED, 'left', false, 'field', cw - 36);
    const items = ui.history.length ? ui.history : [];
    if (!items.length) {
        label(labels, 'hist-empty', '还没有对局', left, top - 64, 14, TEXT, 'left', false, 'field');
    } else {
        items.slice(0, 8).forEach((item, i) => {
            const mode = MODE_NAME[item.mode];
            const text = `${String(i + 1).padStart(2, ' ')}.   ${String(item.score).padStart(4, ' ')} 分    ${mode}  长度 ${item.length}    ${item.time}`;
            label(labels, `hist-row-${i}`, text, left, top - 64 - i * 24, 13, TEXT, 'left', false, 'field', cw - 40);
        });
    }
    button(buttons, 'clear-history', ui.confirmClear ? '确认清空' : '清空记录', cx - 78, cy - ch / 2 + 24, 112, 28, { parent: 'field' });
    button(buttons, 'close-history', '关闭', cx + 50, cy - ch / 2 + 24, 72, 28, { parent: 'field', primary: true });
}

function paintPad(buttons: ButtonSpec[], field: FieldRect): void {
    const s = 46;
    const gap = 4;
    const cx = field.x + field.w - s * 1.6;
    const cy = field.y + s * 1.7;
    button(buttons, 'pad-up', '上', cx, cy + s + gap, s, s);
    button(buttons, 'pad-down', '下', cx, cy - s - gap, s, s);
    button(buttons, 'pad-left', '左', cx - s - gap, cy, s, s);
    button(buttons, 'pad-right', '右', cx + s + gap, cy, s, s);
}

export const FOOD_HELP: FoodKind[] = ['berry', 'star', 'slow', 'mult'];
