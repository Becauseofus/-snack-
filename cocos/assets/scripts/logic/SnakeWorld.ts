/** 格子规则。画面插值不在这里做。与 Python 版 SnakeWorld 对齐。 */

import { FOOD_SCORE, type FoodKind, type Mode, MODES } from './config';

export type Cell = [number, number];
export type Dir = [number, number];

export interface Rng {
    random(): number;
    choice<T>(items: T[]): T;
    choices<T>(items: T[], weights: number[]): T;
}

export interface WorldEvent {
    type: 'eat' | 'die' | 'win';
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
        const willEat = !outside && this.kindAt(nx, ny) !== null;
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
            this.deathFace = m.dir;
            this.deathGrow = m.will_grow;
            return [{ type: 'die', x: m.nx, y: m.ny }];
        }
        const kind = this.kindAt(m.nx, m.ny);
        this.snake.unshift([m.nx, m.ny]);
        const events: WorldEvent[] = [];
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
        }
        if (kind === 'berry' && !this.won && this.special === null) {
            this.maybeSpecial();
        }
        if (this.won) {
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
