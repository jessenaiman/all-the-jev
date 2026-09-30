// The browser process owns Chrome access. Jeview speaks its documented MCP stdio protocol.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function createBrowserHarness({command='uvx',args=['--from','browser-harness[mcp]','browser-harness-mcp'],timeoutMs=30000}={}) {
  let child=null, ready=null, tools=[], toolDetails=[], nextId=0, error='';
  const pending=new Map();
  const disconnect=message=>{error=message;for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error(message));}pending.clear();child=null;ready=null;tools=[];toolDetails=[];};
  function request(method,params={}){
    if(!child?.stdin.writable)return Promise.reject(Error(error||'Browser Harness is not running.'));
    const id=++nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error(`${method} timed out.`));child?.kill();},timeoutMs);
      pending.set(id,{resolve,reject,timer});
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n',writeError=>{
        if(writeError){pending.delete(id);clearTimeout(timer);reject(writeError);}
      });
    });
  }
  async function connect(){
    if(ready)return ready;
    ready=(async()=>{
      error='';
      const proc=spawn(command,args,{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,BH_RECORD:'0',BH_TELEMETRY:'0'}});
      child=proc;
      createInterface({input:proc.stdout}).on('line',line=>{
        let message;try{message=JSON.parse(line);}catch{return;}
        const item=pending.get(message.id);if(!item)return;
        pending.delete(message.id);clearTimeout(item.timer);
        if(message.error)item.reject(Error(message.error.message||'Browser Harness MCP error.'));
        else item.resolve(message.result);
      });
      proc.stderr.on('data',()=>{});
      proc.on('error',cause=>disconnect(`Could not start Browser Harness: ${cause.message}`));
      proc.on('exit',code=>disconnect(`Browser Harness exited (${code ?? 'unknown'}).`));
      await request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'jeview',version:'0.1.0'}});
      proc.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
      const listed=await request('tools/list');
      tools=(listed.tools||[]).map(tool=>tool.name);
      toolDetails=(listed.tools||[]).map(tool=>({id:tool.name,description:String(tool.description||'Browser Harness tool.').slice(0,500)}));
      if(!tools.includes('browser_page_info'))throw Error('Browser Harness did not expose browser_page_info.');
    })().catch(cause=>{error=cause.message;ready=null;child?.kill();throw cause;});
    return ready;
  }
  async function call(name,args={}){
    await connect();
    if(!tools.includes(name))throw Error(`Browser Harness tool unavailable: ${name}`);
    const result=await request('tools/call',{name,arguments:args});
    const content=(result.content||[]).filter(item=>item.type==='text').map(item=>item.text).join('\n');
    if(result.isError)throw Error(content.slice(0,1000)||`${name} failed.`);
    let data;try{data=JSON.parse(content);}catch{data=content;}
    if(data&&typeof data==='object'&&data.error)throw Error(String(data.error).slice(0,1000));
    return data;
  }
  async function status(){
    try{const page=await call('browser_page_info');return {processReady:true,toolsReady:true,connected:true,page};}
    catch(cause){return {processReady:!!child,toolsReady:tools.length>0,connected:false,message:cause.message};}
  }
  async function listTools(){await connect();return toolDetails.map(tool=>({...tool}));}
  function close(){child?.kill();disconnect('Browser Harness closed.');}
  return {call,status,listTools,close};
}
