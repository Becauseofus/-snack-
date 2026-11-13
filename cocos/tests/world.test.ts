import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitGrid, intervalMs, sanitizeSave, speedToMs } from '../assets/scripts/logic/config';
import { roundPath } from '../assets/scripts/logic/path';
import { SnakeWorld, type Rng } from '../assets/scripts/logic/SnakeWorld';

function make(cols = 16, rows = 12, mode: 'classic' | 'zen' | 'challenge' = 'classic'): SnakeWorld {
    const world = new SnakeWorld(cols, rows, mode, undefined, false);
    world.berry = [0, 0];
    world.special = null;
    world.pendingGrow = 0;
    return world;
}

test('no reverse and buffer limit', () => {
    const world = make();
    assert.deepEqual(world.direction, [1, 0]);
    assert.equal(world.turn(-1, 0), false);
    assert.deepEqual(world.queue, []);
    assert.equal(world.turn(0, -1), true);
    assert.equal(world.turn(0, 1), false);
    assert.equal(world.turn(-1, 0), true);
    assert.equal(world.turn(1, 0), false);
    assert.deepEqual(world.queue, [[0, -1], [-1, 0]]);
});

test('turn applies after the current cell', () => {
    const world = make();
    const start = world.snake[0];
    world.turn(0, -1);
    world.turn(-1, 0);
    world.step();
    assert.deepEqual(world.snake[0], [start[0] + 1, start[1]]);
    assert.deepEqual(world.direction, [0, -1]);
    assert.deepEqual(world.queue, [[-1, 0]]);
    const landed = world.snake[0];
    world.step();
    assert.deepEqual(world.snake[0], [landed[0], landed[1] - 1]);
    assert.deepEqual(world.direction, [-1, 0]);
    assert.deepEqual(world.queue, []);
});

test('tail cell is safe when not growing', () => {
    const world = make();
    world.snake = [[0, 0], [0, 1], [1, 1], [1, 0]];
    world.direction = [1, 0];
    world.step();
    assert.equal(world.alive, true);
    assert.deepEqual(world.snake[0], [1, 0]);
    assert.equal(world.snake.length, 4);
    assert.equal(new Set(world.snake.map((c) => `${c[0]},${c[1]}`)).size, 4);
});

test('self collision', () => {
    const world = make();
    world.snake = [[2, 0], [1, 0], [1, 1], [2, 1], [3, 1], [3, 0]];
    world.direction = [0, 1];
    const events = world.step();
    assert.equal(world.alive, false);
    assert.equal(events[0].type, 'die');
});

test('wall and wrap', () => {
    const classic = make(16, 12, 'classic');
    classic.snake = [[0, 3], [1, 3], [2, 3], [3, 3]];
    classic.direction = [-1, 0];
    const events = classic.step();
    assert.equal(classic.alive, false);
    assert.equal(events[0].type, 'die');

    const zen = make(16, 12, 'zen');
    zen.snake = [[0, 3], [1, 3], [2, 3], [3, 3]];
    zen.direction = [-1, 0];
    zen.step();
    assert.equal(zen.alive, true);
    assert.deepEqual(zen.snake[0], [zen.cols - 1, 3]);
});

test('berry grows once', () => {
    const world = make();
    const [hx, hy] = world.snake[0];
    world.berry = [hx + 1, hy];
    const before = world.snake.length;
    const events = world.step();
    assert.equal(events[0].type, 'eat');
    assert.equal(events[0].amount, 10);
    assert.equal(world.snake.length, before + 1);
    assert.equal(world.pendingGrow, 0);
    world.berry = [0, 0];
    world.step();
    assert.equal(world.snake.length, before + 1);
});

test('star score and extra segment', () => {
    const world = make();
    const [hx, hy] = world.snake[0];
    world.special = { x: hx + 1, y: hy, kind: 'star', ttl: 9 };
    const before = world.snake.length;
    const events = world.step();
    assert.equal(events[0].amount, 30);
    assert.equal(world.snake.length, before + 1);
    assert.equal(world.pendingGrow, 1);
    world.step();
    assert.equal(world.snake.length, before + 2);
    assert.equal(world.pendingGrow, 0);
    world.step();
    assert.equal(world.snake.length, before + 2);
});

