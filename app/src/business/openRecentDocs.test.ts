import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isArrowFunction, isBlock, isIfStatement, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
const {createMockRequire} = require("../../tests/fixtures/mockModules.cjs");

const loadModule = (filename: string, globals: Record<string, unknown>, dependencies: Record<string, unknown> = {}, tail = "") => {
    const exports: any = {};
    runInNewContext(transpileModule(readFileSync(filename, "utf8") + tail, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, require: createMockRequire(dependencies), ...globals});
    return exports;
};

const createHarness = () => {
    const callbacks = new Map<string, (...args: any[]) => void>();
    const input = {value: "", focus() {}, addEventListener: (name: string, callback: (...args: any[]) => void) =>
        callbacks.set("input:" + name, callback)};
    const select = {value: "", addEventListener: (name: string, callback: (...args: any[]) => void) =>
        callbacks.set("select:" + name, callback)};
    let clearCallback: () => void;
    let clearUpdates = 0;
    const host = {innerHTML: ""};
    const path = {innerHTML: ""};
    let icons: Array<{tagName: string, classes: Set<string>, classList: {add: (name: string) => void},
        dataset: Record<string, string>, parentElement: {dataset: {nodeId: string}}}> = [];
    const attributes = new Map<string, string>();
    const root = {
        isConnected: true,
        hasAttribute: (name: string) => attributes.has(name),
        getAttribute: (name: string) => attributes.get(name),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        querySelector: (selector: string) => {
            if (selector === ".switch-doc__path") {
                return path;
            }
            if (selector === "[data-type=\"recentDocsList\"]") {
                return host;
            }
            return selector === "input" ? input : select;
        },
        querySelectorAll: (selector: string) => {
            assert.equal(selector, "li[data-node-id] > .b3-list-item__graphic");
            icons = [...host.innerHTML.matchAll(/<li[^>]*data-node-id="([^"]+)"[^>]*>\s*<(svg|span|img) class="([^"]*)"/g)]
                .map(([, id, tag, classes]) => {
                    const names = new Set(classes.split(" "));
                    return {tagName: tag.toUpperCase(), classes: names, classList: {add: (name: string) => names.add(name)},
                        dataset: {}, parentElement: {dataset: {nodeId: id}}};
                });
            return icons;
        },
        addEventListener: (name: string, callback: (...args: any[]) => void) => callbacks.set(name, callback),
    };
    const pathRequests: Array<{id: string, resolve: (response: unknown) => void}> = [];
    const requests: Array<{url: string, data: any, receive: (response: unknown) => void}> = [];
    const cleanups: string[] = [];
    const patches: unknown[][] = [];
    let dialogOptions: any;
    const constants = {LOCAL_IMAGES: "images", DIALOG_RECENTDOCS: "recent-dialog"};
    const siyuan = {
        config: {fileTree: {useSVGDefaultIcon: true, recentDocsSort: "viewedAt"}, keymap: {general: {riffCard: {custom: ""}}}},
        storage: {images: {file: "1f4c4"}},
        languages: {riffCard: "Cards", recentDocs: "Recent documents"},
        dialogs: [] as Array<{element: typeof root}>,
    };
    const globals = {window: {siyuan}, URL, URLSearchParams, Lute: {Sanitize: (html: string) => html}};
    const escape = loadModule("src/util/escape.ts", globals);
    const iconValue = loadModule("src/emoji/iconValue.ts", globals, {"../util/escape": escape});
    const icon = loadModule("src/emoji/fileTreeIcon.ts", globals, {
        "../constants": {Constants: constants}, "../util/escape": escape, "./iconValue": iconValue,
    });
    const api = loadModule("src/business/openRecentDocs.ts", globals, {
        "../config/tabs/fileRuntime": {fileConfigApi: {patch: async (...args: unknown[]) => { patches.push(args); }}},
        "../util/fetch": {
            fetchSyncPost: (_url: string, data: {id: string}) => new Promise(resolve => pathRequests.push({id: data.id, resolve})),
            fetchPost: (url: string, data: unknown, receive: (response: unknown) => void) => requests.push({url, data, receive}),
        },
        "../emoji/fileTreeIcon": icon,
        "../constants": {Constants: constants},
        "../util/escape": escape,
        "../util/functions": {isWindow: () => false},
        "../protyle/util/compatibility": {updateHotkeyTip: (value: string) => value},
        "../protyle/util/hasClosest": {},
        "../protyle/ui/hideElements": {},
        "../layout/getAll": {getAllDocks: () => [{title: "Documents", type: "files", icon: "iconFiles"}]},
        "../layout/dock/hotkey": {getDockHotkey: () => ""},
        "../block/panelOwnership": {destroyDialogBlockPanels: (element: typeof root) => {
            assert.equal(element, root);
            cleanups.push(host.innerHTML);
        }},
        "./clearRecentDocs": {
            clearRecentDocsTextButtonHTML: () => "<button data-action=\"clear-recent-docs\"></button>",
            bindClearRecentDocs: (_button: unknown, _getSort: unknown, _isActive: unknown, callback: () => void) => {
                clearCallback = callback;
                return () => clearUpdates++;
            },
        },
        "../dialog": {Dialog: class {
            element = root;
            constructor(options: any) {
                dialogOptions = options;
                siyuan.dialogs.push(this);
            }
        }},
    }, "\nexports.render = renderRecentDocsContent;");
    const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
    return {api, root, host, path, input, select, siyuan, pathRequests, requests, callbacks, cleanups, patches, settle,
        icons: () => icons, dialogOptions: () => dialogOptions, clear: () => clearCallback(), clearUpdates: () => clearUpdates};
};

