#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { redactSecrets } from './agy-runner.mjs';

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

export function parseGitHubRepoFromRemote(remoteUrl) {
  const text = String(remoteUrl ?? '').trim();
  const match = text.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/i);
  return match ? match[1] : null;
}

export function detectRepoSlug(cwd = process.cwd()) {
  const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const slug = parseGitHubRepoFromRemote(remoteUrl);
  if (!slug) {
    throw new Error(`Could not parse GitHub owner/repo from origin remote: ${remoteUrl}`);
  }
  return slug;
}

export function resolveCommitSha(ref = 'HEAD', cwd = process.cwd()) {
  return execFileSync('git', ['rev-parse', ref], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

export function resolveGitHubToken() {
  const envToken = process.env.GITHUB_PAT_TOKEN || process.env.GITHUB_TOKEN;
  if (envToken && envToken.trim()) return envToken.trim();

  const res = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  if (res.status === 0 && res.stdout) {
    const pwLine = res.stdout.split('\n').find((line) => line.startsWith('password='));
    if (pwLine) {
      const token = pwLine.slice('password='.length).trim();
      if (token) return token;
    }
  }
  throw new Error(
    'No GitHub token found in GITHUB_PAT_TOKEN, GITHUB_TOKEN, or git credential helper (osxkeychain).'
  );
}

async function githubFetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'spiritnow-github-actions-harness',
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`GitHub API ${response.status} for ${url}: ${redactSecrets(body).slice(0, 300)}`);
  }
  return response.json();
}

async function githubFetchText(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'spiritnow-github-actions-harness',
    },
  });
  if (!response.ok) {
    return `Could not fetch logs (HTTP ${response.status})`;
  }
  return response.text();
}

export function evaluateRunsGate(runs) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return {
      ready: false,
      passed: false,
      summary: 'No workflow runs found for this commit yet.',
      runs: [],
    };
  }

  const normalizedRuns = runs.map((run) => ({
    id: run.id,
    name: run.name || run.display_title || 'Workflow',
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
    headSha: run.head_sha,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  }));

  const pending = normalizedRuns.filter((r) => r.status !== 'completed');
  if (pending.length > 0) {
    return {
      ready: false,
      passed: false,
      summary: `${pending.length}/${normalizedRuns.length} workflow run(s) still in progress (${pending.map((p) => `${p.name}:${p.status}`).join(', ')}).`,
      runs: normalizedRuns,
    };
  }

  const failed = normalizedRuns.filter(
    (r) => r.conclusion !== 'success' && r.conclusion !== 'skipped'
  );
  if (failed.length > 0) {
    return {
      ready: true,
      passed: false,
      summary: `FAILED: ${failed.map((f) => `${f.name} (${f.conclusion})`).join(', ')}`,
      runs: normalizedRuns,
    };
  }

  return {
    ready: true,
    passed: true,
    summary: `SUCCESS: All ${normalizedRuns.length} workflow run(s) passed (${normalizedRuns.map((r) => r.name).join(', ')}).`,
    runs: normalizedRuns,
  };
}

export async function inspectCommitRuns({ repo, sha, token }) {
  const runsData = await githubFetchJson(
    `https://api.github.com/repos/${repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=20`,
    token
  );
  const gate = evaluateRunsGate(runsData.workflow_runs || []);
  const detailedRuns = [];

  for (const run of gate.runs) {
    const jobsData = await githubFetchJson(
      `https://api.github.com/repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`,
      token
    );
    const jobs = (jobsData.jobs || []).map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      htmlUrl: job.html_url,
      failedSteps: (job.steps || [])
        .filter((s) => s.conclusion && s.conclusion !== 'success' && s.conclusion !== 'skipped')
        .map((s) => ({ number: s.number, name: s.name, conclusion: s.conclusion })),
    }));
    detailedRuns.push({ ...run, jobs });
  }

  return {
    repo,
    sha,
    ready: gate.ready,
    passed: gate.passed,
    summary: gate.summary,
    runs: detailedRuns,
  };
}

