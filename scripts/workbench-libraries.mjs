import { EditorState } from '../prototypes/sol/node_modules/@codemirror/state/dist/index.js';
import { EditorView, basicSetup } from '../prototypes/sol/node_modules/codemirror/dist/index.js';
import { json } from '../prototypes/sol/node_modules/@codemirror/lang-json/dist/index.js';
import { markdown } from '../prototypes/sol/node_modules/@codemirror/lang-markdown/dist/index.js';
import * as echarts from '../prototypes/sol/node_modules/echarts/core.js';
import { BarChart } from '../prototypes/sol/node_modules/echarts/charts.js';
import { GridComponent, TooltipComponent, LegendComponent, AriaComponent } from '../prototypes/sol/node_modules/echarts/components.js';
import { CanvasRenderer } from '../prototypes/sol/node_modules/echarts/renderers.js';
import React from '../prototypes/luna/node_modules/react/index.js';
import { createRoot } from '../prototypes/luna/node_modules/react-dom/client.js';
import { ReactFlow, Background, Controls, Handle, Position, applyNodeChanges, applyEdgeChanges, MiniMap, MarkerType } from '../prototypes/luna/node_modules/@xyflow/react/dist/esm/index.js';
import '../prototypes/luna/node_modules/@xyflow/react/dist/style.css';

echarts.use([BarChart,GridComponent,TooltipComponent,LegendComponent,AriaComponent,CanvasRenderer]);
const dark=EditorView.theme({ '&':{color:'#e6e4df',backgroundColor:'#151515'},'.cm-content':{fontFamily:'Consolas, monospace',fontSize:'12px'},'.cm-gutters':{backgroundColor:'#1d1d1d',color:'#8c8c88',border:'none'},'.cm-activeLine':{backgroundColor:'#24221f'},'.cm-activeLineGutter':{backgroundColor:'#24221f'},'&.cm-focused .cm-cursor':{borderLeftColor:'#ff9458'},'.cm-selectionBackground':{backgroundColor:'#42403a !important'},'.cm-scroller':{overflow:'auto',maxHeight:'45vh'}},{dark:true});
export function editor(parent,source,onChange,readOnly=false){const view=new EditorView({parent,doc:source,extensions:[basicSetup,EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly),source.trim().startsWith('{')?json():markdown(),dark,EditorView.lineWrapping,EditorView.updateListener.of(u=>{if(u.docChanged)onChange(u.state.doc.toString());})]});return{value:()=>view.state.doc.toString(),destroy:()=>view.destroy()};}
export function chart(parent,labels,current,previous,seriesNames=['Previous','Current']){const c=echarts.init(parent,null,{renderer:'canvas'});c.setOption({animationDuration:250,aria:{enabled:true},tooltip:{trigger:'axis',valueFormatter:v=>(v*100).toFixed(1)+'%'},legend:{textStyle:{color:'#aaa'},bottom:0},grid:{left:10,right:30,top:10,bottom:42,containLabel:true},xAxis:{type:'value',min:0,max:1,axisLabel:{color:'#999',formatter:v=>v*100+'%'},splitLine:{lineStyle:{color:'#292929'}}},yAxis:{type:'category',data:labels,inverse:true,axisLabel:{color:'#ccc',width:130,overflow:'truncate'},axisTick:{show:false}},series:[...(previous?[{name:seriesNames[0],type:'bar',data:previous,itemStyle:{color:'#ae91df'},barMaxWidth:12}]:[]),{name:seriesNames[1],type:'bar',data:current,itemStyle:{color:'#64cbd0'},barMaxWidth:12}]});const resize=new ResizeObserver(()=>c.resize());resize.observe(parent);return()=>{resize.disconnect();c.dispose();};}
export function workflow(parent,steps,positions,onMove,onConnect,onInspect){const root=createRoot(parent);function Graph(){const [nodes,setNodes]=React.useState(steps.map((s,i)=>({id:String(i),position:positions[String(i)]||{x:70+i*250,y:130+(i%2)*90},data:{label:s.name},style:{background:'#1b1b1b',color:'#eee',border:'1px solid #805037',borderRadius:12,width:190,padding:16}})));const edges=steps.slice(1).map((_,i)=>({id:'e'+i,source:String(i),target:String(i+1),animated:true,style:{stroke:'#cf7a45'}}));return React.createElement(ReactFlow,{nodes,edges,colorMode:'dark',fitView:true,onNodesChange:changes=>setNodes(nds=>applyNodeChanges(changes,nds)),onNodeDragStop:(_,node)=>onMove(node.id,node.position),onConnect,onNodeClick:(_,node)=>onInspect(Number(node.id)),minZoom:0.2,maxZoom:2},React.createElement(Background,{color:'#333',gap:24}),React.createElement(Controls,{}));}root.render(React.createElement(Graph));return()=>root.unmount();}

