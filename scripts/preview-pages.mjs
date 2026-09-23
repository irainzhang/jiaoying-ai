import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../tmp/pages-release');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.geojson':'application/geo+json','.png':'image/png','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://localhost');
  if(!u.pathname.startsWith('/jiaoying-ai/')){res.writeHead(404);res.end('Preview uses /jiaoying-ai/');return;}
  const path=resolve(root,decodeURIComponent(u.pathname.slice('/jiaoying-ai/'.length))||'index.html');
  if(!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  const bytes=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(bytes);
}catch{res.writeHead(404);res.end('Not found');}}).listen(8768,'127.0.0.1',()=>console.log('Pages-only preview: http://127.0.0.1:8768/jiaoying-ai/start.html'));
