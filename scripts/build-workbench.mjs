import { build } from '../prototypes/sol/node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';
await build({entryPoints:[fileURLToPath(new URL('./workbench-libraries.mjs',import.meta.url))],outfile:fileURLToPath(new URL('../ui/vendor/workbench.js',import.meta.url)),bundle:true,format:'iife',globalName:'ObserverLibraries',platform:'browser',minify:true,define:{'process.env.NODE_ENV':'"production"'},legalComments:'linked'});
