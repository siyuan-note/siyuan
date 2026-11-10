import {test} from "node:test";
import {getArgFrom} from "./argv";
const assert = require("node:assert/strict");

test("getArgFrom preserves equals signs in values", () => {
    assert.equal(getArgFrom(["--remote=https://example.com/?token=a=b"], "--remote"),
        "https://example.com/?token=a=b");
});

test("getArgFrom distinguishes a bare flag from a missing one", () => {
    assert.equal(getArgFrom(["--safe-mode"], "--safe-mode"), "");
    assert.equal(getArgFrom(["--other=1"], "--safe-mode"), undefined);
});

test("getArgFrom accepts separate values and preserves spaces and equals signs", () => {
    for (const value of ["/tmp/workspace B", "D:\\Notes B", "https://example.com/?token=a=b"]) {
        assert.equal(getArgFrom(["siyuan", "--workspace", value], "--workspace"), value);
    }
    assert.equal(getArgFrom(["--port", "6807", "--lang", "en"], "--port"), "6807");
    assert.equal(getArgFrom(["--port", "6807", "--lang", "en"], "--lang"), "en");
});

test("getArgFrom does not consume another flag and retains first occurrence precedence", () => {
    for (const next of ["--port=6807", "--port", "-h", "--"]) {
        assert.equal(getArgFrom(["--workspace", next], "--workspace"), "");
    }
    assert.equal(getArgFrom(["--workspace=/first", "--workspace", "/second"], "--workspace"), "/first");
    assert.equal(getArgFrom(["--workspace", "/first", "--workspace=/second"], "--workspace"), "/first");
    assert.equal(getArgFrom(["--workspace-other=/wrong"], "--workspace"), undefined);
    assert.equal(getArgFrom(["--workspace=", "/ignored"], "--workspace"), "");
});
