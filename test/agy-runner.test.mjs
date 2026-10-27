import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffSnapshots,
  normalizeAgyEvent,
  parseJobsManifest,
  parseRunnerArgs,
  redactSecrets,
  summarizeCheck,
} from '../scripts/agy-runner.mjs';
import {
  evaluateRunsGate,
  parseGitHubRepoFromRemote,
} from '../scripts/github-actions-mcp.mjs';

test('normalizes AGY tool events without storing file contents or tool output', () => {
  const event = normalizeAgyEvent({
    event: 'step_update',
    step_update: {
      conversation_id: 'conversation-1',
      step_index: 2,
      state: 'ACTIVE',
      step_type: 'tool',
      tool_name: 'write_file',
      tool_info: {
        name: 'write_file',
        parameters: { Path: 'src/sso/sso.service.ts', Content: 'private implementation' },
        output: 'file written',
      },
    },
  });

  assert.deepEqual(event, {
    event: 'step_update',
    conversationId: 'conversation-1',
    stepIndex: 2,
    state: 'ACTIVE',
    stepType: 'tool',
    toolName: 'write_file',
    filePath: 'src/sso/sso.service.ts',
    fileActivity: 'write_or_edit',
  });
  assert.equal(JSON.stringify(event).includes('private implementation'), false);
});

test('summarizes TAP and Jest checks accurately', () => {
  assert.deepEqual(
    summarizeCheck('npm run test:sso', '# tests 4\n# pass 4\n# fail 0\n'),
    { kind: 'test', outcome: 'passed', counts: { tests: 4, passed: 4, failed: 0 } }
  );
  assert.deepEqual(
    summarizeCheck('npm test', 'Tests: 1 failed, 12 passed, 13 total'),
    { kind: 'test', outcome: 'failed', counts: { failed: 1, passed: 12 } }
  );
  assert.deepEqual(summarizeCheck('npm run build', 'Command failed with exit code: 1'), {
    kind: 'build',
    outcome: 'failed',
    exitCode: 1,
  });
});

test('redacts credential-shaped values from event text', () => {
  const safe = redactSecrets(
    'Authorization: Bearer abc.def jwt_secret=mysecret encryption_key=enc123 ghp_123456789012345678901234567890'
  );
  assert.equal(safe.includes('abc.def'), false);
  assert.equal(safe.includes('mysecret'), false);
  assert.equal(safe.includes('enc123'), false);
  assert.equal(safe.includes('ghp_123456789012345678901234567890'), false);
});

test('reports only worktree paths that changed since baseline', () => {
  const before = new Map([
    ['preexisting.ts', 'same'],
    ['changed.ts', 'before'],
  ]);
  const after = new Map([
    ['preexisting.ts', 'same'],
    ['changed.ts', 'after'],
    ['new.ts', 'new'],
  ]);

  assert.deepEqual(diffSnapshots(before, after), {
    changed: ['changed.ts', 'new.ts'],
    noLongerDirty: [],
  });
});

test('validates single-agent and parallel multi-agent CLI flags and jobs manifest', () => {
  assert.throws(() => parseRunnerArgs([]), /--task-file/);
  assert.throws(() => parseRunnerArgs(['--task-file', 'task.md']), /--model/);
  assert.throws(
    () =>
      parseRunnerArgs([
        '--task-file',
        'task.md',
        '--model',
        'gemini-4-argon-high',
        '--dangerously-skip-permissions',
      ]),
    /Unknown runner option/
  );

  const parallelOpts = parseRunnerArgs(['--jobs', '.agy-runs/jobs.json', '--max-concurrency', '3']);
  assert.equal(parallelOpts.jobsFile, '.agy-runs/jobs.json');
  assert.equal(parallelOpts.maxConcurrency, 3);

  const jobs = parseJobsManifest([
    {
      name: 'sso-backend',
      cwd: '/Users/hoangvu96z/Documents/vInfiSSO',
      taskFile: '.agy-runs/tasks/sso.md',
      model: 'gemini-4-argon-high',
    },
    {
      name: 'iching-ui',
      cwd: '/Users/hoangvu96z/Documents/IChingNow',
      taskFile: '.agy-runs/tasks/ui.md',
      model: 'gemini-3.8-flash-high',
    },
  ]);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].model, 'gemini-4-argon-high');
  assert.equal(jobs[1].model, 'gemini-3.8-flash-high');
});

test('evaluates GitHub Actions CI & Deploy workflow gate accurately', () => {
  assert.equal(
    parseGitHubRepoFromRemote('https://github.com/hoangvu96z/vInfiSSO.git'),
    'hoangvu96z/vInfiSSO'
  );
  assert.equal(evaluateRunsGate([]).ready, false);
  assert.equal(
    evaluateRunsGate([{ id: 1, name: 'CI', status: 'in_progress', conclusion: null }]).ready,
    false
  );
  const failedGate = evaluateRunsGate([
    { id: 1, name: 'CI', status: 'completed', conclusion: 'success' },
    { id: 2, name: 'Deploy vInfiSSO', status: 'completed', conclusion: 'failure' },
  ]);
  assert.equal(failedGate.ready, true);
  assert.equal(failedGate.passed, false);

  const passedGate = evaluateRunsGate([
    { id: 1, name: 'CI', status: 'completed', conclusion: 'success' },
    { id: 2, name: 'Deploy vInfiSSO', status: 'completed', conclusion: 'success' },
  ]);
  assert.equal(passedGate.ready, true);
  assert.equal(passedGate.passed, true);
  assert.deepEqual(summarizeCheck('npm run ci:wait', `Status: ${passedGate.summary}`), {
    kind: 'ci',
    outcome: 'passed',
  });
});

