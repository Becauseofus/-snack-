/** 格子规则。画面插值不在这里做。与 Python 版 SnakeWorld 对齐。 */

import { DRAGON_COIL_SECONDS, FOOD_SCORE, type FoodKind, type Mode, MODES, SKIN_SKILLS, type SaveData } from './config';
import { dragonCoilPose, dragonCoilTouches, type DragonCoilPose } from './dragonCoil';

export type Cell = [number, number];
export type Dir = [number, number];

export interface Rng {
    random(): number;
    choice<T>(items: T[]): T;
    choices<T>(items: T[], weights: number[]): T;
}

export interface WorldEvent {
    type: 'eat' | 'die' | 'win' | 'skill-eat';
    x?: number;
    y?: number;
    kind?: FoodKind;
    amount?: number;
}

export interface Motion {
    dir: Dir;
    nx: number;
    ny: number;
    outside: boolean;
    will_eat: boolean;
    will_grow: boolean;
    fatal: boolean;
}

export interface SpecialFood {
    x: number;
    y: number;
    kind: FoodKind;
    ttl: number;
}

export interface Spit {
    x: number; y: number; vx: number; vy: number; armed: boolean;
}

const DIRS: Dir[] = [[0, 1], [0, -1], [1, 0], [-1, 0]];

export function defaultRng(): Rng {
    return {
        random: () => Math.random(),
        choice<T>(items: T[]): T {
            return items[Math.floor(Math.random() * items.length)];
        },
        choices<T>(items: T[], weights: number[]): T {
            let total = 0;
            for (const w of weights) {
                total += w;
            }
            let r = Math.random() * total;
            for (let i = 0; i < items.length; i++) {
                r -= weights[i];
                if (r <= 0) {
                    return items[i];
                }
            }
            return items[items.length - 1];
        },
    };
}

function sameDir(a: Dir, b: Dir): boolean {
    return a[0] === b[0] && a[1] === b[1];
}

export class SnakeWorld {
    cols: number;
    rows: number;
    mode: Mode;
    rng: Rng;
    allowSpecial: boolean;
    snake: Cell[] = [];
    direction: Dir = [1, 0];
    queue: Dir[] = [];
    score = 0;
    eaten = 0;
    alive = true;
    won = false;
    pendingGrow = 0;
    slowLeft = 0;
    mult = 1;
    multLeft = 0;
    berry: Cell | null = null;
    special: SpecialFood | null = null;
    deathFace: Dir = [1, 0];
    deathGrow = false;
    dragonCoilLeft = 0;
    skillCooldowns: Partial<Record<SaveData['skin'], number>> = {};
    spits: Spit[] = [];

    constructor(cols: number, rows: number, mode: Mode = 'classic', rng?: Rng, allowSpecial = true) {
        this.cols = cols;
        this.rows = rows;
        this.mode = (MODES as readonly string[]).includes(mode) ? mode : 'classic';
        this.rng = rng ?? defaultRng();
        this.allowSpecial = allowSpecial;
        this.reset();
    }

    reset(): void {
        const cx = Math.min(this.cols - 2, Math.max(4, Math.floor(this.cols / 3)));
        const cy = Math.floor(this.rows / 2);
        this.snake = [];
        for (let i = 0; i < 5; i++) {
            this.snake.push([cx - i, cy]);
        }
        this.direction = [1, 0];
        this.queue = [];
        this.score = 0;
        this.eaten = 0;
        this.alive = true;
        this.won = false;
        this.pendingGrow = 0;
        this.slowLeft = 0;
        this.mult = 1;
        this.multLeft = 0;
        this.berry = null;
        this.special = null;
        this.deathFace = [1, 0];
        this.deathGrow = false;
        this.dragonCoilLeft = 0;
        this.skillCooldowns = {};
        this.spits = [];
        this.spawnBerry();
        this.maybeSpecial();
    }

