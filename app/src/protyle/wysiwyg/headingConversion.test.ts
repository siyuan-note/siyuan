import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, isMethodDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import type {Node} from "typescript";

const browserCases = (source: string, menuSource: string, rangeSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const lute = Lute.New();
    const editor = document.createElement("div");
    document.body.append(editor);
    const batches: Array<{doOperations: IOperation[], undoOperations: IOperation[]}> = [];
    let disconnects = 0;
    const noop = (): void => undefined;
    const dependencies = {
        Constants: {ATTRIBUTE_EDITING: "data-editing", ZWSP: "\u200b"},
        transaction: (_protyle: IProtyle, doOperations: IOperation[], undoOperations: IOperation[]) => {
            batches.push({doOperations, undoOperations});
        },
        hideElements: (panels: string[]) => {
            if (panels.includes("select")) {
                editor.querySelectorAll(".protyle-wysiwyg--select, .protyle-wysiwyg--select-mode").forEach(item => {
                    item.classList.remove("protyle-wysiwyg--select", "protyle-wysiwyg--select-mode");
                    item.removeAttribute("select-start");
                    item.removeAttribute("select-end");
                });
            }
        },
        processRender: noop,
        highlightRender: noop,
        avRender: noop,
        blockRender: noop,
        disposeCustomBlocksInElement: noop,
        focusBlock: noop,
        focusByRange: (range: Range) => {
            getSelection().removeAllRanges();
            getSelection().addRange(range);
        },
        getSemanticMarkerPrefixLengthForNode: () => 0,
        hasPreviousSibling: (element: Element) => element.previousSibling,
        setFold: () => check.fail("List folding must not unfold unrelated content"),
    };
    const api = new Function(...Object.keys(dependencies), source +
        "\nreturn {turnsIntoTransaction, getHeadingConversionElements, isListHeadingContainer};")(...Object.values(dependencies)) as
        typeof import("./transaction") & typeof import("./headingConversion");
    const protyle = {wysiwyg: {element: editor}, lute, observerLoad: {disconnect: () => disconnects++}} as unknown as IProtyle;
    const Gutter = new Function("turnsIntoTransaction", "getHeadingConversionElements", menuSource + "\nreturn Gutter;")(
        api.turnsIntoTransaction, api.getHeadingConversionElements);
    const gutter = new Gutter() as {
        headingTurnIntoMenu: (protyle: IProtyle, elements: Element[]) => Array<{id: string, click: () => void}>,
    };
    window.siyuan = {languages: {}, config: {keymap: {editor: {heading: {}}}}} as typeof window.siyuan;
    for (let level = 1; level <= 6; level++) {
        window.siyuan.languages[`heading${level}`] = `Heading ${level}`;
        window.siyuan.config.keymap.editor.heading[`heading${level}`] = {custom: `Alt+Ctrl+${level}`};
    }
    const reset = (subtype = "u") => {
        const marker = {u: "-", o: "1.", t: "- [x]"}[subtype];
        editor.innerHTML = lute.Md2BlockDOM(`${marker} **one**\n\n    tail\n\n    - nested\n\n${marker} two\n\n${marker} three`);
        batches.length = 0;
        return editor.querySelector('[data-type="NodeList"]');
    };
    const items = (list: Element) => Array.from(list.querySelectorAll(':scope > [data-type="NodeListItem"]'));
    const first = (item: Element) => item.querySelector(":scope > [data-node-id]");
    const id = (element: Element) => element.getAttribute("data-node-id");
    const cleanHTML = () => {
        const clone = editor.cloneNode(true) as Element;
        clone.querySelectorAll("[data-editing]").forEach(item => item.removeAttribute("data-editing"));
        clone.querySelectorAll("wbr").forEach(item => item.remove());
        return clone.innerHTML;
    };
    const replay = (operations: IOperation[]) => {
        operations.forEach(operation => {
            check.equal(operation.action, "update");
            editor.querySelector(`[data-node-id="${operation.id}"]`).outerHTML = operation.data as string;
        });
    };
    const setCaret = (element: Element) => {
        const range = document.createRange();
        range.selectNodeContents(element.querySelector('[contenteditable="true"]'));
        range.collapse(true);
        dependencies.focusByRange(range);
    };

    for (const subtype of ["u", "o", "t"]) {
        for (let level = 1; level <= 6; level++) {
            const list = reset(subtype);
            const listItems = items(list);
            listItems[0].setAttribute("fold", "1");
            listItems[0].setAttribute("data-task", "x");
            const targets = listItems.map(first);
            targets[0].setAttribute("custom-test", "retained");
            const targetIDs = targets.map(id);
            const before = cleanHTML();
            const nested = listItems[0].querySelector('[data-type="NodeList"]').outerHTML;
            const tail = listItems[0].querySelectorAll(':scope > [data-type="NodeParagraph"]')[1].outerHTML;
            const menu = gutter.headingTurnIntoMenu(protyle, [list]);
            check.deepEqual(menu.map(item => item.id), [1, 2, 3, 4, 5, 6].map(value => `heading${value}`));
            menu[level - 1].click();
            check.equal(batches.length, 1);
            check.deepEqual(batches[0].doOperations.map(operation => operation.id), targetIDs);
            listItems.forEach(item => check.equal(first(item).getAttribute("data-subtype"), `h${level}`));
            check.equal(first(listItems[0]).getAttribute("custom-test"), "retained");
            check.ok(first(listItems[0]).querySelector('[data-type="strong"]'));
            check.equal(listItems[0].getAttribute("fold"), "1");
            check.equal(listItems[0].getAttribute("data-task"), "x");
            check.equal(listItems[0].querySelector('[data-type="NodeList"]').outerHTML, nested);
            check.equal(listItems[0].querySelector(':scope > [data-type="NodeParagraph"]').outerHTML, tail);
            const after = cleanHTML();
            replay(batches[0].undoOperations);
            check.equal(cleanHTML(), before);
            replay(batches[0].doOperations);
            check.equal(cleanHTML(), after);
        }
    }

    for (const selectList of [false, true]) {
        const list = reset();
        const selected = selectList ? [list] : items(list).slice(0, 2);
        const event = new KeyboardEvent("keydown", {cancelable: true});
        const rangeDependencies = {
            isCrossBlock: true,
            selectText: "one two",
            range: document.createRange(),
            getBlockElementsByRange: () => selected,
            getUndoFocusContext: noop,
            turnsIntoTransaction: api.turnsIntoTransaction,
            isListHeadingContainer: api.isListHeadingContainer,
            protyle,
            event,
        };
        const convertRange = new Function(...Object.keys(rangeDependencies), rangeSource +
            "\nreturn turnCrossBlockRangeInto;")(...Object.values(rangeDependencies)) as (type: TTurnInto, level?: number) => boolean;
        check.equal(convertRange("Blocks2Ps"), false);
        check.equal(convertRange("Blocks2Hs", 5), true);
        check.equal(batches.length, 1);
        check.equal(batches[0].doOperations.length, selectList ? 3 : 2);
        check.equal(event.defaultPrevented, true);
    }

    for (const selectList of [false, true]) {
        const list = reset();
        const listItems = items(list);
        const selected = selectList ? [list] : [listItems[0], listItems[2]];
        selected.forEach(item => item.classList.add("protyle-wysiwyg--select"));
        setCaret(first(listItems[0]));
        api.turnsIntoTransaction({protyle, nodeElement: first(listItems[0]), type: "Blocks2Hs", level: 2});
        check.equal(first(listItems[0]).getAttribute("data-type"), "NodeHeading");
        check.equal(first(listItems[1]).getAttribute("data-type"), selectList ? "NodeHeading" : "NodeParagraph");
        check.equal(first(listItems[2]).getAttribute("data-type"), "NodeHeading");
        check.equal(editor.querySelector("wbr, .protyle-wysiwyg--select"), null);
        check.ok(first(listItems[0]).contains(getSelection().anchorNode));
    }

    let list = reset();
    let listItems = items(list);
    let targets = listItems.map(first);
    check.deepEqual(api.getHeadingConversionElements([list, listItems[0], targets[0]]), targets);
    api.turnsIntoTransaction({protyle, selectsElement: [listItems[0], listItems[2]], type: "Blocks2Hs", level: 3});
    check.equal(first(listItems[1]).getAttribute("data-type"), "NodeParagraph");
    listItems[0].classList.add("protyle-wysiwyg--select");
    setCaret(first(listItems[0]));
    api.turnsIntoTransaction({protyle, nodeElement: first(listItems[0]), type: "Blocks2Hs", level: 3});
    check.equal(first(listItems[0]).getAttribute("data-type"), "NodeHeading");
    api.turnsIntoTransaction({protyle, nodeElement: first(listItems[0]), type: "Blocks2Hs", level: 3});
    check.equal(first(listItems[0]).getAttribute("data-type"), "NodeParagraph");

    list = reset();
    listItems = items(list);
    targets = listItems.map(first);
    targets[0].setAttribute("data-type", "NodeCodeBlock");
    check.equal(gutter.headingTurnIntoMenu(protyle, [listItems[0]]).length, 0);
    listItems[0].classList.add("protyle-wysiwyg--select");
    setCaret(targets[0]);
    const unchanged = editor.innerHTML;
    const previousDisconnects = disconnects;
    api.turnsIntoTransaction({protyle, nodeElement: targets[0], type: "Blocks2Hs", level: 1});
    check.equal(editor.innerHTML, unchanged);
    check.equal(batches.length, 0);
    check.equal(disconnects, previousDisconnects);

    list = reset();
    editor.insertAdjacentHTML("beforeend", lute.Md2BlockDOM("outside"));
    const outside = editor.lastElementChild;
    api.turnsIntoTransaction({protyle, selectsElement: [list, outside], type: "Blocks2Hs", level: 4});
    check.equal(batches[0].doOperations.length, 4);
    check.equal(editor.lastElementChild.getAttribute("data-type"), "NodeHeading");
    check.equal(editor.querySelectorAll('[data-type="NodeList"]').length, 2);
    editor.remove();
    return "List heading conversion cases passed";
};

