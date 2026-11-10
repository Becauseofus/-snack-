import {
    _decorator,
    AudioClip,
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
    Node,
    ResolutionPolicy,
    resources,
    sys,
    UIOpacity,
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
    intervalMs,
    MODE_NAME,
    sanitizeSave,
    stampNow,
    STORAGE_KEY,
    TEXT,
    VIOLET,
    type FoodKind,
    type HistoryItem,
    type Mode,
    type SaveData,
} from './logic/config';
import { FX } from './logic/fx';
import { layoutChrome, type ButtonSpec, type Chrome, type LabelSpec, type UiModel } from './logic/layout';
import { cellCenter, paintField, type DrawCmd } from './logic/paint';
import { SnakeWorld, type WorldEvent } from './logic/SnakeWorld';
import { toneAvailable, Tones } from './logic/tones';

const { ccclass } = _decorator;

type Phase = UiModel['phase'];

interface ButtonView {
    root: Node;
    gfx: Graphics;
    label: Label;
    ui: UITransform;
    handler: () => void;
}

const TONE_NAMES = ['eat', 'star', 'slow', 'mult', 'die', 'start', 'pause', 'record'];

function uiNode(name: string): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    return node;
}

function hexColor(hex: string): Color {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
    return new Color(r, g, b, a);
}

function replay(g: Graphics, cmds: DrawCmd[]): void {
    g.clear();
    g.lineJoin = Graphics.LineJoin.ROUND;
    g.lineCap = Graphics.LineCap.ROUND;
    for (const c of cmds) {
        if ((c.op === 'poly' || c.op === 'line') && c.pts && c.pts.length >= 4) {
            const draw = () => {
                g.moveTo(c.pts![0], c.pts![1]);
                for (let i = 2; i < c.pts!.length; i += 2) {
                    g.lineTo(c.pts![i], c.pts![i + 1]);
                }
                if (c.op === 'poly') {
                    g.close();
                }
            };
            if (c.fill) {
                g.fillColor = hexColor(c.fill);
                draw();
                g.fill();
            }
            if (c.stroke || c.op === 'line') {
                g.strokeColor = hexColor(c.stroke || '#ffffff');
                g.lineWidth = c.sw ?? 1;
                draw();
                g.stroke();
            }
        } else if (c.op === 'circle' && c.x !== undefined && c.y !== undefined && c.r !== undefined) {
            if (c.fill) {
                g.fillColor = hexColor(c.fill);
                g.circle(c.x, c.y, c.r);
                g.fill();
            }
            if (c.stroke) {
                g.strokeColor = hexColor(c.stroke);
                g.lineWidth = c.sw ?? 1;
                g.circle(c.x, c.y, c.r);
                g.stroke();
            }
        } else if (c.op === 'ellipse' && c.x !== undefined && c.y !== undefined && c.rx !== undefined && c.ry !== undefined) {
            if (c.fill) {
                g.fillColor = hexColor(c.fill);
                g.ellipse(c.x, c.y, c.rx, c.ry);
                g.fill();
            }
            if (c.stroke) {
                g.strokeColor = hexColor(c.stroke);
                g.lineWidth = c.sw ?? 1;
                g.ellipse(c.x, c.y, c.rx, c.ry);
                g.stroke();
            }
        }
    }
}

@ccclass('GameApp')
export class GameApp extends Component {
    private save: SaveData = defaultSave();
    private phase: Phase = 'menu';
    private help = false;
    private historyOpen = false;
    private confirmClear = false;
    private pending: Mode | null = null;
    private world: SnakeWorld | null = null;
    private fx = new FX();
    private tones = new Tones();
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
    private fieldNode: Node | null = null;
    private fieldGfx: Graphics | null = null;
    private fieldBlock: Node | null = null;
    private sliderNode: Node | null = null;
    private sliderGfx: Graphics | null = null;
    private labels = new Map<string, Label>();
    private buttons = new Map<string, ButtonView>();
    private fieldBase = { x: 0, y: 0 };
    private grid = { cell: 32, rows: 14, cols: 20, w: 640, h: 448 };
    private built = false;

