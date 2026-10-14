import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/av/row.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

test("sticky views follow breadcrumbs and keep wrapped height in sync when resized", () => {
    const exports: {stickyRow?: (block: unknown, scroll: unknown, status: string) => void} = {};
    runInNewContext(compiled, {
        exports,
        require: () => ({hasTopClosestByAttribute: () => false, updateFrozenColumns: () => {}}),
        window: {innerHeight: 800},
    });
    let paneBottom = 800;
    let viewsWidth = 400;
    const views = {
        classList: {contains: (name: string) => name === "av__views--fixed"},
        get offsetHeight() { return parseFloat(this.style.width) < 300 ? 80 : 40; },
        style: {top: "", left: "", width: "", clipPath: ""},
        closest: (selector: string) => ({
            getBoundingClientRect: () => ({
                top: 24, bottom: selector === ".layout-tab-container" ? paneBottom : 800, left: 0, right: 500,
            }),
        }),
        getBoundingClientRect: () => ({top: parseFloat(views.style.top), bottom: parseFloat(views.style.top) + views.offsetHeight, left: 20, right: 20 + viewsWidth}),
        nextElementSibling: {
            classList: {contains: (name: string) => name === "av__views-placeholder"},
            style: {height: "40px"},
            getBoundingClientRect: () => ({top: -100, left: 20, width: viewsWidth}),
        },
    };
    const block = {
        classList: {contains: () => false},
        dataset: {avType: "gallery"},
        querySelector: (selector: string) => selector === ".av__views" ? views : null,
        getBoundingClientRect: () => ({bottom: 600}),
    };
    let hidden = false;
    let breadcrumbBottom = 72;
    const scroll = {
        scrollTop: 200,
        getBoundingClientRect: () => ({top: 24, bottom: 800}),
        previousElementSibling: {
            classList: {contains: (name: string) => name === "protyle-breadcrumb"},
            getAttribute: () => hidden ? "true" : null,
            getBoundingClientRect: () => ({bottom: breadcrumbBottom}),
        },
    };
    exports.stickyRow(block, scroll, "top");
    assert.equal(views.style.top, "72px");
    assert.equal(views.style.clipPath, "inset(0px 0px 0px 0px)");
    paneBottom = 90;
    exports.stickyRow(block, scroll, "top");
    assert.equal(views.style.clipPath, "inset(0px 0px 22px 0px)");
    paneBottom = 60;
    exports.stickyRow(block, scroll, "top");
    assert.equal(views.style.clipPath, "inset(0px 0px 52px 0px)");
    paneBottom = 800;
    exports.stickyRow(block, scroll, "top");
    assert.equal(views.style.clipPath, "inset(0px 0px 0px 0px)");
    hidden = true;
    exports.stickyRow(block, scroll, "top");
    assert.equal(views.style.top, "24px");
    hidden = false;
    exports.stickyRow(block, scroll, "top");
    assert.equal(views.style.top, "72px");
    for (const topbarHeight of [48, 0]) {
        let previousTop: number | undefined;
        for (const offset of [46, 47, 48, 47, 46]) {
            hidden = offset === 48;
            breadcrumbBottom = 24 + (topbarHeight + 42) * (1 - offset / 48);
            exports.stickyRow(block, scroll, "top");
            const top = parseFloat(views.style.top);
            assert.equal(top, Math.round(breadcrumbBottom));
            if (previousTop !== undefined) {
                assert.ok(Math.abs(top - previousTop) <= 2);
            }
            previousTop = top;
        }
    }
    hidden = false;
    breadcrumbBottom = 72;
    paneBottom = 120;
    for (const width of [280, 400, 280]) {
        viewsWidth = width;
        exports.stickyRow(block, scroll, "top");
        assert.equal(views.style.width, width + "px");
        assert.equal(views.nextElementSibling.style.height, width < 300 ? "80px" : "40px");
        assert.equal(views.style.clipPath, width < 300 ? "inset(0px 0px 32px 0px)" : "inset(0px 0px 0px 0px)");
    }
});

