import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const checkOnly = process.argv.includes('--check');
const refresh = process.argv.includes('--refresh') || !checkOnly;
const json = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const text = file => readFile(path.join(root, file), 'utf8');
const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;

async function countMatches(directory, pattern, matcher) {
  const files = (await readdir(path.join(root, directory))).filter(file => pattern.test(file)).sort();
  let total = 0;
  for (const file of files) total += ((await text(path.join(directory, file))).match(matcher) || []).length;
  return { total, files };
}

const countBrowserTests = () => countMatches('tests', /\.test\.js$/, /^\s*test\s*\(/gm);

async function countContractTests() {
  const source = await text('contracts/test/AegisPolicyWallet.test.js');
  return (source.match(/^\s*it\s*\(/gm) || []).length;
}

async function countAttackScenarios() {
  const source = await text('contracts/scripts/run-aegis-attack-suite.js');
  const values = [...source.matchAll(/^\s*scenario:\s*(\d+),?\s*$/gm)].map(match => Number(match[1]));
  if (!values.length || values.some((value, index) => value !== index + 1)) {
    throw new Error('Contract attack-suite source does not contain one consecutive scenario declaration per attack.');
  }
  return values.length;
}

async function currentCommit() {
  try {
    const head = (await text('.git/HEAD')).trim();
    if (!head.startsWith('ref: ')) return head;
    return (await text(path.join('.git', head.slice(5)))).trim();
  } catch {
    return 'UNAVAILABLE';
  }
}

function generatedReadmeBlock(proof) {
  return [
    '<!-- AEGIS_PROJECT_PROOF_START -->',
    `The generated release proof records **${proof.browserPresentation.passed} passing browser/presentation tests**, **${proof.contractTests.passed} passing Solidity tests**, **${proof.attackDemo.passed}/${proof.attackDemo.total} deterministic contract attack scenarios**, and **${proof.vectorParity.passed}/${proof.vectorParity.total} shared vectors with ${proof.vectorParity.result} parity**. Failed checks: **${proof.failedCount}**. Environment: **${proof.environment}**; real funds moved: **${String(proof.realFundsMoved)}**.`,
    '',
    'These values are refreshed from verified local-EVM results by `npm run proof:refresh`; `npm run proof:check` and the production build validate the tracked evidence without requiring local contract artifacts.',
    '<!-- AEGIS_PROJECT_PROOF_END -->',
  ].join('\n');
}

function contractEvidenceHash(contractProof) {
  return sha256(JSON.stringify({
    hashes: contractProof.hashes,
    contractTests: contractProof.contractTests,
    attackVectors: contractProof.attackVectors,
    environment: contractProof.environment,
    realFundsMoved: contractProof.realFundsMoved,
  }));
}

function validateNonNegativeCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
}

function validatePassingGroup(group, expected, label) {
  if (!group || typeof group !== 'object') throw new Error(`${label} evidence is missing.`);
  for (const field of ['total', 'passed', 'failed']) validateNonNegativeCount(group[field], `${label}.${field}`);
  if (group.total !== expected || group.passed !== expected || group.failed !== 0) {
    throw new Error(`${label} proof disagrees with tracked source evidence (expected ${expected}/${expected}, 0 failed).`);
  }
}

async function verifyTrackedEvidence(proof, contractProof, browser) {
  const [contractTests, attackScenarios, vectors, contractSource, readme] = await Promise.all([
    countContractTests(),
    countAttackScenarios(),
    json('contracts/test-vectors/aegis-vectors.json'),
    readFile(path.join(root, 'contracts/src/AegisPolicyWallet.sol')),
    text('README.md'),
  ]);
  const vectorTotal = Array.isArray(vectors.vectors) ? vectors.vectors.length : 0;

  if (proof?.schemaVersion !== 1 || proof?.source !== 'GENERATED_PROJECT_EVIDENCE') throw new Error('Project proof schema or source is invalid.');
  validatePassingGroup(proof.browserPresentation, browser.total, 'Browser/presentation');
  if (proof.browserPresentation.source !== 'tests/*.test.js' || proof.browserPresentation.sourceFiles !== browser.files.length) throw new Error('Browser proof source metadata is stale.');
  validatePassingGroup(proof.contractTests, contractTests, 'Contract tests');
  validatePassingGroup(proof.attackDemo, attackScenarios, 'Attack demo');
  validatePassingGroup(proof.vectorParity, vectorTotal, 'Vector parity');
  if (proof.vectorParity.result !== 'PASS') throw new Error('Vector parity is not PASS.');
  if (proof.failedCount !== 0) throw new Error('Project proof records failed checks.');
  if (proof.environment !== 'LOCAL_EVM' || proof.realFundsMoved !== false) throw new Error('Project proof violates the local-EVM simulated-funds boundary.');
  if (proof.currentCommit !== 'UNAVAILABLE' && !/^[a-f0-9]{40}$/.test(proof.currentCommit)) throw new Error('Project proof commit identifier is invalid.');

  validatePassingGroup(contractProof.contractTests, contractTests, 'Contract proof tests');
  validatePassingGroup(contractProof.browserTests, browser.total, 'Contract proof browser tests');
  validatePassingGroup({ ...contractProof.attackVectors, result: contractProof.attackVectors?.parity }, vectorTotal, 'Contract proof vectors');
  if (contractProof.attackVectors.parity !== 'PASS') throw new Error('Contract proof vector parity is not PASS.');
  if (contractProof.projectProofSource !== 'public/project-proof.json') throw new Error('Contract proof does not identify the public project proof source.');
  if (contractProof.environment !== proof.environment || contractProof.realFundsMoved !== false || contractProof.deploymentStatus !== 'NOT_PUBLICLY_DEPLOYED') throw new Error('Contract proof deployment boundary is inconsistent.');
  if (contractProof.hashes?.contractSource !== sha256(contractSource)) throw new Error('Tracked Solidity source hash disagrees with contract proof.');
  for (const [label, value] of Object.entries(proof.evidenceHashes ?? {})) {
    if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`Project proof ${label} hash is malformed.`);
  }
  if (Object.keys(proof.evidenceHashes ?? {}).sort().join(',') !== 'attackReport,contractProof,contractResults,parityResults') throw new Error('Project proof evidence-hash set is incomplete.');
  if (proof.evidenceHashes.contractProof !== contractEvidenceHash(contractProof)) throw new Error('Tracked contract proof hash disagrees with project proof.');

  const markerPattern = /<!-- AEGIS_PROJECT_PROOF_START -->[\s\S]*?<!-- AEGIS_PROJECT_PROOF_END -->/;
  const block = generatedReadmeBlock(proof);
  if (!markerPattern.test(readme) || readme.match(markerPattern)?.[0] !== block) throw new Error('README generated proof block is stale. Run npm run proof:refresh.');
}

