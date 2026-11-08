import * as assert from "node:assert/strict";
import {test} from "node:test";
import {loadModule} from "../../../testSupport/loadModule";
import {DOMFixture} from "./testDOM";

const fixture = (pendingEdits = false) => {
    const document = new DOMFixture();
    const block = document.createElement("div");
    block.dataset.avId = "database";
    block.dataset.nodeId = "carrier";
    const host = document.createElement("div");
    host.innerHTML = "<button data-run></button><input disabled><span data-status></span>";
    block.append(host);
    document.body.append(block);
    const button = host.querySelector("button") as unknown as HTMLButtonElement;
    button.disabled = false;
    const input = host.querySelector("input") as unknown as HTMLInputElement;
    input.disabled = true;
    const status = host.querySelector("span") as unknown as HTMLElement;
    const query = host.querySelectorAll.bind(host);
    Object.defineProperty(host, "querySelectorAll", {value: (selector: string) =>
        selector.includes(",") ? selector.split(",").flatMap(value => Array.from(query(value.trim()))) : query(selector)});
    const protyle = {disabled: false, options: {}, block: {rootID: "document"}} as IProtyle;
    const requests: unknown[] = [];
    const mirrors: unknown[] = [];
    const controller = new AbortController();
    let disposed = false;
    let finish: (result: {code: number; msg?: string}) => void;
    const response = new Promise(resolve => { finish = resolve; });
    let finishEdits: () => void;
    const edits = pendingEdits ? new Promise<void>(resolve => { finishEdits = resolve; }) : Promise.resolve();
    const api = loadModule<typeof import("./manualAutomation")>("src/protyle/render/av/manualAutomation.ts", {
        window: {siyuan: {config: {}, languages: {loading: "Loading", templateHTTPFailed: "HTTP failed"}}},
        require: (name: string) => {
            if (name.endsWith("/fetch")) return {fetchSyncPost: (...args: unknown[]) => { requests.push(args); return response; }};
            if (name.endsWith("/http")) return {guardTemplateHTTPRequest: (_current: () => boolean, owner: Element) => {
                assert.equal(owner, block);
                return {signal: controller.signal, dispose: () => { disposed = true; }};
            }};
            if (name.endsWith("/transactionQueue")) return {waitForPendingTransactions: () => edits};
            if (name.endsWith("/globalUndo")) return {initMirror: async (id: string) => { mirrors.push(id); },
                refreshUndoButtons: (editor: IProtyle) => mirrors.push(editor)};
            throw new Error(name);
        },
    });
    return {run: () => api.runManualAutomation(protyle, block as unknown as HTMLElement, host as unknown as HTMLElement,
        "rule", button, status), host, button,
        input, status, protyle, requests, mirrors, finish: (value: {code: number; msg?: string} = {code: 0}) => finish(value), controller,
        disposed: () => disposed, finishEdits: () => finishEdits()};
};

test("manual automation waits for saved edits, disables controls and refreshes shared undo after success", async () => {
    const f = fixture(true);
    const pending = f.run();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.requests.length, 0);
    f.finishEdits();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.button.disabled, true);
    assert.equal(f.host.getAttribute("aria-busy"), "true");
    const request = f.requests[0] as unknown[];
    assert.equal(request[0], "/api/av/runAttributeViewAutomation");
    assert.deepEqual(JSON.parse(JSON.stringify(request[1])), {avID: "database", blockID: "carrier", ruleID: "rule"});
    f.finish();
    await pending;
    assert.deepEqual(f.mirrors, ["document", f.protyle]);
    assert.equal(f.button.disabled, false);
    assert.equal(f.input.disabled, true);
    assert.equal(f.host.hasAttribute("aria-busy"), false);
    assert.equal(f.disposed(), true);
});

test("manual automation does not execute in readonly mode and ignores completion after its panel closes", async () => {
    const f = fixture();
    f.protyle.disabled = true;
    await f.run();
    assert.equal(f.requests.length, 0);
    f.protyle.disabled = false;
    const pending = f.run();
    await new Promise(resolve => setImmediate(resolve));
    f.host.remove();
    f.finish();
    await pending;
    assert.equal(f.mirrors.length, 0);
    assert.equal(f.disposed(), true);
});

test("manual automation errors preserve the editor and report failure without creating undo state", async () => {
    const f = fixture();
    const pending = f.run();
    await new Promise(resolve => setImmediate(resolve));
    f.finish({code: -1, msg: "changed"});
    await pending;
    assert.equal(f.status.textContent, "changed");
    assert.equal(f.status.classList.contains("ft__error"), true);
    assert.equal(f.mirrors.length, 0);
    assert.equal(f.button.disabled, false);
});
