import * as assert from "node:assert/strict";
import test from "node:test";
import {resolveCloudUserRefresh, type TCloudUser} from "./cloudUser";

const user = {userName: "alice"} as TCloudUser;

test("successful cloud user refresh applies the returned user", () => {
    assert.deepEqual(resolveCloudUserRefresh(0, user, "previous"), {
        apply: true,
        user,
        userName: "",
    });
});

test("temporary cloud user refresh failure preserves the current state", () => {
    assert.deepEqual(resolveCloudUserRefresh(1, user, "alice"), {
        apply: false,
        user,
        userName: "",
    });
});

test("invalid cloud login clears the user and preserves the login name", () => {
    assert.deepEqual(resolveCloudUserRefresh(255, null, "alice"), {
        apply: true,
        user: null,
        userName: "alice",
    });
});
