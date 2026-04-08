// Runs in each Jest worker before any test file is loaded.
// Sets required environment variables so server.js can be required without crashing.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-jest';
process.env.NODE_ENV = 'test';
