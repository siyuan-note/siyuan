import * as assert from "node:assert/strict";
import test from "node:test";
import {AgentSessionRuns} from "./AgentSessionRuns";

test("keeps session runs independent", () => {
    const runs = new AgentSessionRuns();
    const first = runs.begin("first");
    const second = runs.begin("second");
    first.renderedInteractionKeys.add("confirm:first");

    runs.detach("first");
    runs.abort("second");

    assert.equal(first.detached, true);
    assert.equal(first.controller.signal.aborted, false);
    assert.equal(first.renderedInteractionKeys.has("confirm:first"), true);
    assert.equal(second.controller.signal.aborted, true);
    assert.equal(runs.resolveStatus("first"), "running");
    assert.equal(runs.resolveStatus("second"), "running");
});

test("tracks unread completion until the session is opened", () => {
    const runs = new AgentSessionRuns();
    const run = runs.begin("session");

    runs.complete(run, true);
    assert.equal(runs.resolveStatus("session"), "unread");
    assert.equal(runs.hasRunning(), false);

    runs.markRead("session");
    assert.equal(runs.resolveStatus("session"), undefined);
});

test("ignores completion from a replaced run", () => {
    const runs = new AgentSessionRuns();
    const first = runs.begin("session");
    runs.complete(first, false);
    const second = runs.begin("session");

    runs.complete(first, true);

    assert.equal(runs.get("session"), second);
    assert.equal(runs.resolveStatus("session"), "running");
});
