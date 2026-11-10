import * as assert from "node:assert/strict";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {toScriptLiteral} from "./scriptLiteral";

test("script literals preserve arbitrary Unicode without closing HTML scripts", () => {
    for (const value of ["</script>\"\\\n\u2028\u2029\ud800", "plain", undefined]) {
        const literal = toScriptLiteral(value);
        assert.doesNotMatch(literal, /<|\u2028|\u2029/);
        assert.equal(runInNewContext(literal), value);
    }
    const value = {title: "</script>\"\\\u2028\u2029\ud800"};
    assert.equal(JSON.stringify(runInNewContext(`(${toScriptLiteral(value)})`)), JSON.stringify(value));
});
