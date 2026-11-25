const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');

const rootDirectory = path.resolve(__dirname, '../..');

let app;
let testDir;
let janeClaimId;
let robClaimId;

before(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-ownership-'));
  process.env.MERIDIAN_DATA_DIR = testDir;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');

  execFileSync(process.execPath, [path.join(rootDirectory, 'seed.js')], {
    cwd: rootDirectory,
    env: process.env,
    stdio: 'inherit',
  });

  app = require('../../server');

  const findClaim = app.locals.db.prepare(`
    SELECT claims.id
    FROM claims
    JOIN users ON users.id = claims.user_id
    WHERE users.username = ? AND claims.merchant = ?
  `);

  const janeClaim = findClaim.get('jdoe', 'Dublin Coach');
  const robClaim = findClaim.get('rsmith', 'Tesco');

  assert.ok(janeClaim, 'Test setup could not find Janes Dublin Coach claim');
  assert.ok(robClaim, 'Test setup could not find Robs Tesco claim');

  janeClaimId = janeClaim.id;
  robClaimId = robClaim.id;
});

after(() => {
  if (app) app.locals.db.close();
  if (testDir) fs.rmSync(testDir, { recursive: true, force: true });
});

async function signIn(username, password) {
  const session = request.agent(app);

  await session
    .post('/login')
    .type('form')
    .send({ username, password })
    .expect(302)
    .expect('Location', '/');

  return session;
}

test('staff can read their own claim and are denied another staff members claim', async () => {
  const jane = await signIn('jdoe', 'password1');
  const rob = await signIn('rsmith', 'letmein');

  const janeClaimUrl = `/claim/${janeClaimId}`;
  const robClaimUrl = `/claim/${robClaimId}`;

  const janeClaim = await jane.get(janeClaimUrl).expect(200);
  assert.match(janeClaim.text, /Dublin Coach/);

  const robClaim = await rob.get(robClaimUrl).expect(200);
  assert.match(robClaim.text, /Tesco/);

  const denied = await rob.get(janeClaimUrl).expect(404);
  assert.doesNotMatch(denied.text, /Dublin Coach/);
});

test('receipt downloads enforce the same staff ownership rule', async () => {
  const jane = await signIn('jdoe', 'password1');
  const rob = await signIn('rsmith', 'letmein');

  const janeFile = `claim-${janeClaimId}.txt`;
  const robFile = `claim-${robClaimId}.txt`;
  const janeReceiptText = new RegExp(`receipt for claim ${janeClaimId}\\b`, 'i');
  const robReceiptText = new RegExp(`receipt for claim ${robClaimId}\\b`, 'i');

  const janeReceipt = await jane.get('/receipt').query({ f: janeFile }).expect(200);
  assert.match(janeReceipt.text, janeReceiptText);

  const robReceipt = await rob.get('/receipt').query({ f: robFile }).expect(200);
  assert.match(robReceipt.text, robReceiptText);

  const denied = await rob.get('/receipt').query({ f: janeFile }).expect(404);
  assert.doesNotMatch(denied.text, janeReceiptText);
});

test('a claim is saved only when its amount is positive', async () => {
  const jane = await signIn('jdoe', 'password1');
  const db = app.locals.db;
  const merchant = 'Test Merchant';

  const countClaims = db.prepare('SELECT COUNT(*) AS total FROM claims');
  const startingCount = countClaims.get().total;

  function submitClaim(amount) {
    return jane.post('/claim/new').type('form').send({ merchant, amount });
  }

  await submitClaim('0.01')
    .expect(302)
    .expect('Location', '/');

  assert.equal(countClaims.get().total, startingCount + 1);

  const savedClaim = db.prepare(`
    SELECT claims.amount
    FROM claims
    JOIN users ON users.id = claims.user_id
    WHERE users.username = ? AND claims.merchant = ?
  `).get('jdoe', merchant);

  assert.ok(savedClaim, 'The valid claim should be saved under Janes account');
  assert.equal(savedClaim.amount, 0.01);

  for (const amount of ['0', '-1']) {
    await submitClaim(amount).expect(400);

    assert.equal(
      countClaims.get().total,
      startingCount + 1,
      `Submitting ${amount} should leave the claim count unchanged`
    );
  }
});