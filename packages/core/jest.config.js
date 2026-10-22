/** Pure TypeScript domain tests — Node environment; TypeScript stripped with Expo's Babel preset. */
const presetExpo = require.resolve('babel-preset-expo', { paths: [require.resolve('expo/package.json')] });

module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.tsx?$': ['babel-jest', { presets: [presetExpo] }] },
  testMatch: ['**/__tests__/**/*.test.ts'],
};
