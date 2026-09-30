#!/usr/bin/env node
// scripts/sim/chatlog.js — read Codex session logs as agent events.
//
// A Codex session is one JSONL file per thread:
//   ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ISO timestamp>-<uuid>.jsonl
// one JSON record per line. This module turns those records into a flat, ordered
// list of agent events, and folds a tail of them into a Jev `state` string.
//
// As a library:
//   import { newestSession, readSession, toEvents, buildWindow } from "./chatlog.js";
//
// From the command line, to see what a window looks like:
//   node scripts/sim/chatlog.js                 # newest session, summary
//   node scripts/sim/chatlog.js --list          # recent sessions
//   node scripts/sim/chatlog.js --window        # print the state window
//   node scripts/sim/chatlog.js --session <id>  # pick a session by id fragment
//
// Only plaintext is read. Codex stores reasoning bodies and compaction records as
// `encrypted_content`; reasoning therefore contributes its plaintext summary
// headline only, and compaction becomes a marker with no content.
//
// Record vocabulary this was written against (observed, not documented):
//   session_meta            — session_id, cwd, originator, cli_version, parent ids
//   response_item.message   — role (developer|user|assistant) + content[].text
//   response_item.reasoning — summary[].text (plaintext headline), encrypted_content
//   response_item.compaction— encrypted_content only
//   response_item.function_call / custom_tool_call
//                           — function_call: {name, namespace, arguments: "<json string>"}
//                             custom_tool_call: {name, input: "<source string>", call_id, status}
//                             the `input` of custom_tool_call is where a shell command is visible
//   response_item.function_call_output / custom_tool_call_output — the tool's result
//   event_msg.item_completed— item.type (UserMessage|AgentMessage|Reasoning) + content
//   event_msg.task_complete — duration_ms, time_to_first_token_ms, last_agent_message
//   event_msg.token_count   — info.last_token_usage, rate_limits
//   turn_context, token_usage_record, world_state — turn metadata, not projected
//
// `namespace` is spelled out for MCP-collaboration calls (`collaboration.send_message`)
// and absent for the built-in shell/exec tools.
//
// Note: `ordinal` is present on some sessions and absent on others, so order is
// always file order (append order), never `ordinal`.
//
// Options for newStream/toEvents:
//   skipPatterns (regex[]), includeDeveloper, includeReasoning, includeTokens,
//   includeTools (default true), storeCap (default 8000 chars per event).

import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

export const SESSIONS_DIR =
  process.env.CODEX_SESSIONS_DIR || join(homedir(), ".codex", "sessions");

/** Prompts Codex injects, not things the agent or the human said. Configurable per simulation. */
export const BOILERPLATE = [
  /^##\s*Memory\b/,
  /^You have access to a memory folder/,
  /^<recommended_plugins>/,
  /^<multi_agent_role>/,
  /^<multi_agent_mode>/,
  /^<permissions instructions>/,
  /^<environment_context>/,
  /^<user_instructions>/,
  /^<codex_internal_context>/,
];

const sha1 = (s) => createHash("sha1").update(s).digest("hex");

