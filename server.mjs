import {createExerciseServer} from './local-server.mjs';
import {readFile} from 'node:fs/promises';
const port=Number(process.env.JIAOYING_PORT||8767);
let initialData=null;
if(process.env.JIAOYING_STATE_FILE){
  const saved=JSON.parse(await readFile(process.env.JIAOYING_STATE_FILE,'utf8'));
  initialData=saved?.data??saved;
  if(!initialData||typeof initialData!=='object'||Array.isArray(initialData))throw new Error('JIAOYING_STATE_FILE 必须包含有效的演练状态对象');
}
const {server}=createExerciseServer({initialData});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use. Set JIAOYING_PORT to a different port.`:error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Jiaoying V3: http://127.0.0.1:${port}/#command\nField page: http://127.0.0.1:${port}/#field\nLocal only; Agent and Caiyun adapters are not connected.`));
