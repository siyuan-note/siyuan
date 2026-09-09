const test = require("node:test");
const assert = require("node:assert/strict");
const {updateGlobalShortcutBindings} = require("./globalShortcutBindings");

const fixture = () => {
    const callbacks = new Map();
    const calls = [];
    const errors = [];
    let activeId = 1;
    const workspaces = [1, 2].map(id => ({browserWindow: {webContents: {id}, isDestroyed: () => false}}));
    const options = {
        workspaces,
        globalShortcut: {unregister: key => callbacks.delete(key), register: (key, callback) => {
            callbacks.set(key, callback);
            return true;
        }},
        convert: key => key.toUpperCase(),
        getActiveId: () => activeId,
        toggle: workspace => calls.push([workspace.browserWindow.webContents.id, "toggle"]),
        dispatch: (workspace, key) => calls.push([workspace.browserWindow.webContents.id, key]),
        reportError: error => errors.push(error),
    };
    return {callbacks, calls, errors, workspaces, options, activate: id => activeId = id,
        update: (index, hotkeys, toggleHotkeys = []) => updateGlobalShortcutBindings(workspaces[index], {hotkeys, toggleHotkeys}, options)};
};

test("registers multiple window-toggle keys and deduplicates accelerators", () => {
    const f = fixture();
    assert.deepEqual(f.update(0, ["a", "A", "b", "c"], ["a", "b"]), []);
    assert.equal(f.callbacks.size, 3);
    f.callbacks.get("A")();
    f.callbacks.get("B")();
    f.callbacks.get("C")();
    assert.deepEqual(f.calls, [[1, "toggle"], [1, "toggle"], [1, "c"]]);
});

test("removing one workspace binding preserves another owner and uses eligible focus", () => {
    const f = fixture();
    f.update(0, ["a", "b"]);
    f.update(1, ["a"]);
    f.activate(2);
    f.callbacks.get("A")();
    f.callbacks.get("B")();
    assert.deepEqual(f.calls, [[2, "a"], [1, "b"]]);
    f.update(1, []);
    assert.equal(f.callbacks.has("A"), true);
    f.callbacks.get("A")();
    assert.deepEqual(f.calls.at(-1), [1, "a"]);
    f.update(0, []);
    assert.equal(f.callbacks.size, 0);
});

test("replacing and restoring bindings leaves no stale registrations", () => {
    const f = fixture();
    f.update(0, ["a", "b"]);
    f.update(0, ["c"]);
    assert.deepEqual([...f.callbacks.keys()], ["C"]);
    f.update(0, []);
    assert.equal(f.callbacks.size, 0);
    f.update(0, ["a", "b"]);
    assert.deepEqual([...f.callbacks.keys()], ["A", "B"]);
});

test("reports host rejection and thrown registration errors", () => {
    const f = fixture();
    f.options.globalShortcut.register = key => {
        if (key === "B") {
            throw new Error("unsupported accelerator");
        }
        return false;
    };
    assert.deepEqual(f.update(0, ["a", "b"]), ["a", "b"]);
    assert.equal(f.errors.length, 1);
});

test("recording suspends all workspace shortcuts and restores their bindings afterward", () => {
    const f = fixture();
    f.update(0, ["a"]);
    f.update(1, ["b"]);
    updateGlobalShortcutBindings(f.workspaces[0], {hotkeys: [], suspended: true}, f.options);
    assert.equal(f.callbacks.size, 0);
    assert.deepEqual(f.workspaces[0].hotkeys, ["a"]);
    f.update(1, ["c"]);
    assert.equal(f.callbacks.size, 0);
    f.update(0, ["a"]);
    assert.deepEqual([...f.callbacks.keys()].sort(), ["A", "C"]);
});
