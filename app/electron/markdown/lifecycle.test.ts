const assert = require("node:assert/strict");
import {test} from "node:test";
const {createMarkdownLifecycle} = require("./lifecycle");

test("ordinary workspace quitting passes through when no Markdown windows exist", () => {
    const lifecycle = createMarkdownLifecycle({getManager: () => undefined, quit: () => assert.fail()});
    assert.equal(lifecycle.beforeQuit({preventDefault: () => assert.fail()}), false);
});

test("a document still opening must finish the close gate before application quit", async () => {
    let finish;
    let quits = 0;
    const manager = {hasWindows: () => false, hasPendingWork: () => true,
        closeAll: () => new Promise(resolve => { finish = resolve; })};
    const lifecycle = createMarkdownLifecycle({getManager: () => manager, quit: () => quits++});
    let prevented = false;
    assert.equal(lifecycle.beforeQuit({preventDefault() { prevented = true; }}), true);
    assert.equal(prevented, true);
    assert.equal(quits, 0);
    finish(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(quits, 1);
});

test("duplicate application quits share one asynchronous Markdown close", async () => {
    let finish;
    let closes = 0;
    let quits = 0;
    let windows = true;
    const manager = {hasWindows: () => windows, closeAll: () => {
        closes++;
        return new Promise(resolve => { finish = () => { windows = false; resolve(true); }; });
    }};
    const lifecycle = createMarkdownLifecycle({getManager: () => manager, quit: () => quits++});
    const event = {preventDefault() {}};
    assert.equal(lifecycle.beforeQuit(event), true);
    assert.equal(lifecycle.beforeQuit(event), true);
    assert.equal(lifecycle.busy(), true);
    assert.equal(closes, 1);
    finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(quits, 1);
    assert.equal(lifecycle.busy(), false);
    assert.equal(lifecycle.beforeQuit(event), false);
});

test("cancellation and save errors keep Markdown windows open without continuing application quit", async () => {
    for (const rejects of [false, true]) {
        const manager = {hasWindows: () => true, closeAll: async () => {
            if (rejects) throw new Error("save failed");
            return false;
        }};
        const lifecycle = createMarkdownLifecycle({getManager: () => manager, quit: () => assert.fail("quit after cancellation")});
        assert.equal(lifecycle.beforeQuit({preventDefault() {}}), true);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(lifecycle.hasWindows(), true);
        assert.equal(lifecycle.busy(), false);
    }
});

test("updates and shutdowns prepare, finish, or cancel the same manager", async () => {
    const calls = [];
    const manager = {hasWindows: () => true, prepareQuit: async reason => { calls.push(reason); return true; },
        closeAll: async () => { calls.push("close"); return true; }, cancelQuit: () => calls.push("cancel")};
    const lifecycle = createMarkdownLifecycle({getManager: () => manager, quit() {}});
    assert.equal(await lifecycle.prepare("update"), true);
    lifecycle.cancel();
    assert.equal(await lifecycle.prepare("shutdown"), true);
    assert.equal(await lifecycle.finish(), true);
    assert.deepEqual(calls, ["update", "cancel", "shutdown", "close"]);
});
