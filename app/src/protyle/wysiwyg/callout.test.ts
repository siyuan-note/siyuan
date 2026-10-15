import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: string[], luteSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    new Function(luteSource)();
    const lute = Lute.New();
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    lute.SetCallout(true);
    Object.assign(window, {siyuan: {languages: {callout: "Callout", custom: "Custom", type: "Type"}}});
    const root = document.createElement("div");
    root.dataset.nodeId = "document";
    document.body.append(root);
    const protyle = {lute, wysiwyg: {element: root}, block: {showAll: false}, disabled: false} as unknown as IProtyle;
    let transactions: Array<{doOperations: IOperation[], undoOperations: IOperation[]}> = [];
    let inputOptions: Parameters<typeof import("../../dialog/inputDialog").openInputDialog>[0];
    let destroyed = false;
    const dialog = {destroy: () => {
        destroyed = true;
        inputOptions.destroyCallback?.();
    }} as Parameters<typeof inputOptions.onConfirm>[1];
    const identity = (html: string) => html;
    const dependencies = {
        Constants: {ATTRIBUTE_EDITING: "data-editing"},
        transaction: (_protyle: IProtyle, doOperations: IOperation[], undoOperations: IOperation[]) => {
            transactions.push({doOperations, undoOperations});
        },
        getContenteditableElement: (element: Element) => element.querySelector('[contenteditable="true"]'),
        isListMindmapListConversion: () => false,
        getPreviousBlockSibling: (element: Element) => element.previousElementSibling,
        getEmbedChildOperationParentID: (): undefined => undefined,
        getParentBlock: (element: Element) => element.parentElement,
        isTabsListConversion: () => false,
        convertListMindmapToList: (): undefined => undefined,
        cleanListMindmapHTML: identity,
        cleanHeadingNumberHTML: identity,
        cleanTableCellRichHTML: identity,
        cleanBlockSelectionModeHTML: identity,
        disposeCustomBlocksInElement: () => {},
        focusByWbr: () => root.querySelector("wbr")?.remove(),
        getEditorRange: () => document.createRange(),
        blockRender: () => {}, processRender: () => {}, highlightRender: () => {}, avRender: () => {},
        openInputDialog: (options: typeof inputOptions) => {
            inputOptions = options;
            destroyed = false;
            return dialog;
        },
        focusByRange: () => {},
    };
    const conversions = new Function(...Object.keys(dependencies), sources[0] + "\nreturn {turnsOneInto};")(
        ...Object.values(dependencies));
    const presets = {} as typeof import("./calloutType");
    new Function("exports", sources[1])(presets);
    const callouts = {} as typeof import("./callout");
    new Function("exports", "require", sources[2])(callouts, () => ({...dependencies, ...conversions, ...presets}));
    const menu = new Function("CALLOUT_PRESETS", "updateCalloutType", "updateCustomCalloutType",
        sources[3] + "\nreturn new CalloutMenu();")(presets.CALLOUT_PRESETS,
        callouts.updateCalloutType, callouts.updateCustomCalloutType) as {
        calloutTypeMenus: (protyle: IProtyle, elements: HTMLElement[]) => IMenu[];
    };
    const menus = () => menu.calloutTypeMenus(protyle, [root.firstElementChild as HTMLElement]);
    const setup = (markdown = "> # heading\n>\n> alpha\n>\n> - item\n>\n> > inner quote\n") => {
        transactions = [];
        protyle.disabled = false;
        root.innerHTML = lute.Md2BlockDOM(markdown);
        const block = root.firstElementChild as HTMLElement;
        block.setAttribute("custom-test", "kept");
        block.setAttribute("name", "sample");
        block.setAttribute("fold", "1");
        return block;
    };
    const ids = (element: Element) => [element, ...element.querySelectorAll("[data-node-id]")]
        .map(item => item.getAttribute("data-node-id"));
    const update = (operation: IOperation) => {
        check.equal(operation.action, "update");
        root.innerHTML = operation.data as string;
        root.querySelectorAll("wbr").forEach(item => item.remove());
        return root.firstElementChild as HTMLElement;
    };

    // 每种预设都直接转换引述块，内容和属性在一次撤销、重做后仍完整。
    for (const preset of presets.CALLOUT_PRESETS) {
        const source = setup();
        const originalIDs = ids(source);
        const originalHTML = source.outerHTML;
        const items = menus();
        check.deepEqual(items.map(item => item.id), [...presets.CALLOUT_PRESETS.map(item => item.id), "calloutCustom"]);
        check.ok(items.every(item => !item.current));
        items.find(item => item.id === preset.id).click(null, null);
        await Promise.resolve();
        const converted = root.firstElementChild as HTMLElement;
        check.equal(converted.dataset.type, "NodeCallout");
        check.equal(converted.dataset.subtype, preset.type);
        check.equal(converted.querySelector(".callout-title").textContent, preset.title);
        check.equal(converted.querySelector(".callout-icon").textContent, preset.icon);
        check.deepEqual(ids(converted), originalIDs);
        check.equal(converted.getAttribute("custom-test"), "kept");
        check.equal(converted.getAttribute("name"), "sample");
        check.equal(converted.getAttribute("fold"), "1");
        check.match(converted.textContent, /heading.*alpha.*item.*inner quote/s);
        check.equal(transactions.length, 1);
        const {doOperations, undoOperations} = transactions[0];
        check.equal(doOperations.length, 1);
        check.equal(undoOperations.length, 1);
        check.equal(doOperations[0].id, originalIDs[0]);
        check.equal(undoOperations[0].id, originalIDs[0]);
        const restored = update(undoOperations[0]);
        restored.querySelector("wbr")?.remove();
        check.equal(restored.outerHTML, originalHTML);
        check.equal(update(doOperations[0]).outerHTML, converted.outerHTML.replace(' data-editing="true"', ""));
    }

    // 自定义输入确认前不修改原块，空值和取消也不产生事务。
    const source = setup();
    const originalHTML = source.outerHTML;
    menus().find(item => item.id === "calloutCustom").click(null, null);
    check.equal(inputOptions.value, "");
    inputOptions.onConfirm("   ", dialog);
    check.equal(destroyed, false);
    check.equal(root.firstElementChild, source);
    check.equal(source.outerHTML, originalHTML);
    check.equal(transactions.length, 0);
    dialog.destroy();
    check.equal(root.firstElementChild, source);
    check.equal(source.outerHTML, originalHTML);
    menus().find(item => item.id === "calloutCustom").click(null, null);
    const customType = 'CUSTOM <type> " &';
    inputOptions.onConfirm(`  ${customType}  `, dialog);
    await Promise.resolve();
    check.equal(destroyed, true);
    check.equal((root.firstElementChild as HTMLElement).dataset.subtype, customType);
    check.equal(root.querySelector(".callout-title").textContent, "Note");
    check.equal(transactions.length, 1);
    check.equal((update(transactions[0].undoOperations[0])).dataset.type, "NodeBlockquote");

    // 弹窗期间原块被移除或编辑器变为只读时不再执行转换。
    for (const stale of ["removed", "disabled"]) {
        const block = setup();
        menus().find(item => item.id === "calloutCustom").click(null, null);
        if (stale === "removed") {
            block.remove();
        } else {
            protyle.disabled = true;
        }
        inputOptions.onConfirm("CUSTOM", dialog);
        await Promise.resolve();
        check.equal(transactions.length, 0);
        check.equal(block.dataset.type, "NodeBlockquote");
    }

    // 已有提示块仍保留用户自定义的标题，自定义类型也保留现有图标。
    setup("> [!TIP] My title\n> content\n");
    check.equal(menus().find(item => item.id === "calloutTip").current, true);
    menus().find(item => item.id === "calloutWarning").click(null, null);
    check.equal(root.querySelector(".callout-title").textContent, "My title");
    const icon = root.querySelector(".callout-icon").textContent;
    menus().find(item => item.id === "calloutCustom").click(null, null);
    check.equal(inputOptions.value, "WARNING");
    inputOptions.onConfirm("CUSTOM", dialog);
    check.equal(root.querySelector(".callout-title").textContent, "My title");
    check.equal(root.querySelector(".callout-icon").textContent, icon);
    check.equal((root.firstElementChild as HTMLElement).dataset.subtype, "CUSTOM");
    return "Callout conversion cases passed";
};

