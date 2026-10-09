import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as keymapBindings from "../../util/keymapBindings";

const compiled = transpileModule(readFileSync("src/protyle/util/hotKey.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (ios = true, mac = true) => {
    const exports: any = {};
    const dependencies: Record<string, object> = {
        "../../util/keymapBindings": keymapBindings,
        "../../constants": {Constants: {KEYCODELIST: {70: "F", 80: "P"}}},
        "./compatibility": {
            isInIOS: () => ios,
            isMac: () => mac,
            isNotCtrl: (event: KeyboardEvent) => !event.ctrlKey && !event.metaKey,
            isOnlyMeta: (event: KeyboardEvent) => mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey,
        },
    };
    runInNewContext(compiled, {exports, require: (name: string) => dependencies[name]});
    return exports.matchHotKey as (binding: string | keymapBindings.IShortcutKeymap, event: KeyboardEvent) => boolean;
};

const event = (key: string, overrides: Partial<KeyboardEvent> = {}) => ({
    key, code: `Key${key.toUpperCase()}`, keyCode: 229,
    metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false,
    ...overrides,
} as KeyboardEvent);

test("iOS Chinese input matches Command search keys before composition starts", () => {
    const match = fixture();
    for (const key of ["f", "p", "F", "P"]) {
        const input = event(key);
        assert.equal(match(`⌘${key.toUpperCase()}`, input), true);
        assert.equal(match(key.toLowerCase() === "f" ? "⌘P" : "⌘F", input), false);
        assert.equal(input.keyCode, 229);
    }
});

test("iOS Command fallback preserves composition and modifier boundaries", () => {
    const match = fixture();
    for (const overrides of [{isComposing: true}, {metaKey: false}, {ctrlKey: true},
        {altKey: true}, {shiftKey: true}, {key: "Process"}, {key: "Unidentified"}, {key: ""}]) {
        assert.equal(match("⌘F", event("f", overrides)), false, JSON.stringify(overrides));
    }
    assert.equal(match("F", event("f", {metaKey: false})), false);
    assert.equal(match("⇧F", event("F", {metaKey: false, shiftKey: true})), false);
    assert.equal(match("⇧⌘F", event("F", {shiftKey: true})), true);
    assert.equal(match("⌥⌘P", event("p", {altKey: true})), true);
});

test("fallback follows custom and multiple bindings, including explicit unbinding", () => {
    const match = fixture();
    const binding = {default: "⌘F", custom: "⌘F"};
    keymapBindings.setKeymapBindings(binding, ["⌘K", "⇧⌘P"]);
    assert.equal(match(binding, event("f")), false);
    assert.equal(match(binding, event("k")), true);
    assert.equal(match(binding, event("P", {shiftKey: true})), true);
    keymapBindings.setKeymapBindings(binding, []);
    assert.equal(match(binding, event("f")), false);
    assert.equal(match(binding, event("k")), false);
});

test("ordinary key codes and non-iOS platform matching remain unchanged", () => {
    for (const ios of [false, true]) {
        const match = fixture(ios);
        assert.equal(match("⌘F", event("f", {keyCode: 70})), true);
        assert.equal(match("⌘P", event("p", {keyCode: 80})), true);
    }
    assert.equal(fixture(false)("⌘F", event("f")), false);
    const windows = fixture(false, false);
    assert.equal(windows("⌘F", event("f", {keyCode: 70, metaKey: false, ctrlKey: true})), true);
    assert.equal(windows("⌘F", event("f", {metaKey: false, ctrlKey: true})), false);
});
