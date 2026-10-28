import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {compileModule, evaluateModule} from "../testSupport/loadModule";

const source = compileModule("src/util/kernelFault.ts", ScriptTarget.ES2021);

const fixture = (platform = "desktop", probe: () => Promise<boolean> = async () => false) => {
    const state = {quitting: false, probes: 0};
    const dialogs: {options: {disableClose: boolean, content: string}, element: {id: string}}[] = [];
    class Dialog {
        element = {id: "", setAttribute: () => {}, querySelectorAll: () => [{addEventListener: () => {}}]};
        constructor(public options: {disableClose: boolean, content: string}) { dialogs.push(this); }
    }
    const dependencies: Record<string, unknown> = {
        "../constants": {Constants: {SIYUAN_VERSION: "test", DIALOG_KERNELFAULT: "dialog-kernelfault"}},
        "../dialog": {Dialog},
        "../dialog/processSystem": {isHostQuitStarted: () => state.quitting},
        "./functions": {isBrowser: () => platform === "browser", isMobile: () => platform === "mobile",
            isKernelInContainer: () => false},
        "../protyle/util/compatibility": {isInIOS: () => platform === "ios",
            isInMobileApp: () => platform === "mobile" || platform === "ios"},
        "./kernelConnection": {checkKernelConnection: () => { state.probes++; return probe(); }},
    };
    const api = evaluateModule<typeof import("./kernelFault")>(source, {
        require: (name: string) => dependencies[name],
        document: {querySelector: () => dialogs.find(dialog => dialog.element.id === "errorLog")},
        window: {siyuan: {languages: new Proxy({}, {get: (_target, key) => key})}},
    });
    return {api, state, dialogs};
};

test("desktop faults require failed liveness confirmation and concurrent reports create one dialog", async () => {
    const alive = fixture("desktop", async () => true);
    await alive.api.kernelError();
    assert.equal(alive.dialogs.length, 0);
    const offline = fixture();
    await Promise.all([offline.api.kernelError(), offline.api.kernelError()]);
    assert.equal(offline.dialogs.length, 1);
    assert.equal(offline.dialogs[0].options.disableClose, true);
    assert.match(offline.dialogs[0].options.content, /kernelFault1/);
});

test("shutdown and obsolete socket diagnoses cannot open late fatal dialogs", async () => {
    let finish: (alive: boolean) => void;
    const {api, state, dialogs} = fixture("desktop", () => new Promise(resolve => finish = resolve));
    const checking = api.kernelError();
    state.quitting = true;
    finish(false);
    await checking;
    assert.equal(dialogs.length, 0);
    await api.kernelError();
    assert.equal(state.probes, 1);
    state.quitting = false;
    let obsolete = false;
    const stale = api.kernelError(() => obsolete);
    obsolete = true;
    finish(false);
    await stale;
    assert.equal(dialogs.length, 0);
});

test("browser and mobile retain their existing connection and recovery dialogs", async () => {
    for (const platform of ["browser", "mobile", "ios"]) {
        const {api, state, dialogs} = fixture(platform);
        await api.kernelError();
        assert.equal(state.probes, 0);
        assert.equal(dialogs.length, 1);
        assert.match(dialogs[0].options.content, new RegExp(platform === "mobile" ? "mobileKernelReconnectPrompt" :
            platform === "ios" ? "reconnectPrompt" : "kernelFault1"));
    }
});
