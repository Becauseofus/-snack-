import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mascotGeometry, paintField } from '../assets/scripts/logic/paint';
import { FX } from '../assets/scripts/logic/fx';

test('dragon mascot replaces classic title drawing', () => {
    const input = {world:null,cols:20,rows:14,cell:32,clock:1,lead:0,blink:false,pulse:1,tongue:0,fx:new FX(),mascot:true};
    assert.ok(paintField(input).cmds.length > 0);
    assert.equal(paintField({...input,hideSnake:true}).cmds.length, 0);
});
test('shared mascot geometry fits title and preview', () => {
    for (const [w,h,cell] of [[640,448,32],[140,90,23],[90,90,15]]) {
        const geo = mascotGeometry(w,h,cell,1);
        assert.ok(geo.runs.length > 0);
        assert.ok(geo.head.x > 0 && geo.head.x < w);
        assert.ok(geo.head.y > 0 && geo.head.y < h);
        assert.ok(Number.isFinite(geo.head.face[0]));
    }
});
import { sanitizeSave } from '../assets/scripts/logic/config';
test('new skins survive save round trips', () => {
    for (const skin of ['robot', 'candy']) {
        const save = sanitizeSave({skin, best: 240});
        assert.equal(sanitizeSave(JSON.parse(JSON.stringify(save))).skin, skin);
        assert.equal(save.best, 240);
    }
});


import {skinBodyTiles,skinHeadPosition,skinHeadSize} from '../assets/scripts/logic/paint';
test('body texture density is independent of curve sample density',()=>{
    const coarse=skinBodyTiles([[0,0],[160,0]],20);
    const dense=skinBodyTiles(Array.from({length:41},(_,i)=>[i*4,0]),20);
    assert.deepEqual(coarse,dense); assert.equal(coarse.length,8);
});
test('head keeps its size and remains aligned with the body at edges',()=>{
    assert.deepEqual(skinHeadSize(32),{w:49.6,h:54.4});
    assert.deepEqual(skinHeadPosition(100,16,[1,0],32,640,448),[100,16]);
});

test('body stops at the tail base for every textured skin',()=>{
    const width=32*.85;
    for(const [tw,th] of [[210,580],[220,510],[240,515]]) {
        const tail=width*th/tw;
        const tiles=skinBodyTiles([[0,0],[320,0]],19,tail);
        assert.ok(tiles.length>0);
        const last=tiles[tiles.length-1];
        assert.ok(Math.abs(last.x+last.length/2-(320-tail))<0.0001);
        for(const t of tiles) assert.ok(t.x+t.length/2<=320-tail+0.0001);
    }
});

test('tail strips join the body on a curved path without straight-tail displacement',()=>{
    const points = Array.from({length:61},(_,i)=>[i*4,20*Math.sin(i/10)]);
    let total=0;
    for(let i=1;i<points.length;i++) total+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
    const body=skinBodyTiles(points,18,60);
    const tail=skinBodyTiles(points,60/24,0,total-60);
    assert.equal(tail.length,24);
    const ends=(t:any)=>{
        const a=(t.angle+90)*Math.PI/180,dx=Math.cos(a)*t.chord/2,dy=Math.sin(a)*t.chord/2;
        return [[t.x+dx,t.y+dy],[t.x-dx,t.y-dy]];
    };
    const all=[body[body.length-1],...tail];
    for(let i=1;i<all.length;i++) {
        const a=ends(all[i-1])[1],b=ends(all[i])[0];
        assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<0.00001);
    }
});
