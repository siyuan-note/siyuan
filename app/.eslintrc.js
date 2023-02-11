module.exports = {
    root: true,
    env: {node: true, browser: true, es6: true},
    parser: "@typescript-eslint/parser",
    plugins: [
        "@typescript-eslint",
    ],
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
    ],
    rules: {
        semi: [2, "always"],
        quotes: [2, "double", {"avoidEscape": true}],
        "no-async-promise-executor": "off",
        "no-prototype-builtins": "off",
        "no-useless-escape": "off",
        "no-irregular-whitespace": "off",
        "@typescript-eslint/ban-ts-comment": "off",
        "@typescript-eslint/no-var-requires": "off",
        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/explicit-module-boundary-types": "off",
        "@typescript-eslint/no-explicit-any": "off",
    },
};
