import React from 'react';
import {createRoot} from 'react-dom/client';
import * as Switch from '@radix-ui/react-switch';
export function switchControl(parent,checked,onChange,label){
  const root=createRoot(parent);
  function Control(){const [value,setValue]=React.useState(checked);return React.createElement(Switch.Root,{className:'studio-switch',checked:value,onCheckedChange:next=>{setValue(next);onChange(next);},'aria-label':label},React.createElement(Switch.Thumb,{className:'studio-switch-thumb'}));}
  root.render(React.createElement(Control));return ()=>root.unmount();
}
