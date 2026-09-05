const {
  prepare,
  revalidate
} = require('../../.github/scripts/prepare-staging-deployment.cjs');

const targetSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const newerSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function createCore() {
  const outputs = {};
  const summary = {
    addHeading: jest.fn(),
    addRaw: jest.fn(),
    write: jest.fn().mockResolvedValue(undefined)
  };
  summary.addHeading.mockReturnValue(summary);
  summary.addRaw.mockReturnValue(summary);

  return {
    outputs,
    setOutput: jest.fn((name, value) => {
      outputs[name] = String(value);
    }),
    summary
  };
}

function createContext(eventName, workflowRun = null) {
  return {
    eventName,
    payload: workflowRun ? { workflow_run: workflowRun } : {},
    repo: { owner: 'cpPDX', repo: 'Provista' }
  };
}

function createGithub({
  branchSha = targetSha,
  ciRuns = [],
  deployments = [],
  statuses = {},
  createdDeploymentId = 9001
} = {}) {
  return {
    rest: {
      actions: {
        listWorkflowRuns: jest.fn().mockResolvedValue({
          data: { workflow_runs: ciRuns }
        })
      },
      repos: {
        createDeployment: jest.fn().mockResolvedValue({
          data: { id: createdDeploymentId, sha: branchSha, created_at: new Date().toISOString() }
        }),
        createDeploymentStatus: jest.fn().mockResolvedValue({ data: {} }),
        getBranch: jest.fn().mockResolvedValue({
          data: { commit: { sha: branchSha } }
        }),
        listDeployments: jest.fn().mockResolvedValue({ data: deployments }),
        listDeploymentStatuses: jest.fn().mockImplementation(({ deployment_id: deploymentId }) => {
          const state = statuses[deploymentId];
          return Promise.resolve({ data: state ? [{ state }] : [] });
        })
      }
    }
  };
}

async function withRunAttempt(value, callback) {
  const previous = process.env.GITHUB_RUN_ATTEMPT;
  process.env.GITHUB_RUN_ATTEMPT = String(value);
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.GITHUB_RUN_ATTEMPT;
    else process.env.GITHUB_RUN_ATTEMPT = previous;
  }
}

