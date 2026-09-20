import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isArrowFunction, isCallExpression, isVariableDeclaration, ModuleKind, Node, ScriptTarget, transpileModule} from "typescript";
import {tabKeyboardTarget} from "./tabsState";

const source = createSourceFile("tabsRender.ts", readFileSync("src/protyle/render/tabsRender.ts", "utf8"),
    ScriptTarget.ES2021, true);

const loadHandler = (element: "button" | "task", globals: Record<string, unknown>) => {
    let handler: Node;
    let selectTab: Node;
    const visit = (node: Node) => {
        if (isVariableDeclaration(node) && node.name.getText(source) === "selectTab") {
            selectTab = node.initializer;
        }
        if (isCallExpression(node) && node.expression.getText(source) === `${element}.addEventListener` &&
            node.arguments[0].getText(source) === (element === "button" ? '"keydown"' : "type") &&
            isArrowFunction(node.arguments[1])) {
            handler = node.arguments[1];
        }
        node.forEachChild(visit);
    };
    visit(source);
    assert.ok(handler);
    const compiled = transpileModule(`const selectTab = ${selectTab.getText(source)}; exports.handler = ${handler.getText(source)};`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const exports: any = {};
    runInNewContext(compiled, {exports, ...globals});
    return exports.handler;
};

const fixture = (readonly: boolean, vertical = false, taskReadonly = readonly) => {
    const calls: string[] = [];
    const globals = {
        ids: ["a", "b"], items: [{}], item: {}, itemID: () => "a", type: "keydown", readonly, taskReadonly,
        tabs: {
            getBoundingClientRect: () => ({top: -1}),
            getAttribute: () => vertical ? "vertical" : "horizontal",
            scrollIntoView: (options: ScrollIntoViewOptions) => {
                assert.equal(options.block, "start");
                assert.equal(options.inline, "nearest");
                calls.push("panel-start");
            },
        },
        tabKeyboardTarget,
        list: {children: [{
            dataset: {tabId: "b"},
            scrollIntoView: () => calls.push("scroll"),
            focus: () => calls.push("focus"),
        }]},
        controller: {select: () => calls.push("select"), options: {
            task: () => calls.push("task"),
            activate: () => calls.push("activate"),
        }},
    };
    const button = loadHandler("button", globals);
    const task = loadHandler("task", globals);
    const dispatch = (key: string, onTask = false, modifiers: Record<string, boolean> = {}) => {
        const event = {
            key, defaultPrevented: false, propagationStopped: false, ...modifiers,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() { this.propagationStopped = true; },
        };
        if (onTask) {
            task(event);
        }
        if (!event.propagationStopped) {
            button(event);
        }
        return event;
    };
    return {dispatch, calls};
};

test("tab controls leave modified shortcuts and composition events for their owners", () => {
    for (const readonly of [false, true]) {
        const f = fixture(readonly);
        for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey", "isComposing"]) {
            for (const key of ["Enter", " ", "ArrowRight", "Home"]) {
                for (const onTask of [false, true]) {
                    const event = f.dispatch(key, onTask, {[modifier]: true});
                    assert.equal(event.defaultPrevented, false);
                    assert.equal(event.propagationStopped, false);
                }
            }
        }
        assert.deepEqual(f.calls, []);
    }
});

test("plain tab navigation keeps focus and consumes only matching orientation keys", () => {
    for (const vertical of [false, true]) {
        const f = fixture(true, vertical);
        const event = f.dispatch(vertical ? "ArrowDown" : "ArrowRight");
        assert.equal(event.defaultPrevented, true);
        assert.equal(event.propagationStopped, true);
        assert.deepEqual(f.calls, ["scroll", "focus"]);
        assert.equal(f.dispatch(vertical ? "ArrowRight" : "ArrowDown").propagationStopped, false);
        assert.equal(f.dispatch("Tab").defaultPrevented, false);
    }
});

test("readonly task activation cannot toggle the task or select the parent tab", () => {
    const locked = fixture(true);
    assert.equal(locked.dispatch("Enter", true).propagationStopped, true);
    assert.deepEqual(locked.calls, []);
    const editable = fixture(false);
    assert.equal(editable.dispatch(" ", true).propagationStopped, true);
    assert.deepEqual(editable.calls, ["task"]);
    const tab = fixture(true);
    assert.equal(tab.dispatch("Enter").propagationStopped, true);
    assert.deepEqual(tab.calls, ["select", "activate", "panel-start"]);
    const delegatedTask = fixture(true, false, false);
    assert.equal(delegatedTask.dispatch("Enter", true).propagationStopped, true);
    assert.deepEqual(delegatedTask.calls, ["task"]);
});
