import * as assert from "node:assert/strict";
import test from "node:test";
import {bindAccountAuthEnter, isAccountLoginDisabled} from "./accountAuth";

test("login requires agreement and a non-empty password", () => {
    assert.equal(isAccountLoginDisabled(false, "password"), true);
    assert.equal(isAccountLoginDisabled(true, ""), true);
    assert.equal(isAccountLoginDisabled(true, "password"), false);
    assert.equal(isAccountLoginDisabled(true, "password", true), true);
});

test("Enter submits account authentication", () => {
    let listener: (event: KeyboardEvent) => void;
    const input = {
        addEventListener: (_type: string, callback: (event: KeyboardEvent) => void) => {
            listener = callback;
        },
    } as unknown as HTMLInputElement;
    let submitted = 0;
    bindAccountAuthEnter(input, () => {
        submitted++;
    });

    let defaultPrevented = false;
    listener!({
        isComposing: false,
        repeat: false,
        key: "Enter",
        preventDefault: () => {
            defaultPrevented = true;
        },
    } as KeyboardEvent);

    assert.equal(submitted, 1);
    assert.equal(defaultPrevented, true);
});

test("account authentication ignores other and composing key events", () => {
    let listener: (event: KeyboardEvent) => void;
    const input = {
        addEventListener: (_type: string, callback: (event: KeyboardEvent) => void) => {
            listener = callback;
        },
    } as unknown as HTMLInputElement;
    let submitted = 0;
    bindAccountAuthEnter(input, () => {
        submitted++;
    });

    const preventDefault = () => assert.fail("ignored events must not be prevented");
    listener!({isComposing: false, repeat: false, key: "Escape", preventDefault} as unknown as KeyboardEvent);
    listener!({isComposing: true, repeat: false, key: "Enter", preventDefault} as unknown as KeyboardEvent);
    listener!({isComposing: false, repeat: true, key: "Enter", preventDefault} as unknown as KeyboardEvent);

    assert.equal(submitted, 0);
});
