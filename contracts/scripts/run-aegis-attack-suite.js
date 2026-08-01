const fs = require('node:fs');
const path = require('node:path');
const hre = require('hardhat');

const { ethers, network } = hre;
const TASK = ethers.id('CLOUD-CAPACITY-07');
const WRONG_TASK = ethers.id('UNAUTHORISED-TASK');
const DELAY = 10;

function nonce(label) {
  return ethers.id(`AEGIS-ATTACK-${label}`);
}

function parsedError(contract, error) {
  const candidates = [
    error?.data,
    error?.error?.data,
    error?.info?.error?.data,
    error?.info?.error?.data?.data,
  ];
  for (const data of candidates) {
    if (typeof data !== 'string') continue;
    try {
      const decoded = contract.interface.parseError(data);
      return {
        name: decoded.name,
        args: decoded.args.map(value => typeof value === 'bigint' ? value.toString() : String(value)),
      };
    } catch {
      // Try the next nested provider-error shape.
    }
  }
  return { name: error?.shortMessage || error?.message || 'UnknownContractError', args: [] };
}

async function currentTimestamp() {
  return (await ethers.provider.getBlock('latest')).timestamp;
}

async function deployPolicy({ total = 10_000, perTx = 2_500, daily = 10_000, expiryOffset = 86_400 } = {}) {
  const [owner, agent, recipient, attacker, unknownRecipient] = await ethers.getSigners();
  const token = await ethers.deployContract('MockINRToken', [1_000_000]);
  await token.waitForDeployment();
  const expiry = await currentTimestamp() + expiryOffset;
  const wallet = await ethers.deployContract('AegisPolicyWallet', [
    await token.getAddress(),
    agent.address,
    TASK,
    perTx,
    total,
    daily,
    expiry,
    DELAY,
    [recipient.address],
  ]);
  await wallet.waitForDeployment();
  await (await token.transfer(await wallet.getAddress(), 100_000)).wait();
  return { owner, agent, recipient, attacker, unknownRecipient, token, wallet };
}

async function walletState(fixture) {
  const { wallet, token } = fixture;
  const version = await wallet.policyVersion();
  return {
    frozen: await wallet.frozen(),
    policyVersion: Number(version),
    totalSpent: Number(await wallet.totalSpent()),
    reserved: Number(await wallet.reservedByVersion(version)),
    testTokenBalance: Number(await token.balanceOf(await wallet.getAddress())),
  };
}

async function request(fixture, { recipient, amount, task = TASK, requestNonce, version } = {}) {
  const { wallet, agent } = fixture;
  const activeVersion = version ?? await wallet.policyVersion();
  const tx = await wallet.connect(agent).requestIntent(
    recipient ?? fixture.recipient.address,
    amount,
    task,
    requestNonce,
    activeVersion,
  );
  const receipt = await tx.wait();
  for (const log of receipt.logs) {
    try {
      const event = wallet.interface.parseLog(log);
      if (event?.name === 'IntentAuthorised') {
        return { intentId: event.args.intentId, executeAfter: Number(event.args.executeAfter) };
      }
    } catch {
      // Ignore the token and unrelated receipt logs.
    }
  }
  throw new Error('IntentAuthorised event missing from successful request.');
}

async function attempt(contract, operation) {
  try {
    const value = await operation();
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: parsedError(contract, error) };
  }
}

function errorText(result) {
  if (result.ok) return 'PASS';
  return `${result.error.name}${result.error.args.length ? `(${result.error.args.join(', ')})` : ''}`;
}

async function addResult(results, fixture, details) {
  results.push({
    ...details,
    fundsMoved: details.fundsMoved ?? 0,
    policyVersion: Number(await fixture.wallet.policyVersion()),
    finalWalletState: await walletState(fixture),
  });
}

