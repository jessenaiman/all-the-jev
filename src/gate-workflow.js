// Gate math is kept separate from Jev calls so a saved answer can be rescored.
const bad = message => { throw Object.assign(Error(message),{status:400}); };
const rate = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

export function validateGraph(graph, resolveQuestion) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length < 2 || graph.nodes.length > 20) bad('A gate graph needs 2–20 nodes.');
  if (!rate(graph.prevalence)) bad('Set an illustrative positive-case prevalence from 0 to 1.');
  const byId = new Map();
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== 'string' || !/^[a-zA-Z][\w-]{0,79}$/.test(node.id) || byId.has(node.id)) bad('Every graph node needs a unique ID.');
    if (!['agent','gate','output'].includes(node.kind)) bad(`Unknown graph node ${node.id}.`);
    byId.set(node.id,node);
  }
  const agents = graph.nodes.filter(node => node.kind === 'agent');
  if (!agents.length || agents.length > 10) bad('Use 1–10 agent checks in a gate graph.');
  if(graph.baselineNodeId && !agents.some(node=>node.id===graph.baselineNodeId))bad('Select an agent node for the single-agent baseline.');
  const outputs = graph.nodes.filter(node => node.kind === 'output');
  if (outputs.length !== 1 || graph.outputId !== outputs[0].id) bad('Connect exactly one final output.');
  for (const node of agents) {
    if (typeof node.agentId !== 'string' || !Number.isInteger(node.revisionId) || typeof node.questionId !== 'string') bad(`Pin an agent, revision, and question for ${node.id}.`);
    if (!rate(node.assumption?.sensitivity) || !rate(node.assumption?.specificity)) bad(`Set illustrative sensitivity and specificity for ${node.id}.`);
    const q = resolveQuestion?.(node);
    if (resolveQuestion && !q) bad(`The pinned question for ${node.id} is unavailable.`);
    const p = node.predicate;
    if (!p || !['noul','choice','score'].includes(p.type) || (q && p.type !== q.type)) bad(`Predicate for ${node.id} must match its Jev question.`);
    if (p.type === 'noul' && !rate(p.threshold)) bad(`Noul ${node.id} needs a threshold from 0 to 1.`);
    if (p.type === 'choice' && (typeof p.option !== 'string' || (q && !Object.hasOwn(q.criteria || {},p.option)))) bad(`Choice ${node.id} needs one authored option.`);
    if (p.abstainOptions !== undefined && (p.type !== 'choice' || !Array.isArray(p.abstainOptions) || p.abstainOptions.some(option => typeof option !== 'string' || option === p.option || (q && !Object.hasOwn(q.criteria || {},option))))) bad(`Choice ${node.id} has invalid uncertain options.`);
    if (p.type === 'score' && (typeof p.threshold !== 'number' || !Number.isFinite(p.threshold) || p.threshold < 0 || (q && p.threshold > q.criteria.length-1))) bad(`Score ${node.id} needs a threshold on its authored scale.`);
  }
  for (const node of graph.nodes.filter(item => item.kind === 'gate')) if (!['and','or','not'].includes(node.op)) bad(`Gate ${node.id} must be AND, OR, or NOT.`);
  const incoming = new Map(graph.nodes.map(node => [node.id,[]]));
  const outgoing = new Map(graph.nodes.map(node => [node.id,[]]));
  const seen = new Set();
  for (const edge of graph.edges) {
    if (!byId.has(edge?.source) || !byId.has(edge?.target) || edge.source === edge.target) bad('Every connection needs two distinct existing nodes.');
    const key=`${edge.source}\0${edge.target}`;
    if (seen.has(key)) bad('Duplicate graph connection.');
    seen.add(key);incoming.get(edge.target).push(edge.source);outgoing.get(edge.source).push(edge.target);
  }
  for (const node of graph.nodes) {
    const count=incoming.get(node.id).length;
    if (node.kind === 'agent' && count !== 0) bad(`Agent ${node.id} cannot have incoming connections; checks observe the same turn.`);
    if (node.kind === 'gate' && count < (node.op === 'not' ? 1 : 2)) bad(`${node.op.toUpperCase()} gate ${node.id} needs ${node.op === 'not' ? 'one input' : 'at least two inputs'}.`);
    if (node.kind === 'gate' && node.op === 'not' && count !== 1) bad(`NOT gate ${node.id} needs exactly one input.`);
    if (node.kind === 'output' && (count !== 1 || outgoing.get(node.id).length)) bad('The final output needs one input and no outgoing connection.');
  }
  const ready=graph.nodes.filter(node => !incoming.get(node.id).length).map(node => node.id),order=[];
  const remaining=new Map(graph.nodes.map(node => [node.id,incoming.get(node.id).length]));
  while (ready.length) {const id=ready.shift();order.push(id);for(const to of outgoing.get(id)){remaining.set(to,remaining.get(to)-1);if(!remaining.get(to))ready.push(to);}}
  if (order.length !== graph.nodes.length) bad('The gate graph has a cycle.');
  const reachable=new Set([graph.outputId]),stack=[graph.outputId];
  while(stack.length)for(const from of incoming.get(stack.pop()))if(!reachable.has(from)){reachable.add(from);stack.push(from);}
  if (reachable.size !== graph.nodes.length) bad('Connect every node to the final output.');
  return {byId,incoming,order,agents,outputId:graph.outputId,prevalence:graph.prevalence};
}

