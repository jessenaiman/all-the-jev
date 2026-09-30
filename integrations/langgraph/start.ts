import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createJeview } from '../../src/jeview.ts';

try { process.loadEnvFile(new URL('../../.env', import.meta.url)); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
// LangSmith export is opt-in nowhere in Jeview; selected evidence stays local until a manual model request.
process.env.LANGSMITH_TRACING = 'false';
const [{ runWorkflow }, { discussWithAgent }] = await Promise.all([import('./workflow.js'), import('./review-agent.js')]);
const { values } = parseArgs({ options: { port: { type: 'string', default: '4777' }, dir: { type: 'string', default: join(homedir(), '.local/share/jeview') }, 'jev-endpoint': { type: 'string' } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Usage: node integrations/langgraph/start.ts [--port 4777] [--dir PATH] [--jev-endpoint URL]');
const { server, store } = createJeview({ dir: values.dir, port, envKey: process.env.OPENROUTER_API_KEY, chatKey: process.env.OPENROUTER_API_KEY, chatModel: process.env.OPENROUTER_CHAT_MODEL, workflowRunner: runWorkflow, discussionRunner: discussWithAgent, ...(values['jev-endpoint'] ? { jevEndpoint: values['jev-endpoint'] } : {}) });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { server.close(); process.exit(0); });
server.on('error', (error: NodeJS.ErrnoException) => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the existing Jeview or choose another port.` : `Jeview LangGraph could not start: ${error.message}`); process.exit(1); });
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ viewer: `http://127.0.0.1:${port}/`, runtime: 'LangGraph + LangChain', jev_key: store.setting('jevKey') ? 'set' : 'not set', database: store.database })));
