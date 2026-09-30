export type AvailableTool = { id: string; description: string };
export type ToolRoute = {
  id: string;
  label: string;
  when: string;
  toolId: string;
  instructionId: string;
  instruction: string;
  minConfidence?: number;
};
export type ToolInstructionWorkflow = {
  id: string;
  name: string;
  minConfidence: number;
  routes: ToolRoute[];
};

type RouteQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> };
export type CompiledToolWorkflow = {
  workflowId: string;
  task: string;
  minConfidence: number;
  routes: ToolRoute[];
  request: { model: 'jev-latest'; state: string; questions: { route: RouteQuestion } };
};
export type ToolHandoff = {
  workflowId: string;
  routeId: string;
  toolId: string;
  instructionId: string;
  instruction: string;
  task: string;
  confidence: number;
  selectedProbability: number | null;
};
type RouteResult = { status: 'ready'; handoff: ToolHandoff } | { status: 'review' | 'invalid'; reason: string; routeId?: string; confidence?: number };

const routeId = /^[a-z][a-z0-9_-]{0,79}$/;
const workflowId = /^(?:[a-z][a-z0-9_-]{0,79}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const validText = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const probability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const invalid = (message: string): never => { throw Error(message); };

/** The model sees route descriptions; authored tool calls and instructions stay with the host. */
export function compileToolInstructionWorkflow(workflow: ToolInstructionWorkflow, task: string, availableTools: AvailableTool[]): CompiledToolWorkflow {
  if (!workflow || !workflowId.test(workflow.id) || !validText(workflow.name, 120)) invalid('Name the workflow with a valid ID.');
  if (!probability(workflow.minConfidence)) invalid('Set a confidence threshold from 0 to 1.');
  if (!Array.isArray(workflow.routes) || workflow.routes.length < 1 || workflow.routes.length > 50) invalid('A workflow needs 1–50 routes.');
  if (!validText(task, 12000)) invalid('Supply a bounded task of at most 12,000 characters.');
  if (!Array.isArray(availableTools)) invalid('Supply the current tool catalog.');
  const catalog = new Map<string, string>();
  for (const tool of availableTools) {
    if (!tool || !validText(tool.id, 120) || !validText(tool.description, 500) || catalog.has(tool.id)) invalid('The current tool catalog needs unique IDs and descriptions.');
    catalog.set(tool.id, tool.description);
  }
  const seen = new Set<string>();
  for (const route of workflow.routes) {
    if (!route || !routeId.test(route.id) || route.id === 'none' || seen.has(route.id)) invalid('Routes need unique IDs; "none" is reserved.');
    seen.add(route.id);
    if (!validText(route.label, 120) || !validText(route.when, 500) || !validText(route.toolId, 120) || !validText(route.instructionId, 120) || !validText(route.instruction, 5000)) invalid(`Complete tool and instruction details for ${route.id}.`);
    if (route.minConfidence !== undefined && !probability(route.minConfidence)) invalid(`Invalid confidence threshold for ${route.id}.`);
  }
  const routes = workflow.routes.filter(route => catalog.has(route.toolId)).map(route => ({ ...route }));
  if (!routes.length) invalid('No workflow route has an available tool.');
  const criteria: Record<string, string> = {};
  for (const route of routes) criteria[route.id] = `${route.label}. ${route.when} Available tool: ${route.toolId} — ${catalog.get(route.toolId)}.`;
  criteria.none = 'No available route fits the task, or the request needs clarification before choosing a tool.';
  return {
    workflowId: workflow.id,
    task: task.trim(),
    minConfidence: workflow.minConfidence,
    routes,
    request: {
      model: 'jev-latest',
      state: task.trim(),
      questions: { route: { type: 'choice', instructions: 'Which single available route should handle this task first? Choose none if the task does not fit or needs clarification.', criteria } },
    },
  };
}

/** A Jev answer is only a key. Resolve it against the compiled routes and current capabilities. */
export function resolveToolInstruction(compiled: CompiledToolWorkflow, response: unknown, currentTools: AvailableTool[]): RouteResult {
  const answer = response && typeof response === 'object' && 'answers' in response && response.answers && typeof response.answers === 'object' && 'route' in response.answers ? response.answers.route : null;
  if (!answer || typeof answer !== 'object' || !('type' in answer) || answer.type !== 'choice' || !('choice' in answer) || typeof answer.choice !== 'string') return { status: 'invalid', reason: 'Jev did not return a Choice route.' };
  const choice = answer.choice;
  if (choice === 'none') return { status: 'review', reason: 'Jev found no suitable route or needs clarification.', routeId: choice };
  const route = compiled.routes.find(item => item.id === choice);
  if (!route) return { status: 'invalid', reason: 'Jev selected a route outside the offered choices.', routeId: choice };
  const confidence = 'confidence' in answer ? answer.confidence : null;
  if (!probability(confidence)) return { status: 'invalid', reason: 'Jev did not return valid Choice confidence.', routeId: choice };
  if (confidence < (route.minConfidence ?? compiled.minConfidence)) return { status: 'review', reason: 'Route confidence is below its action threshold.', routeId: choice, confidence };
  if (!Array.isArray(currentTools) || !currentTools.some(tool => tool?.id === route.toolId)) return { status: 'review', reason: 'The selected tool is no longer available.', routeId: choice, confidence };
  const spread = 'probabilities' in answer && answer.probabilities && typeof answer.probabilities === 'object' ? answer.probabilities as Record<string, unknown> : {};
  const selectedProbability = probability(spread[choice]) ? spread[choice] : null;
  return {
    status: 'ready',
    handoff: { workflowId: compiled.workflowId, routeId: route.id, toolId: route.toolId, instructionId: route.instructionId, instruction: route.instruction, task: compiled.task, confidence, selectedProbability },
  };
}

/** The host owns the model call and delivery; this module never executes a model-selected command. */
export async function runToolInstructionWorkflow<T>(args: {
  workflow: ToolInstructionWorkflow;
  task: string;
  availableTools: AvailableTool[];
  decide: (request: CompiledToolWorkflow['request']) => Promise<unknown>;
  deliver: (handoff: ToolHandoff) => Promise<T>;
  currentTools?: () => AvailableTool[];
}): Promise<RouteResult | { status: 'delivered'; handoff: ToolHandoff; delivery: T; request: CompiledToolWorkflow['request'] }> {
  const compiled = compileToolInstructionWorkflow(args.workflow, args.task, args.availableTools);
  const response = await args.decide(compiled.request);
  const result = resolveToolInstruction(compiled, response, args.currentTools?.() ?? args.availableTools);
  if (result.status !== 'ready') return result;
  const delivery = await args.deliver(result.handoff);
  return { status: 'delivered', handoff: result.handoff, delivery, request: compiled.request };
}