/** Content parts -> plain text. Codex spells the part type several ways; all carry `.text`. */
function partsText(parts) {
  if (typeof parts === "string") return parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (typeof p === "string" ? p : p && typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n");
}

/** Be forgiving about where a message payload keeps its text. */
function anyText(v) {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return partsText(v);
  if (v && typeof v === "object" && typeof v.text === "string") return v.text;
  return "";
}

/**
 * A function_call keeps its arguments as a JSON *string*. Render it as compact
 * `key=value` pairs so a window stays readable and cheap.
 */
function shortArgs(a) {
  if (typeof a !== "string") return a && typeof a === "object" ? JSON.stringify(a).slice(0, 700) : String(a ?? "");
  const t = a.trim();
  try {
    const o = JSON.parse(t);
    if (o && typeof o === "object" && !Array.isArray(o)) {
      return Object.entries(o)
        .map(([k, v]) => {
          const s = typeof v === "string" ? JSON.stringify(v.length > 120 ? `${v.slice(0, 120)}...` : v) : JSON.stringify(v);
          return `${k}=${s}`;
        })
        .join(", ")
        .slice(0, 900);
    }
  } catch {
    /* not JSON — fall through and show it as written */
  }
  return t.replace(/\s+/g, " ").slice(0, 900);
}

/** Both function_call_output and custom_tool_call_output put their payload in different keys. */
function outputText(p) {
  const v = p.output ?? p.content ?? p.text;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return partsText(v);
  if (v && typeof v === "object") {
    if (typeof v.content === "string") return v.content;
    if (Array.isArray(v.content)) return partsText(v.content);
    if (typeof v.text === "string") return v.text;
    return JSON.stringify(v).slice(0, 4000);
  }
  return "";
}

// ── locating sessions ───────────────────────────────────────────────────────

/** `rollout-2026-09-28T23-21-06-<uuid>.jsonl` -> { startedAt, id } */
export function sessionIdOf(file) {
  const m = /^rollout-(\d{4}-\d{2}-\d{2}T[\d-]+)-([0-9a-fA-F-]{36})\.jsonl$/.exec(file);
  return m ? { startedAt: m[1], id: m[2] } : { startedAt: null, id: null };
}

/** Every rollout file under `dir`, newest first. Missing directory is not an error. */
export function findSessions({ dir = SESSIONS_DIR, limit = 400 } = {}) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
        let st;
        try {
          st = statSync(p);
        } catch {
          continue;
        }
        out.push({ path: p, file: e.name, size: st.size, mtime: st.mtimeMs, ...sessionIdOf(e.name) });
      }
    }
  };
  walk(dir);
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, limit);
}

export function newestSession(opts = {}) {
  return findSessions(opts)[0] ?? null;
}

/** Find one session by exact id, id prefix, filename fragment, or path fragment. */
export function findSession(want, opts = {}) {
  if (!want) return newestSession(opts);
  const all = findSessions({ ...opts, limit: 100000 });
  return (
    all.find((s) => s.id === want) ||
    all.find((s) => s.path === want) ||
    all.find((s) => s.path.includes(want)) ||
    null
  );
}

// ── parsing ─────────────────────────────────────────────────────────────────

/** Split JSONL text into records, tagging each with its line index. Tolerates junk. */
export function parseLines(text, startIndex = 0) {
  const records = [];
  let bad = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      bad++;
      continue;
    }
    if (rec && typeof rec === "object") {
      rec.__i = startIndex + i;
      records.push(rec);
    } else bad++;
  }
  return { records, bad, lineCount: lines.length };
}

export function readSession(path) {
  const text = readFileSync(path, "utf8");
  const { records, bad, lineCount } = parseLines(text);
  return { path, records, bad, lineCount };
}

// ── records -> events ───────────────────────────────────────────────────────

/**
 * A stateful stream, so a live tail can be fed new records without re-reading
 * the file. Dedupe is by text hash within a short recent window: the same item
 * is written twice (once as response_item, once as event_msg.item_completed),
 * and legitimate repeats are far apart.
 */
