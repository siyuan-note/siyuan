import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getCloudLoginUserName,
    createCloudUserRefresh,
    resolveCloudUserRefresh,
    setCloudUser,
    type TCloudUser,
} from "./cloudUser";

const createUser = (userName: string) => ({userName}) as TCloudUser;

test("cloud user refresh applies successful responses", () => {
    const user = createUser("alice");

    assert.deepEqual(resolveCloudUserRefresh(0, user, "previous"), {
        apply: true,
        user,
        userName: "",
    });
});

test("automatic cloud refreshes share pending manual requests and respect a one-minute cooldown", async () => {
    let now = 1000;
    let requests = 0;
    let finish: (value: number) => void;
    const refresh = createCloudUserRefresh(() => {
        requests++;
        return new Promise<number>(resolve => { finish = resolve; });
    }, () => now);
    const pending = refresh("china:alice");
    assert.equal(refresh("china:alice", true), pending);
    await Promise.resolve();
    assert.equal(requests, 1);
    finish(1);
    assert.equal(await pending, 1);
    now += 59999;
    assert.equal(await refresh("china:alice"), undefined);
    assert.equal(requests, 1);
    now++;
    const automatic = refresh("china:alice");
    await Promise.resolve();
    finish(2);
    assert.equal(await automatic, 2);
    const manual = refresh("china:alice", true);
    await Promise.resolve();
    finish(3);
    assert.equal(await manual, 3);
    assert.equal(requests, 3);
});

test("failed cloud refreshes retain the automatic cooldown and allow manual retries", async () => {
    let requests = 0;
    const refresh = createCloudUserRefresh(async () => {
        requests++;
        throw new Error("offline");
    }, () => 1000);
    await assert.rejects(refresh("alice"), /offline/);
    assert.equal(await refresh("alice"), undefined);
    await assert.rejects(refresh("alice", true), /offline/);
    assert.equal(requests, 2);
});

test("completing an old account refresh does not clear a new account's pending request", async () => {
    const completions: Array<(value: string) => void> = [];
    const refresh = createCloudUserRefresh(() => new Promise<string>(resolve => completions.push(resolve)));
    const oldAccount = refresh("china:alice");
    const newAccount = refresh("global:bob");
    await Promise.resolve();
    completions[0]("alice");
    await oldAccount;
    assert.equal(refresh("global:bob", true), newAccount);
    completions[1]("bob");
    assert.equal(await newAccount, "bob");
});

test("cloud user refresh preserves state after temporary failures", () => {
    const user = createUser("alice");

    assert.deepEqual(resolveCloudUserRefresh(1, user, "previous"), {
        apply: false,
        user,
        userName: "",
    });
});

test("message duration payloads do not replace the cloud user", () => {
    assert.deepEqual(resolveCloudUserRefresh(1, {closeTimeout: 5000}, "alice"), {
        apply: false,
        user: null,
        userName: "",
    });
});

test("invalid cloud users are cleared and retain the previous login name", () => {
    assert.deepEqual(resolveCloudUserRefresh(255, null, "alice"), {
        apply: true,
        user: null,
        userName: "alice",
    });
});

test("cloud user state manages the login name fallback", () => {
    const originalWindow = globalThis.window;
    const testWindow = {siyuan: {user: null}} as unknown as Window & typeof globalThis;
    Object.defineProperty(globalThis, "window", {configurable: true, value: testWindow});

    try {
        setCloudUser(null, "alice");
        assert.equal(testWindow.siyuan.user, null);
        assert.equal(getCloudLoginUserName(), "alice");

        const user = createUser("alice");
        setCloudUser(user);
        assert.equal(testWindow.siyuan.user, user);
        assert.equal(getCloudLoginUserName(), "");
    } finally {
        Object.defineProperty(globalThis, "window", {configurable: true, value: originalWindow});
    }
});
