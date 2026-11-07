import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isIfStatement, isMethodDeclaration, Node, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check = require("node:assert/strict");
    const focused: Element[] = [];
    const api = new Function("focusBlock", "hideElements", source +
        "\nreturn {tabsRender, destroyTabsRender, titleKeydown, TitleHint, openAddMenu};")(
        (element: Element) => focused.push(element),
        (_types: string[], protyle: IProtyle) => protyle.hint.element.classList.add("fn__none"));
    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    document.body.append(editor);
    try {
        for (const extension of ["svg", "png"]) {
            for (const titleHTML of [
                `<img class="emoji" src="/emojis/custom.${extension}">`,
                `<img src="/assets/image.${extension}">`,
                `A<img class="emoji" src="/emojis/custom.${extension}">B`,
                `<img class="emoji" src="/emojis/custom.${extension}"><img class="emoji" src="/emojis/second.${extension}">`,
                "&#x1f600;", "", "<strong>A</strong><br>B",
            ]) {
                editor.innerHTML = '<div class="tabs" data-type="NodeTabs" data-node-id="tabs">' +
                    '<div class="tab-item" data-type="NodeTabItem" data-node-id="item">' +
                    '<div class="tab-item-info"><span class="tab-item-title callout-title" contenteditable="true">' +
                    titleHTML + '</span></div><div class="tab-item-content">Body</div></div></div>';
                api.tabsRender(editor, {label: "Untitled"});
                const title = editor.querySelector<HTMLElement>(".tab-item-title");
                const label = editor.querySelector(".tabs-tab-label");
                check.equal(label.querySelectorAll("img").length, title.querySelectorAll("img").length);
                check.equal(label.textContent, titleHTML.includes("<br>") ? "A B" :
                    title.textContent || (titleHTML ? "" : "Untitled"));
                for (let index = 0; index <= title.childNodes.length; index++) {
                    const range = document.createRange();
                    range.setStart(title, index);
                    range.collapse(true);
                    for (const key of ["Delete", "Backspace", "ArrowLeft", "ArrowRight"]) {
                        const event = new KeyboardEvent("keydown", {key, cancelable: true});
                        api.titleKeydown(title, editor, range, event, {
                            hint: {element: {classList: {contains: () => true}}},
                        });
                        const boundary = key === "Backspace" || key === "ArrowLeft" ?
                            index === 0 : index === title.childNodes.length;
                        check.equal(event.defaultPrevented, boundary, `${titleHTML}: ${key} at ${index}`);
                    }
                }
                // 原生删除仍能移除图片，标题栏重绘后与源标题一致。
                const image = title.querySelector("img");
                if (image) {
                    const range = document.createRange();
                    range.selectNode(image);
                    range.deleteContents();
                    api.tabsRender(editor, {label: "Untitled"});
                    check.equal(editor.querySelectorAll(".tabs-tab-label img").length, title.querySelectorAll("img").length);
                }
                api.destroyTabsRender(editor);
            }
        }
        editor.innerHTML = '<div class="tabs" data-type="NodeTabs" data-node-id="tabs">' +
            '<div class="tab-item" data-type="NodeTabItem" data-node-id="item" data-tabs-editing="true">' +
            '<div class="tab-item-info"><span class="tab-item-title callout-title" contenteditable="true">Title</span>' +
            '</div><div class="tab-item-content">Body</div></div></div>';
        api.tabsRender(editor, {label: "Untitled", readonly: () => false});
        const item = editor.querySelector<HTMLElement>(".tab-item");
        const title = editor.querySelector<HTMLElement>(".tab-item-title");
        for (const selector of ["keyboardToolbar", "protyle-hint", "outside"]) {
            title.focus();
            const range = document.createRange();
            range.selectNodeContents(title);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            item.dataset.tabsEditing = "true";
            const panel = document.createElement("div");
            if (selector === "keyboardToolbar") {
                panel.id = selector;
            } else {
                panel.className = selector;
            }
            const input = document.createElement("input");
            panel.append(input);
            document.body.append(panel);
            if (selector === "keyboardToolbar") {
                const util = document.createElement("div");
                util.className = "keyboard__util";
                util.append(input);
                panel.append(util);
                const button = document.createElement("button");
                button.className = "keyboard__action";
                button.dataset.type = "done";
                button.innerHTML = "<svg><use></use></svg>";
                panel.append(button);
                const protyle = {toolbar: {range}, contentElement: {scrollTop: 0}};
                api.openAddMenu(protyle, panel, button, range);
                check.notEqual(protyle.toolbar.range, range);
                check.equal(document.activeElement, util);
            } else {
                input.focus();
            }
            await new Promise(resolve => setTimeout(resolve, 0));
            check.equal(item.dataset.tabsEditing, selector === "outside" ? "false" : "true",
                selector + ": " + document.activeElement.outerHTML);
            panel.remove();
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        api.destroyTabsRender(editor);
        for (const titleClass of ["callout-title", "callout-title tab-item-title"]) {
            editor.innerHTML = `<span class="${titleClass}" contenteditable="true">/</span>`;
            const title = editor.firstElementChild;
            const range = document.createRange();
            range.selectNodeContents(title);
            range.collapse(false);
            const hint = new api.TitleHint();
            hint.element = document.createElement("div");
            hint.element.innerHTML = '<div><button class="b3-list-item b3-list-item--focus" data-value="first">First</button>' +
                '<button class="b3-list-item" data-value="second">Second</button></div>';
            editor.append(hint.element);
            const filled: string[] = [];
            hint.fill = (value: string) => filled.push(value);
            const protyle = {hint};
            const dispatch = (key: string, modifiers: KeyboardEventInit = {}) => {
                const event = new KeyboardEvent("keydown", {key, cancelable: true, ...modifiers});
                api.titleKeydown(title, editor, range, event, protyle);
                return event;
            };
            check.equal(dispatch("ArrowDown").defaultPrevented, true);
            check.equal(hint.element.querySelector(".b3-list-item--focus").dataset.value, "second");
            check.equal(dispatch("Enter").defaultPrevented, true);
            check.deepEqual(filled, ["second"]);
            check.equal(focused.length, 0);
            check.equal(dispatch("ArrowUp").defaultPrevented, true);
            check.equal(hint.element.querySelector(".b3-list-item--focus").dataset.value, "first");
            for (const modifiers of [{altKey: true}, {shiftKey: true}, {isComposing: true}]) {
                dispatch("Enter", modifiers);
                check.deepEqual(filled, ["second"]);
            }
            focused.length = 0;
            dispatch("ArrowLeft");
            check.equal(hint.element.classList.contains("fn__none"), true);
            dispatch("Enter");
            check.deepEqual(filled, ["second"]);
            check.equal(focused.length, 1);
            focused.length = 0;
            hint.element.classList.remove("fn__none");
            hint.element.innerHTML = '<div class="emojis"><button data-unicode="custom.svg"></button></div>';
            const moved: string[] = [];
            let deactivated = 0;
            hint.emojiPanel = {
                getCurrentElement: () => hint.element.querySelector("button"),
                moveSelection: (key: string) => moved.push(key),
                deactivate: () => deactivated++,
            };
            dispatch("ArrowRight");
            check.deepEqual(moved, ["ArrowRight"]);
            dispatch("Enter");
            check.deepEqual(filled, ["second", "custom.svg"]);
            check.equal(deactivated, 1);
            check.equal(focused.length, 0);
        }
    } finally {
        api.destroyTabsRender(editor);
        editor.remove();
    }
    return "tabs-emoji-ok";
};

