'use strict';

const fs = require('node:fs');

const BULK_ADVISORY_URL = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

function packageNameFromPath(packagePath, metadata) {
  if (metadata?.name) return metadata.name;
  const marker = 'node_modules/';
  const index = packagePath.lastIndexOf(marker);
  if (index < 0) return '';
  const remainder = packagePath.slice(index + marker.length);
  if (!remainder) return '';
  const parts = remainder.split('/');
  return parts[0]?.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function buildProductionInventory(lockfile) {
  const inventory = new Map();
  for (const [packagePath, metadata] of Object.entries(lockfile?.packages || {})) {
    if (!packagePath || metadata?.dev === true || !metadata?.version) continue;
    const name = packageNameFromPath(packagePath, metadata);
    if (!name) continue;
    if (!inventory.has(name)) inventory.set(name, new Set());
    inventory.get(name).add(String(metadata.version));
  }

  return Object.fromEntries(
    [...inventory.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, versions]) => [name, [...versions].sort()])
  );
}

function blockingAdvisories(report) {
  const findings = [];
  for (const [packageName, advisories] of Object.entries(report || {})) {
    for (const advisory of Array.isArray(advisories) ? advisories : []) {
      const severity = String(advisory?.severity || '').toLowerCase();
      if (!BLOCKING_SEVERITIES.has(severity)) continue;
      findings.push({
        packageName,
        severity,
        title: advisory?.title || 'Unnamed advisory',
        url: advisory?.url || '',
        vulnerableVersions: advisory?.vulnerable_versions || ''
      });
    }
  }
  return findings;
}

async function fetchBulkAdvisories(payload) {
  const response = await fetch(BULK_ADVISORY_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': `provista-ci node/${process.version}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000)
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`npm Bulk Advisory endpoint returned ${response.status}: ${body.slice(0, 500)}`);
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`npm Bulk Advisory endpoint returned invalid JSON: ${error.message}`);
  }
}

async function main() {
  const lockfile = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  const payload = buildProductionInventory(lockfile);
  const packageCount = Object.keys(payload).length;
  if (!packageCount) throw new Error('No production dependencies found in package-lock.json');

  console.log(`Auditing ${packageCount} production package names via npm Bulk Advisory API...`);
  const report = await fetchBulkAdvisories(payload);
  const findings = blockingAdvisories(report);

  if (!findings.length) {
    console.log('No high or critical production dependency advisories found.');
    return;
  }

  console.error(`Found ${findings.length} blocking production dependency advisory(s):`);
  for (const finding of findings) {
    console.error(`- [${finding.severity.toUpperCase()}] ${finding.packageName}: ${finding.title}`);
    if (finding.vulnerableVersions) console.error(`  vulnerable: ${finding.vulnerableVersions}`);
    if (finding.url) console.error(`  ${finding.url}`);
  }
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Production dependency audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  blockingAdvisories,
  buildProductionInventory,
  packageNameFromPath
};
