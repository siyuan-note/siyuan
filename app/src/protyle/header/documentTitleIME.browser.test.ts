import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isCallExpression, Node, transpileModule, ScriptTarget} from "typescript";

test("composition deletion and reinsertion pass through WYSIWYG handlers without structural mutation", async () => {
    const source = createSourceFile("index.ts", readFileSync(join(__dirname, "../wysiwyg/index.ts"), "utf8"), ScriptTarget.Latest, true);
    const listeners = new Map<string, string>();
    const visit = (node: Node) => {
        if (isCallExpression(node) && node.expression.getText(source) === "this.element.addEventListener" &&
            ['"beforeinput"', '"input"'].includes(node.arguments[0]?.getText(source))) {
            listeners.set(JSON.parse(node.arguments[0].getText(source)), node.arguments[1].getText(source));
        }
        forEachChild(node, visit);
    };
    visit(source);
    const helpers = ["nativeInputUndo.ts", "multilineInput.ts", "compositionInput.ts"].map(file =>
        readFileSync(join(__dirname, "../wysiwyg", file), "utf8").replace(/^import [\s\S]*?;\r?\n/gm, "")
            .replace(/^export /gm, "")).join("\n");
    for (const type of ["deleteCompositionText", "insertFromComposition"]) {
        for (const eventName of ["beforeinput", "input"]) {
            let stopped = false;
            const element = Object.freeze({});
            const receiver = {element, lastHTMLs: {}};
            const listener = runInNewContext(transpileModule(helpers + "\n(function () {return " +
                listeners.get(eventName) + ";}).call(receiver)", {compilerOptions: {target: ScriptTarget.ES2021}}).outputText, {
                receiver, isComposition: true, crossBlockComposition: undefined,
                compositionInputText: "", lineBreakUndoContext: undefined, forwardDeleteUndoContext: undefined,
                hasClosestByClassName: () => false, isInAndroid: () => false, isMac: () => true,
                getSelection: () => ({rangeCount: 1}), getAVTemplateInteractiveElement: () => false,
                hideElements: () => {}, protyle: {hint: {}},
            });
            await listener({inputType: type, data: type === "insertFromComposition" ? "中文" : null,
                isComposing: true, cancelable: true, target: element,
                preventDefault: () => { throw new Error("composition must remain native"); },
                stopPropagation: () => { stopped = true; }});
            assert.equal(stopped, false);
            assert.deepEqual(receiver.lastHTMLs, {});
        }
    }
});