export function newStream(opts = {}) {
  const skip = opts.skipPatterns ?? BOILERPLATE;
  const includeDeveloper = opts.includeDeveloper === true;
  // Tool results are routinely hundreds of KB; keep the event list a reasonable
  // size and mark the cut so a window never silently looks complete.
  const storeCap = Math.max(400, Math.floor(opts.storeCap ?? 8000));

  const events = [];
  const recent = [];
  const RECENT = 12;
  const state = { meta: null, tally: Object.create(null), events };

  const bump = (k) => {
    state.tally[k] = (state.tally[k] ?? 0) + 1;
  };

  const add = (at, kind, rawText, extra) => {
    let text = String(rawText ?? "").replace(/\r\n/g, "\n").trim();
    if (!text) return;
    if (skip.some((re) => re.test(text))) return bump("skipped:boilerplate");
    const key = sha1(text);
    if (kind !== "turn" && recent.includes(key)) return bump("deduped");
    recent.push(key);
    if (recent.length > RECENT) recent.shift();
    if (text.length > storeCap) text = `${text.slice(0, storeCap)}...[+${text.length - storeCap} chars]`;
    events.push({ n: events.length + 1, at: at ?? null, kind, ...(extra ?? {}), text });
    bump(`kind:${kind}`);
  };

  const pushOne = (rec) => {
    const type = rec.type;
    bump(`rec:${type}`);
    const at = rec.timestamp ?? null;
    const p = rec.payload ?? {};

    if (type === "session_meta") {
      if (!state.meta) {
        state.meta = {
          session: p.session_id ?? p.id ?? null,
          forkedFrom: p.forked_from_id ?? null,
          parent: p.parent_thread_id ?? null,
          cwd: p.cwd ?? null,
          originator: p.originator ?? null,
          cliVersion: p.cli_version ?? null,
          modelProvider: p.model_provider ?? null,
        };
      }
      return;
    }

    if (type === "response_item") {
      const t = p.type;
      if (t === "message") {
        const role = p.role ?? "unknown";
        if (role === "developer" && !includeDeveloper) return bump("skipped:developer");
        const kind = role === "assistant" ? "assistant" : role === "user" ? "user" : "note";
        add(at, kind, partsText(p.content), { role });
      } else if (t === "reasoning") {
        if (opts.includeReasoning === false) return;
        const headline = partsText(p.summary);
        if (headline) add(at, "reasoning", headline);
        else bump("skipped:opaque-reasoning");
      } else if (t === "compaction") {
        add(at, "note", "[context compacted: earlier turns are encrypted on disk]");
      } else if (t === "function_call") {
        if (opts.includeTools === false) return;
        const ns = p.namespace ? `${p.namespace}.` : "";
        add(at, "tool", `${ns}${p.name ?? "?"}(${shortArgs(p.arguments)})`, {
          tool: p.name ?? null,
          namespace: p.namespace ?? null,
          callId: p.call_id ?? p.id ?? null,
        });
      } else if (t === "custom_tool_call") {
        if (opts.includeTools === false) return;
        add(at, "tool", `${p.name ?? "?"} ${String(p.input ?? "").trim()}`, {
          tool: p.name ?? null,
          callId: p.call_id ?? p.id ?? null,
        });
      } else if (t === "function_call_output" || t === "custom_tool_call_output") {
        if (opts.includeTools === false) return;
        add(at, "tool-result", outputText(p), { callId: p.call_id ?? null, ok: p.status ? p.status === "completed" : null });
      }
      return;
    }

    if (type === "event_msg") {
      const t = p.type;
      if (t === "item_completed") {
        const item = p.item ?? {};
        if (item.type === "UserMessage") add(at, "user", partsText(item.content), { role: "user" });
        else if (item.type === "AgentMessage") add(at, "assistant", partsText(item.content), { role: "assistant" });
        else if (item.type === "Reasoning") {
          if (opts.includeReasoning !== false) add(at, "reasoning", partsText(item.summary_text));
        } else bump(`item:${item.type ?? "?"}`);
        return;
      }
      if (t === "user_message") return add(at, "user", anyText(p.message ?? p.text ?? p.content), { role: "user" });
      if (t === "agent_message") return add(at, "assistant", anyText(p.message ?? p.text ?? p.content), { role: "assistant" });
      if (t === "task_complete") {
        const bits = [];
        if (Number.isFinite(p.duration_ms)) bits.push(`completed in ${(p.duration_ms / 1000).toFixed(1)}s`);
        if (Number.isFinite(p.time_to_first_token_ms)) bits.push(`first token ${(p.time_to_first_token_ms / 1000).toFixed(1)}s`);
        if (typeof p.last_agent_message === "string" && p.last_agent_message) bits.push(`final: ${p.last_agent_message}`);
        return add(at, "turn", bits.join(" | "), { turnId: p.turn_id ?? null });
      }
      if (t === "token_count") {
        if (opts.includeTokens !== true) return;
        const u = p.info?.last_token_usage ?? {};
        return add(at, "tokens", `in ${u.input_tokens ?? "?"} (cached ${u.cached_input_tokens ?? "?"}) out ${u.output_tokens ?? "?"}`);
      }
      return;
    }
  };

  state.push = (records) => {
    for (const rec of records) pushOne(rec);
    return events;
  };
  return state;
}

