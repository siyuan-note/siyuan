import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {withFetchTimeout} from "../util/fetchTimeout";

const source = transpileModule(readFileSync(join(__dirname, "processSystem.ts"), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText;

const loadDialog = (importExport: boolean, isMobile: boolean, request: () => Promise<unknown>) => {
    const saved: string[] = [];
    const errors: unknown[] = [];
    let content = "";
    const buttons = new Map<string, {disabled: boolean; click?: () => Promise<void>}>();
    const exports = {} as typeof import("./processSystem");
    runInNewContext(source, {
        exports,
        require: (id: string) => ({
            "../constants": {Constants: {SIYUAN_VERSION: "test", DIALOG_STATEEXCEPTED: "abnormal"}},
            "../util/fetch": {fetchSyncPost: (url: string) => {
                assert.equal(url, "/api/system/exportLog");
                return request();
            }},
            "../util/fetchTimeout": {withFetchTimeout},
            "../util/hostCapabilities": {getHostCapabilities: () => ({importExport})},
            "../util/functions": {isMobile: () => isMobile},
            "../protyle/util/compatibility": {saveExportFile: async (url: string) => { saved.push(url); }},
            "./hostQuit": {createHostQuitGuard: () => ({})},
            "./message": {showMessage: (...args: unknown[]) => errors.push(args)},
            "./mobileDialog": {MobileDialog: class {
                public element = {
                    isConnected: true,
                    setAttribute() {},
                    querySelector(selector: string) {
                        if (!content.includes(selector.slice(1, -1))) return null;
                        const button = {disabled: false, addEventListener: (_event: string, callback: () => Promise<void>) => {
                            buttons.set(selector, Object.assign(button, {click: callback}));
                        }};
                        return button;
                    },
                };
                constructor(options: {content: string}) { content = options.content; }
            }},
        }[id] ?? {}),
        document: {getElementById: (): null => null},
        window: {siyuan: {languages: {exportSystemLog: "Export log", _kernel: {97: "Exit", 290: "Export failed"}}}},
        console: {warn() {}},
    });
    exports.transactionError();
    return {saved, errors, buttons, content};
};

test("the abnormal state dialog exports logs and allows retry on desktop and mobile", async () => {
    for (const isMobile of [false, true]) {
        const responses = [{code: 0, data: {zip: ""}}, {code: 0, data: {zip: "/export/log.zip"}}];
        const dialog = loadDialog(true, isMobile, async () => responses.shift());
        assert.match(dialog.content, /Export log[\s\S]*data-action="exit"[\s\S]*data-action="rebuild"/);
        const button = dialog.buttons.get('[data-action="export-log"]');
        const firstClick = button.click();
        assert.equal(button.disabled, true);
        await firstClick;
        assert.equal(button.disabled, false);
        assert.deepEqual(dialog.errors, [["Export failed", 6000, "error"]]);
        assert.deepEqual(dialog.saved, []);
        await button.click();
        assert.equal(button.disabled, false);
        assert.deepEqual(dialog.saved, ["/export/log.zip"]);
    }
});

test("the abnormal state dialog follows the host's log export availability", () => {
    const dialog = loadDialog(false, false, async () => assert.fail("Unexpected export request"));
    assert.doesNotMatch(dialog.content, /data-action="export-log"/);
    assert.equal(dialog.buttons.size, 2);
});

test("backlink index commits refresh dock panels and reference count popovers", () => {
    const source = readFileSync("src/dialog/processSystem.ts", "utf8");
    const start = source.indexOf("export const processBacklinkIndexCommit");
    const end = source.indexOf("export const setRefDynamicText");
    assert.ok(start >= 0 && end > start);
    const compiled = transpileModule(source.slice(start, end).replace("export const", "const"), {}).outputText;
    const calls: unknown[] = [];
    const panel = (name: string) => ({
        markIndexDirty: (change: unknown) => calls.push([name, change]),
        refreshAfterIndex: () => calls.push(name),
    });
    const process = new Function("getAllModels", "getMobileBacklinkPanels", "window",
        compiled + "return processBacklinkIndexCommit;")(
        () => ({backlink: [panel("dock")]}), (): unknown[] => [],
        {siyuan: {blockPanels: [{backlink: panel("popover")}, {}]}});
    process({backlinkChanged: false});
    assert.deepEqual(calls, []);
    const change = {backlinkChanged: true, rootIDs: ["source"], backlinkFull: false};
    process(change);
    assert.deepEqual(calls, [["dock", change], "dock", ["popover", change], "popover"]);
});
