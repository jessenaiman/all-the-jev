// Keep one local worker attached to the browser; inference returns through this server.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function createJevBrowser({root=process.env.JEV_ULTRAFAST_DIR||'C:/sites/jev-ultrafast'}={}){
  let child=null,pending=null,id=0;
  const python=join(root,process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
  function start(){
    if(child)return;
    if(!existsSync(python)||!existsSync(join(root,'jev_ultrafast/model.py')))throw Error('Jev Ultrafast is not installed. Set JEV_ULTRAFAST_DIR to its checkout and run uv sync there.');
    const proc=spawn(python,['-u',fileURLToPath(new URL('../scripts/jev-browser.py',import.meta.url)),root],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,BH_RECORD:'0',BH_TELEMETRY:'0',BH_REQUIRE_EXISTING_DAEMON:'1',PYTHONIOENCODING:'utf-8'}});
    child=proc;
    const stop=()=>{if(child!==proc)return;child=null;if(pending){clearTimeout(pending.timer);pending.reject(Error('Jev browser worker stopped. Reconnect and observe before choosing.'));pending=null;}};
    proc.on('error',stop);proc.on('exit',stop);proc.stderr.on('data',()=>{});
    createInterface({input:proc.stdout}).on('line',async line=>{
      let value;try{value=JSON.parse(line);}catch{return;}
      const current=pending;if(!current)return;
      if(value.inference){
        try{const result=await current.infer(value.inference);if(child===proc&&pending===current)proc.stdin.write(JSON.stringify({result})+'\n');}
        catch(error){if(child===proc&&pending===current)proc.stdin.write(JSON.stringify({error:error.message})+'\n');}
        return;
      }
      if(value.id!==current.id)return;
      clearTimeout(current.timer);pending=null;
      if(value.error)current.reject(Error(value.error));else current.resolve(value.result);
    });
  }
  function call(command,args={},infer=()=>{throw Error('Inference is unavailable for this command.');}){
    if(pending)return Promise.reject(Object.assign(Error('A browser step is already running.'),{status:409}));
    try{start();}catch(error){return Promise.reject(error);}
    const requestId=++id;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{if(pending?.id!==requestId)return;pending=null;reject(Error('Browser step timed out. Use browser-harness --doctor; no automatic reconnect.'));child?.kill();},45000);
      pending={id:requestId,resolve,reject,timer,infer};
      child.stdin.write(JSON.stringify({id:requestId,command,...args})+'\n');
    });
  }
  return {call,close:()=>child?.kill()};
}
