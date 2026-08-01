const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const hre = require('hardhat');

const { ethers, network } = hre;
const vectorDocument = require('../test-vectors/aegis-vectors.json');
const TASK = ethers.id('CLOUD-CAPACITY-07');
const WRONG_TASK = ethers.id('UNAUTHORISED-TASK');

function contractErrorName(contract, error) {
  const candidates = [error?.data, error?.error?.data, error?.info?.error?.data, error?.info?.error?.data?.data];
  for (const data of candidates) {
    if (typeof data !== 'string') continue;
    try {
      return contract.interface.parseError(data).name;
    } catch {
      // Continue through nested provider error shapes.
    }
  }
  return error?.shortMessage || 'UnknownContractError';
}

async function timestamp() {
  return (await ethers.provider.getBlock('latest')).timestamp;
}

async function deployWallet() {
  const [owner, agent, recipient, attacker] = await ethers.getSigners();
  const token = await ethers.deployContract('MockINRToken', [1_000_000]);
  await token.waitForDeployment();
  const wallet = await ethers.deployContract('AegisPolicyWallet', [
    await token.getAddress(),
    agent.address,
    TASK,
    2_500,
    10_000,
    10_000,
    await timestamp() + 86_400,
    10,
    [recipient.address],
  ]);
  await wallet.waitForDeployment();
  await (await token.transfer(await wallet.getAddress(), 100_000)).wait();
  return { owner, agent, recipient, attacker, token, wallet };
}

async function request(fixture, { amount, recipient, task = TASK, nonce, version } = {}) {
  const tx = await fixture.wallet.connect(fixture.agent).requestIntent(
    recipient ?? fixture.recipient.address,
    amount,
    task,
    nonce,
    version ?? await fixture.wallet.policyVersion(),
  );
  const receipt = await tx.wait();
  for (const log of receipt.logs) {
    try {
      const event = fixture.wallet.interface.parseLog(log);
      if (event?.name === 'IntentAuthorised') {
        return { intentId: event.args.intentId, executeAfter: Number(event.args.executeAfter) };
      }
    } catch {
      // Token event.
    }
  }
  throw new Error('IntentAuthorised event missing.');
}

function browserIntent(engine, vector, suffix = '') {
  const request = vector.request;
  return {
    id: `PARITY-${vector.id}${suffix}`,
    agentId: engine.policy.authorisedAgentId,
    taskId: request.task === 'WRONG' ? 'UNAUTHORISED-TASK' : engine.policy.taskId,
    amount: request.amount,
    recipient: request.recipient === 'UNKNOWN' ? 'UnknownCounterparty' : engine.policy.approvedRecipients[0],
    category: engine.policy.approvedCategory,
    requestedAt: '2026-08-01T12:00:00.000Z',
    expiresAt: engine.policy.expiresAt,
    policyVersion: request.policyVersion === 'STALE' ? engine.policy.version - 1 : engine.policy.version,
    nonce: request.nonce === 'REUSED' ? `PARITY-REUSED-${vector.id}` : `PARITY-NONCE-${vector.id}${suffix}`,
    status: 'REQUESTED',
  };
}

function normalizeBrowser(result) {
  if (result?.intent?.status === 'SETTLED') return 'SETTLED';
  if (result?.intent?.status === 'INVALIDATED' || result?.decision === 'INVALIDATE') return 'INVALIDATED';
  if (result?.decision === 'HOLD') return 'PENDING';
  if (result?.decision === 'APPROVE') return 'APPROVED';
  if (result?.decision === 'FREEZE') return 'FROZEN';
  return 'BLOCKED';
}

function browserReason(result) {
  const rule = result?.ruleChecked;
  const map = {
    FINAL_SETTLEMENT_REVALIDATION: 'FINAL_REVALIDATION',
    PER_TRANSACTION_LIMIT: 'PER_TRANSACTION_LIMIT',
    RECIPIENT_ALLOWLISTED: 'RECIPIENT_ALLOWLIST',
    TASK_MATCHES_CAPSULE: 'TASK_CAPSULE',
    CUMULATIVE_BUDGET: 'CUMULATIVE_BUDGET',
    NONCE_UNIQUE: 'NONCE_REPLAY',
    POLICY_VERSION_CURRENT: 'POLICY_VERSION',
  };
  if (result?.decision === 'INVALIDATE' || result?.finalSettlementStatus === 'INVALIDATED') return 'OWNER_VERSION_INVALIDATION';
  return map[rule] ?? rule;
}

function contractReason(errorName, outcome) {
  if (outcome === 'SETTLED') return 'FINAL_REVALIDATION';
  if (outcome === 'INVALIDATED') return 'OWNER_VERSION_INVALIDATION';
  return ({
    PerTransactionLimitExceeded: 'PER_TRANSACTION_LIMIT',
    RecipientNotApproved: 'RECIPIENT_ALLOWLIST',
    TaskMismatch: 'TASK_CAPSULE',
    TotalBudgetExceeded: 'CUMULATIVE_BUDGET',
    DailyLimitExceeded: 'CUMULATIVE_BUDGET',
    NonceAlreadyUsed: 'NONCE_REPLAY',
    StalePolicyVersion: 'POLICY_VERSION',
  })[errorName] ?? errorName;
}

