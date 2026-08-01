const fs = require('node:fs');
const path = require('node:path');
const Mocha = require('mocha');

class AegisReporter extends Mocha.reporters.Spec {
  constructor(runner, options) {
    super(runner, options);
    const result = { tests: 0, passed: 0, failed: 0, pending: 0, failures: [] };
    runner.on('test end', () => { result.tests += 1; });
    runner.on('pass', () => { result.passed += 1; });
    runner.on('fail', (test, error) => {
      result.failed += 1;
      result.failures.push({ title: test.fullTitle(), message: error.message });
    });
    runner.on('pending', () => { result.pending += 1; });
    runner.once('end', () => {
      result.environment = 'LOCAL_EVM';
      result.compiler = '0.8.24';
      fs.writeFileSync(path.join(process.cwd(), 'test-results.json'), `${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(`\nAEGIS CONTRACT TEST SUMMARY: ${result.passed} passed, ${result.failed} failed, ${result.pending} pending\n`);
    });
  }
}

module.exports = AegisReporter;
