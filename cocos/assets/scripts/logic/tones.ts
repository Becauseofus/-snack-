/** 浏览器里用 Web Audio 合成短音。没有 AudioContext 时静音。 */

type Note = [number, number];

const BANK: Record<string, { notes: Note[]; vol: number }> = {
    eat: { notes: [[660, 0.045], [880, 0.07]], vol: 0.2 },
    star: { notes: [[660, 0.04], [880, 0.04], [1180, 0.09]], vol: 0.22 },
    slow: { notes: [[520, 0.07], [390, 0.11]], vol: 0.18 },
    mult: { notes: [[700, 0.05], [1040, 0.09]], vol: 0.2 },
    die: { notes: [[420, 0.07], [300, 0.09], [196, 0.16]], vol: 0.22 },
    start: { notes: [[523, 0.05], [784, 0.09]], vol: 0.18 },
    pause: { notes: [[620, 0.035]], vol: 0.12 },
    record: { notes: [[784, 0.05], [988, 0.05], [1318, 0.12]], vol: 0.22 },
};

interface ToneCtx {
    currentTime: number;
    state: string;
    resume(): Promise<void>;
    createOscillator(): {
        frequency: { value: number };
        type: string;
        connect(node: unknown): void;
        start(t: number): void;
        stop(t: number): void;
    };
    createGain(): {
        gain: {
            setValueAtTime(v: number, t: number): void;
            exponentialRampToValueAtTime(v: number, t: number): void;
        };
        connect(node: unknown): void;
    };
    destination: unknown;
}

function context(): ToneCtx | null {
    const g = globalThis as unknown as {
        AudioContext?: new () => ToneCtx;
        webkitAudioContext?: new () => ToneCtx;
    };
    const Ctor = g.AudioContext || g.webkitAudioContext;
    if (!Ctor) {
        return null;
    }
    const bag = globalThis as unknown as { __snakeAudio?: ToneCtx };
    if (!bag.__snakeAudio) {
        bag.__snakeAudio = new Ctor();
    }
    return bag.__snakeAudio;
}

export function toneAvailable(): boolean {
    const g = globalThis as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
    return Boolean(g.AudioContext || g.webkitAudioContext);
}

export class Tones {
    enabled = true;

    resume(): void {
        const ctx = context();
        if (ctx && ctx.state === 'suspended') {
            void ctx.resume();
        }
    }

    play(name: string): void {
        if (!this.enabled) {
            return;
        }
        const bank = BANK[name];
        const ctx = context();
        if (!bank || !ctx) {
            return;
        }
        if (ctx.state === 'suspended') {
            void ctx.resume();
        }
        let t = ctx.currentTime + 0.01;
        for (const [freq, length] of bank.notes) {
            const osc = ctx.createOscillator();
            const over = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            over.type = 'sine';
            osc.frequency.value = freq;
            over.frequency.value = freq * 2;
            osc.connect(gain);
            over.connect(gain);
            gain.connect(ctx.destination);
            const peak = Math.max(0.0002, bank.vol);
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
            osc.start(t);
            over.start(t);
            osc.stop(t + length + 0.02);
            over.stop(t + length + 0.02);
            t += length * 0.92;
        }
    }
}
