import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {compileModule, evaluateModule} from "../../testSupport/loadModule";
import * as keymapBindings from "../../util/keymapBindings";

const compiled = compileModule("src/protyle/util/hotKey.ts", ScriptTarget.ES2021);

const fixture = (ios = true, mac = true) => {
    const dependencies: Record<string, object> = {
        "../../util/keymapBindings": keymapBindings,
        "../../constants": {Constants: {KEYCODELIST: {67: "C", 70: "F", 76: "L", 80: "P", 82: "R"}}},
        "./compatibility": {
            isInIOS: () => ios,
            isMac: () => mac,
            isNotCtrl: (event: KeyboardEvent) => !event.ctrlKey && !event.metaKey,
            isOnlyMeta: (event: KeyboardEvent) => mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey,
        },
    };
    const exports = evaluateModule<any>(compiled, {require: (name: string) => dependencies[name]});
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

test("iOS Chinese input matches Option alignment shortcuts before composition starts", () => {
    const match = fixture();
    for (const key of ["c", "l", "r", "C", "L", "R"]) {
        const input = event(key, {metaKey: false, altKey: true});
        assert.equal(match(`⌥${key.toUpperCase()}`, input), true);
        assert.equal(match(key.toLowerCase() === "c" ? "⌥L" : "⌥C", input), false);
        assert.equal(input.keyCode, 229);
    }
    assert.equal(match("⌥⇧C", event("C", {metaKey: false, altKey: true, shiftKey: true})), true);
});

test("iOS Option symbols use physical letter codes when legacy key codes are unavailable", () => {
    const match = fixture();
    for (const keyCode of [0, 229, 231]) {
        for (const [key, code, binding] of [["ç", "KeyC", "⌥C"], ["¬", "KeyL", "⌥L"],
            ["®", "KeyR", "⌥R"], ["≈", "KeyX", "⌥X"]]) {
            const input = event(key, {code, keyCode, metaKey: false, altKey: true});
            assert.equal(match(binding, input), true, `${binding}, keyCode=${keyCode}`);
            assert.equal(match(binding === "⌥C" ? "⌥L" : "⌥C", input), false);
        }
    }
    const input = event("ç", {code: "KeyC", metaKey: false, altKey: true});
    assert.equal(match("⌥⇧C", {...input, shiftKey: true}), true);
    assert.equal(match("⌥⌘C", {...input, metaKey: true}), true);
    assert.equal(match("⌃⌥C", {...input, ctrlKey: true}), true);
    assert.equal(match("⌥C", event("c", {code: "KeyR", metaKey: false, altKey: true})), true);
    assert.equal(match("⌥R", event("c", {code: "KeyR", metaKey: false, altKey: true})), false);
});

test("Option physical fallback excludes composition, named keys, and invalid physical codes", () => {
    const match = fixture();
    const input = event("ç", {code: "KeyC", metaKey: false, altKey: true});
    for (const overrides of [{isComposing: true}, {altKey: false}, {metaKey: true}, {ctrlKey: true},
        {shiftKey: true}, {key: "Process"}, {key: "Unidentified"}, {key: "Dead"}, {key: ""},
        {code: ""}, {code: "Unidentified"}, {code: "Keyc"}, {code: "KeyCC"}, {code: "Digit1"},
        {code: "ArrowLeft"}, {code: "Numpad1"}]) {
        assert.equal(match("⌥C", {...input, ...overrides}), false, JSON.stringify(overrides));
    }
    assert.equal(fixture(false)("⌥C", input), false);
    assert.equal(match("C", {...input, altKey: false}), false);
    assert.equal(match("⌘C", {...input, altKey: false, metaKey: true}), false);
});

test("iOS Option fallback preserves composition, text input, and modifier boundaries", () => {
    const match = fixture();
    const input = event("c", {metaKey: false, altKey: true});
    for (const overrides of [{isComposing: true}, {altKey: false}, {metaKey: true}, {ctrlKey: true},
        {shiftKey: true}, {key: "Process"}, {key: "Unidentified"}, {key: "Dead"}, {key: "ç", code: ""}, {key: ""}]) {
        assert.equal(match("⌥C", {...input, ...overrides}), false, JSON.stringify(overrides));
    }
    assert.equal(match("C", event("c", {metaKey: false})), false);
    assert.equal(match("⇧C", event("C", {metaKey: false, shiftKey: true})), false);
    assert.equal(match("⌥⌘C", {...input, metaKey: true}), true);
    assert.equal(match("⌃⌥C", {...input, ctrlKey: true}), true);
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

test("Option fallback follows custom bindings and explicit unbinding", () => {
    const match = fixture();
    const binding = {default: "⌥C", custom: "⌥C"};
    const input = (key: string, shiftKey = false) => event(key, {metaKey: false, altKey: true, shiftKey});
    keymapBindings.setKeymapBindings(binding, ["⌥L", "⌥⇧R"]);
    assert.equal(match(binding, input("c")), false);
    assert.equal(match(binding, input("l")), true);
    assert.equal(match(binding, input("r", true)), true);
    const symbolInput = event("¬", {code: "KeyL", metaKey: false, altKey: true});
    assert.equal(match(binding, symbolInput), true);
    keymapBindings.setKeymapBindings(binding, []);
    assert.equal(match(binding, input("l")), false);
    assert.equal(match(binding, input("r", true)), false);
    assert.equal(match(binding, symbolInput), false);
});

test("ordinary key codes and non-iOS platform matching remain unchanged", () => {
    for (const ios of [false, true]) {
        const match = fixture(ios);
        assert.equal(match("⌘F", event("f", {keyCode: 70})), true);
        assert.equal(match("⌘P", event("p", {keyCode: 80})), true);
        assert.equal(match("⌥C", event("ç", {keyCode: 67, metaKey: false, altKey: true})), true);
        const input = event("ç", {keyCode: 67, code: "KeyR", metaKey: false, altKey: true});
        assert.equal(match("⌥C", input), true);
        assert.equal(match("⌥R", input), false);
    }
    assert.equal(fixture(false)("⌘F", event("f")), false);
    assert.equal(fixture(false)("⌥C", event("c", {metaKey: false, altKey: true})), false);
    const windows = fixture(false, false);
    assert.equal(windows("⌘F", event("f", {keyCode: 70, metaKey: false, ctrlKey: true})), true);
    assert.equal(windows("⌘F", event("f", {metaKey: false, ctrlKey: true})), false);
});