const browserCases = async (sources: string[], lutePath: string) => {
    const check: typeof assert = require("node:assert/strict");
    require(lutePath);
    Object.assign(window, {siyuan: {languages: {_kernel: {16: "Untitled"}, block: "Block",
        documentTitleInlineOnly: "Inline only", settingsPendingSaveError: "Save failed"}}});
    const unwrap = new Function(sources[0] + "\nreturn unwrapLongTextRuns;")();
    const restore = new Function("unwrapLongTextRuns", sources[1] + "\nreturn restoreInlineElementBoundaries;")(unwrap);
    const dom = new Function("restoreInlineElementBoundaries", sources[2] +
        "\nreturn {prepareDocumentTitleBlockDOM, prepareDocumentTitleInitialDOM, getDocumentTitleDOMFingerprint," +
        "getDocumentTitleLute, flattenDocumentTitlePaste, getDocumentTitleUnsupportedPasteBlocks};")(restore);
    const disable = new Function(sources[4] + "\nreturn disabledWYSIWYG;")();
    const closestBlock = new Function(sources[5] + "\nreturn hasClosestBlock;")();
    const committed = new Function(sources[6] + "\nreturn isCommittedTextInput;")();
    const lute = Lute.New();
    lute.SetTextMark(true);
    lute.SetProtyleWYSIWYG(true);
    lute.SetKramdownIAL(true);
    const paragraph = (text = "") => '<div data-type="NodeParagraph" data-node-id="20261115000000-abcdefg" class="p">' +
        `<div contenteditable="true" spellcheck="false">${text}</div></div>`;
    for (const platform of ["ipad-desktop", "ipad-mobile", "desktop", "iphone", "android"]) {
        const ipad = platform.startsWith("ipad");
        const mobile = ["ipad-mobile", "iphone", "android"].includes(platform);
        const outerEditable = !["iphone", "android"].includes(platform);
        const host = document.createElement("div");
        let replayingComposition = false;
        host.addEventListener("input", event => {
            // execCommand 的 input 不带组合标记，重放时由下面的日志事件替代。
            if (replayingComposition) event.stopImmediatePropagation();
        }, true);
        const wysiwyg = document.createElement("div");
        wysiwyg.className = "protyle-wysiwyg";
        host.append(wysiwyg);
        document.body.append(host);
        const saved: string[] = [];
        let menuDismissals = 0;
        let revision = "r0";
        let changed: () => void;
        const fragment = {
            wysiwyg, getBlockHTML: () => wysiwyg.innerHTML,
            focus: () => wysiwyg.focus(),
            setBlockHTML: (html: string) => { wysiwyg.innerHTML = html; },
            protyle: {block: {}, undo: {}, toolbar: {subElement: document.createElement("div")},
                wysiwyg: {flushPendingInput: async () => {}}},
            instance: {
                enable: () => {
                    wysiwyg.contentEditable = String(outerEditable);
                    wysiwyg.querySelectorAll("[spellcheck]").forEach(element => element.setAttribute("contenteditable", "true"));
                },
                disable: () => disable(wysiwyg),
            },
            destroy: () => {},
        };
        const dependencies = {
            ...dom, isIPad: () => ipad, isMobile: () => mobile,
            getDefaultToolbar: (): string[] => [], registerBuiltinSlashHint: () => {},
            hintRef: () => {}, hintTag: () => {}, getAgentLute: () => lute,
            setMobileToolbarUndo: () => {}, hideAllElements: () => {}, isCommittedTextInput: committed,
            globalClickHideMenu: (target: HTMLElement) => {
                check.equal(host.contains(target), true);
                menuDismissals++;
            },
            Constants: {TIMEOUT_INPUT: 60000, SIYUAN_APPID: "test"},
            mountProtyleLiteFragment: (_host: HTMLElement, options: {initialBlockHTML: string; onChange: () => void}) => {
                wysiwyg.innerHTML = options.initialBlockHTML;
                changed = options.onChange;
                return fragment;
            },
            queueTransaction: (_owner: unknown, run: () => Promise<void>) => run(),
            fetchSyncPost: async (url: string, data: {transactions: Array<{doOperations: Array<{
                data: {blockDOM: string; expectedRevision: string};
            }>}>}) => {
                if (url.endsWith("getDocTitle")) return {code: 0, data: {revision, blockDOM: wysiwyg.innerHTML}};
                const operation = data.transactions[0].doOperations[0];
                check.equal(operation.data.expectedRevision, revision);
                const template = document.createElement("template");
                template.innerHTML = operation.data.blockDOM;
                check.equal(template.content.children.length, 1);
                check.equal(template.content.firstElementChild.getAttribute("data-type"), "NodeParagraph");
                check.equal(template.content.querySelectorAll("[data-type^=Node]").length, 1);
                saved.push(operation.data.blockDOM);
                revision = `r${saved.length}`;
                return {code: 0, data: [{doOperations: [{action: "setDocTitle", id: "document", retData: revision}]}]};
            },
        };
        const Editor = new Function(...Object.keys(dependencies), sources[3] + "\nreturn DocumentTitleEditor;")(
            ...Object.values(dependencies));
        const owner = {element: document.createElement("div"), block: {rootID: "document"}, undo: {add: () => {}}, disabled: false};
        const editor = new Editor(owner, host, {blockDOM: paragraph(), revision}, () => {}, () => {});
        const editable = editor.editable as HTMLElement;
        const block = editable.parentElement;
        const assertHost = () => {
            check.equal(wysiwyg.isContentEditable, ipad ? false : outerEditable, platform);
            check.equal(block.isContentEditable, ipad ? false : outerEditable, platform);
            check.equal(editable.isContentEditable, true);
        };
        assertHost();
        const stopClick = (event: Event) => event.stopPropagation();
        editable.addEventListener("click", stopClick);
        editable.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        check.equal(menuDismissals, 1, "clicks inside the title dismiss menus even when inline handlers stop bubbling");
        editable.removeEventListener("click", stopClick);
        if (!ipad) {
            editor.destroy(); host.remove();
            continue;
        }
        editor.focus();
        check.equal(document.activeElement, editable, "programmatic title focus targets the inner editing host");
        const select = (start: number, end = start) => {
            editable.focus();
            const range = document.createRange();
            range.setStart(editable.firstChild || editable, start);
            range.setEnd(editable.firstChild || editable, end);
            getSelection().removeAllRanges(); getSelection().addRange(range);
        };
        const native = (command: string, text = "") => {
            check.equal(document.execCommand(command, false, text), true, command);
            check.equal(closestBlock(getSelection().anchorNode), block, "native selection stays in an identifiable title block");
            check.equal(editor.editable, editable, "native edits preserve the carrier node");
        };
        const compositionEvent = (type: string, text = "") =>
            editable.dispatchEvent(new CompositionEvent(type, {data: text, bubbles: true}));
        const inputEvent = (type: string, text: string | null) => {
            const event = new InputEvent("beforeinput", {inputType: type, data: text, isComposing: true,
                bubbles: true, cancelable: true});
            editable.dispatchEvent(event);
            check.equal(event.defaultPrevented, false, "title listeners leave composition to the native editing host");
        };
        const compose = (type: string, command: string, text: string | null) => {
            inputEvent(type, text);
            replayingComposition = true;
            try {
                native(command, text || "");
            } finally {
                replayingComposition = false;
            }
            editable.dispatchEvent(new InputEvent("input", {inputType: type, data: text, isComposing: true, bubbles: true}));
            check.equal(editor.composing, true, "candidate deletion and reinsertion cannot finish composition early");
        };
        // 显式模拟日志中的提交顺序；原生编辑命令仅验证 Chromium 的宿主边界，不代表 iPad 输入法复现。
        select(0);
        compositionEvent("compositionstart");
        compose("insertCompositionText", "insertText", "中文");
        select(0, 2);
        compose("deleteCompositionText", "delete", null);
        check.equal(editable.textContent, "");
        compose("insertFromComposition", "insertText", "中文");
        check.equal(saved.length, 0);
        compositionEvent("compositionend", "中文");
        await editor.flush();
        check.equal(lute.BlockDOM2Content(saved.at(-1)).trim(), "中文");
        select(2);
        compositionEvent("compositionstart");
        compose("insertCompositionText", "insertText", "标题测试");
        compositionEvent("compositionend", "标题测试");
        await editor.flush();
        check.equal(lute.BlockDOM2Content(saved.at(-1)).trim(), "中文标题测试");
        select(2, 4);
        editor.focus();
        check.equal(getSelection().toString(), "标题");
        check.equal(closestBlock(getSelection().focusNode), block, "copy can resolve the selected title block");
        native("insertText", "选区");
        changed(); await editor.flush();
        check.equal(lute.BlockDOM2Content(saved.at(-1)).trim(), "中文选区测试");
        select(0, 6);
        native("delete");
        changed(); await editor.flush();
        check.equal(lute.BlockDOM2Content(saved.at(-1)).trim(), "");
        const count = saved.length;
        compositionEvent("compositionstart");
        compose("insertCompositionText", "insertText", "候选");
        select(0, 2); compose("deleteCompositionText", "delete", null);
        compositionEvent("compositionend");
        await editor.flush();
        check.equal(saved.length, count, "cancelled composition leaves the empty saved title unchanged");
        const pasted = dom.flattenDocumentTitlePaste(paragraph('<span data-type="strong">中文</span>标题测试'), "", true);
        const template = document.createElement("template");
        template.innerHTML = pasted;
        native("insertHTML", template.content.querySelector("[contenteditable]").innerHTML);
        changed(); await editor.flush();
        check.equal(lute.BlockDOM2Content(saved.at(-1)).trim(), "中文标题测试");
        check.ok(saved.at(-1).includes('data-type="strong"'), "rich paste retains formatting in the save payload");
        const html = wysiwyg.innerHTML;
        owner.disabled = true; editor.setReadonly(true);
        check.equal(editable.isContentEditable, false);
        await editor.flush();
        owner.disabled = false; editor.setReadonly(false);
        assertHost();
        check.equal(wysiwyg.innerHTML, html, "readonly cycling retains the complete source");
        await editor.flush();
        check.equal(saved.length, count + 1, "readonly cycling does not create a save");
        editor.destroy(); host.remove();
    }
    return "Title editing host cases passed";
};

test("iPad titles bound native edits to their paragraph across composition, save and readonly transitions", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !process.env.SIYUAN_ELECTRON_HEADLESS,
    timeout: 30000,
}, async () => {
    const sources = ["../util/longTextWrap.ts", "../util/inlineElementBoundary.ts", "documentTitleDOM.ts",
        "documentTitleEditor.ts", "../util/disabledWYSIWYG.ts", "../util/hasClosest.ts", "../wysiwyg/compositionInput.ts"]
        .map(file => transpileModule(readFileSync(join(__dirname, file), "utf8")
            .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText);
    const temporary = mkdtempSync(join(tmpdir(), "siyuan-title-ime-"));
    const script = join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(sources) + "," +
        JSON.stringify(resolve(__dirname, "../../../stage/protyle/js/lute/lute.min.js")) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, webPreferences:{nodeIntegration:true, contextIsolation:false}});
    try {
        await win.loadURL("data:text/html,<body></body>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const args = process.env.SIYUAN_ELECTRON_HEADLESS ? ["--ozone-platform=headless", script] : [script];
        const result = await promisify(execFile)(require("electron") as unknown as string, args,
            {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /Title editing host cases passed/);
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
