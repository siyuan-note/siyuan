export default {
    customSyntax: "postcss-scss",
    rules: {
        "selector-pseudo-class-disallowed-list": ["has"],
        "declaration-block-no-duplicate-properties": [true, {ignore: ["consecutive-duplicates-with-different-values"]}],
        "declaration-block-no-duplicate-custom-properties": true,
        "declaration-no-important": true,
        "max-nesting-depth": 5,
    },
};
