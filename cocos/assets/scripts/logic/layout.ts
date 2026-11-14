/**
 * 顶栏、底栏、面板的位置。窗口坐标原点在左下，y 向上。
 *
 * 这一版把「显示 / 音效 / 玩法 / 记录 / 退出」收进一个设置面板，
 * 标题界面只保留游戏名和「按任意键开始游戏」，并用统一字号系数放大文字。
 */

import {
    ACCENT,
    GOLD,
    MODE_BLURB,
    MODE_COLOR,
    MODE_NAME,
    MODES,
    MUTED,
    TEXT,
    fitGrid,
    type DisplaySave,
    type FoodKind,
    type HistoryItem,
    type Mode,
} from './config';
import type { DisplayChoice } from './display';
import { paintCard, paintDim, type DrawCmd } from './paint';

export type Phase = 'menu' | 'playing' | 'paused' | 'dying' | 'over';
export type SettingsTab = 'skins' | 'display' | 'sound' | 'help' | 'record';

export interface UiModel {
    phase: Phase;
    skin?: 'classic' | 'dragon';
    settingsOpen: boolean;
    settingsTab: SettingsTab;
    confirmClear: boolean;
    confirmQuit: boolean;
    selectedMode: Mode;
    pendingMode: Mode | null;
    activeMode: Mode;
    score: number;
    best: number;
    bestByMode: Record<Mode, number>;
    lengthText: string;
    buff: string;
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
    displayChoices: DisplayChoice[];
    displayMode: DisplaySave['mode'];
    displayWidth: number;
    displayHeight: number;
    displayLine: string;
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
    /** 菜单标题轻微的上下浮动 */
    bob?: number;
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
    danger?: boolean;
    parent: 'screen' | 'field';
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
    /** 遮罩 + 卡片，画在场地动态层之上、文字之下 */
    cards: DrawCmd[];
    /** 面板状态签名，用来判断卡片层要不要重画 */
    panelKey: string;
}

/* ------------------------------ 文本宽度估算 ------------------------------ */

/** 不加载字体也能得到稳定宽度：CJK 记 1 个字宽，西文记 0.56 个字宽 */
export function measure(text: string, size: number): number {
    let w = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.codePointAt(i) ?? 0;
        w += code > 255 ? size : 0.56 * size;
    }
    return w;
}

// 统一放大字号：旧版 12px 正文在 2560 宽屏上偏小
const FS = 1.18;
// 与文字相关的高度 / 行距
function V(n: number): number {
    return Math.round(n * 1.15);
}
function S(n: number): number {
    return Math.round(n * FS);
}

interface LabelOpt {
    bold?: boolean;
    align?: 'left' | 'center' | 'right';
    w?: number;
    parent?: 'screen' | 'field';
    bob?: number;
}

function label(
    list: LabelSpec[],
    id: string,
    text: string,
    x: number,
    y: number,
    size: number,
    color: string,
    opt: LabelOpt = {}
): void {
    const fs = S(size);
    list.push({
        id,
        text,
        x,
        y,
        size: fs,
        color,
        bold: opt.bold === true,
        align: opt.align ?? 'left',
        w: opt.w ?? measure(text, fs) + 4,
        parent: opt.parent ?? 'screen',
        bob: opt.bob ?? 0,
    });
}

interface ButtonOpt {
    enabled?: boolean;
    primary?: boolean;
    selected?: boolean;
    danger?: boolean;
    parent?: 'screen' | 'field';
}

function button(
    list: ButtonSpec[],
    id: string,
    text: string,
    cx: number,
    cy: number,
    w: number,
    h: number,
    opt: ButtonOpt = {}
): void {
    list.push({
        id,
        text,
        x: cx,
        y: cy,
        w,
        h: V(h),
        enabled: opt.enabled !== false,
        primary: opt.primary === true,
        selected: opt.selected === true,
        danger: opt.danger === true,
        parent: opt.parent ?? 'screen',
    });
}

const START_TEXT: Partial<Record<Phase, string>> = { menu: '开始游戏', over: '再来一局' };
const PAUSE_TEXT: Partial<Record<Phase, string>> = { paused: '继续' };

/* ------------------------------ 设置面板 ------------------------------ */

