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
