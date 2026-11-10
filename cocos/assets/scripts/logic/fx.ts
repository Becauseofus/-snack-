/** 吃到、死亡、破纪录的粒子。坐标由调用方传入，已经是画面像素。 */

export interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    age: number;
    r: number;
    vr: number;
    color: string;
    kind: 'dot' | 'ring';
}

export interface Popup {
    x: number;
    y: number;
    vy: number;
    text: string;
    color: string;
    age: number;
    life: number;
}

export class FX {
    particles: Particle[] = [];
    popups: Popup[] = [];

    burst(x: number, y: number, color: string, n = 12, speed = 170, life = 0.42): void {
        for (let i = 0; i < n; i++) {
            const ang = Math.random() * Math.PI * 2;
            const spd = speed * (0.35 + Math.random() * 0.65);
            this.particles.push({
                x,
                y,
                vx: Math.cos(ang) * spd,
                vy: Math.sin(ang) * spd,
                life: life * (0.75 + Math.random() * 0.4),
                age: 0,
                r: 1.6 + Math.random() * 1.8,
                vr: 0,
                color,
                kind: 'dot',
            });
        }
    }

    ring(x: number, y: number, color: string): void {
        this.particles.push({
            x,
            y,
            vx: 0,
            vy: 0,
            life: 0.38,
            age: 0,
            r: 8,
            vr: 110,
            color,
            kind: 'ring',
        });
    }

    popup(x: number, y: number, text: string, color: string): void {
        this.popups.push({ x, y: y + 8, vy: 38, text, color, age: 0, life: 0.75 });
        if (this.popups.length > 6) {
            this.popups = this.popups.slice(-6);
        }
    }

    update(dt: number): void {
        const alive: Particle[] = [];
        for (const p of this.particles) {
            p.age += dt;
            if (p.age >= p.life) {
                continue;
            }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.kind === 'dot') {
                p.vy -= 30 * dt;
            } else {
                p.r += p.vr * dt;
            }
            alive.push(p);
        }
        this.particles = alive.slice(-220);
        const pops: Popup[] = [];
        for (const p of this.popups) {
            p.age += dt;
            if (p.age >= p.life) {
                continue;
            }
            p.y += p.vy * dt;
            pops.push(p);
        }
        this.popups = pops;
    }
}
