import * as assert from "node:assert/strict";
import test from "node:test";
import {createNamespacePatchQueue} from "./namespacePatchQueue";

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("namespace patches are serialized against the latest server response", async () => {
    type TestConfig = {
        approval: {
            capability: string;
            action: string;
        };
    };
    let config: TestConfig = {approval: {capability: "risk", action: "risk"}};
    const submitted: TestConfig[] = [];
    const releases: Array<() => void> = [];
    const applied: string[] = [];
    const patch = createNamespacePatchQueue<TestConfig>({
        namespace: "ai",
        getConfig: () => config,
        submit: (payload) => new Promise((resolve) => {
            submitted.push(payload);
            releases.push(() => {
                config = payload;
                resolve(payload);
            });
        }),
    });

    patch("ai.approval.capability", "confirm", () => applied.push("capability"));
    patch("approval.action", "allow", () => applied.push("action"));
    await nextTask();

    assert.equal(submitted.length, 1);
    assert.deepEqual(submitted[0], {approval: {capability: "confirm", action: "risk"}});
    releases[0]();
    await nextTask();

    assert.equal(submitted.length, 2);
    assert.deepEqual(submitted[1], {approval: {capability: "confirm", action: "allow"}});
    releases[1]();
    await nextTask();

    assert.deepEqual(config, {approval: {capability: "confirm", action: "allow"}});
    assert.deepEqual(applied, ["capability", "action"]);
});

test("namespace patch queue continues after a failed submission", async () => {
    let config = {first: 0, second: 0};
    let attempts = 0;
    const patch = createNamespacePatchQueue<typeof config>({
        namespace: "settings",
        getConfig: () => config,
        submit: async (payload) => {
            attempts++;
            if (attempts === 1) {
                return undefined;
            }
            config = payload;
            return payload;
        },
    });

    patch("first", 1);
    patch("second", 2);
    await nextTask();
    await nextTask();

    assert.equal(attempts, 2);
    assert.deepEqual(config, {first: 0, second: 2});
});