export function workflowGraph(parent,graph,positions,callbacks){
  const root=createRoot(parent);
  function GateNode({data}){
    if(callbacks.presentation){const p=callbacks.presentation(data.node);return React.createElement('div',{tabIndex:0,role:'button','aria-label':p.title,onKeyDown:event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();callbacks.inspect(data.node.id);}},className:'studio-node '+(p.tone||'neutral')+(callbacks.selected===data.node.id?' is-selected':'')},
      React.createElement(Handle,{type:'target',position:data.node.targetSide==='top'?Position.Top:data.node.targetSide==='right'?Position.Right:Position.Left,className:'studio-handle'}),
      React.createElement('div',{className:'studio-node-kind'},React.createElement('img',{src:window.WorkflowIcons?.[p.icon+'-light']||'/_/ui/vendor/icons/'+p.icon+'-light.svg',alt:'',className:'studio-icon'}),p.kind),
      React.createElement('strong',null,p.title),React.createElement('div',{className:'studio-node-bottom'},React.createElement('span',{className:'studio-node-status'},p.status),p.detail?React.createElement('code',null,p.detail):null),
      React.createElement(Handle,{type:'source',position:data.node.sourceSide==='bottom'?Position.Bottom:data.node.sourceSide==='left'?Position.Left:Position.Right,className:'studio-handle'}));}
    const tone=callbacks.colorMode==='dark'?(data.kind==='agent'?'#edaa70':data.kind==='gate'?'#6bc2bd':'#8acaa2'):(data.kind==='agent'?'#a44b20':data.kind==='gate'?'#14666b':'#236f4d');
    return React.createElement('div',{className:'gate-flow-node',style:{borderColor:tone}},
      data.kind!=='agent'?React.createElement(Handle,{type:'target',position:Position.Left,style:{background:tone,width:16,height:16,border:`3px solid ${callbacks.colorMode==='dark'?'#222625':'#fff'}`}}):null,
      React.createElement('span',{className:'gate-flow-kind'},data.kind==='gate'?data.op.toUpperCase():data.kind),
      React.createElement('strong',null,data.label),
      data.kind!=='output'?React.createElement(Handle,{type:'source',position:Position.Right,style:{background:tone,width:16,height:16,border:`3px solid ${callbacks.colorMode==='dark'?'#222625':'#fff'}`}}):null);
  }
  const nodeTypes={agent:GateNode,gate:GateNode,output:GateNode};
  function Graph(){
    const [nodes,setNodes]=React.useState(graph.nodes.map((node,i)=>({id:node.id,type:node.kind,position:positions[node.id]||{x:70+(i%3)*255,y:90+Math.floor(i/3)*150},data:{node,kind:node.kind,op:node.op,label:callbacks.label(node)},deletable:!callbacks.presentation,connectable:!callbacks.presentation})));
    const [edges,setEdges]=React.useState(graph.edges.map((edge,i)=>({id:`${edge.source}-${edge.target}-${i}`,source:edge.source,target:edge.target,type:callbacks.presentation?'smoothstep':'default',markerEnd:callbacks.presentation?{type:MarkerType.ArrowClosed,color:'#7e8c9f',width:16,height:16}:undefined,animated:false,label:edge.label,style:{stroke:callbacks.presentation?'#76818d':'#315f5d',strokeWidth:callbacks.presentation?1.5:3,strokeDasharray:edge.planned?'5 5':undefined},labelStyle:{fill:'#b9c1cc',fontSize:14},labelBgStyle:{fill:'#191e26'},deletable:!callbacks.presentation})));
    return React.createElement(ReactFlow,{nodes,edges,nodeTypes,colorMode:callbacks.colorMode||'light',fitView:true,fitViewOptions:{padding:callbacks.presentation?0.12:0.2,maxZoom:callbacks.presentation?1:1.5,minZoom:callbacks.presentation?0.5:0.2},minZoom:0.2,maxZoom:2,onInit:instance=>callbacks.ready?.(instance),nodesConnectable:!callbacks.presentation,
      onNodesChange:changes=>setNodes(current=>applyNodeChanges(changes,current)),
      onEdgesChange:changes=>setEdges(current=>applyEdgeChanges(changes,current)),
      onNodeDragStop:(_,node)=>callbacks.move(node.id,node.position),
      onConnect:edge=>callbacks.connect({source:edge.source,target:edge.target}),
      onEdgesDelete:removed=>removed.forEach(edge=>callbacks.disconnect({source:edge.source,target:edge.target})),
      onNodeClick:(_,node)=>callbacks.inspect(node.id)},
      React.createElement(Background,{color:callbacks.presentation?'#3b4350':callbacks.colorMode==='dark'?'#39433d':'#d4d8d1',gap:24,size:1}),React.createElement(Controls,{showInteractive:!callbacks.presentation}),callbacks.presentation?React.createElement(MiniMap,{nodeColor:'#535e70',maskColor:'#161b2480',pannable:true,zoomable:true}):null);
  }
  root.render(React.createElement(Graph));
  return()=>root.unmount();
}
