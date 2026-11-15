import * as assert from "node:assert/strict";
import {test} from "node:test";
import {AgentMessageQueue} from "./AgentMessageQueue";

test("message queues preserve FIFO order, cancellation and session isolation", () => {
    const queue = new AgentMessageQueue<{id: string}>();
    queue.add("first", {id: "one"});
    queue.add("first", {id: "two"});
    queue.add("second", {id: "three"});
    queue.remove("first", "one");
    queue.prepend("first", {id: "retry"});
    assert.deepEqual(queue.get("first").map(message => message.id), ["retry", "two"]);
    assert.deepEqual(queue.get("second").map(message => message.id), ["three"]);
    queue.clear("first");
    assert.deepEqual(queue.get("first"), []);
    assert.deepEqual(queue.get("second").map(message => message.id), ["three"]);
});
