import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeSave } from '../assets/scripts/logic/config';
import { choiceFits, parseNativeDisplay, pickSavedWindow, windowChoices, type MonitorInfo } from '../assets/scripts/logic/display';
import { chromeBoxes, layoutChrome, type UiModel } from '../assets/scripts/logic/layout';

function model(extra: Partial<UiModel> = {}): UiModel {
    return {
        phase: 'menu',
        help: false,
        historyOpen: false,
        selectedMode: 'classic',
        pendingMode: null,
        activeMode: 'classic',
        score: 0,
        best: 120,
        bestByMode: { classic: 120, zen: 40, challenge: 90 },
        lengthText: '—',
        buff: '',
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
        ...extra,
    };
}

function overlaps(a: { left: number; bottom: number; w: number; h: number }, b: { left: number; bottom: number; w: number; h: number }): boolean {
    const ax2 = a.left + a.w;
    const ay2 = a.bottom + a.h;
    const bx2 = b.left + b.w;
    const by2 = b.bottom + b.h;
    const iw = Math.min(ax2, bx2) - Math.max(a.left, b.left);
    const ih = Math.min(ay2, by2) - Math.max(a.bottom, b.bottom);
    return iw > 1 && ih > 1;
}

function assertInside(W: number, H: number, extra: Partial<UiModel> = {}): void {
    const ui = model({ mobile: H > W, ...extra });
    const chrome = layoutChrome(W, H, ui, 0);
    const field = chrome.field;
    assert.ok(field.w <= W - 8, `${W}x${H} field wider than the window`);
    assert.ok(field.h <= H - 8, `${W}x${H} field taller than the window`);
    assert.ok(field.x >= 0 && field.y >= 0, `${W}x${H} field origin`);
    assert.ok(field.x + field.w <= W + 0.5 && field.y + field.h <= H + 0.5, `${W}x${H} field outside`);
    const boxes = chromeBoxes(chrome);
    const screen = boxes.filter((box) => box.parent === 'screen');
    const fieldBoxes = boxes.filter((box) => box.parent === 'field');
    for (const box of screen) {
        assert.ok(box.left >= -0.5, `${W}x${H} ${box.id} left ${box.left}`);
        assert.ok(box.bottom >= -0.5, `${W}x${H} ${box.id} bottom ${box.bottom}`);
        assert.ok(box.left + box.w <= W + 0.5, `${W}x${H} ${box.id} right`);
        assert.ok(box.bottom + box.h <= H + 0.5, `${W}x${H} ${box.id} top`);
    }
    for (const box of fieldBoxes) {
        assert.ok(box.left >= -0.5 && box.bottom >= -0.5, `${W}x${H} ${box.id} field origin`);
        assert.ok(box.left + box.w <= field.w + 0.5, `${W}x${H} ${box.id} field right`);
        assert.ok(box.bottom + box.h <= field.h + 0.5, `${W}x${H} ${box.id} field top`);
    }
    const controls = screen.filter((box) => box.id === 'slider' || chrome.buttons.some((button) => button.id === box.id));
    for (let i = 0; i < controls.length; i++) {
        for (let j = i + 1; j < controls.length; j++) {
            assert.ok(!overlaps(controls[i], controls[j]), `${W}x${H} ${controls[i].id} overlaps ${controls[j].id}`);
        }
    }
}

test('window choices stay inside the work area', () => {
    const laptop: MonitorInfo = { workW: 1920, workH: 1040, screenW: 1920, screenH: 1080 };
    const choices = windowChoices(laptop);
    assert.deepEqual(choices.map((choice) => choice.id), ['960x540', '1280x720', '1600x900']);
    for (const choice of choices) {
        assert.equal(choiceFits(choice.width, choice.height, laptop), true);
    }
    assert.equal(choiceFits(1920, 1080, laptop), false);
    const desktop: MonitorInfo = { workW: 2560, workH: 1400, screenW: 2560, screenH: 1440 };
    assert.equal(windowChoices(desktop).some((choice) => choice.width === 2560), false);
    assert.equal(windowChoices(desktop).some((choice) => choice.width === 1920), true);
    const tiny: MonitorInfo = { workW: 800, workH: 600, screenW: 800, screenH: 600 };
    const fitted = windowChoices(tiny);
    assert.equal(fitted.length, 1);
    assert.ok(fitted[0].width <= 800 && fitted[0].height <= 600);
    assert.equal(pickSavedWindow(1920, 1080, choices)?.id, '1600x900');
    assert.equal(pickSavedWindow(1280, 720, choices)?.id, '1280x720');
});

test('old saves keep scores and gain a display block', () => {
    const cfg = sanitizeSave({ best: 80, speed: 5, mode: 'zen', sound: false, history: [{ score: 12, mode: 'zen', length: 6, time: 't' }] });
    assert.equal(cfg.best, 80);
    assert.equal(cfg.mode, 'zen');
    assert.equal(cfg.sound, false);
    assert.equal(cfg.history.length, 1);
    assert.equal(cfg.display.mode, 'window');
    assert.equal(cfg.display.width, 0);
    const again = sanitizeSave({ ...cfg, display: { mode: 'fullscreen', width: 1600, height: 900 } });
    assert.equal(again.best, 80);
    assert.equal(again.display.mode, 'fullscreen');
    assert.equal(again.display.width, 1600);
    assert.equal(parseNativeDisplay('{"ok":1,"fullscreen":0,"width":1280,"height":720,"screenW":1920,"screenH":1080,"workW":1920,"workH":1040,"dpi":144,"smoke":1}')?.dpi, 144);
    assert.equal(parseNativeDisplay('nope'), null);
});

test('controls stay on screen at desktop, window, and phone sizes', () => {
    const sizes: Array<[number, number]> = [
        [1280, 720],
        [1920, 1080],
        [2560, 1440],
        [960, 540],
        [800, 600],
        [390, 844],
        [844, 390],
    ];
    for (const [w, h] of sizes) {
        assertInside(w, h);
        assertInside(w, h, { phase: 'playing', buff: '慢动作 3.2s   双倍 ×2', score: 80, lengthText: '16' });
        assertInside(w, h, { help: true });
        assertInside(w, h, {
            displayOpen: true,
            displayChoices: windowChoices({ workW: 1920, workH: 1040, screenW: 1920, screenH: 1080 }),
            displayMode: 'window',
        });
    }
});
