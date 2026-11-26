'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../backend/db');
const router = require('../backend/routes/communications');

const deletionRoute = router.stack.find(layer =>
  layer.route?.path === '/:schoolId/result-publications/:publicationId' &&
  layer.route.methods.delete
);
const handler = deletionRoute.route.stack.at(-1).handle;

function installDatabaseMock({ pending = 0 } = {}) {
  const statements = [];
  const originalQuery = db.query;
  const originalConnect = db.pool.connect;
  db.query = async sql => {
    if (sql.includes('uq_comm_published_results_once')) {
      return { rows: [{ context_columns: 2, duplicate_guard: true }] };
    }
    if (sql.includes("to_regclass('result_publications')")) {
      return { rows: [{ publications: true, records: true, class_column: true, recipient_columns: 2 }] };
    }
    throw new Error('Unexpected schema query: ' + sql);
  };
  db.pool.connect = async () => ({
    async query(sql) {
      statements.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.includes('SELECT id FROM result_publications')) return { rows: [{ id: 'pub-1' }] };
      if (sql.includes('COUNT(*)::int count FROM communication_messages')) return { rows: [{ count: pending }] };
      if (sql.includes('COUNT(*)::int count FROM result_publication_records')) return { rows: [{ count: 3 }] };
      if (sql.includes('DELETE FROM communication_messages')) return { rowCount: 4, rows: [] };
      if (sql.includes('DELETE FROM result_publications')) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    },
    release() {}
  });
  return {
    statements,
    restore() {
      db.query = originalQuery;
      db.pool.connect = originalConnect;
    }
  };
}

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('publication deletion removes associated records and blocks in-flight SMS', async () => {
  const successDb = installDatabaseMock();
  try {
    const success = response();
    await handler({ params: { schoolId: 'school-1', publicationId: 'pub-1' } }, success);
    assert.equal(success.statusCode, 200);
    assert.equal(success.payload.deleted_learners, 3);
    assert.equal(success.payload.deleted_notifications, 4);
    assert.ok(successDb.statements.findIndex(sql => sql.startsWith('DELETE FROM communication_messages')) <
      successDb.statements.findIndex(sql => sql.startsWith('DELETE FROM result_publications')));
    assert.equal(successDb.statements.at(-1), 'COMMIT');
  } finally {
    successDb.restore();
  }

  const pendingDb = installDatabaseMock({ pending: 1 });
  try {
    const blocked = response();
    await handler({ params: { schoolId: 'school-1', publicationId: 'pub-1' } }, blocked);
    assert.equal(blocked.statusCode, 409);
    assert.match(blocked.payload.error, /queued or sending SMS/);
    assert.ok(pendingDb.statements.includes('ROLLBACK'));
    assert.equal(pendingDb.statements.some(sql => sql.startsWith('DELETE FROM')), false);
  } finally {
    pendingDb.restore();
  }
});
