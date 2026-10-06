import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isIfStatement, Node as TSNode, ScriptTarget, transpileModule} from "typescript";
import {canInput} from "../../mobile/util/mobileAppUtil";
import {createMobileKeyboardChangeNotifier} from "../../mobile/util/mobileKeyboardChange";

const source = createSourceFile("index.ts", readFileSync(join(__dirname, "index.ts"), "utf8"), ScriptTarget.Latest);
let imageClick: string;
const findImageClick = (node: TSNode) => {
    if (isIfStatement(node) && node.expression.getText(source) === "!event.shiftKey && !ctrlIsPressed && imgElement") {
        imageClick = node.getText(source);
    }
    forEachChild(node, findImageClick);
};
findImageClick(source);
assert.ok(imageClick);
const compiled = transpileModule(`() => {${imageClick}}`, {compilerOptions: {target: ScriptTarget.ES2020}}).outputText;

const fixture = (options: {mobile?: boolean, disabled?: boolean, readonly?: boolean, sibling?: boolean,
    elementSibling?: boolean, nonEditableSibling?: boolean, shift?: boolean, ctrl?: boolean} = {}) => {
    const element = (attributes: Record<string, string>, className = "", parentElement?: HTMLElement) => ({
        nodeType: 1,
        tagName: "DIV",
        parentElement,
        classList: {contains: (name: string) => name === className},
        getAttribute: (name: string) => attributes[name] ?? null,
        hasAttribute: (name: string) => Object.prototype.hasOwnProperty.call(attributes, name),
    } as unknown as HTMLElement);
    const root = element({"data-readonly": options.readonly ? "true" : "false"}, "protyle-wysiwyg", element({}));
    const editable = element({contenteditable: options.readonly ? "false" : "true"}, "", root);
    const nextSibling = options.elementSibling ? Object.assign(
        element({contenteditable: options.nonEditableSibling ? "false" : "true"}, "", editable),
        {textContent: "after"}) : {nodeType: 3, parentElement: editable, textContent: "\u200bafter"};
    const timers = new Map<number, () => void>();
    const calls: string[] = [];
    let hidden = false;
    const notify = createMobileKeyboardChangeNotifier({
        dispatch: open => {hidden = open; calls.push(open ? "hide-bottom" : "show-bottom");},
        setTimer: callback => {timers.set(1, callback); return 1;},
        clearTimer: timer => {timers.delete(timer);},
    });
    let start: {node: unknown, offset: number};
    let collapsed: boolean;
    let hiddenAtFocus: boolean;
    const click = runInNewContext(compiled, {
        event: {shiftKey: !!options.shift}, ctrlIsPressed: !!options.ctrl,
        imgElement: {classList: {add: () => calls.push("select-image")}},
        hasNextSibling: () => options.sibling === false ? false : nextSibling,
        Constants: {ZWSP: "\u200b"},
        range: {setStart: (node: unknown, offset: number) => {start = {node, offset};},
            collapse: (value: boolean) => {collapsed = value;}},
        protyle: {disabled: !!options.disabled, options: {render: {breadcrumb: true}},
            breadcrumb: {render: () => calls.push("breadcrumb")}},
        focusByRange: () => {hiddenAtFocus = hidden; calls.push("focus");},
        isMobile: () => options.mobile !== false,
        canInput,
        notifyMobileKeyboardChange: notify,
    });
    return {click, calls, nextSibling, notify, timers, start: () => start, collapsed: () => collapsed,
        hiddenAtFocus: () => hiddenAtFocus};
};

test("mobile image selection hides navigation before restoring the caret and opening the keyboard", () => {
    const f = fixture();
    f.click();
    assert.equal(f.hiddenAtFocus(), true);
    assert.deepEqual(f.calls, ["select-image", "hide-bottom", "focus", "breadcrumb"]);
    assert.deepEqual(f.start(), {node: f.nextSibling, offset: 1});
    assert.equal(f.collapsed(), true);
});

test("image selection cancels a pending keyboard close before the native keyboard reopens", () => {
    const f = fixture();
    f.notify(false);
    f.click();
    [...f.timers.values()].forEach(callback => callback());
    assert.equal(f.timers.size, 0);
    assert.equal(f.hiddenAtFocus(), true);
    assert.equal(f.calls.includes("show-bottom"), false);
});

test("desktop and readonly image selection retain navigation visibility", () => {
    for (const options of [{mobile: false}, {disabled: true}, {readonly: true}]) {
        const f = fixture(options);
        f.click();
        assert.equal(f.hiddenAtFocus(), false);
        assert.deepEqual(f.calls, ["select-image", "focus", "breadcrumb"]);
    }
});

test("the caret target respects editable boundaries for element siblings", () => {
    for (const nonEditableSibling of [false, true]) {
        const f = fixture({elementSibling: true, nonEditableSibling});
        f.click();
        assert.equal(f.hiddenAtFocus(), !nonEditableSibling);
        assert.deepEqual(f.start(), {node: f.nextSibling, offset: 0});
    }
});

test("missing caret targets and modified clicks do not report keyboard opening", () => {
    for (const options of [{sibling: false}, {shift: true}, {ctrl: true}]) {
        const f = fixture(options);
        f.click();
        assert.equal(f.calls.includes("hide-bottom"), false);
        assert.equal(f.calls.includes("focus"), false);
    }
});
