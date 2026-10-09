import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {getAVMapHostCapabilities} from "./hostCapabilities";

const browser = () => ({location: {protocol: "https:"}, navigator: {userAgent: "WebKit"},
    HTMLIFrameElement: {prototype: {}}, setTimeout, clearTimeout});

describe("shared map host capabilities", () => {
    it("supports a plain HTTP browser without requiring credentialless", async () => {
        assert.deepEqual(await getAVMapHostCapabilities(browser() as unknown as Window),
            {supported: true, nativeBoundary: false, credentialless: false});
    });
    it("requires an exact successful native boundary report and accepts asynchronous Android replies", async () => {
        for (const report of [undefined, {enabled: true}, {version: 2, enabled: true}, {version: 1, enabled: false}, true]) {
            const scope = {...browser(), JSAndroid: {}, getAVMapNativeBoundary: async () => report};
            assert.equal((await getAVMapHostCapabilities(scope as unknown as Window)).supported, false);
        }
        const scope = {...browser(), JSAndroid: {}, getAVMapNativeBoundary: async () => ({version: 1, enabled: true})};
        assert.deepEqual(await getAVMapHostCapabilities(scope as unknown as Window),
            {supported: true, nativeBoundary: true, credentialless: false});
    });
    it("uses only the dedicated iOS capability receiver and fails closed on rejection", async () => {
        let calls = 0;
        const receiver = {postMessage: async (input: unknown) => {
            assert.equal(input, null);
            calls++;
            return {version: 1, enabled: true};
        }};
        const scope = {...browser(), webkit: {messageHandlers: {getAVMapNativeBoundary: receiver}}};
        assert.equal((await getAVMapHostCapabilities(scope as unknown as Window)).nativeBoundary, true);
        assert.equal(calls, 1);
        receiver.postMessage = async () => { throw new Error("untrusted frame"); };
        assert.equal((await getAVMapHostCapabilities(scope as unknown as Window)).supported, false);
    });
    it("does not let a reported native capability override Electron, Node or file restrictions", async () => {
        for (const override of [{process: {}}, {require() {}}, {navigator: {userAgent: "Electron/44"}},
            {location: {protocol: "file:"}}]) {
            const scope = {...browser(), JSAndroid: {}, ...override,
                getAVMapNativeBoundary: () => assert.fail("must not call native capability")};
            assert.equal((await getAVMapHostCapabilities(scope as unknown as Window)).supported, false);
        }
    });
});
