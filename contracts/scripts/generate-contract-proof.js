const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');

const contractRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(contractRoot, '..');
const sourcePath = path.join(contractRoot, 'src', 'AegisPolicyWallet.sol');
const artifactPath = path.join(contractRoot, 'artifacts', 'src', 'AegisPolicyWallet.sol', 'AegisPolicyWallet.json');
const testPath = path.join(contractRoot, 'test-results.json');
const parityPath = path.join(contractRoot, 'parity-results.json');
const vectorPath = path.join(contractRoot, 'test-vectors', 'aegis-vectors.json');
const browserTestRoot = path.join(projectRoot, 'tests');

function requireFile(filePath, instruction) {
  if (!fs.existsSync(filePath)) throw new Error(`${instruction}: ${path.relative(projectRoot, filePath)}`);
  return filePath;
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

requireFile(sourcePath, 'Contract source missing');
requireFile(artifactPath, 'Compile the contracts before generating proof');
requireFile(testPath, 'Run contract tests before generating proof');
requireFile(parityPath, 'Run vector parity before generating proof');
requireFile(vectorPath, 'Attack vectors missing');

const source = fs.readFileSync(sourcePath);
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const testResults = JSON.parse(fs.readFileSync(testPath, 'utf8'));
const parityResults = JSON.parse(fs.readFileSync(parityPath, 'utf8'));
const vectors = JSON.parse(fs.readFileSync(vectorPath, 'utf8'));
const browserTestTotal = fs.readdirSync(browserTestRoot)
  .filter(file => file.endsWith('.test.js'))
  .reduce((total, file) => {
    const source = fs.readFileSync(path.join(browserTestRoot, file), 'utf8');
    return total + (source.match(/^\s*test\s*\(/gm) || []).length;
  }, 0);

if (testResults.failed !== 0 || parityResults.parity !== 'PASS') {
  throw new Error('Refusing to publish a passing contract proof from failed tests or failed vector parity.');
}

const bytecode = Buffer.from(artifact.bytecode.replace(/^0x/, ''), 'hex');
const abi = Buffer.from(JSON.stringify(artifact.abi));
const proof = {
  schemaVersion: 1,
  contractName: artifact.contractName,
  mockAsset: 'Mock INR Test Token (mINR-TEST)',
  compilerVersion: solc.version(),
  hashes: {
    algorithm: 'SHA-256',
    contractSource: sha256(source),
    deploymentBytecode: sha256(bytecode),
    abi: sha256(abi),
  },
  deploymentBytecodeBytes: bytecode.length,
  contractTests: {
    total: testResults.tests,
    passed: testResults.passed,
    failed: testResults.failed,
  },
  browserTests: {
    total: browserTestTotal,
    source: 'tests/*.test.js',
  },
  attackVectors: {
    total: vectors.vectors.length,
    passed: parityResults.passed,
    failed: parityResults.failed,
    parity: parityResults.parity,
  },
  environment: 'LOCAL_EVM',
  deploymentStatus: 'NOT_PUBLICLY_DEPLOYED',
  realFundsMoved: false,
  sourcePath: 'contracts/src/AegisPolicyWallet.sol',
};

const outputPath = path.join(projectRoot, 'public', 'contract-proof.json');
fs.writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`);
process.stdout.write(`AEGIS CONTRACT PROOF: ${proof.contractTests.passed}/${proof.contractTests.total} tests · ${proof.attackVectors.passed}/${proof.attackVectors.total} vectors · ${proof.attackVectors.parity}\n`);
process.stdout.write(`SOURCE ${proof.hashes.contractSource}\n`);
process.stdout.write(`BYTECODE ${proof.hashes.deploymentBytecode}\n`);
process.stdout.write(`OUTPUT ${path.relative(projectRoot, outputPath)} · ${proof.environment} · real funds moved: ${proof.realFundsMoved}\n`);
