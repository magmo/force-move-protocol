var CountingState = artifacts.require('./CountingState.sol');
var CountingGame = artifacts.require('./CountingGame.sol');
var State = artifacts.require('./State.sol');
var Rules = artifacts.require('./Rules.sol');

module.exports = function(deployer) {
  deployer.deploy(State);

  deployer.link(State, Rules);
  deployer.deploy(Rules);

  deployer.link(State, CountingState);
  deployer.deploy(CountingState);
  deployer.link(CountingState, CountingGame);
  deployer.link(State, CountingGame);
  deployer.deploy(CountingGame);
};
