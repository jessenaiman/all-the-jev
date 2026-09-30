(() => {
  'use strict';
  window.GateWorkshop = function(ctx) {
    const {h,button,select,option,field,api,lib,root,notice}=ctx;
    let selected=null,lastRun=null,disposeGraph=null,disposeChart=null,renderRevision=0,mode='live',recentRuns=[],replayRunId=null,replayStep=0,replayTimer=null,liveTimer=null,viewing=false,refreshRuns=null;
    function syncUpdates(){clearInterval(liveTimer);liveTimer=null;if(viewing&&mode==='live'&&ctx.autoUpdates()&&!document.hidden&&ctx.workflow()?.id&&refreshRuns)liveTimer=setInterval(refreshRuns,5000);}
    const pct=value=>`${(value*100).toFixed(1)}%`;
    const id=(graph,prefix)=>{let n=1;while(graph.nodes.some(node=>node.id===`${prefix}_${n}`))n++;return `${prefix}_${n}`;};
    const graph=()=>ctx.workflow().graph;
    const redraw=()=>ctx.render();
    function newDraft(){return {name:'Gate workshop',graph:{prevalence:0.2,outputId:'out',nodes:[{id:'out',kind:'output'}],edges:[]},positions:{}};}
    function label(node){if(node.kind==='agent')return `${ctx.agents().find(agent=>agent.id===node.agentId)?.name||'Agent'} · ${node.questionId}`;return node.kind==='gate'?node.op.toUpperCase():'Final decision';}
    function connect(source,target){
      const g=graph(),from=g.nodes.find(n=>n.id===source),to=g.nodes.find(n=>n.id===target);
      if(!from||!to||source===target||from.kind==='output'||to.kind==='agent'){notice('Connect an agent or gate to another gate or the final output.',true);return;}
      if(to.kind==='output')g.edges=g.edges.filter(edge=>edge.target!==target);
      if(!g.edges.some(edge=>edge.source===source&&edge.target===target))g.edges.push({source,target});
      redraw();
    }
    async function addAgent(agentId){
      if(!agentId){notice('Add an agent on the Agents tab first.',true);return;}
      try{
        const agent=await api(`/api/agents/${agentId}`),revision=agent.revisions.find(item=>item.id===agent.activeRevisionId);
        const parsed=await api('/api/agents/validate',{source:revision.source}),[questionId,q]=Object.entries(parsed.questions)[0];
        const g=graph(),node={id:id(g,'check'),kind:'agent',agentId,revisionId:agent.activeRevisionId,questionId,predicate:q.type==='choice'?{type:'choice',option:Object.keys(q.criteria).find(key=>key!=='insufficient_evidence'),abstainOptions:Object.hasOwn(q.criteria,'insufficient_evidence')?['insufficient_evidence']:[]}:{type:q.type,threshold:q.type==='noul'?0.5:Math.min(1,q.criteria.length-1)},assumption:{sensitivity:0.8,specificity:0.9}};
        g.nodes.push(node);if(!g.baselineNodeId)g.baselineNodeId=node.id;selected=node.id;
        const gate=g.nodes.find(item=>item.kind==='gate'&&g.edges.filter(edge=>edge.target===item.id).length<(item.op==='not'?1:2));
        if(gate)g.edges.push({source:node.id,target:gate.id});
        else if(!g.edges.some(edge=>edge.target===g.outputId))g.edges.push({source:node.id,target:g.outputId});
        redraw();
      }catch(error){notice(error.message,true);}
    }
    function addGate(op){
      const g=graph(),node={id:id(g,'gate'),kind:'gate',op},prior=g.edges.find(edge=>edge.target===g.outputId);
      g.nodes.push(node);if(prior){g.edges=g.edges.filter(edge=>edge!==prior);g.edges.push({source:prior.source,target:node.id});}
      for(const loose of g.nodes.filter(item=>item.kind==='agent'&&!g.edges.some(edge=>edge.source===item.id))){
        if(op==='not'&&g.edges.some(edge=>edge.target===node.id))break;
        g.edges.push({source:loose.id,target:node.id});
      }
      g.edges.push({source:node.id,target:g.outputId});selected=node.id;redraw();
    }
    function numberInput(name,value,min,max,step,onChange){const input=h('input');input.type='number';input.min=min;input.max=max;input.step=step;input.value=value;input.setAttribute('aria-label',name);input.onchange=()=>{const n=Number(input.value);if(!Number.isFinite(n)||n<min||n>max){notice(`${name} must be between ${min} and ${max}.`,true);return;}onChange(n);redraw();};return field(name,input);}
    async function nodeSettings(panel,node){
      panel.replaceChildren(h('h3',label(node)));
      if(node.kind==='gate'){
        const op=select('Gate operation');for(const kind of ['and','or','not'])option(op,kind,kind.toUpperCase());op.value=node.op;op.onchange=()=>{node.op=op.value;redraw();};panel.append(field('Logic gate',op),h('p',`${graph().edges.filter(edge=>edge.target===node.id).length} connected inputs`,'muted'));
      }else if(node.kind==='agent'){
        try{
          const agent=await api(`/api/agents/${node.agentId}`),revision=agent.revisions.find(item=>item.id===node.revisionId);
          if(selected!==node.id||!panel.isConnected)return;
          const checks=(await api('/api/agents/validate',{source:revision.source})).questions,q=checks[node.questionId];
          panel.append(h('p',`Pinned revision ${node.revisionId} · ${q?.type||'missing'} question`,'muted'));
          const questions=select('Jev question');for(const [key,value] of Object.entries(checks))option(questions,key,`${key} · ${value.type}`);questions.value=node.questionId;questions.onchange=()=>{node.questionId=questions.value;const next=checks[node.questionId];node.predicate=next.type==='choice'?{type:'choice',option:Object.keys(next.criteria).find(key=>key!=='insufficient_evidence'),abstainOptions:Object.hasOwn(next.criteria,'insufficient_evidence')?['insufficient_evidence']:[]}:{type:next.type,threshold:next.type==='noul'?0.5:Math.min(1,next.criteria.length-1)};redraw();};panel.append(field('Question',questions));
          if(q?.type==='choice'){const choice=select('Positive when option is');for(const name of Object.keys(q.criteria).filter(name=>!node.predicate.abstainOptions?.includes(name)))option(choice,name,name);choice.value=node.predicate.option;choice.onchange=()=>{node.predicate.option=choice.value;redraw();};panel.append(field('Positive when',choice));}
          else if(q)panel.append(numberInput(q.type==='noul'?'Yes probability threshold':'Score threshold',node.predicate.threshold,0,q.type==='noul'?1:q.criteria.length-1,q.type==='noul'?0.05:0.25,value=>node.predicate.threshold=value));
          const latest=button('Pin latest revision',()=>{node.revisionId=agent.activeRevisionId;redraw();});latest.disabled=node.revisionId===agent.activeRevisionId;panel.append(latest);
          panel.append(h('p','Illustrative assumptions · edit to explore the gate, then compare with labeled turns.','muted'));
          panel.append(numberInput('Sensitivity (%)',Math.round(node.assumption.sensitivity*100),0,100,1,value=>node.assumption.sensitivity=value/100),numberInput('Specificity (%)',Math.round(node.assumption.specificity*100),0,100,1,value=>node.assumption.specificity=value/100));
        }catch(error){panel.append(h('p',error.message,'error'));}
      }else panel.append(h('p','The final yes/no decision returned by this reusable workflow.','muted'));
      if(node.kind!=='output')panel.append(button('Remove node',()=>{const g=graph();g.nodes=g.nodes.filter(item=>item.id!==node.id);g.edges=g.edges.filter(edge=>edge.source!==node.id&&edge.target!==node.id);if(g.baselineNodeId===node.id)delete g.baselineNodeId;delete ctx.workflow().positions[node.id];selected=null;redraw();}));
      const move=h('div',undefined,'gate-move');for(const [text,dx,dy] of [['←',-50,0],['→',50,0],['↑',0,-50],['↓',0,50]])move.append(button(text,()=>{const w=ctx.workflow(),p=w.positions[node.id]||{x:70,y:90};w.positions[node.id]={x:p.x+dx,y:p.y+dy};redraw();}));panel.append(field('Move on canvas',move));
    }
    function metricsTable(title,data){const box=h('section',undefined,'gate-metric-block');box.append(h('h3',title),h('strong',`${data.total?pct(data.correct/data.total):'—'} accuracy · ${data.correct}/${data.total} correct`));const table=h('table');for(const [name,value] of [['True positive',data.tp],['False positive',data.fp],['True negative',data.tn],['False negative',data.fn]]){const tr=h('tr');tr.append(h('th',name),h('td',String(value)));table.append(tr);}box.append(table);return box;}
    function render(){
      const version=++renderRevision;
      clearInterval(replayTimer);clearInterval(liveTimer);liveTimer=null;disposeGraph?.();disposeChart?.();disposeGraph=disposeChart=null;root.replaceChildren();
      const w=ctx.workflow(),g=w.graph,header=h('header',undefined,'gate-header');header.append(h('h1','Gate workshop'),h('span',ctx.runtime()==='langgraph'?'LangGraph runner':'Built-in runner','muted'));
      const choose=select('Saved workflow');option(choose,'','New gate workshop');for(const item of ctx.workflows().filter(item=>item.graph))option(choose,item.id,item.name);choose.value=w.id||'';choose.onchange=()=>{const found=ctx.workflows().find(item=>item.id===choose.value);ctx.setWorkflow(found?structuredClone(found):newDraft());selected=null;lastRun=null;redraw();};
      header.append(choose,button('New graph',()=>{ctx.setWorkflow(newDraft());selected=null;lastRun=null;redraw();}),button('Ordered workflows',()=>{ctx.setWorkflow({name:'',steps:[],positions:{}});redraw();}));root.append(header,h('p','Scores come from frozen, source-checked chat turns. Earlier Jev classifications are claims, not ground truth; you do not need to label or annotate turns.','recheck-note'));
      const toolbar=h('div',undefined,'gate-toolbar'),name=h('input');name.value=w.name;name.placeholder='Workflow name';name.setAttribute('aria-label','Workflow name');name.onchange=()=>w.name=name.value;
      const agent=select('Agent to add');for(const item of ctx.agents())option(agent,item.id,item.name);
      toolbar.append(name,field('Add check from agent',agent),button('+ Agent',()=>addAgent(agent.value)),button('+ AND',()=>addGate('and')),button('+ OR',()=>addGate('or')),button('+ NOT',()=>addGate('not')));
      toolbar.append(button('Save workflow',async()=>{try{w.name=name.value;ctx.setWorkflow(await api('/api/workflows',w));await ctx.refreshWorkflows();notice('Gate workflow saved with pinned agent revisions.');redraw();}catch(error){notice(error.message,true);}},'primary'));
      root.append(toolbar);
      const execution=h('section',undefined,'gate-execution'),modeBar=h('div',undefined,'gate-mode-bar');
      modeBar.append(h('strong','Graph mode'));
      for(const [id,title] of [['live','Live'],['replay','Replay']]){const control=button(title,()=>{mode=id;replayStep=0;redraw();});control.setAttribute('aria-pressed',String(mode===id));modeBar.append(control);}
      execution.append(modeBar);const executionBody=h('div',undefined,'gate-execution-body');execution.append(executionBody);root.append(execution);
      const body=h('div',undefined,'gate-layout'),canvasShell=h('div',undefined,'gate-canvas-shell'),canvas=h('div',undefined,'workflow-graph gate-canvas'),side=h('aside',undefined,'gate-side');
      const guide=h('div',undefined,'gate-canvas-guide');guide.append(h('strong',g.nodes.length===1?'Start with a Jev check':'Workflow canvas'),h('p',g.nodes.length===1?'Choose an agent above. Its typed answer can then connect to Final decision.':'Drag nodes to arrange them. Drag between ports to connect them; use the controls below to zoom.'));
      canvasShell.append(canvas,guide);body.append(canvasShell,side);root.append(body);
      disposeGraph=lib.workflowGraph(canvas,g,w.positions||{}, {label,move:(nodeId,pos)=>{w.positions[nodeId]=pos;},connect:(edge)=>connect(edge.source,edge.target),disconnect:(edge)=>{g.edges=g.edges.filter(item=>item.source!==edge.source||item.target!==edge.target);redraw();},inspect:nodeId=>{selected=nodeId;redraw();}});
      function markNode(id){for(const el of canvas.querySelectorAll('.react-flow__node')){const node=g.nodes.find(item=>item.id===el.getAttribute('data-id'));if(node?.kind==='agent')el.dataset.classification=node.predicate.type;el.classList.toggle('replay-current',el.getAttribute('data-id')===id);}}
      requestAnimationFrame(()=>markNode(null));
      const stages=run=>run?[...(run.steps||[]).map(step=>step.nodeId),...g.nodes.filter(node=>node.kind==='gate').map(node=>node.id),g.outputId].filter((id,index,all)=>all.indexOf(id)===index):[];
      function showExecution(run){
        executionBody.replaceChildren();if(!run){executionBody.append(h('p',mode==='live'?'Waiting for a saved graph run. Run the selected turn or send a call to this workflow endpoint.':'No saved run for this graph and conversation yet.','muted'));markNode(null);return;}
        const steps=stages(run),active=mode==='replay'?steps[Math.min(replayStep,steps.length-1)]:g.outputId,node=g.nodes.find(item=>item.id===active),value=run.trace?.nodes?.[active]?.value;
        const state=run.complete?value===null?'Uncertain':value===true?'Positive':value===false?'Negative':'Complete':'Error';
        executionBody.append(h('strong',`${mode==='live'?'Latest run':'Saved run'} · ${state}`),h('span',`${run.turnId||run.steps?.[0]?.results?.[0]?.turnId||'turn'} · ${run.at?new Date(run.at).toLocaleString():''}`,'muted'));
        if(!run.complete){executionBody.append(h('p',run.error||'The run did not finish.','error'));markNode(null);return;}
        if(mode==='replay'){
          const choose=select('Saved graph run');recentRuns.forEach((item,index)=>option(choose,item.id,`${new Date(item.at).toLocaleString()} · ${item.turnId||item.steps?.[0]?.results?.[0]?.turnId||'turn'}`));choose.value=run.id;choose.onchange=()=>{replayRunId=choose.value;replayStep=0;showExecution(recentRuns.find(item=>item.id===replayRunId));};executionBody.append(field('Run',choose));
          const timeline=h('div',undefined,'gate-timeline'),previous=button('← Previous',()=>{replayStep=Math.max(0,replayStep-1);showExecution(run);}),next=button('Next →',()=>{replayStep=Math.min(steps.length-1,replayStep+1);showExecution(run);}),play=button(replayTimer?'Pause':'Play',()=>{if(replayTimer){clearInterval(replayTimer);replayTimer=null;showExecution(run);return;}replayStep=0;showExecution(run);replayTimer=setInterval(()=>{replayStep++;if(replayStep>=steps.length){clearInterval(replayTimer);replayTimer=null;replayStep=steps.length-1;}showExecution(run);},900);});
          previous.disabled=replayStep===0;next.disabled=replayStep>=steps.length-1;const scrub=h('input');scrub.type='range';scrub.min='0';scrub.max=String(Math.max(0,steps.length-1));scrub.value=String(replayStep);scrub.setAttribute('aria-label','Replay graph step');scrub.oninput=()=>{replayStep=Number(scrub.value);showExecution(run);};timeline.append(previous,play,next,scrub,h('span',`${replayStep+1}/${steps.length}`));executionBody.append(timeline,h('p',`${label(node)} · ${value===null?'uncertain':value===true?'positive':value===false?'negative':'no trace'}`,'gate-stage'));
        }else executionBody.append(h('p',ctx.autoUpdates()?'Following saved runs while this page is visible. Jev runs only when you request it.':'Auto updates are off. Turn them on above to follow new saved runs; Jev checks remain manual.','muted'));
        requestAnimationFrame(()=>markNode(active));
      }
      async function loadRuns(){if(!w.id||renderRevision!==version)return;try{const data=await api(`/api/workflows/${w.id}/runs?session=${encodeURIComponent(ctx.session())}`);if(renderRevision!==version)return;recentRuns=data.runs;if(mode==='live'){lastRun=data.runs[0]||null;showExecution(lastRun);}else{const chosen=data.runs.find(item=>item.id===replayRunId)||data.runs[0]||null;replayRunId=chosen?.id||null;showExecution(chosen);}}catch(error){if(renderRevision===version)executionBody.replaceChildren(h('p',error.message,'error'));}}
      refreshRuns=w.id?loadRuns:null;if(w.id){loadRuns();syncUpdates();}else showExecution(null);
      const selectedNode=g.nodes.find(node=>node.id===selected)||g.nodes[0],inspector=h('section',undefined,'gate-inspector');side.append(inspector);if(selectedNode){selected=selectedNode.id;nodeSettings(inspector,selectedNode);}
      const connection=h('section',undefined,'gate-connect');connection.append(h('h3','Connections'),h('p','Drag between ports, or connect from these controls.','muted'));
      const from=select('Connect from'),to=select('Connect to');for(const node of g.nodes){if(node.kind!=='output')option(from,node.id,label(node));if(node.kind!=='agent')option(to,node.id,label(node));}
      connection.append(field('From',from),field('To',to),button('Connect',()=>connect(from.value,to.value)));
      for(const edge of g.edges){const row=h('div',undefined,'gate-edge-row');row.append(h('span',`${edge.source} → ${edge.target}`),button('Remove',()=>{g.edges=g.edges.filter(item=>item!==edge);redraw();}));connection.append(row);}side.append(connection);
      const projection=h('section',undefined,'gate-projection'),baseline=select('Single-agent baseline');for(const item of g.nodes.filter(item=>item.kind==='agent'))option(baseline,item.id,label(item));baseline.value=g.baselineNodeId||g.nodes.find(item=>item.kind==='agent')?.id||'';baseline.onchange=()=>{g.baselineNodeId=baseline.value;redraw();};projection.append(h('h2','What-if projection'),field('Compare gate with',baseline),numberInput('Positive cases (%)',Math.round(g.prevalence*100),0,100,1,value=>g.prevalence=value/100));const projected=h('div',undefined,'gate-projection-result');projection.append(projected);side.append(projection);
      api('/api/workflows/project',{graph:g}).then(result=>{
        if(renderRevision!==version)return;
        projected.replaceChildren(h('strong',`${pct(result.baseline.accuracy)} → ${pct(result.accuracy)} projected accuracy`),h('p',`${pct(result.baseline.sensitivity)} → ${pct(result.sensitivity)} sensitivity · ${pct(result.baseline.specificity)} → ${pct(result.specificity)} specificity`),h('p',`Change: ${(100*(result.accuracy-result.baseline.accuracy)).toFixed(1)} percentage points. ${result.assumption}`,'muted'));
        const chart=h('div',undefined,'gate-projection-chart');projected.append(chart);disposeChart=lib.chart(chart,['Accuracy','Sensitivity','Specificity'],[result.accuracy,result.sensitivity,result.specificity],[result.baseline.accuracy,result.baseline.sensitivity,result.baseline.specificity],['Single agent','Gate workflow']);
      }).catch(error=>{if(renderRevision===version)projected.replaceChildren(h('p',error.message,'warning'));});
      const saved=w.id&&ctx.workflows().find(item=>item.id===w.id),changed=saved&&JSON.stringify(saved.graph)!==JSON.stringify(g);
      if(changed)root.append(h('p','Save the edited graph to measure or run this version.','warning'));
      if(w.id&&!changed){
        root.append(h('code',`POST /api/workflows/${w.id}/run`));
        const measured=h('section',undefined,'gate-measured'),summary=h('div',undefined,'gate-measured-summary');measured.append(h('h2','Measured from saved answers'),h('p','Compare the single-agent baseline and this graph on shared frozen turns. No notes or new Jev calls are needed. Detection accuracy and effects on later assistant behavior are separate measures.','muted'),summary);
        const turn=ctx.turn();if(turn?.complete){
          measured.append(button(`Run selected turn · ${g.nodes.filter(node=>node.kind==='agent').length} Jev calls`,async()=>{try{lastRun=await api(`/api/workflows/${w.id}/run`,{sessionId:ctx.session(),turnId:turn.id,scope:ctx.scope()});ctx.onRun(lastRun);notice(lastRun.complete?'Graph ran on the selected turn.':lastRun.error||'Graph run stopped.',!lastRun.complete);redraw();}catch(error){notice(error.message,true);}}),button('Inspect source turn',ctx.inspectTurn));
        }else measured.append(h('p','Select a completed turn on Home to run it here.','muted'));
        root.append(measured);
        api(`/api/workflows/${w.id}/metrics?session=${encodeURIComponent(ctx.session())}`).then(data=>{if(renderRevision!==version)return;summary.replaceChildren(h('strong',`${data.paired}/${data.labeled} shared frozen turns paired · ${data.missing} missing · ${data.uncertain||0} uncertain`));if(data.paired)summary.append(h('p',`Measured detection accuracy: ${pct(data.baseline.correct/data.paired)} → ${pct(data.gate.correct/data.paired)} · ${((data.gate.correct-data.baseline.correct)/data.paired*100).toFixed(1)} percentage points${data.source==='frozen'?` · ${data.jointHoldout} jointly untouched holdout turns`:''}`));else summary.append(h('p','No shared fixed examples for every check. The projection above is illustrative, not a measured improvement.','muted'));const pair=h('div',undefined,'gate-metric-pair');pair.append(metricsTable('Single-agent baseline',data.baseline),metricsTable('Gate workflow',data.gate));summary.append(pair);}).catch(error=>{if(renderRevision===version)summary.replaceChildren(h('p',error.message,'error'));});
      }
      if(lastRun){const trace=h('details',undefined,'gate-trace');trace.open=true;trace.append(h('summary',`Last run · ${lastRun.complete?(lastRun.trace.output===null?'Uncertain':lastRun.trace.output?'Positive':'Negative'):'Error'}`),h('pre',JSON.stringify({trace:lastRun.trace,error:lastRun.error,steps:lastRun.steps?.map(step=>({nodeId:step.nodeId,revisionId:step.revisionId,resultId:step.results?.[0]?.id}))},null,2)));root.append(trace);}
    }
    return {render,newDraft,syncUpdates,setViewing:value=>{viewing=value;syncUpdates();}};
  };
})();
