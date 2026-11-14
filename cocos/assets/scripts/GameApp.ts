import {
    _decorator,
    AudioClip,
    Sprite,
    SpriteFrame,
    Texture2D,
    Rect,
    AudioSource,
    BlockInputEvents,
    Color,
    Component,
    EventKeyboard,
    EventTouch,
    game,
    Game,
    Graphics,
    input,
    Input,
    KeyCode,
    Label,
    Layers,
    Mask,
    Node,
    ResolutionPolicy,
    resources,
    screen,
    sys,
    UITransform,
    Vec2,
    view,
} from 'cc';
import {
    BERRY,
    BODY_A,
    CYAN,
    defaultSave,
    GOLD,
    HISTORY_MAX,
    intervalMs,
    MODE_NAME,
    sanitizeSave,
    stampNow,
    STORAGE_KEY,
    TEXT,
    VIOLET,
    type FoodKind,
    type Mode,
    type SaveData,
} from './logic/config';
import { FX } from './logic/fx';
import { displayStatus, parseNativeDisplay, pickSavedWindow, windowChoices, type DisplayChoice, type NativeDisplay } from './logic/display';
import { layoutChrome, measure, type Chrome, type LabelSpec, type ButtonSpec, type SettingsTab, type UiModel } from './logic/layout';
import { mascotGeometry, paintMascot, type SnakeGeometry, snakePolylines, cellCenter, makeStars, paintBackground, paintField, type DrawCmd, type Star } from './logic/paint';
import { SnakeWorld, type WorldEvent } from './logic/SnakeWorld';
import { toneAvailable, Tones } from './logic/tones';

const { ccclass } = _decorator;

const FONT = 'Microsoft YaHei, PingFang SC, Noto Sans SC, WenQuanYi Micro Hei, sans-serif';
const SOUND_KEYS = ['eat', 'star', 'slow', 'mult', 'die', 'start', 'pause', 'record'] as const;
const POPUP_POOL = 6;
// 速度条已移除，节奏固定；禅意/挑战由模式自行修正
const GAME_SPEED = 5;

const COLOR_CACHE = new Map<string, Color>();

function colorOf(hex: string): Color {
    let c = COLOR_CACHE.get(hex);
    if (!c) {
        const s = hex.replace('#', '');
        c = new Color(
            parseInt(s.slice(0, 2), 16),
            parseInt(s.slice(2, 4), 16),
            parseInt(s.slice(4, 6), 16),
            s.length >= 8 ? parseInt(s.slice(6, 8), 16) : 255
        );
        COLOR_CACHE.set(hex, c);
    }
    return c;
}

// 按钮按下时压暗一点（结果缓存成颜色字符串，复用 colorOf 的对象缓存）
const SHADE_CACHE = new Map<string, string>();

function shade(hex: string, k: number): string {
    const key = hex + '|' + k;
    let v = SHADE_CACHE.get(key);
    if (!v) {
        const s = hex.replace('#', '');
        const r = Math.round(parseInt(s.slice(0, 2), 16) * k);
        const g = Math.round(parseInt(s.slice(2, 4), 16) * k);
        const b = Math.round(parseInt(s.slice(4, 6), 16) * k);
        const a = s.length >= 8 ? s.slice(6, 8) : '';
        v = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('') + a;
        SHADE_CACHE.set(key, v);
    }
    return v;
}

function makeNode(name: string): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    return node;
}

// 标题界面「按任意键开始」时忽略的键：修饰键与系统键不该触发开局
const NO_START: Record<number, true> = {};
for (const code of [
    KeyCode.SHIFT_LEFT,
    KeyCode.SHIFT_RIGHT,
    KeyCode.CTRL_LEFT,
    KeyCode.CTRL_RIGHT,
    KeyCode.ALT_LEFT,
    KeyCode.ALT_RIGHT,
    KeyCode.META_LEFT,
    KeyCode.META_RIGHT,
    KeyCode.CAPS_LOCK,
    KeyCode.ESCAPE,
]) {
    if (typeof code === 'number') NO_START[code] = true;
}

interface LabelView {
    id: string;
    node: Node;
    wrap: Node;
    label: Label;
    ui: UITransform;
    last: Record<string, number | string | boolean>;
}

interface ButtonView {
    id: string;
    root: Node;
    ui: UITransform;
    gfx: Graphics;
    wrap: Node;
    label: Label;
    ui2: UITransform;
    spec: ButtonSpec | null;
    pressed: boolean;
    enabled: boolean;
    applied: ButtonSpec | null;
    handler: () => void;
}

@ccclass('GameApp')
export class GameApp extends Component {
    private save: SaveData = defaultSave();
    private phase: UiModel['phase'] = 'menu';
    private settingsOpen = false;
    private settingsTab: SettingsTab = 'display';
    private confirmClear = false;
    private confirmQuit = false;
    private pendingMode: Mode | null = null;
    private world: SnakeWorld | null = null;
    private fx = new FX();
    private tones = new Tones();
    private previewLayer: Node | null = null;
    private previewGraphics: Graphics | null = null;
    private previewNodes: Node[] = [];
    private skinFrames = new Map<string, SpriteFrame[]>();
    private dragonNodes: Node[] = [];
    private dragonLayer: Node | null = null;
    private clips = new Map<string, AudioClip>();
    private audio: AudioSource | null = null;
    private soundAvailable = false;

    private acc = 0;
    private clock = 0;
    private happy = 0;
    private shake = 0;
    private dieLeft = 0;
    private recorded = false;
    private victory = false;
    private newRecord = false;
    private newModeRecord = false;
    private resultScore = 0;
    private resultLen = 0;
    private resultMode: Mode = 'classic';
    private scoreHot = 0;
    private tongue = 0;
    private tongueFlick = 0;
    private tongueWait = 1.2;
    private lastToggle = -1;
    private swipeStart: Vec2 | null = null;

    private built = false;
    private fieldNode: Node | null = null;
    private fieldBg: Graphics | null = null;
    private fieldDyn: Graphics | null = null;
    private fieldCards: Graphics | null = null;
    private fieldBlock: Node | null = null;
    private fieldLabels: Node | null = null;
    private fieldButtons: Node | null = null;
    private screenLabels: Node | null = null;
    private screenButtons: Node | null = null;

    private labelMap = new Map<string, LabelView>();
    private buttonMap = new Map<string, ButtonView>();
    private popupPool: LabelView[] = [];

    private fieldBase = { x: 0, y: 0 };
    private grid = { cell: 32, rows: 14, cols: 20, w: 640, h: 448 };
    private viewW = 1280;
    private viewH = 720;

    private layoutCache: { key: string; lay: Chrome | null } = { key: '', lay: null };
    private appliedLay: Chrome | null = null;
    private bgKey = '';
    private stars: Star[] = [];

    private nativeInfo: NativeDisplay | null = null;
    private nativeAt = -10;
    private displayDirty = true;
    private displayKey = '';
    private displaySize = '';
    private displayLine = '';
    private displayChoices: DisplayChoice[] = [];
    private smokeStep = 0;

    /* ------------------------------ 生命周期 ------------------------------ */

