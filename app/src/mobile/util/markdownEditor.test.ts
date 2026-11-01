import {test} from "node:test";
import * as assert from "node:assert/strict";
import {getMobileMarkdownOpener} from "./markdownEditor";

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