/** One-shot: all records -> a finished stream state. */
export function toEvents(records, opts = {}) {
  const s = newStream(opts);
  s.push(records);
  return s;
}

// ── events -> a Jev `state` window ──────────────────────────────────────────

const KB = (n) => (n < 1024 ? `${n} B` : n < 1024 * 100 ? `${(n / 1024).toFixed(1)} KB` : `${Math.round(n / 1024)} KB`);

/**
 * Fold a tail of events into one Jev `state` string.
 *
 * opts: { meta, kind: "events"|"lastUser", lastEvents, maxChars, maxEventChars,
 *         includeReasoning, includeTokens }
 *
 * Jev's own guidance is the reason for the knobs: a state padded with content
 * unrelated to the decision lowers accuracy, and `state` + the longest question
 * must stay under 32k tokens.
 */
export function buildWindow(events, opts = {}) {
  const kind = opts.kind ?? "events";
  const lastEvents = Math.max(1, Math.floor(opts.lastEvents ?? 40));
  const maxChars = Math.max(200, Math.floor(opts.maxChars ?? 24000));
  const maxEventChars = Math.max(80, Math.floor(opts.maxEventChars ?? 1500));
  const includeReasoning = opts.includeReasoning !== false;
  const includeTokens = opts.includeTokens === true;
  const kinds = Array.isArray(opts.kinds) && opts.kinds.length ? new Set(opts.kinds) : null;

  let usable;
  if (kind === "lastUser") {
    usable = [];
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].kind === "user") {
        usable = [events[i]];
        break;
      }
    }
  } else {
    usable = events.filter(
      (e) =>
        (e.kind !== "reasoning" || includeReasoning) &&
        (e.kind !== "tokens" || includeTokens) &&
        (!kinds || kinds.has(e.kind)),
    );
  }

  let chosen = usable.slice(-lastEvents);
  const render = (e) => {
    const clipped = e.text.length > maxEventChars ? `${e.text.slice(0, maxEventChars)}...` : e.text;
    const stamp = e.at ? `${String(e.at).slice(11, 19)} ` : "";
    return `[${stamp}#${e.n}] ${e.kind}: ${clipped}`;
  };

  let body = chosen.map(render).join("\n");
  while (chosen.length > 1 && body.length > maxChars) {
    chosen = chosen.slice(1);
    body = chosen.map(render).join("\n");
  }
  if (body.length > maxChars) body = body.slice(body.length - maxChars);

  const m = opts.meta ?? {};
  const counts = Object.create(null);
  for (const e of chosen) counts[e.kind] = (counts[e.kind] ?? 0) + 1;

  const head = [
    `CODEX SESSION ${m.session ?? "unknown"}`,
    m.cwd ? `cwd ${m.cwd}` : null,
    m.originator ? `agent ${m.originator}` : null,
    chosen.length ? `agent events #${chosen[0].n}..#${chosen[chosen.length - 1].n} of ${events.length}` : "no agent events yet",
  ]
    .filter(Boolean)
    .join(" | ");

  const text = chosen.length ? `${head}\n\n${body}` : `${head}\n\n(no events in window)`;

  return {
    text,
    chars: text.length,
    bytes: Buffer.byteLength(text),
    hash: sha1(text),
    from: chosen.length ? chosen[0].n : null,
    to: chosen.length ? chosen[chosen.length - 1].n : null,
    count: chosen.length,
    total: events.length,
    counts,
  };
}

// ── live tail ───────────────────────────────────────────────────────────────

/**
 * Read a growing JSONL file incrementally. Poll returns only records appended
 * since the previous poll, and keeps a partial trailing line for the next one.
 * `start: true` reads the file from the beginning (a truncation is also detected).
 */
