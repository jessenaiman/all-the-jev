(() => {
  const session='01a0ee8f-8a52-7f01-8392-b3cc08e01a1b';
  const h=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
  const toggle=h('button','This conversation');toggle.id='history-toggle';
  document.querySelector('.brand').append(toggle);
  const panel=h('section');panel.id='conversation-panel';panel.hidden=true;panel.setAttribute('aria-label','Historical conversation');
  const header=h('header');header.append(h('strong','This conversation · historical turns'));
  const close=h('button','Hide details');close.onclick=()=>content.hidden=true;header.append(close);panel.append(header);
  const status=h('div');status.id='history-status';panel.append(status);
  const grid=h('div');grid.id='conversation-grid';const list=h('nav');list.id='conversation-list';list.setAttribute('aria-label','Select a turn');const content=h('article');content.id='conversation-content';grid.append(list,content);panel.append(grid);document.body.append(panel);
  let source='',selected=null;
  const request=async(path,body)=>{const r=await fetch(path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data;};
  function show(turn,button){
    selected=turn;content.hidden=false;for(const b of list.children)b.setAttribute('aria-pressed',String(b===button));content.replaceChildren();
    content.append(h('h2',turn.at?new Date(turn.at).toLocaleString():'Recorded turn'),h('p',`${turn.id} · source lines ${turn.fromLine}–${turn.toLine} · ${turn.complete?'Completed':turn.aborted?'Interrupted':'In progress'}`));
    content.append(h('p','Actual recorded messages. No classification has been inferred or fabricated.'));
    const messages=turn.events.filter(e=>e.kind==='user'||e.kind==='assistant');
    for(const e of messages){const readable=e.text.replace(/<in-app-browser-context[\s\S]*?<\/in-app-browser-context>/g,'').replace(/## My request:/g,'').trim();content.append(h('h3',`${e.kind} · line ${e.line}`),h('pre',readable));}
    const tools=turn.events.filter(e=>e.kind==='tool'||e.kind==='tool-result');
    const evidence=h('details');evidence.append(h('summary',`Tool evidence · ${tools.length} displayed events`));for(const e of tools)evidence.append(h('h3',`${e.name||e.kind} · line ${e.line}`),h('pre',e.text));content.append(evidence);
    if(turn.eventCount>turn.events.length)content.append(h('p',`Showing the last ${turn.events.length} of ${turn.eventCount} events. This display is incomplete.`));
    const editorDetails=h('details');editorDetails.append(h('summary','Review agent · edit classification config'));const editor=h('textarea');editor.setAttribute('aria-label','Review agent config');editor.value=source;editor.onchange=()=>source=editor.value;editorDetails.append(editor);content.append(editorDetails);
    const run=h('button','Run Jev on this turn');run.disabled=!turn.complete||turn.aborted;content.append(run);
    const result=h('div');result.className='result';result.append(h('p','No Jev result yet. Run sends only this selected turn’s user and assistant messages.'));content.append(result);
    run.onclick=async()=>{run.disabled=true;result.replaceChildren(h('p','Running Jev on the selected turn…'));try{source=editor.value;const data=await request('/api/jev/evaluate',{sessionId:session,turnIds:[turn.id],scope:'messages',source});for(const item of data.results)result.append(h('pre',item.status==='ok'?JSON.stringify(item.rawResponse,null,2):item.error));result.firstChild.textContent='Provider response';}catch(e){result.replaceChildren(h('p',e.message));}finally{run.disabled=false;}};
  }
  async function load(){panel.hidden=false;status.textContent='Loading only this selected conversation…';try{const data=await request('/api/history/turns?session='+session);source=(await request('/api/review-source')).source;list.replaceChildren();const turns=data.turns.slice(-20).reverse();status.textContent=`${turns.length} recorded turns shown · this conversation only · no provider calls made by loading`;for(const turn of turns){const user=turn.events.find(e=>e.kind==='user');const text=(user?.text||'Turn with recorded tool activity').replace(/<in-app-browser-context[\s\S]*?<\/in-app-browser-context>/g,'').replace(/## My request:/g,'').trim();const button=h('button',`${turn.complete?'●':'○'} ${text.slice(0,125)}\n${new Date(turn.at).toLocaleTimeString()}`);button.onclick=()=>show(turn,button);list.append(button);}if(turns.length)show(turns[0],list.firstChild);else content.replaceChildren(h('p','No recorded turns found.'));}catch(e){status.textContent=e.message;content.replaceChildren(h('p','Historical data service is unavailable. No mock data is substituted.'));}}
  toggle.onclick=load;
  if(location.port==='4782')load();
})();