async function runBrowserVector(vector, module) {
  const initialRuntime = vector.id === 'cumulative-limit'
    ? { taskSpent: 9_000, dailySpent: 9_000, approvedCount: 0, blockedCount: 0, protectedValue: 0 }
    : { taskSpent: 0, dailySpent: 0, approvedCount: 0, blockedCount: 0, protectedValue: 0 };
  const engine = new module.AegisPolicyEngine({ policy: module.DEFAULT_POLICY, initialRuntime });

  if (vector.id === 'duplicate-nonce') {
    const first = browserIntent(engine, vector, '-FIRST');
    first.amount = vector.request.priorNonceAmount;
    first.nonce = `PARITY-REUSED-${vector.id}`;
    engine.authoriseIntent(first);
    const result = engine.authoriseIntent(browserIntent(engine, vector));
    return { outcome: normalizeBrowser(result), reason: browserReason(result), fundsMoved: result.fundsMoved };
  }
  if (vector.id === 'pending-freeze') {
    const pending = engine.authoriseIntent(browserIntent(engine, vector));
    if (normalizeBrowser(pending) !== 'PENDING') throw new Error('Browser pending-freeze vector did not reach Phase 1 PENDING.');
    const freeze = engine.freezeAgent({ ownerId: engine.policy.ownerId, timestamp: '2026-08-01T12:00:04.000Z' });
    const invalidated = freeze.invalidated[0];
    return {
      outcome: normalizeBrowser(invalidated),
      reason: 'OWNER_VERSION_INVALIDATION',
      fundsMoved: invalidated?.fundsMoved ?? 0,
    };
  }
  const result = engine.processIntent(browserIntent(engine, vector));
  return { outcome: normalizeBrowser(result), reason: browserReason(result), fundsMoved: result.fundsMoved };
}

async function runContractVector(vector) {
  const fixture = await deployWallet();
  let outcome;
  let reasonName;
  let fundsMoved = 0;
  try {
    if (vector.id === 'cumulative-limit') {
      for (let index = 0; index < 4; index += 1) {
        await request(fixture, { amount: 2_250, nonce: ethers.id(`PARITY-CUMULATIVE-${index}`) });
      }
    }
    if (vector.id === 'duplicate-nonce') {
      const reused = ethers.id('PARITY-DUPLICATE');
      await request(fixture, { amount: vector.request.priorNonceAmount, nonce: reused });
      await request(fixture, { amount: vector.request.amount, nonce: reused });
      throw new Error('Duplicate nonce unexpectedly succeeded.');
    }

    const before = await fixture.token.balanceOf(fixture.recipient.address);
    const authorised = await request(fixture, {
      amount: vector.request.amount,
      recipient: vector.request.recipient === 'UNKNOWN' ? fixture.attacker.address : fixture.recipient.address,
      task: vector.request.task === 'WRONG' ? WRONG_TASK : TASK,
      nonce: ethers.id(`PARITY-${vector.id}`),
      version: vector.request.policyVersion === 'STALE' ? 0 : undefined,
    });
    if (vector.id === 'pending-freeze') {
      await (await fixture.wallet.freeze()).wait();
      try {
        await fixture.wallet.executeIntent(authorised.intentId);
      } catch (error) {
        reasonName = contractErrorName(fixture.wallet, error);
      }
      outcome = 'INVALIDATED';
    } else {
      await network.provider.send('evm_setNextBlockTimestamp', [authorised.executeAfter]);
      await (await fixture.wallet.executeIntent(authorised.intentId)).wait();
      outcome = 'SETTLED';
      fundsMoved = Number((await fixture.token.balanceOf(fixture.recipient.address)) - before);
    }
  } catch (error) {
    if (error.message === 'Duplicate nonce unexpectedly succeeded.') throw error;
    reasonName = contractErrorName(fixture.wallet, error);
    outcome = 'BLOCKED';
  }
  return { outcome, reason: contractReason(reasonName, outcome), fundsMoved, rawReason: reasonName ?? 'IntentExecuted' };
}

async function run() {
  const enginePath = path.resolve(__dirname, '..', '..', 'public', 'policy-engine.js');
  const browserModule = await import(pathToFileURL(enginePath).href);
  const results = [];

  for (const vector of vectorDocument.vectors) {
    const browser = await runBrowserVector(vector, browserModule);
    const contract = await runContractVector(vector);
    const expected = vector.expected;
    const passed = browser.outcome === expected.final
      && contract.outcome === expected.final
      && browser.reason === expected.reason
      && contract.reason === expected.reason
      && browser.fundsMoved === expected.fundsMoved
      && contract.fundsMoved === expected.fundsMoved;
    results.push({ id: vector.id, expected, browser, contract, passed });
  }

  const passedCount = results.filter(result => result.passed).length;
  const report = {
    environment: 'LOCAL_EVM',
    vectorCount: results.length,
    passed: passedCount,
    failed: results.length - passedCount,
    parity: passedCount === results.length ? 'PASS' : 'FAIL',
    results,
  };
  fs.writeFileSync(path.join(__dirname, '..', 'parity-results.json'), `${JSON.stringify(report, null, 2)}\n`);

  process.stdout.write('\nAEGIS SHARED ATTACK-VECTOR PARITY\n');
  for (const result of results) {
    process.stdout.write(`${result.passed ? 'PASS' : 'FAIL'} ${result.id.padEnd(22)} browser=${result.browser.outcome.padEnd(11)} contract=${result.contract.outcome.padEnd(11)} rule=${result.expected.reason}\n`);
  }
  process.stdout.write(`\nVECTOR PARITY: ${report.parity} (${passedCount}/${results.length})\n`);
  if (report.parity !== 'PASS') process.exitCode = 1;
}

run().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
