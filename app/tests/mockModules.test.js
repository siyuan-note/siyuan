const assert = require("node:assert/strict");
const {test} = require("node:test");
const {createMockRequire} = require("./fixtures/mockModules.cjs");

test("mock module loading accepts only explicitly registered dependencies", () => {
    const empty = {};
    const api = {patch() {}};
    const load = createMockRequire({"./empty": empty, "./api": api});
    assert.equal(load("./empty"), empty);
    assert.equal(load("./api"), api);
    assert.throws(() => load("./missing"), /Unexpected fixture module: \.\/missing/);
    assert.throws(() => load("toString"), /Unexpected fixture module: toString/);
});
