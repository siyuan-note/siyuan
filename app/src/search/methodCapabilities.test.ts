import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getSearchMethodCapabilities, isSearchSortAvailable, updateSearchMethodControls} from "./methodCapabilities";

test("search capabilities retain supported filters and grouped SQL sorting", () => {
    for (const method of [0, 1, 3]) {
        assert.ok(getSearchMethodCapabilities(method, 0).filter);
        assert.ok(getSearchMethodCapabilities(method, 0).path);
        assert.ok(getSearchMethodCapabilities(method, 0).replace);
        assert.ok(getSearchMethodCapabilities(method, 0).group);
    }
    assert.deepEqual(getSearchMethodCapabilities(2, 0), {filter: false, path: false, replace: false, group: true, sort: false});
    assert.deepEqual(getSearchMethodCapabilities(4, 1), {filter: true, path: true, replace: false, group: false, sort: false});
    for (const method of [0, 1, 2, 3, 4]) {
        for (const group of [0, 1]) {
            assert.equal(isSearchSortAvailable(method, group, 5), method !== 4 && group === 1);
            for (const sort of [6, 7]) {
                assert.equal(isSearchSortAvailable(method, group, sort), method === 0 || method === 1);
            }
            for (const sort of [0, 1, 2, 3, 4]) {
                assert.equal(isSearchSortAvailable(method, group, sort), method !== 4 && (method !== 2 || group === 1));
            }
        }
    }
});

const control = () => {
    const attributes: Record<string, string> = {};
    const classes = new Set<string>();
    return {
        attributes, classes,
        toggleAttribute: (name: string, force: boolean) => { if (force) { attributes[name] = ""; } else { delete attributes[name]; } },
        setAttribute: (name: string, value: string) => { attributes[name] = value; },
        removeAttribute: (name: string) => { delete attributes[name]; },
        classList: {
            add: (name: string) => { classes.add(name); },
            toggle: (name: string, force: boolean) => { if (force) { classes.add(name); } else { classes.delete(name); } },
        },
    };
};

for (const mobile of [true, false]) {
    test(`${mobile ? "mobile" : "desktop"} method switches preserve replacement text and restore controls`, () => {
        const previousWindow = globalThis.window;
        const previousDocument = globalThis.document;
        globalThis.window = {siyuan: {languages: {
            searchControlUnavailable: "unavailable", specifyPath: "path", searchType: "types", includeChildDoc: "children",
            filterCurrentDocument: "current document", replace: "replace", remove: "remove",
        }}} as unknown as Window & typeof globalThis;
        globalThis.document = {querySelector: () => ({classList: {contains: () => true}})} as unknown as Document;
        try {
            const controls = new Map<string, ReturnType<typeof control>>();
            const row = {...control(), value: "replacement text"};
            const expand = {...control(), parentElement: control()};
            const element = {
                querySelector: (selector: string) => {
                    if (selector === ".toolbar") { return row; }
                    if (selector === "#searchExpand") { return expand; }
                    if (!controls.has(selector)) {
                        const item = control();
                        item.attributes.title = "native tooltip";
                        controls.set(selector, item);
                    }
                    return controls.get(selector);
                },
                querySelectorAll: () => [control(), row],
            };
            const config = {method: 0, group: 1, hasReplace: true, r: "replacement text", idPath: ["notebook/document.sy"]};
            const filter = mobile ? '[data-type="path"]' : "#searchFilter";
            const include = mobile ? '[data-type="include"]' : "#searchInclude";
            const refresh = () => updateSearchMethodControls(element as unknown as Element, config as Config.IUILayoutTabSearchConfig, mobile);
            refresh();
            assert.equal(row.classes.has("fn__none"), false);
            config.method = 2;
            refresh();
            assert.equal(row.classes.has("fn__none"), true);
            assert.equal(controls.get(filter).attributes["aria-disabled"], "true");
            assert.equal(controls.get(include).attributes["aria-disabled"], "true");
            assert.ok(controls.get(filter).attributes["aria-label"].endsWith("unavailable"));
            assert.ok(Array.from(controls.values()).filter(item => "aria-disabled" in item.attributes)
                .every(item => item.classes.has("ariaLabel") && !("title" in item.attributes)));
            config.method = 4;
            refresh();
            assert.equal(row.classes.has("fn__none"), true);
            assert.equal(controls.get(filter).attributes["aria-disabled"], "false");
            assert.equal(controls.get(include).attributes["aria-disabled"], "false");
            config.method = 1;
            refresh();
            assert.equal(row.classes.has("fn__none"), false);
            assert.equal(row.value, "replacement text");
            assert.equal(config.r, "replacement text");
            assert.equal(config.hasReplace, true);
            assert.deepEqual(config.idPath, ["notebook/document.sy"]);
            config.idPath = [];
            refresh();
            assert.equal(controls.get(include).attributes["aria-disabled"], "true");
            assert.equal(controls.get(filter).attributes["aria-label"].includes("unavailable"), false);
            assert.ok(Array.from(controls.values()).filter(item => "aria-disabled" in item.attributes)
                .every(item => item.classes.has("ariaLabel") && !("title" in item.attributes)));
        } finally {
            globalThis.window = previousWindow;
            globalThis.document = previousDocument;
        }
    });
}
