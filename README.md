# all-the-jev

> Agents: [llms.txt](llms.txt) says how to use a running all-the-jev, and [AGENTS.md](AGENTS.md) how to work on this repository.

An unofficial local visualizer for Jev ([TypeSafe](https://typesafe.ai) System One): a live view of every call your code
makes, plus turn-level agent and workflow evaluation. all-the-jev is independent of TypeSafe AI.

```
your code  →  all-the-jev (127.0.0.1:4777)  →  Jev through the configured System One endpoint
```

all-the-jev is a gateway: it sits between your code and Jev and answers nothing itself. Point your Jev client at
all-the-jev instead of the upstream endpoint. all-the-jev sends each request on to Jev with your key, hands Jev's answer back, keeps every
call in a local SQLite database, and draws the calls on a live map as they happen.

![A made-up support inbox that Jev triages, beside all-the-jev drawing each call as it happens](docs/side-by-side.png)

## Run it

Needs Node 24 or later, and nothing else: all-the-jev has no dependencies to install.

```sh
./launch.sh
```

That finds a suitable Node (on your PATH, or installed by nvm or Homebrew), starts all-the-jev and opens the viewer at
http://127.0.0.1:4777/ (or http://jeview.localhost:4777/, a name your browser already knows). `npm start` does the same
without opening a browser. all-the-jev also loads a `.env` file beside `jeview.ts` if present. Set `OPENROUTER_API_KEY` there or in the environment, or add a key with the key icon in the viewer.
The key saved in the viewer takes precedence over the environment variable. The first time you open it, the viewer explains itself.

### Optional LangGraph and LangChain runner

The core launcher above stays dependency-free. To execute saved workflows with LangGraph and use a bounded LangChain analyst in **Discuss**, install the separate local runner once and start that launcher instead:

```sh
cd integrations/langgraph
pnpm install
cd ../..
node integrations/langgraph/start.ts --port 4777
```

Pass the same `--dir` and optional `--jev-endpoint` arguments as the core launcher. Stop an existing all-the-jev on that port first, or select a different port. `GET /api/runtime` reports whether this process is using `langgraph` and `langchain`; the Workflows tab also names its active runner. The runner translates saved classifier nodes and AND/OR/NOT gates into LangGraph execution steps. An ordered workflow passes typed answers to the next step. Runs and their pinned Jev results are saved in all-the-jev's local SQLite database. The LangChain analyst can inspect only the selected saved evaluation, and starts only when you click **Ask about this result**. Its run is limited to two model responses. This launcher disables LangSmith tracing.

### Tool routing in Workflows

The **Tool routing** view authors routes from a host task to a tool ID and an exact instruction. Save a workflow with either the draggable **Canvas** or **Readable list** view, and swap between saved workflows from the selector. Load Browser Harness tool definitions, or supply the current catalog from another host as JSON. **Preview question** compiles the Jev Choice locally without a model call. **Ask Jev** checks the browser connection before a paid call when Browser Harness is selected, then checks the chosen route and confidence against the saved definition and current tools. It shows an exact handoff or a review hold; all-the-jev does not execute the tool. Mark a run correct or incorrect, revise the route or instruction, and rerun the same task to inspect the change. Reviewed counts cover only runs made with the current definition and are not an accuracy estimate. The workflow grid uses a local Bootstrap stylesheet; the Node server has no runtime package dependency.

## See it working

Two demos send real Jev calls through all-the-jev. Run one in a second terminal and put its window beside all-the-jev's. Each
plays only while its page is open, costs about ten cents an hour while it does, and stops with Ctrl-C.

- `npm run demo`, then open http://127.0.0.1:4781/: Jev plays Pixel Knight, a tiny side-scroller, deciding every move.
- `npm run demo:support`, then open http://127.0.0.1:4782/: Jev triages a made-up support inbox, deciding what each
  message is about, how urgent it is, which team takes it and whether to offer a credit.

## Send requests to it

Send Jev requests to `http://127.0.0.1:4777/v1/systemone` instead of the configured upstream endpoint: the same
requests and the same answers, with no key needed from the caller.

- **Group requests** under a project or label by adding it to the path: `http://127.0.0.1:4777/my-project/v1/systemone`.
  The viewer can then show one group at a time.
- **Link calls.** Every answer comes back with an event id in `events`. When a later request follows from one of
  those answers, send its event id in a `all-the-jev-Trigger` header, and the map grows that request off the answer.
  all-the-jev drops its own headers before calling Jev and sends the body on unchanged.
- **Show names, not keys.** The map labels each answer with its option's key, such as `c14`. When the criteria behind
  the keys are objects, a `all-the-jev-Display` header says which part to show instead: `all-the-jev-Display: name`, or a field
  per question, `all-the-jev-Display: category=name, kind=title`. An option without that field keeps its key, and so does
  everything sent without the header. The header is only for show: one that cannot be read is ignored, never refused.

Agents can read `http://127.0.0.1:4777/llms.txt`: a running all-the-jev serves it with its own address and whether a key is
set. [llms.txt](llms.txt) here is the same text, for the default address.

## Options

Given to either launcher: `./launch.sh --port 4800`, or `npm start -- --port 4800`.

- `--port 4777`
- `--dir ~/.local/share/jeview`: where the database lives
- `--jev-endpoint URL`: another System One endpoint, such as a local mock. The default is `https://openrouter.ai/api/v1/systemone`.
- `OPENROUTER_API_KEY`: key used for Jev calls when none is saved in the viewer; also enables the optional discussion panel.
- `OPENROUTER_CHAT_MODEL`: optional discussion model; defaults to `openrouter/auto`.

Only those two environment variables are read. `OPENCODEGO_API_KEY` has no effect in the current server. The `.env` file is ignored by Git; keep API keys there or in your shell, not in source files. `--port` changes the local viewer and proxy address; `--dir` moves the SQLite data and saved key. The key entered in the viewer overrides the environment key. Use `--jev-endpoint` only for a compatible System One API; the request body and upstream response still pass through unchanged.

In the viewer, **Layout** controls call traces, deduplication, classification colours, and automatic zoom; these display preferences stay in that browser. The Home observer lets you choose a conversation, classifier, and whether to send messages alone or messages plus tool events. Agent Markdown or JSON, saved revisions, workflows, and their run history live in the SQLite data folder. Gate-node thresholds and the what-if base rate, sensitivity, and specificity are editable in Workflows; the projected numbers are assumptions until checked against frozen turns.

The Workflows tab saves either ordered agents or an AND/OR/NOT gate graph with pinned revisions. Opening the viewer loads saved conversations and results once. **Auto updates** is off by default. Turn it on to refresh the visible Home or workflow view from local saved data; it pauses when the page is hidden. It never starts an agent or calls Jev or a chat model. A gate's **Live** mode shows the latest saved run and follows new runs only when Auto updates is on. **Replay** steps through a saved run without calling Jev again. **Run Jev**, **Run workflow**, and **Ask about this result** are explicit model-call actions. The graph's what-if projection uses editable sensitivity, specificity, and prevalence assumptions; measured accuracy uses shared frozen, source-checked turns. Neither one proves that the assistant's future behavior improved. The Home map uses blue for Choice, green for Noul, and purple for Score; click a legend item for its definition and example. In Results, **Correct** and **Incorrect / false alarm** save your correction alongside the original Jev answer without requiring notes or rerunning it.

The Agents tab has two editable strategy starters, based on [jev-guard](https://github.com/leepokai/jev-guard) (tool-call risk) and [jev-mcp](https://github.com/jkudish/jev-mcp) (claim/evidence verification). These evaluate a recorded turn; they do not intercept a live tool call. A saved agent source revision can be compared against the same past turn.

The **Browser Harness** top-level page checks whether Chrome actually responds and separately lists the MCP tool definitions. The browser connection can be down while tool definitions still load. The workbench starts Browser Harness with local recordings off. The **Discuss** panel is only for questions about selected evidence through a separate OpenRouter chat model; Jev itself does not chat.

`scripts/suggest-classifications.mjs` screens repeated, user-relevant candidate rules with Jev. Supply JSON with a `goal`, an `existing` array of classifier texts, and 2–30 `turns` containing `id`, `user`, `assistant`, and `observedIssue` strings. Each nonempty observed issue becomes a candidate. Jev checks semantic overlap with existing rules, recurrence across distinct turns, relevance to the goal, and whether the user asked for or discussed the judgment. It returns the original candidate text and typed answers; it does not generate new prose or claim measured accuracy.

```sh
node scripts/suggest-classifications.mjs observations.json http://127.0.0.1:4777/v1/systemone > suggestions.json
```

The optional Impeccable design detector is configured in `.impeccable/config.json`. Its `hook.enabled` switch, `limits.maxFindings`, and `limits.maxChars` are project settings. Local hook consent lives in the Git-ignored `.impeccable/config.local.json`. A provider hook runs only when that provider has an installed Impeccable hook manifest; this project currently has no such manifest, so `hook.enabled: true` alone does not trigger automatic scans. With the Impeccable skill installed, run `node <impeccable-skill-dir>/scripts/hook-admin.mjs status` (or `on` / `off`) to inspect or change the hook, and `node <impeccable-skill-dir>/scripts/detect.mjs --json ui/index.html ui/app.css ui/workbench.css` for a manual scan. Impeccable is not a all-the-jev runtime dependency.

## Your data

all-the-jev stores calls and workbench results on your machine, has no accounts, and sends no telemetry. Jev calls go to the configured System One endpoint (OpenRouter by default). The discussion panel sends only selected evaluation evidence to OpenRouter when you explicitly ask a question there.

Calls and your key are kept in `jeview.sqlite` in the data folder. The file is readable only by you, and the key is
stored in it as plain text. To erase everything, key included, stop all-the-jev and delete `jeview.sqlite*` from that folder.

A long history stays cheap: the viewer opens on the latest 20,000 calls, and search reaches the rest. Two all-the-jevs may
share a data folder, for instance on two ports, and each shows the calls of both.

all-the-jev listens on 127.0.0.1 only and has no login: anything running on your machine can read the recorded calls and
send calls with your key. It refuses requests from web pages on other sites, so a page you visit cannot. Do not put it
behind a public address.

## Develop

```sh
npm install # only the type checker
npm test
npm run typecheck
npm run check:pages # the viewer's and the demos' browser scripts parse
```

## License

MIT

## Attribution

Based on the MIT-licensed Jeview gateway from https://github.com/andududu/jeview. This application's name is all-the-jev.

