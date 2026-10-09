import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const source=resolve(dirname(fileURLToPath(import.meta.url)),'../showcase');
const replaced=new Set(['start.html','start-page.js','start-page.css','capabilities.js','guardian-offline-sw.js','guardian-cache-manifest.json','README.md','release.json']);
const features=[
  {id:'S01',name:'需求录入',status:'可演示',detail:'支持名单导入、地点搜索、人数填报与语音输入；结果先核对，再保存。'},
  {id:'S02',name:'资源与编组',status:'可演示',detail:'按编号登记工作人员、车型、核载、轮椅位与接收容量，逐车配置司机和协助人员。'},
  {id:'S03',name:'路线与安排',status:'可演示',detail:'基于瑞安局部公开道路计算演练路线与资源安排；资源不足时保留缺口和原因。'},
  {id:'S04',name:'执行与补报',status:'可演示',detail:'同一浏览器的指挥端和现场端同步回执，支持新增人员补报与安排复核。'},
  {id:'S05',name:'结束与复盘',status:'可演示',detail:'结束整场任务、保存实际完成与未完成记录，并导出复盘存档。'}
];

export async function buildShowcase({outputDirectory,files,capabilities}){
  const output=resolve(outputDirectory,'showcase'),paths=[];
  const write=async(path,text)=>{await mkdir(dirname(resolve(output,path)),{recursive:true});await writeFile(resolve(output,path),text,'utf8');paths.push(path);};
  for(const path of files){
    if(replaced.has(path))continue;
    await mkdir(dirname(resolve(output,path)),{recursive:true});
    await cp(resolve(outputDirectory,path),resolve(output,path));paths.push(path);
  }
  for(const name of ['start.html','showcase.css','showcase-home.js'])await write(name,await readFile(resolve(source,name),'utf8'));
  const catalog={version:capabilities.version,date:capabilities.date,title:capabilities.title,channel:'showcase',modelConnected:false,agentConnected:false,weatherConnected:false,crossDeviceSync:false,entries:features,limits:[
    '公开道路来自瑞安局部片区，人员、车辆、接收容量和通行状态为合成演练设定。',
    '公开展示版使用本地规则和调度算法；雨量为模拟数据。',
    '同一浏览器的两端共享演练，不同设备和浏览器各自独立；未连接原叫应系统。',
    '方案经人工核对后模拟执行，不用于真实应急指挥或安全导航。'
  ]};
  await write('capabilities.js',`window.JiaoyingCapabilities=${JSON.stringify(catalog)};\n`);
  const index=(await readFile(resolve(output,'index.html'),'utf8')).replace('分享入口与清单','作品首页').replace('在线分享 <b>','参赛展示 <b>');
  await writeFile(resolve(output,'index.html'),index,'utf8');
  // A parent-scope registration must not block this child scope. Exact-scope
  // foreign workers remain protected by the existing ownership checks.
  const mounts=await readFile(resolve(output,'guardian/mount.js'),'utf8');
  if(!mounts.includes('var current = existing &&'))throw Error('Guardian registration contract changed');
  await writeFile(resolve(output,'guardian/mount.js'),mounts.replace('var current = existing &&',"if (existing && existing.scope !== scope) existing = null;\n        var current = existing &&"),'utf8');
  for(const [name,needle,replacement] of [
    ['version-update.js','var existing = await sw.getRegistration(root.href);','var existing = await sw.getRegistration(root.href); if (existing && existing.scope !== root.href) existing = null;'],
    ['update.html','var existing = await sw.getRegistration(root.href), worker = existing &&','var existing = await sw.getRegistration(root.href); if (existing && existing.scope !== root.href) existing = null; var worker = existing &&']
  ]){
    const text=await readFile(resolve(output,name),'utf8');if(!text.includes(needle))throw Error(name+' registration contract changed');
    await writeFile(resolve(output,name),text.replace(needle,replacement),'utf8');
  }
  await write('release.json',JSON.stringify({version:capabilities.version+'-showcase',channel:'showcase',mode:'browser-exercise',scope:'same-browser-tabs',storageScope:'showcase/',modelConnected:false,agentConnected:false,weatherConnected:false},null,2));
  await write('README.md','# 叫应 AI · 参赛展示\n\n固定入口：start.html。指挥端与现场端请在同一浏览器打开。人员与资源为演练设定；公开展示使用本地规则与调度算法。\n\n展示版独立保存浏览器任务。后续发布沿用同一链接；更新提示由使用者确认后刷新，保留已提交记录。地图来源见 assets/maps/SOURCES.md，Leaflet 许可见 vendor/leaflet/LICENSE。\n');
  const cached=[...new Set(paths)].filter(x=>!['.nojekyll','README.md'].includes(x)).sort();
  let worker=await readFile(new URL('../dist/guardian-offline-sw.js',import.meta.url),'utf8');
  worker=worker.replaceAll('jiaoying-guardian-','jiaoying-showcase-');
  const digest=createHash('sha256');for(const path of cached){digest.update(path);digest.update(await readFile(resolve(output,path)));}digest.update(worker);
  const build=digest.digest('hex').slice(0,20);
  await write('guardian-cache-manifest.json',JSON.stringify({build,version:capabilities.version,channel:'showcase',files:cached},null,2));
  await write('guardian-offline-sw.js',worker.replace('__GUARDIAN_BUILD__',build));
  return [...new Set(paths)].map(path=>'showcase/'+path);
}
