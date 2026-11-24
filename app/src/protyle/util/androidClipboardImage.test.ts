import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getAndroidClipboardImageBridge, getAndroidClipboardPaste, readAndroidClipboardImage} from "./androidClipboardImage";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/0cgAAAAASUVORK5CYII=";
const makeBridge = () => {
    const requests: {id: string; action: string}[] = [];
    const bridge = {
        postMessage: (message: string) => { requests.push(JSON.parse(message)); },
        onmessage: undefined as (event: {data: string}) => void,
    };
    const reply = (id: string, mimeType?: string, data?: string) => bridge.onmessage({data: JSON.stringify({id, mimeType, data})});
    return {bridge, requests, reply};
};

test("the Android image bridge correlates current responses without accepting paths or stale replies", async () => {
    const {bridge, requests, reply} = makeBridge();
    assert.equal(getAndroidClipboardImageBridge({}), undefined);
    assert.equal(getAndroidClipboardImageBridge({siyuanClipboardImageNative: bridge}), bridge);

    const timedOut = readAndroidClipboardImage(bridge, 1);
    assert.equal(await readAndroidClipboardImage(bridge), undefined);
    assert.equal(await timedOut, undefined);
    const pending = readAndroidClipboardImage(bridge);
    assert.deepEqual(requests.map(request => Object.keys(request).sort()), [["action", "id"], ["action", "id"]]);
    assert.ok(requests.every(({action, id}) => action === "readClipboardImage" && /^[A-Za-z0-9_-]{1,64}$/.test(id)));
    assert.notEqual(requests[0].id, requests[1].id);
    reply(requests[0].id, "image/png", "AAAA");
    reply(requests[1].id, "image/png", png);
    const image = await pending;
    assert.ok(image.size > 0);
    assert.equal(image.type, "image/png");
    assert.equal(image.name, "image.png");
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(png, "base64"));
});

test("failed, empty, unsupported and invalid Android replies do not yield an upload", async () => {
    const {bridge, requests, reply} = makeBridge();
    for (const [mimeType, data] of [[undefined, undefined], ["image/png", ""], ["image/svg+xml", png],
        ["image/png", "bad!"], ["image/png", "AAAA".repeat(3 * 1024 * 1024)]]) {
        const pending = readAndroidClipboardImage(bridge);
        reply(requests.at(-1).id, mimeType, data);
        assert.equal(await pending, undefined);
    }
});

test("only a trusted image-only Android event can recover a zero-byte placeholder", () => {
    const placeholder = new File([], "image-uri", {type: "image/png"});
    const realPNG = new File(["png"], "image.png", {type: "image/png"});
    const emptyFile = new File([], "note.txt", {type: "text/plain"});
    const uri = "content://example.android/image/1";
    const clipboard = {types: ["text/plain", "image-uri", "Files"],
        getData: (type: string) => type === "image-uri" ? uri : "",
        files: [placeholder] as unknown as FileList};
    assert.deepEqual(getAndroidClipboardPaste(clipboard, true, "", false), {files: [], textPlain: "", recoverImage: true});
    assert.deepEqual(getAndroidClipboardPaste(clipboard, true, uri, false), {files: [], textPlain: "", recoverImage: true});
    assert.deepEqual(getAndroidClipboardPaste(clipboard, true, "keep me", false), {files: [], textPlain: "keep me", recoverImage: false});
    assert.equal(getAndroidClipboardPaste(clipboard, false, "", false).recoverImage, false);
    assert.equal(getAndroidClipboardPaste(clipboard, true, "", true).recoverImage, false);
    assert.equal(getAndroidClipboardPaste({...clipboard, types: ["Files"]}, true, "", false).recoverImage, false);
    assert.deepEqual(getAndroidClipboardPaste({...clipboard, files: [placeholder, realPNG, emptyFile] as unknown as FileList},
        true, "", false), {files: [realPNG, emptyFile], textPlain: "", recoverImage: false});
});
