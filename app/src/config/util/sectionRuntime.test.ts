import * as assert from "node:assert/strict";
import {test} from "node:test";
import {createSectionRuntime} from "./sectionRuntime";

test("reactions compare coherent snapshots and finish asynchronous actions before resolving", async () => {
    let current = {font: 16, theme: "light"};
    const old = current;
    const events: string[] = [];
    let finish: () => void;
    const runtime = createSectionRuntime({namespace: "appearance", get: () => current, set: next => { current = next; },
        reactions: [{name: "font", changed: (before, after) => before.font !== after.font,
            apply: async (before, after) => {
                assert.equal(before, old);
                assert.equal(after, current);
                events.push("font");
                await new Promise<void>(resolve => { finish = resolve; });
                events.push("complete");
            }}, {name: "theme", changed: (before, after) => before.theme !== after.theme, apply: () => { events.push("theme"); }}],
    });
    const pending = runtime.apply({font: 24, theme: "light"});
    assert.deepEqual(events, ["font"]);
    finish();
    await pending;
    assert.deepEqual(events, ["font", "complete"]);
    await runtime.apply(current);
    assert.deepEqual(events, ["font", "complete"]);
});

test("dependent reactions wait for previous asynchronous actions in declaration order", async () => {
    let current = 1;
    let finish: () => void;
    const events: string[] = [];
    const runtime = createSectionRuntime({namespace: "editor", get: () => current, set: next => { current = next; },
        reactions: [{name: "styles", changed: () => true, apply: async () => {
            events.push("styles");
            await new Promise<void>(resolve => { finish = resolve; });
            events.push("styles loaded");
        }}, {name: "measure", changed: () => true, apply: () => { events.push("measure"); }}],
    });
    const pending = runtime.apply(2);
    assert.deepEqual(events, ["styles"]);
    finish();
    await pending;
    assert.deepEqual(events, ["styles", "styles loaded", "measure"]);
});
