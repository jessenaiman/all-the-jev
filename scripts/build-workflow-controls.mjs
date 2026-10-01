import {build} from 'esbuild';
await build({entryPoints:['scripts/workflow-controls.mjs'],outfile:'ui/vendor/workflow-controls.js',bundle:true,format:'iife',globalName:'WorkflowControls',platform:'browser',minify:true,define:{'process.env.NODE_ENV':'"production"'},legalComments:'linked'});
