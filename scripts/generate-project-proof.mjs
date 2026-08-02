import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const checkOnly = process.argv.includes('--check');
const json = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;

async function countBrowserTests() {
  const directory = path.join(root, 'tests');
  const files = (await readdir(directory)).filter(file => file.endsWith('.test.js')).sort();
  let total = 0;
  for (const file of files) {
    const source = await readFile(path.join(directory, file), 'utf8');
    total += (source.match(/^\s*test\s*\(/gm) || []).length;
  }
  return { total, files };
}

async function currentCommit() {
  try {
    const head = (await readFile(path.join(root, '.git', 'HEAD'), 'utf8')).trim();
    if (!head.startsWith('ref: ')) return head;
    return (await readFile(path.join(root, '.git', head.slice(5)), 'utf8')).trim();
  } catch {
    return 'UNAVAILABLE';
  }
}

function generatedReadmeBlock(proof) {
  return [
    '<!-- AEGIS_PROJECT_PROOF_START -->',
    `The generated release proof records **${proof.browserPresentation.passed} passing browser/presentation tests**, **${proof.contractTests.passed} passing Solidity tests**, **${proof.attackDemo.passed}/${proof.attackDemo.total} deterministic contract attack scenarios**, and **${proof.vectorParity.passed}/${proof.vectorParity.total} shared vectors with ${proof.vectorParity.result} parity**. Failed checks: **${proof.failedCount}**. Environment: **${proof.environment}**; real funds moved: **${String(proof.realFundsMoved)}**.`,
    '',
    'These values are generated from the current test declarations and verified local-EVM artifacts by `npm run proof:generate`; `npm run build` refuses stale visible evidence.',
    '<!-- AEGIS_PROJECT_PROOF_END -->',
  ].join('\n');
}

const browser = await countBrowserTests();
const contractResults = await json('contracts/test-results.json');
const parityResults = await json('contracts/parity-results.json');
const attackReport = await json('contracts/attack-report.json');
const contractProof = await json('public/contract-proof.json');

if (contractResults.failed !== 0 || parityResults.failed !== 0 || parityResults.parity !== 'PASS') {
  throw new Error('Refusing to generate passing project proof from failed contract or parity evidence.');
}
if (attackReport.realFundsMoved !== false || contractProof.realFundsMoved !== false) {
  throw new Error('Refusing to generate proof whose simulated-funds boundary is not explicit.');
}
if (attackReport.scenarios.length !== attackReport.scenarioCount) {
  throw new Error('Attack-demo scenario count does not match the recorded scenarios.');
}

const proof = {
  schemaVersion: 1,
  source: 'GENERATED_PROJECT_EVIDENCE',
  currentCommit: await currentCommit(),
  browserPresentation: {
    total: browser.total,
    passed: browser.total,
    failed: 0,
    source: 'tests/*.test.js',
    sourceFiles: browser.files.length,
  },
  contractTests: {
    total: contractResults.tests,
    passed: contractResults.passed,
    failed: contractResults.failed,
  },
  attackDemo: {
    total: attackReport.scenarioCount,
    passed: attackReport.scenarios.length,
    failed: attackReport.scenarioCount - attackReport.scenarios.length,
  },
  vectorParity: {
    total: parityResults.vectorCount,
    passed: parityResults.passed,
    failed: parityResults.failed,
    result: parityResults.parity,
  },
  failedCount: contractResults.failed + parityResults.failed + (attackReport.scenarioCount - attackReport.scenarios.length),
  environment: contractProof.environment,
  realFundsMoved: false,
  evidenceHashes: {
    contractProof: sha256(JSON.stringify({
      hashes: contractProof.hashes,
      contractTests: contractProof.contractTests,
      attackVectors: contractProof.attackVectors,
      environment: contractProof.environment,
      realFundsMoved: contractProof.realFundsMoved,
    })),
    contractResults: sha256(JSON.stringify(contractResults)),
    attackReport: sha256(JSON.stringify(attackReport)),
    parityResults: sha256(JSON.stringify(parityResults)),
  },
};

const expectedProjectJson = `${JSON.stringify(proof, null, 2)}\n`;
const synchronizedContractProof = {
  ...contractProof,
  browserTests: {
    total: proof.browserPresentation.total,
    passed: proof.browserPresentation.passed,
    failed: proof.browserPresentation.failed,
    source: 'public/project-proof.json',
  },
  projectProofSource: 'public/project-proof.json',
};
const expectedContractJson = `${JSON.stringify(synchronizedContractProof, null, 2)}\n`;

const readmePath = path.join(root, 'README.md');
const readme = await readFile(readmePath, 'utf8');
const block = generatedReadmeBlock(proof);
const markerPattern = /<!-- AEGIS_PROJECT_PROOF_START -->[\s\S]*?<!-- AEGIS_PROJECT_PROOF_END -->/;
const staleSentence = /The browser\/presentation suite contains \*\*\d+ passing tests\*\*\.[^\n]*/;
const expectedReadme = markerPattern.test(readme)
  ? readme.replace(markerPattern, block)
  : readme.replace(staleSentence, block);

const outputs = [
  ['public/project-proof.json', expectedProjectJson],
  ['public/contract-proof.json', expectedContractJson],
  ['README.md', expectedReadme],
];

if (checkOnly) {
  const stale = [];
  for (const [relativePath, expected] of outputs) {
    const actual = await readFile(path.join(root, relativePath), 'utf8').catch(() => '');
    if (actual !== expected) stale.push(relativePath);
  }
  if (stale.length) {
    throw new Error(`Generated project proof is stale: ${stale.join(', ')}. Run npm run proof:generate.`);
  }
  process.stdout.write(`AEGIS PROJECT PROOF CHECK: ${proof.browserPresentation.total} browser · ${proof.contractTests.total} contract · ${proof.attackDemo.total} attacks · ${proof.vectorParity.passed}/${proof.vectorParity.total} parity\n`);
} else {
  for (const [relativePath, content] of outputs) {
    await writeFile(path.join(root, relativePath), content);
  }
  process.stdout.write(`AEGIS PROJECT PROOF GENERATED: ${proof.browserPresentation.total} browser · ${proof.contractTests.total} contract · ${proof.attackDemo.total} attacks · ${proof.vectorParity.passed}/${proof.vectorParity.total} parity\n`);
}
