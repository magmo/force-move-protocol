import { getGanacheProvider } from 'magmo-devtools';
import { ethers } from 'ethers';
import NitroAdjudicatorArtifact from '../build/contracts/NitroAdjudicator.json';
interface MethodCalls {
  [methodName: string]: {
    gasData: number[];
    calls: number;
  };
}
export class GasReporter {
  options;
  provider: ethers.providers.JsonRpcProvider;
  globalConfig;
  startBlockNum: number;
  nitroMethodCalls: MethodCalls = {};

  constructor(globalConfig, options) {
    this.globalConfig = globalConfig;
    this.options = options;
    this.provider = getGanacheProvider();
  }
  onRunStart(results, options): Promise<void> {
    return new Promise((resolve, reject) => {
      this.provider.getBlockNumber().then(blockNum => {
        console.log('hello');
        this.startBlockNum = blockNum;

        console.log(this.startBlockNum);
        resolve();
      });
    });
  }

  onRunComplete(context, results) {
    return new Promise((resolve, reject) => {
      this.provider.getBlockNumber().then(blockNum => {
        this.parseAllBlocks(this.startBlockNum + 1, blockNum).then(() => {
          this.outputMethodInfo('NitroAdjudicator', this.nitroMethodCalls);
        });
      });
    });
  }

  outputMethodInfo(contractName: string, methodCalls: MethodCalls) {
    Object.keys(methodCalls).forEach(methodName => {
      console.log(methodName);
      const method = methodCalls[methodName];
      const total = method.gasData.reduce((acc, datum) => acc + datum, 0);
      const average = Math.round(total / method.gasData.length);
      const min = Math.min(...method.gasData);
      const max = Math.max(...method.gasData);
      console.log(`Total calls ${method.calls}`);
      console.log(`Min gas ${min}`);
      console.log(`Max gas ${max}`);
      console.log(`Average gas ${average}`);
    });
  }

  async parseAllBlocks(startBlockNum, endBlockNum) {
    for (let i = startBlockNum; i <= endBlockNum; i++) {
      await this.parseBlock(i);
    }
  }

  async parseBlock(blockNum) {
    const block = await this.provider.getBlock(blockNum);
    for (const transHash of block.transactions) {
      console.log(transHash);
      const transaction = await this.provider.getTransaction(transHash);
      const transactionReceipt = await this.provider.getTransactionReceipt(transHash);

      const nitroInterface = new ethers.utils.Interface(NitroAdjudicatorArtifact.abi);
      const details = nitroInterface.parseTransaction(transaction);
      if (details != null) {
        if (!this.nitroMethodCalls[details.name]) {
          this.nitroMethodCalls[details.name] = { gasData: [], calls: 0 };
        }
        this.nitroMethodCalls[details.name].gasData.push(transactionReceipt.gasUsed.toNumber());
        this.nitroMethodCalls[details.name].calls++;
      }
    }
  }
}

module.exports = GasReporter;
