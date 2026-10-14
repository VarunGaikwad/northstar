process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/northstar_test";
process.env.JWT_SECRET ??= "northstar-test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "northstar-test-refresh-secret-at-least-32-bytes";
process.env.UNSPLASH_ACCESS_KEY ??= "northstar-test-unsplash-key";
process.env.CRON_SECRET ??= "northstar-test-cron-secret";
