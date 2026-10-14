import * as assert from "node:assert/strict";
import {test} from "node:test";
import {AgentRunController, AgentRunView, PendingAgentInteraction} from "./AgentRunController";
import {AgentSessionRuns} from "./AgentSessionRuns";
import type {ISSEResult} from "./agentSSE";

type Snapshot = {sessionID: string, captured?: boolean};

const deferred = () => {
    let resolve: () => void;
    let reject: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    return {promise, resolve, reject};
};

const fixture = () => {
    let sessionID = "first";
    const events: ISSEResult[] = [];
    const interactions: PendingAgentInteraction[] = [];
    const browserCalls: string[] = [];
    const finished: Array<[string, boolean]> = [];
    let notifications = 0;
    let captures = 0;
    const runs = new AgentSessionRuns<PendingAgentInteraction, ISSEResult, Snapshot>();
    const view: AgentRunView<Snapshot> = {
        currentSessionID: () => sessionID,
        beforeBegin: () => {}, activate: () => {}, detached: () => {}, completed: () => {},
        discarded: () => {}, changed: () => {},
        finishedDetached: (run, attached) => { finished.push([run.sessionID, attached]); },
        snapshot: () => ({sessionID}), prepareDetach: () => {},
        captureView: state => { state.captured = true; captures++; },
        restore: (_state, consumed) => { consumed(); return true; },
        notifyInteraction: () => { notifications++; },
        renderInteraction: async event => { interactions.push(event); },
        handleEvent: async event => { events.push(event); },
        handleBrowserCall: async event => { browserCalls.push(event.callID); },
        startReplay: () => {}, prepareReplayContent: () => {}, idleReplay: () => {}, recoverUnavailable: () => {},
    };
    return {controller: new AgentRunController(runs, view), runs, view, events, interactions, browserCalls, finished,
        setSession: (value: string) => { sessionID = value; }, notifications: () => notifications, captures: () => captures};
};

test("background runs coalesce text and replay distinct interactions without touching the foreground", async () => {
    const h = fixture();
    const first = h.controller.begin();
    h.controller.prepareForDetach(first);
    h.controller.captureView(first);
    assert.equal(h.captures(), 1);
    assert.deepEqual(first.viewState, {sessionID: "first", captured: true});
    h.controller.detach("first");
    h.setSession("second");
    const second = h.controller.begin();
    for (const event of [
        {type: "turn", turnID: "turn-first"}, {type: "content", token: "a"}, {type: "content", token: "b"},
        {type: "reasoning", token: "x"}, {type: "reasoning", token: "y"},
    ] satisfies ISSEResult[]) {
        await h.controller.handleEvent(first, event);
    }
    const confirm: PendingAgentInteraction = {type: "confirm", confirmID: "shared", name: "tool", arguments: {}};
    const question: PendingAgentInteraction = {type: "question", questionID: "shared", arguments: {}};
    for (const event of [confirm, confirm, question]) {
        await h.controller.handleEvent(first, event);
    }
    await h.controller.handleEvent(first, {type: "browser_capability_call", callID: "browser", name: "browser", capabilityID: "capability", generation: 1, arguments: {}});
    assert.deepEqual(h.events, []);
    assert.deepEqual(h.browserCalls, ["browser"]);
    assert.equal(h.notifications(), 2);
    assert.equal(first.turnID, "turn-first");
    assert.equal(second.controller.signal.aborted, false);
    h.setSession("first");
    h.controller.attach(first);
    await first.replayPromise;
    assert.deepEqual(h.events, [{type: "turn", turnID: "turn-first"}, {type: "content", token: "ab"}, {type: "reasoning", token: "xy"}]);
    assert.deepEqual(h.interactions, [confirm, question]);
    assert.equal(first.viewState, undefined);
    assert.equal(first.detached, false);
    h.controller.removeInteraction("first", "confirm", "shared");
    assert.deepEqual(first.pendingInteractions, [question]);
    assert.equal(first.renderedInteractionKeys.has("confirm:shared"), false);
});

test("finishing waits for replay and ignores a completed or replaced run", async () => {
    const h = fixture();
    const run = h.controller.begin();
    h.controller.detach("first");
    h.setSession("second");
    const replay = deferred();
    run.replayPromise = replay.promise;
    const finish = h.controller.finish(run);
    assert.equal(h.runs.get("first"), run);
    replay.resolve();
    await finish;
    assert.deepEqual(h.finished, [["first", false]]);
    assert.equal(h.runs.resolveStatus("first"), "unread");
    h.setSession("first");
    const replacement = h.controller.begin();
    h.controller.enqueue(run, {type: "content", token: "stale"});
    await h.controller.finish(run);
    assert.equal(h.runs.get("first"), replacement);
    assert.deepEqual(h.finished, [["first", false]]);
    assert.deepEqual(replacement.pendingEvents, []);
});

test("duplicate attachment shares replay and a switch stops subsequent view work", async () => {
    const h = fixture();
    const run = h.controller.begin();
    h.controller.detach("first");
    h.controller.enqueue(run, {type: "content", token: "first"});
    const processing = deferred();
    h.view.handleEvent = async event => { h.events.push(event); await processing.promise; };
    h.controller.attach(run);
    const replay = run.replayPromise;
    h.controller.attach(run);
    assert.equal(run.replayPromise, replay);
    await h.controller.handleEvent(run, {type: "content", token: "later"});
    h.setSession("second");
    processing.resolve();
    await replay;
    assert.deepEqual(h.events, [{type: "content", token: "first"}]);
    assert.deepEqual(run.pendingEvents, [{type: "content", token: "later"}]);
    assert.equal(run.detached, true);
    assert.equal(run.interactionViewReady, false);
    assert.equal(run.replaying, false);
});

test("view processing keeps the newest promise and waits through a rejection", async () => {
    const h = fixture();
    const run = h.controller.begin();
    const first = deferred();
    const second = deferred();
    const oldProcessing = h.controller.processView(run, () => first.promise);
    const newProcessing = h.controller.processView(run, () => second.promise);
    const failure = assert.rejects(newProcessing, /fixture/);
    first.resolve();
    await oldProcessing;
    assert.equal(run.processingPromise, second.promise);
    const waiting = h.controller.waitForView(run);
    second.reject(new Error("fixture"));
    await Promise.all([failure, waiting]);
    assert.equal(run.processingPromise, undefined);
});

test("restore consumes the snapshot at the view adapter's original completion point", () => {
    const h = fixture();
    const run = h.controller.begin();
    h.controller.snapshot(run);
    h.view.restore = (state, consumed) => {
        assert.equal(run.viewState, state);
        consumed();
        assert.equal(run.viewState, undefined);
        return true;
    };
    assert.equal(h.controller.restore(run), true);
    assert.equal(h.controller.restore(run), false);
});
