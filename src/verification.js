// Retrieval is local. Jev sees one verbatim claim and inspectable source passages.
const clean = text => String(text || '').replace(/<in-app-browser-context[\s\S]*?<\/in-app-browser-context>/g,'').replace(/## My request:/g,'').trim();
const normalize = text => String(text).replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[*`]/g,'').replace(/\s+/g,' ').trim();
const stop = new Set('that this with from have were what when where which their there they your about could would should through against only than then into been does each will says said'.split(' '));
function unwrap(text){for(let depth=0;depth<4;depth++){try{const start=text.indexOf('{'),value=JSON.parse(start>=0?text.slice(start):text);if(typeof value.output==='string'){text=value.output;continue;}if(Array.isArray(value.content)){text=value.content.filter(item=>item.type==='text').map(item=>item.text).join('\n');continue;}}catch{}break;}return text;}
export function verificationPacket(turn, {claim, evidenceLines} = {}) {
  const answer=turn.events.filter(event=>event.kind==='assistant').at(-1);
  if(!answer)throw Object.assign(Error('The selected turn has no assistant answer.'),{status:400});
  const paragraphs=clean(answer.text).split(/\n\s*\n|\n(?=- )/).filter(text=>text.trim()&&!text.startsWith('```')&&!/^#{1,6} /.test(text));
  claim=(claim || paragraphs.find(text=>!text.startsWith('|')) || '').trim();
  if(!claim || claim.length>2500 || !clean(answer.text).includes(claim))throw Object.assign(Error('Choose a verbatim claim of at most 2,500 characters from the shown answer.'),{status:400});
  const terms=[...new Set(claim.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g)||[])].filter(word=>!stop.has(word));
  const candidates=turn.events.filter(event=>event.kind==='tool-result').map(event=>{
    const text=unwrap(event.text),sections=text.split(/\n\s*\n|(?=\nL\d+:)/),rank=part=>terms.reduce((sum,word)=>sum+(part.toLowerCase().includes(word)?1:0),0);
    const ranked=sections.map((text,index)=>({text,index,score:rank(text)})).filter(part=>part.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);
    const best=ranked[0];if(!best)return null;
    let excerpt=best.text;
    if(excerpt.length>1800){const word=terms.find(word=>excerpt.toLowerCase().includes(word));const at=word?excerpt.toLowerCase().indexOf(word):0;excerpt=excerpt.slice(Math.max(0,at-450),Math.max(0,at-450)+1800);}
    return {line:event.line,at:event.at,name:event.name,score:best.score,excerpt,sourceCharacters:text.length,excerpted:excerpt.length<text.length,sourceTruncated:/\[\+\d+ chars\]|omitted\]/.test(text)};
  }).filter(Boolean).sort((a,b)=>b.score-a.score||a.line-b.line);
  const selected=Array.isArray(evidenceLines)?candidates.filter(item=>evidenceLines.includes(item.line)):candidates.slice(0,4);
  const evidence=selected.map(({score,...item})=>item);
  const requirement=clean(turn.events.find(event=>event.kind==='user')?.text).slice(0,2000);
  const state={requirement,claim,claim_source:{turnId:turn.id,line:answer.line},evidence,retrieval:{method:'local lexical passage lookup',candidateCount:candidates.length,selectedCount:evidence.length,limitations:'Selected source passages, not an exhaustive audit. Missing context must yield says_nothing.'}};
  return {state,candidates,claims:paragraphs.filter(text=>text.length<=2500),bytes:JSON.stringify(state).length,missingEvidence:!evidence.length,truncatedSource:evidence.some(item=>item.sourceTruncated),quoteFound:((claim.match(/[“"]([^“”"]{12,})[”"]/g)||[]).map(quote=>quote.slice(1,-1))).every(quote=>evidence.some(item=>normalize(item.excerpt).includes(normalize(quote))))};
}