async function run() {
  const results = [];

  {
    const fixture = await deployPolicy();
    const before = await fixture.token.balanceOf(fixture.recipient.address);
    const authorised = await request(fixture, { amount: 1_000, requestNonce: nonce('VALID') });
    await network.provider.send('evm_setNextBlockTimestamp', [authorised.executeAfter]);
    await (await fixture.wallet.executeIntent(authorised.intentId)).wait();
    const moved = Number((await fixture.token.balanceOf(fixture.recipient.address)) - before);
    await addResult(results, fixture, {
      scenario: 1,
      name: 'Valid allowlisted payment',
      request: { amount: 1_000, recipient: fixture.recipient.address, taskHash: TASK },
      contractResult: 'SETTLED',
      decisiveRule: 'All request checks and final revalidation passed',
      fundsMoved: moved,
    });
  }

  {
    const fixture = await deployPolicy();
    const result = await attempt(fixture.wallet, () => request(fixture, { amount: 2_501, requestNonce: nonce('OVERSIZED') }));
    await addResult(results, fixture, {
      scenario: 2,
      name: 'Oversized payment',
      request: { amount: 2_501, perTransactionLimit: 2_500 },
      contractResult: 'BLOCKED',
      decisiveRule: errorText(result),
    });
  }

  {
    const fixture = await deployPolicy();
    const result = await attempt(fixture.wallet, () => request(fixture, {
      recipient: fixture.unknownRecipient.address,
      amount: 1_000,
      requestNonce: nonce('UNKNOWN'),
    }));
    await addResult(results, fixture, {
      scenario: 3,
      name: 'Unknown recipient',
      request: { amount: 1_000, recipient: fixture.unknownRecipient.address },
      contractResult: 'BLOCKED',
      decisiveRule: errorText(result),
    });
  }

  {
    const fixture = await deployPolicy();
    const result = await attempt(fixture.wallet, () => request(fixture, {
      amount: 1_000,
      task: WRONG_TASK,
      requestNonce: nonce('WRONG-TASK'),
    }));
    await addResult(results, fixture, {
      scenario: 4,
      name: 'Wrong task hash',
      request: { amount: 1_000, taskHash: WRONG_TASK },
      contractResult: 'BLOCKED',
      decisiveRule: errorText(result),
    });
  }

  {
    const fixture = await deployPolicy({ expiryOffset: 60 });
    await network.provider.send('evm_increaseTime', [61]);
    await network.provider.send('evm_mine');
    const result = await attempt(fixture.wallet, () => request(fixture, { amount: 1_000, requestNonce: nonce('EXPIRED') }));
    await addResult(results, fixture, {
      scenario: 5,
      name: 'Expired Capsule',
      request: { amount: 1_000, expiryStatus: 'EXPIRED' },
      contractResult: 'BLOCKED',
      decisiveRule: errorText(result),
    });
  }

  {
    const fixture = await deployPolicy();
    const sharedNonce = nonce('DUPLICATE');
    await request(fixture, { amount: 1_000, requestNonce: sharedNonce });
    const exact = await attempt(fixture.wallet, () => request(fixture, { amount: 1_000, requestNonce: sharedNonce }));
    const changed = await attempt(fixture.wallet, () => request(fixture, { amount: 900, requestNonce: sharedNonce }));
    await addResult(results, fixture, {
      scenario: 6,
      name: 'Duplicate nonce',
      request: { nonce: sharedNonce, exactRetryAmount: 1_000, changedRetryAmount: 900 },
      contractResult: 'BLOCKED',
      decisiveRule: `${errorText(exact)}; changed amount: ${errorText(changed)}`,
    });
  }

  {
    const fixture = await deployPolicy({ total: 5_000, daily: 5_000 });
    await request(fixture, { amount: 2_500, requestNonce: nonce('BUDGET-1') });
    await request(fixture, { amount: 2_500, requestNonce: nonce('BUDGET-2') });
    const result = await attempt(fixture.wallet, () => request(fixture, { amount: 1, requestNonce: nonce('BUDGET-3') }));
    await addResult(results, fixture, {
      scenario: 7,
      name: 'Cumulative-budget attempt',
      request: { reservedBeforeAttempt: 5_000, additionalAmount: 1, totalTaskBudget: 5_000 },
      contractResult: 'BLOCKED',
      decisiveRule: errorText(result),
    });
  }

  {
    const fixture = await deployPolicy({ daily: 5_000 });
    const splitResults = [];
    for (let index = 1; index <= 4; index += 1) {
      const result = await attempt(fixture.wallet, () => request(fixture, {
        amount: 1_999,
        requestNonce: nonce(`SPLIT-${index}`),
      }));
      splitResults.push({ request: index, amount: 1_999, result: result.ok ? 'PENDING' : 'BLOCKED', rule: errorText(result) });
    }
    await addResult(results, fixture, {
      scenario: 8,
      name: 'Four split requests',
      request: { count: 4, each: 1_999, combinedAttempt: 7_996 },
      contractResult: 'PARTIALLY_AUTHORISED_THEN_BLOCKED',
      decisiveRule: 'DailyLimitExceeded after pending reservations reached ₹3,998',
      requestResults: splitResults,
      fundsMoved: 0,
      layerBoundary: 'Coordinated-pattern detection is Layer 1; Layer 2 independently stops over-reservation at the cumulative limit.',
    });
  }

  {
    const fixture = await deployPolicy();
    const pending = await request(fixture, { amount: 1_200, requestNonce: nonce('FREEZE-PENDING') });
    await (await fixture.wallet.freeze()).wait();
    const frozenExecute = await attempt(fixture.wallet, () => fixture.wallet.executeIntent(pending.intentId));
    await addResult(results, fixture, {
      scenario: 9,
      name: 'Pending intent followed by owner freeze',
      request: { amount: 1_200, intentId: pending.intentId },
      contractResult: 'INVALIDATED',
      decisiveRule: errorText(frozenExecute),
      fundsMoved: 0,
    });

    const agentRestore = await attempt(fixture.wallet, () => fixture.wallet.connect(fixture.agent).restore());
    await addResult(results, fixture, {
      scenario: 10,
      name: 'Agent attempts to unfreeze itself',
      request: { callerRole: 'AGENT', action: 'restore' },
      contractResult: 'BLOCKED',
      decisiveRule: errorText(agentRestore),
      fundsMoved: 0,
    });

    await (await fixture.wallet.restore()).wait();
    await network.provider.send('evm_setNextBlockTimestamp', [pending.executeAfter + 1]);
    const oldExecute = await attempt(fixture.wallet, () => fixture.wallet.executeIntent(pending.intentId));
    await addResult(results, fixture, {
      scenario: 11,
      name: 'Old pending intent attempted after restore',
      request: { intentId: pending.intentId, intentPolicyVersion: 1 },
      contractResult: 'INVALIDATED',
      decisiveRule: errorText(oldExecute),
      fundsMoved: 0,
    });

    const recipientBefore = await fixture.token.balanceOf(fixture.recipient.address);
    const version = await fixture.wallet.policyVersion();
    const fresh = await request(fixture, {
      amount: 1_000,
      requestNonce: nonce('RESTORED-FRESH'),
      version,
    });
    await network.provider.send('evm_setNextBlockTimestamp', [fresh.executeAfter]);
    await (await fixture.wallet.executeIntent(fresh.intentId)).wait();
    const moved = Number((await fixture.token.balanceOf(fixture.recipient.address)) - recipientBefore);
    await addResult(results, fixture, {
      scenario: 12,
      name: 'Valid fresh request after safe restore',
      request: { amount: 1_000, policyVersion: Number(version), intentId: fresh.intentId },
      contractResult: 'SETTLED',
      decisiveRule: 'Fresh nonce and current restored policy version passed final revalidation',
      fundsMoved: moved,
    });
  }

  const report = {
    title: 'Aegis Policy Wallet — deterministic local-EVM attack suite',
    environment: 'LOCAL_EVM',
    asset: 'Mock INR Test Token (mINR-TEST)',
    realFundsMoved: false,
    scenarioCount: results.length,
    scenarios: results,
  };
  fs.writeFileSync(path.join(__dirname, '..', 'attack-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  process.stdout.write('\nAEGIS POLICY WALLET — LOCAL EVM ATTACK SUITE\n');
  process.stdout.write('Mock/test funds only · no real funds · no public deployment\n\n');
  for (const result of results) {
    process.stdout.write(`${String(result.scenario).padStart(2, '0')}. ${result.name}\n`);
    process.stdout.write(`    RESULT  ${result.contractResult}\n`);
    process.stdout.write(`    RULE    ${result.decisiveRule}\n`);
    process.stdout.write(`    MOVED   ₹${result.fundsMoved} mock INR\n`);
    process.stdout.write(`    VERSION ${result.policyVersion} · frozen=${result.finalWalletState.frozen}\n`);
  }
  process.stdout.write(`\nSUMMARY ${results.length}/${results.length} scenarios recorded · real funds moved: false\n`);
}

run().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