export function gateValue(op,input) {
  if(op==='and')return input.includes(false)?false:input.every(value=>value===true)?true:null;
  if(op==='or')return input.includes(true)?true:input.every(value=>value===false)?false:null;
  if(op==='not')return input[0]===null?null:!input[0];
  bad(`Unknown gate ${op}.`);
}

export function answerValue(node,answer) {
  const p=node.predicate;
  if(!answer || answer.type!==p.type)bad(`Missing ${p.type} answer for ${node.id}.`);
  if(p.type==='noul'&&!rate(answer.noul))bad(`Invalid Noul answer for ${node.id}.`);
  if(p.type==='choice'&&typeof answer.choice!=='string')bad(`Invalid Choice answer for ${node.id}.`);
  if(p.type==='score'&&(!Number.isFinite(answer.score)||answer.score<0))bad(`Invalid Score answer for ${node.id}.`);
  return p.type==='noul'?answer.noul>=p.threshold:p.type==='choice'?p.abstainOptions?.includes(answer.choice)?null:answer.choice===p.option:answer.score>=p.threshold;
}

function resolve(valid,values) {
  const output={};
  for(const id of valid.order){
    const node=valid.byId.get(id);
    if(node.kind==='agent')output[id]=values[id] ?? null;
    else {
      const input=valid.incoming.get(id).map(from=>output[from]);
      output[id]=node.kind==='output'?input[0]:gateValue(node.op,input);
    }
  }
  return output;
}

export function projectGraph(graph,resolveQuestion) {
  const valid=validateGraph(graph,resolveQuestion), agents=valid.agents;
  let sensitivity=0,falsePositive=0;
  for(let mask=0;mask<2**agents.length;mask++){
    const bits={},positive=[],negative=[];
    agents.forEach((node,i)=>{
      const yes=!!(mask & (1<<i)),s=node.assumption.sensitivity,f=1-node.assumption.specificity;
      bits[node.id]=yes;positive.push(yes?s:1-s);negative.push(yes?f:1-f);
    });
    if(resolve(valid,bits)[valid.outputId]){
      sensitivity+=positive.reduce((a,b)=>a*b,1);
      falsePositive+=negative.reduce((a,b)=>a*b,1);
    }
  }
  const specificity=1-falsePositive,p=valid.prevalence,baseline=agents.find(node=>node.id===graph.baselineNodeId)||agents[0],first=baseline.assumption;
  return {sensitivity,specificity,accuracy:p*sensitivity+(1-p)*specificity,prevalence:p,baseline:{nodeId:baseline.id,sensitivity:first.sensitivity,specificity:first.specificity,accuracy:p*first.sensitivity+(1-p)*first.specificity},assumption:'Agent errors are conditionally independent given the true outcome.'};
}

export function evaluateGraph(graph,answers,resolveQuestion) {
  const valid=validateGraph(graph,resolveQuestion),bits={},trace={};
  for(const node of valid.agents){
    const answer=answers?.[node.id],value=answerValue(node,answer);
    bits[node.id]=value;
    trace[node.id]={kind:'agent',value,questionId:node.questionId,answer};
  }
  const values=resolve(valid,bits);
  for(const id of valid.order)if(!trace[id])trace[id]={kind:valid.byId.get(id).kind,value:values[id],inputs:valid.incoming.get(id)};
  return {output:values[valid.outputId],nodes:trace};
}