async function generateFromLocalResults(browser) {
  const [contractResults, parityResults, attackReport, contractProof] = await Promise.all([
    json('contracts/test-results.json'),
    json('contracts/parity-results.json'),
    json('contracts/attack-report.json'),
    json('public/contract-proof.json'),
  ]).catch(error => {
    if (error?.code === 'ENOENT') throw new Error(`Local proof refresh requires verified contract result artifacts. Run npm run proof:refresh. Missing: ${path.relative(root, error.path)}`);
    throw error;
  });

  if (contractResults.failed !== 0 || parityResults.failed !== 0 || parityResults.parity !== 'PASS') throw new Error('Refusing to generate passing project proof from failed contract or parity evidence.');
  if (attackReport.realFundsMoved !== false || contractProof.realFundsMoved !== false) throw new Error('Refusing to generate proof whose simulated-funds boundary is not explicit.');
  if (!Array.isArray(attackReport.scenarios) || attackReport.scenarios.length !== attackReport.scenarioCount) throw new Error('Attack-demo scenario count does not match the recorded scenarios.');

  const proof = {
    schemaVersion: 1,
    source: 'GENERATED_PROJECT_EVIDENCE',
    currentCommit: await currentCommit(),
    browserPresentation: { total: browser.total, passed: browser.total, failed: 0, source: 'tests/*.test.js', sourceFiles: browser.files.length },
    contractTests: { total: contractResults.tests, passed: contractResults.passed, failed: contractResults.failed },
    attackDemo: { total: attackReport.scenarioCount, passed: attackReport.scenarios.length, failed: attackReport.scenarioCount - attackReport.scenarios.length },
    vectorParity: { total: parityResults.vectorCount, passed: parityResults.passed, failed: parityResults.failed, result: parityResults.parity },
    failedCount: contractResults.failed + parityResults.failed + (attackReport.scenarioCount - attackReport.scenarios.length),
    environment: contractProof.environment,
    realFundsMoved: false,
    evidenceHashes: {
      contractProof: contractEvidenceHash(contractProof),
      contractResults: sha256(JSON.stringify(contractResults)),
      attackReport: sha256(JSON.stringify(attackReport)),
      parityResults: sha256(JSON.stringify(parityResults)),
    },
  };
  const synchronizedContractProof = {
    ...contractProof,
    browserTests: { total: browser.total, passed: browser.total, failed: 0, source: 'public/project-proof.json' },
    projectProofSource: 'public/project-proof.json',
  };
  const readmePath = path.join(root, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  const block = generatedReadmeBlock(proof);
  const markerPattern = /<!-- AEGIS_PROJECT_PROOF_START -->[\s\S]*?<!-- AEGIS_PROJECT_PROOF_END -->/;
  if (!markerPattern.test(readme)) throw new Error('README generated proof markers are missing.');
  await Promise.all([
    writeFile(path.join(root, 'public/project-proof.json'), `${JSON.stringify(proof, null, 2)}\n`),
    writeFile(path.join(root, 'public/contract-proof.json'), `${JSON.stringify(synchronizedContractProof, null, 2)}\n`),
    writeFile(readmePath, readme.replace(markerPattern, block)),
  ]);
  await verifyTrackedEvidence(proof, synchronizedContractProof, browser);
  process.stdout.write(`AEGIS PROJECT PROOF REFRESHED: ${proof.browserPresentation.total} browser · ${proof.contractTests.total} contract · ${proof.attackDemo.total} attacks · ${proof.vectorParity.passed}/${proof.vectorParity.total} parity\n`);
}

const browser = await countBrowserTests();
if (refresh) {
  await generateFromLocalResults(browser);
} else {
  const [proof, contractProof] = await Promise.all([json('public/project-proof.json'), json('public/contract-proof.json')]);
  await verifyTrackedEvidence(proof, contractProof, browser);
  process.stdout.write(`AEGIS PROJECT PROOF CHECK: ${proof.browserPresentation.total} browser · ${proof.contractTests.total} contract · ${proof.attackDemo.total} attacks · ${proof.vectorParity.passed}/${proof.vectorParity.total} parity · tracked evidence only\n`);
}
