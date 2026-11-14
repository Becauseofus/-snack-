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