test("backlink scrolling clears fixed rows and their spacers without calculating window positions", () => {
    const exports: {stickyRow?: (block: unknown, scroll: unknown, status: string) => void} = {};
    runInNewContext(compiled, {exports, require: () => ({updateFrozenColumns: () => {}})});
    const makeRow = (fixedClass: string, placeholderClass: string) => {
        const classes = new Set([fixedClass]);
        const placeholder = {
            removed: false,
            classList: {contains: (name: string) => name === placeholderClass},
            remove() { this.removed = true; },
        };
        return {
            classList: {contains: (name: string) => classes.has(name), remove: (name: string) => classes.delete(name)},
            style: {top: "120px", bottom: "10px", left: "30px", width: "400px", transform: "translateX(-100px)", clipPath: "inset(0 50px 0 0)"},
            nextElementSibling: placeholder,
        };
    };
    const views = makeRow("av__views--fixed", "av__views-placeholder");
    const header = makeRow("av__row--header--fixed", "av__row--header-placeholder");
    const footer = makeRow("av__row--footer--fixed", "av__row--footer--placeholder");
    const block = {
        classList: {contains: (name: string) => name === "av--backlink"},
        querySelector: () => views,
        querySelectorAll: (selector: string) => selector.includes("header") ? [header] : [footer],
        getBoundingClientRect: () => { throw new Error("Backlink fixed layout must not read window coordinates"); },
    };
    const outer = {scrollTop: 250};
    for (let i = 0; i < 4; i++) {
        exports.stickyRow(block, outer, "all");
    }
    [views, header, footer].forEach(row => {
        assert.equal(row.nextElementSibling.removed, true);
        assert.deepEqual(Object.values(row.style), ["", "", "", "", "", ""]);
    });
    assert.equal(outer.scrollTop, 250);
});

test("sticky views preserve wrapping at fractional widths across scroll and resize", () => {
    const naturalWidth = 228.45;
    let availableWidth = 384;
    let naturalTop = -10;
    const classes = new Set<string>();
    const makePlaceholder = () => ({
        className: "",
        classList: {contains(name: string) { return placeholder.className === name; }},
        style: {} as Record<string, string>,
        getBoundingClientRect: () => ({top: naturalTop, left: 20,
            width: Math.min(parseFloat(placeholder.style.width), availableWidth)}),
        remove: () => { views.nextElementSibling = undefined; },
    });
    let placeholder: ReturnType<typeof makePlaceholder>;
    const views = {
        classList: {
            contains: (name: string) => classes.has(name),
            add: (name: string) => classes.add(name),
            remove: (name: string) => classes.delete(name),
        },
        style: {} as Record<string, string>,
        nextElementSibling: undefined as ReturnType<typeof makePlaceholder> | undefined,
        get offsetHeight() {
            const width = classes.has("av__views--fixed") ? parseFloat(this.style.width) :
                Math.min(naturalWidth, availableWidth);
            return width < naturalWidth ? 68 : 40;
        },
        getBoundingClientRect() {
            const top = classes.has("av__views--fixed") ? parseFloat(this.style.top) : naturalTop;
            const width = classes.has("av__views--fixed") ? parseFloat(this.style.width) :
                Math.min(naturalWidth, availableWidth);
            return {top, bottom: top + this.offsetHeight, left: 20, right: 20 + width, width};
        },
        closest: (): HTMLElement | null => null,
        insertAdjacentElement: (_position: string, element: ReturnType<typeof makePlaceholder>) => {
            views.nextElementSibling = element;
        },
    };
    const block = {
        classList: {contains: () => false},
        dataset: {avType: "table"},
        querySelector: (selector: string) => selector === ".av__views" ? views : null,
        querySelectorAll: (): HTMLElement[] => [],
        getBoundingClientRect: () => ({bottom: 600}),
    };
    const scroll = {scrollTop: 200, getBoundingClientRect: () => ({top: 0, bottom: 800})};
    const exports: {stickyRow?: (block: unknown, scroll: unknown, status: string) => void} = {};
    runInNewContext(compiled, {
        exports,
        require: () => ({hasTopClosestByAttribute: () => false, updateFrozenColumns: () => {}}),
        window: {innerHeight: 800},
        document: {createElement: () => { placeholder = makePlaceholder(); return placeholder; }},
    });
    for (const width of [384, 200, 384]) {
        availableWidth = width;
        for (let frame = 0; frame < 3; frame++) {
            exports.stickyRow(block, scroll, "top");
            assert.equal(views.offsetHeight, width < naturalWidth ? 68 : 40);
            assert.equal(parseFloat(placeholder.style.height), views.offsetHeight);
        }
    }
    naturalTop = 100;
    exports.stickyRow(block, scroll, "top");
    assert.equal(views.offsetHeight, 40);
    assert.equal(views.nextElementSibling, undefined);
    assert.equal(classes.has("av__views--fixed"), false);
});
