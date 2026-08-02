import { constants } from 'node:fs';
import { access, cp, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sourceRoot = path.resolve(import.meta.dirname, '..');
const sandbox = await mkdtemp(path.join(tmpdir(), 'aegis-clean-production-build-'));
const keep = process.env.AEGIS_KEEP_CLEAN_BUILD === '1';
const generatedResults = new Set([
  'contracts/test-results.json',
  'contracts/parity-results.json',
  'contracts/attack-report.json',
  'contracts/attack-results.json',
]);
const excludedNames = new Set(['.git', 'node_modules', 'dist', 'artifacts', 'cache', '.hardhat-config', '.hardhat-data', '.hardhat-cache']);

function relative(file) {
  return path.relative(sourceRoot, file).split(path.sep).join('/');
}

function copyFilter(file) {
  const name = path.basename(file);
  const rel = relative(file);
  if (!rel) return true;
  if (excludedNames.has(name) || generatedResults.has(rel)) return false;
  if (name.startsWith('.env')) return false;
  return true;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: sandbox, env: { ...process.env, CI: '1' }, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)));
  });
}

async function filesUnder(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path.join(directory, entry.name), rel));
    else if (entry.isFile()) result.push(rel.split(path.sep).join('/'));
  }
  return result.sort();
}

async function assertTreesEqual(left, right) {
  const [leftFiles, rightFiles] = await Promise.all([filesUnder(left), filesUnder(right)]);
  if (JSON.stringify(leftFiles) !== JSON.stringify(rightFiles)) throw new Error('public/ and dist/ file lists differ in the clean production build.');
  for (const file of leftFiles) {
    const [a, b] = await Promise.all([readFile(path.join(left, file)), readFile(path.join(right, file))]);
    if (!a.equals(b)) throw new Error(`public/ and dist/ differ: ${file}`);
  }
}

try {
  await cp(sourceRoot, sandbox, { recursive: true, filter: copyFilter });
  for (const file of generatedResults) {
    try { await access(path.join(sandbox, file), constants.F_OK); throw new Error(`Generated local result leaked into clean build: ${file}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try { await stat(path.join(sandbox, 'contracts/node_modules')); throw new Error('Contract dependencies leaked into the clean production build.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await run('npm', ['ci', '--ignore-scripts']);
  await run('npm', ['run', 'build']);
  await assertTreesEqual(path.join(sandbox, 'public'), path.join(sandbox, 'dist'));
  await run('npm', ['run', 'proof:check']);
  process.stdout.write(`AEGIS CLEAN PRODUCTION BUILD: PASS\nSandbox: ${sandbox}\nLocal contract result files: absent\nContract dependencies: not installed\npublic/dist: byte-identical\n`);
} finally {
  if (!keep) await rm(sandbox, { recursive: true, force: true });
  else process.stdout.write('AEGIS_KEEP_CLEAN_BUILD=1 retained the sandbox for inspection.\n');
}
