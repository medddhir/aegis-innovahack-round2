const hre = require('hardhat');

const { ethers, network } = hre;

function requiredAddress(name) {
  const value = process.env[name];
  if (!value || !ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${name} must be an explicit non-zero testnet address.`);
  }
  return value;
}

async function run() {
  if (process.env.AEGIS_CONFIRM_TESTNET_DEPLOYMENT !== 'YES') {
    throw new Error('Testnet deployment is disabled. Set AEGIS_CONFIRM_TESTNET_DEPLOYMENT=YES only after reviewing the selected network and test account.');
  }
  if (network.name === 'hardhat' || network.name === 'localhost') throw new Error('This guarded script is only for an explicitly configured public testnet.');
  const networkInfo = await ethers.provider.getNetwork();
  if (networkInfo.chainId === 1n) throw new Error('Mainnet deployment is prohibited.');

  const agent = requiredAddress('AEGIS_AGENT_ADDRESS');
  const recipient = requiredAddress('AEGIS_RECIPIENT_ADDRESS');
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  if (balance === 0n) throw new Error('The selected testnet deployer has no test-network gas funds.');

  const currentBlock = await ethers.provider.getBlock('latest');
  const token = await ethers.deployContract('MockINRToken', [1_000_000]);
  await token.waitForDeployment();
  const wallet = await ethers.deployContract('AegisPolicyWallet', [
    await token.getAddress(),
    agent,
    ethers.id('CLOUD-CAPACITY-07'),
    2_500,
    10_000,
    10_000,
    currentBlock.timestamp + 7 * 24 * 60 * 60,
    10,
    [recipient],
  ]);
  await wallet.waitForDeployment();
  await (await token.transfer(await wallet.getAddress(), 100_000)).wait();

  process.stdout.write(`AEGIS TESTNET DEPLOYMENT COMPLETE\n`);
  process.stdout.write(`network=${network.name} chainId=${networkInfo.chainId}\n`);
  process.stdout.write(`mockTestToken=${await token.getAddress()}\n`);
  process.stdout.write(`policyWallet=${await wallet.getAddress()}\n`);
  process.stdout.write('realFundsMoved=false\n');
  process.stdout.write('Update contract-proof.json only after independently verifying these public testnet addresses.\n');
}

run().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
