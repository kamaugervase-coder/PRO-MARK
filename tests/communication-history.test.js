'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../backend/db');
const router = require('../backend/routes/communications');

const sendHandler = router.stack.find(layer =>
  layer.route?.path === '/:schoolId/send' && layer.route.methods.post
).route.stack.at(-1).handle;
const deleteHandler = router.stack.find(layer =>
  layer.route?.path === '/:schoolId/history/:messageId' && layer.route.methods.delete
).route.stack.at(-1).handle;

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('manual communication recipient requires a valid number and consent', async () => {
  const invalidPhone = response();
  await sendHandler({
    params: { schoolId: 'school-1' },
    body: { recipient_phone: '123', consent_confirmed: true, message: 'Hello' }
  }, invalidPhone);
  assert.equal(invalidPhone.statusCode, 400);
  assert.match(invalidPhone.payload.error, /valid phone number/);

  const missingConsent = response();
  await sendHandler({
    params: { schoolId: 'school-1' },
    body: { recipient_phone: '0712345678', message: 'Hello' }
  }, missingConsent);
  assert.equal(missingConsent.statusCode, 400);
  assert.match(missingConsent.payload.error, /agreed to receive SMS/);
});

test('manual communication send stores the normalized number and consent', async () => {
  const originalQuery = db.query;
  const originalProvider = process.env.SMS_PROVIDER;
  delete process.env.SMS_PROVIDER;
  const statements = [];
  db.query = async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes('SELECT id FROM communication_messages')) return { rows: [] };
    if (sql.includes('INSERT INTO communication_messages')) {
      return {
        rows: [{
          status: values[6],
          recipient_phone: values[10],
          recipient_consent_confirmed: values[11]
        }]
      };
    }
    throw new Error('Unexpected query: ' + sql);
  };

  try {
    const res = response();
    await sendHandler({
      params: { schoolId: 'school-1' },
      user: { user_id: 'admin-1' },
      body: {
        recipient_phone: '0712 345 678',
        consent_confirmed: true,
        message: 'School update'
      }
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.queued, 1);
    assert.equal(statements[1].values[1], null);
    assert.equal(statements[1].values[2], null);
    assert.equal(statements[1].values[3], null);
    assert.equal(statements[1].values[10], '+254712345678');
    assert.equal(statements[1].values[11], true);
  } finally {
    db.query = originalQuery;
    if (originalProvider === undefined) delete process.env.SMS_PROVIDER;
    else process.env.SMS_PROVIDER = originalProvider;
  }
});

test('communication history cannot be deleted while its SMS is in flight', async () => {
  const originalConnect = db.pool.connect;
  const statements = [];
  db.pool.connect = async () => ({
    async query(sql) {
      statements.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.startsWith('SELECT id,status FROM communication_messages')) {
        return { rows: [{ id: 'message-1', status: 'SENDING' }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {}
  });

  try {
    const res = response();
    await deleteHandler({
      params: { schoolId: 'school-1', messageId: 'message-1' }
    }, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.payload.error, /finish before permanently deleting/);
    assert.ok(statements.includes('ROLLBACK'));
    assert.equal(statements.some(sql => sql.startsWith('DELETE FROM')), false);
  } finally {
    db.pool.connect = originalConnect;
  }
});

test('completed communication history can be permanently deleted within its school', async () => {
  const originalConnect = db.pool.connect;
  const statements = [];
  db.pool.connect = async () => ({
    async query(sql, values) {
      statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
      if (sql.startsWith('SELECT id,status FROM communication_messages')) {
        return { rows: [{ id: 'message-1', status: 'SENT' }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  });

  try {
    const res = response();
    await deleteHandler({
      params: { schoolId: 'school-1', messageId: 'message-1' }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    const deletion = statements.find(entry => entry.sql.startsWith('DELETE FROM'));
    assert.deepEqual(deletion.values, ['message-1', 'school-1']);
    assert.equal(statements.at(-1).sql, 'COMMIT');
  } finally {
    db.pool.connect = originalConnect;
  }
});