const TABS: Array<[SettingsTab, string]> = [
    ['display', '显示'],
    ['sound', '音效'],
    ['help', '玩法'],
    ['record', '记录'],
];

interface Ctx {
    left: number;
    right: number;
    inner: number;
    x: number;
    w: number;
    top: number;
    bottom: number;
    rowH: number;
    y: number;
}

function settingsPanel(
    labels: LabelSpec[],
    buttons: ButtonSpec[],
    cards: DrawCmd[],
    m: UiModel,
    pw: number,
    ph: number,
    fieldW: number,
    fieldH: number
): void {
    const mark = labels.length;
    const cx = fieldW / 2;
    const cy = fieldH / 2;
    const inner = pw < 480 ? 16 : 22;
    const left = cx - pw / 2;
    const right = cx + pw / 2;
    const top = cy + ph / 2;
    const bottom = cy - ph / 2;
    // 窗口较小时压缩头部与页脚，保证内容区始终有空间
    const compact = ph < 360;
    const titleSize = compact ? 16 : 19;
    const tabH = compact ? 26 : 30;
    const tabY = top - (compact ? 44 : 60);
    const bodyTop = tabY - tabH / 2 - (compact ? 14 : 22);
    const footH = compact ? 30 : 34;
    const footY = bottom + (compact ? 20 : 30);
    // 内容区必须留出页脚按钮的高度，否则小窗口下会与「退出游戏」重叠
    const bodyBottom = footY + V(footH) / 2 + (compact ? 17 : 12);
    const bodyH = Math.max(40, bodyTop - bodyBottom);
    const rowH = bodyH < 210 ? 20 : 25;

    cards.push(...paintCard(cx, cy, pw, ph, '#8b7cff'));

    label(labels, 'set-title', '设置', left + inner, top - (compact ? 21 : 28), titleSize, ACCENT, { bold: true });
    if (!compact) {
        label(labels, 'set-mode', '当前模式 · ' + MODE_NAME[m.activeMode], right - inner, top - 28, 12, MUTED, { align: 'right' });
    }

    const tabW = Math.min(96, (pw - inner * 2 - 24) / 4);
    let tx = left + inner + tabW / 2;
    for (const [key, name] of TABS) {
        button(buttons, 'tab-' + key, name, tx, tabY, tabW, tabH, {
            selected: m.settingsTab === key,
            parent: 'field',
        });
        tx += tabW + 8;
    }

    if (!compact) {
        label(
            labels,
            'set-foot-hint',
            m.confirmQuit ? '再点一次「确认退出」即关闭游戏' : '',
            left + inner,
            footY + 26,
            12,
            m.confirmQuit ? GOLD : MUTED,
            { w: Math.max(20, pw - inner * 2 - 260) }
        );
    }

    button(buttons, 'quit', m.confirmQuit ? '确认退出？' : '退出游戏', left + inner + 58, footY, 116, footH, {
        danger: true,
        selected: m.confirmQuit,
        parent: 'field',
    });
    button(buttons, 'close-settings', '关闭', right - inner - 44, footY, 88, footH, {
        primary: true,
        parent: 'field',
    });

    const box: Ctx = { left, right, inner, x: left + inner, w: right - left - inner * 2, top: bodyTop, bottom: bodyBottom, rowH, y: bodyTop };
    if (m.settingsTab === 'skins') {
        sectionTitle(labels, box, '选择皮肤 · 自动保存');
        for (const [id, name] of [['classic', '经典青蛇'], ['dragon', '金鳞祥龙']]) {
            button(buttons, 'skin-' + id, name, box.x + 90, box.y, 180, 32, { parent: 'field', selected: (m.skin || 'classic') === id });
            box.y -= 44;
        }
    }
    else if (m.settingsTab === 'sound') soundTab(labels, buttons, m, box);
    else if (m.settingsTab === 'help') helpTab(labels, buttons, m, box);
    else if (m.settingsTab === 'record') recordTab(labels, buttons, m, box);
    else displayTab(labels, buttons, m, box);

    // 面板里的文字全部位于场地坐标系
    for (let i = mark; i < labels.length; i++) labels[i].parent = 'field';
}

function sectionTitle(labels: LabelSpec[], c: Ctx, text: string): void {
    label(labels, 'set-h-' + text, text, c.x, c.y, 13, ACCENT, { bold: true });
    c.y -= c.rowH + 4;
}

