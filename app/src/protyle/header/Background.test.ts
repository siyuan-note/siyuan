import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, forEachChild, isCallExpression, ScriptTarget, transpileModule} from "typescript";

test("adding a document icon opens selection without changing the document or its header", () => {
    const source = createSourceFile("Background.ts", readFileSync(__dirname + "/Background.ts", "utf8"), ScriptTarget.Latest, true);
    let listener: string;
    const collect = (node: import("typescript").Node) => {
        if (isCallExpression(node) && node.expression.getText(source) === "this.element.addEventListener" &&
            node.arguments[0].getText(source) === '"click"') {
            listener = node.getText(source);
        }
        forEachChild(node, collect);
    };
    collect(source);
    assert.ok(listener);
    const element = new EventTarget();
    Object.defineProperty(element, "isEqualNode", {value: (other: EventTarget) => other === element});
    const panels: unknown[][] = [];
    const writes: unknown[] = [];
    const changes: string[] = [];
    const iconRect = {left: 100, bottom: 200, height: 60, width: 60};
    const buttonRect = {left: 120, bottom: 240, height: 28, width: 110};
    const target = (type: string) => ({
        getAttribute: () => type, getBoundingClientRect: () => type === "icon" ? buttonRect : iconRect,
        isEqualNode: (): boolean => false, parentElement: element, querySelector: (): null => null,
    });
    const background = {element, iconElement: {
        getBoundingClientRect: () => iconRect,
        classList: {remove: (name: string) => changes.push(name)},
    }};
    const protyle = {element: {}, block: {rootID: "document"}, disabled: false,
        model: {parent: {setDocIcon: (value: string) => changes.push(value)}}};
    new Function("protyle", "hideElements", "openEmojiPanel", "fetchPost", transpileModule(listener, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText).call(background, protyle, () => {}, (...args: unknown[]) => panels.push(args),
        (...args: unknown[]) => writes.push(args));
    const click = (type: string) => {
        const event = new Event("click", {cancelable: true});
        Object.defineProperty(event, "target", {value: target(type)});
        element.dispatchEvent(event);
        return event;
    };
    assert.equal(click("icon").defaultPrevented, true);
    assert.deepEqual(panels[0], ["document", "doc", {
        x: buttonRect.left, y: buttonRect.bottom, h: buttonRect.height, w: buttonRect.width,
    }, undefined, undefined, {ownerElement: protyle.element}]);
    assert.deepEqual(writes, [], "opening the picker does not persist a provisional icon");
    assert.deepEqual(changes, [], "opening the picker does not reveal or replace the document icon");
    click("open-emoji");
    assert.deepEqual(panels[1], ["document", "doc", {
        x: iconRect.left, y: iconRect.bottom, h: iconRect.height, w: iconRect.width,
    }, undefined, null, {ownerElement: protyle.element}], "existing icons retain their own picker anchor");
    protyle.disabled = true;
    click("icon");
    assert.equal(panels.length, 2, "read-only headers cannot open icon selection");
});
