import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getModelTestMessage} from "./aiModelTestResult";

const messages = {
    testConnectionSuccess: "Connection successful",
    testConnectionFail: "Connection failed",
    testConnectionFailMsg: "Connection failed: ${msg}",
};

test("model tests show generation errors even when the selected model is available", () => {
    for (const available of [["gpt-6-luna"], ["another-model"], []]) {
        assert.equal(getModelTestMessage({
            available,
            matched: false,
            msg: "'temperature' is not supported with this model",
        }, messages), "Connection failed: 'temperature' is not supported with this model");
    }
});

test("model tests do not infer a missing model from an available list", () => {
    for (const available of [["gpt-6-luna"], []]) {
        assert.equal(getModelTestMessage({available, matched: false}, messages), messages.testConnectionFail);
        assert.equal(getModelTestMessage({available, matched: true}, messages), messages.testConnectionSuccess);
    }
});

test("model tests escape provider error messages before displaying HTML", () => {
    assert.equal(getModelTestMessage({
        available: ["gpt-6-luna"],
        matched: false,
        msg: '<img src="x"> & error',
    }, messages), "Connection failed: &lt;img src=&quot;x&quot;&gt; &amp; error");
});
