// Explicit opt-in LAN launcher. server.mjs remains loopback-only.
import {networkInterfaces} from 'node:os';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createExerciseServer} from './local-server.mjs';
import {isPrivateAddress} from './room-access.mjs';

const port=Number(process.env.JIAOYING_ROOM_PORT||8770);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('JIAOYING_ROOM_PORT 必须为 1024—65535 的端口');
const addresses=[...new Set(Object.values(networkInterfaces()).flat().filter(x=>x&&x.family==='IPv4'&&!x.internal&&isPrivateAddress(x.address)).map(x=>x.address))];
if(!addresses.length)throw new Error('没有找到私有 IPv4 网络，请先让电脑连接 Wi-Fi 或局域网。未开启共享服务。');
const roomId=randomBytes(4).toString('hex'),token=randomBytes(32).toString('base64url');
const persistenceFile=process.env.JIAOYING_ROOM_STATE_FILE||fileURLToPath(new URL(`./tmp/rooms/${roomId}.json`,import.meta.url));
const {server,semanticStatus}=createExerciseServer({startMode:'blank',persistenceFile,sharedRoom:{roomId,token,allowedHosts:addresses}});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`端口 ${port} 已占用，请设置 JIAOYING_ROOM_PORT 后重新运行。`:error.message);process.exitCode=1;});
server.listen(port,'0.0.0.0',()=>{
  console.log(`叫应同 Wi-Fi 房间：${roomId}\n独立存档：${persistenceFile}\n仅供这台电脑的指挥员加入（不要把下面这条链接发给执行人员）：\nhttp://127.0.0.1:${port}/join#${token}`);
  console.log(`加入后打开 http://127.0.0.1:${port}/room/manage ，为车辆和工作人员编号生成专属现场链接。\n手机使用管理页生成的局域网链接，不使用 GitHub 地址。`);
  console.log(semanticStatus().configured?'DeepSeek 语义代理已配置，首次整理后核对响应结果。':'语义整理使用本地规则；配置 .env 后重启可连接模型。');
  console.log('使用相同 Wi-Fi，仅向对应人员分享管理页生成的现场链接。指挥链接不分享。未开启公网、未修改防火墙。\n如防火墙阻止访问，请仅为私有网络允许 Node；不要开启公网端口转发。\n手机 HTTP 页面可能不支持浏览器麦克风，请使用系统键盘语音听写。\n按 Ctrl+C 关闭房间；存档保留。需继续旧场时，用 JIAOYING_ROOM_STATE_FILE 明确指定上述独立存档，再次启动会生成新加入码。');
});
let closing=false;function close(){if(closing)return;closing=true;server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref();}
process.on('SIGINT',close);process.on('SIGTERM',close);
