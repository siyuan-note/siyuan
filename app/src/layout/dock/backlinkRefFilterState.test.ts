import {it} from "node:test";
import * as assert from "node:assert/strict";
import {acquireBacklinkRefFilter} from "./backlinkRefFilterState";
import type {IViewStateTransport, TViewStateData} from "../../util/viewState";

it("shares selections across surfaces, isolates targets and restores persisted selections", async () => {
    const data = new Map<string, TViewStateData>();
    const transport: IViewStateTransport = {
        async get(key) { return data.get(key) || {}; },
        async patch(key, values) { data.set(key, {...data.get(key), ...values}); },
    };
    const options = {transport, flushDelay: 60000};
    let bottom: string[] = [];
    let dock: string[] = [];
    let other: string[] = [];
    const a = acquireBacklinkRefFilter("target-a", ids => bottom = ids, options);
    const b = acquireBacklinkRefFilter("target-a", ids => dock = ids, options);
    const c = acquireBacklinkRefFilter("target-b", ids => other = ids, options);
    await Promise.all([a.ready, b.ready, c.ready]);
    const id = "20260909120000-abcdefg";
    a.set([id, id]);
    assert.deepEqual(bottom, [id]);
    assert.deepEqual(dock, [id]);
    assert.deepEqual(other, []);
    await Promise.all([a.release(), b.release(), c.release()]);
    const reopened = acquireBacklinkRefFilter("target-a", ids => bottom = ids, options);
    await reopened.ready;
    assert.deepEqual(bottom, [id]);
    reopened.set([]);
    await reopened.release();
    const reset = acquireBacklinkRefFilter("target-a", ids => bottom = ids, options);
    await reset.ready;
    assert.deepEqual(bottom, []);
    await reset.release();
});