test("list heading menus and shortcuts preserve containers, content, IDs and undo operations", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const read = (file: string) => readFileSync(path.join(__dirname, file), "utf8");
    const compile = (source: string) => transpileModule(source.replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
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
    const source = compile(read("headingConversion.ts") + "\n" + extract("transaction.ts", "turnsIntoTransaction") +
        "\n" + extract("getBlock.ts", "getNextBlockSibling") + "\n" + extract("../util/selection.ts", "focusByWbr"));
    const rangeSource = compile(extract("keydown.ts", "turnCrossBlockRangeInto"));
    const parsed = createSourceFile("gutter.ts", read("../gutter/index.ts"), ScriptTarget.Latest, true);
    const gutter = parsed.statements.find(isClassDeclaration);
    const methods = gutter.members.filter(member => isMethodDeclaration(member) &&
        ["headingTurnIntoMenu", "turnsInto"].includes(member.name.getText(parsed)));
    const menuSource = compile("class Gutter {\n" + methods.map(member => member.getText(parsed)).join("\n") + "\n}");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-list-heading-test-"));
    const script = path.join(temporary, "run.cjs");
    const lutePath = path.resolve(__dirname, "../../../stage/protyle/js/lute/lute.min.js");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lutePath)}, "utf8"));
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + [source, menuSource, rangeSource].map(value => JSON.stringify(value)).join(",") + ")")}));
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /List heading conversion cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-list-heading-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
