import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {connectAVMapWrapper} from "./wrapperEntry";

describe("trusted map navigation wrapper", () => {
    it("forwards only fixed bootstrap error codes and rejects array-shaped handshakes", () => {
        for (const input of ["sdkScriptLoadFailed", "sdkGlobalMissing", "https://private.invalid/?token=secret", {}]) {
            const instanceID = "a".repeat(48), nonce = "b".repeat(48), origin = "https://fixture.invalid";
            const messages: any[] = [], listeners = new Map<string, (event?: any) => void>();
            let appended = 0, removed = 0;
            const child = {style: {}, setAttribute() {}, contentWindow: {postMessage() {}}, remove() { removed++; }};
            const scope = {
                location: {hash: `#${instanceID}:${nonce}`, search: "?provider=openfreemap", protocol: "https:", origin},
                parent: {postMessage: (value: unknown) => messages.push(value)},
                document: {createElement: () => child, body: {appendChild() { appended++; }}},
                setTimeout: () => 1, clearTimeout() {},
                addEventListener: (type: string, callback: (event?: any) => void) => listeners.set(type, callback),
                removeEventListener: (type: string) => listeners.delete(type),
            };
            connectAVMapWrapper(scope as unknown as Window);
            const receive = listeners.get("message");
            const prepare = {version: 1, type: "prepare", instanceID, nonce};
            receive({source: scope.parent, origin, ports: [], data: Object.assign([], prepare)});
            assert.equal(appended, 0);
            receive({source: scope.parent, origin, ports: [], data: prepare});
            receive({source: child.contentWindow, origin: "null", ports: [], data: {...prepare, type: "hello"}});
            receive({source: child.contentWindow, origin: "null", ports: [],
                data: {...prepare, type: "bootstrapError", code: input, message: "secret"}});
            const code = typeof input === "string" && input.startsWith("sdk") ? input : "hostBootstrapFailed";
            assert.deepEqual(messages[messages.length - 1], {version: 1, type: "bootstrapError", instanceID, nonce, code});
            assert.equal(removed, 1);
            assert.equal(listeners.has("message"), false);
        }
    });
    it("authenticates both sides, preserves the opaque sandbox, and transfers only one port after bootstrap", () => {
        const instanceID = "a".repeat(48);
        const nonce = "b".repeat(48);
        const origin = "https://fixture.invalid";
        const attributes: Record<string, string> = {};
        const parentMessages: any[] = [];
        const childMessages: any[] = [];
        const listeners = new Map<string, (event?: any) => void>();
        let appended = 0;
        let removed = 0;
        const child = {src: "", style: {}, credentialless: false,
            setAttribute: (key: string, value: string) => { attributes[key] = value; },
            contentWindow: {postMessage: (...args: any[]) => childMessages.push(args)}, remove() { removed++; }};
        const scope = {
            location: {hash: `#${instanceID}:${nonce}`, search: "?provider=openfreemap", protocol: "https:", origin},
            parent: {postMessage: (...args: any[]) => parentMessages.push(args)},
            document: {createElement: () => child, body: {appendChild() { appended++; }}},
            setTimeout() { return 1; }, clearTimeout() {},
            addEventListener: (type: string, callback: (event?: any) => void) => listeners.set(type, callback),
            removeEventListener: (type: string) => listeners.delete(type),
        };
        connectAVMapWrapper(scope as unknown as Window);
        const onMessage = listeners.get("message");
        assert.equal(parentMessages[0][0].type, "wrapperHello");
        const fromParent = {source: scope.parent, origin, ports: [] as unknown[],
            data: {version: 1, instanceID, nonce, type: "prepare", nativeBoundary: true}};
        onMessage({...fromParent, origin: "null"});
        onMessage({...fromParent, source: {}});
        onMessage({...fromParent, data: {...fromParent.data, nonce: "old"}});
        assert.equal(appended, 0);
        onMessage(fromParent);
        onMessage(fromParent);
        assert.equal(appended, 1);
        assert.equal(attributes.sandbox, "allow-scripts");
        assert.equal(child.credentialless, true);
        assert.equal(child.src, `/stage/map/index.html?provider=openfreemap#${instanceID}:${nonce}`);
        const port = {};
        const connect = {...fromParent, ports: [port], data: {...fromParent.data, type: "connect"}};
        onMessage(connect);
        assert.equal(childMessages.length, 0);
        const fromChild = {source: child.contentWindow, origin: "null", ports: [] as unknown[],
            data: {version: 1, instanceID, nonce, type: "hello"}};
        onMessage({...fromChild, origin});
        onMessage({...fromChild, source: {}});
        assert.equal(childMessages.length, 0);
        onMessage(fromChild);
        assert.deepEqual(childMessages[0][0], {version: 1, instanceID, nonce, type: "prepare", nativeBoundary: true});
        onMessage({...fromChild, data: {...fromChild.data, type: "bootstrapReady"}});
        assert.equal(parentMessages[parentMessages.length - 1][0].type, "bootstrapReady");
        onMessage(connect);
        onMessage(connect);
        assert.equal(childMessages.length, 2);
        assert.equal(childMessages[1][2][0], port);
        assert.equal(listeners.has("message"), false);
        listeners.get("pagehide")();
        assert.equal(removed, 1);
        onMessage(fromParent);
        assert.equal(appended, 1);
    });
});
