// Renderer regression harness. Models Cocos Sprite's frame-triggered auto sizing.
// Usage: node cocos/tests/skin-render.cjs <typescript.js> [--baseline]
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require(path.resolve(process.argv[2]));
class UITransform {
  setContentSize(w,h) { this.width=w; this.height=h; }
}
class Sprite {
  static SizeMode = {CUSTOM:0,TRIMMED:1,RAW:2};
  sizeMode = 1;
  set spriteFrame(frame) {
    this.frame=frame;
    if(this.sizeMode!==0) this.node.getComponent(UITransform).setContentSize(frame.rect.width,frame.rect.height);
  }
}
class Node {
  constructor(name) {this.name=name;this.children=[];this.components=new Map();this.active=true;}
  addChild(node) {this.children.push(node);}
  addComponent(Type) {const c=new Type();c.node=this;this.components.set(Type,c);return c;}
  getComponent(Type) {return this.components.get(Type);}
  getChildByName(name) {return this.children.find(c=>c.name===name);}
  setPosition(x,y) {this.x=x;this.y=y;}
  setSiblingIndex() {}
}
class Graphics {clear(){} ellipse(){} fill(){}}
const cc={Node,Sprite,UITransform,Graphics,Component:class{},Color:class{},KeyCode:{SPACE:32,KEY_P:80},Layers:{Enum:{UI_2D:1}},_decorator:{ccclass:()=>c=>c}};
const cache=new Map();
function load(file) {
  if(cache.has(file)) return cache.get(file);
  let source=fs.readFileSync(file,'utf8');
  if(process.argv.includes('--baseline')&&file.endsWith('GameApp.ts')) source=require('node:child_process').execFileSync('git',['show','HEAD:cocos/assets/scripts/GameApp.ts'],{encoding:'utf8'});
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
  const exports={};cache.set(file,exports);
  vm.runInNewContext('(function(require,exports){'+js+'\n})',{console})(id=>id==='cc'?cc:load(path.resolve(path.dirname(file),id+'.ts')),exports);
  return exports;
}
const {GameApp}=load(path.resolve('cocos/assets/scripts/GameApp.ts'));
const {mascotGeometry}=load(path.resolve('cocos/assets/scripts/logic/paint.ts'));
const app=new GameApp(),layer=new Node('field'),nodes=[];
for(const skin of ['dufaxing','robot','dragon','candy']) {
  const frames=Array.from({length:30},()=>({rect:{width:245,height:100}}));
  frames[0]={rect:{width:360,height:620}};frames[2]={rect:{width:245,height:510}};
  for(const [i,height] of [350,55,215].entries()) frames[27+i]={rect:{width:360,height}};
  app.skinFrames.set(skin,frames);
}
function snapshot() {
  const bands=[];
  for(const n of nodes.filter(n=>n.active)) for(const child of n.children.filter(c=>c.active&&c.name.startsWith('portrait-band'))) {
    const ui=child.getComponent(UITransform);
    assert.ok(ui.width<60&&ui.height<60,`Oversized head band on first frame: ${ui.width}x${ui.height}`);
    bands.push([ui.width,ui.height,child.x,child.y]);
  }
  return bands;
}
// Fresh allocation, pool growth, wrap copies, skin switches, and reuse.
for(const [skin,w,wrap] of [['dufaxing',320,false],['dufaxing',640,false],['dufaxing',800,true],['robot',320,false],['dufaxing',320,false],['dragon',640,false],['candy',640,false],['dufaxing',960,true]]) {
  app.save.skin=skin;
  const geo=mascotGeometry(w,240,32,1),g={w,h:240,cell:32};
  app.renderDragon(layer,nodes,geo,g,wrap);
  const first=snapshot();
  app.renderDragon(layer,nodes,geo,g,wrap);
  assert.deepEqual(snapshot(),first,'New head must have final dimensions on its very first frame');
  if(skin==='dufaxing') assert.ok(first.length>=3); else assert.equal(first.length,0);
}
console.log('PASS: first-frame sizing, growth/wrap allocations, and skin/pool reuse');
const {SnakeWorld}=load(path.resolve('cocos/assets/scripts/logic/SnakeWorld.ts'));
app.world=new SnakeWorld(20,14,'zen',undefined,false);
app.grid={w:640,h:448,cell:32,cols:20,rows:14};
app.save.skin='dufaxing';app.phase='playing';app.clock=1;
app.play=()=>{};app.advanceTongue=()=>{};app.stepSmoke=()=>{};app.render=()=>{};
app.onKey({keyCode:32});
assert.equal(app.phase,'playing');assert.equal(app.world.spits.length,1);
assert.equal(app.world.skillCooldowns.dufaxing,20);
app.onKey({keyCode:32});assert.equal(app.world.spits.length,1);
app.onKey({keyCode:80});assert.equal(app.phase,'paused');
const paused=JSON.stringify([app.world.spits,app.world.skillCooldowns]);
app.update(.05);app.onKey({keyCode:32});
assert.equal(app.phase,'paused');
assert.equal(JSON.stringify([app.world.spits,app.world.skillCooldowns]),paused);
app.phase='playing';app.settingsOpen=true;
app.update(.05);app.onKey({keyCode:32});
assert.equal(JSON.stringify([app.world.spits,app.world.skillCooldowns]),paused);
console.log('PASS: Space casts without pausing; P pauses; menus freeze skills');
