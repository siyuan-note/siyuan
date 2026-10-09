import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {connectAVMapWrapper} from "./wrapperEntry";

describe("trusted map navigation wrapper", () => {
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
            location: {hash: `#${instanceID}:${nonce}`, search: "?provider=amap", protocol: "https:", origin},
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
        assert.equal(child.src, `/stage/map/index.html?provider=amap#${instanceID}:${nonce}`);
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