    turn(dx: number, dy: number): boolean {
        if (!this.alive || this.won) {
            return false;
        }
        const next: Dir = [dx, dy];
        if (!DIRS.some((d) => sameDir(d, next))) {
            return false;
        }
        const last = this.queue.length ? this.queue[this.queue.length - 1] : this.direction;
        if (sameDir(next, last) || (next[0] === -last[0] && next[1] === -last[1])) {
            return false;
        }
        if (this.queue.length >= 2) {
            return false;
        }
        this.queue.push(next);
        return true;
    }

    castSkill(skin: SaveData['skin'], mouth?: Cell): boolean {
        if (!this.alive || this.won) return false;
        const skill = SKIN_SKILLS[skin];
        if (!skill || (this.skillCooldowns[skin] ?? 0) > 0) return false;
        if (skin === 'dragon') {
            if (this.dragonCoilLeft > 0) return false;
            this.dragonCoilLeft = DRAGON_COIL_SECONDS;
            this.skillCooldowns[skin] = skill.cooldown;
            return true;
        }
        if (skin !== 'dufaxing') return false;
        const [mx, my] = mouth ?? this.snake[0];
        const x = Math.max(-0.2, Math.min(this.cols - 0.8, mx));
        const y = Math.max(-0.2, Math.min(this.rows - 0.8, my));
        const angle = this.rng.random() * Math.PI * 2;
        this.spits.push({x, y, vx: Math.cos(angle) * 0.85, vy: Math.sin(angle) * 0.85, armed: false});
        this.skillCooldowns[skin] = skill.cooldown;
        return true;
    }

    coilPose(lead: number): DragonCoilPose {
        const [x, y] = this.snake[0], [dx, dy] = this.direction;
        return dragonCoilPose(x + 0.5 + lead * dx, y + 0.5 + lead * dy, dx, dy,
            this.dragonCoilLeft, this.cols, this.rows, this.mode === 'zen');
    }

    private collectCoilFood(pose: DragonCoilPose): WorldEvent[] {
        const events: WorldEvent[] = [];
        const berry = this.berry;
        if (berry && dragonCoilTouches(pose, berry[0] + 0.5, berry[1] + 0.5, 0.3)) {
            this.award('berry', events, berry[0], berry[1]);
            this.pendingGrow += 1;
        }
        const special = this.special;
        if (special && dragonCoilTouches(pose, special.x + 0.5, special.y + 0.5, special.kind === 'star' ? 0.405 : 0.3)) {
            this.award(special.kind, events, special.x, special.y);
            this.pendingGrow += special.kind === 'star' ? 2 : 1;
        }
        return events;
    }

    private collectSpits(from: Cell, to: Cell, pose: DragonCoilPose | null = null): WorldEvent[] {
        const events: WorldEvent[] = [];
        // A zen wrap crosses two edges, never the whole middle of the board.
        const wrapped = Math.abs(to[0]-from[0]) > 1 || Math.abs(to[1]-from[1]) > 1;
        const dx = wrapped ? 0 : to[0]-from[0], dy = wrapped ? 0 : to[1]-from[1];
        this.spits = this.spits.filter(p => {
            if (!p.armed) {
                p.armed = Math.hypot(p.x-to[0],p.y-to[1]) > 0.85;
                return true;
            }
            const t = dx*dx+dy*dy ? Math.max(0,Math.min(1,((p.x-from[0])*dx+(p.y-from[1])*dy)/(dx*dx+dy*dy))) : 0;
            const x = wrapped ? to[0] : from[0]+t*dx, y = wrapped ? to[1] : from[1]+t*dy;
            const hit = pose ? dragonCoilTouches(pose, p.x + 0.5, p.y + 0.5, 0.3) : Math.hypot(p.x-x,p.y-y) <= 0.55;
            if (!hit) return true;
            this.score += 40; // Fixed skill reward: no multiplier, growth, or speed change.
            events.push({type:'skill-eat',x:p.x,y:p.y,amount:40});
            return false;
        });
        return events;
    }