test("shared block menus convert blockquotes to callout types in a single undoable transaction", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = createSourceFile("transaction.ts", readFileSync(path.join(__dirname, "transaction.ts"), "utf8"),
        ScriptTarget.ES2021, true);
    const conversionSource = source.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => ["turnsOneInto", "updateTransaction"].includes(item.name.getText(source))))
        .map(statement => statement.getText(source).replace(/^export /, "")).join("\n");
    const gutter = createSourceFile("index.ts", readFileSync(path.join(__dirname, "../gutter/index.ts"), "utf8"),
        ScriptTarget.ES2021, true);
    const menuSource = gutter.statements.filter(isClassDeclaration).find(item => item.name?.text === "Gutter")
        .members.find(item => item.name?.getText(gutter) === "calloutTypeMenus").getText(gutter);
    const sources = [conversionSource, readFileSync(path.join(__dirname, "calloutType.ts"), "utf8"),
        readFileSync(path.join(__dirname, "callout.ts"), "utf8"), `class CalloutMenu { ${menuSource} }`]
        .map(text => transpileModule(text, {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText);
    const luteSource = readFileSync("stage/protyle/js/lute/lute.min.js", "utf8");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-callout-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "(async () => { try { const __name = value => value; return await (" + browserCases.toString() + ")(" +
        JSON.stringify(sources) + "," + JSON.stringify(luteSource) + "); } catch (error) { return error.stack; } })()";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 40000});
        assert.match(result.stdout, /Callout conversion cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-callout-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
