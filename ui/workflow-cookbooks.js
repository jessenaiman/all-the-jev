(() => {
  'use strict';
  // Group the user's saved definitions by their actual execution shape.
  // These headings borrow the cookbook taxonomy; they do not claim to install its demos.
  const groupFor=workflow=>{
    if(workflow.kind==='tool-router')return 'How-to · tool selection';
    if(['ui-requirements','typesafe-skill'].includes(workflow.graph?.reviewKind))return 'Batching · independent checks';
    if(workflow.graph?.nodes.some(node=>node.questionId==='relation'))return 'How-to · evidence verification';
    if(workflow.graph)return 'Classification · decision graphs';
    return 'My workflows · ordered steps';
  };
  window.WorkflowCookbooks={fill(select,workflows,h,option){
    const groups=new Map();
    for(const workflow of workflows){const key=groupFor(workflow);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(workflow);}
    for(const [label,items] of groups){const group=h('optgroup');group.label=label;for(const workflow of items)option(group,workflow.id,workflow.name);select.append(group);}
    select.title='Saved workflows grouped by purpose · TypeSafe cookbook categories';
  }};
})();
