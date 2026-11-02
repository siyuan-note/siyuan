const assert = require("node:assert/strict");
const path = require("node:path");
const {test} = require("node:test");
const sass = require("sass");
const postcss = require("postcss");
const {readFileSync} = require("node:fs");

test("Markdown submenus inset their rows without enlarging the panel or changing touch targets", () => {
    const css = postcss.parse(sass.compile(path.join(__dirname, "../src/assets/scss/markdown.scss"), {
        logger: sass.Logger.silent,
    }).css);
    const declarations = selector => {
        const values = new Map();
        css.walkRules(selector, rule => rule.walkDecls(declaration => values.set(declaration.prop, declaration.value)));
        return values;
    };
    const menu = declarations(".markdown-choice__menu");
    assert.equal(menu.get("padding-inline"), "6px", "both LTR and RTL rows need an inset");
    assert.equal(menu.get("box-sizing"), "border-box", "padding stays within the constrained panel width");
    assert.equal(menu.get("width"), "min(220px, 100vw - 16px)");
    assert.equal(menu.get("overflow"), "auto", "constrained panels retain scrolling");
    for (const property of ["padding-block", "padding-top", "padding-bottom", "min-height", "height"]) {
        assert.equal(menu.has(property), false, `submenu inset must not alter ${property}`);
    }
    assert.equal(declarations(".markdown-menu").get("padding"), "6px", "the parent menu is unchanged");
    let touchTargets = 0;
    css.walkRules(rule => {
        if (rule.selectors.includes(".markdown-menu .b3-menu__item")) {
            rule.walkDecls("min-height", declaration => {
                assert.equal(declaration.value, "44px");
                touchTargets++;
            });
        }
    });
    assert.ok(touchTargets > 0, "touch menu rows keep their existing minimum height");
});

test("Markdown footer covers the drawer's bottom shadow without clipping editor overlays or header menus", () => {
    const css = postcss.parse(sass.compile(path.join(__dirname, "../src/assets/scss/markdown.scss"), {
        logger: sass.Logger.silent,
    }).css);
    const declarations = selector => {
        const values = new Map();
        css.walkRules(selector, rule => rule.walkDecls(declaration => values.set(declaration.prop, declaration.value)));
        return values;
    };
    const footer = declarations(".markdown-footer");
    const drawer = declarations(".markdown-tree[data-drawer=true]");
    assert.equal(footer.get("position"), "relative");
    assert.equal(footer.get("background"), "var(--b3-theme-surface)");
    assert.equal(footer.get("z-index"), drawer.get("z-index"));
    assert.ok(Number(footer.get("z-index")) < Number(declarations(".markdown-header").get("z-index")),
        "header menus must remain above the footer");
    assert.equal(drawer.get("box-shadow"), "var(--b3-dialog-shadow)", "retain the drawer's right-hand shadow");
    const workspace = declarations(".markdown-workspace");
    for (const property of ["overflow", "overflow-x", "overflow-y", "clip-path"]) {
        assert.equal(workspace.has(property), false, "do not clip editor menus to the workspace");
    }
    const source = readFileSync(path.join(__dirname, "../src/markdown/index.ts"), "utf8");
    const workspaceStart = source.indexOf('<div class="markdown-workspace"');
    const footerStart = source.indexOf('<footer class="markdown-footer"');
    assert.ok(workspaceStart >= 0 && footerStart > workspaceStart,
        "the equally layered footer must follow the drawer workspace in document order");
});


test("Markdown touch feedback follows the theme and preserves keyboard focus indicators", () => {
    const css = postcss.parse(sass.compile(path.join(__dirname, "../src/assets/scss/markdown.scss"), {
        logger: sass.Logger.silent,
    }).css);
    let tapHighlight;
    css.walkRules(".markdown-app", rule => rule.walkDecls("-webkit-tap-highlight-color", declaration => {
        tapHighlight = declaration.value;
    }));
    assert.equal(tapHighlight, "var(--b3-list-hover)");
    const reset = readFileSync(path.join(__dirname, "../src/assets/scss/util/_reset.scss"), "utf8");
    assert.ok(reset.includes(`-webkit-tap-highlight-color: ${tapHighlight}`), "standalone feedback matches the main app");
    const focus = [];
    css.walkRules(rule => {
        if (rule.selectors.includes(".markdown-choice:focus-visible") || rule.selectors.includes(".markdown-menu button:focus-visible")) {
            rule.walkDecls("outline", declaration => focus.push(declaration.value));
        }
    });
    assert.ok(focus.includes("1px solid var(--b3-theme-primary)"), "keyboard focus remains visible");
});

test("Markdown editor popovers stay below the drawer and menus without clipping their contents", () => {
    const css = postcss.parse(sass.compile(path.join(__dirname, "../src/assets/scss/markdown.scss"), {
        logger: sass.Logger.silent,
    }).css);
    const declarations = selector => {
        const values = new Map();
        css.walkRules(selector, rule => rule.walkDecls(declaration => values.set(declaration.prop, declaration.value)));
        return values;
    };
    const editor = declarations(".markdown-editor.vditor");
    assert.equal(editor.get("isolation"), "isolate", "child popup z-index is local to the editor");
    assert.equal(editor.has("z-index"), false, "do not raise the editor context above the shell");
    assert.equal(declarations(".markdown-tree[data-drawer=true]").get("z-index"), "2");
    assert.equal(declarations(".markdown-workspace--drawer::after").get("z-index"), "1");
    assert.equal(declarations(".markdown-header").get("z-index"), "3");
    for (const selector of [".markdown-editor.vditor", ".markdown-workspace"]) {
        const values = declarations(selector);
        for (const property of ["overflow", "overflow-x", "overflow-y", "clip-path", "contain", "transform"]) {
            assert.equal(values.has(property), false, `${selector} must not clip or reposition editor overlays`);
        }
    }
});