    onLoad(): void {
        this.save = this.loadSave();
        this.tones.enabled = this.save.sound;
        this.soundAvailable = toneAvailable();
        this.node.layer = Layers.Enum.UI_2D;
        view.setDesignResolutionSize(1280, 720, ResolutionPolicy.SHOW_ALL);
        view.resizeWithBrowserSize(true);
        this.audio = this.node.addComponent(AudioSource);
        if (sys.isNative) {
            this.loadClips();
        }
        this.ensureNodes();
        input.on(Input.EventType.KEY_DOWN, this.onKey, this);
        view.on('canvas-resize', this.refresh, this);
        game.on(Game.EVENT_HIDE, this.onHide, this);
        this.preventBrowserScroll();
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKey, this);
        view.off('canvas-resize', this.refresh, this);
        game.off(Game.EVENT_HIDE, this.onHide, this);
        this.persist();
    }

    update(dt: number): void {
        const step = Math.min(0.05, Math.max(0, dt));
        this.clock += step;
        if (this.happy > 0) {
            this.happy = Math.max(0, this.happy - step);
        }
        if (this.shake > 0) {
            this.shake = Math.max(0, this.shake - step);
        }
        if (this.scoreHot > 0) {
            this.scoreHot = Math.max(0, this.scoreHot - step);
        }
        this.advanceTongue(step);
        const modal = this.help || this.historyOpen;
        const world = this.world;
        if (this.phase === 'playing' && !modal && world) {
            this.acc += step;
            const interval = intervalMs(this.save.speed, world.mode, world.eaten, world.slowLeft) / 1000;
            let steps = 0;
            while (this.acc >= interval && steps < 4 && this.phase === 'playing') {
                this.acc -= interval;
                const events = world.step();
                this.onEvents(events);
                steps += 1;
                if (this.phase !== 'playing') {
                    break;
                }
            }
            if (this.phase === 'playing') {
                world.tickTime(step);
            }
        } else if (this.phase === 'dying') {
            this.dieLeft -= step;
            this.acc = 0;
            if (this.dieLeft <= 0) {
                this.enterOver();
            }
        } else if (this.phase !== 'playing') {
            this.acc = 0;
        }
        this.fx.update(step);
        this.refresh();
    }

    private ensureNodes(): void {
        if (this.built) {
            return;
        }
        this.fieldNode = uiNode('field');
        this.node.addChild(this.fieldNode);
        this.fieldNode.addComponent(UITransform).setAnchorPoint(0, 0);
        this.fieldGfx = this.fieldNode.addComponent(Graphics);
        this.fieldBlock = uiNode('block');
        this.fieldNode.addChild(this.fieldBlock);
        this.fieldBlock.addComponent(UITransform).setAnchorPoint(0, 0);
        this.fieldBlock.addComponent(BlockInputEvents);
        this.sliderNode = uiNode('slider');
        this.node.addChild(this.sliderNode);
        this.sliderNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this.sliderGfx = this.sliderNode.addComponent(Graphics);
        this.sliderNode.on(Node.EventType.TOUCH_START, this.onSlider, this);
        this.sliderNode.on(Node.EventType.TOUCH_MOVE, this.onSlider, this);
        this.fieldNode.on(Node.EventType.TOUCH_START, this.onSwipeStart, this);
        this.fieldNode.on(Node.EventType.TOUCH_END, this.onSwipeEnd, this);
        this.fieldNode.on(Node.EventType.TOUCH_CANCEL, this.onSwipeEnd, this);
        this.built = true;
    }

    private viewSize(): { w: number; h: number } {
        const visible = view.getVisibleSize();
        if (visible.width > 32 && visible.height > 32) {
            return { w: visible.width, h: visible.height };
        }
        const ui = this.getComponent(UITransform);
        return {
            w: ui && ui.contentSize.width > 32 ? ui.contentSize.width : 1280,
            h: ui && ui.contentSize.height > 32 ? ui.contentSize.height : 720,
        };
    }

    private refresh = (): void => {
        if (!this.fieldNode || !this.fieldGfx || !this.fieldBlock) {
            return;
        }
        const { w: W, h: H } = this.viewSize();
        if (W < 32 || H < 32) {
            return;
        }
        const chrome = layoutChrome(W, H, this.model(W, H), this.clock);
        this.placeField(chrome, W, H);
        this.drawField(chrome);
        this.syncLabels(chrome, W, H);
        this.syncButtons(chrome, W, H);
        this.drawSlider(chrome, W, H);
    };

    private model(W: number, H: number): UiModel {
        const world = this.world;
        const playing = world && (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'dying' || this.phase === 'over');
        const active = playing ? world.mode : this.save.mode;
        const parts: string[] = [];
        if (world && (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'dying')) {
            if (world.slowLeft > 0) {
                parts.push(`慢动作 ${world.slowLeft.toFixed(1)}s`);
            }
            if (world.mult > 1) {
                parts.push(`双倍 ×${world.multLeft}`);
            }
            if (active === 'challenge' && world.eaten >= 4) {
                parts.push('节奏加快');
            }
        }
        if (this.pending && (this.phase === 'playing' || this.phase === 'paused')) {
            parts.push(`下局 ${MODE_NAME[this.pending]}`);
        }
        if (this.phase === 'paused' && !this.help) {
            parts.push('已暂停');
        }
        const mobile = sys.isMobile || H > W;
        return {
            phase: this.phase,
            help: this.help,
            historyOpen: this.historyOpen,
            selectedMode: this.save.mode,
            pendingMode: this.pending,
            activeMode: active,
            score: playing ? world.score : 0,
            best: this.save.best,
            bestByMode: this.save.best_by_mode,
            lengthText: playing ? String(world.snake.length) : '—',
            buff: parts.join('   '),
            speed: this.save.speed,
            soundOn: this.tones.enabled,
            soundAvailable: this.soundAvailable,
            resultScore: this.resultScore,
            resultLen: this.resultLen,
            resultMode: this.resultMode,
            newRecord: this.newRecord,
            newModeRecord: this.newModeRecord,
            victory: this.victory,
            history: this.save.history,
            mobile,
            scoreHot: this.scoreHot > 0,
            confirmClear: this.confirmClear,
        };
    }

    private placeField(chrome: Chrome, W: number, H: number): void {
        const field = this.fieldNode!;
        const tr = field.getComponent(UITransform)!;
        tr.setContentSize(chrome.field.w, chrome.field.h);
        const x = chrome.field.x - W / 2;
        const y = chrome.field.y - H / 2;
        this.fieldBase.x = x;
        this.fieldBase.y = y;
        const mag = this.shake > 0 ? (this.shake / 0.42) * 7 : 0;
        field.setPosition(x + Math.sin(this.clock * 54) * mag, y + Math.cos(this.clock * 47) * mag * 0.65, 0);
        const block = this.fieldBlock!.getComponent(UITransform)!;
        block.setContentSize(chrome.field.w, chrome.field.h);
        this.fieldBlock!.setPosition(0, 0, 0);
        this.fieldBlock!.active = chrome.overlay.length > 0;
        this.grid = { cell: chrome.field.cell, rows: chrome.field.rows, cols: chrome.field.cols, w: chrome.field.w, h: chrome.field.h };
        this.reconcileGrid(chrome.field.cols, chrome.field.rows);
    }

    private reconcileGrid(cols: number, rows: number): void {
        const world = this.world;
        if (!world || this.phase === 'menu') {
            return;
        }
        const fits = world.snake.every(([x, y]) => x >= 0 && x < cols && y >= 0 && y < rows);
        if (!fits) {
            this.showMenu();
            return;
        }
        world.cols = cols;
        world.rows = rows;
        if (world.berry && (world.berry[0] >= cols || world.berry[1] >= rows)) {
            world.berry = null;
        }
        if (world.special && (world.special.x >= cols || world.special.y >= rows)) {
            world.special = null;
        }
    }

    private drawField(chrome: Chrome): void {
        const world = this.world;
        let lead = 0;
        if (this.phase === 'playing' && world) {
            const interval = intervalMs(this.save.speed, world.mode, world.eaten, world.slowLeft) / 1000;
            lead = interval > 0 ? Math.max(0, Math.min(0.999, this.acc / interval)) : 0;
        }
        const frame = paintField({
            world: this.phase === 'menu' ? null : world,
            cols: chrome.field.cols,
            rows: chrome.field.rows,
            cell: chrome.field.cell,
            clock: this.clock,
            lead,
            blink: this.blinking(),
            pulse: this.pulse(),
            tongue: this.tongue,
            fx: this.fx,
            mascot: this.phase === 'menu' || !world,
        });
        replay(this.fieldGfx!, frame.cmds.concat(chrome.overlay));
        frame.popups.forEach((p, i) => {
            chrome.labels.push({
                id: `pop-${i}`,
                text: p.text,
                x: p.x,
                y: p.y,
                size: p.size,
                color: p.color,
                bold: true,
                align: 'center',
                w: p.size * (p.text.length + 1),
                parent: 'field',
            });
        });
    }

    private syncLabels(chrome: Chrome, W: number, H: number): void {
        const used = new Set<string>();
        for (const spec of chrome.labels) {
            used.add(spec.id);
            const label = this.ensureLabel(spec);
            label.string = spec.text;
            label.fontSize = spec.size;
            label.lineHeight = spec.size + 4;
            label.color = hexColor(spec.color);
            label.isBold = spec.bold;
            label.horizontalAlign = spec.align === 'left' ? Label.HorizontalAlign.LEFT : spec.align === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER;
            label.overflow = Label.Overflow.SHRINK;
            label.enableWrapText = false;
            const ui = label.node.getComponent(UITransform)!;
            const ax = spec.align === 'left' ? 0 : spec.align === 'right' ? 1 : 0.5;
            ui.setAnchorPoint(ax, 0.5);
            ui.setContentSize(Math.max(8, spec.w), spec.size + 8);
            const [x, y] = spec.parent === 'field' ? [spec.x, spec.y] : [spec.x - W / 2, spec.y - H / 2];
            label.node.setPosition(x, y, 0);
            label.node.active = true;
        }
        for (const [id, label] of this.labels) {
            if (!used.has(id)) {
                label.node.active = false;
            }
        }
    }

    private ensureLabel(spec: LabelSpec): Label {
        let label = this.labels.get(spec.id);
        const parent = spec.parent === 'field' ? this.fieldNode! : this.node;
        if (!label) {
            const node = uiNode(spec.id);
            label = node.addComponent(Label);
            label.useSystemFont = true;
            label.fontFamily = 'Microsoft YaHei, PingFang SC, Noto Sans SC, WenQuanYi Micro Hei, sans-serif';
            label.cacheMode = Label.CacheMode.NONE;
            label.verticalAlign = Label.VerticalAlign.CENTER;
            node.addComponent(UITransform);
            this.labels.set(spec.id, label);
        }
        if (label.node.parent !== parent) {
            parent.addChild(label.node);
        }
        label.node.setSiblingIndex(parent.children.length - 1);
        return label;
    }

    private syncButtons(chrome: Chrome, W: number, H: number): void {
        const used = new Set<string>();
        for (const spec of chrome.buttons) {
            used.add(spec.id);
            const view = this.ensureButton(spec);
            const parent = spec.parent === 'field' ? this.fieldNode! : this.node;
            if (view.root.parent !== parent) {
                parent.addChild(view.root);
            }
            view.root.setSiblingIndex(parent.children.length - 1);
            view.ui.setContentSize(spec.w, spec.h);
            const [x, y] = spec.parent === 'field' ? [spec.x, spec.y] : [spec.x - W / 2, spec.y - H / 2];
            view.root.setPosition(x, y, 0);
            view.root.active = true;
            view.label.string = spec.text;
            view.label.fontSize = 14;
            view.label.isBold = true;
            view.label.color = hexColor(spec.enabled && (spec.selected || spec.primary) ? '#ffffff' : spec.enabled ? '#cbbbe8' : '#8d7eae');
            const g = view.gfx;
            g.clear();
            g.lineJoin = Graphics.LineJoin.ROUND;
            const fill = !spec.enabled ? '#241845' : spec.primary || spec.selected ? '#ff7eb6' : '#2a1b55';
            g.fillColor = hexColor(fill);
            g.roundRect(-spec.w / 2, -spec.h / 2, spec.w, spec.h, 6);
            g.fill();
            let opacity = view.root.getComponent(UIOpacity);
            if (!opacity) {
                opacity = view.root.addComponent(UIOpacity);
            }
            opacity.opacity = spec.enabled ? 255 : 120;
            view.handler = () => this.onButton(spec.id);
        }
        for (const [id, view] of this.buttons) {
            if (!used.has(id)) {
                view.root.active = false;
            }
        }
    }

    private ensureButton(spec: ButtonSpec): ButtonView {
        let view = this.buttons.get(spec.id);
        if (view) {
            return view;
        }
        const root = uiNode(spec.id);
        const ui = root.addComponent(UITransform);
        ui.setAnchorPoint(0.5, 0.5);
        const gfx = root.addComponent(Graphics);
        const text = uiNode('text');
        root.addChild(text);
        const label = text.addComponent(Label);
        label.useSystemFont = true;
        label.fontFamily = 'Microsoft YaHei, PingFang SC, Noto Sans SC, WenQuanYi Micro Hei, sans-serif';
        label.cacheMode = Label.CacheMode.NONE;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        const textUi = text.addComponent(UITransform);
        textUi.setAnchorPoint(0.5, 0.5);
        textUi.setContentSize(spec.w - 8, spec.h);
        const made: ButtonView = { root, gfx, label, ui, handler: () => undefined };
        root.on(Node.EventType.TOUCH_START, (event: EventTouch) => {
            event.propagationStopped = true;
        }, this);
        root.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
            event.propagationStopped = true;
            if (root.getComponent(UIOpacity)?.opacity !== 120) {
                made.handler();
            }
        }, this);
        this.buttons.set(spec.id, made);
        return made;
    }

    private drawSlider(chrome: Chrome, W: number, H: number): void {
        const spec = chrome.slider;
        const node = this.sliderNode!;
        const ui = node.getComponent(UITransform)!;
        ui.setContentSize(spec.w + 28, 36);
        node.setPosition(spec.x - W / 2, spec.y - H / 2, 0);
        const g = this.sliderGfx!;
        g.clear();
        g.fillColor = hexColor('#3a2a70');
        g.roundRect(-spec.w / 2, -spec.h / 2, spec.w, spec.h, spec.h / 2);
        g.fill();
        const t = (spec.value - 1) / 9;
        g.fillColor = hexColor('#ff7eb6');
        g.roundRect(-spec.w / 2, -spec.h / 2, Math.max(spec.h, spec.w * t), spec.h, spec.h / 2);
        g.fill();
        const kx = -spec.w / 2 + spec.w * t;
        g.fillColor = hexColor('#fff6fb');
        g.circle(kx, 0, 9);
        g.fill();
        g.strokeColor = hexColor('#ff7eb6');
        g.lineWidth = 2;
        g.circle(kx, 0, 9);
        g.stroke();
    }

    private onSlider = (event: EventTouch): void => {
        const ui = this.sliderNode?.getComponent(UITransform);
        const gfxW = ui ? ui.contentSize.width - 28 : 200;
        if (!ui) {
            return;
        }
        const local = ui.convertToNodeSpaceAR(event.getUILocation());
        const t = Math.max(0, Math.min(1, (local.x + gfxW / 2) / gfxW));
        const level = Math.max(1, Math.min(10, Math.round(1 + t * 9)));
        if (level !== this.save.speed) {
            this.save.speed = level;
            this.persist();
        }
        this.tones.resume();
    };

    private onSwipeStart = (event: EventTouch): void => {
        this.swipeStart = event.getUILocation();
    };

    private onSwipeEnd = (event: EventTouch): void => {
        const start = this.swipeStart;
        this.swipeStart = null;
        if (!start || this.phase !== 'playing' || this.help || this.historyOpen || !this.world) {
            return;
        }
        const end = event.getUILocation();
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        if (Math.hypot(dx, dy) < 28) {
            return;
        }
        if (Math.abs(dx) > Math.abs(dy)) {
            this.world.turn(dx > 0 ? 1 : -1, 0);
        } else {
            this.world.turn(0, dy > 0 ? -1 : 1);
        }
    };

    private onButton(id: string): void {
        this.tones.resume();
        if (id.startsWith('mode-')) {
            this.selectMode(id.slice(5) as Mode);
            return;
        }
        if (id.startsWith('pad-')) {
            const dir: Record<string, [number, number]> = {
                'pad-up': [0, -1],
                'pad-down': [0, 1],
                'pad-left': [-1, 0],
                'pad-right': [1, 0],
            };
            const d = dir[id];
            if (d && this.phase === 'playing' && !this.help && !this.historyOpen && this.world) {
                this.world.turn(d[0], d[1]);
            }
            return;
        }
        if (id === 'start') {
            this.help = false;
            this.historyOpen = false;
            this.startGame();
            return;
        }
        if (id === 'pause') {
            this.togglePause();
            return;
        }
        if (id === 'help' || id === 'close-help') {
            this.toggleHelp();
            return;
        }
        if (id === 'quit') {
            this.quit();
            return;
        }
        if (id === 'history') {
            this.historyOpen = !this.historyOpen;
            this.confirmClear = false;
            this.help = false;
            return;
        }
        if (id === 'close-history') {
            this.historyOpen = false;
            this.confirmClear = false;
            return;
        }
        if (id === 'clear-history') {
            if (!this.confirmClear) {
                this.confirmClear = true;
                return;
            }
            this.save.history = [];
            this.save.best = 0;
            this.save.best_by_mode = { classic: 0, zen: 0, challenge: 0 };
            this.confirmClear = false;
            this.persist();
            return;
        }
        if (id === 'sound') {
            this.toggleSound();
        }
    }

    private onKey = (event: EventKeyboard): void => {
        this.tones.resume();
        const key = event.keyCode;
        if (key === KeyCode.KEY_H || key === KeyCode.F1) {
            this.toggleHelp();
            return;
        }
        if (key === KeyCode.KEY_N) {
            if (this.soundAvailable) {
                this.toggleSound();
            }
            return;
        }
        if (key === KeyCode.F11) {
            this.toggleFullscreen();
            return;
        }
        if (this.help && (key === KeyCode.ESCAPE || key === KeyCode.SPACE || key === KeyCode.KEY_P || key === KeyCode.ENTER || key === KeyCode.NUM_ENTER)) {
            this.help = false;
            return;
        }
        if (key === KeyCode.ESCAPE) {
            this.onEscape();
            return;
        }
        if (key === KeyCode.ENTER || key === KeyCode.NUM_ENTER) {
            if (this.phase === 'menu' || this.phase === 'over' || this.phase === 'dying') {
                this.startGame();
            } else if (this.phase === 'paused') {
                this.phase = 'playing';
            }
            return;
        }
        if (key === KeyCode.SPACE || key === KeyCode.KEY_P) {
            if (this.clock - this.lastToggle < 0.18) {
                return;
            }
            this.lastToggle = this.clock;
            if (this.phase === 'menu') {
                this.startGame();
            } else if (this.phase === 'playing') {
                this.phase = 'paused';
                this.play('pause');
            } else if (this.phase === 'paused') {
                this.phase = 'playing';
            } else if (this.phase === 'over' || this.phase === 'dying') {
                this.startGame();
            }
            return;
        }
        if (key === KeyCode.KEY_R) {
            this.startGame();
            return;
        }
        const dir = this.dirOf(key);
        if (dir && this.phase === 'playing' && !this.help && !this.historyOpen && this.world?.alive) {
            this.world.turn(dir[0], dir[1]);
        }
    };

    private dirOf(key: KeyCode): [number, number] | null {
        if (key === KeyCode.ARROW_UP || key === KeyCode.KEY_W) {
            return [0, -1];
        }
        if (key === KeyCode.ARROW_DOWN || key === KeyCode.KEY_S) {
            return [0, 1];
        }
        if (key === KeyCode.ARROW_LEFT || key === KeyCode.KEY_A) {
            return [-1, 0];
        }
        if (key === KeyCode.ARROW_RIGHT || key === KeyCode.KEY_D) {
            return [1, 0];
        }
        return null;
    }

    private selectMode(mode: Mode): void {
        if (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'dying') {
            this.pending = mode === this.world?.mode ? null : mode;
        } else {
            this.save.mode = mode;
            this.pending = null;
            this.persist();
        }
    }

    private startGame(): void {
        if (this.pending) {
            this.save.mode = this.pending;
            this.pending = null;
        }
        const { w: W, h: H } = this.viewSize();
        const chrome = layoutChrome(W, H, this.model(W, H), this.clock);
        this.world = new SnakeWorld(chrome.field.cols, chrome.field.rows, this.save.mode);
        this.phase = 'playing';
        this.help = false;
        this.historyOpen = false;
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

    private toggleHelp(): void {
        this.help = !this.help;
        if (this.help) {
            this.historyOpen = false;
            this.play('pause');
        }
    }

    private toggleSound(): void {
        if (!this.soundAvailable) {
            return;
        }
        this.tones.enabled = !this.tones.enabled;
        this.save.sound = this.tones.enabled;
        this.persist();
        if (this.tones.enabled) {
            this.play('pause');
        }
    }

    private showMenu(): void {
        this.phase = 'menu';
        this.help = false;
        this.historyOpen = false;
        this.pending = null;
        this.world = null;
        this.acc = 0;
    }

    private onEscape(): void {
        if (this.help) {
            this.help = false;
            return;
        }
        if (this.historyOpen) {
            this.historyOpen = false;
            this.confirmClear = false;
            return;
        }
        if (this.isFullscreen()) {
            this.toggleFullscreen();
            return;
        }
        if (this.phase !== 'menu') {
            this.showMenu();
        }
    }

    private quit(): void {
        this.persist();
        if (sys.isNative) {
            game.end();
            return;
        }
        const closer = (globalThis as unknown as { close?: () => void }).close;
        if (this.phase === 'menu' && closer) {
            closer();
        }
        this.showMenu();
    }

    private onHide = (): void => {
        if (this.phase === 'playing') {
            this.phase = 'paused';
        }
        this.persist();
    };

    private onEvents(events: WorldEvent[]): void {
        for (const ev of events) {
            if (ev.type === 'eat' && ev.kind && ev.x !== undefined && ev.y !== undefined && this.world) {
                this.fxEat(ev.kind, ev.x, ev.y, ev.amount ?? 0);
                this.scoreHot = 0.16;
                this.happy = 0.28;
                this.tongueFlick = 0.001;
                const sound: Record<FoodKind, string> = { berry: 'eat', star: 'star', slow: 'slow', mult: 'mult' };
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
        if (this.recorded || !this.world) {
            return;
        }
        this.recorded = true;
        const score = this.world.score;
        const mode = this.world.mode;
        this.resultScore = score;
        this.resultLen = this.world.snake.length;
        this.resultMode = mode;
        const modeBest = this.save.best_by_mode[mode] ?? 0;
        this.newRecord = score > 0 && score > this.save.best;
        this.newModeRecord = score > 0 && score > modeBest;
        if (score <= 0) {
            return;
        }
        if (score > this.save.best) {
            this.save.best = score;
        }
        if (score > modeBest) {
            this.save.best_by_mode[mode] = score;
        }
        const row: HistoryItem = {
            score,
            time: stampNow(),
            mode,
            length: this.resultLen,
        };
        this.save.history = [row, ...this.save.history].slice(0, 10);
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
        if (!this.world) {
            return;
        }
        const [px, py] = cellCenter(x, y, this.grid.cell, this.grid.rows);
        const color = { berry: BERRY, star: GOLD, slow: CYAN, mult: VIOLET }[kind];
        this.fx.burst(px, py, color, kind === 'berry' ? 10 : 14, 180);
        this.fx.burst(px, py, '#fff6fb', 5, 90, 0.28);
        this.fx.ring(px, py, color);
        const text = kind === 'slow' ? '慢动作' : kind === 'mult' ? '双倍' : `+${amount}`;
        const col = kind === 'berry' ? TEXT : kind === 'star' ? GOLD : kind === 'slow' ? CYAN : VIOLET;
        this.fx.popup(px, py, text, col);
    }

    private fxDeath(): void {
        if (!this.world) {
            return;
        }
        const step = this.world.snake.length < 14 ? 1 : 2;
        for (let i = 0; i < this.world.snake.length; i += step) {
            const [x, y] = cellCenter(this.world.snake[i][0], this.world.snake[i][1], this.grid.cell, this.grid.rows);
            this.fx.burst(x, y, BODY_A, 4, 120, 0.5);
        }
        const [hx, hy] = this.world.snake[0];
        const [dx, dy] = this.world.deathFace;
        const [ix, iy] = cellCenter(hx + dx, hy + dy, this.grid.cell, this.grid.rows);
        this.fx.burst(ix, iy, BERRY, 16, 220, 0.55);
        this.fx.ring(ix, iy, '#ffffff');
    }

    private fxRecord(): void {
        for (let i = 0; i < 24; i++) {
            this.fx.particles.push({
                x: 24 + Math.random() * Math.max(1, this.grid.w - 48),
                y: this.grid.h + 8 + Math.random() * 30,
                vx: -20 + Math.random() * 40,
                vy: -(70 + Math.random() * 90),
                life: 0.9,
                age: 0,
                r: 1.8 + Math.random() * 1.4,
                vr: 0,
                color: GOLD,
                kind: 'dot',
            });
        }
    }

    private blinking(): boolean {
        if (this.world && !this.world.alive) {
            return true;
        }
        return this.clock % 4.2 < 0.12;
    }

    private pulse(): number {
        if (this.happy <= 0) {
            return 1;
        }
        return 1 + 0.08 * (this.happy / 0.28);
    }

    private advanceTongue(dt: number): void {
        if (this.world && !this.world.alive) {
            this.tongue = 0;
            return;
        }
        if (this.tongueFlick > 0) {
            this.tongueFlick += dt;
            const t = this.tongueFlick;
            if (t < 0.08) {
                this.tongue = t / 0.08;
            } else if (t < 0.2) {
                this.tongue = 1;
            } else if (t < 0.3) {
                this.tongue = 1 - (t - 0.2) / 0.1;
            } else {
                this.tongue = 0;
                this.tongueFlick = 0;
                this.tongueWait = 1.4 + Math.random() * 2.2;
            }
            return;
        }
        this.tongueWait -= dt;
        if (this.tongueWait <= 0) {
            this.tongueFlick = 0.001;
        }
    }

    private play(name: string): void {
        if (!this.tones.enabled) {
            return;
        }
        if (sys.isBrowser || !this.clips.has(name)) {
            this.tones.play(name);
            return;
        }
        const clip = this.clips.get(name);
        if (clip && this.audio) {
            this.audio.playOneShot(clip, 1);
        }
    }

    private loadClips(): void {
        let left = TONE_NAMES.length;
        let ok = 0;
        for (const name of TONE_NAMES) {
            resources.load(`audio/${name}`, AudioClip, (err, clip) => {
                left -= 1;
                if (!err && clip) {
                    this.clips.set(name, clip);
                    ok += 1;
                }
                if (left === 0 && ok > 0) {
                    this.soundAvailable = true;
                }
            });
        }
    }

    private loadSave(): SaveData {
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return defaultSave();
            }
            return sanitizeSave(JSON.parse(raw));
        } catch {
            return defaultSave();
        }
    }

    private persist(): void {
        try {
            sys.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.save));
        } catch {
            // 写不进存档时这一局照样能玩。
        }
    }

    private preventBrowserScroll(): void {
        const target = globalThis as unknown as {
            addEventListener?: (type: string, fn: (ev: { code?: string; preventDefault: () => void }) => void, opts?: boolean) => void;
        };
        target.addEventListener?.('keydown', (ev) => {
            if (ev.code === 'Space' || ev.code === 'ArrowUp' || ev.code === 'ArrowDown' || ev.code === 'ArrowLeft' || ev.code === 'ArrowRight') {
                ev.preventDefault();
            }
        });
    }

    private isFullscreen(): boolean {
        const doc = (globalThis as unknown as { document?: { fullscreenElement?: unknown } }).document;
        return Boolean(doc && doc.fullscreenElement);
    }

    private toggleFullscreen(): void {
        const doc = (globalThis as unknown as {
            document?: {
                fullscreenElement?: unknown;
                documentElement?: { requestFullscreen?: () => void };
                exitFullscreen?: () => void;
            };
        }).document;
        if (!doc) {
            return;
        }
        if (!doc.fullscreenElement) {
            doc.documentElement?.requestFullscreen?.();
        } else {
            doc.exitFullscreen?.();
        }
    }
}
