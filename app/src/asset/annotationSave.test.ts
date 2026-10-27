import assert from "node:assert/strict";
import {test} from "node:test";
import {AnnotationSaveQueue} from "./annotationSave";

test("viewer saves are serialized and advance the baseline only after confirmation", async () => {
    const requests: Array<{base: string; data: string}> = [];
    let release: () => void;
    const first = new Promise<void>(resolve => { release = resolve; });
    const queue = new AnnotationSaveQueue("{}", async (base, data) => {
        requests.push({base, data});
        if (requests.length === 1) await first;
        return {code: 0, msg: ""};
    }, () => assert.fail("save should succeed"));
    const saving = queue.save('{"a":1}');
    const second = queue.save('{"a":2,"b":1}');
    await Promise.resolve();
    assert.deepEqual(requests, [{base: "{}", data: '{"a":1}'}]);
    release();
    await Promise.all([saving, second]);
    assert.deepEqual(requests[1], {base: '{"a":1}', data: '{"a":2,"b":1}'});
});

test("conflicts and unconfirmed network failures stop queued saves until the viewer is reopened", async () => {
    for (const failure of ["conflict", "network"]) {
        const requests: string[] = [], messages: string[] = [];
        const queue = new AnnotationSaveQueue('{"a":1}', async base => {
            requests.push(base);
            if (failure === "network") throw new Error("connection closed");
            return {code: -1, msg: "annotation revision conflict"};
        }, message => messages.push(message));
        await Promise.all([queue.save('{"a":2}'), queue.save("{}")]);
        assert.equal(messages.length, 1);
        await queue.save('{"b":1}');
        assert.deepEqual(requests, ['{"a":1}']);
        assert.equal(messages.length, 2, "later edits must repeat the reload prompt without sending another save");
        let reopenedBase: string;
        const reopened = new AnnotationSaveQueue('{"a":3}', async base => {
            reopenedBase = base;
            return {code: 0, msg: ""};
        }, () => assert.fail("reopened viewer should save"));
        await reopened.save('{"a":4}');
        assert.equal(reopenedBase, '{"a":3}');
    }
});
