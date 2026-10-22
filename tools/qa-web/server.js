const http=require('http'),fs=require('fs'),path=require('path');
const root=process.env.WEB_ROOT || '/tmp/web';
const types={'.js':'application/javascript','.html':'text/html','.png':'image/png','.webp':'image/webp','.ttf':'font/ttf','.json':'application/json','.css':'text/css'};
http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);let f=path.join(root,p);
if(!fs.existsSync(f)||fs.statSync(f).isDirectory()) f=path.join(root,'index.html');
res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);}).listen(8099,()=>console.log('up'));