export async function fetchFailedJobLogs({ repo, jobId, token, tailLines = 80 }) {
  const rawLog = await githubFetchText(
    `https://api.github.com/repos/${repo}/actions/jobs/${jobId}/logs`,
    token
  );
  const lines = redactSecrets(rawLog).split('\n');
  return lines.slice(-tailLines).join('\n');
}

export async function waitForCommitCi({
  repo,
  sha,
  token,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onProgress = null,
}) {
  const startedAt = Date.now();
  let seenRuns = false;

  while (Date.now() - startedAt < timeoutMs) {
    const report = await inspectCommitRuns({ repo, sha, token });
    if (report.runs.length > 0) seenRuns = true;
    if (onProgress) onProgress(report);

    if (report.ready) {
      if (!report.passed) {
        for (const run of report.runs) {
          for (const job of run.jobs || []) {
            if (job.conclusion && job.conclusion !== 'success' && job.conclusion !== 'skipped') {
              job.logTail = await fetchFailedJobLogs({ repo, jobId: job.id, token });
            }
          }
        }
      }
      return report;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return {
    repo,
    sha,
    ready: false,
    passed: false,
    summary: `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for workflow runs (${seenRuns ? 'runs still active' : 'no runs appeared'}).`,
    runs: [],
  };
}

export function parseCiArgs(argv) {
  const options = {
    mode: 'status', // 'status' | 'wait' | 'mcp'
    repo: null,
    sha: 'HEAD',
    cwd: process.cwd(),
    timeoutSec: 900,
    pollSec: 10,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--wait') {
      options.mode = 'wait';
    } else if (arg === '--status') {
      options.mode = 'status';
    } else if (arg === '--mcp') {
      options.mode = 'mcp';
    } else if (arg === '--repo') {
      options.repo = argv[++i];
    } else if (arg === '--sha') {
      options.sha = argv[++i];
    } else if (arg === '--cwd') {
      options.cwd = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === '--timeout-sec') {
      options.timeoutSec = Number(argv[++i]);
    } else if (arg === '--poll-sec') {
      options.pollSec = Number(argv[++i]);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function startMcpServer() {
  const tools = [
    {
      name: 'github_actions_status',
      description:
        'Inspect GitHub Actions workflow runs and jobs for a repository and commit SHA (defaults to current repo and HEAD).',
      inputSchema: {
        type: 'object',
        properties: {
          repo: {
            type: 'string',
            description: 'GitHub owner/repo (e.g. hoangvu96z/IChingNow or hoangvu96z/vInfiSSO). Optional.',
          },
          sha: {
            type: 'string',
            description: 'Commit SHA or git ref (default: HEAD).',
          },
          cwd: {
            type: 'string',
            description: 'Repository working directory if repo is omitted.',
          },
        },
      },
    },
    {
      name: 'github_actions_wait',
      description:
        'Wait for all GitHub Actions CI & Deploy workflows for a commit SHA to complete and return pass/fail status plus any failed job logs.',
      inputSchema: {
        type: 'object',
        properties: {
          repo: {
            type: 'string',
            description: 'GitHub owner/repo (e.g. hoangvu96z/IChingNow or hoangvu96z/vInfiSSO). Optional.',
          },
          sha: {
            type: 'string',
            description: 'Commit SHA or git ref (default: HEAD).',
          },
          cwd: {
            type: 'string',
            description: 'Repository working directory if repo is omitted.',
          },
          timeoutSec: {
            type: 'number',
            description: 'Max seconds to wait (default: 600).',
          },
        },
      },
    },
  ];

  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }

    const sendResult = (result) => {
      if (req.id === undefined) return;
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: req.id, result })}\n`);
    };
    const sendError = (code, message) => {
      if (req.id === undefined) return;
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code, message: redactSecrets(message) } })}\n`
      );
    };

    try {
      if (req.method === 'initialize') {
        sendResult({
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'spiritnow-github-actions-mcp', version: '1.0.0' },
        });
      } else if (req.method === 'notifications/initialized') {
        // Notification
      } else if (req.method === 'tools/list') {
        sendResult({ tools });
      } else if (req.method === 'tools/call') {
        const name = req.params?.name;
        const args = req.params?.arguments || {};
        const targetCwd = args.cwd ? path.resolve(process.cwd(), args.cwd) : process.cwd();
        const repo = args.repo || detectRepoSlug(targetCwd);
        const sha = resolveCommitSha(args.sha || 'HEAD', targetCwd);
        const token = resolveGitHubToken();

        if (name === 'github_actions_status') {
          const report = await inspectCommitRuns({ repo, sha, token });
          sendResult({
            content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
            isError: !report.passed && report.ready,
          });
        } else if (name === 'github_actions_wait') {
          const timeoutMs = (Number(args.timeoutSec) || 600) * 1000;
          const report = await waitForCommitCi({
            repo,
            sha,
            token,
            pollIntervalMs: 10_000,
            timeoutMs,
          });
          sendResult({
            content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
            isError: !report.passed,
          });
        } else {
          sendError(-32601, `Unknown tool: ${name}`);
        }
      } else {
        sendResult({});
      }
    } catch (error) {
      sendError(-32000, error?.message || String(error));
    }
  });
}

