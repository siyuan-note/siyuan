import {test} from "node:test";
import * as assert from "node:assert/strict";
import {getMobileMarkdownOpener} from "./markdownEditor";
import {isMarkdownDisplayResource, remoteMarkdownImageURL} from "../../markdown/resourcePolicy";

test("mobile image preview distinguishes network images from another native session's local resources", () => {
    const page = "https://siyuan-markdown.local/stage/build/markdown/index.html";
    assert.equal(remoteMarkdownImageURL("https://img.shields.io/badge/release-stable-green.svg"), "https://img.shields.io/badge/release-stable-green.svg");
    const foreign = "https://siyuan-markdown.local/resource/session-b/token";
    assert.equal(isMarkdownDisplayResource(foreign, page, "session-a"), false);
    assert.equal(remoteMarkdownImageURL(foreign), undefined, "native resources cannot bypass session ownership as network images");
    assert.equal(isMarkdownDisplayResource("https://siyuan-markdown.local/resource/session-a/token", page, "session-a"), true);
});

test("mobile entry requires an implemented native capability and never forwards paths", () => {
    assert.equal(getMobileMarkdownOpener({}), undefined);
    assert.equal(getMobileMarkdownOpener({JSAndroid: {}, JSHarmony: {}, webkit: {messageHandlers: {}}}), undefined);
    for (const platform of ["JSAndroid", "JSHarmony"] as const) {
        const calls: unknown[][] = [];
        getMobileMarkdownOpener({[platform]: {openMarkdownEditor(...args: unknown[]) {calls.push(args);}}})();
        assert.deepEqual(calls, [[]]);
    }
    const messages: string[] = [];
    getMobileMarkdownOpener({webkit: {messageHandlers: {openMarkdownEditor: {postMessage: message => messages.push(message)}}}})();
    assert.deepEqual(messages, [""]);
});