describe('GitHub staging deployment preparation', () => {
  test('queues a successful staging push without calling Railway during the blackout', async () => {
    const github = createGithub();
    const core = createCore();
    const context = createContext('workflow_run', {
      event: 'push',
      head_branch: 'staging',
      head_sha: targetSha,
      conclusion: 'success'
    });

    await prepare({
      github,
      context,
      core,
      now: new Date('2026-09-02T19:00:00Z')
    });

    expect(core.outputs).toMatchObject({
      action: 'queued',
      target_sha: targetSha,
      deployment_id: '9001'
    });
    expect(github.rest.repos.createDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ ref: targetSha, environment: 'railway-staging' })
    );
    expect(github.rest.repos.createDeploymentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ deployment_id: 9001, state: 'queued' })
    );
  });

  test('reconciles a successful current-head staging push immediately when the window is open', async () => {
    const github = createGithub();
    const core = createCore();
    const context = createContext('workflow_run', {
      event: 'push',
      head_branch: 'staging',
      head_sha: targetSha,
      conclusion: 'success'
    });

    await prepare({
      github,
      context,
      core,
      now: new Date('2026-09-03T03:07:00Z')
    });

    expect(core.outputs).toMatchObject({
      action: 'reconcile',
      target_sha: targetSha,
      deployment_id: '9001'
    });
    expect(core.outputs.reason).toContain('immediate Railway reconciliation');
    expect(github.rest.repos.createDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ ref: targetSha, environment: 'railway-staging' })
    );
    expect(github.rest.repos.createDeploymentStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({ deployment_id: 9001, state: 'queued' })
    );
  });

  test('skips a failed staging push workflow run', async () => {
    const github = createGithub();
    const core = createCore();
    const context = createContext('workflow_run', {
      event: 'push',
      head_branch: 'staging',
      head_sha: targetSha,
      conclusion: 'failure'
    });

    await prepare({
      github,
      context,
      core,
      now: new Date('2026-09-03T03:07:00Z')
    });

    expect(core.outputs.action).toBe('skipped');
    expect(github.rest.repos.listDeployments).not.toHaveBeenCalled();
    expect(github.rest.repos.createDeployment).not.toHaveBeenCalled();
  });

  test('skips a successful workflow run that is not for staging', async () => {
    const github = createGithub();
    const core = createCore();
    const context = createContext('workflow_run', {
      event: 'push',
      head_branch: 'main',
      head_sha: targetSha,
      conclusion: 'success'
    });

    await prepare({
      github,
      context,
      core,
      now: new Date('2026-09-03T03:07:00Z')
    });

    expect(core.outputs.action).toBe('skipped');
    expect(github.rest.repos.listDeployments).not.toHaveBeenCalled();
    expect(github.rest.repos.createDeployment).not.toHaveBeenCalled();
  });

  test('does not reconcile a successful staging CI run after staging has advanced', async () => {
    const github = createGithub({ branchSha: newerSha });
    const core = createCore();
    const context = createContext('workflow_run', {
      event: 'push',
      head_branch: 'staging',
      head_sha: targetSha,
      conclusion: 'success'
    });

    await prepare({
      github,
      context,
      core,
      now: new Date('2026-09-03T03:07:00Z')
    });

    expect(core.outputs).toMatchObject({
      action: 'superseded',
      target_sha: targetSha
    });
    expect(github.rest.repos.listDeployments).not.toHaveBeenCalled();
    expect(github.rest.repos.createDeployment).not.toHaveBeenCalled();
  });

  test('keeps an automatic schedule deferred during the blackout', async () => {
    const deployments = [{ id: 42, sha: targetSha, created_at: '2026-09-02T18:00:00Z' }];
    const github = createGithub({
      ciRuns: [{ head_sha: targetSha, conclusion: 'success' }],
      deployments,
      statuses: { 42: 'queued' }
    });
    const core = createCore();

    await withRunAttempt(1, () => prepare({
      github,
      context: createContext('schedule'),
      core,
      now: new Date('2026-09-02T19:00:00Z')
    }));

    expect(core.outputs).toMatchObject({
      action: 'queued',
      target_sha: targetSha,
      deployment_id: '42'
    });
  });

  test('allows an explicit manual rerun of the schedule during the blackout', async () => {
    const deployments = [{ id: 42, sha: targetSha, created_at: '2026-09-02T18:00:00Z' }];
    const github = createGithub({
      ciRuns: [{ head_sha: targetSha, conclusion: 'success' }],
      deployments,
      statuses: { 42: 'queued' }
    });
    const core = createCore();

    await withRunAttempt(2, () => prepare({
      github,
      context: createContext('schedule'),
      core,
      now: new Date('2026-09-02T19:00:00Z')
    }));

    expect(core.outputs).toMatchObject({
      action: 'reconcile',
      target_sha: targetSha,
      deployment_id: '42'
    });
    expect(core.outputs.reason).toContain('explicit manual rerun');
  });

  test('reconciles the current head on an allowed-window schedule when push CI is green', async () => {
    const deployments = [{ id: 42, sha: targetSha, created_at: '2026-09-02T18:00:00Z' }];
    const github = createGithub({
      ciRuns: [{ head_sha: targetSha, conclusion: 'success' }],
      deployments,
      statuses: { 42: 'queued' }
    });
    const core = createCore();

    await prepare({
      github,
      context: createContext('schedule'),
      core,
      now: new Date('2026-09-03T03:07:00Z')
    });

    expect(core.outputs).toMatchObject({
      action: 'reconcile',
      target_sha: targetSha,
      deployment_id: '42'
    });
    expect(github.rest.repos.createDeployment).not.toHaveBeenCalled();
  });

  test('does not deploy a staging head without successful post-merge CI', async () => {
    const github = createGithub({
      ciRuns: [{ head_sha: targetSha, conclusion: 'failure' }]
    });
    const core = createCore();

    await prepare({
      github,
      context: createContext('schedule'),
      core,
      now: new Date('2026-09-03T03:07:00Z')
    });

    expect(core.outputs.action).toBe('skipped');
    expect(github.rest.repos.listDeployments).not.toHaveBeenCalled();
    expect(github.rest.repos.createDeployment).not.toHaveBeenCalled();
  });

  test('marks an older queued SHA inactive before recording the current head', async () => {
    const deployments = [
      { id: 11, sha: newerSha, created_at: '2026-09-02T18:00:00Z' }
    ];
    const github = createGithub({ deployments, statuses: { 11: 'queued' } });
    const core = createCore();
    const context = createContext('workflow_run', {
      event: 'push',
      head_branch: 'staging',
      head_sha: targetSha,
      conclusion: 'success'
    });

    await prepare({
      github,
      context,
      core,
      now: new Date('2026-09-02T19:00:00Z')
    });

    expect(github.rest.repos.createDeploymentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ deployment_id: 11, state: 'inactive' })
    );
    expect(github.rest.repos.createDeploymentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ deployment_id: 9001, state: 'queued' })
    );
  });

  test('does not create another deployment record for an already successful SHA', async () => {
    const deployments = [{ id: 77, sha: targetSha, created_at: '2026-09-02T18:00:00Z' }];
    const github = createGithub({
      ciRuns: [{ head_sha: targetSha, conclusion: 'success' }],
      deployments,
      statuses: { 77: 'success' }
    });
    const core = createCore();

    await prepare({
      github,
      context: createContext('schedule'),
      core,
      now: new Date('2026-09-03T03:07:00Z')
    });

    expect(core.outputs.action).toBe('deployed');
    expect(core.outputs.deployment_id).toBe('77');
    expect(github.rest.repos.createDeployment).not.toHaveBeenCalled();
  });
});

