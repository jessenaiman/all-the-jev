import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { answerValue, evaluateGraph, gateValue, validateGraph } from '../../src/gate-workflow.js';

const merge = (left, right) => ({ ...left, ...right });
const map = () => Annotation({ reducer: merge, default: () => ({}) });

// The saved graph is the authority. LangGraph executes its checks and gates; Jeview owns the run record.
export async function runWorkflow(workflow, input, evaluate, resolveQuestion) {
  if (!workflow.graph) return runOrdered(workflow, input, evaluate);
  const graph = workflow.graph, valid = validateGraph(graph, resolveQuestion);
  const State = Annotation.Root({
    answers: map(), values: map(), steps: map(),
    errors: Annotation({ reducer: (left, right) => left.concat(right), default: () => [] }),
  });
  const builder = new StateGraph(State);
  for (const node of graph.nodes) {
    if (node.kind === 'agent') builder.addNode(node.id, async () => {
      let result;
      try {
        result = await evaluate({ sessionId: input.sessionId, turnId: input.turnId, scope: input.scope, agentId: node.agentId, revisionId: node.revisionId });
        const step = { nodeId: node.id, agentId: node.agentId, questionId: node.questionId, revisionId: node.revisionId, results: [result] };
        if (result.status !== 'ok') return { steps: { [node.id]: step }, values: { [node.id]: null }, errors: [`${node.id}: ${result.error || 'Jev failed.'}`] };
        const answer = result.rawResponse?.answers?.[node.questionId];
        const value = answerValue(node, answer);
        return { answers: { [node.id]: answer }, values: { [node.id]: value }, steps: { [node.id]: step } };
      } catch (error) {
        return { values: { [node.id]: null }, ...(result ? { steps: { [node.id]: { nodeId: node.id, agentId: node.agentId, questionId: node.questionId, revisionId: node.revisionId, results: [result] } } } : {}), errors: [`${node.id}: ${error.message}`] };
      }
    });
    else builder.addNode(node.id, state => {
      const inputs = valid.incoming.get(node.id).map(id => state.values[id]);
      if (inputs.some(value => value === undefined)) return { values: { [node.id]: null }, errors: [`${node.id}: an input did not finish.`] };
      return { values: { [node.id]: node.kind === 'output' ? inputs[0] : gateValue(node.op, inputs) } };
    });
  }
  for (const node of valid.agents) builder.addEdge(START, node.id);
  for (const node of graph.nodes.filter(item => item.kind !== 'agent')) {
    const incoming = valid.incoming.get(node.id);
    builder.addEdge(incoming.length === 1 ? incoming[0] : incoming, node.id);
  }
  builder.addEdge(graph.outputId, END);
  const state = await builder.compile().invoke({});
  const steps = valid.agents.map(node => state.steps[node.id]).filter(Boolean);
  if (state.errors.length) return { runtime: 'langgraph', complete: false, steps, error: state.errors.join(' | ') };
  return { runtime: 'langgraph', complete: true, steps, trace: evaluateGraph(graph, state.answers, resolveQuestion) };
}

async function runOrdered(workflow, input, evaluate) {
  const State = Annotation.Root({
    steps: Annotation({ reducer: (left, right) => left.concat(right), default: () => [] }),
    previous: Annotation(),
    error: Annotation(),
  });
  const builder = new StateGraph(State);
  workflow.steps.forEach((step, index) => {
    const id = `step_${index}`;
    builder.addNode(id, async state => {
      if (state.error) return {};
      try {
        const result = await evaluate({ sessionId: input.sessionId, turnId: input.turnId, scope: input.scope, agentId: step.agentId, revisionId: step.revisionId, priorAnswers: state.previous });
        return { steps: [{ agentId: step.agentId, revisionId: step.revisionId, results: [result] }], previous: result.rawResponse?.answers, ...(result.status === 'ok' ? {} : { error: result.error || 'Jev failed.' }) };
      } catch (error) { return { error: error.message }; }
    });
    builder.addEdge(index ? `step_${index - 1}` : START, id);
  });
  builder.addEdge(`step_${workflow.steps.length - 1}`, END);
  const state = await builder.compile().invoke({});
  return { runtime: 'langgraph', complete: !state.error && state.steps.length === workflow.steps.length, steps: state.steps, ...(state.error ? { error: state.error } : {}) };
}
