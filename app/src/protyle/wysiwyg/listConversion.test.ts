import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, isMethodDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import type {Node} from "typescript";

const browserCases = async (source: string, menuSource: string, rangeSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const lute = Lute.New();
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    lute.SetDataTask(true);
    const editor = document.createElement("div");
    document.body.append(editor);
    const batches: Array<{doOperations: IOperation[], undoOperations: IOperation[]}> = [];
    const noop = (): void => undefined;
    const dependencies = {
        Constants: {ATTRIBUTE_EDITING: "data-editing", ZWSP: "\u200b"},
        transaction: (_protyle: IProtyle, doOperations: IOperation[], undoOperations: IOperation[]) => batches.push({doOperations, undoOperations}),
        hideElements: () => editor.querySelectorAll(".protyle-wysiwyg--select").forEach(item => item.classList.remove("protyle-wysiwyg--select")),
        processRender: noop, highlightRender: noop, avRender: noop, blockRender: noop,
        disposeCustomBlocksInElement: noop, focusBlock: noop, focusByWbr: noop, onTransaction: noop,
        unfoldListHeadings: async (): Promise<IOperation[]> => [],
        getPreviousBlockSibling: (element: Element) => element.previousElementSibling,
        getParentBlock: (element: Element) => element.parentElement,
        getEmbedChildOperationParentID: (): undefined => undefined,
        getContenteditableElement: (element: Element) => element.querySelector('[contenteditable="true"]'),
        getEditorRange: () => document.createRange(),
        hasViewFoldContext: () => false,
    };
    const api = new Function(...Object.keys(dependencies), source +
        "\nreturn {turnsIntoTransaction, turnListsRecursively, removeListStructure, getHeadingConversionElements, isListHeadingContainer};")(...Object.values(dependencies)) as
        typeof import("./transaction") & typeof import("./headingConversion");
    const protyle = {wysiwyg: {element: editor}, lute, block: {rootID: "document", parentID: "document"},
        observerLoad: {disconnect: noop}} as unknown as IProtyle;
    const Gutter = new Function("turnsIntoTransaction", "getHeadingConversionElements", "removeListStructure", menuSource + "\nreturn Gutter;")(
        api.turnsIntoTransaction, api.getHeadingConversionElements, api.removeListStructure);
    const gutter = new Gutter() as {
        headingTurnIntoMenu: (protyle: IProtyle, elements: Element[], includeParagraph?: boolean) => Array<{id: string, click: () => Promise<void>}>,
        listTurnIntoMenu: (protyle: IProtyle, elements: Element[]) => Array<{id: string, click: () => Promise<void>}>,
    };
    window.siyuan = {languages: {}, config: {keymap: {editor: {heading: {paragraph: {custom: "Alt+Ctrl+0"}}}}}} as typeof window.siyuan;
    for (let level = 1; level <= 6; level++) {
        window.siyuan.languages[`heading${level}`] = `Heading ${level}`;
        window.siyuan.config.keymap.editor.heading[`heading${level}`] = {custom: `Alt+Ctrl+${level}`};
    }
    const id = (element: Element) => element.getAttribute("data-node-id");
    const items = (list: Element) => Array.from(list.children).filter(child => child.getAttribute("data-type") === "NodeListItem");
    const first = (item: Element) => Array.from(item.children).find(child => child.hasAttribute("data-node-id"));
    const clean = (html: string) => html.replace(/<wbr>/g, "");
    const shape = (html: string) => {
        const template = document.createElement("template");
        template.innerHTML = html;
        return Array.from(template.content.querySelectorAll("[data-node-id]")).map(block => ({
            id: id(block), type: block.getAttribute("data-type"), subtype: block.getAttribute("data-subtype"),
            parent: block.parentElement?.getAttribute("data-node-id"), marker: block.getAttribute("data-marker"),
            task: block.getAttribute("data-task"),
            avs: block.getAttribute("custom-avs"), field: block.getAttribute("custom-av-database-field"),
            text: block.querySelector(':scope > [contenteditable="true"]')?.textContent,
        }));
    };
    const replay = (operations: IOperation[]) => operations.forEach(operation => {
        let node = editor.querySelector(`[data-node-id="${operation.id}"]`);
        if (operation.action === "delete") {
            check.equal(node.querySelectorAll("[custom-avs]").length, 0, "only delete empty wrappers");
            node.remove();
            return;
        }
        if (operation.action === "update") {
            check.ok(node);
            node.outerHTML = operation.data as string;
            return;
        }
        const oldParent = node?.parentElement;
        if (operation.action === "insert") {
            const template = document.createElement("template");
            template.innerHTML = operation.data as string;
            node = template.content.firstElementChild;
            check.equal(node.querySelectorAll("[custom-avs]").length, 0, "never insert bound content");
        } else {
            check.equal(operation.action, "move");
        }
        if (operation.previousID) {
            const previous = editor.querySelector(`[data-node-id="${operation.previousID}"]`);
            check.ok(previous, operation.previousID);
            previous.after(node);
        } else {
            const parent = operation.parentID === "document" ? editor : editor.querySelector(`[data-node-id="${operation.parentID}"]`);
            check.ok(parent, operation.parentID);
            const firstBlock = Array.from(parent.children).find(child => child.hasAttribute("data-node-id"));
            if (firstBlock) {
                firstBlock.before(node);
            } else if (parent.lastElementChild?.classList.contains("protyle-attr")) {
                parent.lastElementChild.before(node);
            } else {
                parent.append(node);
            }
        }
        if (oldParent?.getAttribute("data-type") === "NodeList" && items(oldParent).length === 0) {
            oldParent.remove();
        }
    });
    const fixtures: unknown[] = [];
    for (const marker of ["-", "3.", "- [x]"]) {
        for (const mask of [1, 2, 4, 3, 5, 6, 7]) {
            for (let level = -1; level <= 6; level++) {
                editor.innerHTML = lute.Md2BlockDOM(`${marker} **one**\n\n    tail\n\n    - nested\n\n${marker} two\n\n${marker} three`);
                const list = editor.firstElementChild;
                const listItems = items(list);
                const targets = listItems.map(first);
                targets.forEach(target => {
                    target.setAttribute("custom-avs", "database");
                    target.setAttribute("custom-av-database-field", "retained");
                    if (level <= 0) {
                        // 取消列表保留标题，段落转换移除标题格式。
                        // @ts-expect-error Lute 声明尚未包含 Blocks2Hs。
                        const html = lute.Blocks2Hs(target.outerHTML, "2");
                        target.outerHTML = html;
                    }
                });
                const targetIDs = listItems.map(item => id(first(item)));
                const selection = mask === 7 ? [list] : listItems.filter((_item, index) => mask & (1 << index));
                const before = editor.innerHTML;
                batches.length = 0;
                const menu = gutter.listTurnIntoMenu(protyle, selection);
                check.deepEqual(menu.map(item => item.id), ["paragraph", "removeList", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6"]);
                await menu.find(item => item.id === (level === -1 ? "removeList" : level ? `heading${level}` : "paragraph")).click();
                check.equal(batches.length, 1);
                const after = editor.innerHTML;
                targetIDs.forEach((targetID, index) => {
                    const block = editor.querySelector(`[data-node-id="${targetID}"]`);
                    check.equal(block.getAttribute("custom-avs"), "database");
                    check.equal(block.getAttribute("custom-av-database-field"), "retained");
                    if (mask & (1 << index)) {
                        check.equal(block.parentElement, editor);
                        check.equal(block.getAttribute("data-type"), level ? "NodeHeading" : "NodeParagraph");
                        if (level) {
                            check.equal(block.getAttribute("data-subtype"), `h${level === -1 ? 2 : level}`);
                        }
                    } else {
                        check.equal(id(block.parentElement), id(listItems[index]));
                    }
                });
                const order = Array.from(editor.querySelectorAll("[data-node-id]")).map(id).filter(value => targetIDs.includes(value));
                check.deepEqual(order, targetIDs);
                for (let cycle = 0; cycle < 2; cycle++) {
                    replay(batches[0].undoOperations);
                    check.deepEqual(shape(clean(editor.innerHTML)), shape(before));
                    replay(batches[0].doOperations);
                    check.deepEqual(shape(clean(editor.innerHTML)), shape(clean(after)));
                }
                if (level === -1) {
                    const contentIDs = shape(before).filter(block => !["NodeList", "NodeListItem"].includes(block.type)).map(block => block.id);
                    check.ok(batches[0].doOperations.every(operation => operation.action !== "update" || !contentIDs.includes(operation.id)));
                }
                if (mask === ({"-": 7, "3.": 2, "- [x]": 5}[marker]) && [-1, 0, 3].includes(level)) {
                    fixtures.push({before, after: clean(after), targetIDs, ...batches[0], ...(level === -1 ? {removeList: true} : {})});
                }
            }
        }
    }
    // 快捷键的块选择与跨块文本选择都使用相同的转换入口。
    for (const type of ["Blocks2Hs", "Blocks2Ps"] as TTurnInto[]) {
        editor.innerHTML = lute.Md2BlockDOM("- # one\n- # two");
        const selected = [editor.firstElementChild];
        const event = new KeyboardEvent("keydown", {cancelable: true});
        const rangeDependencies = {
            isCrossBlock: true, selectText: "one two", range: document.createRange(), getBlockElementsByRange: () => selected,
            getUndoFocusContext: noop, restoreFocusContext: noop, turnsIntoTransaction: api.turnsIntoTransaction,
            isListHeadingContainer: api.isListHeadingContainer, protyle, event,
        };
        const convertRange = new Function(...Object.keys(rangeDependencies), rangeSource + "\nreturn turnCrossBlockRangeInto;")(...Object.values(rangeDependencies));
        check.equal(convertRange(type, 4), true);
        await new Promise(resolve => setTimeout(resolve, 0));
        check.equal(editor.querySelector('[data-type="NodeList"]'), null);
        check.equal(event.defaultPrevented, true);
    }
    editor.innerHTML = lute.Md2BlockDOM("- one\n- two");
    const selectedList = editor.firstElementChild;
    selectedList.classList.add("protyle-wysiwyg--select");
    await api.turnsIntoTransaction({protyle, nodeElement: first(items(selectedList)[0]), type: "Blocks2Hs", level: 1});
    check.equal(editor.querySelector('[data-type="NodeList"]'), null);
    check.equal(editor.querySelectorAll('[data-type="NodeHeading"]').length, 2);
    for (const scenario of ["nested", "multiple", "recursive", "invalid", "mixed"]) {
        editor.innerHTML = lute.Md2BlockDOM("- # outer\n\n    - ## inner\n\n        1. different\n\n- # last");
        if (scenario === "multiple" || scenario === "mixed") {
            editor.insertAdjacentHTML("beforeend", lute.Md2BlockDOM(scenario === "mixed" ? "# Outside" : "1. # Another"));
        }
        let selection = [editor.firstElementChild];
        if (scenario === "nested") {
            selection = [editor.querySelector('[data-type="NodeList"] [data-type="NodeList"]')];
        } else if (scenario === "multiple" || scenario === "mixed") {
            selection = Array.from(editor.children);
        } else if (scenario === "invalid") {
            first(items(selection[0])[0]).setAttribute("data-type", "NodeCodeBlock");
        }
        const boundTargets = Array.from(editor.querySelectorAll('[data-type="NodeHeading"], [data-type="NodeParagraph"]')).slice(0, 3);
        boundTargets.forEach(target => target.setAttribute("custom-avs", "database"));
        const before = editor.innerHTML;
        batches.length = 0;
        if (scenario === "recursive") {
            await api.turnListsRecursively({protyle, nodeElements: selection, type: "CancelListRecursively"});
            check.equal(editor.querySelector('[data-type="NodeHeading"]'), null);
            check.equal(editor.querySelectorAll('[data-type="NodeList"]').length, 1);
        } else {
            await api.turnsIntoTransaction({protyle, selectsElement: selection, type: "Blocks2Ps"});
        }
        const after = editor.innerHTML;
        check.equal(batches.length, 1);
        replay(batches[0].undoOperations);
        check.deepEqual(shape(clean(editor.innerHTML)), shape(before), scenario);
        replay(batches[0].doOperations);
        check.deepEqual(shape(clean(editor.innerHTML)), shape(clean(after)), scenario);
        if (scenario === "recursive" || scenario === "nested") {
            fixtures.push({before, after: clean(after), targetIDs: boundTargets.map(id), ...batches[0]});
        }
    }
    // 取消列表不要求首块为段落或标题，并支持多列表、嵌套选择去重及混合选区。
    for (const scenario of ["code", "nested", "overlap", "multiple", "mixed"]) {
        editor.innerHTML = lute.Md2BlockDOM("- # outer\n\n    - ## inner\n\n- # last");
        const list = editor.firstElementChild;
        const nested = list.querySelector('[data-type="NodeList"]');
        let selection = [list];
        if (scenario === "code") {
            items(list).forEach(item => {
                const block = first(item);
                const code = document.createElement("div");
                code.innerHTML = lute.Md2BlockDOM("```js\nconst value = 1;\n```");
                code.firstElementChild.setAttribute("data-node-id", id(block));
                block.replaceWith(code.firstElementChild);
            });
            check.deepEqual(gutter.listTurnIntoMenu(protyle, selection).map(item => item.id), ["removeList"]);
        } else if (scenario === "nested") {
            selection = [nested];
        } else if (scenario === "overlap") {
            selection = [list, items(list)[0], nested];
        } else {
            editor.insertAdjacentHTML("beforeend", lute.Md2BlockDOM(scenario === "mixed" ? "# outside" : "1. # another"));
            selection = Array.from(editor.children);
        }
        const before = editor.innerHTML;
        const content = shape(before).filter(block => !["NodeList", "NodeListItem"].includes(block.type));
        batches.length = 0;
        await gutter.listTurnIntoMenu(protyle, selection).find(item => item.id === "removeList").click();
        const after = editor.innerHTML;
        check.equal(batches.length, 1);
        const withoutParent = (block: ReturnType<typeof shape>[number]): ReturnType<typeof shape>[number] => ({...block, parent: undefined});
        check.deepEqual(shape(after).filter(block => content.some(original => original.id === block.id)).map(withoutParent), content.map(withoutParent));
        if (scenario !== "nested") {
            check.ok(editor.querySelector(`[data-node-id="${id(nested)}"]`), "keep nested lists");
        }
        replay(batches[0].undoOperations);
        check.deepEqual(shape(clean(editor.innerHTML)), shape(before), scenario);
        replay(batches[0].doOperations);
        check.deepEqual(shape(clean(editor.innerHTML)), shape(clean(after)), scenario);
    }
    editor.remove();
    return {message: "List conversion cases passed", fixtures};
};

test("list conversion removes selected wrappers and preserves content, database attributes and undo", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 60000,
}, async () => {
    const read = (file: string) => readFileSync(path.join(__dirname, file), "utf8");
    const compile = (source: string) => transpileModule(source.replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const extract = (file: string, name: string) => {
        const parsed = createSourceFile(file, read(file), ScriptTarget.Latest, true);
        let result: string;
        const visit = (node: Node) => {
            if (isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(parsed) === name)) {
                result = node.getText(parsed);
                return;
            }
            node.forEachChild(visit);
        };
        visit(parsed);
        assert.ok(result, name);
        return result;
    };
    const source = compile(read("headingConversion.ts") + "\n" + read("listConversion.ts") + "\n" +
        extract("transaction.ts", "turnsIntoTransaction") + "\n" + extract("transaction.ts", "turnListBlocksInto") +
        "\n" + extract("transaction.ts", "turnListsRecursively") + "\n" + extract("transaction.ts", "removeListStructure"));
    const rangeSource = compile(extract("keydown.ts", "turnCrossBlockRangeInto"));
    const parsed = createSourceFile("gutter.ts", read("../gutter/index.ts"), ScriptTarget.Latest, true);
    const gutter = parsed.statements.find(isClassDeclaration);
    const methods = gutter.members.filter(member => isMethodDeclaration(member) &&
        ["headingTurnIntoMenu", "listTurnIntoMenu", "removeListMenu", "turnsInto"].includes(member.name.getText(parsed)));
    const menuSource = compile("class Gutter {\n" + methods.map(member => member.getText(parsed)).join("\n") + "\n}");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-list-conversion-"));
    const script = path.join(temporary, "run.cjs");
    const resultPath = path.join(temporary, "result.json");
    const lutePath = path.resolve(__dirname, "../../../stage/protyle/js/lute/lute.min.js");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lutePath)}, "utf8"));
        const result = await win.webContents.executeJavaScript(${JSON.stringify("(async () => { try { const __name = value => value; return {value: await (" + browserCases.toString() + ")(" + [source, menuSource, rangeSource].map(value => JSON.stringify(value)).join(",") + ")}; } catch (error) { return {error: error.stack}; } })()")} );
        if (result.error) { throw new Error(result.error); }
        require("node:fs").writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result.value));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        await promisify(execFile)(require("electron") as unknown as string, [script], {env, timeout: 55000, windowsHide: true});
        const result = JSON.parse(readFileSync(resultPath, "utf8"));
        assert.equal(result.message, "List conversion cases passed");
        if (process.env.SIYUAN_UPDATE_LIST_CONVERSION_FIXTURE === "1") {
            writeFileSync(path.resolve(__dirname, "../../../../kernel/model/testdata/list_conversion.json"), JSON.stringify(result.fixtures, null, 2) + "\n");
        } else if (process.env.SIYUAN_UPDATE_LIST_CONVERSION_FIXTURE === "removeList") {
            const fixturePath = path.resolve(__dirname, "../../../../kernel/model/testdata/list_conversion.json");
            const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")).filter((fixture: {removeList?: boolean}) => !fixture.removeList);
            fixtures.push(...result.fixtures.filter((fixture: {removeList?: boolean}) => fixture.removeList));
            writeFileSync(fixturePath, JSON.stringify(fixtures, null, 2) + "\n");
        }
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-list-conversion-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