export function openTail(path) {
  let fd = null;
  let offset = 0;
  let pending = "";
  let lineBase = 0;

  const readDelta = () => {
    if (fd === null) fd = openSync(path, "r");
    const size = statSync(path).size;
    if (size < offset) {
      offset = 0;
      pending = "";
      lineBase = 0;
    }
    const want = size - offset;
    if (want <= 0) return null;
    const chunk = Buffer.allocUnsafe(want);
    let got = 0;
    while (got < want) {
      const n = readSync(fd, chunk, got, want - got, offset + got);
      if (n <= 0) break;
      got += n;
    }
    offset += got;
    return chunk.subarray(0, got).toString("utf8");
  };

  return {
    path,
    reset() {
      offset = 0;
      pending = "";
      lineBase = 0;
    },
    poll({ start = false } = {}) {
      if (start) {
        offset = 0;
        pending = "";
        lineBase = 0;
      }
      const chunk = readDelta();
      if (chunk === null) return { records: [], bad: 0, fresh: false };
      pending += chunk;
      const cut = pending.lastIndexOf("\n");
      if (cut === -1) return { records: [], bad: 0, fresh: false };
      const whole = pending.slice(0, cut);
      pending = pending.slice(cut + 1);
      const { records, bad, lineCount } = parseLines(whole, lineBase);
      lineBase += lineCount;
      return { records, bad, fresh: records.length > 0 };
    },
    close() {
      if (fd !== null) {
        closeSync(fd);
        fd = null;
      }
    },
  };
}

export const formatBytes = KB;

// ── CLI ─────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const valueFlags = new Set(["session", "file", "last-events", "max-chars"]);
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      if (valueFlags.has(argv[i].slice(2))) i++;
    } else positional.push(argv[i]);
  }
  const flag = (n, d) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? d : argv[i + 1];
  };
  const has = (n) => argv.includes(`--${n}`);

  if (has("list")) {
    const all = findSessions({ limit: Number(flag("limit", "15")) });
    if (!all.length) return console.log(`No sessions under ${SESSIONS_DIR}`);
    console.log(`\n${all.length} recent Codex session(s) under ${SESSIONS_DIR}\n`);
    for (const s of all) {
      const when = new Date(s.mtime).toLocaleString();
      console.log(`  ${when.padEnd(22)}  ${formatBytes(s.size).padStart(8)}  ${s.id ?? s.file}`);
    }
    return console.log("");
  }

  const target = findSession(flag("session") ?? flag("file") ?? positional[0]);
  if (!target) {
    console.error(`No Codex session found (looked under ${SESSIONS_DIR}).`);
    process.exit(1);
  }

  const { records, bad } = readSession(target.path);
  const stream = toEvents(records);
  console.log(`\nsession  ${target.id ?? target.file}`);
  console.log(`file     ${target.path}`);
  console.log(`records  ${records.length} (${bad} unparseable)`);
  if (stream.meta) {
    console.log(`cwd      ${stream.meta.cwd ?? "?"}`);
    console.log(`agent    ${stream.meta.originator ?? "?"}  cli ${stream.meta.cliVersion ?? "?"}`);
  }
  console.log(`events   ${stream.events.length}`);
  const kinds = Object.entries(stream.tally).filter(([k]) => k.startsWith("kind:"));
  if (kinds.length) console.log(`         ${kinds.map(([k, n]) => `${k.slice(5)} ${n}`).join(", ")}`);
  const skips = Object.entries(stream.tally).filter(([k]) => k.startsWith("skipped:") || k === "deduped");
  if (skips.length) console.log(`skipped  ${skips.map(([k, n]) => `${k} ${n}`).join(", ")}`);

  const window = buildWindow(stream.events, {
    meta: stream.meta,
    lastEvents: Number(flag("last-events", "40")),
    maxChars: Number(flag("max-chars", "24000")),
    kind: has("last-user") ? "lastUser" : "events",
  });
  console.log(`window   ${window.count} events, #${window.from}..#${window.to}, ${formatBytes(window.chars)}, hash ${window.hash.slice(0, 12)}\n`);

  if (has("window") || has("last-user")) console.log(window.text);
  else console.log(`(pass --window to print the state, or --list to pick a session)\n`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("chatlog.js")) {
  main();
}
