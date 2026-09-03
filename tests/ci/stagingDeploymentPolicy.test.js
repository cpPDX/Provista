const {
  classifyRailwayDeployment,
  isDeploymentWindowOpen,
  latestRailwayDeploymentForSha,
  pacificHour
} = require('../../.github/scripts/staging-deployment-policy.cjs');

describe('Railway staging deployment policy', () => {
  describe('Pacific blackout window', () => {
    test.each([
      ['one second before the PDT blackout', '2026-09-02T14:59:59Z', 7, true],
      ['the 8:00 AM PDT boundary', '2026-09-02T15:00:00Z', 8, false],
      ['one second before the 8:00 PM PDT boundary', '2026-09-03T02:59:59Z', 19, false],
      ['the 8:00 PM PDT boundary', '2026-09-03T03:00:00Z', 20, true],
      ['the 8:00 AM PST boundary', '2026-12-01T16:00:00Z', 8, false],
      ['the 8:00 PM PST boundary', '2026-12-02T04:00:00Z', 20, true]
    ])('%s', (_label, timestamp, expectedHour, expectedOpen) => {
      expect(pacificHour(timestamp)).toBe(expectedHour);
      expect(isDeploymentWindowOpen(timestamp)).toBe(expectedOpen);
    });

    test('rejects an invalid timestamp instead of guessing', () => {
      expect(() => isDeploymentWindowOpen('not-a-time')).toThrow('Invalid deployment time');
    });
  });

  describe('Railway deployment reconciliation', () => {
    const targetSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    test('uses the newest exact-SHA deployment', () => {
      const deployment = latestRailwayDeploymentForSha(
        [
          {
            id: 'older',
            status: 'SUCCESS',
            createdAt: '2026-09-02T03:00:00Z',
            meta: { commitHash: targetSha }
          },
          {
            id: 'different-sha',
            status: 'SUCCESS',
            createdAt: '2026-09-02T05:00:00Z',
            meta: { commitHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
          },
          {
            id: 'newer',
            status: 'BUILDING',
            createdAt: '2026-09-02T04:00:00Z',
            meta: { commitHash: targetSha.toUpperCase() }
          }
        ],
        targetSha
      );

      expect(deployment.id).toBe('newer');
      expect(classifyRailwayDeployment(deployment)).toBe('active');
    });

    test.each([
      ['SUCCESS', 'succeeded'],
      ['WAITING', 'active'],
      ['QUEUED', 'active'],
      ['INITIALIZING', 'active'],
      ['BUILDING', 'active'],
      ['DEPLOYING', 'active'],
      ['SKIPPED', 'retryable'],
      ['FAILED', 'retryable'],
      ['CRASHED', 'retryable'],
      ['REMOVED', 'retryable']
    ])('classifies %s as %s', (status, expected) => {
      expect(classifyRailwayDeployment({ status })).toBe(expected);
    });

    test('treats missing history as deployable', () => {
      expect(latestRailwayDeploymentForSha([], targetSha)).toBeNull();
      expect(classifyRailwayDeployment(null)).toBe('missing');
    });

    test('does not accept a SHA prefix as an exact deployed commit', () => {
      const deployment = latestRailwayDeploymentForSha(
        [
          {
            id: 'prefix-only',
            status: 'SUCCESS',
            createdAt: '2026-09-02T03:00:00Z',
            meta: { commitHash: targetSha.slice(0, 7) }
          }
        ],
        targetSha
      );

      expect(deployment).toBeNull();
    });
  });
});
