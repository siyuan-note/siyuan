import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../testSupport/loadModule";

const fixture = (data: {isFolded: boolean, isHidden?: boolean, isRoot?: boolean}, mobile = false) => {
    const requests: unknown[] = [];
    const dependencies = {
        Constants: {CB_GET_HL: "hl", CB_GET_FOCUS: "focus", CB_GET_ALL: "all", CB_GET_CONTEXT: "context", CB_GET_ROOTSCROLL: "scroll"},
        isPhablet: () => mobile,
        fetchPost: (url: string, request: unknown, callback: (value: unknown) => void) => {
            requests.push({url, request: JSON.parse(JSON.stringify(request))});
            callback({data});
        },
    };
    const exports = loadModule<any>("src/util/noRelyPCFunction.ts", {require: () => dependencies}, ScriptTarget.ES2021);
    const open = (reference = true, id = "unloaded-target") => {
        let result: any;
        (reference ? exports.checkReferenceFold : exports.checkFold)(id, (zoomIn: boolean, action: string[], isRoot: boolean) => {
            result = {zoomIn, action: Array.from(action), isRoot};
        });
        return result;
    };
    return {open, requests};
};

test("references keep visible folded targets in context without requiring a loaded DOM", () => {
    for (const mobile of [false, true]) {
        const f = fixture({isFolded: true, isHidden: false, isRoot: false}, mobile);
        assert.deepEqual(f.open(), {zoomIn: false, action: [mobile ? "hl" : "focus", "context", "scroll"], isRoot: false});
        assert.deepEqual(f.requests, [{url: "/api/block/checkBlockFold", request: {id: "unloaded-target"}}]);
    }
});

test("references focus hidden targets and preserve old backend behavior", () => {
    for (const data of [{isFolded: true, isHidden: true}, {isFolded: true}]) {
        assert.deepEqual(fixture(data).open().action, ["focus", "all"]);
        assert.equal(fixture(data).open().zoomIn, true);
    }
    assert.equal(fixture({isFolded: false}).open().zoomIn, false);
});

test("other checkFold callers retain the existing folded behavior", () => {
    assert.equal(fixture({isFolded: true, isHidden: false}).open(false).zoomIn, true);
});

test("document roots and empty reference IDs retain their contract", () => {
    assert.equal(fixture({isFolded: false, isHidden: false, isRoot: true}).open().isRoot, true);
    const f = fixture({isFolded: false});
    assert.equal(f.open(true, ""), undefined);
    assert.equal(f.requests.length, 0);
});
