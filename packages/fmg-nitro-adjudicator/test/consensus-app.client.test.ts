import { ethers } from 'ethers';
import { Channel, toUint256, CommitmentType } from 'fmg-core';

import {
  propose,
  initialConsensus,
  pass,
  vote,
  ConsensusBaseCommitment,
  finalVote,
  veto,
  AppCommitment,
  UpdateType,
  AppAttributes,
} from '../src/consensus-app';
import { validTransition } from '../src/consensus-app';

describe('ConsensusApp', () => {
  const participantA = new ethers.Wallet(
    '6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1',
  );
  const participantB = new ethers.Wallet(
    '6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c',
  );
  const participantC = new ethers.Wallet(
    '5e1b32fb763f62e1d19a9c9cd8c5417bd31b7d697ee018a8afe3cac2292fdd3e',
  );
  const participantD = new ethers.Wallet(
    '0cd211e36788b51c08ec3c622266e0eaddb6a1a028a8fbdd60797c6adf7a3392',
  );
  const participants = [
    participantA.address,
    participantB.address,
    participantC.address,
    participantD.address,
  ];
  const proposedDestination = [participantA.address, participantB.address];

  const allocation = [toUint256(1), toUint256(2), toUint256(3), toUint256(4)];
  const proposedAllocation = [toUint256(6), toUint256(4)];
  const alternativeProposedDestination = [participantB.address, participantC.address];
  const alternativeProposedAllocation = [toUint256(4), toUint256(6)];

  const channel: Channel = { channelType: participantB.address, nonce: 0, participants }; // just use any valid address
  const defaults = {
    channel,
    allocation,
    destination: participants,
    turnNum: 6,
    proposedDestination,
    proposedAllocation,
    commitmentCount: 0,
  };

  function copy(c) {
    return JSON.parse(JSON.stringify(c));
  }

  const oneVoteComplete = propose(
    initialConsensus(defaults),
    proposedAllocation,
    proposedDestination,
  );
  const twoVotesComplete = vote(
    propose(initialConsensus(defaults), proposedAllocation, proposedDestination),
  );
  const threeVotesComplete = vote(
    vote(propose(initialConsensus(defaults), proposedAllocation, proposedDestination)),
  );

  describe('validConsensusCommitment', () => {
    const fromCommitment = threeVotesComplete;
    const toCommitment = finalVote(fromCommitment);
    itThrowsForAnInvalidConsensusState(fromCommitment, toCommitment);
  });

  describe('validProposeCommitment', () => {
    const fromCommitment = initialConsensus(defaults);
    const toCommitment = propose(fromCommitment, proposedAllocation, proposedDestination);
    itThrowsForAnInvalidProposeCommitment(fromCommitment, toCommitment);
  });

  describe('the propose transition', async () => {
    const fromCommitment = initialConsensus(defaults);
    const toCommitment = propose(copy(fromCommitment), proposedAllocation, proposedDestination);
    it('returns true on a valid transition', async () => {
      expectValidTransition(fromCommitment, toCommitment);
    });

    itThrowsWhenTheBalancesAreChanged(fromCommitment, toCommitment);
    itThrowsWhenFurtherVotesRequiredIsNotIntialized(fromCommitment, toCommitment);
  });

  describe('the pass transition', async () => {
    const fromCommitment = initialConsensus(defaults);
    const toCommitment = pass(copy(fromCommitment));

    it('returns true on a valid transition', async () => {
      expectValidTransition(fromCommitment, toCommitment);
    });

    itThrowsWhenTheBalancesAreChanged(fromCommitment, toCommitment);
    itThrowsForAnInvalidConsensusState(fromCommitment, toCommitment);
  });

  describe('the vote transition', async () => {
    const fromCommitment = twoVotesComplete;
    const toCommitment = vote(copy(fromCommitment));

    itReturnsTrueOnAValidTransition(fromCommitment, toCommitment);
    itThrowsWhenFurtherVotesRequiredIsNotDecremented(fromCommitment, toCommitment);
    itThrowsWhenTheBalancesAreChanged(fromCommitment, toCommitment);
    itThrowsWhenTheProposalsAreChanged(fromCommitment, toCommitment);
  });

  describe('the final vote transition', async () => {
    const fromCommitment = twoVotesComplete;
    const toCommitment = finalVote(copy(fromCommitment));

    itReturnsTrueOnAValidTransition(fromCommitment, toCommitment);
    itThrowsForAnInvalidConsensusState(fromCommitment, toCommitment);
    itThrowsWhenTheBalancesAreNotUpdated(fromCommitment, toCommitment);
  });

  describe('the veto transition', async () => {
    const fromCommitment = oneVoteComplete;

    const toCommitment = veto(copy(fromCommitment));

    itReturnsTrueOnAValidTransition(fromCommitment, toCommitment);
    itThrowsWhenTheBalancesAreChanged(fromCommitment, toCommitment);
    itThrowsForAnInvalidConsensusState(fromCommitment, toCommitment);
  });

  // Helper functions

  function appCommitment(
    c: ConsensusBaseCommitment,
    attrs?: Partial<AppAttributes>,
  ): AppCommitment {
    switch (c.appAttributes.updateType) {
      case UpdateType.Proposal:
        return {
          ...c,
          commitmentType: CommitmentType.App,
          appAttributes: {
            ...c.appAttributes,
            ...attrs,
            updateType: UpdateType.Proposal,
          },
        };
      case UpdateType.Consensus:
        return {
          ...c,
          commitmentType: CommitmentType.App,
          appAttributes: {
            ...c.appAttributes,
            ...attrs,
            updateType: UpdateType.Consensus,
          },
        };
    }
  }

  function expectInvalidTransition(
    fromCommitment: AppCommitment,
    toCommitment: AppCommitment,
    error?,
  ) {
    if (error) {
      expect(() => validTransition(fromCommitment, toCommitment)).toThrowError(error);
    } else {
      expect(() => validTransition(fromCommitment, toCommitment)).toThrowError();
    }
  }

  function expectValidTransition(fromCommitment: AppCommitment, toCommitment: AppCommitment) {
    expect(validTransition(fromCommitment, toCommitment)).toBe(true);
  }

  function itReturnsTrueOnAValidTransition(fromCommitmentArgs, toCommitmentArgs) {
    it('returns true when the commitment is valid', async () => {
      const fromCommitment = appCommitment(fromCommitmentArgs);
      const toCommitment = appCommitment(copy(toCommitmentArgs));

      expectValidTransition(fromCommitment, toCommitment);
    });
  }

  function itThrowsForAnInvalidConsensusState(fromCommitmentArgs, toCommitmentArgs) {
    it('throws when the furtherVotesRequired is not zero', async () => {
      const fromCommitment = appCommitment(fromCommitmentArgs);

      const toCommitmentAllocation = appCommitment(toCommitmentArgs, {
        furtherVotesRequired: 1,
      });

      expectInvalidTransition(
        fromCommitment,
        toCommitmentAllocation,
        "ConsensusApp: 'furtherVotesRequired' must be 0 during consensus.",
      );
    });

    it('throws when the proposedAllocation is not reset', async () => {
      const fromCommitment = appCommitment(fromCommitmentArgs);

      const toCommitmentAllocation = appCommitment(copy(toCommitmentArgs), {
        proposedAllocation: allocation,
      });

      expectInvalidTransition(
        fromCommitment,
        toCommitmentAllocation,
        "ConsensusApp: 'proposedAllocation' must be reset during consensus.",
      );
    });

    it('throws when the proposedDestination and proposedAllocation are not the same length', async () => {
      const fromCommitment = appCommitment(fromCommitmentArgs);

      const toCommitmentAllocation = appCommitment(copy(toCommitmentArgs), {
        proposedDestination: participants,
      });

      expectInvalidTransition(
        fromCommitment,
        toCommitmentAllocation,
        "ConsensusApp: 'proposedDestination' must be reset during consensus.",
      );
    });
  }

  function itThrowsForAnInvalidProposeCommitment(fromCommitmentArgs, toCommitmentArgs) {
    it('throws when the furtherVotesRequired is zero', async () => {
      const fromCommitment = appCommitment(fromCommitmentArgs);

      const toCommitmentAllocation = appCommitment(toCommitmentArgs, {
        furtherVotesRequired: 0,
      });

      expectInvalidTransition(
        fromCommitment,
        toCommitmentAllocation,
        "ConsensusApp: 'furtherVotesRequired' must not be 0 during propose.",
      );
    });

    it('throws when the proposedAllocation is reset', async () => {
      const fromCommitment = appCommitment(fromCommitmentArgs);

      const toCommitmentAllocation = appCommitment(toCommitmentArgs, {
        proposedAllocation: [],
      });

      expectInvalidTransition(
        fromCommitment,
        toCommitmentAllocation,
        "ConsensusApp: 'proposedAllocation' must not be reset during propose.",
      );
    });

    it('throws when the proposedDestination and proposedAllocation are not the same length', async () => {
      const fromCommitment = appCommitment(fromCommitmentArgs);

      const toCommitmentAllocation = appCommitment(toCommitmentArgs, {
        proposedAllocation,
        proposedDestination: participants,
      });

      expectInvalidTransition(
        fromCommitment,
        toCommitmentAllocation,
        "ConsensusApp: 'proposedDestination' and 'proposedAllocation' must be the same length during propose.",
      );
    });
  }

  function itThrowsWhenFurtherVotesRequiredIsNotIntialized(fromCommitmentArgs, toCommitmentArgs) {
    it('throws when further votes requires is not initialized properly', async () => {
      const toCommitment = appCommitment(copy(toCommitmentArgs), { furtherVotesRequired: 1 });
      expectInvalidTransition(
        fromCommitmentArgs,
        toCommitment,
        'Consensus App: furtherVotesRequired needs to be initialized to the correct value.',
      );
    });
  }

  function itThrowsWhenFurtherVotesRequiredIsNotDecremented(fromCommitmentArgs, toCommitmentArgs) {
    it('throws when further votes requires is not decremented properly', async () => {
      const toCommitment = appCommitment(copy(toCommitmentArgs), {
        furtherVotesRequired: fromCommitmentArgs.appAttributes.furtherVotesRequired,
      });

      expectInvalidTransition(
        fromCommitmentArgs,
        toCommitment,
        'Consensus App: furtherVotesRequired should be decremented by 1',
      );
    });
  }

  function itThrowsWhenTheBalancesAreNotUpdated(fromCommitmentArgs, toCommitmentArgs) {
    it('throws when the allocation is not updated', async () => {
      const toCommitmentDifferentAllocation = appCommitment({
        ...toCommitmentArgs,
        allocation,
      });
      expectInvalidTransition(fromCommitmentArgs, toCommitmentDifferentAllocation);
    });
    it('throws when the destination is not updated', async () => {
      const toCommitmentDifferentDestination = appCommitment({
        ...toCommitmentArgs,
        destination: participants,
      });
      expectInvalidTransition(fromCommitmentArgs, toCommitmentDifferentDestination);
    });
  }

  function itThrowsWhenTheBalancesAreChanged(fromCommitmentArgs, toCommitmentArgs) {
    it('throws when the allocation is changed', async () => {
      const toCommitmentDifferentAllocation = appCommitment({
        ...toCommitmentArgs,
        allocation: proposedAllocation,
      });

      expectInvalidTransition(
        fromCommitmentArgs,
        toCommitmentDifferentAllocation,
        "ConsensusApp: 'allocation' must be the same between ",
      );
    });
    it('throws when the destination is changed', async () => {
      const toCommitmentDifferentDestination = appCommitment({
        ...toCommitmentArgs,
        destination: proposedDestination,
      });

      expectInvalidTransition(
        fromCommitmentArgs,
        toCommitmentDifferentDestination,
        "ConsensusApp: 'destination' must be the same between ",
      );
    });
  }

  function itThrowsWhenTheProposalsAreChanged(fromCommitmentArgs, toCommitmentArgs) {
    it('throws when the proposedAllocation is changed', async () => {
      const toCommitmentDifferentAllocation = appCommitment(copy(toCommitmentArgs), {
        proposedAllocation: alternativeProposedAllocation,
      });

      expectInvalidTransition(
        fromCommitmentArgs,
        toCommitmentDifferentAllocation,
        "ConsensusApp: 'proposedAllocation' must be the same between ",
      );
    });
    it('throws when the proposedDestination is changed', async () => {
      const toCommitmentDifferentDestination = appCommitment(copy(toCommitmentArgs), {
        proposedDestination: alternativeProposedDestination,
      });

      expectInvalidTransition(
        fromCommitmentArgs,
        toCommitmentDifferentDestination,
        "ConsensusApp: 'proposedDestination' must be the same between ",
      );
    });
  }
});