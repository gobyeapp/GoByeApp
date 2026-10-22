/* global jest */
// Reanimated ships its own Jest mock; animations resolve instantly in tests.
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock');
  // The official mock omits a few helpers GoBye uses for motion; provide inert versions.
  return {
    ...mock,
    useReducedMotion: mock.useReducedMotion ?? (() => true),
    withDelay: mock.withDelay ?? ((_delay, animation) => animation),
    cancelAnimation: mock.cancelAnimation ?? (() => undefined),
  };
});
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