describe('GitHub staging deployment revalidation', () => {
  test('marks a queued SHA inactive when staging advances', async () => {
    const github = createGithub({ branchSha: newerSha });
    const core = createCore();

    await revalidate({
      github,
      context: createContext('schedule'),
      core,
      targetSha,
      deploymentId: 42,
      now: new Date('2026-09-03T03:07:00Z')
    });

    expect(core.outputs.proceed).toBe('false');
    expect(github.rest.repos.createDeploymentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ deployment_id: 42, state: 'inactive' })
    );
  });

  test('allows an immediate workflow-run reconciliation while the window stays open', async () => {
    const github = createGithub();
    const core = createCore();
    const context = createContext('workflow_run', {
      event: 'push',
      head_branch: 'staging',
      head_sha: targetSha,
      conclusion: 'success'
    });

    await revalidate({
      github,
      context,
      core,
      targetSha,
      deploymentId: 42,
      now: new Date('2026-09-03T03:07:00Z')
    });

    expect(core.outputs.proceed).toBe('true');
    expect(github.rest.repos.createDeploymentStatus).not.toHaveBeenCalled();
  });

  test('rechecks the blackout immediately before Railway access', async () => {
    const github = createGithub();
    const core = createCore();

    await withRunAttempt(1, () => revalidate({
      github,
      context: createContext('schedule'),
      core,
      targetSha,
      deploymentId: 42,
      now: new Date('2026-09-02T15:00:00Z')
    }));

    expect(core.outputs.proceed).toBe('false');
    expect(github.rest.repos.createDeploymentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ deployment_id: 42, state: 'queued' })
    );
  });

  test('allows the explicit manual rerun through final blackout revalidation', async () => {
    const github = createGithub();
    const core = createCore();

    await withRunAttempt(2, () => revalidate({
      github,
      context: createContext('schedule'),
      core,
      targetSha,
      deploymentId: 42,
      now: new Date('2026-09-02T15:00:00Z')
    }));

    expect(core.outputs.proceed).toBe('true');
    expect(core.outputs.reason).toContain('explicit manual rerun');
    expect(github.rest.repos.createDeploymentStatus).not.toHaveBeenCalled();
  });
});