test('multiplier charges', () => {
    const world = make();
    const [hx, hy] = world.snake[0];
    world.special = { x: hx + 1, y: hy, kind: 'mult', ttl: 9 };
    world.step();
    assert.equal(world.score, 5);
    assert.equal(world.mult, 2);
    assert.equal(world.multLeft, 3);
    for (const expected of [2, 1, 0]) {
        const [x, y] = world.snake[0];
        const [dx, dy] = world.direction;
        world.berry = [x + dx, y + dy];
        world.special = null;
        const before: number = world.score;
        world.step();
        assert.equal(world.score - before, 20);
        assert.equal(world.multLeft, expected);
    }
    assert.equal(world.mult, 1);
    const [x, y] = world.snake[0];
    const [dx, dy] = world.direction;
    world.berry = [x + dx, y + dy];
    const before = world.score;
    world.step();
    assert.equal(world.score - before, 10);
});

test('slow and special expiry', () => {
    const world = make();
    const [hx, hy] = world.snake[0];
    world.special = { x: hx + 1, y: hy, kind: 'slow', ttl: 9 };
    world.step();
    assert.equal(world.slowLeft, 4.5);
    world.tickTime(1);
    assert.equal(world.slowLeft, 3.5);
    world.tickTime(10);
    assert.equal(world.slowLeft, 0);
    world.special = { x: 1, y: 1, kind: 'star', ttl: 1 };
    world.tickTime(1.2);
    assert.equal(world.special, null);
});

test('clearing the board wins', () => {
    const world = make(3, 3);
    world.snake = [[2, 1], [2, 0], [1, 0], [1, 1], [1, 2], [0, 2], [0, 1], [0, 0]];
    world.direction = [0, 1];
    world.berry = [2, 2];
    world.special = null;
    world.won = false;
    world.alive = true;
    const events = world.step();
    assert.equal(world.won, true);
    assert.equal(world.alive, true);
    assert.equal(events.some((ev) => ev.type === 'win'), true);
});

test('round path softens a corner', () => {
    const out = roundPath([[0, 0], [40, 0], [40, 40]], 12);
    assert.deepEqual(out[0], [0, 0]);
    assert.deepEqual(out[out.length - 1], [40, 40]);
    assert.ok(out.length > 3);
    assert.ok(out.every((p) => p[0] >= 0 && p[0] <= 40 && p[1] >= 0 && p[1] <= 40));
    const straight = roundPath([[0, 0], [10, 0], [30, 0]], 6);
    assert.equal(straight.length, 3);
});

test('speed and grid', () => {
    const speeds = [];
    for (let level = 1; level <= 10; level++) {
        speeds.push(speedToMs(level));
    }
    const sorted = speeds.slice().sort((a, b) => b - a);
    assert.deepEqual(speeds, sorted);
    assert.ok(speeds[0] > speeds[speeds.length - 1]);
    for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440], [800, 500]] as const) {
        const [cols, rows, cell] = fitGrid(w, h);
        assert.ok(cols * cell <= w);
        assert.ok(rows * cell <= h);
        assert.ok(cols >= 8 && rows >= 8);
    }
    const classic = intervalMs(5, 'classic', 0, 0);
    assert.ok(intervalMs(5, 'zen', 0, 0) > classic);
    const base = intervalMs(5, 'challenge', 0, 0);
    const faster = intervalMs(5, 'challenge', 20, 0);
    assert.ok(faster < base);
    assert.ok(intervalMs(5, 'challenge', 20, 3) > faster);
});

test('sanitize keeps old scores', () => {
    const cfg = sanitizeSave({ best: 80, speed: 99, mode: 'nope', history: [{ score: 1, mode: 'zen', length: 4, time: 't' }, 'bad'] });
    assert.equal(cfg.best, 80);
    assert.equal(cfg.speed, 10);
    assert.equal(cfg.mode, 'classic');
    assert.equal(cfg.history.length, 1);
    assert.equal(cfg.best_by_mode.zen, 0);
});

test('special fruit avoids the cell in front when it can', () => {
    const picks: Array<[number, number]> = [[4, 6], [8, 6]];
    const rng: Rng = {
        random: () => 0,
        choice: (items) => items[0],
        choices: (items) => items[0],
    };
    const world = new SnakeWorld(12, 10, 'classic', rng, true);
    world.snake = [[3, 6], [2, 6], [1, 6], [0, 6]];
    world.direction = [1, 0];
    world.berry = [4, 6];
    world.special = null;
    world.allowSpecial = true;
    const cell = (world as unknown as { pickCell(): [number, number] | null }).pickCell();
    assert.ok(cell);
    assert.notDeepEqual(cell, [4, 6]);
    void picks;
});
