import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SnakeWorld } from '../assets/scripts/logic/SnakeWorld';
import { paintField } from '../assets/scripts/logic/paint';
import { FX } from '../assets/scripts/logic/fx';

function world(mode: 'classic' | 'zen' = 'classic') {
    const w = new SnakeWorld(20, 14, mode, undefined, false);
    w.berry = [0,0];
    return w;
}
test('skill dispatch, twenty-second cooldown, and new-round reset', () => {
    const w=world();
    for(const skin of ['classic','dragon','robot','candy'] as const) assert.equal(w.castSkill(skin),false);
    assert.equal(w.castSkill('dufaxing'),true);
    assert.equal(w.spits.length,1);
    assert.equal(w.castSkill('dufaxing'),false);
    w.tickSkills(19.9);
    assert.equal(w.castSkill('dufaxing'),false);
    w.tickSkills(0.11);
    assert.equal(w.castSkill('dufaxing'),true);
    w.reset();
    assert.equal(w.spits.length,0);
    assert.equal(w.castSkill('dufaxing'),true);
    w.alive=false;
    const x=w.spits[0].x, cooldown=w.skillCooldowns.dufaxing;
    w.tickSkills(10);
    assert.equal(w.spits[0].x,x);
    assert.equal(w.skillCooldowns.dufaxing,cooldown);
});
test('spit starts at supplied mouth and chooses a random direction at constant speed', () => {
    const velocities: number[][]=[];
    for(const random of [0,.25,.5,.75]) {
        const w=world();w.rng.random=()=>random;
        assert.equal(w.castSkill('dufaxing',[6.2,6.1]),true);
        const p=w.spits[0];
        assert.equal(p.x,6.2);assert.equal(p.y,6.1);assert.equal(p.armed,false);
        assert.ok(Math.abs(Math.hypot(p.vx,p.vy)-.85)<1e-10);
        velocities.push([p.vx,p.vy]);
        w.tickSkills(.05);assert.equal(w.score,0);
    }
    assert.ok(velocities[0][0]>0&&velocities[1][1]>0&&velocities[2][0]<0&&velocities[3][1]<0);
});
test('all four walls reflect balls, including zen mode, without leaving the map', () => {
    for(const mode of ['classic','zen'] as const) {
        const w=world(mode);
        w.spits=[{x:19.19,y:3,vx:.85,vy:0,armed:true},{x:-.19,y:3,vx:-.85,vy:0,armed:true},
            {x:2,y:13.19,vx:0,vy:.85,armed:true},{x:2,y:-.19,vx:0,vy:-.85,armed:true}];
        w.tickSkills(.1);
        assert.ok(w.spits[0].vx<0&&w.spits[1].vx>0&&w.spits[2].vy<0&&w.spits[3].vy>0);
        for(const p of w.spits) assert.ok(p.x>=-.2&&p.x<=19.2&&p.y>=-.2&&p.y<=13.2);
    }
});
test('head collects once for exactly 40; body contact and multipliers do not affect skill reward', () => {
    const w=world(), [x,y]=w.snake[0];
    w.mult=2;w.multLeft=3;
    w.spits=[{x:x+.8,y,vx:.85,vy:0,armed:true},{x:x-2,y,vx:0,vy:.85,armed:true}];
    const length=w.snake.length;
    const events=w.step();
    assert.equal(w.score,40);assert.equal(w.snake.length,length);assert.equal(w.eaten,0);
    assert.equal(w.multLeft,3);assert.equal(w.spits.length,1);
    assert.equal(events.filter(e=>e.type==='skill-eat').length,1);
    w.tickSkills(.01);assert.equal(w.score,40);
});
test('moving ball can reach stationary head; wall-side casting does not instantly award points', () => {
    const w=world(),[x,y]=w.snake[0];
    w.spits=[{x:x+.6,y,vx:-.85,vy:0,armed:true}];
    assert.equal(w.tickSkills(.2)[0].amount,40);
    const edge=world();edge.snake=[[19,4],[18,4]];
    edge.castSkill('dufaxing');edge.tickSkills(.05);
    assert.equal(edge.score,0);assert.equal(edge.spits.length,1);
});
test('zen wrapping never collects a ball across the middle of the map', () => {
    const w=world('zen');w.snake=[[19,5],[18,5]];
    w.spits=[{x:10,y:5,vx:0,vy:.85,armed:true}];
    w.step();assert.equal(w.score,0);assert.equal(w.spits.length,1);
});
test('spit uses fruit-sized pale-yellow circles', () => {
    const w=world();w.castSkill('dufaxing');
    const frame=paintField({world:w,cols:20,rows:14,cell:32,clock:0,lead:0,blink:false,pulse:1,tongue:0,fx:new FX(),mascot:false});
    const ball=frame.cmds.find(c=>c.op==='circle'&&c.fill==='#f5e89c');
    assert.ok(ball);assert.equal(ball.r,32*.3);
});
