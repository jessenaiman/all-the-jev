(() => {
  'use strict';
  const terms={
    'system one': ['Models that turn state and typed questions into structured decisions that code can use directly. They do not generate repair text.', 'concepts/system-one'],
    choice: ['Selects one authored option and returns its probability distribution. Several valid options can spread the distribution.', 'primitives/choice'],
    noul: ['Returns the probability that a condition is true. Near 0.5 means similar probability for yes and no; it has no separate confidence field.', 'primitives/noul'],
    score: ['Returns a probability-weighted position on authored, ordered levels, plus a distribution and confidence.', 'primitives/score'],
    confidence: ['For Choice and Score, describes concentration in the answer distribution. It does not prove correctness, authorize an action, or verify a fix.', 'confidence'],
    state: ['The relevant facts supplied to the questions. Use bounded named fields; previous model answers are judgments, not observed facts.', 'concepts/state'],
    criteria: ['The authored answer meanings: options for Choice, ordered levels for Score, and optional yes/no descriptions for Noul.', 'primitives'],
    questions: ['Typed judgments evaluated against state. Independent questions can share one request; they cannot see each other’s answers.', 'api'],
    instructions: ['Describe the judgment to make and the state fields to examine. Jev evaluates them; application code performs actions.', 'concepts/how-to-build-with-system-one']
  };
  const pattern=/\b(system one|choice|noul|score|confidence|state|criteria|questions|instructions)\b/gi;
  let popup=null,hideTimer=null;
  function hide(){popup?.remove();popup=null;}
  function show(el){clearTimeout(hideTimer);hide();const [text,path]=terms[el.textContent.toLowerCase()];popup=document.createElement('aside');popup.className='jev-definition';popup.setAttribute('role','tooltip');const content=document.createElement('p');content.textContent=text;const link=document.createElement('a');link.textContent='TypeSafe documentation ↗';link.href='https://docs.typesafe.ai/'+path;link.target='_blank';link.rel='noopener noreferrer';popup.append(content,link);document.body.append(popup);const r=el.getBoundingClientRect();popup.style.left=Math.max(8,Math.min(r.left,innerWidth-340))+'px';popup.style.top=(r.bottom+popup.offsetHeight+12<innerHeight?r.bottom+8:Math.max(8,r.top-popup.offsetHeight-8))+'px';popup.onpointerenter=()=>clearTimeout(hideTimer);popup.onpointerleave=()=>hideTimer=setTimeout(hide,200);}
  function decorate(root){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),texts=[];let node;
    while(node=walker.nextNode())if(node.parentElement&&!node.parentElement.closest('script,style,pre,code,textarea,input,select,button,a,.jev-term,.jev-definition,[contenteditable],svg'))texts.push(node);
    for(const text of texts){pattern.lastIndex=0;if(!pattern.test(text.nodeValue))continue;pattern.lastIndex=0;const fragment=document.createDocumentFragment();let end=0;for(const match of text.nodeValue.matchAll(pattern)){fragment.append(document.createTextNode(text.nodeValue.slice(end,match.index)));const term=document.createElement('span');term.className='jev-term';term.tabIndex=0;term.textContent=match[0];term.setAttribute('aria-label',match[0]+': '+terms[match[0].toLowerCase()][0]);term.onpointerenter=term.onfocus=()=>show(term);term.onpointerleave=term.onblur=()=>hideTimer=setTimeout(hide,250);term.onkeydown=event=>{if(event.key==='Escape')hide();};fragment.append(term);end=match.index+match[0].length;}fragment.append(document.createTextNode(text.nodeValue.slice(end)));text.replaceWith(fragment);}
  }
  let pending=false;
  const observer=new MutationObserver(changes=>{if(pending||changes.every(c=>c.target.closest?.('.jev-term,.jev-definition')||[...c.addedNodes].every(n=>n.nodeType===3||n.classList?.contains('jev-term')||n.classList?.contains('jev-definition'))))return;pending=true;requestAnimationFrame(()=>{pending=false;decorate(document.body);});});
  decorate(document.body);observer.observe(document.body,{childList:true,subtree:true});
})();
