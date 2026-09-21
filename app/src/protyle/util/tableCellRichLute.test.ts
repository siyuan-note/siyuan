import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {createSourceFile, isClassDeclaration, isMethodDeclaration, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, enterSource: string, hintSource: string, keydownSource: string,
                            copySource: string, selectionSource: string, highlightSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    const codeTabAttribute = "custom-sy-code-tab-spaces";
    const api = new Function("Constants", source + "\nreturn {getAgentLute, configureAVRichTextLute, getTableCellEditorLute, " +
        "canEnterCodeBlock, hasCodeBlockFence, getTableCellInlineHTML, serializeTableCellRich, " +
        "updateTableCellEditingValue, getTableCellRichBlockDOM, sanitizeAVRichTextBlockDOM};")({
        CUSTOM_SY_CODE_TAB_SPACES: codeTabAttribute,
    }) as
        typeof import("../render/setLute") & typeof import("../render/av/richTextValue") &
        typeof import("./tableCellRichLute") & typeof import("../wysiwyg/codeBlockEnter") &
        typeof import("./tableCellRich") & typeof import("../render/av/richText");
    const base = api.configureAVRichTextLute(api.getAgentLute({emojiSite: "/emojis", emojis: {},
        headingAnchor: false, listStyle: false, paragraphBeginningSpace: true, sanitize: true}));
    const lute = api.getTableCellEditorLute(base);
    const editable = document.createElement("div");
    for (const text of ["```", "```go", "~~~~shell", "  ```js", "before\n\n```ts"]) {
        editable.textContent = text;
        check.equal(api.canEnterCodeBlock(editable, text.length, false), true, text);
    }
    editable.textContent = "···go";
    check.equal(api.canEnterCodeBlock(editable, 5, true), true);
    check.equal(api.canEnterCodeBlock(editable, 5, false), false);
    for (const text of ["plain", "``", "```bad`", "text ```go", "first\n```bad`"]) {
        editable.textContent = text;
        check.equal(api.canEnterCodeBlock(editable, text.length, true), false, text);
    }
    editable.textContent = "````go";
    check.equal(api.canEnterCodeBlock(editable, 3, true), false);
    for (const type of ["text", "code"]) {
        for (const prefix of ["", "first\n"]) {
            editable.innerHTML = `<span data-type="${type}">${prefix}\`\`\`go</span>`;
            check.equal(api.canEnterCodeBlock(editable, editable.textContent.length, true), false);
        }
    }
    editable.innerHTML = '<span data-type="text">first\n```literal</span>\n```go';
    check.equal(api.canEnterCodeBlock(editable, editable.textContent.length, true), true);
    const paragraph = (content: string, text = false) => {
        const holder = document.createElement("div");
        holder.innerHTML = base.Md2BlockDOM("placeholder");
        holder.querySelector('[contenteditable="true"]')[text ? "textContent" : "innerHTML"] = content;
        return holder.innerHTML;
    };
    const parse = (html: string) => {
        const holder = document.createElement("div");
        holder.innerHTML = lute.SpinBlockDOM(html);
        return holder;
    };
    const verifyCode = (holder: Element, language: string) => {
        const code = holder.querySelector('[data-type="NodeCodeBlock"]');
        check.ok(code, holder.innerHTML);
        check.equal(code.querySelector(".protyle-action__language").textContent, language);
        check.ok(code.querySelector(".hljs wbr"), "the caret belongs to the code body");
        check.equal(holder.querySelector('[data-type="code"]'), null);
        check.doesNotMatch(holder.innerHTML, /SYTABLECELLSOFTBREAK/);
        return code;
    };
    for (const language of ["", "js"]) {
        verifyCode(parse(paragraph("```" + language + Lute.Caret + "\n```", true)), language);
        verifyCode(parse("```" + language + Lute.Caret + "\n```"), language);
        verifyCode(parse(paragraph("```" + language + "<wbr>\n```")), language);
    }
    const prefixed = parse(paragraph('first\n\n<span data-type="strong">second</span>\n```go<wbr>\n```'));
    verifyCode(prefixed, "go");
    check.equal(prefixed.firstElementChild.querySelector('[contenteditable="true"]').textContent, "first\n\nsecond");
    check.ok(prefixed.querySelector('[data-type="strong"]'));
    const plain = parse(paragraph("first\n\nsecond<wbr>"));
    check.equal(plain.childElementCount, 1);
    check.equal(plain.querySelector('[contenteditable="true"]').textContent, "first\n\nsecond");
    for (const [line, type] of [["# Heading", "NodeHeading"], ["- item", "NodeList"], ["[] task", "NodeList"]]) {
        const converted = parse(paragraph("first\n\n" + line + "<wbr>"));
        check.ok(converted.querySelector(`[data-type="${type}"] wbr`), line);
        check.equal(converted.firstElementChild.querySelector('[contenteditable="true"]').textContent, "first\n");
    }
    const literal = parse(paragraph('<span data-type="text">```js\n```</span><wbr>'));
    check.equal(literal.querySelector('[data-type="NodeCodeBlock"]'), null);
    check.equal(literal.querySelector('[contenteditable="true"]').textContent, "```js\n```");
    const existing = parse(base.Md2BlockDOM("```js\na | b\n\nc\n```"));
    check.equal(existing.querySelector('.hljs [contenteditable="true"]').textContent, "a | b\n\nc\n");
    check.doesNotMatch(api.sanitizeAVRichTextBlockDOM(base.Md2BlockDOM("```mermaid\ngraph TD\n```"), true), /NodeCodeBlock/);

    const fixture = document.createElement("div");
    fixture.innerHTML = '<table><tbody><tr><td><div class="table__cell-editor">' +
        '<div class="protyle-wysiwyg"></div></div></td></tr></tbody></table>';
    document.body.appendChild(fixture);
    const cell = fixture.querySelector("td");
    const host = cell.firstElementChild as HTMLElement;
    const wysiwyg = host.firstElementChild as HTMLElement;
    const hintElement = document.createElement("div");
    hintElement.className = "fn__none";
    const subElement = hintElement.cloneNode() as HTMLElement;
    const calls: {rendered?: Element, transaction?: {element: Element, oldHTML: string,
        additional?: {doOperations: IOperation[], undoOperations: IOperation[]}}, navigated: number} = {navigated: 0};
    const protyle = {lute, lite: true, wysiwyg: {element: wysiwyg}, toolbar: {range: document.createRange(), subElement},
        options: {hint: {extend: [{key: "/", hint: (): IHintData[] => []}]}}};
    const getSelectionOffset = (editable: Node, _editor: Element, range: Range) => {
        const prefix = document.createRange();
        prefix.selectNodeContents(editable);
        prefix.setEnd(range.startContainer, range.startOffset);
        return {start: prefix.toString().length};
    };
    const getContenteditableElement = (element: Element) => element.querySelector('[contenteditable="true"]');
    const focusByWbr = (element: Element, range: Range) => {
        const marker = element.querySelector("wbr");
        if (marker) {
            range.setStartBefore(marker);
            range.collapse(true);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
        }
    };
    const updateTransaction = (_protyle: unknown, element: Element, oldHTML: string, _context: unknown,
                               additional: {doOperations: IOperation[], undoOperations: IOperation[]}) => {
        calls.transaction = {element, oldHTML, additional};
    };
    const constants = {LOCAL_CODELANG: "codeLanguage", SIYUAN_RENDER_CODE_LANGUAGES: ["mermaid"],
        BLOCK_HINT_KEYS: ["((", "[["], INLINE_TYPE: ["code"], ZWSP: "\u200b", ATTRIBUTE_EDITING: "updated"};
    Object.assign(window, {siyuan: {storage: {codeLanguage: ""}, config: {
        editor: {markdown: {codeBlockMiddleDot: true}}, keymap: {editor: {table: {}, general: {}}},
    }}});
    const dependencies = {
        ...api, Constants: constants, BLOCK_SELECTION_CLASS: "protyle-wysiwyg--select",
        getBlockSelectionModeElement: (): undefined => undefined, getEmbedChildOperationContext: (): undefined => undefined,
        hasClosestByClassName: (element: Element, className: string) => element.closest("." + className),
        isNotEditBlock: () => false, getContenteditableElement, getSelectionOffset,
        activateTrackedRangeInsertion: () => {}, setStorageVal: () => {},
        highlightRender: (element: Element) => {
            calls.rendered = element;
            focusByWbr(element, protyle.toolbar.range);
        },
        processRender: () => { throw new Error("ordinary code must not use the render editor"); },
        updateTransaction, focusByWbr, focusByRange: () => {}, hideElements: () => {},
        hasClosestBlock: (node: Node) => (node instanceof Element ? node : node.parentElement).closest("[data-node-id]"),
        shouldCaptureHintUndoFocus: () => false, isBuiltinSlashHint: () => true,
        transaction: () => {},
    };
    const enter = new Function(...Object.keys(dependencies), enterSource + "\nreturn enter;")(...Object.values(dependencies)) as
        typeof import("../wysiwyg/enter").enter;
    const fill = new Function(...Object.keys(dependencies), hintSource + "\nreturn Hint.prototype.fill;")(...Object.values(dependencies));
    const fragment = {wysiwyg, protyle, hintElement, getBlockHTML: () => wysiwyg.innerHTML};
    const keyDependencies = {...dependencies, host, cell, fragment, owner: protyle, signal: new AbortController().signal,
        captureBeforeChange: () => {}, composing: false, matchHotKey: () => false, finish: () => {},
        fixTable: () => { calls.navigated++; }};
    new Function(...Object.keys(keyDependencies), keydownSource)(...Object.values(keyDependencies));
    const prepare = (text: string, offset = text.length) => {
        wysiwyg.innerHTML = paragraph(text, true);
        const range = document.createRange();
        range.setStart(getContenteditableElement(wysiwyg).firstChild, offset);
        range.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        protyle.toolbar.range = range;
        calls.rendered = undefined;
        calls.transaction = undefined;
        return range;
    };
    let entered: Promise<unknown>;
    wysiwyg.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey) {
            const range = getSelection().getRangeAt(0);
            entered = enter(wysiwyg.firstElementChild as HTMLElement, range, protyle as unknown as IProtyle);
        }
    });
    const replay = (operations: IOperation[]) => operations.forEach(operation => {
        if (operation.action === "update") {
            wysiwyg.querySelector(`[data-node-id="${operation.id}"]`).outerHTML = operation.data;
        } else if (operation.action === "insert") {
            wysiwyg.querySelector(`[data-node-id="${operation.previousID}"]`).insertAdjacentHTML("afterend", operation.data);
        } else if (operation.action === "delete") {
            wysiwyg.querySelector(`[data-node-id="${operation.id}"]`).remove();
        }
    });
    for (const text of ["```", "```go", "~~~~js", "···ts", "first\n\nsecond\n```go", "first\n```literal\n```go"]) {
        const range = prepare(text);
        if (text.includes("literal")) {
            const content = getContenteditableElement(wysiwyg);
            content.innerHTML = '<span data-type="text">first\n```literal</span>\n```go';
            range.setStart(content.lastChild, content.lastChild.textContent.length);
            range.collapse(true);
        }
        const oldID = wysiwyg.firstElementChild.getAttribute("data-node-id");
        const previousNavigation = calls.navigated;
        getContenteditableElement(wysiwyg).dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        await entered;
        check.equal(calls.navigated, previousNavigation, text);
        const language = text.slice(text.lastIndexOf("\n") + 1).replace(/^[`~·]+/, "") || window.siyuan.storage.codeLanguage;
        const code = verifyCode(wysiwyg, language);
        check.equal(calls.rendered, code);
        check.equal(calls.transaction.element.getAttribute("data-node-id"), oldID);
        if (text.startsWith("first")) {
            check.equal(wysiwyg.firstElementChild.querySelector('[contenteditable="true"]').textContent,
                text.substring(0, text.lastIndexOf("\n")));
            check.equal(calls.transaction.additional.doOperations.length, 1);
            check.equal(calls.transaction.additional.undoOperations.length, 1);
        }
        const saved = wysiwyg.innerHTML;
        const transaction = calls.transaction;
        const updatedHTML = transaction.element.outerHTML;
        replay([{action: "update", id: oldID, data: transaction.oldHTML}, ...(transaction.additional?.undoOperations || [])]);
        check.equal(getContenteditableElement(wysiwyg).textContent, text);
        replay([...(transaction.additional?.doOperations || []), {action: "update", id: oldID, data: updatedHTML}]);
        check.equal(wysiwyg.innerHTML, saved, "redo restores the complete conversion");
        wysiwyg.querySelectorAll("wbr").forEach(marker => marker.remove());
        const body = "a | b\n\n<标签> & c\n";
        wysiwyg.querySelector('.hljs [contenteditable="true"]').textContent = body;
        const stored = document.createElement("td");
        api.updateTableCellEditingValue(stored, api.serializeTableCellRich(wysiwyg.innerHTML));
        const reopened = document.createElement("div");
        reopened.innerHTML = api.getTableCellRichBlockDOM(stored);
        check.equal(reopened.querySelectorAll('[data-type="NodeCodeBlock"]').length, 1);
        check.equal(reopened.querySelector('.hljs [contenteditable="true"]').textContent, body);
        if (text.startsWith("first")) {
            check.equal(reopened.firstElementChild.querySelector('[contenteditable="true"]').textContent,
                text.substring(0, text.lastIndexOf("\n")));
        }
    }
    for (const [text, offset] of [["ordinary", 8], ["``", 2], ["```bad`", 7], ["```go", 2]] as const) {
        prepare(text, offset);
        const previous = calls.navigated;
        entered = undefined;
        getContenteditableElement(wysiwyg).dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        check.equal(calls.navigated, previous + 1, text);
        check.equal(entered, undefined);
    }
    prepare("```go");
    const previous = calls.navigated;
    getContenteditableElement(wysiwyg).dispatchEvent(new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true}));
    check.equal(calls.navigated, previous + 1);
    prepare("```go");
    entered = undefined;
    const beforeSoftEnter = calls.navigated;
    getContenteditableElement(wysiwyg).dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", shiftKey: true, bubbles: true, cancelable: true}));
    check.equal(calls.navigated, beforeSoftEnter);
    check.equal(entered, undefined);
    window.siyuan.config.editor.markdown.codeBlockMiddleDot = false;
    prepare("···go");
    getContenteditableElement(wysiwyg).dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
    check.equal(calls.navigated, beforeSoftEnter + 1);
    for (const prefix of ["", "existing "]) {
        const range = prepare(prefix + "/");
        range.setStart(range.startContainer, prefix.length);
        const context = {source: "hint", splitChar: "/", lastIndex: -1, fixImageCursor: () => {}};
        fill.call(context, "```", protyle, false);
        const code = verifyCode(wysiwyg, window.siyuan.storage.codeLanguage);
        check.equal(calls.rendered, code);
        check.ok(code.contains(getSelection().anchorNode));
    }
    const copied: string[] = [];
    let messages = 0;
    let bubbled = 0;
    Object.assign(window.siyuan, {languages: {copied: "Copied", default: "Default"}});
    const copyController = new AbortController();
    let canEditCode = true;
    let menuItems: IMenu[] = [];
    let menuShown = 0;
    let mobileMenuShown = 0;
    let mobileCodeMenu = false;
    let updates = 0;
    let oldCode: ReturnType<typeof api.serializeTableCellRich>;
    const settingCell = document.createElement("td");
    Object.assign(window.siyuan, {menus: {menu: {
        remove: () => { menuItems = []; }, append: () => {}, popup: () => { menuShown++; },
        fullscreen: () => { mobileMenuShown++; },
    }}});
    const copyDependencies = {
        host, fragment, signal: copyController.signal,
        Constants: {...constants, CUSTOM_SY_CODE_TAB_SPACES: codeTabAttribute},
        getContenteditableElement, getUndoFocusContext: () => ({}), updateTransaction,
        canEdit: () => canEditCode,
        beforeChange: () => { oldCode = api.serializeTableCellRich(wysiwyg.innerHTML); },
        commit: () => {
            updates++;
            api.updateTableCellEditingValue(settingCell, api.serializeTableCellRich(wysiwyg.innerHTML));
        },
        isMobile: () => mobileCodeMenu,
        highlightRender: () => {},
        MenuItem: class {
            element = document.createElement("button");
            constructor(item: IMenu) { menuItems.push(item); }
        },
        writeText: (text: string) => copied.push(text),
        showMessage: (text: string) => {
            check.equal(text, "Copied");
            messages++;
        },
    };
    const codeActions = new Function(...Object.keys(copyDependencies), copySource +
        "\nreturn {getCodeBlockTabSpace, tabCodeBlock};")(...Object.values(copyDependencies)) as
        typeof import("../wysiwyg/codeBlock");
    fixture.addEventListener("click", () => bubbled++);
    for (const text of ["", "a\u00a0b\n  <tag> & value\n\n", "\u200D```\n"]) {
        wysiwyg.innerHTML = base.Md2BlockDOM("```js\nplaceholder\n```");
        wysiwyg.querySelector('.hljs [contenteditable="true"]').textContent = text + "\n";
        const button = wysiwyg.querySelector(".protyle-action__copy");
        for (const target of [button, button.querySelector("use")]) {
            const event = new MouseEvent("click", {bubbles: true, cancelable: true});
            target.dispatchEvent(event);
            check.equal(event.defaultPrevented, true);
            check.equal(copied[copied.length - 1], text.replace(/\u00a0/g, " ").replace(/\u200D```/g, "```"));
        }
    }
    check.equal(copied.length, 6);
    check.equal(messages, 6);
    check.equal(bubbled, 0, "copy stays inside the cell editor");
    Object.assign(window.siyuan.config.editor,
        {codeLineWrap: true, codeLigatures: false, codeSyntaxHighlightLineNum: true, codeTabSpaces: 4});
    const settingsBody = "a | b\n\n<test> & c\n";
    wysiwyg.innerHTML = base.Md2BlockDOM("```js\n" + settingsBody + "```");
    const defaults = [true, false, true];
    for (const [index, attribute] of ["linewrap", "ligatures", "linenumber"].entries()) {
        wysiwyg.querySelector(".protyle-action__menu use").dispatchEvent(new MouseEvent("click", {bubbles: true}));
        check.equal(menuItems.length, 4);
        check.equal(menuItems[index + 1].checked, defaults[index]);
        menuItems[index + 1].click(document.createElement("button"), new MouseEvent("click"));
        wysiwyg.innerHTML = api.getTableCellRichBlockDOM(settingCell);
        check.equal(wysiwyg.firstElementChild.getAttribute(attribute), String(!defaults[index]));
        check.equal(wysiwyg.querySelector('.hljs [contenteditable="true"]').textContent, settingsBody);
        check.equal(api.serializeTableCellRich(wysiwyg.innerHTML).markdown,
            api.serializeTableCellRich(api.getTableCellRichBlockDOM(settingCell)).markdown);
        const redo = settingCell.getAttribute("data-sy-table-cell-rich");
        api.updateTableCellEditingValue(settingCell, oldCode);
        const undoHolder = document.createElement("div");
        undoHolder.innerHTML = api.getTableCellRichBlockDOM(settingCell);
        check.equal(undoHolder.firstElementChild.hasAttribute(attribute), false);
        settingCell.setAttribute("data-sy-table-cell-rich", redo);
        check.equal(api.getTableCellRichBlockDOM(settingCell), wysiwyg.innerHTML);
    }
    check.equal(updates, 3, "each setting explicitly commits through the host");
    wysiwyg.innerHTML = base.Md2BlockDOM("```js\n" + settingsBody + "```");
    for (const value of [0, 2, 4, 6, 8, null]) {
        const previousValue = wysiwyg.firstElementChild.getAttribute(codeTabAttribute);
        wysiwyg.querySelector(".protyle-action__menu").dispatchEvent(new MouseEvent("click", {bubbles: true}));
        const tabItems = menuItems.find(item => item.id === "md29").submenu;
        check.deepEqual(tabItems.map(item => item.label), ["Default (4)", "0", "2", "4", "6", "8"]);
        check.equal(tabItems.filter(item => item.checked).length, 1);
        const option = tabItems.find(item => item.id === (value === null ? "default" : `tabSpaces${value}`));
        option.click(document.createElement("button"), new MouseEvent("click"));
        wysiwyg.innerHTML = api.getTableCellRichBlockDOM(settingCell);
        const code = wysiwyg.firstElementChild as HTMLElement;
        check.equal(code.getAttribute(codeTabAttribute), value === null ? null : value.toString());
        check.equal(code.querySelector('.hljs [contenteditable="true"]').textContent, settingsBody);
        const expectedIndent = value === 0 ? "\t" : " ".repeat(value ?? 4);
        check.equal(codeActions.getCodeBlockTabSpace(code), expectedIndent);
        const redo = settingCell.getAttribute("data-sy-table-cell-rich");
        api.updateTableCellEditingValue(settingCell, oldCode);
        const undoHolder = document.createElement("div");
        undoHolder.innerHTML = api.getTableCellRichBlockDOM(settingCell);
        check.equal(undoHolder.firstElementChild.getAttribute(codeTabAttribute), previousValue);
        settingCell.setAttribute("data-sy-table-cell-rich", redo);
        const range = document.createRange();
        range.setStart(code.querySelector('.hljs [contenteditable="true"]').firstChild, 0);
        range.collapse(true);
        codeActions.tabCodeBlock(protyle as unknown as IProtyle, code, range);
        check.equal(code.querySelector('.hljs [contenteditable="true"]').textContent, expectedIndent + settingsBody);
        wysiwyg.innerHTML = api.getTableCellRichBlockDOM(settingCell);
    }
    const editableUpdates = updates;
    const editableMenus = menuShown;
    canEditCode = false;
    wysiwyg.querySelector(".protyle-action__menu").dispatchEvent(new MouseEvent("click", {bubbles: true}));
    check.equal(menuShown, editableMenus, "read-only editors cannot open the settings menu");
    menuItems[1].click(document.createElement("button"), new MouseEvent("click"));
    menuItems[0].submenu[1].click(document.createElement("button"), new MouseEvent("click"));
    check.equal(updates, editableUpdates, "stale menu callbacks cannot change a read-only editor");
    canEditCode = true;
    mobileCodeMenu = true;
    wysiwyg.querySelector(".protyle-action__menu").dispatchEvent(new MouseEvent("click", {bubbles: true}));
    check.equal(mobileMenuShown, 1, "mobile opens the fullscreen menu");
    check.equal(menuShown, editableMenus);
    wysiwyg.firstElementChild.setAttribute("linewrap", "invalid");
    const cleanCode = document.createElement("div");
    cleanCode.innerHTML = api.sanitizeAVRichTextBlockDOM(wysiwyg.innerHTML, true);
    check.equal(cleanCode.firstElementChild.hasAttribute("linewrap"), false);
    cleanCode.innerHTML = api.sanitizeAVRichTextBlockDOM(wysiwyg.innerHTML);
    check.equal(cleanCode.firstElementChild.hasAttribute("ligatures"), false);
    for (const value of ["", "3", "-2", "10", "02", "2.0", "true"]) {
        wysiwyg.firstElementChild.setAttribute(codeTabAttribute, value);
        cleanCode.innerHTML = api.sanitizeAVRichTextBlockDOM(wysiwyg.innerHTML, true);
        check.equal(cleanCode.firstElementChild.hasAttribute(codeTabAttribute), false);
    }
    wysiwyg.firstElementChild.setAttribute(codeTabAttribute, "2");
    cleanCode.innerHTML = api.sanitizeAVRichTextBlockDOM(wysiwyg.innerHTML);
    check.equal(cleanCode.firstElementChild.hasAttribute(codeTabAttribute), false);
    copyController.abort();
    wysiwyg.querySelector(".protyle-action__copy").dispatchEvent(new MouseEvent("click", {bubbles: true}));
    check.equal(copied.length, 6, "closing the editor removes the copy handler");
    menuItems[1].click(document.createElement("button"), new MouseEvent("click"));
    menuItems[0].submenu[1].click(document.createElement("button"), new MouseEvent("click"));
    check.equal(updates, editableUpdates, "closing the editor invalidates menu callbacks");
    const selectionDependencies = {getContenteditableElement, isNotEditBlock: () => false, revealTabsForTarget: () => {}};
    const selectionAPI = new Function(...Object.keys(selectionDependencies), selectionSource +
        "\nreturn {captureRichCellSelection, captureRichCellSelectionAtPoint, restoreRichCellSelection, focusByOffset, getSelectionOffset};")(
        ...Object.values(selectionDependencies)) as typeof import("./tableCellRichSelection") & typeof import("./selection");
    const renderDependencies = {
        ...selectionAPI, Constants: {PROTYLE_CDN: ""}, setCodeTheme: () => {}, addScript: () => Promise.resolve(),
    };
    const render = new Function(...Object.keys(renderDependencies), highlightSource + "\nreturn highlightRender;")(
        ...Object.values(renderDependencies)) as typeof import("../render/highlightRender").highlightRender;
    Object.assign(window, {hljs: {
        getLanguage: () => true,
        highlight: (text: string) => {
            const span = document.createElement("span");
            span.textContent = text;
            return {value: span.outerHTML};
        },
    }});
    const body = "4441231234444\n\n\n123555555\n22\n\n123\n";
    wysiwyg.innerHTML = base.Md2BlockDOM("sdf\n\n```java\n" + body + "```");
    const codeEdit = wysiwyg.querySelector<HTMLElement>('.hljs [contenteditable="true"]');
    selectionAPI.focusByOffset(codeEdit, 23, 23);
    const beforeEdit = selectionAPI.captureRichCellSelection(wysiwyg, getSelection());
    check.equal(beforeEdit.startIndex, 1, "the line number gutter is not an editable block");
    const marker = document.createElement("wbr");
    const markerRange = selectionAPI.focusByOffset(codeEdit, 24, 24, false);
    check.ok(markerRange);
    markerRange.insertNode(marker);
    selectionAPI.focusByOffset(codeEdit, 0, 0);
    const pending = selectionAPI.captureRichCellSelection(wysiwyg, getSelection(), true);
    check.equal(pending.start, 24, "pending highlight uses the caret marker instead of the stale DOM selection");
    const serialized = api.serializeTableCellRich(wysiwyg.innerHTML);
    check.ok(!serialized.markdown.includes(Lute.Caret), "temporary caret must not enter stored cell content");
    check.ok(wysiwyg.contains(marker), "serialization leaves the live caret intact");
    const savedCell = document.createElement("td");
    api.updateTableCellEditingValue(savedCell, serialized);
    for (const lineNumbers of [false, true]) {
        window.siyuan.config.editor.codeSyntaxHighlightLineNum = lineNumbers;
        window.siyuan.config.editor.fontSize = 16;
        for (const saved of [beforeEdit, pending, {...beforeEdit, end: 28, backward: true}]) {
            wysiwyg.innerHTML = api.getTableCellRichBlockDOM(savedCell);
            render(wysiwyg);
            check.equal(selectionAPI.restoreRichCellSelection(wysiwyg, saved), true);
            await new Promise(resolve => setTimeout(resolve, 0));
            check.deepEqual(selectionAPI.captureRichCellSelection(wysiwyg, getSelection()), saved,
                "asynchronous highlighting preserves the restored undo or redo selection");
            check.equal(wysiwyg.querySelector('.hljs [contenteditable="true"]').textContent, body);
        }
        wysiwyg.innerHTML = api.getTableCellRichBlockDOM(savedCell);
        render(wysiwyg);
        const clickedCode = wysiwyg.querySelector<HTMLElement>('.hljs [contenteditable="true"]');
        const clickRange = document.createRange();
        clickRange.setStart(clickedCode.firstChild, 7);
        clickRange.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(clickRange);
        await new Promise(resolve => setTimeout(resolve, 0));
        check.equal(selectionAPI.captureRichCellSelection(wysiwyg, getSelection()).start, 7,
            "first-click caret survives the initial asynchronous code highlight");
    }
    for (const offset of [2, 6, body.indexOf("123555555") + 4]) {
        wysiwyg.innerHTML = api.getTableCellRichBlockDOM(savedCell);
        render(wysiwyg);
        await new Promise(resolve => setTimeout(resolve, 0));
        const previewCode = wysiwyg.querySelector<HTMLElement>('.hljs > [contenteditable="true"]');
        previewCode.style.cssText = "white-space: pre; font: 16px monospace; padding-left: 40px;";
        wysiwyg.querySelectorAll<HTMLElement>("[contenteditable]").forEach(element => element.contentEditable = "false");
        const previewRange = selectionAPI.focusByOffset(previewCode, offset, offset, false);
        check.ok(previewRange);
        const rect = previewRange.getBoundingClientRect();
        const point = {x: rect.left + 0.1, y: rect.top + rect.height / 2};
        const clicked = selectionAPI.captureRichCellSelectionAtPoint(wysiwyg, point);
        check.equal(clicked?.start, offset, "hit-test uses the visible preview text");
        check.equal(clicked.startIndex, 1);
        wysiwyg.innerHTML = api.getTableCellRichBlockDOM(savedCell);
        const editingCode = wysiwyg.querySelector<HTMLElement>('.hljs > [contenteditable="true"]');
        editingCode.style.cssText = "white-space: pre; font: 16px monospace; padding-left: 0;";
        check.notEqual(selectionAPI.captureRichCellSelectionAtPoint(wysiwyg, point)?.start, offset,
            "the same screen coordinate points elsewhere before the line number gutter is rendered");
        render(wysiwyg);
        check.equal(selectionAPI.restoreRichCellSelection(wysiwyg, clicked), true);
        await new Promise(resolve => setTimeout(resolve, 0));
        check.deepEqual(selectionAPI.captureRichCellSelection(wysiwyg, getSelection()), clicked);
    }
    fixture.remove();
    return "Table cell code insertion cases passed";
};

test("table cells insert code through slash and Enter without losing soft breaks", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const compile = (source: string) => transpileModule(source.replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/^export (?:type )?\{[\s\S]*?\}(?: from "[^"]+")?;\r?\n/gm, "")
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const read = (file: string) => readFileSync(path.join(__dirname, file), "utf8");
    const source = ["longTextWrap.ts", "inlineElementBoundary.ts", "../toolbar/fontFamilyCore.ts", "../../util/escape.ts",
        "../render/setLute.ts", "../wysiwyg/codeBlockUtil.ts", "../render/av/richTextValue.ts", "../render/av/richText.ts",
        "../wysiwyg/taskListMarker.ts", "../wysiwyg/codeBlockEnter.ts", "tableCellRichLute.ts", "tableCellRichValue.ts",
        "tableCellRich.ts"].map(file => compile(read(file))).join("\n");
    const hint = createSourceFile("hint.ts", read("../hint/index.ts"), ScriptTarget.Latest, true);
    const hintClass = hint.statements.find(isClassDeclaration);
    const fill = hintClass.members.find(member => isMethodDeclaration(member) && member.name.getText(hint) === "fill");
    const hintSource = compile("class Hint {" + fill.getText(hint) + "}");
    const editor = read("../render/tableCellRichEditor.ts");
    const start = editor.indexOf('host.addEventListener("keydown", event => {');
    const end = editor.indexOf("}, {capture: true, signal});", start) + "}, {capture: true, signal});".length;
    const keydownSource = compile(editor.substring(start, end));
    const copySource = ["normalizeText.ts", "../wysiwyg/codeBlockUtil.ts", "../wysiwyg/codeBlock.ts", "../lite/codeActions.ts"]
        .map(file => compile(read(file))).join("\n") +
        "\nbindLiteCodeActions(host, fragment.protyle, {signal, canEdit, beforeChange, onChange: commit});";
    const selectionSource = compile(read("selection.ts")) + "\n" + compile(read("tableCellRichSelection.ts"));
    const highlightSource = compile(read("../render/highlightRender.ts"));
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-table-cell-code-test-"));
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
        const result = await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + [source, compile(read("../wysiwyg/enter.ts")), hintSource, keydownSource, copySource,
            selectionSource, highlightSource]
            .map(value => JSON.stringify(value)).join(",") + ")")});
        console.log(result);
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
        assert.match(result.stdout, /Table cell code insertion cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-table-cell-code-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
