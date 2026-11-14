import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isTitleStartKey,enterAction} from '../assets/scripts/logic/config';
test('system and unmapped native keys cannot start the game',()=>{
    for(const k of [0,-1,91,92,93,224,225,1073742051,1073742055,...Array.from({length:24},(_,i)=>112+i)]) assert.equal(isTitleStartKey(k),false, String(k));
    for(const k of [13,32,37,38,39,40,48,65,90,96,188]) assert.equal(isTitleStartKey(k),true);
});
test('enter preserves active and dying games',()=>{
    assert.equal(enterAction('playing'),'none');
    assert.equal(enterAction('dying'),'none');
    assert.equal(enterAction('paused'),'resume');
    assert.equal(enterAction('menu'),'start');
    assert.equal(enterAction('over'),'start');
});
