import * as assert from "node:assert/strict";
import test from "node:test";
import {genAgentConfirmActionButtons, renderAgentConfirmArgs} from "./agentConfirmActions";

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

test("confirmation arguments link standalone block IDs and escape all other content", () => {
    const first = "20261126093000-abcdef0";
    const second = "20261126093000-abcdef1";
    const args = {ids: [first, second], text: `<img src=x> & ${first}suffix prefix-${second}`};
    const html = renderAgentConfirmArgs(args);

    assert.match(html, /&lt;img src=x> &amp;/);
    assert.deepEqual(Array.from(html.matchAll(/<a href="siyuan:\/\/blocks\/([^"]+)">\1<\/a>/g), match => match[1]), [first, second]);
    assert.equal(html.replace(/<\/?a\b[^>]*>/g, "").replaceAll("&lt;", "<").replaceAll("&amp;", "&"),
        JSON.stringify(args, null, 2));
});
