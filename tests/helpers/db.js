// Manages the MongoDB connection for API tests.
//
// Two modes:
//   1. If TEST_MONGODB_URI is set, connect directly (for CI/CD with a real MongoDB).
//   2. Otherwise, start an in-memory MongoDB via mongodb-memory-server (auto-downloads
//      the binary on first run; requires network access to fastdl.mongodb.org).
//
// Usage in each test file:
//   const db = require('../helpers/db');
//   beforeAll(db.connect);
//   beforeEach(db.clearDB);   // or afterEach
//   afterAll(db.disconnect);

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

async function connect() {
  const externalUri = process.env.TEST_MONGODB_URI;
  if (externalUri) {
    await mongoose.connect(externalUri);
  } else {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }
}

async function clearDB() {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}

async function disconnect() {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}

module.exports = { connect, clearDB, disconnect };
