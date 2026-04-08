module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/api/**/*.test.js'],
  testTimeout: 30000,
  forceExit: true,
  setupFiles: ['<rootDir>/tests/helpers/setEnv.js']
};
