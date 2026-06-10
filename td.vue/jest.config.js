module.exports = async () => {
    return {
        preset: '@vue/cli-plugin-unit-jest',
        verbose: true,
        transform: {
            // process `*.js` files with `babel-jest`
            '.*\\.(js)$': 'babel-jest'
        },
        moduleNameMapper: {
            // TODO: Remove this alias when fully migrated to Vue 3 and
            // the compat dependency is removed
            '^vue$': require.resolve('@vue/compat'),
            '^@vue/test-utils$': '<rootDir>/src/plugins/vue-test-utils-compat.js',
            '^vue-i18n$': '<rootDir>/src/plugins/vue-i18n-test-compat.js',
            '^@/(.*)$': '<rootDir>/src/$1',
            // Only the PURE @tmcore subpaths (tools.js/taxonomy.js) are browser/jest-safe;
            // the barrel + validate.js pull node:module, so intentionally no bare mapper.
            '^@tmcore/(.*)$': '<rootDir>/../shared/tmcore/$1',
            // The only relative './validate.js' import in the workspace SOURCE is
            // tmcore's (ops.js — verified by grep); map it to the browser shim here,
            // mirroring the webpack NormalModuleReplacementPlugin in vue.config.js,
            // because tmcore/validate.js uses node:module createRequire (jsdom-unsafe).
            // CAVEAT: the uuid package ALSO has an internal ./validate.js, but its
            // CJS v4 path short-circuits through crypto.randomUUID (always present
            // on supported Node) and never loads it under jest. Webpack needed an
            // explicit node_modules exclusion for the same collision.
            '^\\./validate\\.js$': '<rootDir>/src/service/schema/tmcoreValidate.js',
            '^lodash-es$': 'lodash'
        },
        collectCoverage: true,
        collectCoverageFrom: [
            'src/**/*.{js,vue}',
            '!src/service/demo/**',
            '!**/node_modules/**',
            '!**/coverage/**',
            '!src/main*.js', // Bootstrap code for web app and desktop app
            '!src/plugins/*.js' // Bootstrap code
        ],
        resetMocks: true,
        restoreMocks: true,
        transformIgnorePatterns: [
            '<rootDir>/node_modules/(?!lodash-es|axios|passive-events-support)'
        ]
    };
};
