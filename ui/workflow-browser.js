(() => {
  'use strict';
  window.WorkflowBrowser=function(ctx){
    const {h,button,select,option,field,api}=ctx;
    let tabs=[],target='',goal='Inspect the existing Workflow editor and select the Checks tab.',state=null,busy=false,error='',owner='',settings='',editor=null;
    async function step(command,args={}){
      const workflow=ctx.workflow();
      if(!workflow?.id){error='Save this workflow before using the browser.';ctx.render();return;}
      if(!['tabs','observe'].includes(command)&&ctx.isDirty()){error='Save the service/model and workflow settings first.';ctx.render();return;}
      busy=true;error='';ctx.render();
      try{
        const result=await api('/api/browser/jev',{command,workflowId:workflow.id,sessionId:ctx.session(),...args});
        if(command==='tabs'){tabs=result.tabs;if(!tabs.some(t=>t.targetId===target))target=tabs.find(t=>/^http:\/\/(127\.0\.0\.1|localhost):4781\//.test(t.url))?.targetId||tabs[0]?.targetId||'';}
        else state={...result,lastStep:command};
      }catch(cause){error=cause.message;if(command==='choose'||command==='execute')state={...state,decision:null};}
      finally{busy=false;ctx.render();}
    }
    function render(body){
      editor?.destroy();editor=null;
      if(owner!==ctx.workflow()?.id){owner=ctx.workflow()?.id;state=null;error='';}
      const current=JSON.stringify(ctx.workflow()?.inference||{});if(current!==settings){settings=current;if(state)state={...state,request:null,decision:null,lastStep:'observe'};}
      body.classList.add('studio-browser-body');
      const head=h('div',undefined,'studio-browser-heading');head.append(h('h3','Jev · Browser Harness'),h('small','Existing Chrome tab · recordings off'));body.append(head);
      const phase=state?.lastStep==='execute'?'Action executed · fresh observation returned':state?.decision?'Jev chose · waiting for your execution':state?.request?'Request preview · no API call':state?.page?'Browser observed':'Not connected';
      const light=h('p',phase,'studio-browser-phase');light.setAttribute('role','status');body.append(light);
      const todo=h('ol',undefined,'studio-browser-todo');
      for(const [title,done] of [['Observe selected Chrome tab',!!state?.page],['Preview state + typed questions',!!state?.request||state?.lastStep==='execute'],['Jev chooses operation + target',!!state?.decision||state?.lastStep==='execute'],['Execute the selected action once',state?.lastStep==='execute'],['Read the post-action observation',state?.lastStep==='execute']])todo.append(h('li',(done?'✓ ':'○ ')+title));
      body.append(todo);
      const cookbook=h('a','Cookbook: function calling');cookbook.href='https://docs.typesafe.ai/cookbooks/function_calling';cookbook.target='_blank';cookbook.rel='noopener';body.append(cookbook);
      const choose=select('Chrome tab');option(choose,'','Select Chrome tab');for(const t of tabs)option(choose,t.targetId,(t.title||t.url)+' · '+t.url);choose.value=target;choose.onchange=()=>{target=choose.value;state=null;ctx.render();};body.append(field('Target tab',choose));
      const connect=button(busy?'Working…':'Connect / refresh tabs',()=>step('tabs')),observe=button('Observe tab',()=>step('observe',{targetId:target}));connect.disabled=busy;observe.disabled=busy||!target;const row=h('div',undefined,'studio-browser-actions');row.append(connect,observe);body.append(row);
      if(error){const message=h('p',error,'studio-browser-error');message.setAttribute('role','alert');body.append(message);const docs=h('a','Connection instructions');docs.href='https://github.com/browser-use/browser-harness/blob/main/install.md';docs.target='_blank';docs.rel='noopener';body.append(docs);}
      if(!state?.page)return;
      body.append(h('strong',state.page.title||'Observed browser page'),h('small',state.page.url));
      const input=h('textarea');input.rows=2;input.value=goal;input.setAttribute('aria-label','Browser goal');input.oninput=()=>{goal=input.value;state={...state,request:null,decision:null,lastStep:'observe'};body.querySelector('[data-jev-choose]')?.setAttribute('disabled','');body.querySelector('[data-jev-execute]')?.setAttribute('disabled','');};body.append(field('Goal · one bounded browser step',input));
      const preview=button('Preview request',()=>step('preview',{goal})),predict=button('Send preview to Jev',()=>step('choose'));preview.disabled=busy||!goal.trim();predict.disabled=busy||!state.request;predict.dataset.jevChoose='';const controls=h('div',undefined,'studio-browser-actions');controls.append(preview,predict);body.append(controls);
      body.append(h('small','Sending shares the observed visible page text, indexed controls and goal with the selected service. Preview first. No conversation history is appended.'));
      if(state.request){const request=h('details');request.append(h('summary','Exact typed request · '+JSON.stringify(state.request).length.toLocaleString()+' characters'));const code=h('div',undefined,'studio-browser-code');request.append(code);body.append(request);editor=ctx.lib.editor(code,JSON.stringify(state.request,null,2),()=>{},true);request.append(h('small','Read-only preview: editing this display does not change the sent request.'));code.setAttribute('aria-label','Exact Jev browser request');}
      const d=state.decision;
      if(d){
        const hold=d.confidence<0.8||(d.target_confidence!==null&&d.target_confidence<0.8),stopped=['DONE','BLOCKED'].includes(d.operation),chosen=state.page.actions.find(a=>a.id===d.choice);
        body.append(h('h3',d.operation+(d.target?' ['+d.target+']':'')),h('p',chosen?.label||'Jev stopped; outcome still needs independent verification.'),h('small',`${d.model} · operation confidence ${d.confidence} · target ${d.target_confidence??'none'}`));
        const probabilities=h('details');probabilities.append(h('summary','Raw Jev answers'),h('pre',JSON.stringify(d.raw_answers,null,2)));body.append(probabilities);
        let text=null;if(d.operation==='TYPE_TEXT'){text=h('textarea');text.rows=2;text.setAttribute('aria-label','Text to enter in browser');body.append(field('Text you want entered · no text-model call',text));}
        const execute=button(hold?'Held · low confidence':stopped?'Stopped · inspect outcome':'Execute selected action',()=>step('execute',{fingerprint:state.page.fingerprint,...(text?{text:text.value}:{})}));execute.dataset.jevExecute='';execute.disabled=busy||hold||stopped;body.append(execute);
      }
      const elements=h('details');elements.append(h('summary',`${state.page.actions.length} observed actions`));for(const a of state.page.actions)elements.append(h('p',`${a.kind} · ${a.label}`));body.append(elements);
      if(state.history.length){body.append(h('h3','Executed in Chrome'));for(const item of state.history)body.append(h('p',`${item.operation} [${item.target??'—'}] · ${item.action} · ${item.page_changed===null?'post-action observation pending':item.page_changed?'page changed':'page unchanged'}`));}
    }
    return {render,dispose:()=>{editor?.destroy();editor=null;}};
  };
})();
