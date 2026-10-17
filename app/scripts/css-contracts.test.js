const assert = require("node:assert/strict");
const {test} = require("node:test");

test("class contracts inspect HTML, templates, class mutation and selectors", async () => {
    const {literalClasses, selectorClasses} = await import("./css-contracts.mjs");
    const source = 'const html = `<div class="b3-button fn__none"><span class="history__label">${label}</span></div>`;' +
        'el.className = "sy__outline"; el.classList.add("fn__flex"); el.setAttribute("class", "b3-list");' +
        'el.querySelector(".history__label[data-name=hello]"); const unrelated = "b3-link";';
    assert.deepEqual([...literalClasses(source)].sort(), ["b3-button", "b3-list", "fn__flex", "fn__none", "history__label", "sy__outline"]);
    assert.deepEqual([...literalClasses('<div class="mobile-safe-area fn__none"></div>', "mobile.tpl")].sort(), ["fn__none", "mobile-safe-area"]);
    assert.deepEqual([...selectorClasses('.b3-list[data-name=".not-a-class"] .fn__none')].sort(), ["b3-list", "fn__none"]);
});

test("contract baselines permit existing hooks but reject new classes and repeated style violations", async () => {
    const {newClassViolations, newStyleViolations} = await import("./css-contracts.mjs");
    assert.deepEqual(newClassViolations(new Set(["fn__ellipsis"]), new Map([
        ["fn__ellipsis", []], ["ft__ellipsis", []], ["sy__outline", []], ["hljs-language-x", []],
    ]), {"sy__outline": {reason: "behavior hook"}}), ["ft__ellipsis"]);
    const existing = {file: "existing.scss", rule: "declaration-no-important", text: "important", source: "display: none !important;"};
    assert.deepEqual(newStyleViolations([existing], [existing]), []);
    assert.deepEqual(newStyleViolations([existing, existing], [existing]), [existing]);
});

test("class definitions include injected styles across template expressions", async () => {
    const {injectedCSSClasses} = await import("./css-contracts.mjs");
    const source = "const html = `<style>.history__label {color: ${color};}\n.pdf-embedded-asset__icon {display: block;}</style>`;" +
        "style += `\n:root {--size: ${size}px;}\n.b3-typography {font-family: ${family};}`;";
    assert.deepEqual([...injectedCSSClasses(source)].sort(), ["b3-typography", "history__label", "pdf-embedded-asset__icon"]);
});

test("repository CSS contracts have no new violations", async () => {
    const {checkContracts} = await import("./css-contracts.mjs");
    await checkContracts();
});

test("optimized editor and PDF selectors keep explicit keys and static exports retain inline RTL", () => {
    const sass = require("sass");
    const path = require("node:path");
    const postcss = require("postcss");
    const selectorParser = require("postcss-selector-parser");
    const expandedSubjects = new Set([
        "[data-node-id],[data-table-cell-node]", ".p,.h1,.h2,.h3,.h4,.h5,.h6", "input,textarea", "span,br",
    ]);
    // 仅约束已经优化的热点，不禁止其他具有不同特异性或匹配语义的伪类。
    for (const entry of ["base", "mobile", "export"]) {
        const css = sass.compile(path.join(__dirname, "../src/assets/scss", `${entry}.scss`), {
            logger: sass.Logger.silent,
        }).css;
        let inlineListRules = 0;
        let markedListRules = 0;
        postcss.parse(css).walkRules(rule => {
            const selectors = selectorParser().astSync(rule.selector);
            selectors.walkPseudos(node => {
                if (node.value === ":is") {
                    assert.equal(expandedSubjects.has(node.nodes.map(option => option.toString().trim()).join(",")), false,
                        `${entry}: ${rule.selector}`);
                }
            });
            if (!rule.nodes.some(node => node.prop === "margin-right" && node.value === "34px")) {
                return;
            }
            selectors.walkAttributes(node => {
                if (node.attribute === "style" && node.operator === "*=" && node.value === "direction: rtl") {
                    inlineListRules++;
                }
            });
            selectors.walkClasses(node => {
                if (node.value === "protyle-block--rtl") {
                    markedListRules++;
                }
            });
        });
        if (entry === "export") {
            assert.ok(inlineListRules > 0, "static exports must lay out existing inline RTL without scripts");
        } else {
            assert.equal(inlineListRules, 0, "editor list layout must not invalidate descendants on unrelated style changes");
            assert.ok(markedListRules > 0);
        }
    }
});

test("shared token defaults preserve local var resolution and runtime overrides", async () => {
    const sass = require("sass");
    const path = require("node:path");
    const source = `@use "tokens";
    .example { padding-left: tokens.token("--agent-code-pad"); background: tokens.token("--b3-av-calendar-weekend-background");
    margin-top: calc(-1 * tokens.token("--tabs-border-top-width")); border-radius: tokens.token("--tabs-border-top-left-radius"); }`;
    const options = {loadPaths: [path.resolve(__dirname, "../src/assets/scss/util")]};
    const css = sass.compileString(source, options).css;
    assert.match(css, /padding-left: var\(--agent-code-pad, 8px\)/);
    assert.match(css, /background: var\(--b3-av-calendar-weekend-background, var\(--b3-theme-surface\)\)/);
    assert.match(css, /margin-top: calc\(-1 \* var\(--tabs-border-top-width, 1px\)\)/);
    assert.match(css, /border-radius: var\(--tabs-border-top-left-radius, var\(--b3-border-radius\)\)/);
    assert.throws(() => sass.compileString(source.replace("--agent-code-pad", "--unknown"), options), /Unknown token default/);
});
