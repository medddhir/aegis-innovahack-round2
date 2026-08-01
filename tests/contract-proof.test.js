import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [proofSource, walletSource, tokenSource, html, app, packageSource, vectorsSource] = await Promise.all([
  readFile(new URL('../public/contract-proof.json', import.meta.url), 'utf8'),
  readFile(new URL('../contracts/src/AegisPolicyWallet.sol', import.meta.url)),
  readFile(new URL('../contracts/src/MockINRToken.sol', import.meta.url), 'utf8'),
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
  readFile(new URL('../contracts/test-vectors/aegis-vectors.json', import.meta.url), 'utf8'),
]);

const proof = JSON.parse(proofSource);
const packageDocument = JSON.parse(packageSource);
const vectors = JSON.parse(vectorsSource);
const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;

test('48. published contract proof is local-EVM evidence with no real funds or fabricated deployment', () => {
  assert.equal(proof.contractName, 'AegisPolicyWallet');
  assert.equal(proof.environment, 'LOCAL_EVM');
  assert.equal(proof.deploymentStatus, 'NOT_PUBLICLY_DEPLOYED');
  assert.equal(proof.realFundsMoved, false);
  assert.equal(Object.hasOwn(proof, 'publicContractAddress'), false);
  assert.equal(proof.hashes.contractSource, sha256(walletSource));
  assert.equal(proof.contractTests.failed, 0);
  assert.equal(proof.attackVectors.parity, 'PASS');
});

test('49. Solidity wallet separates owner mutation authority from the agent request path', () => {
  const source = walletSource.toString();
  assert.match(source, /function requestIntent[\s\S]*external onlyAgent/);
  for (const ownerFunction of ['freeze', 'restore', 'updatePolicy', 'approveRecipient', 'removeRecipient', 'transferOwnership']) {
    assert.match(source, new RegExp(`function ${ownerFunction}[\\s\\S]{0,360}onlyOwner`), `${ownerFunction} must remain owner-only`);
  }
  assert.match(tokenSource, /not currency, a stablecoin, or a production asset/i);
});

test('50. freeze and restore invalidate pending authority by monotonically changing policy version', () => {
  const source = walletSource.toString();
  assert.match(source, /function freeze\(\) external onlyOwner[\s\S]*frozen = true;[\s\S]*\+\+policyVersion/);
  assert.match(source, /function restore\(\) external onlyOwner[\s\S]*frozen = false;[\s\S]*\+\+policyVersion/);
  assert.match(source, /pending\.policyVersion != policyVersion[\s\S]*StalePolicyVersion/);
  assert.match(source, /mapping\(bytes32 => bool\) public usedNonces/);
  assert.match(source, /reservedByVersion/);
});

test('51. shared vector proof covers every required overlapping enforcement scenario', () => {
  assert.deepEqual(vectors.vectors.map(vector => vector.id), [
    'approved-payment', 'oversized-payment', 'unknown-recipient', 'wrong-task',
    'cumulative-limit', 'duplicate-nonce', 'pending-freeze', 'stale-version',
  ]);
  assert.equal(proof.attackVectors.total, vectors.vectors.length);
  assert.equal(proof.attackVectors.passed, vectors.vectors.length);
});

test('52. website and Judge badge load proof evidence without claiming browser clicks are on-chain', () => {
  assert.match(html, /Enforced twice\. Explained once\./);
  assert.match(html, /LOCAL EVM[\s\S]{0,120}CONTRACT SANDBOX/);
  assert.match(html, /CONTRACT-BACKED RULE PARITY/);
  assert.match(html, /The live demonstration uses simulated browser execution/);
  assert.match(html, /github\.com\/medddhir\/aegis-innovahack-round2\/tree\/main\/contracts/);
  assert.match(app, /fetch\('\.\/contract-proof\.json'/);
  assert.match(app, /proof\.realFundsMoved !== false/);
  for (const command of ['contract:test', 'contract:demo', 'contract:proof', 'test:all']) {
    assert.equal(typeof packageDocument.scripts[command], 'string', `missing root command ${command}`);
  }
});
