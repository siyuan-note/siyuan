import {test} from "node:test";
import {PROGRESS_FAILURE_LIMIT, BOOT_TIMEOUT_MS, LOCK_RETRY_DEADLINE_MS, VERSION_QUERY_ATTEMPTS, canRetryProgress, bootTimedOut, exhaustedVersionAttempts, lockRetryExpired} from "./kernelBootBudget";
const assert = require("node:assert/strict");

const timeoutError = () => {
    const error = new Error("local kernel request timed out");
    error.name = "LocalKernelRequestTimeoutError";
    return error;
};

test("certificate and network changes stay retryable until the failure budget is spent", () => {
    for (const message of ["net::ERR_CERT_DATABASE_CHANGED", "net::ERR_CERT_VERIFIER_CHANGED",
        "net::ERR_NETWORK_CHANGED"]) {
        assert.equal(canRetryProgress(new Error(message), 1), true);
    }
    assert.equal(canRetryProgress(timeoutError(), 1), true);
    // 第 PROGRESS_FAILURE_LIMIT 次失败不再重试。
    assert.equal(canRetryProgress(new Error("net::ERR_NETWORK_CHANGED"), PROGRESS_FAILURE_LIMIT - 1), true);
    assert.equal(canRetryProgress(new Error("net::ERR_NETWORK_CHANGED"), PROGRESS_FAILURE_LIMIT), false);
});

test("other errors are never retried", () => {
    for (const message of ["net::ERR_CONNECTION_REFUSED", "Unexpected end of JSON input", ""]) {
        assert.equal(canRetryProgress(new Error(message), 1), false);
    }
});

test("version queries stop after the documented attempt count", () => {
    assert.equal(exhaustedVersionAttempts(1), false);
    assert.equal(exhaustedVersionAttempts(VERSION_QUERY_ATTEMPTS), false);
    assert.equal(exhaustedVersionAttempts(VERSION_QUERY_ATTEMPTS + 1), true);
});

test("boot and lock deadlines compare against the injected clock", () => {
    assert.equal(bootTimedOut(BOOT_TIMEOUT_MS, 0), false);
    assert.equal(bootTimedOut(BOOT_TIMEOUT_MS + 1, 0), true);
    assert.equal(lockRetryExpired(100 - 1, 100), false);
    assert.equal(lockRetryExpired(100, 100), true);
    // 期限按当前时刻加上固定预算得出。
    assert.equal(lockRetryExpired(0 + LOCK_RETRY_DEADLINE_MS - 1, 0 + LOCK_RETRY_DEADLINE_MS), false);
    // 未设定期限时不触发。
    assert.equal(lockRetryExpired(1000, undefined), false);
});
