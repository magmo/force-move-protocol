import {
  CommitmentType,
  Uint32,
  Uint256,
  Address,
  Bytes,
  BaseCommitment,
  Commitment,
} from 'fmg-core';
import abi from 'web3-eth-abi';
import { bigNumberify } from 'ethers/utils';

export interface AppAttributes {
  consensusCounter: Uint32;
  proposedAllocation: Uint256[];
  proposedDestination: Address[];
}

interface ConsensusCommitment extends BaseCommitment {
  appAttributes: AppAttributes;
}

export function asCoreCommitment(commitment: ConsensusCommitment) {
  return {
    ...commitment,
    appAttributes: bytesFromAppAttributes(commitment.appAttributes),
  };
}

export function asConsensusCommitment(commitment: Commitment) {
  return {
    ...commitment,
    appAttributes: appAttributesFromBytes(commitment.appAttributes),
  };
}

function baseAttributes(opts: BaseCommitment) {
  const { channel, turnNum, allocation, destination, commitmentCount, commitmentType } = opts;
  return { channel, turnNum, allocation, destination, commitmentCount, commitmentType };
}

function preFundSetupCommitment(opts: ConsensusCommitment) {
  return {
    ...baseAttributes(opts),
    appAttributes: bytesFromAppAttributes(opts.appAttributes),
    commitmentType: CommitmentType.PreFundSetup,
  };
}

function postFundSetupCommitment(opts) {
  return {
    ...baseAttributes(opts),
    commitmentType: CommitmentType.PostFundSetup,
    appAttributes: bytesFromAppAttributes(opts.appAttributes),
  };
}

function appCommitment(opts: ConsensusCommitment) {
  return {
    ...baseAttributes(opts),
    commitmentType: CommitmentType.App,
    appAttributes: bytesFromAppAttributes(opts.appAttributes),
  };
}

function concludeCommitment(opts: ConsensusCommitment) {
  return {
    ...baseAttributes(opts),
    commitmentType: CommitmentType.Conclude,
    appAttributes: bytesFromAppAttributes(opts.appAttributes),
  };
}

export const commitments = {
  preFundSetupCommitment,
  postFundSetupCommitment,
  appCommitment,
  concludeCommitment,
};

function appAttributesFromEthersArgs(
  consensusCommitmentArgs: [string, string[], string[]],
): AppAttributes {
  return {
    consensusCounter: parseInt(consensusCommitmentArgs[0], 10),
    proposedAllocation: consensusCommitmentArgs[1].map(bigNumberify).map(bn => bn.toHexString()),
    proposedDestination: consensusCommitmentArgs[2],
  };
}

const SolidityConsensusCommitmentType = {
  ConsensusCommitmentStruct: {
    consensusCounter: 'uint32',
    proposedAllocation: 'uint256[]',
    proposedDestination: 'address[]',
  },
};

export function bytesFromAppAttributes(appAttrs: AppAttributes): Bytes {
  return abi.encodeParameter(SolidityConsensusCommitmentType, [
    appAttrs.consensusCounter,
    appAttrs.proposedAllocation,
    appAttrs.proposedDestination,
  ]);
}

export function appAttributesFromBytes(appAttrs: Bytes): AppAttributes {
  return appAttributesFromEthersArgs(
    abi.decodeParameter(SolidityConsensusCommitmentType, appAttrs),
  );
}
