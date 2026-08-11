import * as assert from "node:assert/strict";
import test from "node:test";
import {genAgentConfirmActionButtons} from "./agentConfirmActions";

const labels = {
    reject: "Reject",
    approve: "Approve",
    allowSession: "Session Allow",
    allowSessionDescription: "Allow non-forced confirmations for this session",
};

test("forced confirmations omit session approval", () => {
    const html = genAgentConfirmActionButtons(true, labels);

    assert.match(html, /agent-chat__confirm-reject/);
    assert.match(html, /agent-chat__confirm-approve/);
    assert.doesNotMatch(html, /agent-chat__confirm-always/);
});

test("risk-based confirmations offer session approval", () => {
    const html = genAgentConfirmActionButtons(false, labels);

    assert.match(html, /agent-chat__confirm-always/);
    assert.match(html, /Allow non-forced confirmations for this session/);
});