test("recent document SVG, Unicode and image icons receive the shared document preview target", async () => {
    const h = createHarness();
    const data = [{rootID: "svg", title: "SVG"}, {rootID: "emoji", title: "Emoji", icon: "1f600"},
        {rootID: "image", title: "Image", icon: "custom.png"}];
    const pending = h.api.render(data, h.root);
    assert.equal(h.cleanups.length, 0);
    h.pathRequests[0].resolve({code: 0, data: "/SVG"});
    await pending;
    assert.deepEqual(h.icons().map(item => item.tagName), ["SVG", "SPAN", "IMG"]);
    assert.deepEqual(h.icons().map(item => item.dataset.id), data.map(item => item.rootID));
    assert.ok(h.icons().every(item => item.classes.has("popover__block")));
    assert.equal(h.cleanups.length, 1);
    assert.match(h.host.innerHTML, /data-type="files"/);
    assert.doesNotMatch(h.host.innerHTML, /b3-list-item__text[^>]*popover__block/);
    assert.equal(h.requests.length, 0, "rendering a preview entry does not write recent history");
});

test("filtering previews the matching root and accepts only the latest asynchronous render", async () => {
    const h = createHarness();
    const data = [{rootID: "alpha", title: "Alpha"}, {rootID: "beta", title: "Beta"}];
    const first = h.api.render(data, h.root, "alpha");
    const latest = h.api.render(data, h.root, "beta");
    assert.deepEqual(h.pathRequests.map(item => item.id), ["alpha", "beta"]);
    h.pathRequests[1].resolve({code: 0, data: "/Beta"});
    await latest;
    h.pathRequests[0].resolve({code: 0, data: "/Alpha"});
    await first;
    assert.equal(h.path.innerHTML, "/Beta");
    assert.deepEqual(h.icons().map(item => item.dataset.id), ["beta"]);
    assert.equal(h.cleanups.length, 1, "stale requests do not close the current preview");
});

test("closing or removing the recent dialog prevents a late render from replacing its content", async () => {
    for (const closing of [true, false]) {
        const h = createHarness();
        h.host.innerHTML = "previous content";
        const pending = h.api.render([{rootID: "document", title: "Document"}], h.root);
        if (closing) {
            h.root.setAttribute("data-dialog-closing", "true");
        } else {
            h.root.isConnected = false;
        }
        h.pathRequests[0].resolve({code: 0, data: "/Document"});
        await pending;
        assert.equal(h.host.innerHTML, "previous content");
        assert.equal(h.cleanups.length, 0);
    }
});

test("empty filters synchronously invalidate older document renders and do not mark dock icons", async () => {
    const h = createHarness();
    const old = h.api.render([{rootID: "document", title: "Document"}], h.root);
    await h.api.render([], h.root, "Cards");
    assert.deepEqual(h.icons(), []);
    assert.match(h.host.innerHTML, /data-type="riffCard"/);
    h.pathRequests[0].resolve({code: 0, data: "/Document"});
    await old;
    assert.equal(h.path.innerHTML, "Cards");
    assert.doesNotMatch(h.host.innerHTML, /data-node-id/);
});

test("sort responses cannot restore older preview anchors or update a closing dialog", async () => {
    const h = createHarness();
    h.api.openRecentDocs();
    assert.equal(h.requests[0].url, "/api/storage/getRecentDocs");
    assert.equal(h.requests[0].data.sortBy, "viewedAt");
    h.requests[0].receive({data: []});
    assert.equal(h.dialogOptions().destroyCallback, undefined, "Dialog owns guarded focus restoration");
    h.select.value = "created";
    h.callbacks.get("select:change")();
    h.select.value = "closedAt";
    h.callbacks.get("select:change")();
    assert.deepEqual(h.patches, [["recentDocsSort", "created"], ["recentDocsSort", "closedAt"]]);
    h.requests[2].receive({data: [{rootID: "latest", title: "Latest"}]});
    h.requests[1].receive({data: [{rootID: "old", title: "Old"}]});
    assert.deepEqual(h.pathRequests.map(item => item.id), ["latest"]);
    h.pathRequests[0].resolve({code: 0, data: "/Latest"});
    await h.settle();
    assert.deepEqual(h.icons().map(item => item.dataset.id), ["latest"]);
    h.select.value = "viewedAt";
    h.callbacks.get("select:change")();
    h.root.setAttribute("data-dialog-closing", "true");
    h.requests[3].receive({data: [{rootID: "late", title: "Late"}]});
    assert.equal(h.pathRequests.length, 1);
});

