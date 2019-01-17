pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;
import "fmg-core/contracts/State.sol";
import "fmg-core/contracts/Rules.sol";

contract NitroAdjudicator {
    using State for State.StateStruct;

    struct Authorization {
        // Prevents replay attacks:
        // It's required that the participant signs the message, meaning only
        // the participant can authorize a withdrawal.
        // Moreover, the participant should sign the address that they wish
        // to send the transaction from, preventing any replay attack.
        address participant; // the account used to sign state transitions
        address destination; // either an account or a channel
        uint amount;
        address sender; // the account used to sign transactions
    }

    struct Outcome {
        address[] destination;
        uint256 finalizedAt;
        State.StateStruct challengeState;
        uint[] allocation;         // should be zero length in guarantee channels
    }
    struct Guarantee {
        address guarantor;
        address target;
        address[] priorities;
    }
    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
    struct ConclusionProof {
        State.StateStruct penultimateState;
        Signature penultimateSignature;
        State.StateStruct ultimateState;
        Signature ultimateSignature;
    }

    mapping(address => uint) public holdings;
    mapping(address => Outcome) public outcomes;

    // TODO: Challenge duration should depend on the channel
    uint constant CHALLENGE_DURATION = 5 minutes;

    // **************
    // Eth Management
    // **************

    function deposit(address destination) public payable {
        holdings[destination] = holdings[destination] + msg.value;
    }

    function withdraw(address participant, address payable destination, uint amount, uint8 _v, bytes32 _r, bytes32 _s) public payable {
        require(
            holdings[participant] >= amount,
            "Withdraw: overdrawn"
        );
        Authorization memory authorization = Authorization(
            participant,
            destination,
            amount,
            msg.sender
        );

        require(
            recoverSigner(abi.encode(authorization), _v, _r, _s) == participant,
            "Withdraw: not authorized by participant"
        );

        holdings[participant] = holdings[participant] - amount;
        destination.transfer(amount);
    }

    function transfer(address channel, address destination, uint amount) public {
        require(
            outcomes[channel].finalizedAt < now,
            "Transfer: outcome must be final"
        );
        require(
            outcomes[channel].finalizedAt > 0,
            "Transfer: outcome must be present"
        );

        uint owedToDestination = overlap(destination, outcomes[channel], amount);

        require(
            owedToDestination <= holdings[channel],
            "Transfer: holdings[channel] must cover transfer"
        );
        require(
            owedToDestination >= amount,
            "Transfer: transfer too large"
        );

        holdings[destination] = holdings[destination] + owedToDestination;
        holdings[channel] = holdings[channel] - owedToDestination;

        outcomes[channel] = remove(outcomes[channel], destination, amount);
    }

    function claim(address recipient, Guarantee memory guarantee, uint amount) public {
        require(
            isChannelClosed(guarantee.target),
            "Claim: channel must be closed"
        );
        require(
            // the outcome is assumed to be valid, so this check is sufficient
            guarantee.priorities.length == outcomes[guarantee.target].destination.length,
            'Claim: invalid guarantee -- wrong priorities list length'
        );

        uint funding = holdings[guarantee.guarantor];
        Outcome memory reprioritizedOutcome = reprioritize(outcomes[guarantee.target], guarantee);
        if (overlap(recipient, reprioritizedOutcome, funding) >= amount) {
            outcomes[guarantee.target] = remove(outcomes[guarantee.target], recipient, amount);
            holdings[guarantee.guarantor] -= amount;
            holdings[recipient] += amount;
        } else {
            revert('Claim: guarantor must be sufficiently funded');
        }
    }

    // ************************
    // Eth Management Logic
    // ************************

    function reprioritize(Outcome memory outcome, Guarantee memory guarantee) internal pure returns (Outcome memory) {
        address[] memory newDestination = new address[](guarantee.priorities.length);
        uint[] memory newAllocation = new uint[](guarantee.priorities.length);
        for (uint i = 0; i < guarantee.priorities.length; i++) {
            for (uint j = 0; j < guarantee.priorities.length; j++) {
                if (guarantee.priorities[i] == outcome.destination[j]) {
                    newDestination[i] = outcome.destination[j];
                    newAllocation[i] = outcome.allocation[j];
                    break;
                }
            }
        }

        return Outcome(
            newDestination,
            newAllocation,
            outcome.finalizedAt,
            outcome.challengeState
        );
    }

    function overlap(address recipient, Outcome memory outcome, uint funding) internal pure returns (uint256) {
        uint result = 0;

        for (uint i = 0; i < outcome.destination.length; i++) {
            if (funding <= 0) {
                break;
            }

            if (outcome.destination[i] == recipient) {
                // It is technically allowed for a recipient to be listed in the
                // outcome multiple times, so we must iterate through the entire
                // array.
                result += min(outcome.allocation[i], funding);
            }

            funding -= outcome.allocation[i];
        }

        return result;
    }

    function remove(Outcome memory outcome, address recipient, uint amount) internal pure returns (Outcome memory) { 
        uint256[] memory updatedAllocation = outcome.allocation;
        uint256 reduction = 0;
        for (uint i = 0; i < outcome.destination.length; i++) {
            if (outcome.destination[i] == recipient) {
                // It is technically allowed for a recipient to be listed in the
                // outcome multiple times, so we must iterate through the entire
                // array.
                reduction += min(outcome.allocation[i], amount);
                amount = amount - reduction;
                updatedAllocation[i] = updatedAllocation[i] - reduction;
            }
        }

        return Outcome(
            outcome.destination,
            updatedAllocation,
            outcome.finalizedAt,
            outcome.challengeState // Once the outcome is finalized, 
        );
    }

    // ****************
    // ForceMove Events
    // ****************

    event ChallengeCreated(
        address channelId,
        State.StateStruct state,
        uint256 finalizedAt
    );
    event Concluded(address channelId);
    event Refuted(address channelId, State.StateStruct refutation);
    event RespondedWithMove(address channelId, State.StateStruct response);
    event RespondedWithAlternativeMove(State.StateStruct alternativeResponse);

    // **********************
    // ForceMove Protocol API
    // **********************

    function conclude(ConclusionProof memory proof) public {
        _conclude(proof);
    }

    function forceMove(
        State.StateStruct memory agreedState,
        State.StateStruct memory challengeState,
        Signature[] memory signatures
    ) public {
        require(
            !isChannelClosed(agreedState.channelId()),
            "ForceMove: channel must be open"
        );
        require(
            moveAuthorized(agreedState, signatures[0]),
            "ForceMove: agreedState not authorized"
        );
        require(
            moveAuthorized(challengeState, signatures[1]),
            "ForceMove: challengeState not authorized"
        );
        require(
            Rules.validTransition(agreedState, challengeState)
        );

        address channelId = agreedState.channelId();

        outcomes[channelId] = Outcome(
            challengeState.participants,
            challengeState.resolution,
            now + CHALLENGE_DURATION,
            challengeState
        );

        emit ChallengeCreated(
            channelId,
            challengeState,
            now
        );
    }

    function refute(State.StateStruct memory refutationState, Signature memory signature) public {
        address channel = refutationState.channelId();
        require(
            !isChannelClosed(channel),
            "Refute: channel must be open"
        );

        require(
            moveAuthorized(refutationState, signature),
            "Refute: move must be authorized"
        );

        require(
            Rules.validRefute(outcomes[channel].challengeState, refutationState, signature.v, signature.r, signature.s),
            "Refute: must be a valid refute"
        );

        emit Refuted(channel, refutationState);
        Outcome memory updatedOutcome = Outcome(
            outcomes[channel].destination,
            refutationState.resolution,
            0,
            refutationState
        );
        outcomes[channel] = updatedOutcome;
    }

    function respondWithMove(State.StateStruct memory responseState, Signature memory signature) public {
        address channel = responseState.channelId();
        require(
            !isChannelClosed(channel),
            "RespondWithMove: channel must be open"
        );

        require(
            moveAuthorized(responseState, signature),
            "RespondWithMove: move must be authorized"
        );

        require(
            Rules.validRespondWithMove(outcomes[channel].challengeState, responseState, signature.v, signature.r, signature.s),
            "RespondWithMove: must be a valid response"
        );

        emit RespondedWithMove(channel, responseState);

        Outcome memory updatedOutcome = Outcome(
            outcomes[channel].destination,
            responseState.resolution,
            0,
            responseState
        );
        outcomes[channel] = updatedOutcome;
    }

    function alternativeRespondWithMove(
        State.StateStruct memory _alternativeState,
        State.StateStruct memory _responseState,
        Signature memory _alternativeSignature,
        Signature memory _responseSignature
    )
      public
    {
        address channel = _responseState.channelId();
        require(
            !isChannelClosed(channel),
            "AlternativeRespondWithMove: channel must be open"
        );

        require(
            moveAuthorized(_responseState, _responseSignature),
            "AlternativeRespondWithMove: move must be authorized"
        );

        uint8[] memory v = new uint8[](2);
        v[0] = _alternativeSignature.v;
        v[1] = _responseSignature.v;

        bytes32[] memory r = new bytes32[](2);
        r[0] = _alternativeSignature.r;
        r[1] = _responseSignature.r;

        bytes32[] memory s = new bytes32[](2);
        s[0] = _alternativeSignature.s;
        s[1] = _responseSignature.s;


        require(
            Rules.validAlternativeRespondWithMove(
                outcomes[channel].challengeState,
                _alternativeState,
                _responseState,
                v,
                r,
                s
            ),
            "RespondWithMove: must be a valid response"
        );

        emit RespondedWithAlternativeMove(_responseState);

        Outcome memory updatedOutcome = Outcome(
            outcomes[channel].destination,
            _responseState.resolution,
            0,
            _responseState
        );
        outcomes[channel] = updatedOutcome;
    }

    // ************************
    // ForceMove Protocol Logic
    // ************************

    function _conclude(ConclusionProof memory proof) internal {
        address channelId = proof.penultimateState.channelId();
        require(
            (outcomes[channelId].finalizedAt > now || outcomes[channelId].finalizedAt == 0),
            "Conclude: channel must not be finalized"
        );

        outcomes[channelId] = Outcome(
            proof.penultimateState.participants,
            proof.penultimateState.resolution,
            now,
            proof.penultimateState
        );
        emit Concluded(channelId);
    }

    // ****************
    // Helper functions
    // ****************

    function isChannelClosed(address channel) internal view returns (bool) {
        return outcomes[channel].finalizedAt < now && outcomes[channel].finalizedAt > 0;
    }

    function moveAuthorized(State.StateStruct memory _state, Signature memory signature) internal pure returns (bool){
        return _state.mover() == recoverSigner(
            abi.encode(_state),
            signature.v,
            signature.r,
            signature.s
        );
    }

    function recoverSigner(bytes memory _d, uint8 _v, bytes32 _r, bytes32 _s) internal pure returns(address) {
        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 h = keccak256(_d);

        bytes32 prefixedHash = keccak256(abi.encodePacked(prefix, h));

        address a = ecrecover(prefixedHash, _v, _r, _s);

        return(a);
    }

    function min(uint a, uint b) internal pure returns (uint) {
        if (a <= b) {
            return a;
        }

        return b;
    }
}