require('@nomicfoundation/hardhat-ethers');
const { subtask } = require('hardhat/config');
const {
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
  TASK_COMPILE_SOLIDITY_RUN_SOLCJS,
} = require('hardhat/builtin-tasks/task-names');

const optionalTestnet = process.env.AEGIS_TESTNET_RPC_URL && process.env.AEGIS_TESTNET_DEPLOYER_KEY
  ? {
      testnet: {
        url: process.env.AEGIS_TESTNET_RPC_URL,
        accounts: [process.env.AEGIS_TESTNET_DEPLOYER_KEY],
      },
    }
  : {};

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async ({ solcVersion }, _hre, runSuper) => {
  if (solcVersion !== '0.8.24') return runSuper();
  return {
    compilerPath: require.resolve('solc/soljson.js'),
    isSolcJs: true,
    version: '0.8.24',
    longVersion: require('solc').version(),
  };
});

// Compile in-process with the pinned package. This avoids global cache writes and
// makes the local sandbox independent of Solidity binary download services.
subtask(TASK_COMPILE_SOLIDITY_RUN_SOLCJS, async ({ input }) => {
  return JSON.parse(require('solc').compile(JSON.stringify(input)));
});

module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 300 },
      evmVersion: 'paris',
    },
  },
  paths: {
    sources: './src',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  networks: {
    hardhat: {
      chainId: 31337,
      initialDate: '2026-08-01T00:00:00.000Z',
    },
    ...optionalTestnet,
  },
  mocha: {
    timeout: 30000,
    reporter: './test/aegis-reporter.js',
  },
};
