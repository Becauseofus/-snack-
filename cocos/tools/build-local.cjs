// Recompile source scripts against a supplied compatible Cocos 3.8.6 runtime.
// Outputs a separate staging directory; never modifies the installed game.
const fs = require('fs'), path = require('path'), vm = require('vm');
const [runtime, compiler, stage] = process.argv.slice(2);
if (!runtime || !compiler || !stage || fs.existsSync(stage)) throw Error('Supply runtime, TypeScript module, and a NEW stage directory');
const ts = require(path.resolve(compiler));
fs.mkdirSync(stage, {recursive:true});
for (const entry of fs.readdirSync(runtime, {withFileTypes:true})) {
  if (entry.name === 'Resources' || /\.(exe|dll)$/.test(entry.name) && !entry.name.startsWith('unins'))
    fs.cpSync(path.join(runtime,entry.name),path.join(stage,entry.name === '贪吃蛇.exe' ? 'Snake.exe' : entry.name),{recursive:true,filter:p=>!p.endsWith('.bak')&&!p.endsWith('.log')});
}
const target = path.join(stage,'Resources/assets/main/index.js');
let bundle = fs.readFileSync(target,'utf8');
for (const file of ['GameApp.ts', ...fs.readdirSync('cocos/assets/scripts/logic').filter(n=>n.endsWith('.ts')).map(n=>'logic/'+n)]) {
  const name = path.basename(file);
  const marker = 'System.register("chunks:///_virtual/'+name+'"';
  const bootstrap=bundle.lastIndexOf('(function(r)');
  if(bootstrap<0) throw Error('Missing bundle bootstrap');
  const existing = bundle.indexOf(marker);
  const start = existing < 0 ? bootstrap : existing;
  const next = existing < 0 ? -1 : bundle.indexOf('System.register(',start+marker.length);
  const end = next < 0 ? bootstrap : Math.min(next, bootstrap);
  let src=fs.readFileSync('cocos/assets/scripts/'+file,'utf8');
  if(name==='GameApp.ts') {
    src="import {cclegacy} from 'cc';\n"+src;
    src=src.replace('const { ccclass }','cclegacy._RF.push({}, "5f1a0wuezRNkZ5qPIsdTypw", "GameApp", undefined);\nconst { ccclass }');
    src+='\ncclegacy._RF.pop();\n';
  }
  const result=ts.transpileModule(src,{fileName:name,compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.System,experimentalDecorators:true,useDefineForClassFields:false},reportDiagnostics:true});
  if(result.diagnostics.some(d=>d.category===ts.DiagnosticCategory.Error)) throw Error('Compile failed: '+name);
  const out=result.outputText.replace('System.register(',marker+', ').replace(/"\.\/(?:logic\/)?([A-Za-z]+)"/g,'"./$1.ts"');
  new vm.Script(out); bundle=bundle.slice(0,start)+out+'\n'+bundle.slice(end);
}
new vm.Script(bundle); fs.writeFileSync(target,bundle);
const root=path.join(stage,'Resources/assets/resources');
const configPath=path.join(root,'cc.config.json'), config=JSON.parse(fs.readFileSync(configPath));
const packId=Object.keys(config.packs).find(k=>config.packs[k].includes(1));
const packPath=path.join(root,'import',packId.slice(0,2),packId+'.json');
const pack=JSON.parse(fs.readFileSync(packPath));
for (const [skin, uuid] of [
  ['dufaxing', 'ddfa0109-0000-4000-8000-000000000001'],
  ['dragon-coil', '426ad776-cc30-4de2-a7ed-e10caa240e2b'],
]) {
  const imagePath = `skins/${skin}`;
  const imageType = config.types.indexOf('cc.ImageAsset');
  const textureType = config.types.indexOf('cc.Texture2D');
  const paths = Object.values(config.paths);
  const hasImage = paths.some(([name, type]) => name === imagePath && type === imageType);
  const hasTexture = paths.some(([name, type]) => name === `${imagePath}/texture` && type === textureType);
  if (hasImage && hasTexture) continue;
  if (hasImage || hasTexture) throw Error(`Incomplete runtime registration for ${imagePath}`);

  const index = config.uuids.length;
  config.uuids.push(`${uuid}@6c48a`, uuid);
  config.paths[index] = [`${imagePath}/texture`, textureType, 1];
  config.paths[index + 1] = [imagePath, imageType, 1];
  config.packs[packId].push(index);
  pack.data.push(['2,2,0,0,0,0', [uuid]]);

  const prefix = uuid.slice(0, 2);
  fs.mkdirSync(path.join(root, 'import', prefix), {recursive: true});
  fs.mkdirSync(path.join(root, 'native', prefix), {recursive: true});
  fs.writeFileSync(path.join(root, 'import', prefix, `${uuid}.json`), JSON.stringify([1,0,0,['cc.ImageAsset'],0,[{fmt:'0',w:0,h:0},-1],[0],0,[],[],[]]));
  fs.copyFileSync(`cocos/assets/resources/${imagePath}.png`, path.join(root, 'native', prefix, `${uuid}.png`));
}
fs.writeFileSync(packPath,JSON.stringify(pack));fs.writeFileSync(configPath,JSON.stringify(config));
fs.writeFileSync(path.join(stage,'LOCAL-BUILD.txt'),'Codex local build: 龙技能试行\r\nSource branch: codex-work\r\nBase runtime: Cocos 3.8.6 / 1.0.9\r\n');
console.log('Staged source build: '+stage);
