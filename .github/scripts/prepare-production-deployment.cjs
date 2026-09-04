'use strict';

const {
  formatPacificTime,
  isDeploymentWindowOpen
} = require('./staging-deployment-policy.cjs');

const APP_CI_WORKFLOW = 'ci.yml';
const DEPLOYMENT_ENVIRONMENT = 'railway-production';
const PRODUCTION_BRANCH = 'main';
const MANAGED_DEPLOYMENT_STATES = new Set(['in_progress', 'pending', 'queued']);

function actionsRunUrl(context) {
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const repository = process.env.GITHUB_REPOSITORY || `${context.repo.owner}/${context.repo.repo}`;
  return `${server}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
}

async function latestDeploymentStatus(github, context, deploymentId) {
  const response = await github.rest.repos.listDeploymentStatuses({
    ...context.repo,
    deployment_id: deploymentId,
    per_page: 1
  });
  return response.data[0] || null;
}

async function setManagedDeploymentStatus({
  github,
  context,
  deploymentId,
  state,
  description,
  environmentUrl,
  autoInactive = false
}) {
  const parameters = {
    ...context.repo,
    deployment_id: Number(deploymentId),
    state,
    description,
    log_url: actionsRunUrl(context),
    auto_inactive: autoInactive
  };

  if (environmentUrl) parameters.environment_url = environmentUrl;
  await github.rest.repos.createDeploymentStatus(parameters);
}

async function currentProductionHead(github, context) {
  const response = await github.rest.repos.getBranch({
    ...context.repo,
    branch: PRODUCTION_BRANCH
  });
  return response.data.commit.sha;
}

async function currentHeadHasGreenPushCi(github, context, targetSha) {
  const response = await github.rest.actions.listWorkflowRuns({
    ...context.repo,
    workflow_id: APP_CI_WORKFLOW,
    branch: PRODUCTION_BRANCH,
    event: 'push',
    status: 'completed',
    per_page: 50
  });

  return response.data.workflow_runs.some((run) => {
    return run.head_sha === targetSha && run.conclusion === 'success';
  });
}

async function managedDeployments(github, context) {
  const response = await github.rest.repos.listDeployments({
    ...context.repo,
    environment: DEPLOYMENT_ENVIRONMENT,
    per_page: 50
  });
  return response.data;
}

async function supersedeOlderDeployments(github, context, deployments, targetSha) {
  for (const deployment of deployments) {
    if (deployment.sha === targetSha) continue;
    const status = await latestDeploymentStatus(github, context, deployment.id);
    if (!status || !MANAGED_DEPLOYMENT_STATES.has(status.state)) continue;

    await setManagedDeploymentStatus({
      github,
      context,
      deploymentId: deployment.id,
      state: 'inactive',
      description: `Superseded by production ${targetSha.slice(0, 7)}`
    });
  }
}

async function reusableDeployment(github, context, deployments, targetSha) {
  const candidates = deployments
    .filter((deployment) => deployment.sha === targetSha)
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at));

  const candidatesWithStatuses = [];
  for (const deployment of candidates) {
    const status = await latestDeploymentStatus(github, context, deployment.id);
    if (status?.state === 'success') return { deployment, status, complete: true };
    candidatesWithStatuses.push({ deployment, status });
  }

  const latest = candidatesWithStatuses[0];
  if (latest?.status && MANAGED_DEPLOYMENT_STATES.has(latest.status.state)) {
    return { ...latest, complete: false };
  }
  return null;
}

async function createQueuedDeployment(github, context, targetSha) {
  const response = await github.rest.repos.createDeployment({
    ...context.repo,
    ref: targetSha,
    task: 'deploy',
    auto_merge: false,
    required_contexts: [],
    environment: DEPLOYMENT_ENVIRONMENT,
    description: 'GitHub-managed Railway production deployment',
    production_environment: true,
    transient_environment: false,
    payload: {
      managedBy: 'provista-production-deployment-queue',
      sourceRunId: process.env.GITHUB_RUN_ID || null
    }
  });
  return response.data;
}

async function summarize(core, { action, targetSha, reason, now }) {
  core.summary.addHeading('Railway production deployment');
  core.summary.addRaw(`- State: **${action}**\n`);
  if (targetSha) core.summary.addRaw(`- Production SHA: \`${targetSha}\`\n`);
  core.summary.addRaw(`- Pacific time: ${formatPacificTime(now)}\n`);
  core.summary.addRaw(`- Detail: ${reason}\n`);
  await core.summary.write();
}