    tickSkills(dt: number, lead = 0): WorldEvent[] {
        if (!this.alive || this.won || !Number.isFinite(dt) || dt <= 0) return [];
        // Repeated frame deltas can leave a rounding residue at the exact end time.
        this.dragonCoilLeft = this.dragonCoilLeft <= dt + 1e-9 ? 0 : this.dragonCoilLeft - dt;
        for (const skin of Object.keys(this.skillCooldowns) as SaveData['skin'][]) {
            const left = this.skillCooldowns[skin]! - dt;
            this.skillCooldowns[skin] = left <= 1e-9 ? 0 : left;
        }
        const pose = this.dragonCoilLeft > 0 ? this.coilPose(lead) : null;
        const events = pose ? this.collectCoilFood(pose) : [];
        if (!this.spits.length) return events;
        // Small substeps prevent a moving ball from passing through the head.
        const count = Math.ceil(dt / 0.05), step = dt / count;
        for (let i=0;i<count;i++) {
            for (const p of this.spits) {
                p.x += p.vx*step; p.y += p.vy*step;
                const xmax=this.cols-0.8, ymax=this.rows-0.8;
                if(p.x < -0.2) {p.x=-0.4-p.x;p.vx=Math.abs(p.vx);}
                if(p.x > xmax) {p.x=2*xmax-p.x;p.vx=-Math.abs(p.vx);}
                if(p.y < -0.2) {p.y=-0.4-p.y;p.vy=Math.abs(p.vy);}
                if(p.y > ymax) {p.y=2*ymax-p.y;p.vy=-Math.abs(p.vy);}
            }
            events.push(...this.collectSpits(this.snake[0],this.snake[0],pose));
        }
        return events;
    }

    glance(): Dir {
        if (this.queue.length) {
            return this.queue[0];
        }
        return this.direction;
    }

    motion(): Motion {
        const [dx, dy] = this.direction;
        const [hx, hy] = this.snake[0];
        let nx = hx + dx;
        let ny = hy + dy;
        let outside = false;
        if (this.mode === 'zen') {
            nx = ((nx % this.cols) + this.cols) % this.cols;
            ny = ((ny % this.rows) + this.rows) % this.rows;
        } else {
            outside = !(nx >= 0 && nx < this.cols && ny >= 0 && ny < this.rows);
        }
        const willEat = !outside && this.dragonCoilLeft === 0 && this.kindAt(nx, ny) !== null;
        const willGrow = !outside && (willEat || this.pendingGrow > 0);
        let fatal = outside;
        if (!outside) {
            const tailSafe = !willGrow && this.snake.length > 1;
            const body = tailSafe ? this.snake.slice(0, -1) : this.snake;
            if (body.some((c) => c[0] === nx && c[1] === ny)) {
                fatal = true;
            }
        }
        return { dir: [dx, dy], nx, ny, outside, will_eat: willEat, will_grow: willGrow, fatal };
    }

    step(): WorldEvent[] {
        if (!this.alive || this.won) {
            return [];
        }
        const m = this.motion();
        if (m.fatal) {
            this.alive = false;
            this.dragonCoilLeft = 0;
            this.deathFace = m.dir;
            this.deathGrow = m.will_grow;
            return [{ type: 'die', x: m.nx, y: m.ny }];
        }
        const kind = m.will_eat ? this.kindAt(m.nx, m.ny) : null;
        const events = this.dragonCoilLeft > 0 ? [] : this.collectSpits(this.snake[0], [m.nx, m.ny]);
        this.snake.unshift([m.nx, m.ny]);
        if (kind) {
            this.award(kind, events, m.nx, m.ny);
            if (kind === 'star') {
                this.pendingGrow += 1;
            }
        } else if (this.pendingGrow > 0) {
            this.pendingGrow -= 1;
        } else {
            this.snake.pop();
        }
        this.consumeTurn();
        if (this.berry === null && !this.won) {
            this.spawnBerry();
            this.maybeSpecial();
        }
        if (this.won) {
            this.dragonCoilLeft = 0;
            events.push({ type: 'win' });
        }
        return events;
    }

