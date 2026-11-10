// Imported FIRST by every test file. Tests drop and recreate all tables, so they must never touch your real database:
// they ignore DATABASE_URL completely and use TEST_DATABASE_URL (default: a local database called shushop_test).
const url = process.env.TEST_DATABASE_URL || 'postgres://shushop:shushop@localhost:5432/shushop_test';
const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
if (!isLocal && process.env.ALLOW_REMOTE_TEST_DB !== '1') {
  throw new Error('Refusing to run the tests against a non-local database (they erase all tables). Set ALLOW_REMOTE_TEST_DB=1 if you really mean it.');
}
process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';