function setPreparationOutputs(core, { action, targetSha = '', deploymentId = '', reason }) {
  core.setOutput('action', action);
  core.setOutput('target_sha', targetSha);
  core.setOutput('deployment_id', String(deploymentId || ''));
  core.setOutput('reason', reason);
}

async function prepare({ github, context, core, now = new Date() }) {
  const eventName = context.eventName;
  let targetSha = '';
  let reason = '';

  if (eventName === 'workflow_run') {
    const workflowRun = context.payload.workflow_run;
    if (
      workflowRun.event !== 'push' ||
      workflowRun.head_branch !== PRODUCTION_BRANCH ||
      workflowRun.conclusion !== 'success'
    ) {
      reason = 'The triggering run was not a successful main push CI run.';
      setPreparationOutputs(core, { action: 'skipped', reason });
      await summarize(core, { action: 'skipped', reason, now });
      return;
    }
    targetSha = workflowRun.head_sha;
  } else {
    targetSha = await currentProductionHead(github, context);
    const isGreen = await currentHeadHasGreenPushCi(github, context, targetSha);
    if (!isGreen) {
      reason = 'The current main head does not have a successful App CI push run.';
      setPreparationOutputs(core, { action: 'skipped', targetSha, reason });
      await summarize(core, { action: 'skipped', targetSha, reason, now });
      return;
    }
  }

  const branchHead = await currentProductionHead(github, context);
  if (branchHead !== targetSha) {
    reason = `Superseded by current main head ${branchHead.slice(0, 7)}.`;
    setPreparationOutputs(core, { action: 'superseded', targetSha, reason });
    await summarize(core, { action: 'superseded', targetSha, reason, now });
    return;
  }

  const deployments = await managedDeployments(github, context);
  await supersedeOlderDeployments(github, context, deployments, targetSha);

  let managedDeployment = await reusableDeployment(github, context, deployments, targetSha);
  if (managedDeployment?.complete) {
    reason = 'GitHub already records this production SHA as successfully deployed.';
    setPreparationOutputs(core, {
      action: 'deployed',
      targetSha,
      deploymentId: managedDeployment.deployment.id,
      reason
    });
    await summarize(core, { action: 'deployed', targetSha, reason, now });
    return;
  }

  if (!managedDeployment) {
    const deployment = await createQueuedDeployment(github, context, targetSha);
    managedDeployment = { deployment, status: null, complete: false };
  }

  const deploymentId = managedDeployment.deployment.id;
  if (isDeploymentWindowOpen(now)) {
    reason = 'The current green main head is ready for Railway production reconciliation.';
    setPreparationOutputs(core, { action: 'reconcile', targetSha, deploymentId, reason });
    await summarize(core, { action: 'reconcile', targetSha, reason, now });
    return;
  }

  reason = 'Deferred during the 8:00 AM–8:00 PM Pacific blackout.';
  await setManagedDeploymentStatus({
    github,
    context,
    deploymentId,
    state: 'queued',
    description: reason
  });
  setPreparationOutputs(core, { action: 'queued', targetSha, deploymentId, reason });
  await summarize(core, { action: 'queued', targetSha, reason, now });
}

async function revalidate({ github, context, core, targetSha, deploymentId, now = new Date() }) {
  const branchHead = await currentProductionHead(github, context);
  if (branchHead !== targetSha) {
    await setManagedDeploymentStatus({
      github,
      context,
      deploymentId,
      state: 'inactive',
      description: `Superseded by main ${branchHead.slice(0, 7)}`
    });
    core.setOutput('proceed', 'false');
    core.setOutput('reason', `Superseded by ${branchHead.slice(0, 7)}.`);
    return;
  }

  if (!isDeploymentWindowOpen(now)) {
    await setManagedDeploymentStatus({
      github,
      context,
      deploymentId,
      state: 'queued',
      description: 'Deferred at the Pacific deployment-window boundary.'
    });
    core.setOutput('proceed', 'false');
    core.setOutput('reason', 'The deployment window closed before Railway reconciliation began.');
    return;
  }

  core.setOutput('proceed', 'true');
  core.setOutput('reason', 'The SHA and Pacific deployment window are still valid.');
}

module.exports = {
  DEPLOYMENT_ENVIRONMENT,
  prepare,
  revalidate,
  setManagedDeploymentStatus
};
