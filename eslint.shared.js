module.exports = {
    rules: {
        'arrow-spacing': 'error',
        'comma-spacing': [
            'error',
            {
                after: true,
                before: false
            }
        ],
        'comma-style': [
            'error',
            'last'
        ],
        'computed-property-spacing': [
            'error',
            'never'
        ],
        indent: [
            'error',
            4
        ],
        // git (core.autocrlf) manages line endings per platform; enforcing LF in
        // the working tree fails every file on Windows checkouts and makes
        // `eslint --fix` rewrite line endings repo-wide.
        'linebreak-style': 'off',
        'no-array-constructor': 'error',
        'no-duplicate-imports': 'error',
        'no-mixed-spaces-and-tabs': [
            'error',
            'smart-tabs'
        ],
        'no-multi-spaces': 'error',
        'no-var': 'error',
        'no-whitespace-before-property': 'error',
        'prefer-const': 'error',
        quotes: [
            'error',
            'single',
            {
                allowTemplateLiterals: true,
                avoidEscape: true
            }
        ],
        semi: 'error',
        'semi-spacing': 'error',
        'semi-style': [
            'error',
            'last'
        ],
        'space-in-parens': [
            'error',
            'never'
        ],
        'space-unary-ops': 'error',
        'template-curly-spacing': 'error'
    }
};