test("titles prioritize hint selection and preserve custom emoji and editing boundaries", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const compile = (source: string) => transpileModule(source.replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const file = "src/protyle/wysiwyg/keydown.ts";
    const ast = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.ES2021, true);
    let handler: string;
    const visit = (node: Node) => {
        if (isIfStatement(node) && node.expression.getText(ast) ===
            "calloutTitleElement && !event.isComposing && !blockSelectionModeElement") {
            handler = node.getText(ast);
        }
        node.forEachChild(visit);
    };
    visit(ast);
    assert.ok(handler);
    const mobileFile = "src/mobile/util/keyboardToolbar.ts";
    const mobileAst = createSourceFile(mobileFile, readFileSync(mobileFile, "utf8"), ScriptTarget.ES2021, true);
    let addHandler: string;
    const visitMobile = (node: Node) => {
        if (isIfStatement(node) && node.expression.getText(mobileAst) === 'type === "add"') {
            addHandler = node.thenStatement.getText(mobileAst);
        }
        node.forEachChild(visitMobile);
    };
    visitMobile(mobileAst);
    assert.ok(addHandler);
    const hintAst = createSourceFile("hint.ts", readFileSync("src/protyle/hint/index.ts", "utf8"), ScriptTarget.ES2021, true);
    let select: string;
    const visitHint = (node: Node) => {
        if (isMethodDeclaration(node) && node.name.getText(hintAst) === "select") {
            select = node.getText(hintAst);
        }
        node.forEachChild(visitHint);
    };
    visitHint(hintAst);
    assert.ok(select);
    const source = ["src/util/escape.ts", "src/util/upDownHint.ts", "src/protyle/util/selectionOffsets.ts",
        "src/protyle/render/tabsState.ts", "src/protyle/render/tabsDrag.ts",
        "src/protyle/render/tabsAttributes.ts", "src/protyle/render/tabsVisibility.ts",
        "src/protyle/render/tabsRender.ts"]
        .map(file => compile(readFileSync(file, "utf8"))).join("\n") + compile(`
        const matchHotKey = () => false;
        const isNotCtrl = event => !event.ctrlKey && !event.metaKey;
        const isOnlyMeta = event => event.ctrlKey || event.metaKey;
        const Constants = {ZWSP: "\\u200b"};
        const resetKeyboardToolbarUtilButtons = () => {};
        const renderSlashMenu = () => {};
        const showKeyboardToolbarUtil = () => {};
        const hideAndroidKeyboardForPanel = () => {};
        const openAddMenu = (protyle, toolbarElement, buttonElement, range) => ${addHandler};
        class TitleHint {${select}}
        const titleKeydown = (calloutTitleElement, nodeElement, range, event, protyle) => {
            const blockSelectionModeElement = undefined;
            ${handler}
        };`);
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-tabs-emoji-"));
    const script = path.join(directory, "main.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; try { (${browserCases.toString()})(${JSON.stringify(source)}) } catch (error) { error.stack }`)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /tabs-emoji-ok/);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
        assert.ok(path.basename(directory).startsWith("siyuan-tabs-emoji-"));
        rmSync(directory, {recursive: true, force: true});
    }
});