    tickTime(dt: number): void {
        if (!this.alive || this.won) {
            return;
        }
        if (this.slowLeft > 0) {
            this.slowLeft = Math.max(0, this.slowLeft - dt);
        }
        if (this.special) {
            const ttl = this.special.ttl - dt;
            if (ttl <= 0) {
                this.special = null;
            } else {
                this.special = { ...this.special, ttl };
            }
        }
    }

    private consumeTurn(): void {
        while (this.queue.length) {
            const nd = this.queue.shift()!;
            if (!sameDir(nd, this.direction) && !(nd[0] === -this.direction[0] && nd[1] === -this.direction[1])) {
                this.direction = nd;
                return;
            }
        }
    }

    private kindAt(x: number, y: number): FoodKind | null {
        if (this.berry && this.berry[0] === x && this.berry[1] === y) {
            return 'berry';
        }
        if (this.special && this.special.x === x && this.special.y === y) {
            return this.special.kind;
        }
        return null;
    }

    private award(kind: FoodKind, events: WorldEvent[], x: number, y: number): void {
        if (kind === 'berry') {
            this.berry = null;
        } else {
            this.special = null;
        }
        const gained = FOOD_SCORE[kind] * this.mult;
        this.score += gained;
        this.eaten += 1;
        if (this.multLeft > 0) {
            this.multLeft -= 1;
            if (this.multLeft <= 0) {
                this.mult = 1;
            }
        }
        if (kind === 'slow') {
            this.slowLeft = Math.max(this.slowLeft, 4.5);
        } else if (kind === 'mult') {
            this.mult = 2;
            this.multLeft = 3;
        }
        events.push({ type: 'eat', kind, x, y, amount: gained });
    }

    private freeCells(): Cell[] {
        const taken = new Set<string>();
        for (const [x, y] of this.snake) {
            taken.add(`${x},${y}`);
        }
        if (this.berry) {
            taken.add(`${this.berry[0]},${this.berry[1]}`);
        }
        if (this.special) {
            taken.add(`${this.special.x},${this.special.y}`);
        }
        const cells: Cell[] = [];
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                if (!taken.has(`${x},${y}`)) {
                    cells.push([x, y]);
                }
            }
        }
        return cells;
    }

    private front(): Cell {
        const [hx, hy] = this.snake[0];
        const [dx, dy] = this.direction;
        let nx = hx + dx;
        let ny = hy + dy;
        if (this.mode === 'zen') {
            nx = ((nx % this.cols) + this.cols) % this.cols;
            ny = ((ny % this.rows) + this.rows) % this.rows;
        }
        return [nx, ny];
    }

    private pickCell(): Cell | null {
        const cells = this.freeCells();
        if (!cells.length) {
            return null;
        }
        const [fx, fy] = this.front();
        const choices = cells.filter((c) => !(c[0] === fx && c[1] === fy));
        return this.rng.choice(choices.length ? choices : cells);
    }

    private spawnBerry(): void {
        const cell = this.pickCell();
        if (!cell) {
            this.berry = null;
            this.won = true;
            return;
        }
        this.berry = cell;
    }

    private maybeSpecial(): void {
        if (!this.allowSpecial || this.special || this.won) {
            return;
        }
        const chance = { classic: 0.22, zen: 0.14, challenge: 0.4 }[this.mode];
        if (this.rng.random() >= chance) {
            return;
        }
        const cell = this.pickCell();
        if (!cell) {
            return;
        }
        const kind = this.rng.choices<FoodKind>(['star', 'slow', 'mult'], [4, 3, 3]);
        this.special = { x: cell[0], y: cell[1], kind, ttl: 9 };
    }
}
