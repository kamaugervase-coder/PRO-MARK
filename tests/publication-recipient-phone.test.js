'use strict';

const assert = require('node:assert/strict');
const {
  normalizePublicationRecipientPhone
} = require('../backend/routes/communications');

assert.equal(normalizePublicationRecipientPhone('0712345678'), '+254712345678');
assert.equal(normalizePublicationRecipientPhone('712345678'), '+254712345678');
assert.equal(normalizePublicationRecipientPhone('+254 712-345-678'), '+254712345678');
assert.equal(normalizePublicationRecipientPhone('+14155552671'), '+14155552671');
assert.equal(normalizePublicationRecipientPhone('123'), null);
assert.equal(normalizePublicationRecipientPhone('+00012345678'), null);

console.log('Publication recipient phone tests passed');
