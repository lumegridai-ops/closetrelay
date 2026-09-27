import {loadPyodide} from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';
let pyodide;
const boot=(async()=>{
  pyodide=await loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/'});
  pyodide.FS.mkdirTree('/app/backend');pyodide.FS.mkdirTree('/session');
  for(const name of ['__init__.py','demo.py','model.py','server.py']){
    const response=await fetch(`/hosted-python/${name}`);if(!response.ok)throw new Error('The workflow source could not load.');
    pyodide.FS.writeFile(`/app/backend/${name}`,await response.text());
  }
  const response=await fetch('/hosted-python/bridge.py');if(!response.ok)throw new Error('The workspace bridge could not load.');
  await pyodide.runPythonAsync(await response.text());
})();
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.then(async()=>{
  try{
    await boot;
    if(data.type==='restore'){
      pyodide.runPython('close_workspace()');
      for(const suffix of ['','-wal','-shm']){try{pyodide.FS.unlink('/session/closet.sqlite3'+suffix);}catch{}}
      if(data.database?.byteLength)pyodide.FS.writeFile('/session/closet.sqlite3',new Uint8Array(data.database));
      pyodide.runPython('open_workspace()');self.postMessage({id:data.id,ok:true});return;
    }
    pyodide.globals.set('request_json',JSON.stringify(data.request));
    const result=JSON.parse(pyodide.runPython('dispatch_request(request_json)'));
    let snapshot;
    if(data.request.method!=='GET'&&result.status<400){pyodide.runPython('checkpoint_workspace()');snapshot=pyodide.FS.readFile('/session/closet.sqlite3').slice().buffer;}
    self.postMessage({id:data.id,ok:true,...result,snapshot},snapshot?[snapshot]:[]);
  }catch(error){self.postMessage({id:data.id,ok:false,error:String(error)});}
}).catch(()=>{});};