function printReport(report) {
  console.log(`GitHub Actions · ${report.repo} @ ${report.sha.slice(0, 7)}`);
  console.log(`Status: ${report.summary}`);
  for (const run of report.runs) {
    console.log(
      `  • [${run.conclusion || run.status}] ${run.name} (${run.event}) — ${run.htmlUrl}`
    );
    for (const job of run.jobs || []) {
      console.log(`      - [${job.conclusion || job.status}] ${job.name}`);
      for (const step of job.failedSteps || []) {
        console.log(`          ✖ Step #${step.number}: ${step.name} (${step.conclusion})`);
      }
      if (job.logTail) {
        console.log(`      --- Failed Job Log Tail (${job.name}) ---`);
        console.log(job.logTail);
        console.log(`      -----------------------------------------`);
      }
    }
  }
}

async function main() {
  try {
    const options = parseCiArgs(process.argv.slice(2));
    if (options.help) {
      console.log(
        'Usage: node scripts/github-actions-mcp.mjs [--status | --wait | --mcp] [--repo owner/name] [--sha HEAD] [--timeout-sec 900]'
      );
      return 0;
    }
    if (options.mode === 'mcp') {
      startMcpServer();
      return 0;
    }

    const repo = options.repo || detectRepoSlug(options.cwd);
    const sha = resolveCommitSha(options.sha, options.cwd);
    const token = resolveGitHubToken();

    if (options.mode === 'status') {
      const report = await inspectCommitRuns({ repo, sha, token });
      printReport(report);
      return report.ready && report.passed ? 0 : 1;
    }

    console.log(`Waiting for GitHub Actions on ${repo} @ ${sha.slice(0, 7)}...`);
    let lastSummary = '';
    const report = await waitForCommitCi({
      repo,
      sha,
      token,
      pollIntervalMs: options.pollSec * 1000,
      timeoutMs: options.timeoutSec * 1000,
      onProgress: (progress) => {
        if (progress.summary !== lastSummary) {
          lastSummary = progress.summary;
          console.log(`[${new Date().toISOString()}] ${progress.summary}`);
        }
      },
    });
    printReport(report);
    return report.ready && report.passed ? 0 : 1;
  } catch (error) {
    console.error(redactSecrets(error?.message || String(error)));
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const code = await main();
  if (typeof code === 'number' && !process.argv.includes('--mcp')) {
    process.exitCode = code;
  }
}
