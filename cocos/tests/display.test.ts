import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeSave } from '../assets/scripts/logic/config';
import { choiceFits, fitWorkArea, parseNativeDisplay, pickSavedWindow, windowChoices, type MonitorInfo } from '../assets/scripts/logic/display';
import { chromeBoxes, layoutChrome, type UiModel } from '../assets/scripts/logic/layout';

function model(extra: Partial<UiModel> = {}): UiModel {
    return {
        phase: 'menu',
        settingsOpen: false,
        settingsTab: 'display',
        confirmQuit: false,
        selectedMode: 'classic',
        pendingMode: null,
        activeMode: 'classic',
        score: 0,
        best: 120,
        bestByMode: { classic: 120, zen: 40, challenge: 90 },
        lengthText: '—',
        buff: '',
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

test('window choices stay inside the screen', () => {
    const laptop: MonitorInfo = { workW: 1920, workH: 1040, screenW: 1920, screenH: 1080 };
    const choices = windowChoices(laptop);
    assert.deepEqual(fitWorkArea(laptop), { width: 1848, height: 1038 });
    // 允许选到整块屏幕的尺寸（2560×1600 这类原生分辨率需要它），但不能超过屏幕
    assert.deepEqual(choices.map((choice) => choice.id), ['auto', '960x540', '1280x720', '1600x900', '1920x1080']);
    for (const choice of choices) {
        assert.ok(choice.width >= 640 && choice.height >= 360);
        assert.ok(choice.width <= laptop.screenW && choice.height <= laptop.screenH);
    }
    // choiceFits 仍然只描述“能否放进任务栏工作区”
    assert.equal(choiceFits(1920, 1080, laptop), false);
    const desktop: MonitorInfo = { workW: 2560, workH: 1400, screenW: 2560, screenH: 1440 };
    assert.equal(windowChoices(desktop).some((choice) => choice.width === 2560), true);
    assert.equal(windowChoices(desktop).some((choice) => choice.width === 1920), true);
    const tall: MonitorInfo = { workW: 2560, workH: 1528, screenW: 2560, screenH: 1600 };
    assert.equal(windowChoices(tall).some((choice) => choice.id === '2560x1600'), true);
    const tiny: MonitorInfo = { workW: 800, workH: 600, screenW: 800, screenH: 600 };
    const fitted = windowChoices(tiny);
    assert.equal(fitted.length, 1);
    assert.ok(fitted[0].width <= 800 && fitted[0].height <= 600);
    assert.equal(pickSavedWindow(1920, 1080, choices)?.id, '1920x1080');
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
        assertInside(w, h, { settingsOpen: true });
        assertInside(w, h, {
            settingsOpen: true,
            settingsTab: 'display',
            displayChoices: windowChoices({ workW: 1920, workH: 1040, screenW: 1920, screenH: 1080 }),
            displayMode: 'window',
        });
    }
});

test('skin selection persists and invalid or old saves use classic', () => {
    assert.equal(sanitizeSave({best: 123}).skin, 'classic');
    assert.equal(sanitizeSave({skin: 'dragon', best: 123}).skin, 'dragon');
    assert.equal(sanitizeSave({skin: 'invalid'}).skin, 'classic');
    assert.equal(sanitizeSave({skin: 'dragon', best: 123}).best, 123);
});
test('skin panel fits small and desktop windows', () => {
    for (const [w,h] of [[360,640],[640,360],[1280,720],[1920,1080]]) {
        assertInside(w,h,{settingsOpen:true,settingsTab:'skins',skin:'dragon'});
    }
});

test('frame rate options persist and show in the display tab', () => {
    assert.equal(sanitizeSave({ fps: 120 }).fps, 120);
    assert.equal(sanitizeSave({ fps: 0 }).fps, 0);      // 0 = 不限
    assert.equal(sanitizeSave({ fps: 999 }).fps, 60);   // 非法值回到默认
    assert.equal(sanitizeSave({}).fps, 60);
    for (const [w, h] of [[1280, 720], [960, 540], [1920, 1080]]) {
        const chrome = layoutChrome(w, h, model({ settingsOpen: true, settingsTab: 'display', fps: 180 }));
        const ids = chrome.buttons.map((b) => b.id);
        for (const v of [30, 60, 120, 180, 0]) {
            assert.ok(ids.includes('fps-' + v), `${w}x${h} 缺少 fps-${v}`);
        }
        assert.equal(chrome.buttons.find((b) => b.id === 'fps-180')?.selected, true);
        assert.equal(chrome.buttons.find((b) => b.id === 'fps-60')?.selected, false);
    }
});
