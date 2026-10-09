const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const ts = require("typescript");

test("mobile system links wait for startup and use the shared URI dispatcher", () => {
    const source = readFileSync(path.join(__dirname, "../src/mobile/util/systemUri.ts"), "utf8");
    const code = ts.transpileModule(source, {compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    }}).outputText;
    const calls = [];
    const app = {};
    const api = {};
    new Function("exports", "require", code)(api, () => ({
        processSiYuanUri: (...args) => { calls.push(args); return true; },
    }));
    const plugin = "siyuan://plugins/demo/install?repo=owner/repo&tag=v1.0.0";
    const bazaar = "siyuan://bazaar/plugins/demo/readme";
    assert.equal(api.processMobileSystemUri(app, plugin), true);
    assert.equal(api.processMobileSystemUri(app, plugin), true);
    assert.equal(api.processMobileSystemUri(app, bazaar), true);
    for (const uri of [null, "invalid", "https://plugins/demo", "siyuan://blocks/20261006120000-abcdefg"]) {
        assert.equal(api.processMobileSystemUri(app, uri), false);
    }
    assert.equal(calls.length, 0);
    api.finishMobileSystemUris(app);
    assert.deepEqual(calls, [[app, plugin], [app, bazaar]]);
    api.finishMobileSystemUris(app);
    assert.equal(calls.length, 2);
    assert.equal(api.processMobileSystemUri(app, plugin), true);
    assert.deepEqual(calls[2], [app, plugin]);
});
