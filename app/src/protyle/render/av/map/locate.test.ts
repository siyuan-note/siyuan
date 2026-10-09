import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as locateState from "../locateState";
import {isTableLikeView} from "../viewType";

const setup = (open: () => Promise<boolean> = () => Promise.resolve(true)) => {
    const opened: unknown[] = [];
    const scrolled: unknown[] = [];
    const messages: string[] = [];
    const block = {isConnected: true, dataset: {avId: "database", nodeId: "carrier"}} as unknown as HTMLElement;
    const protyle = {notebookId: "notebook"} as IProtyle;
    const data = {viewType: "map", view: {rows: [{id: "row", cells: [{id: "primary-value", valueType: "block",
        value: {type: "block", isDetached: true, block: {content: "Record"}}}]}]},
    target: {itemID: "row", status: "visible"}} as IAV;
    const languages = {databaseItemNotFound: "not found", databaseItemFiltered: "filtered"};
    const modules: Record<string, unknown> = {
        "./locateState": locateState,
        "./viewType": {isTableLikeView},
        "../../../dialog/message": {showMessage: (message: string) => messages.push(message)},
        "../../../util/highlightById": {scrollCenter: (_protyle: unknown, element: unknown) => scrolled.push(element)},
        "./backlinkScroll": {scrollBacklinkTarget: () => false},
        "../openDatabaseRow": {openDatabaseRowByData: (_protyle: unknown, record: unknown) => {
            opened.push(record);
            return open();
        }},
    };
    const load = (path: string) => {
        const exports = {};
        runInNewContext(transpileModule(readFileSync(path, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText, {exports, require: (id: string) => modules[id] || {}, window: {siyuan: {languages}}});
        return exports;
    };
    modules["./map/openRecord"] = load("src/protyle/render/av/map/openRecord.ts");
    const methods = load("src/protyle/render/av/locate.ts") as typeof import("../locate");
    return {methods, opened, scrolled, messages, block, protyle, data};
};

test("explicit map record locating opens existing detail once without selecting hidden rows", () => {
    const scenario = setup();
    scenario.methods.setAVLocateRequest(scenario.block, {itemID: "row"});
    const reset = {virtualData: {}};
    scenario.methods.prepareAVLocate(scenario.block, scenario.data, reset);
    assert.deepEqual(reset.virtualData, {});
    scenario.methods.finishAVLocate(scenario.block, scenario.protyle, scenario.data);
    scenario.methods.finishAVLocate(scenario.block, scenario.protyle, scenario.data);
    assert.equal(scenario.opened.length, 1);
    assert.equal((scenario.opened[0] as {itemID: string}).itemID, "row");
    assert.equal((scenario.opened[0] as {focusPrimary: boolean}).focusPrimary, true);
    assert.deepEqual(scenario.scrolled, []);
});

test("map backlink and search previews locate the container without opening row details", () => {
    for (const request of [
        {itemID: "row", keyID: "location", persistView: false, select: false, highlight: true, scroll: true, defIDs: ["ref"]},
        {itemID: "row", keyID: "location", persistView: false, select: false, highlight: true, isValid: () => true},
    ]) {
        const scenario = setup();
        scenario.methods.setAVLocateRequest(scenario.block, request);
        scenario.methods.finishAVLocate(scenario.block, scenario.protyle, scenario.data);
        assert.deepEqual(scenario.opened, []);
        assert.deepEqual(scenario.scrolled, [scenario.block]);
        assert.equal(locateState.locateRequests.has(scenario.block), false);
    }
});

test("invalid, filtered and previously located map requests never reopen a record", async () => {
    for (const mode of ["invalid", "filtered", "located", "missing"]) {
        const scenario = setup();
        scenario.methods.setAVLocateRequest(scenario.block, {itemID: "row", located: mode === "located",
            isValid: () => mode !== "invalid"});
        if (mode === "filtered") scenario.data.target.status = "filtered";
        if (mode === "missing") (scenario.data.view as IAVTable).rows = [];
        scenario.methods.finishAVLocate(scenario.block, scenario.protyle, scenario.data);
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(scenario.opened, []);
        assert.deepEqual(scenario.scrolled, []);
        assert.deepEqual(scenario.messages, mode === "missing" ? ["not found"] : []);
    }
});

test("failed or rejected map record opens report a current failure once", async () => {
    for (const open of [() => Promise.resolve(false), () => Promise.reject(new Error("unavailable"))]) {
        const scenario = setup(open);
        scenario.methods.setAVLocateRequest(scenario.block, {itemID: "row"});
        scenario.methods.finishAVLocate(scenario.block, scenario.protyle, scenario.data);
        scenario.methods.finishAVLocate(scenario.block, scenario.protyle, scenario.data);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(scenario.opened.length, 1);
        assert.deepEqual(scenario.messages, ["not found"]);
    }
});

test("late map record failures cannot interrupt closed, invalidated or newer navigation", async () => {
    for (const mode of ["closed", "rendered", "invalid", "new-request", "opened"]) {
        let fail: (result: boolean) => void;
        let valid = true;
        const scenario = setup(() => new Promise(resolve => { fail = resolve; }));
        scenario.methods.setAVLocateRequest(scenario.block, {itemID: "row", isValid: () => valid});
        scenario.methods.finishAVLocate(scenario.block, scenario.protyle, scenario.data);
        const previousFail = fail;
        if (mode === "closed") Object.assign(scenario.block, {isConnected: false});
        if (mode === "rendered") scenario.methods.beginAVRender(scenario.block);
        if (mode === "invalid") valid = false;
        if (mode === "new-request" || mode === "opened") {
            scenario.methods.setAVLocateRequest(scenario.block, {itemID: "row"});
        }
        if (mode === "opened") {
            scenario.methods.finishAVLocate(scenario.block, scenario.protyle, scenario.data);
            fail(true);
        }
        previousFail(false);
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(scenario.messages, []);
    }
});
