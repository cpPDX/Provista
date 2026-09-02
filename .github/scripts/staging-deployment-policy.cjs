'use strict';

const fs = require('node:fs');

const PACIFIC_TIME_ZONE = 'America/Los_Angeles';
const BLACKOUT_START_HOUR = 8;
const BLACKOUT_END_HOUR = 20;
const ACTIVE_RAILWAY_STATUSES = new Set([
  'BUILDING',
  'DEPLOYING',
  'INITIALIZING',
  'QUEUED',
  'WAITING'
]);

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid deployment time: ${value}`);
  }
  return date;
}

function pacificHour(value = new Date()) {
  const hourPart = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIME_ZONE,
    hour: '2-digit',
    hourCycle: 'h23'
  })
    .formatToParts(asDate(value))
    .find((part) => part.type === 'hour');

  if (!hourPart) {
    throw new Error('Unable to resolve the Pacific deployment hour');
  }

  return Number(hourPart.value);
}

function isDeploymentWindowOpen(value = new Date()) {
  const hour = pacificHour(value);
  return hour < BLACKOUT_START_HOUR || hour >= BLACKOUT_END_HOUR;
}

function formatPacificTime(value = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(asDate(value));
}

function normalizeSha(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function latestRailwayDeploymentForSha(deployments, targetSha) {
  const normalizedTarget = normalizeSha(targetSha);
  if (!normalizedTarget || !Array.isArray(deployments)) {
    return null;
  }

  return deployments
    .filter((deployment) => normalizeSha(deployment?.meta?.commitHash) === normalizedTarget)
    .sort((left, right) => {
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    })[0] || null;
}

function classifyRailwayDeployment(deployment) {
  if (!deployment) return 'missing';

  const status = String(deployment.status || '').toUpperCase();
  if (status === 'SUCCESS') return 'succeeded';
  if (ACTIVE_RAILWAY_STATUSES.has(status)) return 'active';
  return 'retryable';
}

function inspectRailwayDeployments(filePath, targetSha) {
  const deployments = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const deployment = latestRailwayDeploymentForSha(deployments, targetSha);
  const state = classifyRailwayDeployment(deployment);

  process.stdout.write(`state=${state}\n`);
  if (deployment?.id) process.stdout.write(`deployment_id=${deployment.id}\n`);
  if (deployment?.status) process.stdout.write(`railway_status=${deployment.status}\n`);
}

if (require.main === module) {
  const [command, filePath, targetSha] = process.argv.slice(2);
  if (command !== 'inspect-railway' || !filePath || !targetSha) {
    process.stderr.write(
      'Usage: node staging-deployment-policy.cjs inspect-railway <deployments.json> <sha>\n'
    );
    process.exitCode = 2;
  } else {
    inspectRailwayDeployments(filePath, targetSha);
  }
}

module.exports = {
  BLACKOUT_END_HOUR,
  BLACKOUT_START_HOUR,
  PACIFIC_TIME_ZONE,
  classifyRailwayDeployment,
  formatPacificTime,
  isDeploymentWindowOpen,
  latestRailwayDeploymentForSha,
  pacificHour
};