    onLoad(): void {
        this.save = this.loadSave();
        this.save.speed = GAME_SPEED; // 速度条已移除，统一固定节奏
        this.tones.enabled = this.save.sound;
        this.soundAvailable = toneAvailable() || !!this.bridge();
        this.node.layer = Layers.Enum.UI_2D;
        view.setDesignResolutionSize(1280, 720, ResolutionPolicy.SHOW_ALL);
        view.resizeWithBrowserSize(true);

        this.pollNative(true);
        this.applySavedDisplay();
        if (this.nativeInfo && this.nativeInfo.smoke) this.smokeStep = 1;

        this.audio = this.node.addComponent(AudioSource);
        if (sys.isNative) this.loadClips();

        this.ensureNodes();
        const atlasRects: Record<string, number[][]> = {
            dragon: [[100,15,540,590],[830,160,210,70],[830,650,210,580]],
            robot: [[170,90,370,445],[820,230,215,145],[820,650,220,510]],
            candy: [[170,20,380,600],[780,180,235,150],[780,690,240,515]],
        };
        for (const [skin, rects] of Object.entries(atlasRects)) {
            resources.load('skins/' + skin + '/texture', Texture2D, (err, texture) => {
                if (err) { console.error('Skin load failed: ' + skin, err); return; }
                const frames = rects.map(r => {
                    const frame = new SpriteFrame(); frame.texture = texture;
                    frame.rect = new Rect(...r as [number,number,number,number]); return frame;
                });
                this.skinFrames.set(skin, frames);
            });
        }
        input.on(Input.EventType.KEY_DOWN, this.onKey, this);
        view.on('canvas-resize', this.onResize, this);
        game.on(Game.EVENT_HIDE, this.onHide, this);
        this.preventBrowserScroll();
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKey, this);
        view.off('canvas-resize', this.onResize, this);
        game.off(Game.EVENT_HIDE, this.onHide, this);
        this.persist();
    }

    private onResize = (): void => {
        this.pollNative(true);
        this.layoutCache = { key: '', lay: null };
        this.displayDirty = true;
    };

    update(dt: number): void {
        const d = Math.min(0.05, Math.max(0, dt));
        this.clock += d;
        if (this.happy > 0) this.happy = Math.max(0, this.happy - d);
        if (this.shake > 0) this.shake = Math.max(0, this.shake - d);
        if (this.scoreHot > 0) this.scoreHot = Math.max(0, this.scoreHot - d);
        this.advanceTongue(d);

        const frozen = this.settingsOpen;
        const world = this.world;

        if (this.phase === 'playing' && !frozen && world) {
            this.acc += d;
            const interval = intervalMs(GAME_SPEED, world.mode, world.eaten, world.slowLeft) / 1000;
            let guard = 0;
            while (this.acc >= interval && guard < 4 && this.phase === 'playing') {
                this.acc -= interval;
                this.onEvents(world.step());
                guard += 1;
                if (this.phase !== 'playing') break;
            }
            if (this.phase === 'playing') world.tickTime(d);
        } else if (this.phase === 'dying') {
            this.dieLeft -= d;
            this.acc = 0;
            if (this.dieLeft <= 0) this.enterOver();
        } else {
            this.acc = 0;
        }

        this.fx.update(d);
        this.stepSmoke();
        this.render();
    }

    /* ------------------------------ 节点 ------------------------------ */

    private ensureNodes(): void {
        if (this.built) return;
        const root = this.node;

        this.fieldNode = makeNode('field');
        root.addChild(this.fieldNode);
        this.fieldNode.addComponent(UITransform).setAnchorPoint(0, 0);
        // 用遮罩把场地内的所有绘制裁到场地矩形里：蛇身描边有半个线宽的溢出，
        // 边界裁剪后不会再糊到场地外面（禅意穿墙时尤其明显）。
        // 万一某个平台不支持遮罩，也不让整个界面挂掉。
        try {
            const mask = this.fieldNode.addComponent(Mask);
            mask.type = Mask.Type.GRAPHICS_RECT;
        } catch (err) {
            void err;
        }

        const bgNode = makeNode('field-bg');
        this.fieldNode.addChild(bgNode);
        this.fieldBg = bgNode.addComponent(Graphics);

        const dynNode = makeNode('field-dyn');
        this.fieldNode.addChild(dynNode);
        this.fieldDyn = dynNode.addComponent(Graphics);

        this.dragonLayer = makeNode('dragon');
        this.fieldNode.addChild(this.dragonLayer);
        const cardNode = makeNode('field-cards');
        this.fieldNode.addChild(cardNode);
        this.fieldCards = cardNode.addComponent(Graphics);
        this.previewLayer = makeNode('skin-preview');
        this.fieldNode.addChild(this.previewLayer);
        this.previewGraphics = this.previewLayer.addComponent(Graphics);

        this.fieldBlock = makeNode('field-block');
        this.fieldNode.addChild(this.fieldBlock);
        this.fieldBlock.addComponent(UITransform).setAnchorPoint(0, 0);
        this.fieldBlock.addComponent(BlockInputEvents);

        this.fieldLabels = makeNode('field-labels');
        this.fieldNode.addChild(this.fieldLabels);
        this.fieldButtons = makeNode('field-buttons');
        this.fieldNode.addChild(this.fieldButtons);

        this.screenLabels = makeNode('screen-labels');
        root.addChild(this.screenLabels);
        this.screenButtons = makeNode('screen-buttons');
        root.addChild(this.screenButtons);

        this.fieldNode.on(Node.EventType.TOUCH_START, this.onSwipeStart, this);
        this.fieldNode.on(Node.EventType.TOUCH_END, this.onSwipeEnd, this);
        this.fieldNode.on(Node.EventType.TOUCH_CANCEL, this.onSwipeEnd, this);

        this.built = true;
    }

    private viewSize(): { w: number; h: number } {
        const s = view.getVisibleSize();
        if (s.width > 32 && s.height > 32) return { w: s.width, h: s.height };
        const ui = this.getComponent(UITransform);
        return {
            w: ui && ui.contentSize.width > 32 ? ui.contentSize.width : 1280,
            h: ui && ui.contentSize.height > 32 ? ui.contentSize.height : 720,
        };
    }

    /* ------------------------------ 模型 ------------------------------ */

    private displayModel(w: number, h: number): void {
        if (!this.displayDirty) return;
        this.displayDirty = false;
        const info = this.nativeInfo;
        const key = info
            ? [info.width, info.height, info.fullscreen, info.dpi, info.workW, info.workH, info.screenW, info.screenH].join(':')
            : 'none';
        const size = w + 'x' + h;
        if (this.displayKey !== key || this.displaySize !== size) {
            this.displayKey = key;
            this.displaySize = size;
            this.displayLine = displayStatus(info, w, h);
            this.displayChoices = this.displayChoicesOf(info);
        }
    }

    private buildModel(w: number, h: number): UiModel {
        this.displayModel(w, h);
        const world = this.world;
        const live = !!world && (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'dying' || this.phase === 'over');
        const activeMode: Mode = live && world ? world.mode : this.save.mode;
        const buff: string[] = [];
        if (world && (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'dying')) {
            if (world.slowLeft > 0) buff.push('慢动作 ' + world.slowLeft.toFixed(1) + 's');
            if (world.mult > 1) buff.push('双倍 ×' + world.multLeft);
            if (activeMode === 'challenge' && world.eaten >= 4) buff.push('节奏加快');
        }
        if (this.pendingMode && (this.phase === 'playing' || this.phase === 'paused')) {
            buff.push('下局 ' + MODE_NAME[this.pendingMode]);
        }
        if (this.phase === 'paused') buff.push('已暂停');

        const info = this.nativeInfo;
        return {
            phase: this.phase,
            skin: this.save.skin,
            settingsOpen: this.settingsOpen,
            settingsTab: this.settingsTab,
            confirmClear: this.confirmClear,
            confirmQuit: this.confirmQuit,
            selectedMode: this.save.mode,
            pendingMode: this.pendingMode,
            activeMode,
            score: live && world ? world.score : 0,
            best: this.save.best,
            bestByMode: this.save.best_by_mode,
            lengthText: live && world ? String(world.snake.length) : '—',
            buff: buff.join('   '),
            soundOn: this.tones.enabled,
            soundAvailable: this.soundAvailable,
            resultScore: this.resultScore,
            resultLen: this.resultLen,
            resultMode: this.resultMode,
            newRecord: this.newRecord,
            newModeRecord: this.newModeRecord,
            victory: this.victory,
            history: this.save.history,
            mobile: sys.isMobile || w < 700,
            scoreHot: this.scoreHot > 0,
            displayMode: info ? (info.fullscreen ? 'fullscreen' : 'window') : screen.fullScreen() ? 'fullscreen' : 'window',
            displayWidth: (info && info.width) || this.save.display.width,
            displayHeight: (info && info.height) || this.save.display.height,
            displayLine: this.displayLine,
            displayChoices: this.displayChoices,
        };
    }

    private layout(w: number, h: number, model: UiModel): Chrome {
        const key = [
            w,
            h,
            model.phase,
            model.activeMode,
            model.selectedMode,
            model.pendingMode,
            model.skin,
            model.settingsOpen,
            model.settingsTab,
            model.confirmQuit,
            model.confirmClear,
            model.soundOn,
            model.soundAvailable,
            model.mobile,
            model.displayMode,
            model.displayWidth,
            model.displayHeight,
            model.displayChoices.length,
            model.best,
            model.history.length,
            model.displayLine,
        ].join('|');
        if (this.layoutCache.key !== key) {
            this.layoutCache = { key, lay: layoutChrome(w, h, model) };
        }
        return this.layoutCache.lay as Chrome;
    }

    /* ------------------------------ 渲染 ------------------------------ */

    private render(): void {
        const size = this.viewSize();
        if (size.w < 32 || size.h < 32) return;
        this.viewW = size.w;
        this.viewH = size.h;
        this.pollNative(false);

        const model = this.buildModel(size.w, size.h);
        const lay = this.layout(size.w, size.h, model);
        if (this.appliedLay !== lay) {
            this.applyLayout(lay);
            this.appliedLay = lay;
        }
        this.drawScene(lay, model);
        this.patchDynamic(lay, model);
        this.syncLabels(lay.labels, size.w, size.h, lay.field.h);
        this.syncButtons(lay.buttons, size.w, size.h);
    }

    // 布局只在状态变化时重算，但分数 / 长度 / 增益条每帧都可能变化，
    // 这里只改写文字本身，不触发重新排版。
    private patchDynamic(lay: Chrome, model: UiModel): void {
        let byId = (lay as unknown as { byId?: Record<string, LabelSpec> }).byId;
        if (!byId) {
            const map: Record<string, LabelSpec> = {};
            for (const l of lay.labels) map[l.id] = l;
            byId = map;
            (lay as unknown as { byId?: Record<string, LabelSpec> }).byId = byId;
        }
        const set = (id: string, text: string): void => {
            const spec = byId[id];
            if (!spec || spec.text === text) return;
            spec.text = text;
            spec.w = measure(text, spec.size) + 4;
        };
        set('score', '分数 ' + model.score);
        set('length', '长度 ' + model.lengthText);
        set('buff', model.buff);
    }

    private applyLayout(lay: Chrome): void {
        const f = lay.field;
        this.fieldNode!.getComponent(UITransform)!.setContentSize(f.w, f.h);
        this.fieldBase.x = f.x - this.viewW / 2;
        this.fieldBase.y = f.y - this.viewH / 2;
        this.fieldBlock!.getComponent(UITransform)!.setContentSize(f.w, f.h);
        this.fieldBlock!.active = lay.cards.length > 0;
        this.grid = { cell: f.cell, cols: f.cols, rows: f.rows, w: f.w, h: f.h };
        this.reconcileGrid(f.cols, f.rows);
        this.paintOps(this.fieldCards!, lay.cards);
    }

    private reconcileGrid(cols: number, rows: number): void {
        const world = this.world;
        if (!world || this.phase === 'menu') return;
        let fits = true;
        for (const c of world.snake) {
            if (c[0] < 0 || c[0] >= cols || c[1] < 0 || c[1] >= rows) {
                fits = false;
                break;
            }
        }
        if (fits) {
            world.cols = cols;
            world.rows = rows;
            if (world.berry && (world.berry[0] >= cols || world.berry[1] >= rows)) world.berry = null;
            if (world.special && (world.special.x >= cols || world.special.y >= rows)) world.special = null;
        } else {
            this.showMenu();
        }
    }

    private drawScene(lay: Chrome, model: UiModel): void {
        void model;
        const f = lay.field;
        const amp = this.shake > 0 ? (this.shake / 0.42) * 7 : 0;
        this.fieldNode!.setPosition(
            this.fieldBase.x + Math.sin(54 * this.clock) * amp,
            this.fieldBase.y + Math.cos(47 * this.clock) * amp * 0.65,
            0
        );

        const bgKey = f.w + 'x' + f.h + 'x' + f.cols + 'x' + f.rows;
        if (this.bgKey !== bgKey) {
            this.bgKey = bgKey;
            this.paintOps(this.fieldBg!, paintBackground(f.w, f.h, f.cols, f.rows));
            this.stars = makeStars(f.w, f.h, f.cols, f.rows);
        }

        let lead = 0;
        if (this.phase === 'playing' && this.world) {
            const interval = intervalMs(GAME_SPEED, this.world.mode, this.world.eaten, this.world.slowLeft) / 1000;
            lead = interval > 0 ? Math.max(0, Math.min(0.999, this.acc / interval)) : 0;
        }

        const out = paintField({
            world: this.phase === 'menu' ? null : this.world,
            cols: f.cols,
            rows: f.rows,
            cell: f.cell,
            clock: this.clock,
            lead,
            blink: this.blinking(),
            pulse: this.pulse(),
            tongue: this.tongue,
            fx: this.fx,
            hideSnake: this.skinFrames.has(this.save.skin),
            mascot: this.phase === 'menu' || !this.world,
            stars: this.stars,
        });
        this.paintOps(this.fieldDyn!, out.cmds);
        this.drawDragon(lead);
        this.drawSkinPreview(lay);
        this.syncPopups(out.popups);
    }

    private drawDragon(lead: number): void {
        const active = this.skinFrames.has(this.save.skin);
        this.dragonLayer!.active = active;
        if (!active) return;
        const g = this.grid;
        const menu = this.phase === 'menu' || !this.world;
        const geo = menu ? mascotGeometry(g.w, g.h, g.cell, this.clock) : snakePolylines(this.world!, lead, g.cell, g.cols, g.rows);
        this.renderDragon(this.dragonLayer!, this.dragonNodes, geo, {...g, cell: menu ? Math.max(16, Math.min(g.cell, 34)) : g.cell}, !menu && this.world!.mode === 'zen');
    }

    private drawSkinPreview(lay: Chrome): void {
        const marker = lay.labels.find(l => l.id === 'skin-preview-title');
        this.previewLayer!.active = !!marker;
        if (!marker) return;
        const w = marker.w, h = 90, cell = Math.max(12, Math.min(26, w / 6));
        this.previewLayer!.setPosition(marker.x, marker.y - 80);
        this.previewGraphics!.clear();
        for (const node of this.previewNodes) node.active = false;
        if (this.skinFrames.has(this.save.skin)) {
            this.renderDragon(this.previewLayer!, this.previewNodes, mascotGeometry(w, h, cell, this.clock), {w, h, cell}, false);
        } else if (this.save.skin === 'classic') {
            const cmds: DrawCmd[] = [];
            paintMascot(cmds, w, h, cell, this.clock, this.tongue);
            this.paintOps(this.previewGraphics!, cmds);
        }
    }

    private renderDragon(layer: Node, nodes: Node[], geo: SnakeGeometry, g: {w: number; h: number; cell: number}, wrap: boolean): void {
        let used = 0;
        const place = (x: number, y: number, angle: number, frame: number, w: number, h: number): void => {
            const offsets = wrap ? [-1, 0, 1] : [0];
            for (const ox of offsets) for (const oy of offsets) {
                const px = x + ox * g.w, py = y + oy * g.h;
                if (px < -h || py < -h || px > g.w + h || py > g.h + h) continue;
                let node = nodes[used++];
                if (!node) { node = makeNode('dragon-part'); node.addComponent(UITransform); node.addComponent(Sprite); layer.addChild(node); nodes.push(node); }
                node.active = true; node.setPosition(px, py); node.angle = angle;
                const sprite = node.getComponent(Sprite)!; sprite.spriteFrame = this.skinFrames.get(this.save.skin)![frame]; sprite.sizeMode = Sprite.SizeMode.CUSTOM;
                node.getComponent(UITransform)!.setContentSize(w, h);
                node.setSiblingIndex(used - 1);
                // Animate only the head display; the metal body stays unchanged.
                let display = node.getChildByName('robot-display');
                if (frame === 0 && this.save.skin === 'robot') {
                    if (!display) { display = makeNode('robot-display'); display.addComponent(Graphics); node.addChild(display); }
                    display.active = true;
                    const gfx = display.getComponent(Graphics)!; gfx.clear();
                    const alpha = Math.round(20 + 65 * (0.5 + 0.5 * Math.sin(this.clock * Math.PI * 2)));
                    gfx.fillColor = new Color(25, 240, 255, alpha);
                    gfx.ellipse(0, h * 0.14, w * 0.26, h * 0.14); gfx.fill();
                    // A short dark sweep makes the screen visibly blink every three seconds.
                    if (this.clock % 3 < 0.16) {
                        gfx.fillColor = new Color(8, 18, 30, 235);
                        gfx.ellipse(0, h * 0.14, w * 0.26, h * 0.14); gfx.fill();
                    }
                } else if (display) display.active = false;
            }
        };
        for (const run of geo.runs) {
            const pts = run.pts;
            for (let i = pts.length - 1; i > 0; i--) {
                const a = pts[i], b = pts[i - 1];
                const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
                place((a[0]+b[0])/2, (a[1]+b[1])/2, Math.atan2(dy, dx)*180/Math.PI-90, i === pts.length-1 ? 2 : 1, g.cell * .85, i === pts.length-1 ? g.cell : len + 2);
            }
        }
        place(geo.head.x, geo.head.y, Math.atan2(geo.head.face[1], geo.head.face[0])*180/Math.PI-90, 0, g.cell*1.55, g.cell*1.7);
        for (let i = used; i < nodes.length; i++) nodes[i].active = false;
    }

    private paintOps(gfx: Graphics, cmds: DrawCmd[]): void {
        gfx.clear();
        gfx.lineJoin = Graphics.LineJoin.ROUND;
        gfx.lineCap = Graphics.LineCap.ROUND;
        for (const c of cmds) {
            if (c.op === 'poly' || c.op === 'line' || c.op === 'stroke') {
                if (!c.pts || c.pts.length < 4) continue;
                const trace = (): void => {
                    gfx.moveTo(c.pts![0], c.pts![1]);
                    for (let k = 2; k < c.pts!.length; k += 2) gfx.lineTo(c.pts![k], c.pts![k + 1]);
                    if (c.op === 'poly') gfx.close();
                };
                if (c.fill) {
                    gfx.fillColor = colorOf(c.fill);
                    trace();
                    gfx.fill();
                }
                if (c.stroke || c.op === 'line' || c.op === 'stroke') {
                    gfx.strokeColor = colorOf(c.stroke || '#ffffff');
                    gfx.lineWidth = c.sw ?? 1;
                    trace();
                    gfx.stroke();
                }
            } else if (c.op === 'circle') {
                if (c.fill) {
                    gfx.fillColor = colorOf(c.fill);
                    gfx.circle(c.x!, c.y!, c.r!);
                    gfx.fill();
                }
                if (c.stroke) {
                    gfx.strokeColor = colorOf(c.stroke);
                    gfx.lineWidth = c.sw ?? 1;
                    gfx.circle(c.x!, c.y!, c.r!);
                    gfx.stroke();
                }
            } else if (c.op === 'ellipse') {
                if (c.fill) {
                    gfx.fillColor = colorOf(c.fill);
                    gfx.ellipse(c.x!, c.y!, c.rx!, c.ry!);
                    gfx.fill();
                }
                if (c.stroke) {
                    gfx.strokeColor = colorOf(c.stroke);
                    gfx.lineWidth = c.sw ?? 1;
                    gfx.ellipse(c.x!, c.y!, c.rx!, c.ry!);
                    gfx.stroke();
                }
            }
        }
    }

    /* ------------------------------ Label / Button ------------------------------ */

    private pixelScale(): number {
        const s = view.getScaleY();
        return !Number.isFinite(s) || s <= 1.05 ? 1 : Math.min(2, s);
    }

    private glyphScale(size: number): number {
        const t = Math.max(8, size);
        return Math.max(8, Math.min(64, Math.round(t * this.pixelScale()))) / t;
    }

    private ensureLabel(id: string): LabelView {
        let entry = this.labelMap.get(id);
        if (entry) return entry;
        const node = makeNode(id);
        node.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const label = node.addComponent(Label);
        label.useSystemFont = true;
        label.fontFamily = FONT;
        label.cacheMode = Label.CacheMode.NONE;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.NONE;
        label.enableWrapText = false;
        const wrap = makeNode(id + '-wrap');
        wrap.addChild(node);
        node.setPosition(0, 0, 0);
        entry = { id, node, wrap, label, ui: node.getComponent(UITransform)!, last: {} };
        this.labelMap.set(id, entry);
        return entry;
    }

    private syncLabels(specs: LabelSpec[], w: number, h: number, fieldH: number): void {
        const seen = new Set<string>();
        for (const spec of specs) {
            seen.add(spec.id);
            const e = this.ensureLabel(spec.id);
            const host = spec.parent === 'field' ? this.fieldLabels! : this.screenLabels!;
            if (e.wrap.parent !== host) host.addChild(e.wrap);
            if (!e.wrap.active) e.wrap.active = true;

            const c = this.glyphScale(spec.size);
            const size = Math.max(8, Math.round(spec.size * c));
            const bw = Math.max(8, spec.w);
            let px = spec.parent === 'field' ? spec.x : spec.x - w / 2;
            let py = spec.parent === 'field' ? spec.y : spec.y - h / 2;
            if (spec.bob) py += Math.sin(1.6 * this.clock) * Math.max(3, 0.008 * fieldH);
            if (spec.align === 'left') px += bw / 2;
            else if (spec.align === 'right') px -= bw / 2;

            const last = e.last;
            if (last.text !== spec.text) {
                e.label.string = spec.text;
                last.text = spec.text;
            }
            if (last.color !== spec.color) {
                e.label.color = colorOf(spec.color);
                last.color = spec.color;
            }
            if (last.bold !== spec.bold) {
                e.label.isBold = spec.bold;
                last.bold = spec.bold;
            }
            if (last.align !== spec.align) {
                e.label.horizontalAlign =
                    spec.align === 'left' ? Label.HorizontalAlign.LEFT : spec.align === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER;
                last.align = spec.align;
            }
            if (last.size !== size) {
                e.label.fontSize = size;
                e.label.lineHeight = size + Math.round(4 * c);
                last.size = size;
                last.bw = -1;
            }
            if (last.bw !== bw) {
                e.ui.setContentSize(bw * c, (spec.size + 8) * c);
                e.wrap.setScale(1 / c, 1 / c, 1);
                last.bw = bw;
            }
            if (last.x !== px || last.y !== py) {
                e.wrap.setPosition(px, py, 0);
                last.x = px;
                last.y = py;
            }
        }
        for (const [id, e] of this.labelMap) {
            // 飘字（pop-*）由 syncPopups 单独管理，不能被这里的清理逻辑关掉
            if (!seen.has(id) && id.indexOf('pop-') !== 0 && e.wrap.active) {
                e.wrap.active = false;
            }
        }
    }

    private ensureButton(spec: ButtonSpec): ButtonView {
        const existing = this.buttonMap.get(spec.id);
        if (existing) return existing;
        const root = makeNode(spec.id);
        const ui = root.addComponent(UITransform);
        ui.setAnchorPoint(0.5, 0.5);
        const gfx = root.addComponent(Graphics);
        const wrap = makeNode('text-wrap');
        root.addChild(wrap);
        const node = makeNode('text');
        wrap.addChild(node);
        const label = node.addComponent(Label);
        label.useSystemFont = true;
        label.fontFamily = FONT;
        label.cacheMode = Label.CacheMode.NONE;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.NONE;
        label.enableWrapText = false;
        const ui2 = node.addComponent(UITransform);
        ui2.setAnchorPoint(0.5, 0.5);

        const entry: ButtonView = {
            id: spec.id,
            root,
            ui,
            gfx,
            wrap,
            label,
            ui2,
            spec,
            pressed: false,
            enabled: true,
            applied: null,
            handler: () => undefined,
        };
        const repaint = (): void => {
            if (!entry.spec) return;
            entry.pressed = entry.pressed && entry.enabled;
            this.paintButton(entry);
            root.setScale(entry.pressed ? 0.97 : 1, entry.pressed ? 0.97 : 1, 1);
        };
        root.on(
            Node.EventType.TOUCH_START,
            (ev: EventTouch) => {
                ev.propagationStopped = true;
                entry.pressed = true;
                repaint();
            },
            this
        );
        root.on(
            Node.EventType.TOUCH_END,
            (ev: EventTouch) => {
                ev.propagationStopped = true;
                const wasPressed = entry.pressed;
                entry.pressed = false;
                repaint();
                if (wasPressed && entry.enabled) entry.handler();
            },
            this
        );
        root.on(
            Node.EventType.TOUCH_CANCEL,
            (ev: EventTouch) => {
                ev.propagationStopped = true;
                entry.pressed = false;
                repaint();
            },
            this
        );
        this.buttonMap.set(spec.id, entry);
        return entry;
    }

    // 按钮底板：按下列变暗并轻微内缩，给点击一点反馈
    private paintButton(e: ButtonView): void {
        const spec = e.spec;
        if (!spec) return;
        const fill = !spec.enabled
            ? '#241845'
            : spec.danger
              ? spec.selected
                  ? '#c2304f'
                  : '#7b2140'
              : spec.selected || spec.primary
                ? '#ff7eb6'
                : '#2a1b55';
        e.gfx.clear();
        e.gfx.fillColor = colorOf(e.pressed ? shade(fill, 0.78) : fill);
        e.gfx.roundRect(-spec.w / 2, -spec.h / 2, spec.w, spec.h, 6);
        e.gfx.fill();
        if (spec.selected && spec.enabled && !e.pressed) {
            e.gfx.strokeColor = colorOf('#ffe9f3');
            e.gfx.lineWidth = 2;
            e.gfx.roundRect(-spec.w / 2 + 1, -spec.h / 2 + 1, spec.w - 2, spec.h - 2, 6);
            e.gfx.stroke();
        }
    }

    private syncButtons(specs: ButtonSpec[], w: number, h: number): void {
        const seen = new Set<string>();
        for (const spec of specs) {
            seen.add(spec.id);
            const e = this.ensureButton(spec);
            const host = spec.parent === 'field' ? this.fieldButtons! : this.screenButtons!;
            if (e.root.parent !== host) host.addChild(e.root);
            if (!e.root.active) e.root.active = true;
            e.enabled = spec.enabled;
            // 布局对象在状态不变时会被复用，因此可以直接用对象身份判断是否需要重绘
            if (e.applied === spec) continue;
            e.applied = spec;
            e.spec = spec;
            e.pressed = false;

            const x = spec.parent === 'field' ? spec.x : spec.x - w / 2;
            const y = spec.parent === 'field' ? spec.y : spec.y - h / 2;
            e.ui.setContentSize(spec.w, spec.h);
            e.root.setPosition(x, y, 0);
            e.root.setScale(1, 1, 1);
            this.paintButton(e);
            const c = this.glyphScale(16);
            e.label.string = spec.text;
            e.label.fontSize = Math.max(10, Math.round(14 * c));
            e.label.lineHeight = e.label.fontSize + Math.round(4 * c);
            e.label.color = colorOf(spec.enabled && (spec.selected || spec.primary) ? '#ffffff' : spec.enabled ? '#cbbbe8' : '#8d7eae');
            e.wrap.setScale(1 / c, 1 / c, 1);
            e.ui2.setContentSize(Math.max(8, spec.w - 8) * c, spec.h * c);
            e.handler = () => this.onButton(spec.id);
        }
        for (const [id, e] of this.buttonMap) {
            if (!seen.has(id) && e.root.active) e.root.active = false;
        }
    }

    private syncPopups(popups: Array<{ x: number; y: number; text: string; color: string; size: number }>): void {
        for (let i = 0; i < POPUP_POOL; i++) {
            if (!this.popupPool[i]) {
                this.popupPool[i] = this.ensureLabel('pop-' + i);
            }
            const e = this.popupPool[i];
            const p = popups[i];
            if (!p) {
                if (e.wrap.active) e.wrap.active = false;
                continue;
            }
            if (e.wrap.parent !== this.fieldLabels) this.fieldLabels!.addChild(e.wrap);
            if (!e.wrap.active) e.wrap.active = true;
            const c = this.glyphScale(p.size);
            const size = Math.max(8, Math.round(p.size * c));
            const last = e.last;
            if (last.text !== p.text) {
                e.label.string = p.text;
                last.text = p.text;
            }
            if (last.color !== p.color) {
                e.label.color = colorOf(p.color);
                last.color = p.color;
            }
            if (e.label.isBold !== true) {
                e.label.isBold = true;
                e.label.horizontalAlign = Label.HorizontalAlign.CENTER;
            }
            if (last.size !== size) {
                e.label.fontSize = size;
                e.label.lineHeight = size + Math.round(4 * c);
                e.ui.setContentSize(Math.max(8, p.size * (p.text.length + 1)) * c, (p.size + 8) * c);
                e.wrap.setScale(1 / c, 1 / c, 1);
                last.size = size;
            }
            if (last.x !== p.x || last.y !== p.y) {
                e.wrap.setPosition(p.x, p.y, 0);
                last.x = p.x;
                last.y = p.y;
            }
        }
    }

    /* ------------------------------ 交互 ------------------------------ */

    private onButton(id: string): void {
        this.tones.resume();
        if (id.indexOf('mode-') === 0) {
            this.selectMode(id.slice(5) as Mode);
            return;
        }
        if (id.indexOf('pad-') === 0) {
            const map: Record<string, [number, number]> = {
                'pad-up': [0, -1],
                'pad-down': [0, 1],
                'pad-left': [-1, 0],
                'pad-right': [1, 0],
            };
            const dir = map[id];
            if (dir && this.phase === 'playing' && !this.settingsOpen && this.world) this.world.turn(dir[0], dir[1]);
            return;
        }
        if (id === 'start' || id === 'start-big') {
            this.settingsOpen = false;
            this.startGame();
            return;
        }
        if (id === 'pause') {
            this.togglePause();
            return;
        }
        if (id === 'skins') { this.toggleSettings('skins'); return; }
        if (['skin-classic', 'skin-dragon', 'skin-robot', 'skin-candy'].includes(id)) {
            this.save.skin = id.slice(5) as SaveData['skin']; this.persist(); return;
        }
        if (id === 'settings') {
            this.toggleSettings(this.settingsTab);
            return;
        }
        if (id === 'close-settings') {
            this.closeSettings();
            return;
        }
        if (id.indexOf('tab-') === 0) {
            this.settingsTab = id.slice(4) as SettingsTab;
            this.confirmClear = false;
            this.confirmQuit = false;
            return;
        }
        if (id === 'sound') {
            this.toggleSound();
            return;
        }
        if (id === 'display-window' || id === 'display-full' || id.indexOf('res-') === 0) {
            this.chooseDisplay(id);
            return;
        }
        if (id === 'clear-history') {
            if (this.confirmClear) {
                this.save.history = [];
                this.save.best = 0;
                this.save.best_by_mode = { classic: 0, zen: 0, challenge: 0 };
                this.confirmClear = false;
                this.persist();
            } else {
                this.confirmClear = true;
            }
            return;
        }
        if (id === 'quit') {
            if (this.confirmQuit) this.quit();
            else this.confirmQuit = true;
        }
    }

    private onKey = (e: EventKeyboard): void => {
        this.tones.resume();
        const k = e.keyCode;

        if (this.settingsOpen) {
            if (k === KeyCode.ESCAPE) this.closeSettings();
            return;
        }
        // 标题界面：除 Esc / 修饰键外任意键直接开始
        if (this.phase === 'menu') {
            if (NO_START[k] || (k >= KeyCode.F1 && k <= KeyCode.F12) || k === 91 || k === 92 || k === 93) return;
            this.startGame();
            return;
        }
        if (k === KeyCode.KEY_H || k === KeyCode.F1) {
            this.toggleSettings('help');
            return;
        }
        if (k === KeyCode.KEY_N) {
            this.toggleSound();
            return;
        }
        if (k === KeyCode.ESCAPE) {
            this.onEscape();
            return;
        }
        if (k === KeyCode.ENTER || k === KeyCode.NUM_ENTER) {
            if (this.phase === 'paused') this.phase = 'playing';
            else this.startGame();
            return;
        }
        if (k === KeyCode.SPACE || k === KeyCode.KEY_P) {
            if (this.clock - this.lastToggle < 0.18) return;
            this.lastToggle = this.clock;
            if (this.phase === 'playing') {
                this.phase = 'paused';
                this.play('pause');
            } else if (this.phase === 'paused') this.phase = 'playing';
            else this.startGame();
            return;
        }
        if (k === KeyCode.KEY_R) {
            this.startGame();
            return;
        }
        const dir = this.dirOf(k);
        if (dir && this.phase === 'playing' && this.world && this.world.alive) this.world.turn(dir[0], dir[1]);
    };

    private onSwipeStart = (e: EventTouch): void => {
        this.swipeStart = e.getUILocation();
    };

    private onSwipeEnd = (e: EventTouch): void => {
        const from = this.swipeStart;
        this.swipeStart = null;
        if (!from || this.phase !== 'playing' || this.settingsOpen || !this.world) return;
        const to = e.getUILocation();
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        if (Math.hypot(dx, dy) < 28) return;
        if (Math.abs(dx) > Math.abs(dy)) this.world.turn(dx > 0 ? 1 : -1, 0);
        else this.world.turn(0, dy > 0 ? -1 : 1);
    };

    private onHide = (): void => {
        if (this.phase === 'playing') this.phase = 'paused';
        this.persist();
    };

    private dirOf(k: number): [number, number] | null {
        if (k === KeyCode.ARROW_UP || k === KeyCode.KEY_W) return [0, -1];
        if (k === KeyCode.ARROW_DOWN || k === KeyCode.KEY_S) return [0, 1];
        if (k === KeyCode.ARROW_LEFT || k === KeyCode.KEY_A) return [-1, 0];
        if (k === KeyCode.ARROW_RIGHT || k === KeyCode.KEY_D) return [1, 0];
        return null;
    }

    private selectMode(mode: Mode): void {
        if (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'dying') {
            this.pendingMode = this.world && mode === this.world.mode ? null : mode;
        } else {
            this.save.mode = mode;
            this.pendingMode = null;
            this.persist();
        }
    }

    private startGame(): void {
        if (this.pendingMode) {
            this.save.mode = this.pendingMode;
            this.pendingMode = null;
        }
        const size = this.viewSize();
        const lay = this.layout(size.w, size.h, this.buildModel(size.w, size.h));
        this.world = new SnakeWorld(lay.field.cols, lay.field.rows, this.save.mode);
        this.phase = 'playing';
        this.settingsOpen = false;
        this.confirmQuit = false;
        this.confirmClear = false;
        this.acc = 0;
        this.recorded = false;
        this.victory = false;
        this.newRecord = false;
        this.newModeRecord = false;
        this.happy = 0;
        this.shake = 0;
        this.fx = new FX();
        this.persist();
        this.play('start');
    }

    private togglePause(): void {
        if (this.phase === 'playing') {
            this.phase = 'paused';
            this.play('pause');
        } else if (this.phase === 'paused') {
            this.phase = 'playing';
        }
    }

    private toggleSettings(tab?: SettingsTab): void {
        if (this.settingsOpen && (!tab || this.settingsTab === tab)) {
            this.settingsOpen = false;
        } else {
            this.settingsOpen = true;
            if (tab) this.settingsTab = tab;
        }
        this.confirmClear = false;
        this.confirmQuit = false;
    }

    private closeSettings(): void {
        this.settingsOpen = false;
        this.confirmClear = false;
        this.confirmQuit = false;
    }

    private toggleSound(): void {
        if (!this.soundAvailable) return;
        this.tones.enabled = !this.tones.enabled;
        this.save.sound = this.tones.enabled;
        this.persist();
        if (this.tones.enabled) this.play('pause');
    }

    private showMenu(): void {
        this.phase = 'menu';
        this.settingsOpen = false;
        this.confirmClear = false;
        this.confirmQuit = false;
        this.pendingMode = null;
        this.world = null;
        this.acc = 0;
    }

    // 注意：这里刻意不再调用 toggleFullscreen()。全屏只在设置里切换，启动即全屏。
    private onEscape(): void {
        if (this.settingsOpen) {
            this.closeSettings();
            return;
        }
        if (this.phase === 'playing') {
            this.phase = 'paused';
            this.play('pause');
            return;
        }
        if (this.phase === 'paused' || this.phase === 'over' || this.phase === 'dying') {
            this.showMenu();
        }
    }

    private quit(): void {
        this.persist();
        if (sys.isNative) {
            game.end();
            return;
        }
        const close = (globalThis as { close?: () => void }).close;
        if (close) close();
        this.showMenu();
    }

    /* ------------------------------ 显示 ------------------------------ */

    private bridge(): { snakeDisplay?: (op: string, w: number, h: number, full: number) => string } | null {
        const g = globalThis as { jsb?: { snakeDisplay?: (op: string, w: number, h: number, full: number) => string } };
        return g.jsb && g.jsb.snakeDisplay ? g.jsb : null;
    }

    private readNative(): NativeDisplay | null {
        const b = this.bridge();
        if (!b || !b.snakeDisplay) return null;
        try {
            const raw = b.snakeDisplay('state', 0, 0, 0);
            return raw ? parseNativeDisplay(raw) : null;
        } catch (err) {
            void err;
            return null;
        }
    }

    // 旧版每帧都会跨桥读一次窗口状态，原生侧还会写日志，是卡顿主因之一。
    private pollNative(force: boolean): void {
        if (!force && this.clock - this.nativeAt < 0.75) return;
        this.nativeAt = this.clock;
        const info = this.readNative();
        if (!info) return;
        const old = this.nativeInfo;
        const changed =
            !old ||
            old.width !== info.width ||
            old.height !== info.height ||
            old.fullscreen !== info.fullscreen ||
            old.dpi !== info.dpi ||
            old.workW !== info.workW ||
            old.workH !== info.workH;
        this.nativeInfo = info;
        if (changed) this.displayDirty = true;
    }

    private preferredChoice(): DisplayChoice {
        const choices = this.displayChoices.length ? this.displayChoices : this.displayChoicesOf(this.nativeInfo);
        const saved = this.save.display;
        if (saved.width < 640 || saved.height < 360) {
            const auto = choices.find((c) => c.id === 'auto') ?? choices[0];
            if (auto) return auto;
        }
        const found = pickSavedWindow(
            saved.width || (this.nativeInfo ? this.nativeInfo.width : 1280),
            saved.height || (this.nativeInfo ? this.nativeInfo.height : 720),
            choices
        );
        return (
            found ?? {
                id: 'fallback',
                width: (this.nativeInfo && this.nativeInfo.width) || 1280,
                height: (this.nativeInfo && this.nativeInfo.height) || 720,
                label: '',
            }
        );
    }

    private displayChoicesOf(info: NativeDisplay | null): DisplayChoice[] {
        if (!info || info.workW < 640 || info.workH < 360) return [];
        return windowChoices({ workW: info.workW, workH: info.workH, screenW: info.screenW, screenH: info.screenH });
    }

    private commitDisplay(w: number, h: number, fullscreen: boolean): void {
        const b = this.bridge();
        if (!b || !b.snakeDisplay) {
            if (fullscreen || this.isFullscreen()) this.toggleBrowserFullscreen();
            return;
        }
        b.snakeDisplay('set', Math.trunc(w), Math.trunc(h), fullscreen ? 1 : 0);
        this.pollNative(true);
        this.save.display.mode = fullscreen ? 'fullscreen' : 'window';
        if (w >= 640 && h >= 360) {
            this.save.display.width = Math.trunc(w);
            this.save.display.height = Math.trunc(h);
        }
        this.persist();
        this.displayDirty = true;
    }

    private chooseDisplay(id: string): void {
        if (id === 'display-full') {
            const c = this.preferredChoice();
            this.commitDisplay(c.width, c.height, true);
            return;
        }
        if (id === 'display-window') {
            const c = this.preferredChoice();
            this.commitDisplay(c.width, c.height, false);
            return;
        }
        for (const c of this.displayChoicesOf(this.nativeInfo)) {
            if (id === 'res-' + c.id) {
                this.commitDisplay(c.width, c.height, false);
                return;
            }
        }
    }

    private isFullscreen(): boolean {
        const info = this.readNative();
        if (info) {
            this.nativeInfo = info;
            return info.fullscreen;
        }
        if (screen.fullScreen()) return true;
        const doc = (globalThis as { document?: { fullscreenElement?: unknown } }).document;
        return Boolean(doc && doc.fullscreenElement);
    }

    private toggleBrowserFullscreen(): void {
        const p = !this.isFullscreen() ? screen.requestFullScreen() : screen.exitFullScreen();
        Promise.resolve(p)
            .then(() => this.focusGame())
            .catch(() => this.focusGame());
    }

    private focusGame(): void {
        const doc = (globalThis as { document?: { getElementById?: (id: string) => { focus?: () => void } | null } }).document;
        if (!doc || !doc.getElementById) return;
        const el = doc.getElementById('GameCanvas');
        if (el && el.focus) el.focus();
    }

    private applySavedDisplay(): void {
        const info = this.nativeInfo;
        if (!info) return;
        // 启动默认全屏；已经全屏时不再重复提交，避免多余的窗口重建
        if (!info.fullscreen) {
            const w = info.screenW > 0 ? info.screenW : info.workW > 0 ? info.workW : 1920;
            const h = info.screenH > 0 ? info.screenH : info.workH > 0 ? info.workH : 1080;
            this.commitDisplay(w, h, true);
        }
        this.save.display.mode = 'fullscreen';
        this.persist();
    }

    /* ------------------------------ 存档 / 音效 ------------------------------ */

    private loadSave(): SaveData {
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEY);
            return raw ? sanitizeSave(JSON.parse(raw)) : defaultSave();
        } catch (err) {
            void err;
            return defaultSave();
        }
    }

    private persist(): void {
        try {
            sys.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.save));
        } catch (err) {
            void err; // 忽略写入失败
        }
    }

    private play(name: string): void {
        if (!this.tones.enabled) return;
        const bridge = this.bridge();
        if (sys.isNative && bridge?.snakeDisplay && SOUND_KEYS.includes(name as typeof SOUND_KEYS[number])) {
            if (bridge.snakeDisplay('audio:' + name, 0, 0, 0) === 'ok') return;
        }
        if (sys.isBrowser) {
            this.tones.play(name);
            return;
        }
        const clip = this.clips.get(name);
        if (clip && this.audio) this.audio.playOneShot(clip, 1);
    }

    private loadClips(): void {
        let pending = SOUND_KEYS.length;
        let loaded = 0;
        for (const key of SOUND_KEYS) {
            resources.load('audio/' + key, AudioClip, (err: any, clip: any) => {
                pending -= 1;
                if (err) console.error('Audio load failed: ' + key, err);
                if (!err && clip) {
                    this.clips.set(key, clip);
                    loaded += 1;
                }
                if (pending === 0 && loaded > 0) this.soundAvailable = true;
            });
        }
    }

    private preventBrowserScroll(): void {
        const g = globalThis as {
            addEventListener?: (type: string, fn: (e: { code?: string; preventDefault?: () => void }) => void) => void;
        };
        if (!g.addEventListener) return;
        g.addEventListener('keydown', (e) => {
            if (
                e.code === 'Space' ||
                e.code === 'ArrowUp' ||
                e.code === 'ArrowDown' ||
                e.code === 'ArrowLeft' ||
                e.code === 'ArrowRight'
            ) {
                if (e.preventDefault) e.preventDefault();
            }
        });
    }

    /* ------------------------------ 游戏事件 ------------------------------ */

    private onEvents(events: WorldEvent[]): void {
        for (const ev of events) {
            if (ev.type === 'eat' && ev.kind && ev.x !== undefined && this.world) {
                this.fxEat(ev.kind, ev.x, ev.y as number, ev.amount ?? 0);
                this.scoreHot = 0.16;
                this.happy = 0.28;
                this.tongueFlick = 0.001;
                const sound: Record<string, string> = { berry: 'eat', star: 'star', slow: 'slow', mult: 'mult' };
                this.play(sound[ev.kind]);
            } else if (ev.type === 'die') {
                this.rememberScore();
                this.phase = 'dying';
                this.dieLeft = 0.58;
                this.shake = 0.42;
                this.fxDeath();
                this.play('die');
            } else if (ev.type === 'win') {
                this.victory = true;
                this.rememberScore();
                this.enterOver();
            }
        }
    }

    private rememberScore(): void {
        if (this.recorded || !this.world) return;
        this.recorded = true;
        const score = this.world.score;
        const mode = this.world.mode;
        this.resultScore = score;
        this.resultLen = this.world.snake.length;
        this.resultMode = mode;
        const modeBest = this.save.best_by_mode[mode] || 0;
        this.newRecord = score > 0 && score > this.save.best;
        this.newModeRecord = score > 0 && score > modeBest;
        if (score <= 0) return;
        if (score > this.save.best) this.save.best = score;
        if (score > modeBest) this.save.best_by_mode[mode] = score;
        const row = { score, time: stampNow(), mode, length: this.resultLen };
        this.save.history = [row, ...this.save.history].slice(0, HISTORY_MAX);
        this.persist();
    }

    private enterOver(): void {
        this.phase = 'over';
        if (this.newRecord || this.victory) {
            this.play('record');
            this.fxRecord();
        }
    }

    private fxEat(kind: FoodKind, x: number, y: number, amount: number): void {
        if (!this.world) return;
        const p = cellCenter(x, y, this.grid.cell, this.grid.rows);
        const color = { berry: BERRY, star: GOLD, slow: CYAN, mult: VIOLET }[kind];
        this.fx.burst(p[0], p[1], color, kind === 'berry' ? 10 : 14, 180);
        this.fx.burst(p[0], p[1], '#fff6fb', 5, 90, 0.28);
        this.fx.ring(p[0], p[1], color);
        const text = kind === 'slow' ? '慢动作' : kind === 'mult' ? '双倍' : '+' + amount;
        const tint = kind === 'berry' ? TEXT : kind === 'star' ? GOLD : kind === 'slow' ? CYAN : VIOLET;
        this.fx.popup(p[0], p[1], text, tint);
    }

    private fxDeath(): void {
        if (!this.world) return;
        const step = this.world.snake.length < 14 ? 1 : 2;
        for (let i = 0; i < this.world.snake.length; i += step) {
            const p = cellCenter(this.world.snake[i][0], this.world.snake[i][1], this.grid.cell, this.grid.rows);
            this.fx.burst(p[0], p[1], BODY_A, 4, 120, 0.5);
        }
        const head = this.world.snake[0];
        const face = this.world.deathFace;
        const p = cellCenter(head[0] + face[0], head[1] + face[1], this.grid.cell, this.grid.rows);
        this.fx.burst(p[0], p[1], BERRY, 16, 220, 0.55);
        this.fx.ring(p[0], p[1], '#ffffff');
    }

    private fxRecord(): void {
        for (let i = 0; i < 24; i++) {
            this.fx.particles.push({
                x: 24 + Math.random() * Math.max(1, this.grid.w - 48),
                y: this.grid.h + 8 + 30 * Math.random(),
                vx: 40 * Math.random() - 20,
                vy: -(70 + 90 * Math.random()),
                life: 0.9,
                age: 0,
                r: 1.8 + 1.4 * Math.random(),
                vr: 0,
                color: GOLD,
                kind: 'dot',
            });
        }
    }

    private blinking(): boolean {
        if (!this.world || !this.world.alive) return true;
        return this.clock % 4.2 < 0.12;
    }

    private pulse(): number {
        return this.happy <= 0 ? 1 : 1 + (this.happy / 0.28) * 0.08;
    }

    private advanceTongue(dt: number): void {
        if (this.world && !this.world.alive) {
            this.tongue = 0;
            return;
        }
        if (this.tongueFlick > 0) {
            this.tongueFlick += dt;
            const t = this.tongueFlick;
            if (t < 0.08) this.tongue = t / 0.08;
            else if (t < 0.2) this.tongue = 1;
            else if (t < 0.3) this.tongue = 1 - (t - 0.2) / 0.1;
            else {
                this.tongue = 0;
                this.tongueFlick = 0;
                this.tongueWait = 1.4 + 2.2 * Math.random();
            }
        } else {
            this.tongueWait -= dt;
            if (this.tongueWait <= 0) this.tongueFlick = 0.001;
        }
    }

    private stepSmoke(): void {
        if (this.smokeStep === 1 && this.clock > 1) {
            this.smokeStep = 2;
            this.settingsOpen = true;
            this.settingsTab = 'display';
            const choices = this.displayChoicesOf(this.nativeInfo);
            const pick = choices.find((c) => c.width === 1280 && c.height === 720) ?? this.preferredChoice();
            this.commitDisplay(pick.width, pick.height, false);
            const b = this.bridge();
            if (b && b.snakeDisplay) b.snakeDisplay('mark', pick.width, pick.height, 0);
        } else if (this.smokeStep === 2 && this.clock > 2.2) {
            this.smokeStep = 3;
            const c = this.preferredChoice();
            this.commitDisplay(c.width, c.height, true);
            const b = this.bridge();
            if (b && b.snakeDisplay) b.snakeDisplay('mark', c.width, c.height, 1);
        }
    }
}