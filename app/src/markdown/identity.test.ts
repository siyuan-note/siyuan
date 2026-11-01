import * as assert from "node:assert/strict";
import {test} from "node:test";
import {createMarkdownInstanceId} from "./identity";

test("native custom-scheme pages create distinct operation namespaces without randomUUID", () => {
    const source = {getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto)};
    const first = createMarkdownInstanceId(source);
    const second = createMarkdownInstanceId(source);
    assert.match(first, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
    assert.notEqual(first, second);
});
