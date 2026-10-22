/**
 * Component tests (jest-expo + React Native Testing Library).
 * MingCute ships ESM-only with `import`-condition exports, so it is transformed and its
 * subpaths are mapped to the built files explicitly.
 */
const path = require('path');
// The packages don't export ./package.json, so locate them through node_modules lookup paths.
const findPkg = (name) => {
  for (const dir of require.resolve.paths(name) ?? []) {
    const candidate = path.join(dir, name);
    if (require('fs').existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  throw new Error(`Cannot find ${name}`);
};
const mingcute = findPkg('@mingcute/react-native');
const mingcuteIcons = findPkg('@mingcute/icons');

module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Worklets' official resolver: use its JS (non-.native) implementation under Jest.
  resolver: findPkg('react-native-worklets') + '/jest/resolver.js',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts?(x)'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-svg|@mingcute/.*|@gobye/.*)',
  ],
  moduleNameMapper: {
    '^@mingcute/react-native$': `${mingcute}/dist/index.js`,
    '^@mingcute/react-native/(core-regular|core-filled)/(.*)$': `${mingcute}/dist/styles/$1/$2.js`,
    '^@mingcute/icons/(core-regular|core-filled)/(.*)$': `${mingcuteIcons}/dist/styles/$1/$2.js`,
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
