import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getCloudLoginUserName,
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

test("cloud user refresh preserves state after temporary failures", () => {
    const user = createUser("alice");

    assert.deepEqual(resolveCloudUserRefresh(1, user, "previous"), {
        apply: false,
        user,
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
