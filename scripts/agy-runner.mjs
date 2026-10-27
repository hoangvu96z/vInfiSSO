#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_LOG_DIR = '.agy-runs';
const QUIET_HEARTBEAT_MS = 60_000;
const SECRET_ASSIGNMENT =
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role[_-]?key|jwt[_-]?secret|encryption[_-]?key|token|password|secret|authorization|private[_-]?key)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

export function redactSecrets(value) {
  return String(value ?? '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g,
      '[REDACTED]'
    )
    .replace(SECRET_ASSIGNMENT, '$1[REDACTED]');
}

function getParameter(parameters, names) {
  for (const name of names) {
    const value = parameters?.[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function getCheckKind(command) {
  if (!command) return null;
  if (/\bci:(?:status|wait)\b|\bgithub-actions-mcp\.mjs\b/i.test(command)) {
    return 'ci';
  }
  if (/\b(?:npm run )?build(?::[\w:-]+)?\b|\bnest build\b|\bvite build\b/i.test(command)) {
    return 'build';
  }
  if (/\btypecheck\b|\btsc\s+--noEmit\b/i.test(command)) return 'typecheck';
  if (
    /\b(?:npm run )?(?:test|test:[\w:-]+)\b|\bnode\s+--test\b|\bjest\b|\bplaywright\s+test\b/i.test(
      command
    )
  ) {
    return 'test';
  }
  if (/\blint(?::[\w:-]+)?\b|\beslint\b|\boxlint\b/i.test(command)) return 'lint';
  if (/\bcodegraph\s+(?:status|sync|explore|node|affected|query|callers)\b/i.test(command)) {
    return 'codegraph';
  }
  return null;
}

function summarizeCommand(command) {
  if (!command) return null;
  const normalized = command.replace(/\s+/g, ' ').trim();
  const npmScript = normalized.match(/\b(?:npm|pnpm|yarn)\s+run\s+([\w:-]+)/i);
  if (npmScript) return `${normalized.match(/\b(?:npm|pnpm|yarn)\b/i)?.[0]} run ${npmScript[1]}`;
  const codegraph = normalized.match(
    /\bcodegraph\s+(status|sync|explore|node|affected|query|callers)\b/i
  );
  if (codegraph) return `codegraph ${codegraph[1]}`;
  const nodeTest = normalized.match(/\bnode\s+--test\b/i);
  if (nodeTest) return 'node --test';
  const jestRun = normalized.match(/\bjest\b/i);
  if (jestRun) return 'jest';
  const gitCommand = normalized.match(/\bgit\s+(status|diff|show|log|branch|rev-parse)\b/i);
  if (gitCommand) return `git ${gitCommand[1]}`;
  return normalized.split(' ').slice(0, 2).join(' ').slice(0, 120);
}

export function summarizeCheck(command, output = '') {
  const kind = getCheckKind(command);
  if (!kind) return null;

  const text = String(output);
  const counts = {};
  const tapCounts = text.match(/# tests\s+(\d+)\s*\n# pass\s+(\d+)\s*\n# fail\s+(\d+)/i);
  if (tapCounts) {
    counts.tests = Number(tapCounts[1]);
    counts.passed = Number(tapCounts[2]);
    counts.failed = Number(tapCounts[3]);
  } else {
    const jestCounts = text.match(/Tests:\s*(?:(\d+) failed,?\s*)?(?:(\d+) passed)?/i);
    if (jestCounts && (jestCounts[1] || jestCounts[2])) {
      if (jestCounts[1]) counts.failed = Number(jestCounts[1]);
      if (jestCounts[2]) counts.passed = Number(jestCounts[2]);
    }
  }

  const exitMatch = text.match(/(?:exit(?:ed)?(?:\s+with)?\s+code|exit code)\s*[:=]?\s*(\d+)/i);
  const explicitExitCode = exitMatch ? Number(exitMatch[1]) : null;
  let outcome = 'unverified';
  if (explicitExitCode !== null) {
    outcome = explicitExitCode === 0 ? 'passed' : 'failed';
  } else if (typeof counts.failed === 'number') {
    outcome = counts.failed === 0 ? 'passed' : 'failed';
  } else if (/\bStatus:\s*SUCCESS:/i.test(text)) {
    outcome = 'passed';
  } else if (
    /\b(Status:\s*FAILED:|command failed|tests? failed|build failed|typecheck failed|error occurred)\b/i.test(
      text
    )
  ) {
    outcome = 'failed';
  }

  return {
    kind,
    outcome,
    ...(explicitExitCode !== null ? { exitCode: explicitExitCode } : {}),
    ...(Object.keys(counts).length ? { counts } : {}),
  };
}

export function normalizeAgyEvent(event) {
  if (!event || typeof event !== 'object') return { event: 'unknown' };

  if (event.event === 'init') {
    return {
      event: 'init',
      conversationId: event.conversation_id ?? null,
      model: event.init?.model ?? null,
      permissionMode: event.init?.permission_mode ?? null,
    };
  }

  if (event.event === 'step_update') {
    const step = event.step_update || {};
    const info = step.tool_info || {};
    const parameters = info.parameters || {};
    const toolName = step.tool_name || info.name || null;
    const filePath = getParameter(parameters, [
      'Path',
      'FilePath',
      'file_path',
      'path',
      'filename',
      'fileName',
    ]);
    const command = getParameter(parameters, ['CommandLine', 'command', 'cmd', 'Command']);
    const output = typeof info.output === 'string' ? info.output : '';
    const check = step.state === 'DONE' ? summarizeCheck(command, output) : null;
    const stepType = step.step_type ?? null;
    const looksLikeWrite =
      stepType === 'tool' && /write|edit|replace|delete|move|create_file/i.test(toolName || '');

    return {
      event: 'step_update',
      conversationId: step.conversation_id ?? event.conversation_id ?? null,
      stepIndex: Number.isInteger(step.step_index) ? step.step_index : null,
      state: step.state ?? null,
      stepType,
      ...(toolName ? { toolName } : {}),
      ...(filePath ? { filePath: redactSecrets(filePath).slice(0, 500) } : {}),
      ...(looksLikeWrite && filePath ? { fileActivity: 'write_or_edit' } : {}),
      ...(command ? { command: redactSecrets(summarizeCommand(command)) } : {}),
      ...(check ? { check } : {}),
      ...(step.text_delta ? { responseDeltaChars: String(step.text_delta).length } : {}),
      ...(typeof step.duration_seconds === 'number'
        ? { durationSeconds: step.duration_seconds }
        : {}),
      ...(step.usage && typeof step.usage === 'object' ? { usage: step.usage } : {}),
    };
  }

  if (event.event === 'result') {
    const result = event.result || {};
    return {
      event: 'result',
      conversationId: result.conversation_id ?? null,
      status: result.status ?? 'UNKNOWN',
      durationSeconds: result.duration_seconds ?? null,
      turns: result.num_turns ?? null,
      responseChars: typeof result.response === 'string' ? result.response.length : 0,
      ...(result.usage && typeof result.usage === 'object' ? { usage: result.usage } : {}),
    };
  }

  return { event: typeof event.event === 'string' ? event.event : 'unknown' };
}

function shouldSkipSnapshotPath(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  return /(^|\/)(?:\.env(?:\.[^/]*)?|\.local-db|node_modules|\.next|dist|coverage|uploads|tudien\.sql|\.codegraph|\.playwright-cli|\.agy-runs)(\/|$)/.test(
    normalized
  );
}

export function diffSnapshots(before, after) {
  const changed = [];
  const noLongerDirty = [];
  for (const [filePath, digest] of after) {
    if (before.get(filePath) !== digest) changed.push(filePath);
  }
  for (const filePath of before.keys()) {
    if (!after.has(filePath)) noLongerDirty.push(filePath);
  }
  return { changed: changed.sort(), noLongerDirty: noLongerDirty.sort() };
}

function captureGitSnapshot(cwd) {
  try {
    const output = execFileSync(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const snapshot = new Map();
    for (const record of output.split('\0')) {
      if (record.length < 4) continue;
      const filePath = record.slice(3);
      if (!filePath || shouldSkipSnapshotPath(filePath)) continue;
      const absolutePath = path.join(cwd, filePath);
      let digest = 'missing';
      try {
        const stat = fs.lstatSync(absolutePath);
        digest = stat.isFile()
          ? createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex')
          : `non-file:${stat.mode}`;
      } catch {
        // Deleted tracked path remains part of snapshot.
      }
      snapshot.set(filePath, `${record.slice(0, 2)}:${digest}`);
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function validateSingleJobOptions(job, indexLabel = 'job') {
  const normalized = {
    name: job.name || indexLabel,
    cwd: job.cwd || null,
    taskFile: job.taskFile || null,
    prompt: job.prompt || null,
    model: job.model || null,
    effort: job.effort || 'high',
    mode: job.mode || 'accept-edits',
    continueConversation: Boolean(job.continueConversation),
    conversationId: job.conversationId || null,
  };
  if (normalized.continueConversation && normalized.conversationId) {
    throw new Error(`[${normalized.name}] Use either --continue or --conversation, not both.`);
  }
  if (!normalized.taskFile && !normalized.prompt) {
    throw new Error(`[${normalized.name}] Pass --task-file <path> (or prompt in jobs manifest).`);
  }
  if (!normalized.model) {
    throw new Error(
      `[${normalized.name}] Pass --model <agy-model>; choose Flash (e.g. gemini-3.8-flash-high) for fast/scoped tasks or Argon (e.g. gemini-4-argon-high) for complex tasks.`
    );
  }
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(normalized.effort)) {
    throw new Error(`[${normalized.name}] Effort must be low, medium, high, xhigh, or max.`);
  }
  if (!['plan', 'accept-edits'].includes(normalized.mode)) {
    throw new Error(`[${normalized.name}] Mode must be plan or accept-edits.`);
  }
  return normalized;
}

export function parseRunnerArgs(argv) {
  const options = {
    name: null,
    cwd: null,
    taskFile: null,
    model: null,
    effort: 'high',
    mode: 'accept-edits',
    continueConversation: false,
    conversationId: null,
    jobsFile: null,
    maxConcurrency: 4,
    logDir: DEFAULT_LOG_DIR,
    agyBin: process.env.AGY_BIN || 'agy',
    help: false,
  };
  const valueFlags = new Map([
    ['--name', 'name'],
    ['--cwd', 'cwd'],
    ['--task-file', 'taskFile'],
    ['--model', 'model'],
    ['--effort', 'effort'],
    ['--mode', 'mode'],
    ['--jobs', 'jobsFile'],
    ['--max-concurrency', 'maxConcurrency'],
    ['--log-dir', 'logDir'],
    ['--agy-bin', 'agyBin'],
    ['--conversation', 'conversationId'],
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--continue') {
      options.continueConversation = true;
      continue;
    }
    const option = valueFlags.get(arg);
    if (!option) throw new Error(`Unknown runner option: ${arg}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    options[option] = option === 'maxConcurrency' ? Number(value) : value;
  }

  if (options.help) return options;
  if (
    !Number.isInteger(options.maxConcurrency) ||
    options.maxConcurrency < 1 ||
    options.maxConcurrency > 16
  ) {
    throw new Error('--max-concurrency must be an integer between 1 and 16.');
  }

  if (options.jobsFile) {
    if (options.taskFile || options.model) {
      throw new Error('Use either --jobs <manifest.json> or single-task flags (--task-file/--model), not both.');
    }
    return options;
  }

  validateSingleJobOptions(options, options.name || 'single');
  return options;
}

export const RUNNER_HELP = `AGY Multi-Agent Event Harness

Usage (Single Agent):
  npm run agy -- --task-file <path> --model <model> [options]

Usage (Parallel Multi-Agent):
  npm run agy:parallel -- --jobs <manifest.json> [--max-concurrency 4]

Options:
  --task-file PATH         UTF-8 file containing the scoped task prompt
  --model NAME             AGY model (e.g. gemini-3.8-flash-high or gemini-4-argon-high)
  --effort LEVEL           low|medium|high|xhigh|max (default: high)
  --mode MODE              plan|accept-edits (default: accept-edits)
  --name LABEL             Optional worker label for logs
  --cwd PATH               Working directory for the worker (default: current directory)
  --continue               Continue AGY's most recent conversation
  --conversation ID        Continue an exact conversation ID from a prior run
  --jobs PATH              JSON manifest containing parallel agent jobs
  --max-concurrency COUNT  Max parallel AGY processes for --jobs (default: 4)
  --log-dir PATH           JSONL run logs (default: .agy-runs, ignored by Git)
  --agy-bin PATH           AGY executable (default: agy or AGY_BIN)
  --help                   Show this help

The harness consumes AGY stream-json events, prints live tool/check activity,
records redacted JSONL logs, and computes worktree file deltas. It never enables
--dangerously-skip-permissions.
`;

function appendRecord(fd, record) {
  fs.writeSync(fd, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
}

function getStepLabel(step) {
  if (step.stepType === 'tool') {
    const details = step.filePath || step.command;
    return `${step.toolName || 'tool'}${details ? ` — ${details}` : ''}`;
  }
  if (step.stepType === 'agent_response') return 'AGY is drafting a response';
  if (step.stepType === 'user_input') return 'task prompt accepted';
  return step.stepType || 'AGY activity';
}

function ensureSecureLogDir(logDirectory, baseCwd) {
  const logDirectoryExisted = fs.existsSync(logDirectory);
  fs.mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  if (!logDirectoryExisted || logDirectory === path.resolve(baseCwd, DEFAULT_LOG_DIR)) {
    try {
      fs.chmodSync(logDirectory, 0o700);
    } catch {
      // Ignore chmod unsupported errors.
    }
  }
}

async function runSingleWorker(job, globalOptions, prefix = '') {
  const baseCwd = process.cwd();
  const workerCwd = job.cwd ? path.resolve(baseCwd, job.cwd) : baseCwd;
  const promptText = job.prompt
    ? String(job.prompt).trim()
    : fs.readFileSync(path.resolve(workerCwd, job.taskFile), 'utf8').trim();
  if (!promptText) {
    throw new Error(`[${job.name}] Task prompt is empty.`);
  }

  const safeLabel = String(job.name || 'worker').replace(/[^a-zA-Z0-9_-]/g, '-');
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeLabel}-${randomUUID().slice(0, 6)}`;
  const logDirectory = path.resolve(baseCwd, globalOptions.logDir);
  ensureSecureLogDir(logDirectory, baseCwd);

  const logPath = path.join(logDirectory, `${runId}.jsonl`);
  const logFd = fs.openSync(logPath, 'a', 0o600);
  const before = captureGitSnapshot(workerCwd);
  const startedAt = Date.now();
  let lastEventAt = startedAt;
  let activeTool = null;
  let finalResult = null;
  let rawResponseForDisplay = '';
  let conversationId = null;
  let childError = null;
  const tag = prefix ? `[${prefix}] ` : '';

  const args = [
    ...(job.continueConversation ? ['--continue'] : []),
    ...(job.conversationId ? ['--conversation', job.conversationId] : []),
    '--model',
    job.model,
    '--effort',
    job.effort,
    '--mode',
    job.mode,
    '--output-format',
    'stream-json',
    '--print',
    promptText,
  ];

  appendRecord(logFd, {
    kind: 'run_started',
    runId,
    worker: job.name,
    cwd: workerCwd,
    model: job.model,
    effort: job.effort,
    mode: job.mode,
    taskFile: job.taskFile ? path.relative(workerCwd, path.resolve(workerCwd, job.taskFile)) : null,
    logFile: path.relative(baseCwd, logPath),
    baselineFiles: before ? [...before.keys()].sort() : null,
  });
  console.log(
    `${tag}AGY run ${runId} started · ${job.model} · ${job.effort} · ${job.mode} · cwd=${workerCwd}`
  );
  console.log(`${tag}Event log: ${path.relative(baseCwd, logPath)}`);

  const child = spawn(globalOptions.agyBin, args, {
    cwd: workerCwd,
    env: process.env,
    stdio: [prefix ? 'ignore' : 'inherit', 'pipe', 'pipe'],
  });

  const stdout = child.stdout ? createInterface({ input: child.stdout }) : null;
  stdout?.on('line', (line) => {
    lastEventAt = Date.now();
    let raw;
    try {
      raw = JSON.parse(line);
    } catch {
      const safeLine = redactSecrets(line).slice(0, 500);
      appendRecord(logFd, { kind: 'unparsed_output', charCount: line.length });
      if (safeLine) {
        console.log(`${tag}AGY emitted non-JSON output (${line.length} chars): ${safeLine}`);
      }
      return;
    }

    const normalized = normalizeAgyEvent(raw);
    if (normalized.event === 'init') conversationId = normalized.conversationId;
    if (normalized.event === 'result') {
      finalResult = normalized;
      const response = raw.result?.response;
      rawResponseForDisplay = typeof response === 'string' ? response : '';
    }
    if (normalized.event === 'step_update' && normalized.stepType === 'tool') {
      activeTool = normalized.state === 'ACTIVE' ? normalized.toolName : null;
    }

    appendRecord(logFd, { kind: 'agy_event', runId, worker: job.name, ...normalized });

    if (normalized.event === 'init') {
      console.log(`${tag}AGY connected · conversation ${normalized.conversationId || 'unknown'}`);
    } else if (normalized.event === 'step_update') {
      if (normalized.stepType === 'tool') {
        const state = normalized.state === 'ACTIVE' ? 'started' : 'finished';
        console.log(`${tag}AGY tool ${state} · ${getStepLabel(normalized)}`);
      } else if (normalized.stepType === 'agent_response' && normalized.state === 'DONE') {
        console.log(`${tag}AGY response ready`);
      }
      if (normalized.check) {
        console.log(
          `${tag}AGY check · ${normalized.check.kind}: ${normalized.check.outcome}` +
            (normalized.check.counts ? ` · ${JSON.stringify(normalized.check.counts)}` : '')
        );
      }
    } else if (normalized.event === 'result') {
      console.log(
        `${tag}AGY result event · ${normalized.status} · ${normalized.durationSeconds ?? '?'}s`
      );
    }
  });

  const stderr = child.stderr ? createInterface({ input: child.stderr }) : null;
  stderr?.on('line', (line) => {
    lastEventAt = Date.now();
    const safeLine = redactSecrets(line).slice(0, 1000);
    appendRecord(logFd, { kind: 'agy_stderr', runId, worker: job.name, charCount: line.length });
    if (safeLine) console.error(`${tag}AGY: ${safeLine}`);
  });

  const heartbeat = child.pid
    ? setInterval(() => {
        const quietSeconds = Math.floor((Date.now() - lastEventAt) / 1000);
        const waitingFor = activeTool
          ? `tool ${activeTool}`
          : 'AGY event (model/CLI may be processing)';
        const record = { kind: 'quiet_interval', runId, worker: job.name, quietSeconds, waitingFor };
        appendRecord(logFd, record);
        console.log(`${tag}AGY still active · no event for ${quietSeconds}s · ${waitingFor}`);
      }, QUIET_HEARTBEAT_MS)
    : null;
  heartbeat?.unref();

  let closeProcess;
  const processClosed = new Promise((resolve) => {
    closeProcess = resolve;
  });
  child.on('error', (error) => {
    childError = error;
    closeProcess(1);
  });
  child.once('close', (code) => closeProcess(code ?? 1));
  const exitCode = await processClosed;
  if (heartbeat) clearInterval(heartbeat);

  const after = captureGitSnapshot(workerCwd);
  const fileDelta = before && after ? diffSnapshots(before, after) : null;
  const processExitCode = Number.isInteger(exitCode) && exitCode >= 0 ? exitCode : 1;
  const successful = processExitCode === 0 && finalResult?.status === 'SUCCESS';
  const finalStatus = successful
    ? 'SUCCESS'
    : finalResult?.status && finalResult.status !== 'SUCCESS'
      ? finalResult.status
      : childError
        ? 'SPAWN_ERROR'
        : 'INCOMPLETE';
  const durationSeconds = Math.round((Date.now() - startedAt) / 1000);

  if (fileDelta) {
    appendRecord(logFd, { kind: 'worktree_delta', runId, worker: job.name, ...fileDelta });
    console.log(
      `${tag}AGY file changes · ${fileDelta.changed.length} changed` +
        (fileDelta.changed.length ? `: ${fileDelta.changed.join(', ')}` : '')
    );
  } else {
    appendRecord(logFd, { kind: 'worktree_delta_unavailable', runId, worker: job.name });
  }

  appendRecord(logFd, {
    kind: 'run_finished',
    runId,
    worker: job.name,
    status: finalStatus,
    processExitCode,
    durationSeconds,
    conversationId,
    resultStatus: finalResult?.status ?? null,
    usage: finalResult?.usage ?? null,
  });
  fs.closeSync(logFd);
  console.log(
    `${tag}AGY run ${finalStatus} · ${durationSeconds}s · ${path.relative(baseCwd, logPath)}`
  );
  if (finalResult?.usage) console.log(`${tag}Usage · ${JSON.stringify(finalResult.usage)}`);

  if (!prefix && rawResponseForDisplay.trim()) {
    console.log('\nAGY final response:\n');
    console.log(redactSecrets(rawResponseForDisplay).trim());
  }

  return {
    name: job.name,
    model: job.model,
    cwd: workerCwd,
    runId,
    conversationId,
    status: finalStatus,
    exitCode: successful ? 0 : processExitCode === 0 ? 1 : processExitCode,
    durationSeconds,
    logFile: path.relative(baseCwd, logPath),
    changedFiles: fileDelta?.changed ?? [],
    responsePreview: redactSecrets(rawResponseForDisplay).trim().slice(0, 400),
  };
}

export function parseJobsManifest(manifestData) {
  const rawList = Array.isArray(manifestData) ? manifestData : manifestData?.jobs;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    throw new Error('Jobs manifest must be a non-empty JSON array or an object with a "jobs" array.');
  }
  return rawList.map((entry, idx) => validateSingleJobOptions(entry, `worker-${idx + 1}`));
}

async function runParallelJobs(options) {
  const manifestPath = path.resolve(process.cwd(), options.jobsFile);
  const rawManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const jobs = parseJobsManifest(rawManifest);

  console.log(
    `Starting ${jobs.length} parallel AGY job(s) (maxConcurrency=${options.maxConcurrency})...`
  );

  const results = new Array(jobs.length);
  let nextIdx = 0;

  async function workerLoop() {
    while (nextIdx < jobs.length) {
      const currentIdx = nextIdx++;
      const job = jobs[currentIdx];
      const prefix = `${job.name}:${job.model}`;
      results[currentIdx] = await runSingleWorker(job, options, prefix);
    }
  }

  const workers = Array.from(
    { length: Math.min(options.maxConcurrency, jobs.length) },
    () => workerLoop()
  );
  await Promise.all(workers);

  console.log('\n=== Parallel Multi-Agent Summary ===');
  for (const res of results) {
    console.log(
      `- [${res.status}] ${res.name} (${res.model}) · ${res.durationSeconds}s · conversation=${res.conversationId || 'n/a'} · changed=${res.changedFiles.length} · log=${res.logFile}`
    );
  }

  const failed = results.filter((r) => r.exitCode !== 0);
  return failed.length === 0 ? 0 : 1;
}

async function main() {
  let options;
  try {
    options = parseRunnerArgs(process.argv.slice(2));
    if (options.help) {
      console.log(RUNNER_HELP);
      return 0;
    }
    if (options.jobsFile) {
      return await runParallelJobs(options);
    }
    const singleJob = validateSingleJobOptions(options, options.name || 'main');
    const result = await runSingleWorker(singleJob, options, '');
    return result.exitCode;
  } catch (error) {
    console.error(redactSecrets(error?.message || error));
    console.error(RUNNER_HELP);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
