import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const loadMobileReload = () => {
    let enabled = true;
    const conditions: {parent: boolean, mobile: boolean}[] = [];
    const source = readFileSync("src/util/reloadSync.ts", "utf8").split("\n").filter(line => {
        const condition = line.match(/\/\/\/ #if (.+)/);
        if (condition) {
            conditions.push({parent: enabled, mobile: condition[1].trim() === "MOBILE"});
            enabled &&= conditions.at(-1).mobile;
            return false;
        }
        if (/\/\/\/ #else/.test(line)) {
            enabled = conditions.at(-1).parent && !conditions.at(-1).mobile;
            return false;
        }
        if (/\/\/\/ #endif/.test(line)) {
            enabled = conditions.pop().parent;
            return false;
        }
        return enabled;
    }).join("\n");
    const exports = {} as Pick<typeof import("./reloadSync"), "reloadSync" | "waitForSyncReloads">;
    let finishBody: () => void;
    const body = new Promise<void>(resolve => finishBody = resolve);
    let receiveTitle: (response: unknown) => void;
    let failTitle: () => void;
    const titles: string[] = [];
    const protyle = {block: {rootID: "changed"}, notebookId: "box", title: {setTitle: (value: string) => titles.push(value)}};
    const mobile = {editor: {protyle}, docks: {}};
    const noop = () => {};
    runInNewContext(transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, console: {error: noop},
        window: {siyuan: {mobile}},
        document: {getElementById: () => ({classList: {contains: () => true}})},
        require: (name: string) => {
            if (name === "./fetch") return {fetchPost: (_url: string, _data: unknown, callback: typeof receiveTitle,
                                                       _headers: unknown, fail: () => void) => {
                receiveTitle = callback;
                failTitle = fail;
                return Promise.resolve();
            }};
            if (name === "./pathName") return {isEncryptedBox: () => false, setNoteBook: noop};
            if (name.endsWith("backlinkPanels")) return {getMobileBacklinkPanels: (): unknown[] => [], removeMobileBacklinkContent: noop};
            if (name === "../protyle/util/reload") return {reloadProtyleAndWait: () => body};
            if (name === "../constants") return {Constants: {CUSTOM_SY_TITLE_EMPTY: "empty"}};
            return new Proxy({}, {get: () => noop});
        },
    });
    exports.reloadSync({} as any, {upsertRootIDs: ["changed"], removeRootIDs: []});
    return {...exports, mobile, protyle, titles, finishBody: () => finishBody(),
        receiveTitle: (code = 0) => receiveTitle({code, data: {name: "remote title", ial: {}}}),
        failTitle: () => failTitle()};
};

test("mobile sync waits for both the document and its title before restoring input", async () => {
    const reload = loadMobileReload();
    let completed = false;
    const pending = reload.waitForSyncReloads().then(() => completed = true);
    reload.finishBody();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(completed, false, "the title response is still pending");
    reload.receiveTitle();
    await pending;
    assert.deepEqual(reload.titles, ["remote title"]);
});

test("mobile title responses cannot rename an editor opened or navigated after the request", async () => {
    for (const navigation of ["editor", "root", "notebook"]) {
        const reload = loadMobileReload();
        if (navigation === "editor") {
            reload.mobile.editor = {protyle: {...reload.protyle, block: {rootID: "next"}}};
        } else if (navigation === "root") {
            reload.protyle.block.rootID = "next";
        } else {
            reload.protyle.notebookId = "next";
        }
        reload.receiveTitle();
        reload.finishBody();
        await reload.waitForSyncReloads();
        assert.deepEqual(reload.titles, [], navigation);
    }
});

test("mobile title request failures reject the pending sync refresh", async () => {
    for (const failure of ["business", "network"]) {
        const reload = loadMobileReload();
        const pending = assert.rejects(reload.waitForSyncReloads(), /Could not refresh synchronized document title/);
        reload.finishBody();
        if (failure === "business") reload.receiveTitle(-1);
        else reload.failTitle();
        await pending;
        assert.deepEqual(reload.titles, []);
    }
});