test("recent Arrow and Enter handlers ignore popover editors and closing dialog controls", () => {
    const filename = "src/boot/globalEvent/keydown.ts";
    const source = createSourceFile(filename, readFileSync(filename, "utf8"), ScriptTarget.ES2021, true);
    const declaration = source.statements.find(item => isVariableStatement(item) &&
        item.declarationList.declarations.some(variable => variable.name.getText(source) === "windowKeyDown"));
    assert.ok(declaration && isVariableStatement(declaration));
    const initializer = declaration.declarationList.declarations[0].initializer;
    assert.ok(initializer && isArrowFunction(initializer) && isBlock(initializer.body));
    const statement = initializer.body.statements.find(item => isIfStatement(item) && item.getText(source).includes("DIALOG_RECENTDOCS"));
    assert.ok(statement, "load the actual recent-document branch");
    const input = {closest: (): null => null};
    const editor = {closest: (): null => null};
    const button = {closest: (selector: string) => selector.includes("button") ? {} : null};
    let closing = false;
    let calls = 0;
    const element = {getAttribute: () => "recent", hasAttribute: () => closing,
        contains: (target: unknown) => target === input || target === button};
    const exports: any = {};
    runInNewContext(transpileModule(`exports.keydown = (event, app) => { ${statement.getText(source)} };`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, isNotCtrl: () => true, Constants: {DIALOG_RECENTDOCS: "recent"},
        window: {siyuan: {dialogs: [{element}]}}, dialogArrow: () => calls++});
    for (const key of ["ArrowDown", "ArrowLeft", "Enter"]) {
        const event = {key, target: input, preventDefault() {}};
        exports.keydown(event, {});
        exports.keydown({...event, target: editor}, {});
    }
    assert.equal(calls, 3);
    // 焦点在底部清空按钮上时 Enter 交由按钮自身处理，不得打开选中文档
    exports.keydown({key: "Enter", target: button, preventDefault() {}}, {});
    assert.equal(calls, 3);
    closing = true;
    exports.keydown({key: "Enter", target: input, preventDefault() {}}, {});
    assert.equal(calls, 3);
});

test("clearing invalidates pending sort and path responses and refreshes the current filter", async () => {
    const h = createHarness();
    h.api.openRecentDocs();
    h.requests[0].receive({data: [{rootID: "old", title: "Old"}]});
    h.select.value = "closedAt";
    h.callbacks.get("select:change")();
    assert.equal(h.clearUpdates(), 1);
    h.clear();
    assert.doesNotMatch(h.host.innerHTML, /data-node-id/);
    assert.equal(h.requests[2].data.sortBy, "closedAt");
    h.requests[1].receive({data: [{rootID: "stale", title: "Stale"}]});
    h.pathRequests[0].resolve({code: 0, data: "/Old"});
    await h.settle();
    assert.doesNotMatch(h.host.innerHTML, /data-node-id/);
    h.requests[2].receive({data: []});
    h.input.value = "Old";
    h.callbacks.get("input:input")({isComposing: false});
    assert.doesNotMatch(h.host.innerHTML, /data-node-id/, "search must not restore cleared cached data");
});

test("clearing after switching to created documents preserves that list and reloads the current mode", async () => {
    const h = createHarness();
    h.api.openRecentDocs();
    h.requests[0].receive({data: []});
    h.select.value = "created";
    h.callbacks.get("select:change")();
    h.requests[1].receive({data: [{rootID: "created", title: "Created"}]});
    h.pathRequests[0].resolve({code: 0, data: "/Created"});
    await h.settle();
    h.clear();
    assert.match(h.host.innerHTML, /data-node-id="created"/);
    assert.equal(h.requests[2].data.sortBy, "created");
});

test("clearing invalidates a pending history render even when a creation query is now selected", async () => {
    const h = createHarness();
    h.api.openRecentDocs();
    h.requests[0].receive({data: [{rootID: "old", title: "Old"}]});
    h.select.value = "created";
    h.callbacks.get("select:change")();
    h.clear();
    h.pathRequests[0].resolve({code: 0, data: "/Old"});
    await h.settle();
    assert.doesNotMatch(h.host.innerHTML, /data-node-id="old"/);
    assert.equal(h.requests[2].data.sortBy, "created");
});