/* 显示 */
function displayTab(labels: LabelSpec[], buttons: ButtonSpec[], m: UiModel, c: Ctx): void {
    const floor = c.bottom;
    if (c.y >= floor + 12) sectionTitle(labels, c, '窗口与分辨率');
    if (c.y >= floor + 6) {
        label(labels, 'set-display-line', m.displayLine || '渲染尺寸跟随窗口', c.x, c.y, 12, MUTED, { w: c.w });
        c.y -= 26;
    }
    if (c.y - 15 < floor) return;
    button(buttons, 'display-window', '窗口', c.x + 46, c.y, 92, 26, {
        parent: 'field',
        selected: m.displayMode === 'window',
    });
    button(buttons, 'display-full', '全屏', c.x + 142, c.y, 92, 26, {
        parent: 'field',
        selected: m.displayMode === 'fullscreen',
    });
    c.y -= 38;

    const choices = m.displayChoices || [];
    if (!choices.length) {
        if (c.y >= floor + 6) label(labels, 'set-display-empty', '分辨率跟随当前窗口', c.x, c.y, 12, MUTED, { w: c.w });
        return;
    }

    const cols = c.w >= 430 ? 2 : 1;
    const gap = 8;
    const bw = Math.min(170, (c.w - gap * (cols - 1)) / cols);
    const rows2 = Math.max(1, Math.floor((c.y - 26 - floor - 15) / 36) + 1);
    if (c.y >= floor + 6) {
        label(labels, 'set-res-title', '窗口尺寸（切换后会记住）', c.x, c.y, 12, MUTED, { w: c.w });
        c.y -= 26;
    }
    const shown = Math.min(choices.length, cols * rows2);
    let placed = 0;
    for (let i = 0; i < shown; i++) {
        const ch = choices[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const rowY = c.y - row * 36;
        if (rowY - 16 < floor) break; // 放不下就停，绝不允许压到页脚
        const selected = m.displayMode === 'window' && ch.width === m.displayWidth && ch.height === m.displayHeight;
        button(buttons, 'res-' + ch.id, ch.label, c.x + bw / 2 + col * (bw + gap), rowY, bw, 26, {
            parent: 'field',
            selected,
        });
        placed += 1;
    }
    const after = c.y - Math.ceil(placed / cols) * 36;
    if (placed < choices.length && after >= floor + 4) {
        label(labels, 'set-res-more', '（窗口较矮，其余尺寸见全屏）', c.x, after, 11, MUTED, { w: c.w });
    } else if (after >= floor + 20) {
        label(labels, 'set-display-note', '启动时总是全屏，这里可以临时切到窗口', c.x, floor + 6, 11, MUTED, { w: c.w });
    }
}

/* 音效 */
function soundTab(labels: LabelSpec[], buttons: ButtonSpec[], m: UiModel, c: Ctx): void {
    const floor = c.bottom;
    if (c.y >= floor + 12) sectionTitle(labels, c, '游戏音效');
    if (c.y >= floor + 6) {
        label(
            labels,
            'set-sound-state',
            m.soundAvailable ? '当前状态：' + (m.soundOn ? '开启' : '关闭') : '当前状态：系统不支持',
            c.x,
            c.y,
            13,
            m.soundAvailable ? TEXT : GOLD,
            { w: c.w }
        );
        c.y -= 32;
    }
    if (c.y - 18 >= floor) {
        button(buttons, 'sound', m.soundOn ? '关闭音效' : '开启音效', c.x + 70, c.y, 140, 30, {
            parent: 'field',
            selected: m.soundOn,
            enabled: m.soundAvailable,
        });
        c.y -= 42;
    }
    if (c.y >= floor + 6) {
        label(labels, 'set-sound-tip', '按 N 键可以随时开关', c.x, c.y, 12, MUTED, { w: c.w });
        c.y -= 26;
    }
    if (c.y < floor + 6) return;
    if (!m.soundAvailable) {
        label(labels, 'set-sound-warn', '没有检测到可用的音频设备，音效暂时不可用', c.x, c.y, 12, GOLD, { w: c.w });
        return;
    }
    label(labels, 'set-sound-desc', '吃到不同果实会播放不同音高的提示音；暂停、破纪录也有独立音效。', c.x, c.y, 12, MUTED, { w: c.w });
}

/* 玩法 */
const HELP_ROWS: Array<[string, string]> = [
    ['方向键 / WASD', '转向，可提前存两次'],
    ['空格 / P', '暂停或继续'],
    ['R', '重新开始'],
    ['H / F1', '打开设置 · 玩法'],
    ['Esc', '关面板 / 暂停 / 回标题'],
    ['任意键', '在标题界面直接开始游戏'],
    ['浆果 +10', '星果 +30，多长一节'],
    ['时砂 慢动作', '莲灯 三次双倍'],
    ['经典', '撞墙结束，节奏稳定'],
    ['禅意', '从对面穿出，节奏更慢'],
    ['挑战', '撞墙结束，越吃越快'],
];

function helpTab(labels: LabelSpec[], buttons: ButtonSpec[], m: UiModel, c: Ctx): void {
    sectionTitle(labels, c, '操作与规则');
    const keyW = Math.min(132, c.w * 0.36);
    // 行距按可用高度自适应，尽量让 11 条全部显示出来
    const rowH = Math.max(15, Math.min(c.rowH, Math.floor((c.y - c.bottom) / HELP_ROWS.length)));
    const rows = Math.floor((c.y - c.bottom) / rowH) + 1;
    let y = c.y;
    for (let i = 0; i < HELP_ROWS.length && i < rows; i++) {
        const [key, val] = HELP_ROWS[i];
        const isFood = i === 6 || i === 7;
        const isMode = i >= 8;
        const anyKey = i === 5;
        const color = isMode ? MODE_COLOR[(['classic', 'zen', 'challenge'] as Mode[])[i - 8]] : isFood || anyKey ? GOLD : ACCENT;
        label(labels, 'help-k-' + i, key, c.x, y, 12, color, { bold: true });
        label(labels, 'help-v-' + i, val, c.x + keyW, y, 12, TEXT, { w: c.w - keyW });
        y -= rowH;
    }
}

/* 记录 */
function recordTab(labels: LabelSpec[], buttons: ButtonSpec[], m: UiModel, c: Ctx): void {
    sectionTitle(labels, c, '历史最高 ' + m.best);
    button(buttons, 'clear-history', m.confirmClear ? '确认清空？' : '清空记录', c.right - c.inner - 58, c.y + c.rowH + 4, 116, 26, {
        parent: 'field',
        danger: true,
        selected: m.confirmClear,
    });
    const modes = (['classic', 'zen', 'challenge'] as Mode[]).map((k) => MODE_NAME[k] + ' ' + (m.bestByMode[k] || 0)).join('    ');
    if (c.y >= c.bottom + 6) {
        label(labels, 'set-best-modes', modes, c.x, c.y, 12, MUTED, { w: c.w });
        c.y -= 26;
    }

    const list = m.history || [];
    const rows = Math.floor((c.y - c.bottom) / c.rowH) + 1;
    if (!list.length) {
        if (c.y >= c.bottom + 6) label(labels, 'set-hist-empty', '还没有对局记录', c.x, c.y, 12, MUTED, { w: c.w });
        return;
    }
    for (let i = 0; i < list.length && i < rows; i++) {
        const h = list[i];
        const row = i + 1 + '.  ' + h.score + ' 分    ' + MODE_NAME[h.mode] + ' · 长度 ' + h.length + '    ' + h.time;
        label(labels, 'set-hist-' + i, row, c.x, c.y, 12, TEXT, { w: c.w });
        c.y -= c.rowH;
    }
}

/* ------------------------------ 主界面 ------------------------------ */

export function layoutChrome(W: number, H: number, ui: UiModel, clock = 0): Chrome {
    void clock;
    const narrow = W < 1000;
    const pad = W < 700 ? 10 : 16;
    const headH = H < 560 ? 40 : 46;
    const bottomH = narrow ? 132 : 112;
    const maxW = Math.max(160, W - pad * 2);
    const maxH = Math.max(120, H - headH - bottomH - 8);

    // 场地：先按理想格子数算，再收敛到能放下的最大格子
    const fit = fitGrid(maxW, maxH);
    let cols = fit[0];
    let rows = fit[1];
    let cell = fit[2];
    for (; rows * cell > maxH && rows > 8; ) rows -= 1;
    for (; cols * cell > maxW && cols > 8; ) cols -= 1;

    const fieldW = cols * cell;
    const fieldH = rows * cell;
    const field: FieldRect = {
        x: pad + Math.max(0, (maxW - fieldW) / 2),
        y: bottomH + Math.max(0, (maxH - fieldH) / 2),
        w: fieldW,
        h: fieldH,
        cols,
        rows,
        cell,
    };

    const labels: LabelSpec[] = [];
    const buttons: ButtonSpec[] = [];
    const cards: DrawCmd[] = [];

    const headY = H - headH / 2;
    const titleSize = W < 760 ? 16 : 20;
    const smallSize = W < 760 ? 13 : 15;
    const modeRowY = narrow ? bottomH - 24 : 92;
    const infoRowY = narrow ? bottomH - 58 : 92;
    const buttonRowY = narrow ? 44 : 52;

    // 顶部信息：分数/长度按最宽可能值预留位置，避免数字变长时整行跳动
    const modeColor = ui.activeMode === 'zen' ? '#8dffc6' : ui.activeMode === 'challenge' ? GOLD : ACCENT;
    const items: Array<[string, string, number, string, boolean]> = [
        ['title', '贪吃蛇', titleSize, ACCENT, true],
        ['score', '分数 ' + (ui.phase === 'menu' ? 0 : ui.score), titleSize, ui.scoreHot ? GOLD : TEXT, true],
        ['best', '最高 ' + ui.best, smallSize, MUTED, false],
        ['length', '长度 ' + ui.lengthText, smallSize, MUTED, false],
        ['mode', MODE_NAME[ui.activeMode], smallSize, modeColor, true],
    ].filter((it) => !(ui.phase === 'menu' && (it[0] === 'score' || it[0] === 'length'))) as Array<
        [string, string, number, string, boolean]
    >;
    const reserve: Record<string, number> = {
        score: measure('分数 8888', S(titleSize)),
        length: measure('长度 888', S(smallSize)),
    };
    const rightLimit = W - pad - 160;
    let cursorX = pad;
    const visible: Array<[string, string, number, string, boolean]> = [];
    for (const it of items) {
        const span = reserve[it[0]] ?? measure(it[1], S(it[2]));
        const next = cursorX + span + 4;
        if (visible.length >= 2 && next > rightLimit) break;
        visible.push(it);
        cursorX = next + 12;
    }
    cursorX = pad;
    for (const it of visible) {
        label(labels, it[0], it[1], cursorX, headY, it[2], it[3], { bold: it[4] });
        cursorX += (reserve[it[0]] ?? measure(it[1], S(it[2]))) + 16;
    }
    // 增益条常驻（内容可能为空），这样吃到时砂/莲灯就不需要重新排版
    label(labels, 'buff', ui.buff, W - pad, headY, 12, MUTED, { align: 'right', bold: true, w: Math.max(4, measure(ui.buff, S(12)) + 4) });

    // 模式选择
    let mx = pad;
    label(labels, 'mode-tag', '模式', mx, modeRowY, 13, MUTED);
    mx += measure('模式', S(13)) + 8;
    const modeW = W < 700 ? 56 : 64;
    const pending = ui.pendingMode;
    const highlighted = pending ?? (ui.phase === 'menu' || ui.phase === 'over' ? ui.selectedMode : ui.activeMode);
    for (const key of MODES) {
        button(buttons, 'mode-' + key, MODE_NAME[key], mx + modeW / 2, modeRowY, modeW, 26, {
            selected: key === highlighted,
        });
        mx += modeW + 6;
    }

    // 模式说明
    const blurb =
        !ui.pendingMode || (ui.phase !== 'playing' && ui.phase !== 'paused')
            ? MODE_BLURB[ui.phase === 'menu' ? ui.selectedMode : ui.activeMode]
            : '下局切换为' + MODE_NAME[ui.pendingMode] + ' · ' + MODE_BLURB[ui.pendingMode];
    if (narrow) {
        label(labels, 'blurb', blurb, pad, infoRowY, 12, MUTED, { w: maxW });
    } else {
        const leftEdge = mx + 16;
        const rightEdge = W - pad;
        if (rightEdge - leftEdge >= 120) label(labels, 'blurb', blurb, leftEdge, modeRowY, 12, MUTED, { w: rightEdge - leftEdge });
    }

    // 右侧操作区：设置 / 暂停 / 开始（标题界面用中央的大按钮，不再放第二个开始键）
    // 暂停状态下把「继续」做成主按钮，避免误触「重新开始」丢进度
    const pausedNow = ui.phase === 'paused';
    const actions: Array<[string, string, boolean, boolean]> = [
        ['settings', '设置', true, ui.settingsOpen],
        ['skins', '皮肤', true, ui.settingsOpen && ui.settingsTab === 'skins'],
        ['pause', PAUSE_TEXT[ui.phase] ?? '暂停', ui.phase === 'playing' || pausedNow, false],
    ];
    if (ui.phase !== 'menu') {
        actions.push(['start', START_TEXT[ui.phase] ?? '重新开始', true, !pausedNow]);
    }
    let ax = W - pad;
    const actionH = narrow ? 28 : 30;
    for (const a of actions) {
        const bw = Math.max(narrow ? 56 : 72, measure(a[1], S(15)) + (narrow ? 20 : 34));
        ax -= bw;
        const isPrimary = a[0] === 'start' ? !pausedNow : a[0] === 'pause' ? pausedNow : false;
        button(buttons, a[0], a[1], ax + bw / 2, buttonRowY, bw, actionH, {
            enabled: a[2],
            selected: a[3],
            primary: isPrimary,
        });
        ax -= 6;
    }

    // 快捷键提示（标题界面已提示“按任意键开始”，不再重复按键说明）
    if (W >= 760 && ui.phase !== 'menu') {
        label(
            labels,
            'hint',
            narrow
                ? '方向键 / WASD · 空格暂停 · R 重开 · H 设置'
                : '方向键 / WASD 转向（可预存两次）· 空格暂停 · R 重开 · H 设置',
            pad,
            16,
            12,
            MUTED,
            { w: W - pad * 2 }
        );
    }

    // 面板
    const panel = ui.settingsOpen ? 'settings' : ui.phase === 'paused' ? 'pause' : ui.phase === 'over' ? 'over' : '';
    let panelKey = '';
    if (panel === 'settings') {
        const pw = Math.min(fieldW - 16, 660);
        const ph = Math.min(fieldH - 16, 500);
        cards.push(paintDim(fieldW, fieldH));
        settingsPanel(labels, buttons, cards, ui, pw, ph, fieldW, fieldH);
        panelKey = 'settings:' + ui.settingsTab + ':' + (ui.confirmQuit ? 1 : 0) + ':' + (ui.confirmClear ? 1 : 0);
    } else if (panel) {
        cards.push(paintDim(fieldW, fieldH));
        pauseAndOver(labels, cards, ui, field, panel);
        panelKey = panel;
    }

    // 触屏方向键
    if (ui.mobile && (ui.phase === 'playing' || ui.phase === 'paused')) {
        const size = 46;
        const gap = 4;
        const px = fieldW - 1.6 * size;
        const py = 1.7 * size;
        button(buttons, 'pad-up', '上', px, py + size + gap, size, size, { parent: 'field' });
        button(buttons, 'pad-down', '下', px, py - size - gap, size, size, { parent: 'field' });
        button(buttons, 'pad-left', '左', px - size - gap, py, size, size, { parent: 'field' });
        button(buttons, 'pad-right', '右', px + size + gap, py, size, size, { parent: 'field' });
    }

    if (ui.phase === 'menu' && !ui.settingsOpen) menuDecor(labels, field);

    return { field, labels, buttons, cards, panelKey };
}

function pauseAndOver(labels: LabelSpec[], cards: DrawCmd[], m: UiModel, field: FieldRect, panel: string): void {
    const fieldW = field.w;
    const fieldH = field.h;
    const unit = field.cell;
    const cx = fieldW / 2;
    const cy = fieldH / 2;
    if (panel === 'pause') {
        const w = Math.min(fieldW - 40, 420);
        const h = Math.min(fieldH - 40, 220);
        cards.push(...paintCard(cx, cy, w, h, ACCENT));
        label(labels, 'pause-title', '暂停', cx, cy + 0.22 * h, Math.max(22, 0.7 * unit), TEXT, { bold: true, align: 'center', parent: 'field' });
        label(labels, 'pause-keys', '空格继续    ·    R 重新开始    ·    H 设置    ·    Esc 返回标题', cx, cy - 8, Math.max(11, unit / 3), MUTED, {
            align: 'center',
            w: w - 24,
            parent: 'field',
        });
        label(labels, 'pause-blurb', MODE_BLURB[m.activeMode], cx, cy - 0.26 * h, Math.max(10, unit / 3.4), ACCENT, {
            align: 'center',
            w: w - 24,
            parent: 'field',
        });
        return;
    }
    const w = Math.min(fieldW - 36, 460);
    const h = Math.min(fieldH - 28, 340);
    const accent = m.newRecord || m.victory ? GOLD : ACCENT;
    cards.push(...paintCard(cx, cy, w, h, accent));
    const top = cy + h / 2;
    label(labels, 'over-title', m.victory ? '清台' : '游戏结束', cx, top - 36, Math.max(18, 0.55 * unit), accent, {
        bold: true,
        align: 'center',
        parent: 'field',
    });
    label(labels, 'over-score', String(m.resultScore), cx, top - 0.4 * h, Math.max(28, 0.95 * unit), TEXT, {
        bold: true,
        align: 'center',
        parent: 'field',
    });
    let banner = '本局得分';
    let bannerColor = MUTED;
    if (m.newRecord) {
        banner = '新纪录';
        bannerColor = GOLD;
    } else if (m.newModeRecord) {
        banner = MODE_NAME[m.resultMode] + '新纪录';
        bannerColor = GOLD;
    }
    label(labels, 'over-banner', banner, cx, top - 0.4 * h - Math.max(28, 0.55 * unit), Math.max(12, unit / 2.8), bannerColor, {
        bold: true,
        align: 'center',
        parent: 'field',
    });
    label(
        labels,
        'over-meta',
        '最高 ' + m.best + '    ·    ' + MODE_NAME[m.resultMode] + ' ' + (m.bestByMode[m.resultMode] || 0) + '    ·    长度 ' + m.resultLen,
        cx,
        top - 0.68 * h,
        Math.max(10, unit / 3.5),
        MUTED,
        { align: 'center', w: w - 20, parent: 'field' }
    );
    label(labels, 'over-hint', 'Enter / R 再来一局     Esc 返回标题', cx, top - 0.84 * h, Math.max(10, unit / 3.4), TEXT, {
        align: 'center',
        w: w - 16,
        parent: 'field',
    });
}

/* ------------------------------ 标题界面 ------------------------------ */
// 只保留游戏名 + 一行「按任意键开始游戏」，不再有开始按钮
function menuDecor(labels: LabelSpec[], field: FieldRect): void {
    const size = Math.round(Math.min(0.14 * field.h, Math.max(44, 2 * field.cell)));
    const cx = field.w / 2;
    const titleY = 0.7 * field.h;
    label(labels, 'menu-shadow', '贪吃蛇', cx + 2, titleY - 3, size, '#2a1248', { bold: true, align: 'center', parent: 'field', bob: 1 });
    label(labels, 'menu-title', '贪吃蛇', cx, titleY, size, TEXT, { bold: true, align: 'center', parent: 'field', bob: 1 });
    label(labels, 'menu-go', '按任意键开始游戏', cx, titleY - S(size) * 0.92, 17, MUTED, { align: 'center', parent: 'field', w: field.w - 40 });
}

export const FOOD_HELP: FoodKind[] = ['berry', 'star', 'slow', 'mult'];

export interface UiBox {
    id: string;
    parent: 'screen' | 'field';
    left: number;
    bottom: number;
    w: number;
    h: number;
}

export function chromeBoxes(chrome: Chrome): UiBox[] {
    const boxes: UiBox[] = [];
    for (const b of chrome.buttons) {
        boxes.push({ id: b.id, parent: b.parent, left: b.x - b.w / 2, bottom: b.y - b.h / 2, w: b.w, h: b.h });
    }
    for (const l of chrome.labels) {
        const bw = Math.max(8, l.w);
        const bh = l.size + 8;
        let x = l.x;
        if (l.align === 'center') x = l.x - bw / 2;
        else if (l.align === 'right') x = l.x - bw;
        boxes.push({ id: l.id, parent: l.parent, left: x, bottom: l.y - bh / 2, w: bw, h: bh });
    }
    return boxes;
}