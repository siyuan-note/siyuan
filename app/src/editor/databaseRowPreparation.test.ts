import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {ScriptTarget, ModuleKind, transpileModule} from "typescript";
import {evaluateModule} from "../testSupport/loadModule";
import {DOMFixture} from "../protyle/render/av/testDOM";

const {parse} = require("ifdef-loader/preprocessor");

for (const available of [true, false]) {
    test(`bound editor preparation keeps attribute requests alive and handles availability=${available}`, async () => {
        const document = new DOMFixture();
        const original = document.createElement("div");
        Object.assign(original, {getBoundingClientRect: () => ({left: 0, top: 0, width: 800, height: 600})});
        const createElement = document.createElement.bind(document);
        document.createElement = (tag: string) => Object.assign(createElement(tag), {style: {}});
        const panel = Object.assign(document.createElement("div"), {style: {visibility: ""}});
        document.body.append(original);
        const window = {siyuan: {config: {editor: {databaseAttrShow: true}}, ws: {ws: {
            readyState: 1, url: "ws://localhost/ws?id=main&type=main",
        }}}, setTimeout, clearTimeout, addEventListener() {}};
        const http = evaluateModule<typeof import("../template/http")>(transpileModule(readFileSync("src/template/http.ts", "utf8"), {
            compilerOptions: {target: ScriptTarget.ES2022, module: ModuleKind.CommonJS},
        }).outputText, {window, document, URL, AbortController, WebSocket: {OPEN: 1}, CSS: {escape: (value: string) => value},
            setInterval: () => 1, clearInterval() {}, require: () => ({genUUID: () => "request", hideMessage() {},
                fetchWithAppId: async () => {}, Constants: {SIYUAN_APPID: "test"}})});
        let replaced = 0;
        let checked = 0;
        const wnd = {addTab() { replaced++; original.remove(); document.body.append(panel); }};
        class Custom {}
        class Editor {
            editor = {resize() {}, protyle: {element: panel, contentElement: panel, block: {}, databaseAttributePanel: {
                expand() {}, afterRender(callback: (element: unknown) => void) {
                    const guard = http.guardTemplateHTTPRequest(() => panel.isConnected, panel as unknown as Element);
                    const execution = http.beginTemplateHTTPRequest("/api/av/getAttributeViewKeys", {id: "bound"}, undefined, guard.signal);
                    try {
                        assert.ok(execution?.isCurrent(), "preparation must retain a live template request owner");
                    } finally { execution?.finish(); guard.dispose(); }
                    assert.equal(original.isConnected, !replaced, "the original remains until the replacement is ready");
                    checked++;
                    const body = document.createElement("div");
                    if (available) body.innerHTML = '<div data-av-id="database"></div>';
                    callback(body);
                },
            }}};
            destroy() {} send() {}
        }
        const source = Object.assign(new Custom(), {parent: {parent: wnd, panelElement: original, model: undefined as unknown}, app: {}});
        source.parent.model = source;
        const dependencies = {Custom, Editor, inheritDatabaseRowReadonly() {}, updateBackgroundActions() {},
            mountDatabaseRowNavigation() {}, focusDatabasePrimary() {}, saveLayout() {}, updatePanelByEditor() {},
            fetchSyncPost: async () => ({code: 0, data: {rootID: "bound"}}),
            newTab: (_options: unknown, loaded: () => void) => ({panelElement: panel, model: undefined as unknown,
                callback(tab: {model: Editor}) { tab.model = new Editor(); queueMicrotask(loaded); }}),
        };
        const code = transpileModule(parse(readFileSync("src/protyle/render/av/openDatabaseRow.ts", "utf8"),
            {MOBILE: false, BROWSER: true}, false, true), {compilerOptions: {target: ScriptTarget.ES2022, module: ModuleKind.CommonJS}}).outputText;
        const api = evaluateModule<typeof import("../protyle/render/av/openDatabaseRow")>(code, {document, window,
            MutationObserver: class { observe() {} disconnect() {} }, require: () => dependencies});
        const result = await api.switchDesktopDatabaseRowPreview(source as never, {avID: "database", databaseBlockID: "carrier",
            notebookID: "notebook", itemID: "item", valueID: "value", title: "Bound", boundBlockID: "bound", isDetached: false}, {});
        assert.equal(result, available);
        assert.ok(checked > 0);
        assert.equal(replaced, available ? 1 : 0);
        assert.equal(original.isConnected, !available);
        if (available) assert.equal(panel.style.visibility, "");
        else assert.equal(panel.isConnected, false);
    });
}
