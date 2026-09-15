import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiGateway, readAiConfig } from './ai-gateway.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'dist');
const port=Number(process.env.JIAOYING_PORT||8765);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const aiGateway=createAiGateway(await readAiConfig());
const server=http.createServer(async(req,res)=>{
  try{
    if(await aiGateway(req,res))return;
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Method not allowed');return;}
    const url=new URL(req.url,'http://127.0.0.1');
    const name=decodeURIComponent(url.pathname)==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file=resolve(root,name);
    if(!file.startsWith(root+sep)){res.writeHead(403);res.end('Forbidden');return;}
    const content=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    res.end(req.method==='HEAD'?undefined:content);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:400,{'Content-Type':'text/plain; charset=utf-8'});res.end('无法读取请求的文件');}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use. Set JIAOYING_PORT to a different port.`:error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Jiaoying demo: http://127.0.0.1:${port}`));
