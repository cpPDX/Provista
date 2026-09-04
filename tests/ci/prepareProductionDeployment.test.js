const {
  prepare,
  revalidate
} = require('../../.github/scripts/prepare-production-deployment.cjs');

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

describe('GitHub production deployment preparation', () => {
  test('reconciles a successful main push during the former blackout window', async () => {
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
      now: new Date('2026-09-04T15:30:00Z')
    });

    expect(core.outputs).toMatchObject({
      action: 'reconcile',
      target_sha: targetSha,
      deployment_id: '9001'
    });
    expect(github.rest.repos.createDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ ref: targetSha, environment: 'railway-production' })
    );
    expect(github.rest.repos.createDeploymentStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({ deployment_id: 9001, state: 'queued' })
    );
  });

  test('still requires successful current main push CI for scheduled reconciliation', async () => {
    const github = createGithub({
      ciRuns: [{ head_sha: targetSha, conclusion: 'failure' }]
    });
    const core = createCore();

    await prepare({
      github,
      context: createContext('schedule'),
      core,
      now: new Date('2026-09-04T15:30:00Z')
    });

    expect(core.outputs.action).toBe('skipped');
    expect(github.rest.repos.createDeployment).not.toHaveBeenCalled();
  });
});

describe('GitHub production deployment revalidation', () => {
  test('allows the current SHA during the former blackout window', async () => {
    const github = createGithub();
    const core = createCore();

    await revalidate({
      github,
      context: createContext('workflow_run'),
      core,
      targetSha,
      deploymentId: 42,
      now: new Date('2026-09-04T15:30:00Z')
    });

    expect(core.outputs.proceed).toBe('true');
    expect(github.rest.repos.createDeploymentStatus).not.toHaveBeenCalled();
  });

  test('still blocks a superseded main SHA', async () => {
    const github = createGithub({ branchSha: newerSha });
    const core = createCore();

    await revalidate({
      github,
      context: createContext('workflow_run'),
      core,
      targetSha,
      deploymentId: 42,
      now: new Date('2026-09-04T15:30:00Z')
    });

    expect(core.outputs.proceed).toBe('false');
    expect(github.rest.repos.createDeploymentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ deployment_id: 42, state: 'inactive' })
    );
  });
});
