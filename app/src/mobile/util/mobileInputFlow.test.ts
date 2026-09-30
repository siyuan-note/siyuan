import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import {it} from "node:test";
import * as assert from "node:assert/strict";
import * as ts from "typescript";

const sourceFile = ts.createSourceFile("mobile/index.ts", readFileSync(join(__dirname, "../index.ts"), "utf8"),
    ts.ScriptTarget.Latest, true);
const appClass = sourceFile.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "App") as ts.ClassDeclaration;
const statements = appClass.members.find(ts.isConstructorDeclaration).body.statements;
const clickBinding = statements.find(node => node.getText(sourceFile).startsWith('window.addEventListener("click",'));
const focusBinding = statements.find(node => ts.isBlock(node) && node.getText(sourceFile).includes("__siyuan_original_focus"));
assert.ok(clickBinding && focusBinding);

const compile = (source: string) => ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText;

for (const platform of ["android", "harmony", "ios", "browser"]) {
    it(`preserves the selection input flow on ${platform}`, () => {
        const calls: string[] = [];
        const listeners = new Map<string, (event: {target: TestElement}) => void>();
        const document = {activeElement: undefined as TestElement | undefined, contains: () => true};
        const selection = {isCollapsed: false, rangeCount: 1, toString: () => "selected text"};
        class TestElement {
            nodeType = 1;
            tagName = "DIV";
            parentElement: TestElement | null = null;
            attributes = new Map<string, string>();
            classes = new Set<string>();
            classList = {contains: (name: string) => this.classes.has(name)};
            getAttribute(name: string) { return this.attributes.get(name) ?? null; }
            hasAttribute(name: string) { return this.attributes.has(name); }
            setAttribute(name: string, value: string) { this.attributes.set(name, value); }
            focus() {
                document.activeElement = this;
                calls.push("focus");
            }
        }
        const body = new TestElement();
        body.tagName = "BODY";
        const root = new TestElement();
        root.classes.add("protyle-wysiwyg");
        root.setAttribute("data-readonly", "false");
        root.setAttribute("contenteditable", "false");
        root.parentElement = body;
        const editable = new TestElement();
        editable.parentElement = root;
        editable.setAttribute("contenteditable", "true");
        editable.setAttribute("inputmode", "text");
        const window = {
            siyuan: {},
            addEventListener: (type: string, callback: (event: {target: TestElement}) => void) => listeners.set(type, callback),
            dispatchEvent: (event: CustomEvent<boolean>) => calls.push(event.detail ? "open" : "close"),
            setTimeout,
            clearTimeout,
            ...(platform === "android" ? {JSAndroid: {showKeyboard: () => calls.push("show"), hideKeyboard: () => calls.push("hide")}} : {}),
            ...(platform === "harmony" ? {JSHarmony: {showKeyboard: () => calls.push("show"), hideKeyboard: () => calls.push("hide")}} : {}),
        };
        const globals = {window, document, HTMLElement: TestElement, getSelection: () => selection, CustomEvent, console};
        const closest: any = {};
        runInNewContext(compile(readFileSync(join(__dirname, "../../protyle/util/hasClosest.ts"), "utf8")),
            {...globals, exports: closest});
        const notifier: any = {};
        runInNewContext(compile(readFileSync(join(__dirname, "mobileKeyboardChange.ts"), "utf8")),
            {...globals, exports: notifier});
        const input: any = {};
        runInNewContext(compile(readFileSync(join(__dirname, "mobileAppUtil.ts"), "utf8")), {
            ...globals, exports: input,
            require: (name: string) => name === "./mobileKeyboardChange" ? notifier : closest,
        });
        // 运行 App 中的实际事件绑定；选区状态不应替换输入属性或拦截 focus。
        runInNewContext(compile(`${clickBinding.getText(sourceFile)}\n${focusBinding.getText(sourceFile)}`), {
            ...globals, ...closest, ...input,
            hideKeyboardToolbarUtilOnEditorClick: () => calls.push("menu"),
            hideAllElements() {},
        });
        const nativeKeyboard = platform === "android" || platform === "harmony";
        editable.focus();
        assert.deepEqual(calls, nativeKeyboard ? ["focus", "open", "show"] : ["focus"]);
        assert.ok(input.keyboardLockUntil > Date.now());
        assert.equal(document.activeElement, editable);
        assert.equal(editable.getAttribute("inputmode"), "text");
        for (const isCollapsed of [false, true, false]) {
            calls.length = 0;
            selection.isCollapsed = isCollapsed;
            listeners.get("click")({target: editable});
            assert.deepEqual(calls, nativeKeyboard ? ["menu", "open", "show"] : ["menu"]);
            assert.equal(editable.getAttribute("inputmode"), "text");
            assert.equal(selection.isCollapsed, isCollapsed);
        }
        calls.length = 0;
        root.setAttribute("data-readonly", "true");
        editable.focus();
        listeners.get("click")({target: editable});
        assert.deepEqual(calls, ["focus"]);
        root.setAttribute("data-readonly", "false");
        editable.setAttribute("contenteditable", "false");
        calls.length = 0;
        editable.focus();
        listeners.get("click")({target: editable});
        assert.deepEqual(calls, ["focus"]);
    });
}
