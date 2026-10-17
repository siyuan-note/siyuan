import * as assert from "node:assert/strict";
import {test} from "node:test";

const buildGlobals = ["SIYUAN_VERSION", "NODE_ENV"].map(name => ({
    name, descriptor: Object.getOwnPropertyDescriptor(globalThis, name),
}));
buildGlobals.forEach(({name}) => Object.defineProperty(globalThis, name, {configurable: true, value: "test"}));
const {isEmptyTabPlaceholder}: typeof import("./tabsList") = require("./tabsList");
buildGlobals.forEach(({name, descriptor}) => {
    if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
    } else {
        Reflect.deleteProperty(globalThis, name);
    }
});

const paragraph = (attrs: Record<string, string>, text = "", rich = false) => ({
    attributes: Object.entries(attrs).map(([name, value]) => ({name, value})),
    getAttribute: (name: string) => attrs[name],
    querySelector: () => ({textContent: text, querySelector: () => rich ? {} : null}),
}) as unknown as Element;

test("only untouched conversion placeholders can be omitted when restoring a list", () => {
    assert.equal(isEmptyTabPlaceholder(paragraph({})), false);
    assert.equal(isEmptyTabPlaceholder(paragraph({"tabs-placeholder": "true"})), true);
    assert.equal(isEmptyTabPlaceholder(paragraph({"tabs-placeholder": "true"}, "12")), false);
    assert.equal(isEmptyTabPlaceholder(paragraph({"tabs-placeholder": "true"}, "", true)), false);
    for (const name of ["custom-test", "name", "alias", "memo", "bookmark", "style", "refcount"]) {
        assert.equal(isEmptyTabPlaceholder(paragraph({"tabs-placeholder": "true", [name]: "kept"})), false);
    }
});
