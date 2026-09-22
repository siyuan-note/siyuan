import * as assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import type {ListMindmapLayoutNode, ListMindmapNode} from "./model";

const buildGlobals = ["SIYUAN_VERSION", "NODE_ENV"].map(name => ({
    name, descriptor: Object.getOwnPropertyDescriptor(globalThis, name),
}));
buildGlobals.forEach(({name}) => Object.defineProperty(globalThis, name, {configurable: true, value: "test"}));
const {layoutListMindmap, parseListMindmapMetadata}: typeof import("./model") = require("./model");
buildGlobals.forEach(({name, descriptor}) => {
    if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
    } else {
        Reflect.deleteProperty(globalThis, name);
    }
});

const measured = (id: string, width = 100, height = 40,
                  children: ListMindmapLayoutNode[] = []): ListMindmapLayoutNode => ({id, width, height, children});

test("relation label spacing only expands the requested branch boundary", () => {
    const root = measured("root", 100, 40, [measured("a"), measured("b"), measured("c")]);
    const expanded = layoutListMindmap(root, {verticalGaps: new Map([["b", 64]])}).nodes;
    assert.equal(expanded.get("b").y - expanded.get("a").y - 40, 64);
    assert.equal(expanded.get("c").y - expanded.get("b").y - 40, 24);
    const normal = layoutListMindmap(root).nodes;
    assert.equal(normal.get("b").y - normal.get("a").y - 40, 24);
    const horizontal = layoutListMindmap(root, {horizontalGaps: new Map([["b", 150]])}).nodes;
    assert.equal(horizontal.get("b").x - horizontal.get("root").x - 100, 150);
    assert.equal(horizontal.get("a").x - horizontal.get("root").x - 100, 40);
    assert.equal(horizontal.get("c").x - horizontal.get("root").x - 100, 40);
});

test("mindmap metadata rejects unknown formats and invalid values without replacing original data", () => {
    const value = '{"version":1,"nodes":{"a":{"bold":true,"fontSize":18,"extension":"retained"}},' +
        '"relations":[{"id":"r","from":"a","to":"b","label":"label","dash":true}],"extension":42}';
    assert.equal(JSON.stringify(parseListMindmapMetadata(value)), value);
    assert.deepEqual(parseListMindmapMetadata(null).relations, []);
    for (const invalid of ["", "null", "[]", "{", '{"version":2,"nodes":{},"relations":[]}',
        '{"version":1,"nodes":{"a":{"fontSize":"18"}},"relations":[]}',
        '{"version":1,"nodes":{"a":{"lineWidth":-1}},"relations":[]}',
        '{"version":1,"nodes":{},"relations":[{"id":"r","from":"a","to":"b"}]}',
        '{"version":1,"nodes":{},"relations":[{"id":"r","from":"a","to":"b","label":"","dash":0}]}']) {
        assert.throws(() => parseListMindmapMetadata(invalid), /Invalid list mindmap metadata/);
    }
});

test("manual relation routes are optional, versioned and validated without dropping extension fields", () => {
    const route = {version: 1, points: [{x: -40, y: 25.5, t: .4, extension: "keep"}], extension: "keep"};
    const metadata = {version: 1, nodes: {}, relations: [{id: "r", from: "a", to: "b", label: "", route}]};
    const value = JSON.stringify(metadata);
    assert.equal(JSON.stringify(parseListMindmapMetadata(value)), value);
    for (const invalid of [null, {}, {...route, version: 2}, {...route, points: []},
        {...route, points: Array(65).fill(route.points[0])}, ...[
            {x: "0", y: 0, t: 0}, {x: 0, y: 0, t: -1}, {x: 0, y: 0, t: 1.1},
            {x: 1e7, y: 0, t: .5}, {x: 0, y: null, t: .5}, {x: 0, y: 0},
        ].map(point => ({version: 1, points: [point]}))]) {
        const data = JSON.stringify({...metadata, relations: [{...metadata.relations[0], route: invalid}]});
        assert.throws(() => parseListMindmapMetadata(data), /Invalid list mindmap metadata/);
    }
});

test("variable-size mindmap branches keep their order and never overlap", () => {
    const root = measured("root", 90, 55, [
        measured("a", 220, 200, [measured("a1", 150, 36), measured("a2", 90, 92)]),
        measured("b", 70, 34, [measured("b1", 200, 160), measured("b2", 60, 30)]),
        measured("c", 80, 55),
    ]);
    const snapshot = JSON.stringify(root);
    const layout = layoutListMindmap(root, {horizontalGap: 48, verticalGap: 20, padding: 30});
    const positions = [...layout.nodes.values()];
    assert.equal(positions.length, 8);
    assert.equal(layout.edges.length, 7);
    assert.equal(JSON.stringify(root), snapshot);
    for (const position of positions) {
        assert.ok(position.x >= 30 && position.y >= 30);
        assert.ok(position.x + position.width <= layout.width - 30);
        assert.ok(position.y + position.height <= layout.height - 30);
        if (position.parentId) {
            const parent = layout.nodes.get(position.parentId);
            assert.equal(position.x - parent.x - parent.width, 48);
        }
        for (const other of positions) {
            if (other.id !== position.id) {
                assert.ok(position.x + position.width <= other.x || other.x + other.width <= position.x ||
                    position.y + position.height <= other.y || other.y + other.height <= position.y);
            }
        }
    }
    assert.ok(layout.nodes.get("a").y < layout.nodes.get("b").y);
    assert.ok(layout.nodes.get("b").y < layout.nodes.get("c").y);
    assert.equal(layout.nodes.get("a1").x - layout.nodes.get("b2").x, 150);
});

test("folded branches disappear from layout and restore deterministically", () => {
    const root = measured("root", 100, 40, [measured("branch", 100, 40, [measured("leaf", 100, 80)])]);
    const before = layoutListMindmap(root);
    root.children[0].collapsed = true;
    const folded = layoutListMindmap(root);
    assert.equal(folded.nodes.has("leaf"), false);
    assert.ok(folded.width < before.width);
    assert.ok(folded.height < before.height);
    root.children[0].collapsed = false;
    assert.deepEqual(layoutListMindmap(root), before);
});

test("layout rejects cyclic or invalid trees and supports deep nesting without recursive overflow", () => {
    const cyclic = measured("root");
    cyclic.children.push(cyclic);
    assert.throws(() => layoutListMindmap(cyclic), /Invalid list mindmap layout node/);
    assert.throws(() => layoutListMindmap(measured("a", 0)), /Invalid list mindmap layout node/);
    assert.throws(() => layoutListMindmap(measured("a"), {padding: Number.NaN}), /Invalid list mindmap layout spacing/);
    let root = measured("leaf");
    for (let index = 0; index < 5000; index++) {
        root = measured(`node-${index}`, 100, 40, [root]);
    }
    assert.equal(layoutListMindmap(root).nodes.size, 5001);
});

const browserCases = async (sourceCode: string, css: string, taskSource: string, taskCSS: string, dragSource: string,
                            inputSource: string) => {
    const check = require("node:assert/strict");
    const api = new Function("mathRender", "Constants", "highlightRender", sourceCode + "; return {readListMindmap, moveListMindmapNode, addListMindmapNode, " +
        "deleteListMindmapNode, replaceListMindmapContent, cleanListMindmapHTML, convertListMindmapToList, remapListMindmapIDs, writeListMindmapMetadata, " +
        "normalizeLegacyMindmapCodes, replaceLegacyMindmapHTML, spinListMindmapDOM, focusListMindmap, " +
        "tabsRender, destroyTabsRender, getTabTask, getListMindmapTabItem, ListMindmapView};")(
        async (element: Element) => {
            const formulas = element.querySelectorAll('[data-subtype="math"]:not([data-render="true"])');
            await Promise.resolve();
            formulas.forEach(formula => {
                formula.innerHTML = '<span class="katex">rendered formula</span>';
                formula.setAttribute("data-render", "true");
            });
        }, {TIMEOUT_DBLCLICK: 190, CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap",
            CUSTOM_SY_LIST_MINDMAP_DATA: "custom-sy-list-mindmap-data", CUSTOM_SY_MINDMAP_CODE: "custom-sy-mindmap-code",
            CUSTOM_SY_CODE_TAB_SPACES: "custom-sy-code-tab-spaces"}, () => {});
    const lute = Lute.New();
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    const holder = document.createElement("div");
    const reset = (markdown: string) => {
        holder.innerHTML = lute.Md2BlockDOM(markdown);
        return holder.firstElementChild as HTMLElement;
    };
    const ids = (list: HTMLElement) => Array.from(list.querySelectorAll("[data-node-id]")).map(element =>
        element.getAttribute("data-node-id"));

    // 虚拟根直属节点的首段复用列表输入链路，输入和保存均保留正文、块身份及光标。
    const inputTransactions: {forward: IOperation[], backward: IOperation[]}[] = [];
    const inputAPI = new Function("Constants", "dayjs", "transaction", "hideElements", "mathRender", "highlightRender",
        "normalizeInlineFontFamilyStyle", "getBlockquoteContext", "revealTabsForTarget",
        "updateTransaction", "isMac", "isOnlyMeta", "isNotCtrl", inputSource +
        "; return {input, configureListItemInput, listShortcut, ListHint};")(
        {ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing", KEYCODELIST: {76: "L", 74: "J"}}, () => ({format: () => "20260922120000"}),
        (_protyle: IProtyle, forward: IOperation[], backward: IOperation[]) => inputTransactions.push({forward, backward}),
        () => {}, () => {}, () => {}, (value: string) => value, (): undefined => undefined, () => {},
        (_protyle: IProtyle, block: HTMLElement, before: string) => {
            inputTransactions.push({forward: [{action: "update", id: block.dataset.nodeId, data: block.outerHTML}],
                backward: [{action: "update", id: block.dataset.nodeId, data: before}]});
        }, () => false, (event: KeyboardEvent) => event.ctrlKey && !event.metaKey,
        (event: KeyboardEvent) => !event.ctrlKey && !event.metaKey);
    window.siyuan = {config: {editor: {markdown: {}}, keymap: {editor: {insert: {
        list: {custom: "⌘J"}, "ordered-list": {custom: "⇧⌘J"}, check: {custom: "⌘L"}, quote: {custom: ""},
    }}}}, storage: {}} as unknown as typeof window.siyuan;
    document.body.append(holder);
    const inputHost = document.createElement("div");
    inputHost.className = "protyle-wysiwyg";
    inputHost.contentEditable = "true";
    document.body.append(inputHost);
    const inputProtyle = {lute, wysiwyg: {element: inputHost, lastHTMLs: {}},
        hint: {render: () => {}}, toolbar: {}, block: {parentID: "document"}} as unknown as IProtyle;
    const caretOffset = (element: Element) => {
        const selection = getSelection();
        check.ok(selection.isCollapsed);
        check.ok(element.contains(selection.anchorNode));
        const range = document.createRange();
        range.selectNodeContents(element);
        range.setEnd(selection.anchorNode, selection.anchorOffset);
        return range.toString().length;
    };
    const typeAtCaret = async (value: string) => {
        const range = getSelection().getRangeAt(0);
        const block = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element :
            range.startContainer.parentElement).closest<HTMLElement>('[data-type="NodeParagraph"]');
        inputProtyle.wysiwyg.lastHTMLs[block.dataset.nodeId] = block.outerHTML;
        const text = document.createTextNode(value);
        range.insertNode(text);
        range.setStartAfter(text);
        range.collapse(true);
        await inputAPI.input(inputProtyle, block, range, true,
            new InputEvent("input", {inputType: "insertText", data: value}));
    };
    for (const body of ["", "Text **bold** and *italic*"]) {
        const list = reset("- " + (body || "Empty") + "\n- Sibling\n");
        const model = api.readListMindmap(list);
        const node = model.root.children[0];
        inputHost.innerHTML = node.contentBlocks.map((block: HTMLElement) => block.outerHTML).join("");
        inputAPI.configureListItemInput(inputProtyle);
        const blockID = node.contentBlocks[0].dataset.nodeId;
        const content = inputHost.firstElementChild.firstElementChild;
        if (!body) {
            content.textContent = "";
        }
        const before = content.innerHTML;
        const sourceIDs = ids(list);
        inputHost.focus();
        getSelection().setBaseAndExtent(content, 0, content, 0);
        inputTransactions.length = 0;
        await typeAtCaret("*");
        check.equal(inputHost.firstElementChild.getAttribute("data-type"), "NodeParagraph");
        check.equal(caretOffset(inputHost.firstElementChild.firstElementChild), 1);
        await typeAtCaret(" ");
        const paragraph = inputHost.firstElementChild;
        check.equal(paragraph.getAttribute("data-node-id"), blockID);
        check.equal(paragraph.firstElementChild.innerHTML, before);
        check.equal(caretOffset(paragraph.firstElementChild), 0);
        check.equal(inputHost.querySelector('[data-type="NodeList"]'), null);
        check.ok(inputTransactions.every(item => item.forward.every(operation => operation.action === "update")));
        const undoData = inputTransactions.at(-1).backward[0].data;
        check.ok(typeof undoData === "string" && undoData.includes("*"), "undo retains the typed marker");
        api.replaceListMindmapContent(list, node.id, inputHost.innerHTML);
        check.deepEqual(ids(list), sourceIDs);
        check.equal(api.readListMindmap(list).nodes.size, model.nodes.size);
        await typeAtCaret("x");
        check.equal(caretOffset(paragraph.firstElementChild), 1);
        check.ok(paragraph.firstElementChild.textContent.startsWith("x"));
    }
    // 真实根节点和下级节点的首段使用相同规则，后续段落仍可生成子列表。
    for (const [markdown, nodeIndex, paragraphIndex] of [
        ["- Single root\n", 0, 0],
        ["- Parent\n  - Nested\n- Sibling\n", 2, 0],
        ["- First\n\n  Second\n- Sibling\n", 0, 1],
    ] as const) {
        const model = api.readListMindmap(reset(markdown));
        const node = [...model.nodes.values()].filter((item: ListMindmapNode) => !item.virtual)[nodeIndex];
        inputHost.innerHTML = node.contentBlocks.map((block: HTMLElement) => block.outerHTML).join("");
        inputAPI.configureListItemInput(inputProtyle);
        const content = inputHost.children[paragraphIndex].firstElementChild;
        inputHost.focus();
        getSelection().setBaseAndExtent(content, 0, content, 0);
        await typeAtCaret("* ");
        if (paragraphIndex === 0) {
            check.equal(inputHost.querySelector(".list"), null);
        } else {
            check.ok(inputHost.children[paragraphIndex].classList.contains("list"), markdown);
        }
    }
    const checkListStructure = (list: HTMLElement) => {
        list.querySelectorAll<HTMLElement>('[data-type="NodeListItem"]').forEach(item => {
            check.equal(item.querySelector(":scope > [data-node-id]")?.getAttribute("data-type"), "NodeParagraph");
        });
    };
    // 每层节点都移除首段的列表标记，保存后仍以段落开头，正文、子树及块身份保持不变。
    for (const markdown of [
        "- Text &lt;tag&gt; &amp; **bold**\n\n  Second\n",
        "- Text **bold**\n\n  Second\n- Other\n",
        "- Parent\n  - Text **bold**\n\n    Second\n    - Descendant\n- Other\n",
    ]) {
        const list = reset(markdown);
        const model = api.readListMindmap(list);
        const node = [...model.nodes.values()].find((item: ListMindmapNode) =>
            item.contentBlocks[0]?.textContent.startsWith("Text"));
        const sourceIDs = ids(list);
        inputAPI.configureListItemInput(inputProtyle);
        for (const marker of ["* ", "- ", "+ ", "1. ", "2) ", "[]", "[x]"]) {
            inputHost.innerHTML = node.contentBlocks.map((block: HTMLElement) => block.outerHTML).join("");
            const content = inputHost.firstElementChild.firstElementChild;
            const before = content.innerHTML;
            inputHost.focus();
            getSelection().setBaseAndExtent(content, 0, content, 0);
            await typeAtCaret(marker);
            check.equal(content.innerHTML, before, marker);
            check.equal(caretOffset(content), 0);
            check.equal(inputHost.querySelector('[data-type="NodeList"]'), null);
            check.equal(api.replaceListMindmapContent(list, node.id, inputHost.innerHTML), true);
            check.deepEqual(ids(list), sourceIDs);
            check.equal(node.element.dataset.subtype, "u");
            checkListStructure(list);
            const saved = document.createElement("div");
            saved.innerHTML = lute.SpinBlockDOM(list.outerHTML);
            check.equal(saved.childElementCount, 1);
            check.deepEqual(ids(saved.firstElementChild as HTMLElement), sourceIDs);
            checkListStructure(saved);
        }
        // 列表快捷键和残留的斜杠菜单命令在所有段落都保持文本及选区。
        inputHost.innerHTML = node.contentBlocks.map((block: HTMLElement) => block.outerHTML).join("");
        const before = inputHost.innerHTML;
        for (const block of Array.from(inputHost.children)) {
            const content = block.firstElementChild;
            inputHost.focus();
            getSelection().setBaseAndExtent(content.firstChild, 0, content.firstChild, 2);
            const selected = getSelection().toString();
            for (const subtype of ["u", "o", "t"]) {
                const event = new KeyboardEvent("keydown", {key: subtype === "t" ? "l" : "j",
                    keyCode: subtype === "t" ? 76 : 74, ctrlKey: true, shiftKey: subtype === "o", cancelable: true});
                inputAPI.listShortcut(inputProtyle, block, event);
                check.ok(event.defaultPrevented);
                const hint = new inputAPI.ListHint();
                hint.splitChar = "/";
                hint.lastIndex = 0;
                inputProtyle.toolbar.range = getSelection().getRangeAt(0);
                hint.fill((subtype === "o" ? "1. " : subtype === "t" ? "- [ ] " : "- ") + Lute.Caret, inputProtyle, false);
                check.equal(getSelection().toString(), selected);
                check.equal(inputHost.innerHTML, before);
            }
        }
    }
    inputHost.remove();

    // mindmap 与其他语言一样生成可直接编辑的代码块，编辑重排时不会恢复图表节点。
    const legacySource = "- **Root**\n  - [X] Done\n  - [/] Progress\n";
    const legacyBlock = reset("```mindmap\n" + legacySource + "```\n");
    const legacyID = legacyBlock.dataset.nodeId;
    document.body.append(holder);
    check.ok(legacyBlock.classList.contains("code-block"));
    check.equal(legacyBlock.querySelector(".list-mindmap__node"), null);
    check.equal(legacyBlock.dataset.nodeId, legacyID);
    check.equal(legacyBlock.dataset.type, "NodeCodeBlock");
    const legacySaved = api.cleanListMindmapHTML(legacyBlock.outerHTML);
    check.ok(!legacySaved.includes("list-mindmap__node"));
    check.ok(lute.BlockDOM2StdMd(legacySaved).includes(legacySource.trim()));
    const invalidBlock = reset("```mindmap\n- List\n\nOutside text\n```\n");
    const invalidSource = "- List\n\nOutside text\n";
    const invalidID = invalidBlock.dataset.nodeId;
    invalidBlock.setAttribute("custom-test", "preserved");
    check.equal(invalidBlock.querySelector(".hljs > [contenteditable=true]").textContent, invalidSource);
    check.equal(invalidBlock.dataset.type, "NodeCodeBlock");
    check.equal(invalidBlock.dataset.nodeId, invalidID);
    check.equal(invalidBlock.getAttribute("custom-test"), "preserved");
    check.equal(invalidBlock.classList.contains("render-node"), false);
    check.equal(invalidBlock.classList.contains("code-block"), true);
    check.equal(invalidBlock.hasAttribute("data-subtype"), false);
    check.equal(invalidBlock.hasAttribute("data-content"), false);
    check.equal(invalidBlock.querySelector(".protyle-action__language").textContent, "mindmap");
    check.equal(invalidBlock.querySelectorAll("[data-node-id]").length, 0);
    check.ok(invalidBlock.querySelector(".protyle-action__copy"));
    check.ok(invalidBlock.querySelector(".protyle-action__menu"));
    check.ok(lute.BlockDOM2StdMd(invalidBlock.outerHTML).includes("```mindmap"));
    invalidBlock.querySelector(".hljs > [contenteditable=true]").textContent = "- Now a valid list";
    holder.innerHTML = lute.SpinBlockDOM(invalidBlock.outerHTML);
    // 断言原始 SpinBlockDOM 的返回值，不能由渲染后的修补掩盖解析错误。
    check.ok(holder.firstElementChild.classList.contains("code-block"));
    check.equal(holder.querySelector(".list-mindmap"), null);
    check.equal(holder.querySelector(".hljs > [contenteditable=true]").textContent, "- Now a valid list\n");
    const rawCode = holder.firstElementChild as HTMLElement;
    const edit = rawCode.querySelector(".hljs > [contenteditable=true]");
    edit.innerHTML = "1<wbr>2\n  &amp;lt;script&amp;gt;\n";
    holder.innerHTML = lute.SpinBlockDOM(rawCode.outerHTML);
    check.ok(holder.firstElementChild.classList.contains("code-block"));
    check.equal(holder.querySelector(".render-node"), null);
    check.ok(holder.querySelector(".hljs wbr"));
    const oldDOM = document.createElement("div");
    oldDOM.className = "render-node";
    oldDOM.dataset.type = "NodeCodeBlock";
    oldDOM.dataset.nodeId = legacyID;
    oldDOM.dataset.subtype = "mindmap";
    oldDOM.dataset.content = Lute.EscapeHTMLStr(invalidSource);
    oldDOM.innerHTML = '<div spin="1"></div><div class="protyle-attr" contenteditable="false"></div>';
    api.normalizeLegacyMindmapCodes(oldDOM);
    check.ok(oldDOM.classList.contains("code-block"));
    check.equal(oldDOM.hasAttribute("data-subtype"), false);
    check.equal(oldDOM.querySelector(".protyle-action__language").textContent, "mindmap");
    const newMindmap = reset(`- ${Lute.Caret}\n{: custom-sy-list-mindmap="1"}`);
    check.equal(newMindmap.dataset.type, "NodeList");
    check.equal(newMindmap.getAttribute("custom-sy-list-mindmap"), "1");
    const creationSource = `- ${Lute.Caret}`;
    const paragraph = reset("Empty\n");
    const paragraphID = paragraph.dataset.nodeId;
    paragraph.querySelector('[contenteditable="true"]').textContent = creationSource;
    for (const input of [creationSource, paragraph.outerHTML]) {
        holder.innerHTML = api.spinListMindmapDOM(lute, input);
        check.equal(holder.childElementCount, 1);
        check.equal(holder.firstElementChild.getAttribute("data-type"), "NodeList");
        check.equal(holder.firstElementChild.getAttribute("custom-sy-list-mindmap"), "1");
        if (input === paragraph.outerHTML) {
            check.equal(holder.firstElementChild.getAttribute("data-node-id"), paragraphID);
        }
        const createdModel = api.readListMindmap(holder.firstElementChild);
        check.equal(createdModel.nodes.size, 1);
        const saved = lute.SpinBlockDOM(holder.innerHTML);
        holder.innerHTML = saved;
        check.equal(holder.childElementCount, 1);
        check.equal(holder.firstElementChild.getAttribute("custom-sy-list-mindmap"), "1");
    }
    const focusRoot = document.createElement("div");
    focusRoot.className = "protyle-wysiwyg";
    focusRoot.contentEditable = "true";
    focusRoot.innerHTML = api.spinListMindmapDOM(lute, creationSource);
    document.body.append(focusRoot);
    const focusList = focusRoot.firstElementChild as HTMLElement;
    const focusHost = document.createElement("div");
    focusList.append(focusHost);
    let mindmapKeys = 0;
    let documentKeys = 0;
    focusRoot.addEventListener("keydown", () => documentKeys++);
    const focusView = new api.ListMindmapView({host: focusHost, model: api.readListMindmap(focusList),
        onExit: () => {}, onAdd: () => mindmapKeys++});
    const sourceRange = document.createRange();
    sourceRange.selectNodeContents(focusList.querySelector('[contenteditable="true"]'));
    sourceRange.collapse(true);
    focusRoot.focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(sourceRange);
    check.ok(api.focusListMindmap(focusList, focusHost));
    check.equal(document.activeElement, focusHost);
    check.ok(focusHost.contains(window.getSelection().anchorNode));
    focusHost.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
    check.equal(mindmapKeys, 1);
    check.equal(documentKeys, 0, "new mindmap keys never reach the hidden source list");
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    elsewhere.focus();
    check.equal(api.focusListMindmap(focusList, focusHost), undefined);
    check.equal(document.activeElement, elsewhere, "mounting does not steal focus from another input");
    focusView.destroy();
    focusRoot.remove();
    elsewhere.remove();
    const canonical = [{id: legacyID, dom: newMindmap.outerHTML}];
    const embedded = `<div data-type="NodeBlockQueryEmbed">${legacySaved}</div>`;
    holder.innerHTML = api.replaceLegacyMindmapHTML(legacySaved + embedded, canonical);
    check.equal(holder.firstElementChild.getAttribute("data-type"), "NodeList");
    check.ok(holder.querySelector('[data-type="NodeBlockQueryEmbed"] .code-block'));
    holder.remove();

    // 直属子列表形成分支，其他正文中的嵌套列表属于正文，读取不会重建或移动任何原始块。
    let list = reset("* Parent\n\n  Second paragraph\n\n  * Child\n    * Grandchild\n\n* Sibling\n");
    let model = api.readListMindmap(list);
    check.equal(model.root.virtual, true);
    check.equal(model.root.id, list.dataset.nodeId);
    check.equal(model.root.children.length, 2);
    const parent = model.root.children[0];
    check.equal(parent.contentBlocks.length, 2);
    check.equal(parent.children.length, 1);
    check.equal(parent.children[0].children.length, 1);
    const beforeRead = list.outerHTML;
    check.equal(api.readListMindmap(list).nodes.get(parent.id).element, parent.element);
    check.equal(list.outerHTML, beforeRead);
    check.throws(() => api.readListMindmap(parent.element), /requires a list block/);

    // 移动子树保持正文对象、块 ID、引用和自定义属性，并拒绝循环及跨树目标。
    parent.contentBlocks[0].setAttribute("custom-preserve", "value");
    const source = parent.children[0];
    const sibling = model.root.children[1];
    const sourceHTML = source.element.outerHTML;
    const previousChildListId = source.element.parentElement.dataset.nodeId;
    const allIds = ids(list);
    check.equal(api.moveListMindmapNode(list, parent.id, source.id, "child"), false);
    check.equal(api.moveListMindmapNode(list, source.id, "not-in-this-tree", "child"), false);
    check.equal(api.moveListMindmapNode(list, source.id, sibling.id, "child", () => Lute.NewNodeID()), true);
    model = api.readListMindmap(list);
    check.equal(model.nodes.get(sibling.id).children[0].element, source.element);
    check.equal(source.element.outerHTML, sourceHTML);
    check.equal(parent.contentBlocks[0].getAttribute("custom-preserve"), "value");
    check.equal(parent.element.querySelector(':scope > [data-type="NodeList"]'), null);
    check.deepEqual(ids(list).filter(id => id !== source.element.parentElement.dataset.nodeId).sort(),
        allIds.filter(id => id !== previousChildListId).sort());

    // 有序列表移动首项时保留原起始编号，目标列表同时重新编号。
    list = reset("0. First\n1. Second\n2. Third\n");
    model = api.readListMindmap(list);
    const [first, second, third] = model.root.children;
    check.equal(api.moveListMindmapNode(list, first.id, third.id, "after"), true);
    check.deepEqual(Array.from(list.querySelectorAll(':scope > [data-type="NodeListItem"]')).map((item: Element) =>
        item.getAttribute("data-marker")), ["0.", "1.", "2."]);
    check.equal(api.readListMindmap(list).root.children[2].id, first.id);
    check.equal(api.moveListMindmapNode(list, third.id, second.id, "child", () => Lute.NewNodeID()), true);
    check.equal(third.element.getAttribute("data-marker"), "1.");
    check.equal(third.element.parentElement.getAttribute("data-subtype"), "o");
    check.deepEqual(Array.from(list.querySelectorAll(':scope > [data-type="NodeListItem"]')).map((item: Element) =>
        item.getAttribute("data-marker")), ["0.", "1."]);

    // 删除节点同步清理已删除子树的关系线和样式，其他关系及最后一个实际节点保留。
    list.setAttribute("custom-sy-list-mindmap-data", JSON.stringify({version: 1,
        nodes: {[second.id]: {bold: true}, [third.id]: {textColor: "red"}, [first.id]: {italic: true}},
        relations: [{id: "r1", from: second.id, to: first.id, label: "remove"},
            {id: "r2", from: third.id, to: first.id, label: "remove child"},
            {id: "r3", from: first.id, to: list.dataset.nodeId, label: "retain"}]}));
    check.equal(api.deleteListMindmapNode(list, second.id), true);
    model = api.readListMindmap(list);
    check.equal(model.root.id, first.id);
    check.equal(model.root.virtual, false);
    check.equal(model.metadata.nodes[third.id], undefined);
    check.deepEqual(model.metadata.nodes[first.id], {italic: true});
    check.deepEqual(model.metadata.relations.map((relation: {id: string}) => relation.id), ["r3"]);
    check.equal(api.deleteListMindmapNode(list, first.id), false);
    const inserted = reset("* New\n").firstElementChild as HTMLElement;
    check.equal(api.addListMindmapNode(list, first.id, "child", inserted, () => Lute.NewNodeID()), true);
    check.equal(inserted.dataset.subtype, "o");
    check.equal(inserted.dataset.marker, "1.");

    // 未知版本或损坏配置在任何编辑之前报错，原内容保持不变。
    list.setAttribute("custom-sy-list-mindmap-data", '{"version":2,"nodes":{},"relations":[]}');
    const corrupt = list.outerHTML;
    check.throws(() => api.moveListMindmapNode(list, inserted.dataset.nodeId, first.id, "after"), /metadata/);
    check.throws(() => api.deleteListMindmapNode(list, inserted.dataset.nodeId), /metadata/);
    check.equal(list.outerHTML, corrupt);

    // 正文编辑保留所有原块身份、属性和复杂内联内容，并保留穿插子列表的对象及位置。
    list = reset("* Parent\n\n  Second paragraph\n\n  * Child\n\n* Sibling\n");
    model = api.readListMindmap(list);
    const editable = model.root.children[0];
    const originalBlocks: HTMLElement[] = editable.contentBlocks;
    const childList = editable.element.querySelector(':scope > [data-type="NodeList"]');
    const childHTML = childList.outerHTML;
    originalBlocks[0].setAttribute("custom-preserve", "custom");
    originalBlocks[0].setAttribute("name", "named");
    originalBlocks[0].setAttribute("style", "color: red;");
    const rich = originalBlocks[0].querySelector('[contenteditable="true"]');
    rich.innerHTML = '<span data-type="block-ref" data-id="20260916000000-abcdefg" data-subtype="s">Reference</span>' +
        '<span class="img"><img src="assets/image.png" alt="image"></span><span data-type="code">literal</span>';
    const replacement = originalBlocks.map(block => block.cloneNode(true) as HTMLElement);
    replacement[0].removeAttribute("custom-preserve");
    replacement[0].removeAttribute("name");
    replacement[0].removeAttribute("style");
    replacement[1].querySelector('[contenteditable="true"]').textContent = "Updated";
    const extra = document.createElement("div");
    extra.innerHTML = lute.Md2BlockDOM("New paragraph\n");
    const added = extra.firstElementChild as HTMLElement;
    const editHTML = replacement.map(block => block.outerHTML).join("") + added.outerHTML + "<wbr>";
    const activeEditor = document.createElement("div");
    activeEditor.className = "list-mindmap";
    activeEditor.innerHTML = editHTML;
    list.appendChild(activeEditor);
    check.equal(api.replaceListMindmapContent(list, editable.id, editHTML), true);
    activeEditor.remove();
    const edited = api.readListMindmap(list).nodes.get(editable.id);
    check.equal(edited.contentBlocks.length, 3);
    check.equal(edited.contentBlocks[0].dataset.nodeId, originalBlocks[0].dataset.nodeId);
    check.equal(edited.contentBlocks[0].getAttribute("custom-preserve"), "custom");
    check.equal(edited.contentBlocks[0].getAttribute("name"), "named");
    check.equal(edited.contentBlocks[0].getAttribute("style"), "color: red;");
    check.equal(edited.contentBlocks[0].querySelector('[data-type="block-ref"]').getAttribute("data-id"), "20260916000000-abcdefg");
    check.equal(edited.contentBlocks[0].querySelector("img").getAttribute("src"), "assets/image.png");
    check.equal(edited.contentBlocks[0].querySelector('[data-type="code"]').textContent, "literal");
    check.equal(edited.contentBlocks[1].dataset.nodeId, originalBlocks[1].dataset.nodeId);
    check.equal(edited.contentBlocks[2].dataset.nodeId, added.dataset.nodeId);
    check.equal(editable.element.querySelector(':scope > [data-type="NodeList"]'), childList);
    check.equal(childList.outerHTML, childHTML);
    const codeSettingHolder = document.createElement("div");
    codeSettingHolder.innerHTML = lute.Md2BlockDOM("- Parent\n\n  ```js\n  x\n  ```\n");
    const codeSettingList = codeSettingHolder.firstElementChild as HTMLElement;
    const codeSettingNode = api.readListMindmap(codeSettingList).root;
    const codeSettingBlocks: HTMLElement[] = codeSettingNode.contentBlocks.map((block: HTMLElement) =>
        block.cloneNode(true) as HTMLElement);
    const settingCode = codeSettingBlocks.find(block => block.dataset.type === "NodeCodeBlock");
    check.ok(settingCode);
    const codeSettingID = settingCode.dataset.nodeId;
    const oldCodeSettings = codeSettingList.outerHTML;
    const codeSettings = [["linewrap", "false"], ["ligatures", "true"], ["linenumber", "false"],
        ["custom-sy-code-tab-spaces", "2"]];
    for (const [name, value] of codeSettings) {
        settingCode.setAttribute(name, value);
    }
    check.equal(api.replaceListMindmapContent(codeSettingList, codeSettingNode.id,
        codeSettingBlocks.map(block => block.outerHTML).join("")), true);
    const newCodeSettings = codeSettingList.outerHTML;
    for (const html of [newCodeSettings, oldCodeSettings, newCodeSettings]) {
        const roundTrip = document.createElement("div");
        roundTrip.innerHTML = lute.Md2BlockDOM(lute.BlockDOM2Md(html));
        const restoredCode = roundTrip.querySelector(`[data-node-id="${codeSettingID}"]`);
        check.ok(restoredCode, "code settings keep the source block identity");
        for (const [name, value] of codeSettings) {
            check.equal(restoredCode.getAttribute(name), html === oldCodeSettings ? null : value,
                "source snapshots restore code settings through undo and redo");
        }
    }
    settingCode.removeAttribute("custom-sy-code-tab-spaces");
    check.equal(api.replaceListMindmapContent(codeSettingList, codeSettingNode.id,
        codeSettingBlocks.map(block => block.outerHTML).join("")), true);
    const resetCodeSettings = codeSettingList.outerHTML;
    const resetCodeHolder = document.createElement("div");
    resetCodeHolder.innerHTML = lute.Md2BlockDOM(lute.BlockDOM2Md(resetCodeSettings));
    check.equal(resetCodeHolder.querySelector(`[data-node-id="${codeSettingID}"]`)
        .hasAttribute("custom-sy-code-tab-spaces"), false, "default Tab spacing removes the saved override");
    for (const html of [newCodeSettings, resetCodeSettings]) {
        resetCodeHolder.innerHTML = lute.Md2BlockDOM(lute.BlockDOM2Md(html));
        check.equal(resetCodeHolder.querySelector(`[data-node-id="${codeSettingID}"]`)
            .getAttribute("custom-sy-code-tab-spaces"), html === newCodeSettings ? "2" : null);
    }
    const nestedTaskHolder = document.createElement("div");
    lute.SetDataTask(true);
    nestedTaskHolder.innerHTML = lute.Md2BlockDOM("- Node\n\n  > - [ ] Nested task\n");
    const nestedTaskList = nestedTaskHolder.firstElementChild as HTMLElement;
    const nestedTaskModel = api.readListMindmap(nestedTaskList);
    const nestedContent: HTMLElement[] = nestedTaskModel.root.contentBlocks.map((block: HTMLElement) => block.cloneNode(true) as HTMLElement);
    const nestedTask = nestedContent.find((block: HTMLElement) => block.dataset.type === "NodeBlockquote")
        .querySelector<HTMLElement>('.li[data-subtype="t"]');
    nestedTask.setAttribute("data-task", "X");
    nestedTask.classList.add("protyle-task--done");
    nestedTask.querySelector(".protyle-action--task").setAttribute("data-task", "X");
    check.equal(api.replaceListMindmapContent(nestedTaskList, nestedTaskModel.root.id,
        nestedContent.map((block: HTMLElement) => block.outerHTML).join("")), true);
    check.equal(nestedTaskList.querySelector('.li[data-subtype="t"]').getAttribute("data-task"), "X",
        "saving rich content retains its edited nested task marker");
    check.equal(list.querySelector("wbr"), null);
    const beforeRejectedEdit = list.outerHTML;
    check.equal(api.replaceListMindmapContent(list, editable.id, childHTML), false);
    check.equal(api.replaceListMindmapContent(list, editable.id, edited.contentBlocks[0].outerHTML.repeat(2)), false);
    check.equal(api.replaceListMindmapContent(list, editable.id, ""), false);
    check.equal(list.outerHTML, beforeRejectedEdit);
    extra.innerHTML = lute.Md2BlockDOM("* New child\n");
    check.equal(api.replaceListMindmapContent(list, editable.id,
        edited.contentBlocks.map((block: HTMLElement) => block.outerHTML).join("") + extra.innerHTML), true);
    check.equal(api.readListMindmap(list).nodes.get(editable.id).children.length, 2);
    check.equal(childList.outerHTML, childHTML);

    // 渲染和编辑标记不会进入持久化 DOM，列表视图属性及关系线配置仍然保留。
    list.setAttribute("custom-sy-list-mindmap", "1");
    list.setAttribute("data-list-mindmap-rendered", "true");
    list.setAttribute("data-list-mindmap-editing", "true");
    const derived = document.createElement("div");
    derived.className = "list-mindmap";
    derived.innerHTML = '<div class="list-mindmap__editor">Derived editor</div>';
    list.appendChild(derived);
    list.appendChild(document.createComment("list-mindmap"));
    list.appendChild(document.createComment("unrelated list-mindmap comment"));
    const cleaned = api.cleanListMindmapHTML(list.outerHTML);
    // 列表转换只接收源块，脑图工具栏、画布和节点预览不能传给 Lute。
    for (const [markdown, conversions] of [
        ["* Alpha\n* Beta\n", [["OL2UL", "u"], ["UL2OL", "o"], ["UL2TL", "t"]]],
        ["1. Alpha\n2. Beta\n", [["OL2UL", "u"], ["UL2OL", "o"], ["UL2TL", "t"]]],
        ["* [ ] Alpha\n* [x] Beta\n", [["OL2UL", "u"], ["UL2OL", "o"], ["UL2TL", "t"]]],
    ] as [string, [string, string][]][]) {
        const source = document.createElement("div");
        source.innerHTML = lute.Md2BlockDOM(markdown);
        const sourceList = source.firstElementChild;
        sourceList.setAttribute("custom-sy-list-mindmap", "1");
        sourceList.setAttribute("data-list-mindmap-rendered", "true");
        const metadata = JSON.stringify({version: 1, nodes: {}, relations: [], rootTitle: "Example"});
        sourceList.setAttribute("custom-sy-list-mindmap-data", metadata);
        sourceList.prepend(derived.cloneNode(true));
        for (const [conversion, subtype] of conversions) {
            const converted = document.createElement("div");
            converted.innerHTML = api.convertListMindmapToList(sourceList, conversion, lute);
            const result = converted.firstElementChild;
            check.equal(result.getAttribute("data-subtype"), subtype);
            check.equal(result.getAttribute("data-node-id"), sourceList.getAttribute("data-node-id"));
            check.equal(result.getAttribute("custom-sy-list-mindmap"), null);
            check.equal(sourceList.getAttribute("custom-sy-list-mindmap"), "1", "undo source retains mind map view");
            check.equal(result.getAttribute("custom-sy-list-mindmap-data"), metadata);
            check.equal(result.querySelector(".list-mindmap"), null);
            check.equal(result.hasAttribute("data-list-mindmap-rendered"), false);
            check.ok(result.textContent.includes("Alpha") && result.textContent.includes("Beta"));
        }
    }
    check.equal(cleaned.includes("Derived editor"), false);
    check.equal(cleaned.includes("data-list-mindmap-rendered"), false);
    check.equal(cleaned.includes("data-list-mindmap-editing"), false);
    check.equal(cleaned.includes("<!--list-mindmap-->"), false);
    check.equal(cleaned.includes("<!--unrelated list-mindmap comment-->"), true);
    check.equal(cleaned.includes('custom-sy-list-mindmap="1"'), true);
    check.ok(list.contains(derived));
    check.equal(api.cleanListMindmapHTML("<div>unrelated</div>"), "<div>unrelated</div>");
    check.ok(lute.BlockDOM2Md(cleaned).includes("New child"));

    // 复制后关系线与节点样式引用新块 ID，遇到任一损坏配置时不进行部分迁移。
    const copiedRoute = {version: 1, points: [{x: -35, y: 20, t: .5}], extension: "keep"};
    list.setAttribute("custom-sy-list-mindmap-data", JSON.stringify({version: 1, extension: "keep",
        nodes: {a: {bold: true}, b: {italic: true}, deleted: {bold: true}},
        relations: [{id: "relation", from: "a", to: "b", label: "keep", route: copiedRoute},
            {id: "orphan", from: "a", to: "deleted", label: "remove"}]}));
    const copiedItems = list.querySelectorAll('[data-type="NodeListItem"]');
    copiedItems[0].setAttribute("data-node-id", "new-a");
    copiedItems[1].setAttribute("data-node-id", "new-b");
    const child = list.querySelector('[data-type="NodeList"]');
    child.setAttribute("custom-sy-list-mindmap-data", '{"version":2,"nodes":{},"relations":[]}');
    const beforeRemap = list.outerHTML;
    check.throws(() => api.remapListMindmapIDs(list, new Map([["a", "new-a"], ["b", "new-b"]])), /metadata/);
    check.equal(list.outerHTML, beforeRemap);
    child.removeAttribute("custom-sy-list-mindmap-data");
    api.remapListMindmapIDs(list, new Map([["a", "new-a"], ["b", "new-b"]]));
    const remapped = JSON.parse(list.getAttribute("custom-sy-list-mindmap-data"));
    check.deepEqual(remapped.nodes, {"new-a": {bold: true}, "new-b": {italic: true}});
    check.deepEqual(remapped.relations, [{id: "relation", from: "new-a", to: "new-b", label: "keep", route: copiedRoute}]);
    check.equal(remapped.extension, "keep");
    check.equal(list.querySelector(".list-mindmap"), null);
    check.equal(list.hasAttribute("data-list-mindmap-rendered"), false);
    check.equal(list.hasAttribute("data-list-mindmap-editing"), false);
    check.equal(list.outerHTML.includes("<!--list-mindmap-->"), false);

    // 使用真实布局和事件验证单击拖拽、双击挂载、撤销入口、只读折叠及全屏还原。
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const hostParent = document.createElement("div");
    hostParent.style.width = "760px";
    const host = document.createElement("div");
    hostParent.append(host);
    document.body.append(hostParent);
    list = reset("* Alpha\n  * Child\n* Beta\n");
    model = api.readListMindmap(list);
    const alpha = model.root.children[0].id;
    const beta = model.root.children[1].id;
    const edits: string[] = [];
    const moves: unknown[] = [];
    const additions: unknown[] = [];
    const folds: string[] = [];
    const deletions: string[] = [];
    const relationDeletions: string[] = [];
    const relationAdditions: unknown[] = [];
    const relationChanges: unknown[] = [];
    const nodeStyles: unknown[] = [];
    const fullscreenChanges: boolean[] = [];
    let interactions = 0;
    let undo = 0;
    let redo = 0;
    let finishAllowed: boolean | Promise<boolean> = true;
    const options = {
        host, model,
        labels: new Proxy({}, {get: (_target, key) => String(key)}),
        colors: () => [{label: "Appearance background", value: "var(--b3-font-background1)"}],
        nodeColors: () => [{label: "Appearance combined", color: "var(--b3-font-color1)",
            backgroundColor: "var(--b3-font-background1)", preview: {color: "#112233", backgroundColor: "#ddeeff"}}],
        onFullscreen: (enter: boolean) => fullscreenChanges.push(enter),
        onInteractionStart: () => {
            interactions++;
            return () => interactions--;
        },
        onEdit: (id: string) => edits.push(id),
        finishEdit: () => finishAllowed,
        onMove: (...args: unknown[]) => moves.push(args),
        onAdd: (...args: unknown[]) => additions.push(args),
        onDelete: (id: string) => deletions.push(id),
        onFold: (id: string) => folds.push(id),
        onUndo: () => undo++,
        onRedo: () => redo++,
        onNodeStyle: (...args: unknown[]) => nodeStyles.push(args),
        onRelationAdd: (...args: unknown[]) => relationAdditions.push(args),
        onRelationChange: (...args: unknown[]) => relationChanges.push(args),
        onRelationDelete: (id: string) => relationDeletions.push(id),
        onExit: (): void => undefined,
    };
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const settle = async () => { await frame(); await frame(); };
    const view = new api.ListMindmapView(options);
    await settle();
    const viewport = host.querySelector<HTMLElement>(".list-mindmap__viewport");
    check.equal(viewport.getAttribute("data-prevent-swipe"), "true");
    const originalCapture = HTMLElement.prototype.setPointerCapture;
    const originalHasCapture = HTMLElement.prototype.hasPointerCapture;
    const originalReleaseCapture = HTMLElement.prototype.releasePointerCapture;
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.hasPointerCapture = () => false;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
    const nodeElement = (id: string) => host.querySelector<HTMLElement>(`[data-mindmap-id="${id}"]`);
    const compactNode = nodeElement(alpha);
    compactNode.style.minHeight = "0";
    compactNode.style.height = "32px";
    view.refreshLayout();
    await settle();
    check.equal(view.positions.get(alpha).height, compactNode.offsetHeight,
        "connection geometry uses the actual compact node height");
    const compactPositions = JSON.stringify([...view.positions]);
    view.setEditing(alpha);
    await settle();
    check.equal(JSON.stringify([...view.positions]), compactPositions, "entering edit mode preserves connection geometry");
    view.setEditing(undefined);
    await settle();
    check.equal(JSON.stringify([...view.positions]), compactPositions, "leaving edit mode preserves connection geometry");
    compactNode.style.minHeight = "";
    compactNode.style.height = "";
    view.refreshLayout();
    await settle();
    const sendPointer = (element: Element, type: string, x: number, y: number, button = 0) => element.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button, clientX: x, clientY: y,
    }));
    const sourceRect = nodeElement(alpha).getBoundingClientRect();
    const targetRect = nodeElement(beta).getBoundingClientRect();
    const sourcePoint = {x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2};
    const targetPoint = {x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2};
    check.ok(sourceRect.width >= 32 && sourceRect.height >= 32);
    check.equal(host.querySelector("[data-node-id]"), null);
    sendPointer(nodeElement(alpha), "pointerdown", sourcePoint.x, sourcePoint.y);
    check.equal(interactions, 1, "hover is suspended before the drag threshold");
    sendPointer(viewport, "pointerup", sourcePoint.x, sourcePoint.y);
    check.equal(interactions, 0);
    check.equal(edits.length, 0);
    check.equal(moves.length, 0);

    for (const type of ["pointercancel", "lostpointercapture"]) {
        sendPointer(nodeElement(alpha), "pointerdown", sourcePoint.x, sourcePoint.y);
        check.equal(interactions, 1);
        viewport.dispatchEvent(new PointerEvent(type, {pointerId: 1, bubbles: true}));
        check.equal(interactions, 0, type);
        check.equal(view.pointer, undefined);
    }
    sendPointer(nodeElement(alpha), "pointerdown", sourcePoint.x, sourcePoint.y);
    window.dispatchEvent(new Event("blur"));
    check.equal(interactions, 0, "losing window focus resumes hover");
    check.equal(view.pointer, undefined);

    let finishPendingEdit: (result: boolean) => void;
    finishAllowed = new Promise(resolve => finishPendingEdit = resolve);
    sendPointer(nodeElement(alpha), "pointerdown", sourcePoint.x, sourcePoint.y);
    check.equal(interactions, 1, "pending editor commits also suspend hover");
    sendPointer(document.body, "pointerup", sourcePoint.x, sourcePoint.y);
    check.equal(interactions, 0, "releasing outside the canvas cancels a pending interaction");
    finishPendingEdit(true);
    await settle();
    check.equal(view.pointer, undefined);
    finishAllowed = true;

    const cancelledHost = document.createElement("div");
    document.body.append(cancelledHost);
    const cancelledView = new api.ListMindmapView({...options, host: cancelledHost});
    sendPointer(cancelledHost.querySelector(".list-mindmap__viewport"), "pointerdown", 5, 5);
    check.equal(interactions, 1);
    cancelledView.destroy();
    cancelledHost.remove();
    check.equal(interactions, 0, "destroying a view releases its interaction");
    const panOrigin = {x: view.offsetX, y: view.offsetY};
    sendPointer(nodeElement(alpha), "pointerdown", sourcePoint.x, sourcePoint.y, 2);
    sendPointer(viewport, "pointermove", sourcePoint.x + 30, sourcePoint.y + 20, 2);
    check.equal(view.offsetX, panOrigin.x + 30, "right drag pans over nodes");
    check.equal(view.offsetY, panOrigin.y + 20, "right drag pans vertically");
    check.equal(host.querySelector(".list-mindmap__ghost"), null);
    sendPointer(viewport, "pointerup", sourcePoint.x + 30, sourcePoint.y + 20, 2);
    const contextMenu = new MouseEvent("contextmenu", {bubbles: true, cancelable: true});
    viewport.dispatchEvent(contextMenu);
    check.equal(contextMenu.defaultPrevented, true, "right pan suppresses the native menu");
    check.equal(moves.length, 0, "right pan does not move nodes");
    view.offsetX = panOrigin.x;
    view.offsetY = panOrigin.y;
    view.draw();
    sendPointer(nodeElement(alpha), "pointerdown", sourcePoint.x, sourcePoint.y);
    sendPointer(viewport, "pointermove", targetPoint.x, targetPoint.y);
    check.ok(host.querySelector(".list-mindmap__ghost"));
    check.equal(nodeElement(beta).dataset.mindmapDrop, "child");
    sendPointer(viewport, "pointerup", targetPoint.x, targetPoint.y);
    check.deepEqual(moves, [[alpha, beta, "child"]]);
    check.equal(host.querySelector(".list-mindmap__ghost"), null);
    sendPointer(nodeElement(alpha), "pointerdown", sourcePoint.x, sourcePoint.y);
    sendPointer(viewport, "pointermove", targetPoint.x, targetPoint.y);
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    sendPointer(viewport, "pointerup", targetPoint.x, targetPoint.y);
    check.equal(moves.length, 1);
    nodeElement(alpha).dispatchEvent(new MouseEvent("dblclick", {bubbles: true, cancelable: true}));
    check.deepEqual(edits, [alpha]);
    const editorHost = view.getContentHost(alpha);
    const editorMarker = document.createElement("div");
    editorMarker.className = "protyle";
    editorHost.replaceChildren(editorMarker);
    view.update(api.readListMindmap(list));
    check.equal(view.getContentHost(alpha).firstElementChild, editorMarker);
    view.setEditing();
    view.update(api.readListMindmap(list));
    check.equal(host.querySelector('[aria-label="undo"]'), null);
    check.equal(host.querySelector('[aria-label="redo"]'), null);
    check.equal(undo, 0);
    check.equal(redo, 0);
    finishAllowed = false;
    nodeElement(alpha).querySelector<HTMLButtonElement>(".list-mindmap__add-child").click();
    check.equal(additions.length, 0);
    finishAllowed = true;
    nodeElement(alpha).querySelector<HTMLButtonElement>(".list-mindmap__add-child").click();
    check.equal(additions.length, 1, "add callback after finishing editing");

    // 悬浮添加按钮不改变拖拽和双击语义，未选中节点也必须使用自身 ID 添加子节点。
    const nativeInput = (events: Record<string, unknown>[]) =>
        require("electron").ipcRenderer.invoke("list-mindmap-native-input", events);
    const centerPoint = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return {x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2)};
    };
    const moveMouse = async (element?: Element) => {
        await nativeInput([{type: "mouseMove", ...(element ? centerPoint(element) : {x: 2, y: 2})}]);
        await settle();
    };
    const clickMouse = async (element: Element) => {
        const point = centerPoint(element);
        await nativeInput([
            {type: "mouseMove", ...point},
            {type: "mouseDown", ...point, button: "left", clickCount: 1},
            {type: "mouseUp", ...point, button: "left", clickCount: 1},
        ]);
        await settle();
    };
    const addChildButton = (id: string) => nodeElement(id).querySelector<HTMLButtonElement>(".list-mindmap__add-child");
    const visiblyRendered = (element: HTMLElement) => {
        const computed = getComputedStyle(element);
        return !element.hidden && computed.display !== "none" && computed.visibility !== "hidden" &&
            Number(computed.opacity) > 0;
    };
    const betaAdd = addChildButton(beta);
    check.ok(betaAdd, "each editable node has its own add-child control");
    await moveMouse();
    check.equal(visiblyRendered(betaAdd), false, "add-child control is hidden before hovering");
    check.equal(nodeElement(beta).getAttribute("aria-selected"), "false");
    await moveMouse(nodeElement(beta));
    check.equal(visiblyRendered(betaAdd), true, "hovering the node exposes its add-child control");
    const betaRect = nodeElement(beta).getBoundingClientRect();
    const betaButtonRect = betaAdd.getBoundingClientRect();
    const nodeScale = betaRect.width / nodeElement(beta).offsetWidth;
    check.ok((betaButtonRect.left - betaRect.right) / nodeScale <= 5,
        "leaf add controls stay close to the node edge");
    await nativeInput([{type: "mouseMove", x: Math.round((betaRect.right + betaButtonRect.left) / 2),
        y: Math.round(betaButtonRect.top + betaButtonRect.height / 2)}]);
    await settle();
    check.equal(visiblyRendered(betaAdd), true, "crossing the gap to the add control keeps it visible");
    await nativeInput([{type: "mouseMove", x: Math.round((betaRect.right + betaButtonRect.left) / 2),
        y: Math.round(betaRect.top + 2)}]);
    await settle();
    check.equal(visiblyRendered(betaAdd), true, "the hover corridor covers the full node height");
    check.equal(host.querySelector<HTMLElement>('[role="tooltip"]').hidden, true,
        "the gap is not part of the clickable add button");
    await moveMouse(betaAdd);
    check.equal(visiblyRendered(betaAdd), true, "moving onto the protruding control keeps it visible");
    const buttonPoint = centerPoint(betaAdd);
    check.equal(document.elementFromPoint(buttonPoint.x, buttonPoint.y)?.closest(".list-mindmap__add-child"), betaAdd,
        "the visible add-child control remains pointer-accessible outside the node edge");
    const hoverTooltip = host.querySelector<HTMLElement>('[role="tooltip"]');
    check.equal(hoverTooltip.hidden, false);
    betaAdd.dispatchEvent(new PointerEvent("pointerout", {bubbles: true, relatedTarget: betaAdd.querySelector("svg")}));
    check.equal(hoverTooltip.hidden, false, "moving from the button to its icon must not hide the tooltip");
    betaAdd.querySelector("svg").dispatchEvent(new PointerEvent("pointerover", {bubbles: true, relatedTarget: betaAdd}));
    check.equal(hoverTooltip.hidden, false);
    const beforeButtonEdits = edits.length;
    const beforeButtonMoves = moves.length;
    await clickMouse(betaAdd);
    check.deepEqual(additions[additions.length - 1], [beta, "child"]);
    check.equal(edits.length, beforeButtonEdits);
    check.equal(moves.length, beforeButtonMoves);
    check.equal(host.querySelector(".list-mindmap__ghost"), null);
    betaAdd.dispatchEvent(new MouseEvent("dblclick", {bubbles: true, cancelable: true}));
    check.equal(edits.length, beforeButtonEdits, "double clicking the add control does not open a node editor");
    finishAllowed = false;
    const beforeRejectedAddition = additions.length;
    await clickMouse(betaAdd);
    check.equal(additions.length, beforeRejectedAddition, "a pending edit prevents adding a child");
    finishAllowed = true;
    view.setReadOnly(true);
    await settle();
    host.querySelectorAll<HTMLButtonElement>(".list-mindmap__add-child").forEach(button => {
        check.equal(visiblyRendered(button), false, "read-only nodes hide their add-child controls");
        button.click();
    });
    check.equal(additions.length, beforeRejectedAddition, "read-only add controls cannot invoke mutations");
    view.setReadOnly(false);
    await settle();
    await moveMouse(nodeElement(beta));
    check.equal(visiblyRendered(addChildButton(beta)), true, "restoring editing restores the hover control");
    await clickMouse(addChildButton(beta));
    check.equal(additions.length, beforeRejectedAddition + 1);
    check.deepEqual(additions[additions.length - 1], [beta, "child"]);
    // 鼠标从节点右下角斜向移出时，过渡区域必须连续，不能先落到连线上导致按钮消失。
    view.clearSelection();
    await moveMouse(nodeElement(alpha));
    const branchRect = nodeElement(alpha).getBoundingClientRect();
    const branchScale = branchRect.width / nodeElement(alpha).offsetWidth;
    const cornerPoint = {x: Math.round(branchRect.right - 3 * branchScale),
        y: Math.round(branchRect.bottom + 3 * branchScale)};
    await nativeInput([{type: "mouseMove", ...cornerPoint}]);
    await settle();
    const expandedFold = nodeElement(alpha).querySelector<HTMLButtonElement>(".list-mindmap__fold");
    check.equal(visiblyRendered(expandedFold), true, "the lower inner corner keeps the fold control visible");
    check.equal(document.elementFromPoint(cornerPoint.x, cornerPoint.y)?.closest(".list-mindmap__node"), nodeElement(alpha),
        "the lower corner selects the node instead of its connection");
    await moveMouse(expandedFold);
    const expandedPoint = centerPoint(expandedFold);
    check.equal(document.elementFromPoint(expandedPoint.x, expandedPoint.y)?.closest("button"), expandedFold);
    await clickMouse(nodeElement(alpha));
    await moveMouse();
    check.equal(visiblyRendered(expandedFold), true, "selected nodes keep their fold control visible without hovering");
    check.equal(visiblyRendered(addChildButton(alpha)), true);
    model.nodes.get(alpha).collapsed = true;
    view.update(model);
    await settle();
    await moveMouse(nodeElement(alpha));
    check.equal(visiblyRendered(addChildButton(alpha)), true, "folded nodes retain their add-child control");
    const foldButton = nodeElement(alpha).querySelector<HTMLButtonElement>(".list-mindmap__fold");
    const foldPoint = centerPoint(foldButton);
    check.equal(document.elementFromPoint(foldPoint.x, foldPoint.y)?.closest(".list-mindmap__fold"), foldButton,
        "the hover bridge does not cover the neighboring fold control");
    const beforeFoldAdditions = additions.length;
    await clickMouse(foldButton);
    check.deepEqual(folds, [alpha]);
    check.equal(additions.length, beforeFoldAdditions, "clicking fold must not add a child");
    await clickMouse(addChildButton(alpha));
    check.deepEqual(additions[additions.length - 1], [alpha, "child"]);
    check.equal(edits.length, beforeButtonEdits);
    check.equal(moves.length, beforeButtonMoves);

    // 删除只作用于选中的节点，编辑输入、只读状态及取消选中后均不得删除正文。
    const pressDelete = (target: Element = host, init: KeyboardEventInit = {}) =>
        target.dispatchEvent(new KeyboardEvent("keydown", {key: "Delete", bubbles: true, cancelable: true, ...init}));
    const select = (id: string) => {
        const point = centerPoint(nodeElement(id));
        sendPointer(nodeElement(id), "pointerdown", point.x, point.y);
        sendPointer(viewport, "pointerup", point.x, point.y);
    };
    select(beta);
    const beforeShortcuts = additions.length;
    const navigate = (key: string) => host.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}));
    navigate("ArrowUp");
    check.equal(view.selectedId, alpha);
    navigate("ArrowRight");
    check.equal(view.selectedId, alpha, "folded descendants cannot receive keyboard selection");
    navigate("ArrowUp");
    check.equal(view.selectedId, alpha, "navigation does not wrap at sibling boundaries");
    navigate("ArrowLeft");
    check.equal(view.selectedId, model.root.id);
    navigate("ArrowRight");
    check.equal(view.selectedId, alpha);
    model.nodes.get(alpha).collapsed = false;
    view.update(model);
    navigate("ArrowRight");
    check.equal(view.selectedId, model.nodes.get(alpha).children[0].id);
    navigate("ArrowLeft");
    navigate("ArrowDown");
    check.equal(view.selectedId, beta);
    const beforeSpaceEdit = edits.length;
    view.setReadOnly(true);
    navigate(" ");
    check.equal(edits.length, beforeSpaceEdit);
    view.setReadOnly(false);
    navigate(" ");
    check.equal(edits[edits.length - 1], beta, "space opens the selected node editor");
    navigate("ArrowUp");
    check.equal(view.selectedId, beta, "editing keeps arrow keys inside the editor");
    view.setEditing();
    select(model.root.id);
    navigate(" ");
    const titleInput = host.querySelector<HTMLTextAreaElement>(".list-mindmap__root-title");
    check.ok(titleInput);
    check.equal(titleInput.selectionStart, titleInput.value.length);
    check.equal(titleInput.selectionEnd, titleInput.value.length);
    titleInput.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    check.equal(document.activeElement, host);
    edits.length = beforeSpaceEdit;
    model.nodes.get(alpha).collapsed = true;
    view.update(model);
    select(beta);
    const originalEditable = host.parentElement.contentEditable;
    host.parentElement.contentEditable = "true";
    for (const key of ["Tab", "Enter"]) {
        const event = new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true});
        host.dispatchEvent(event);
        check.equal(event.defaultPrevented, true, "nested mindmap handles keys instead of moving toolbar focus");
    }
    check.deepEqual(additions.slice(beforeShortcuts), [[beta, "child"], [beta, "sibling"]]);
    view.setEditing(beta);
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Tab", bubbles: true}));
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    check.equal(additions.length, beforeShortcuts + 2, "editing does not create nodes via selection shortcuts");
    view.setEditing();
    additions.length = beforeShortcuts;
    host.parentElement.contentEditable = originalEditable;
    const blank = () => {
        const rect = viewport.getBoundingClientRect();
        sendPointer(viewport, "pointerdown", rect.left + 5, rect.top + 5);
        sendPointer(viewport, "pointerup", rect.left + 5, rect.top + 5);
    };
    select(beta);
    pressDelete();
    check.deepEqual(deletions, [beta]);
    finishAllowed = false;
    pressDelete();
    finishAllowed = true;
    pressDelete(host, {isComposing: true});
    pressDelete(host, {ctrlKey: true});
    view.setEditing(beta);
    pressDelete(view.getContentHost(beta));
    view.setEditing();
    check.deepEqual(deletions, [beta]);
    let finishDelete: () => void;
    finishAllowed = new Promise<boolean>(resolve => finishDelete = () => resolve(true));
    pressDelete();
    blank();
    finishDelete();
    await settle();
    finishAllowed = true;
    check.deepEqual(deletions, [beta], "a pending deletion cannot follow a changed selection");
    view.update(model);
    check.equal(host.querySelector(".list-mindmap__node--selected"), null);
    pressDelete();
    check.deepEqual(deletions, [beta]);
    select(model.root.id);
    pressDelete();
    check.deepEqual(deletions, [beta], "virtual root cannot be deleted");

    // 面板外部点击关闭设置，外观颜色保存变量引用并解析为画布可用的实际颜色。
    const toolbar = host.querySelector(".list-mindmap__toolbar");
    ["listMindmapChild", "delete", "fold"].forEach(label =>
        check.equal(toolbar.querySelector(`[aria-label="${label}"]`), null));
    const relationButton = toolbar.querySelector<HTMLButtonElement>('[aria-label="connect"]');
    const toolbarPanButton = toolbar.querySelector<HTMLButtonElement>('[aria-label="cursorHand"]');
    check.equal(relationButton.nextElementSibling, toolbarPanButton);
    check.ok(toolbarPanButton.nextElementSibling.classList.contains("list-mindmap__zoom-control"));
    check.equal(relationButton.querySelector("use").getAttribute("xlink:href"), "#iconRoute");
    const inspector = host.querySelector<HTMLElement>(".list-mindmap__inspector");
    const fitButton = toolbar.querySelector<HTMLButtonElement>('[aria-label="listMindmapFit"]');
    check.equal(fitButton.querySelector("use").getAttribute("xlink:href"), "#iconFocus");
    fitButton.dispatchEvent(new PointerEvent("pointerover", {bubbles: true}));
    check.equal(host.querySelector<HTMLElement>('[role="tooltip"]').hidden, false);
    check.equal(host.querySelector('[role="tooltip"]').textContent, "listMindmapFit");
    select(beta);
    check.equal(inspector.hidden, false);
    check.equal(inspector.classList.contains("list-mindmap__inspector--node"), true);
    check.equal(getComputedStyle(inspector).bottom, "0px");
    check.equal(host.querySelector(".list-mindmap__status"), null);
    const nodeMenuBounds = inspector.getBoundingClientRect();
    const panelBounds = host.getBoundingClientRect();
    check.ok(Math.abs(nodeMenuBounds.left + nodeMenuBounds.width / 2 - panelBounds.left - panelBounds.width / 2) < 2);
    check.ok(nodeMenuBounds.width < panelBounds.width / 2);
    check.equal(inspector.querySelectorAll('input[type="number"]').length, 0);
    check.equal(inspector.querySelectorAll('input[type="checkbox"]').length, 0);
    check.equal(inspector.querySelector('input[type="color"]'), null);
    check.equal(inspector.querySelectorAll('[role="group"]').length, 1);
    const nodePalette = inspector.querySelector<HTMLElement>('[role="group"][aria-label="color"]');
    const nodeColorButton = nodePalette.querySelector<HTMLButtonElement>('[aria-label="Appearance combined"]');
    check.equal(nodeColorButton.textContent, "A");
    check.equal(nodeColorButton.classList.contains("color__square"), true);
    check.equal(getComputedStyle(nodeColorButton).color, "rgb(17, 34, 51)");
    check.equal(getComputedStyle(nodeColorButton).backgroundColor, "rgb(221, 238, 255)");
    nodeColorButton.click();
    check.deepEqual(nodeStyles[nodeStyles.length - 1], [beta, {textColor: "var(--b3-font-color1)", backgroundColor: "var(--b3-font-background1)"}]);
    host.style.setProperty("--b3-font-color1", "#123456");
    host.style.setProperty("--b3-font-background1", "#abcdef");
    model.metadata.nodes[beta] = {textColor: "var(--b3-font-color1)", backgroundColor: "var(--b3-font-background1)"};
    view.update(model);
    check.equal(getComputedStyle(nodeElement(beta)).backgroundColor, "rgb(171, 205, 239)");
    check.equal(getComputedStyle(nodeElement(beta)).color, "rgb(18, 52, 86)");
    check.equal(inspector.querySelector('[aria-label="Appearance combined"]').getAttribute("aria-pressed"), "true");
    host.style.setProperty("--b3-font-background1", "#334455");
    check.equal(getComputedStyle(nodeElement(beta)).backgroundColor, "rgb(51, 68, 85)",
        "node colors follow changes to the appearance palette");
    inspector.querySelector<HTMLButtonElement>('[aria-label="color"] [aria-label="default"]').click();
    check.deepEqual(nodeStyles[nodeStyles.length - 1], [beta, {textColor: "", backgroundColor: ""}]);
    model.metadata.nodes[beta].backgroundColor = "";
    model.metadata.nodes[beta].textColor = "";
    view.update(model);
    check.equal(nodeElement(beta).style.backgroundColor, "", "default removes the node color override");
    check.equal(nodeElement(beta).style.color, "", "default removes the node text color override");
    host.style.setProperty("--b3-font-background1", "#123456");
    model.metadata.nodes[model.root.id] = {lineColor: "var(--b3-font-background1)"};
    view.update(model);
    check.equal(host.querySelector("canvas").getContext("2d").strokeStyle, "#123456");
    check.equal(getComputedStyle(nodeElement(beta)).borderWidth, "0px");
    view.clearSelection();
    await moveMouse();
    await settle();
    const parentBounds = nodeElement(model.nodes.get(beta).parentId).getBoundingClientRect();
    const childBounds = nodeElement(beta).getBoundingClientRect();
    const lineX = (parentBounds.right + childBounds.left) / 2;
    const parentY = model.nodes.get(beta).parentId === model.root.id ? parentBounds.top + parentBounds.height / 2 : parentBounds.bottom;
    const lineY = (parentY + childBounds.bottom) / 2;
    sendPointer(viewport, "pointermove", lineX, lineY);
    check.equal(viewport.classList.contains("list-mindmap__viewport--line-hover"), true);
    check.equal(visiblyRendered(addChildButton(beta)), true, "hovering a tree curve exposes its node controls");
    check.equal(nodeElement(beta).getAttribute("aria-selected"), "false", "line hover does not change selection");
    const alphaBounds = nodeElement(alpha).getBoundingClientRect();
    sendPointer(viewport, "pointermove", alphaBounds.left + alphaBounds.width / 2, alphaBounds.bottom + 1);
    check.equal(visiblyRendered(nodeElement(alpha).querySelector<HTMLButtonElement>(".list-mindmap__fold")), true,
        "hovering a branch underline exposes its fold control");
    check.equal(visiblyRendered(addChildButton(beta)), false, "moving to another line clears the previous node controls");
    viewport.dispatchEvent(new PointerEvent("pointerleave"));
    check.equal(viewport.classList.contains("list-mindmap__viewport--line-hover"), false);
    check.equal(nodeElement(alpha).classList.contains("list-mindmap__node--line-hover"), false);
    sendPointer(viewport, "pointerdown", lineX, lineY);
    sendPointer(viewport, "pointerup", lineX, lineY);
    check.equal(inspector.hidden, false, "clicking the tree curve opens its settings");
    check.equal(inspector.classList.contains("list-mindmap__inspector--line"), true);
    inspector.querySelector<HTMLButtonElement>('[aria-label="Appearance background"]').click();
    check.deepEqual(nodeStyles[nodeStyles.length - 1], [beta, {lineColor: "var(--b3-font-background1)"}]);
    blank();
    check.equal(inspector.hidden, true);
    select(beta);
    document.body.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
    check.equal(inspector.hidden, true);
    check.equal(nodeElement(beta).getAttribute("aria-selected"), "false");
    select(alpha);
    relationButton.click();
    blank();
    select(beta);
    check.equal(relationAdditions.length, 0, "outside click cancels pending relation creation");
    relationButton.click();
    select(alpha);
    check.deepEqual(relationAdditions, [[beta, alpha]]);
    model.metadata.relations.push({id: "relation-test", from: alpha, to: beta, label: "Relation"});
    view.update(model);
    host.querySelector<HTMLButtonElement>(".list-mindmap__relation").click();
    const relationElement = host.querySelector<HTMLElement>(".list-mindmap__relation");
    relationElement.dispatchEvent(new PointerEvent("pointerover", {bubbles: true}));
    check.equal(host.querySelector<HTMLElement>('[role="tooltip"]').hidden, true);
    const relationPoint = centerPoint(relationElement);
    sendPointer(relationElement, "pointermove", relationPoint.x, relationPoint.y);
    check.equal(relationElement.classList.contains("list-mindmap__relation--hover"), true);
    viewport.dispatchEvent(new PointerEvent("pointerleave"));
    check.equal(relationElement.classList.contains("list-mindmap__relation--hover"), false);
    check.equal(inspector.hidden, false);
    check.equal(inspector.classList.contains("list-mindmap__inspector--line"), true);
    check.equal(getComputedStyle(inspector).bottom, "0px");
    const lineMenuBounds = inspector.getBoundingClientRect();
    check.ok(Math.abs(lineMenuBounds.left + lineMenuBounds.width / 2 - panelBounds.left - panelBounds.width / 2) < 2);
    check.ok(lineMenuBounds.width < panelBounds.width / 2);
    check.equal(inspector.querySelector(".list-mindmap__section"), null);
    host.querySelector(".list-mindmap__relation").dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    const relationLabel = host.querySelector<HTMLInputElement>(".list-mindmap__relation-editor");
    check.equal(document.activeElement, relationLabel);
    check.equal(relationLabel.selectionEnd, relationLabel.value.length);
    relationLabel.value = "Renamed";
    relationLabel.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    check.deepEqual(relationChanges.pop(), ["relation-test", {label: "Renamed"}]);
    check.equal(host.querySelector(".list-mindmap__relation-editor"), null);
    check.equal(getComputedStyle(relationElement).visibility, "hidden", "finishing text editing returns to handle mode");
    host.querySelector<HTMLButtonElement>(".list-mindmap__relation").click();
    host.querySelector(".list-mindmap__relation").dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    const cancelledLabel = host.querySelector<HTMLInputElement>(".list-mindmap__relation-editor");
    cancelledLabel.value = "Cancelled";
    cancelledLabel.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    check.equal(relationChanges.length, 0);
    host.querySelector<HTMLButtonElement>(".list-mindmap__relation").click();
    check.equal(inspector.querySelector("input"), null);
    inspector.querySelector<HTMLButtonElement>('[aria-label="Appearance background"]').click();
    check.deepEqual(relationChanges, [["relation-test", {color: "var(--b3-font-background1)"}]]);
    model.metadata.relations[0].color = "var(--b3-font-background1)";
    view.update(model);
    check.equal(host.querySelector("canvas").getContext("2d").strokeStyle, "#123456");
    pressDelete();
    check.deepEqual(relationDeletions, ["relation-test"]);
    blank();
    check.equal(inspector.hidden, true);
    check.equal(host.querySelector(".list-mindmap__relation--selected"), null);
    await settle();
    check.equal(getComputedStyle(relationElement).visibility, "visible", "deselecting restores relation text");

    const savedRelations = model.metadata.relations;
    // 短连线文字撑开节点间距，文字仍位于所属连线上。
    model.metadata.relations = [];
    view.update(model);
    await settle();
    const siblingGap = () => view.positions.get(beta).y - view.positions.get(alpha).y - view.positions.get(alpha).height;
    const originalGap = siblingGap();
    model.metadata.relations = [{id: "short-label", from: alpha, to: beta, label: "Connection label"}];
    view.update(model);
    await settle();
    const shortLabel = view.relationElements.get("short-label");
    const fromBox = view.positions.get(alpha);
    const toBox = view.positions.get(beta);
    check.ok(siblingGap() >= shortLabel.offsetHeight + 32);
    const labelRoute = view.relationPath("short-label", fromBox, toBox, shortLabel);
    check.ok(labelRoute.labelPoint, "short relations always retain their text");
    check.notEqual(shortLabel.style.visibility, "hidden");
    for (const box of [fromBox, toBox]) {
        const p = labelRoute.labelPoint;
        check.equal(p.x + shortLabel.offsetWidth / 2 > box.x && p.x - shortLabel.offsetWidth / 2 < box.x + box.width &&
            p.y + shortLabel.offsetHeight / 2 > box.y && p.y - shortLabel.offsetHeight / 2 < box.y + box.height, false);
    }
    const routePoints = view.relationRoutes.get("short-label");
    check.ok(routePoints.slice(1).some((point: any, index: number) => {
        const previous = routePoints[index];
        const p = labelRoute.labelPoint;
        return (point.x === previous.x && p.x === point.x && p.y >= Math.min(point.y, previous.y) &&
            p.y <= Math.max(point.y, previous.y)) ||
            (point.y === previous.y && p.y === point.y && p.x >= Math.min(point.x, previous.x) &&
                p.x <= Math.max(point.x, previous.x));
    }), "the label stays on its own connection");
    const beforeHandleGap = siblingGap();
    const beforeHandleLabel = shortLabel.getBoundingClientRect();
    shortLabel.click();
    check.equal(getComputedStyle(shortLabel).visibility, "hidden", "selecting a relation hides its label before dragging");
    const midpointHandle = host.querySelector<HTMLElement>(".list-mindmap__route-handle:not(.list-mindmap__route-endpoint)");
    check.ok(midpointHandle, "text no longer suppresses the segment handle");
    const midpoint = centerPoint(midpointHandle);
    check.equal(document.elementFromPoint(midpoint.x, midpoint.y), midpointHandle, "the drag handle receives the pointer");
    view.refreshLayout();
    await settle();
    check.equal(siblingGap(), beforeHandleGap, "hidden text keeps its layout measurements");
    check.equal(shortLabel.getBoundingClientRect().width, beforeHandleLabel.width);
    view.setReadOnly(true);
    check.equal(getComputedStyle(shortLabel).visibility, "visible", "read-only rendering retains relation text");
    view.setReadOnly(false);
    check.equal(getComputedStyle(shortLabel).visibility, "hidden");
    window.dispatchEvent(new Event("beforeprint"));
    check.equal(getComputedStyle(shortLabel).visibility, "visible", "printing retains selected relation text");
    window.dispatchEvent(new Event("afterprint"));
    check.equal(getComputedStyle(shortLabel).visibility, "hidden");
    blank();
    check.equal(getComputedStyle(shortLabel).visibility, "visible");
    model.metadata.relations[0].label = "";
    view.update(model);
    await settle();
    check.equal(siblingGap(), originalGap, "removing the label restores the default spacing");
    model.metadata.relations = [
        {id: "forward", from: alpha, to: beta, label: ""},
        {id: "reverse", from: beta, to: alpha, label: ""},
    ];
    view.update(model);
    await settle();
    for (const scale of [0.5, 1, 2]) {
        view.scale = scale;
        view.draw();
        for (const id of ["forward", "reverse"]) {
            const end = view.linePaths.find((line: any) => line.id === id).end;
            const bounds = viewport.getBoundingClientRect();
            const x = bounds.left + view.offsetX + end.x * scale;
            const y = bounds.top + view.offsetY + end.y * scale;
            sendPointer(viewport, "pointermove", x, y);
            check.equal(view.hoveredLine, `relation:${id}`, "each arrow highlights its own direction");
            sendPointer(viewport, "pointerdown", x, y);
            sendPointer(viewport, "pointerup", x, y);
            check.equal(view.selectedRelation, id, "overlapping reverse relations can be selected independently");
            viewport.dispatchEvent(new MouseEvent("dblclick", {clientX: x, clientY: y, bubbles: true}));
            const input = host.querySelector<HTMLInputElement>(".list-mindmap__relation-editor");
            check.ok(input, "double-clicking either arrow edits its relation label");
            input.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
            pressDelete();
            check.equal(relationDeletions[relationDeletions.length - 1], id);
        }
    }
    // 短尾段仍绘制清晰的箭头，整体很短的双向直连则保留箭头间距。
    const arrowContext = host.querySelector("canvas").getContext("2d");
    const originalMoveTo = arrowContext.moveTo;
    const originalLineTo = arrowContext.lineTo;
    const originalFill = arrowContext.fill;
    let polygon: {x: number, y: number}[] = [];
    let arrows: {x: number, y: number}[][] = [];
    arrowContext.moveTo = (x, y) => { polygon = [{x, y}]; originalMoveTo.call(arrowContext, x, y); };
    arrowContext.lineTo = (x, y) => { polygon.push({x, y}); originalLineTo.call(arrowContext, x, y); };
    arrowContext.fill = () => { arrows.push(polygon); originalFill.call(arrowContext); };
    try {
        const straight = view.relationRoutes.get("forward");
        const start = straight[0];
        const end = straight[straight.length - 1];
        view.relationRoutes.set("forward", [start, {x: end.x + 100, y: start.y},
            {x: end.x + 100, y: end.y - 3}, {x: end.x, y: end.y - 3}, end]);
        view.selectedRelation = undefined;
        view.hoveredLine = undefined;
        for (const scale of [.5, 1, 2]) {
            view.scale = scale;
            arrows = [];
            view.draw();
            const width = (arrow: {x: number, y: number}[]) => Math.hypot(arrow[2].x - arrow[0].x, arrow[2].y - arrow[0].y) * scale;
            check.ok(width(arrows[0]) >= 6.9, "a three-unit tail retains a readable arrow at every zoom level");
            check.ok(width(arrows[1]) <= Math.hypot(end.x - start.x, end.y - start.y) * scale / 3 + .001,
                "short reverse connections retain space between arrowheads");
        }
    } finally {
        arrowContext.moveTo = originalMoveTo;
        arrowContext.lineTo = originalLineTo;
        arrowContext.fill = originalFill;
    }
    view.scale = 1;
    // 拖动短关系线只在松手时保存一次；取消、外部刷新和只读切换丢弃预览。
    model.metadata.relations = [{id: "drag-route", from: alpha, to: beta, label: ""}];
    view.update(model);
    await settle();
    view.selectedRelation = "drag-route";
    view.updateSelection();
    relationChanges.length = 0;
    const automaticRoute = JSON.stringify(view.relationRoutes.get("drag-route"));
    const screenNodes = () => [alpha, beta].map(id => {
        const bounds = nodeElement(id).getBoundingClientRect();
        return {x: bounds.x, y: bounds.y};
    });
    const dragHandle = async (offset: number) => {
        const handle = host.querySelector<HTMLElement>(".list-mindmap__route-handle:not(.list-mindmap__route-endpoint)");
        check.ok(handle, "short relations expose a drag handle");
        const point = centerPoint(handle);
        const horizontal = handle.style.cursor === "ns-resize";
        sendPointer(handle, "pointerdown", point.x, point.y);
        check.ok(view.pointer?.relation);
        sendPointer(viewport, "pointermove", point.x + (horizontal ? 0 : offset), point.y + (horizontal ? offset : 0));
        await settle();
        return {x: point.x + (horizontal ? 0 : offset), y: point.y + (horizontal ? offset : 0)};
    };
    const beforeDragNodes = screenNodes();
    const beforeDragScale = view.scale;
    const blockedEnd = await dragHandle(-35);
    check.equal(view.pointer.relation.valid, false, "a control inside another node's buttons is rejected");
    sendPointer(viewport, "pointerup", blockedEnd.x, blockedEnd.y);
    check.equal(relationChanges.length, 0, "an invalid preview never saves");
    let dragEnd = await dragHandle(110);
    check.equal(view.pointer.relation.valid, true, "dragging a short relation creates a valid path");
    check.notEqual(JSON.stringify(view.relationRoutes.get("drag-route")), automaticRoute);
    check.deepEqual(screenNodes(), beforeDragNodes);
    check.equal(relationChanges.length, 0, "previews do not create transactions");
    viewport.dispatchEvent(new WheelEvent("wheel", {deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true}));
    check.equal(view.scale, beforeDragScale, "zoom stays fixed while dragging");
    sendPointer(viewport, "pointerup", dragEnd.x, dragEnd.y);
    check.equal(relationChanges.length, 1, "release saves exactly once");
    const savedRoute = (relationChanges[0] as any[])[1].route;
    check.equal((relationChanges[0] as any[])[2], JSON.stringify(model.metadata.relations[0]), "save guards against stale relations");
    check.ok(savedRoute.points.length);
    model.metadata.relations[0].route = savedRoute;
    view.update(model);
    await settle();
    check.deepEqual(screenNodes(), beforeDragNodes, "saving the path preserves the camera anchor");
    const savedGeometry = JSON.stringify(view.relationRoutes.get("drag-route"));
    const outwardPoints = view.relationRoutes.get("drag-route");
    const outwardColumn = JSON.parse(automaticRoute)[0].x + 110;
    const returningSegment = outwardPoints.findIndex((point: any, index: number) =>
        point.x === outwardColumn && outwardPoints[index + 1]?.x === outwardColumn);
    const returningHandle = view.routeHandles.get(`drag-route:${returningSegment}`);
    check.ok(returningHandle);
    const returningPoint = centerPoint(returningHandle);
    sendPointer(returningHandle, "pointerdown", returningPoint.x, returningPoint.y);
    sendPointer(viewport, "pointermove", returningPoint.x - 110 * view.scale, returningPoint.y);
    await settle();
    check.equal(view.pointer.relation.valid, true, "a saved outward path can be dragged back between its endpoints");
    check.equal(JSON.stringify(view.relationRoutes.get("drag-route")), automaticRoute);
    sendPointer(viewport, "pointerup", returningPoint.x - 110 * view.scale, returningPoint.y);
    check.equal(relationChanges.length, 2);
    model.metadata.relations[0].route = (relationChanges[1] as any[])[1].route;
    view.update(model);
    await settle();
    check.equal(JSON.stringify(view.relationRoutes.get("drag-route")), automaticRoute, "the returned route persists across refresh");
    model.metadata.relations[0].route = savedRoute;
    view.update(model);
    await settle();
    model.metadata.relations[0].route = {version: 1, points: [{x: 0, y: 0, t: 0}]};
    view.update(model);
    await settle();
    check.equal(view.fallbackRoutes.has("drag-route"), true);
    check.equal(host.querySelector<HTMLElement>(".list-mindmap__route-status").hidden, false);
    check.equal(model.metadata.relations[0].route.points.length, 1, "unavailable routes retain their saved controls");
    model.metadata.relations[0].route = savedRoute;
    view.update(model);
    await settle();
    check.equal(view.fallbackRoutes.has("drag-route"), false);
    check.equal(JSON.stringify(view.relationRoutes.get("drag-route")), savedGeometry);
    relationChanges.length = 0;
    await dragHandle(-15);
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    check.equal(view.pointer, undefined);
    check.equal(JSON.stringify(view.relationRoutes.get("drag-route")), savedGeometry);
    check.equal(relationChanges.length, 0);
    dragEnd = await dragHandle(-15);
    viewport.dispatchEvent(new PointerEvent("pointercancel", {pointerId: 1, bubbles: true}));
    sendPointer(viewport, "pointerup", dragEnd.x, dragEnd.y);
    check.equal(relationChanges.length, 0, "pointer cancellation discards the preview");
    dragEnd = await dragHandle(-15);
    view.update(model);
    sendPointer(viewport, "pointerup", dragEnd.x, dragEnd.y);
    await settle();
    check.equal(relationChanges.length, 0, "remote refresh cancels a stale drag");
    dragEnd = await dragHandle(-15);
    view.setReadOnly(true);
    sendPointer(viewport, "pointerup", dragEnd.x, dragEnd.y);
    check.equal(relationChanges.length, 0);
    check.equal(host.querySelector(".list-mindmap__route-handle:not(.list-mindmap__route-endpoint)"), null, "read-only render has no drag handles");
    await settle();
    check.equal(JSON.stringify(view.relationRoutes.get("drag-route")), savedGeometry, "read-only rendering uses the saved path");
    view.setReadOnly(false);
    view.selectedRelation = "drag-route";
    view.updateSelection();
    await settle();
    const resetEnd = view.linePaths.find((line: any) => line.id === "drag-route").end;
    const resetBounds = viewport.getBoundingClientRect();
    viewport.dispatchEvent(new MouseEvent("dblclick", {clientX: resetBounds.left + view.offsetX + resetEnd.x * view.scale,
        clientY: resetBounds.top + view.offsetY + resetEnd.y * view.scale, bubbles: true}));
    const lineEditor = host.querySelector<HTMLInputElement>(".list-mindmap__relation-editor");
    check.ok(lineEditor, "double-clicking a manual path edits its text");
    check.equal(relationChanges.length, 0, "double-clicking a line does not reset its route");
    lineEditor.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    host.querySelector(".list-mindmap__route-handle:not(.list-mindmap__route-endpoint)").dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    check.deepEqual(relationChanges.map((change: any[]) => change.slice(0, 2)), [["drag-route", {route: undefined}]],
        "double-clicking the drag handle clears only its manual route");
    delete model.metadata.relations[0].route;
    view.update(model);
    await settle();
    check.equal(JSON.stringify(view.relationRoutes.get("drag-route")), automaticRoute);
    check.equal(host.querySelector(".list-mindmap__relation-editor"), null);
    // 线条本身也可拖动，手柄在不同缩放下保持相同的点击尺寸。
    relationChanges.length = 0;
    const directPoints = view.relationRoutes.get("drag-route");
    const directX = resetBounds.left + view.offsetX + (directPoints[0].x + directPoints[1].x) / 2 * view.scale;
    const directY = resetBounds.top + view.offsetY + (directPoints[0].y + directPoints[1].y) / 2 * view.scale;
    sendPointer(viewport, "pointerdown", directX, directY);
    sendPointer(viewport, "pointermove", directX + 110, directY);
    sendPointer(viewport, "pointerup", directX + 110, directY);
    check.equal(relationChanges.length, 1);
    for (const scale of [.5, 2]) {
        view.scale = scale;
        view.draw();
        const handle = host.querySelector<HTMLElement>(".list-mindmap__route-handle:not(.list-mindmap__route-endpoint)").getBoundingClientRect();
        check.equal(handle.width, 20);
        check.equal(handle.height, 20);
    }
    view.scale = 1;
    view.draw();
    HTMLElement.prototype.setPointerCapture = originalCapture;
    HTMLElement.prototype.hasPointerCapture = originalHasCapture;
    HTMLElement.prototype.releasePointerCapture = originalReleaseCapture;
    relationChanges.length = 0;
    const nativeHandle = centerPoint(host.querySelector<HTMLElement>(".list-mindmap__route-handle:not(.list-mindmap__route-endpoint)"));
    await nativeInput([
        {type: "mouseMove", ...nativeHandle},
        {type: "mouseDown", ...nativeHandle, button: "left", clickCount: 1},
        {type: "mouseMove", x: nativeHandle.x + 110, y: nativeHandle.y, button: "left"},
        {type: "mouseUp", x: nativeHandle.x + 110, y: nativeHandle.y, button: "left", clickCount: 1},
    ]);
    check.equal(relationChanges.length, 1, "native pointer capture saves a drag exactly once");
    model.metadata.relations[0].route = (relationChanges[0] as any[])[1].route;
    view.update(model);
    await settle();
    const nativeReset = centerPoint(host.querySelector<HTMLElement>(".list-mindmap__route-handle:not(.list-mindmap__route-endpoint)"));
    await nativeInput([
        {type: "mouseMove", ...nativeReset},
        {type: "mouseDown", ...nativeReset, button: "left", clickCount: 1},
        {type: "mouseUp", ...nativeReset, button: "left", clickCount: 1},
        {type: "mouseDown", ...nativeReset, button: "left", clickCount: 2},
        {type: "mouseUp", ...nativeReset, button: "left", clickCount: 2},
    ]);
    check.equal(relationChanges.length, 2, "native double click restores automatic routing despite pointer capture");
    check.deepEqual((relationChanges[1] as any[]).slice(0, 2), ["drag-route", {route: undefined}]);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.hasPointerCapture = () => false;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
    // 首尾标识分别更换起点和终点，空白、自身、重复连接及取消操作均保留原数据。
    const endpointModel = api.readListMindmap(reset("* Start\n* End\n* Alternate\n"));
    const [startNode, endNode, alternateNode] = endpointModel.root.children;
    endpointModel.metadata.relations = [{id: "endpoint-test", from: startNode.id, to: endNode.id,
        label: "Keep label", color: "red", route: savedRoute}];
    view.update(endpointModel);
    await settle();
    view.selectedRelation = "endpoint-test";
    view.updateSelection();
    check.equal(host.querySelectorAll(".list-mindmap__route-endpoint").length, 2);
    const dragEndpoint = async (endpoint: string, targetId?: string) => {
        const handle = host.querySelector<HTMLElement>(`.list-mindmap__route-endpoint[data-endpoint="${endpoint}"]`);
        const point = centerPoint(handle);
        const target = targetId ? centerPoint(nodeElement(targetId)) : {x: point.x + 100, y: panelBounds.top + 10};
        sendPointer(handle, "pointerdown", point.x, point.y);
        sendPointer(viewport, "pointermove", target.x, target.y);
        await settle();
        check.equal(host.querySelectorAll(".list-mindmap__route-endpoint").length, 2, "both endpoints remain marked during a drag");
        return target;
    };
    for (const endpoint of ["from", "to"]) {
        relationChanges.length = 0;
        const target = await dragEndpoint(endpoint, alternateNode.id);
        check.equal(view.pointer.relation.valid, true);
        check.ok(nodeElement(alternateNode.id).classList.contains("list-mindmap__node--relation"));
        check.equal(relationChanges.length, 0);
        sendPointer(viewport, "pointerup", target.x, target.y);
        check.deepEqual((relationChanges[0] as any[]).slice(0, 2), ["endpoint-test", {[endpoint]: alternateNode.id, route: undefined}]);
        check.equal(relationChanges.length, 1);
        check.equal((relationChanges[0] as any[])[2], JSON.stringify(endpointModel.metadata.relations[0]));
        await settle();
    }
    relationChanges.length = 0;
    for (const targetId of [undefined, startNode.id, endpointModel.root.id]) {
        const target = await dragEndpoint("to", targetId);
        check.equal(view.pointer.relation.valid, false);
        sendPointer(viewport, "pointerup", target.x, target.y);
        check.equal(relationChanges.length, 0);
        await settle();
    }
    const cancelTarget = await dragEndpoint("to", alternateNode.id);
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    sendPointer(viewport, "pointerup", cancelTarget.x, cancelTarget.y);
    check.equal(relationChanges.length, 0);
    await settle();
    HTMLElement.prototype.setPointerCapture = originalCapture;
    HTMLElement.prototype.hasPointerCapture = originalHasCapture;
    HTMLElement.prototype.releasePointerCapture = originalReleaseCapture;
    const nativeStart = centerPoint(host.querySelector<HTMLElement>('.list-mindmap__route-endpoint[data-endpoint="from"]'));
    const nativeTarget = centerPoint(nodeElement(alternateNode.id));
    await nativeInput([
        {type: "mouseMove", ...nativeStart},
        {type: "mouseDown", ...nativeStart, button: "left", clickCount: 1},
        {type: "mouseMove", ...nativeTarget, button: "left"},
        {type: "mouseUp", ...nativeTarget, button: "left", clickCount: 1},
    ]);
    check.equal(relationChanges.length, 1, "native endpoint capture reconnects the start node once");
    check.deepEqual((relationChanges[0] as any[]).slice(0, 2), ["endpoint-test", {from: alternateNode.id, route: undefined}]);
    relationChanges.length = 0;
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.hasPointerCapture = () => false;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
    endpointModel.metadata.relations.push({id: "existing", from: startNode.id, to: alternateNode.id, label: ""});
    view.update(endpointModel);
    await settle();
    const duplicateTarget = await dragEndpoint("to", alternateNode.id);
    check.equal(view.pointer.relation.valid, false);
    sendPointer(viewport, "pointerup", duplicateTarget.x, duplicateTarget.y);
    check.equal(relationChanges.length, 0);
    view.setReadOnly(true);
    check.equal(host.querySelectorAll(".list-mindmap__route-endpoint").length, 0);
    view.setReadOnly(false);
    model.metadata.relations = savedRelations;
    view.update(model);

    // 打印收紧画布高度，结束打印后恢复屏幕上的缩放和平移。
    await settle();
    const screenTransform = [view.scale, view.offsetX, view.offsetY];
    const screenHeight = host.offsetHeight;
    await require("electron").ipcRenderer.invoke("list-mindmap-print-media", "print");
    window.dispatchEvent(new Event("beforeprint"));
    await settle();
    check.ok(host.offsetHeight < screenHeight, "PDF does not retain the fixed editor canvas height");
    const printBounds = viewport.getBoundingClientRect();
    for (const node of view.positions.values()) {
        check.ok(node.x * view.scale + view.offsetX >= 0);
        check.ok((node.x + node.width) * view.scale + view.offsetX <= printBounds.width + 1);
        check.ok(node.y * view.scale + view.offsetY >= 0);
        check.ok((node.y + node.height) * view.scale + view.offsetY <= printBounds.height + 1);
    }
    await require("electron").ipcRenderer.invoke("list-mindmap-print-media", "screen");
    window.dispatchEvent(new Event("afterprint"));
    await settle();
    check.equal(host.offsetHeight, screenHeight);
    check.deepEqual([view.scale, view.offsetX, view.offsetY], screenTransform);

    // 全屏使用编辑器同款窗口内布局，不调用浏览器全屏，并在退出和销毁时恢复原位置。
    Object.defineProperty(host, "requestFullscreen", {configurable: true, value: () => check.fail("Native fullscreen must not be requested")});
    hostParent.style.transform = "translateX(5px)";
    hostParent.style.overflow = "hidden";
    host.querySelector<HTMLButtonElement>('[aria-label="fullscreen"]').click();
    await settle();
    check.equal(host.parentElement, document.body);
    check.equal(host.classList.contains("fullscreen"), true);
    check.equal(host.querySelector(".list-mindmap__toolbar").classList.contains("block__icons"), true);
    check.equal(host.getBoundingClientRect().left, 0);
    check.equal(host.getBoundingClientRect().width, window.innerWidth);
    check.equal(getComputedStyle(host).zIndex, "8");
    check.deepEqual(fullscreenChanges, [true]);
    view.setReadOnly(true);
    check.ok(host.querySelector('[aria-label="exitFullscreen"]'));
    view.setReadOnly(false);
    host.querySelector<HTMLButtonElement>('[aria-label="exitFullscreen"]').click();
    check.equal(host.parentElement, hostParent);
    check.equal(host.classList.contains("fullscreen"), false);
    check.deepEqual(fullscreenChanges, [true, false]);
    host.querySelector<HTMLButtonElement>('[aria-label="fullscreen"]').click();
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    check.equal(host.parentElement, hostParent);
    check.equal(host.classList.contains("fullscreen"), false);
    check.equal(host.querySelector(".list-mindmap__toolbar").classList.contains("block__icons"), true);
    host.querySelector<HTMLButtonElement>('[aria-label="fullscreen"]').click();
    view.destroy();
    check.equal(host.parentElement, hostParent);
    check.equal(host.classList.contains("fullscreen"), false);
    check.deepEqual(fullscreenChanges, [true, false, true, false, true, false]);
    check.equal(Array.from(hostParent.childNodes).some(node => node.nodeType === Node.COMMENT_NODE), false);
    hostParent.style.transform = "";
    hostParent.style.overflow = "";

    const readonly = new api.ListMindmapView({...options, readOnly: true});
    await settle();
    check.equal(host.querySelector('.list-mindmap__toolbar [aria-label="listMindmapChild"]'), null);
    check.equal(host.querySelector('[aria-label="undo"]'), null);
    nodeElement(beta).dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "z", ctrlKey: true, bubbles: true}));
    check.equal(edits.length, 1);
    check.equal(undo, 0);
    const persistedBeforeFold = list.outerHTML;
    pressDelete();
    check.deepEqual(deletions, [beta]);
    const beforeCollapse = nodeElement(model.root.id).getBoundingClientRect();
    nodeElement(model.root.id).querySelector<HTMLButtonElement>(".list-mindmap__fold").click();
    await settle();
    const afterCollapse = nodeElement(model.root.id).getBoundingClientRect();
    check.ok(Math.abs(afterCollapse.y - beforeCollapse.y) < 1, "collapse keeps the root at its screen position");
    check.equal(nodeElement(alpha).hidden, true);
    const foldedButton = nodeElement(model.root.id).querySelector<HTMLButtonElement>(".list-mindmap__fold");
    check.equal(foldedButton.querySelector("span").textContent, String(model.nodes.size - 1));
    check.equal(getComputedStyle(foldedButton).visibility, "visible");
    foldedButton.click();
    await settle();
    check.equal(nodeElement(alpha).hidden, false);
    const afterExpand = nodeElement(model.root.id).getBoundingClientRect();
    check.ok(Math.abs(afterExpand.y - afterCollapse.y) < 1, "expansion keeps the root stable after size observers settle");
    check.ok(Math.abs(afterExpand.x - afterCollapse.x) < 1, "expansion preserves horizontal position");
    check.equal(list.outerHTML, persistedBeforeFold);
    readonly.destroy();

    const titleView = new api.ListMindmapView({...options, onRootTitleChange: (title: string) => {
        model.metadata.rootTitle = title;
        api.writeListMindmapMetadata(list, model.metadata);
        titleView.update(model);
    }});
    await settle();
    const renameRoot = async (title: string, key: string) => {
        const node = nodeElement(model.root.id);
        const before = {width: node.offsetWidth, height: node.offsetHeight};
        titleView.getContentHost(model.root.id).dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
        const input = host.querySelector<HTMLTextAreaElement>(".list-mindmap__root-title");
        check.ok(input, "virtual root supports inline title editing");
        if (model.metadata.rootTitle) {
            check.deepEqual({width: node.offsetWidth, height: node.offsetHeight}, before,
                "entering named root title editing preserves dimensions");
        } else {
            check.equal(before.width, before.height, "the unnamed root is a compact square");
            check.equal(input.value, "", "editing an unnamed root starts with empty text");
        }
        input.value = "A long root title that grows while typing";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        await settle();
        const expanded = node.offsetWidth;
        input.value = "A";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        await settle();
        check.ok(node.offsetWidth < expanded, "root title resizes before leaving the editor");
        input.value = title;
        input.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true}));
    };
    await renameRoot("Custom root", "Enter");
    check.equal(api.readListMindmap(list).metadata.rootTitle, "Custom root");
    check.equal(titleView.getContentHost(model.root.id).textContent, "Custom root");
    await renameRoot("Canceled title", "Escape");
    check.equal(titleView.getContentHost(model.root.id).textContent, "Custom root");
    await renameRoot("", "Enter");
    check.equal(titleView.getContentHost(model.root.id).textContent, "");
    check.ok(nodeElement(model.root.id).classList.contains("list-mindmap__node--untitled"));
    check.equal(nodeElement(model.root.id).offsetWidth, nodeElement(model.root.id).offsetHeight);
    titleView.destroy();

    const singleList = reset("* Single\n");
    const single = new api.ListMindmapView({...options, model: api.readListMindmap(singleList)});
    await settle();
    check.equal(single.scale, 1, "initial layout keeps a single node at its normal size");
    const panButton = host.querySelector<HTMLButtonElement>('[aria-label="cursorHand"]');
    panButton.click();
    check.equal(panButton.getAttribute("aria-pressed"), "true");
    const panNode = host.querySelector<HTMLElement>(".list-mindmap__node");
    check.equal(getComputedStyle(panNode).pointerEvents, "none");
    const panBefore = {x: single.offsetX, y: single.offsetY};
    panNode.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerId: 81, clientX: 100, clientY: 100}));
    panNode.dispatchEvent(new PointerEvent("pointermove", {bubbles: true, pointerId: 81, clientX: 140, clientY: 125}));
    panNode.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, pointerId: 81, clientX: 140, clientY: 125}));
    check.equal(single.offsetX, panBefore.x + 40, "hand tool pans from a node instead of moving it");
    check.equal(single.offsetY, panBefore.y + 25);
    check.equal(host.querySelector(".list-mindmap__ghost"), null);
    panButton.click();
    check.equal(panButton.getAttribute("aria-pressed"), "false");
    check.ok(getComputedStyle(panNode).pointerEvents !== "none");
    single.fit();
    check.ok(single.scale > 1 && single.scale <= 2.5, "fit enlarges small maps within the zoom limit");
    const fitViewport = host.querySelector<HTMLElement>(".list-mindmap__viewport").getBoundingClientRect();
    const fitNode = host.querySelector<HTMLElement>(".list-mindmap__node").getBoundingClientRect();
    check.ok(Math.abs((fitNode.left + fitNode.right) / 2 - (fitViewport.left + fitViewport.right) / 2) < 1,
        "fit centers visible content instead of layout padding");
    const fitInspector = host.querySelector<HTMLElement>(".list-mindmap__inspector");
    fitInspector.hidden = false;
    single.fit();
    check.deepEqual(host.querySelector<HTMLElement>(".list-mindmap__node").getBoundingClientRect().toJSON(),
        fitNode.toJSON(), "opening the inspector preserves fit position and scale");
    check.ok(host.querySelector<HTMLElement>(".list-mindmap__node").getBoundingClientRect().bottom <=
        fitInspector.getBoundingClientRect().top, "fit keeps content above the visible inspector");
    fitInspector.hidden = true;
    lute.SetTabs(true);
    const tabsContainer = document.createElement("div");
    tabsContainer.innerHTML = lute.Md2BlockDOM("::: tabs\n@tab First\n\nOne\n@tab Second\n\nTwo\n:::\n");
    const sourceTabs = tabsContainer.firstElementChild as HTMLElement;
    const sourceItems = sourceTabs.querySelectorAll<HTMLElement>(":scope > .tab-item");
    sourceTabs.setAttribute("tabs-active-id", sourceItems[1].dataset.nodeId);
    const sourceTabsHTML = sourceTabs.outerHTML;
    const tabsModel = api.readListMindmap(singleList);
    tabsModel.root.contentBlocks = [sourceTabs];
    single.update(tabsModel);
    const previewTabs = host.querySelector<HTMLElement>(".tabs");
    const previewItems = previewTabs.querySelectorAll<HTMLElement>(":scope > .tab-item");
    check.ok(previewItems[0].id && previewItems[1].id && previewItems[0].id !== previewItems[1].id);
    check.equal(previewTabs.getAttribute("tabs-active-id"), previewItems[1].id);
    check.equal(previewTabs.querySelector("[data-node-id]"), null);
    check.equal(sourceTabs.outerHTML, sourceTabsHTML);
    const emptyModel = api.readListMindmap(singleList);
    const emptyBlock = document.createElement("div");
    emptyBlock.innerHTML = "<div><br></div>";
    emptyModel.root.contentBlocks = [emptyBlock];
    single.update(emptyModel);
    const emptyContent = host.querySelector<HTMLElement>(".list-mindmap__content");
    check.equal(emptyContent.classList.contains("list-mindmap__content--empty"), true);
    check.equal(emptyContent.dataset.placeholder, "listMindmapPlaceholder");
    check.equal(emptyContent.textContent, "", "placeholder is not node content");
    emptyBlock.innerHTML = '<div spellcheck="false">First\n\n\nLast</div>';
    single.update(emptyModel);
    await settle();
    const textPreview = emptyContent.querySelector<HTMLElement>(".list-mindmap__text");
    const lineHeight = parseFloat(getComputedStyle(textPreview).lineHeight);
    check.ok(textPreview.offsetHeight >= lineHeight * 4, "consecutive soft breaks retain blank lines");
    emptyBlock.innerHTML = '<div spellcheck="false">\n\n</div>';
    single.update(emptyModel);
    await settle();
    check.equal(emptyContent.classList.contains("list-mindmap__content--empty"), false);
    check.ok(emptyContent.offsetHeight >= lineHeight * 3, "blank-only and trailing lines remain visible");
    emptyBlock.innerHTML = '<div spellcheck="false"></div>';
    emptyModel.root.contentBlocks = [emptyBlock, emptyBlock.cloneNode(true), emptyBlock.cloneNode(true)];
    single.update(emptyModel);
    await settle();
    check.ok(emptyContent.offsetHeight >= lineHeight * 3, "empty paragraphs retain individual line height");
    emptyModel.root.contentBlocks = [emptyBlock];
    emptyBlock.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
    single.update(emptyModel);
    check.equal(emptyContent.classList.contains("list-mindmap__content--empty"), false);
    single.update(api.readListMindmap(singleList));
    pressDelete();
    check.deepEqual(deletions, [beta], "the last root node cannot be deleted");
    await settle();
    HTMLElement.prototype.setPointerCapture = originalCapture;
    HTMLElement.prototype.hasPointerCapture = originalHasCapture;
    HTMLElement.prototype.releasePointerCapture = originalReleaseCapture;
    const nativeRect = host.querySelector<HTMLElement>("[data-mindmap-id]").getBoundingClientRect();
    const nativePoint = {x: Math.round(nativeRect.left + nativeRect.width / 2), y: Math.round(nativeRect.top + nativeRect.height / 2)};
    const beforeNativeEdits = edits.length;
    await require("electron").ipcRenderer.invoke("list-mindmap-native-input", [
        {type: "mouseMove", ...nativePoint},
        {type: "mouseDown", ...nativePoint, button: "left", clickCount: 1},
        {type: "mouseUp", ...nativePoint, button: "left", clickCount: 1},
        {type: "mouseDown", ...nativePoint, button: "left", clickCount: 2},
        {type: "mouseUp", ...nativePoint, button: "left", clickCount: 2},
    ]);
    await settle();
    check.equal(edits.length, beforeNativeEdits + 1, "native double click must edit despite pointer capture");
    single.destroy();

    // 使用真实鼠标及两种删除按键修改源列表，覆盖 macOS Delete 键发送 Backspace 的情况。
    const deleteList = reset("* Root\n  * First\n  * Second\n");
    const deleteModel = api.readListMindmap(deleteList);
    const deleteFirst = deleteModel.root.children[0].id;
    const deleteSecond = deleteModel.root.children[1].id;
    const deleting = new api.ListMindmapView({...options, model: deleteModel, onDelete: (id: string) => {
        check.equal(api.deleteListMindmapNode(deleteList, id), true);
        deleting.update(api.readListMindmap(deleteList));
    }});
    const nativeKey = async (keyCode: string) => {
        await nativeInput([{type: "keyDown", keyCode}, {type: "keyUp", keyCode}]);
        await settle();
    };
    await settle();
    await clickMouse(nodeElement(deleteFirst));
    check.equal(document.activeElement, host);
    await nativeKey("Backspace");
    check.equal(deleteList.querySelector(`[data-node-id="${deleteFirst}"]`), null);
    check.equal(nodeElement(deleteFirst), null);
    check.ok(deleteList.querySelector(`[data-node-id="${deleteSecond}"]`));
    await clickMouse(nodeElement(deleteSecond));
    const beforeProtectedDelete = deleteList.outerHTML;
    deleting.setEditing(deleteSecond);
    for (const key of ["Backspace", "Delete"]) {
        pressDelete(deleting.getContentHost(deleteSecond), {key});
    }
    deleting.setEditing();
    deleting.setReadOnly(true);
    await nativeKey("Backspace");
    await nativeKey("Delete");
    check.equal(deleteList.outerHTML, beforeProtectedDelete);
    deleting.setReadOnly(false);
    await clickMouse(nodeElement(deleteSecond));
    await nativeKey("Delete");
    check.equal(deleteList.querySelector(`[data-node-id="${deleteSecond}"]`), null);
    check.equal(nodeElement(deleteSecond), null);
    check.ok(nodeElement(deleteModel.root.id));
    await clickMouse(nodeElement(deleteModel.root.id));
    await nativeKey("Backspace");
    check.ok(nodeElement(deleteModel.root.id), "the last root is preserved for the macOS Delete key");
    deleting.destroy();
    // 公式在副本上异步渲染；链接单击跳转，双击和拖拽不跳转。
    const richList = reset("* $x^2$ [example](https://example.com)\n  * child\n");
    const richHost = document.createElement("div");
    hostParent.append(richHost);
    const opened: string[] = [];
    let richEdits = 0;
    const richView = new api.ListMindmapView({host: richHost, model: api.readListMindmap(richList),
        onExit: () => {}, onOpenLink: (href: string) => opened.push(href), onEdit: () => richEdits++});
    await settle();
    check.ok(richHost.querySelector('[data-subtype="math"] .katex'));
    check.equal(richList.querySelector(".katex"), null, "preview rendering does not mutate the source");
    const link = richHost.querySelector<HTMLElement>('[data-type="a"]');
    const clickLink = (detail = 1) => link.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, detail}));
    clickLink();
    await new Promise(resolve => setTimeout(resolve, 220));
    check.deepEqual(opened, ["https://example.com"]);
    const geometry = () => Array.from(richHost.querySelectorAll(".list-mindmap__node")).map(element => {
        const rect = element.getBoundingClientRect();
        return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
    });
    const beforeEditing = geometry();
    clickLink();
    clickLink(2);
    link.dispatchEvent(new MouseEvent("dblclick", {bubbles: true, cancelable: true, detail: 2}));
    await new Promise(resolve => setTimeout(resolve, 220));
    check.equal(richEdits, 1);
    check.equal(opened.length, 1);
    check.deepEqual(geometry(), beforeEditing, "entering edit mode does not reposition the canvas or other nodes");
    richView.setEditing();
    await settle();
    check.deepEqual(geometry(), beforeEditing, "leaving edit mode does not reposition the canvas or other nodes");
    const point = centerPoint(link);
    sendPointer(link, "pointerdown", point.x, point.y);
    sendPointer(richHost.querySelector(".list-mindmap__viewport"), "pointermove", point.x + 30, point.y);
    sendPointer(richHost.querySelector(".list-mindmap__viewport"), "pointerup", point.x + 30, point.y);
    clickLink();
    await new Promise(resolve => setTimeout(resolve, 220));
    check.equal(opened.length, 1);
    const ref = document.createElement("span");
    ref.dataset.type = "block-ref";
    ref.dataset.id = "20260917000000-abcdefg";
    link.after(ref);
    sendPointer(ref, "pointerdown", point.x, point.y);
    sendPointer(richHost.querySelector(".list-mindmap__viewport"), "pointerup", point.x, point.y);
    ref.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, detail: 1}));
    await new Promise(resolve => setTimeout(resolve, 220));
    check.equal(opened[1], "siyuan://blocks/20260917000000-abcdefg");
    richView.destroy();
    const exportView = new api.ListMindmapView({host: richHost, model: api.readListMindmap(richList),
        readOnly: true, onExit: () => {}});
    const anchor = document.createElement("a");
    anchor.href = "#export-target";
    richHost.querySelector(".list-mindmap__content").append(anchor);
    let exportClick = false;
    richHost.parentElement.addEventListener("click", event => {
        if (event.target === anchor) {
            exportClick = true;
            event.preventDefault();
        }
    });
    anchor.click();
    check.equal(exportClick, true, "export anchor clicks reach the existing navigation handler");
    exportView.destroy();

    // 复杂块保留在源列表中；预览不携带块身份，媒体控件也不触发节点拖拽或编辑。
    const specialList = reset("- Root\n  - First\n  - Second\n");
    const specialRoot = specialList.querySelector<HTMLElement>(".li");
    const specials = document.createElement("div");
    ["NodeTable", "NodeAttributeView", "NodeBlockQueryEmbed", "NodeCustomBlock", "NodeHTMLBlock", "NodeCallout",
        "NodeSuperBlock", "NodeVideo", "NodeAudio", "NodeIFrame", "NodeWidget"].forEach(type => {
        const element = document.createElement("div");
        element.dataset.nodeId = Lute.NewNodeID();
        element.dataset.type = type;
        element.dataset.content = "Source content";
        element.setAttribute("custom-preserved", "value");
        if (type === "NodeTable") {
            element.innerHTML = '<table><tbody><tr><td>Cell</td></tr></tbody></table><div class="protyle-action__table"></div>';
        } else {
            element.textContent = type;
        }
        const tag = ({NodeVideo: "video", NodeAudio: "audio", NodeIFrame: "iframe"} as Record<string, string>)[type];
        if (tag) {
            const media = document.createElement(tag);
            media.setAttribute("controls", "");
            element.append(media);
        }
        specials.append(element);
    });
    specialRoot.querySelector(".p").after(...Array.from(specials.children));
    const sourceChart = document.createElement("div");
    sourceChart.dataset.type = "NodeCodeBlock";
    sourceChart.dataset.nodeId = Lute.NewNodeID();
    sourceChart.setAttribute("_echarts_instance_", "source-instance");
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 4;
    sourceCanvas.height = 4;
    sourceCanvas.getContext("2d").fillStyle = "#123456";
    sourceCanvas.getContext("2d").fillRect(0, 0, 4, 4);
    sourceChart.append(sourceCanvas);
    specialRoot.querySelector(".p").after(sourceChart);
    const sourceContent = api.readListMindmap(specialList).root.contentBlocks.map((block: HTMLElement) => block.outerHTML);
    let specialEdits = 0;
    const specialView = new api.ListMindmapView({host: richHost, model: api.readListMindmap(specialList),
        onExit: () => {}, onEdit: () => specialEdits++, onMove: () => check.fail("Media started a node move")});
    check.equal(richHost.querySelector("[data-node-id]"), null);
    check.equal(richHost.querySelector(".protyle-action__table"), null);
    check.equal(richHost.querySelector("[_echarts_instance_]"), null);
    check.deepEqual(Array.from(richHost.querySelector<HTMLCanvasElement>(".list-mindmap__content canvas")
        .getContext("2d").getImageData(0, 0, 1, 1).data), [18, 52, 86, 255]);
    for (const tag of ["audio", "video", "iframe"]) {
        const media = richHost.querySelector(tag);
        const pointer = new PointerEvent("pointerdown", {bubbles: true, cancelable: true, pointerId: 9, button: 0});
        media.dispatchEvent(pointer);
        check.equal(pointer.defaultPrevented, false, tag);
        check.equal(specialView.pointer, undefined, tag);
        const keyboard = new KeyboardEvent("keydown", {key: " ", bubbles: true, cancelable: true});
        media.dispatchEvent(keyboard);
        check.equal(keyboard.defaultPrevented, false, tag);
        media.dispatchEvent(new MouseEvent("dblclick", {bubbles: true, cancelable: true}));
        check.equal(specialEdits, 0, tag);
    }
    const specialChildren = api.readListMindmap(specialList).root.children;
    check.equal(api.moveListMindmapNode(specialList, specialChildren[1].id, specialChildren[0].id, "before"), true);
    specialView.update(api.readListMindmap(specialList));
    check.deepEqual(api.readListMindmap(specialList).root.contentBlocks.map((block: HTMLElement) => block.outerHTML), sourceContent);
    specialView.destroy();
    check.deepEqual(api.readListMindmap(specialList).root.contentBlocks.map((block: HTMLElement) => block.outerHTML), sourceContent);

    // 真实列表与脑图逐项比较图标、删除线和颜色，覆盖导出及脱离编辑器容器的全屏布局。
    const taskStyle = document.createElement("style");
    taskStyle.textContent = taskCSS;
    document.head.append(taskStyle);

    // 引用和行内格式在两种主题、窄屏、大字号及脱离编辑器的全屏布局中保持一致。
    const inlineParent = document.createElement("div");
    inlineParent.className = "protyle-wysiwyg";
    const inlineList = reset("* Reference\n");
    const inlineText = inlineList.querySelector<HTMLElement>("[contenteditable]");
    const inlineTypes = ["block-ref", "virtual-block-ref", "file-annotation-ref", "a", "tag", "code", "strong", "em",
        "s", "u", "mark", "kbd", "inline-memo"];
    inlineText.innerHTML = inlineTypes.map(type => `<span data-type="${type}">Text</span>`).join(" ");
    const inlineHost = document.createElement("div");
    inlineParent.append(inlineList);
    document.body.append(inlineParent);
    inlineList.append(inlineHost);
    const inlineView = new api.ListMindmapView({host: inlineHost, model: api.readListMindmap(inlineList), onExit: () => {}});
    const rootStyle = document.documentElement.style.cssText;
    const themeMode = document.documentElement.getAttribute("data-theme-mode");
    const styleProperties = ["color", "background-image", "background-color", "border-bottom-style", "border-bottom-width",
        "font-style", "font-weight", "text-decoration-line"];
    const inlineStyle = (root: HTMLElement, type: string, properties: string[]) => {
        const style = getComputedStyle(root.querySelector(`[data-type="${type}"]`));
        return properties.map(property => style.getPropertyValue(property));
    };
    document.documentElement.style.setProperty("--b3-font-size-editor", "40px");
    document.documentElement.style.setProperty("--b3-font-family-protyle", "monospace");
    for (const mode of ["0", "1"]) {
        document.documentElement.setAttribute("data-theme-mode", mode);
        for (const name of ["blockref", "fileref", "link", "tag", "strong", "em", "s", "u", "mark"]) {
            document.documentElement.style.setProperty(`--b3-protyle-inline-${name}-color`, mode === "0" ? "#334455" : "#ddeeff");
        }
        for (const width of [360, 760]) {
            inlineParent.style.width = `${width}px`;
            await settle();
            const beforeFullscreen = inlineTypes.map(type => inlineStyle(inlineHost, type, [...styleProperties, "font-size", "font-family"]));
            check.notEqual(inlineStyle(inlineHost, "block-ref", ["background-image"])[0], "none");
            inlineTypes.forEach(type => check.deepEqual(inlineStyle(inlineHost, type, styleProperties),
                inlineStyle(inlineText, type, styleProperties), type));
            inlineHost.querySelector<HTMLButtonElement>('[aria-label="fullscreen"]').click();
            await settle();
            check.equal(inlineHost.parentElement, document.body);
            inlineTypes.forEach((type, index) => check.deepEqual(inlineStyle(inlineHost, type,
                [...styleProperties, "font-size", "font-family"]), beforeFullscreen[index], `${mode}/${width}/${type}`));
            inlineHost.querySelector<HTMLButtonElement>('[aria-label="exitFullscreen"]').click();
            await settle();
        }
    }
    inlineView.destroy();
    inlineParent.remove();
    document.documentElement.style.cssText = rootStyle;
    if (themeMode === null) {
        document.documentElement.removeAttribute("data-theme-mode");
    } else {
        document.documentElement.setAttribute("data-theme-mode", themeMode);
    }

    lute.SetArbitraryTaskListItemMarker(true);
    lute.SetDataTask(true);
    const taskParent = document.createElement("div");
    taskParent.className = "protyle-wysiwyg";
    taskParent.style.setProperty("--b3-theme-on-surface-light", "#8899aa");
    taskParent.style.setProperty("--b3-theme-on-background", "#223344");
    taskParent.innerHTML = lute.Md2BlockDOM("* [ ] Task\n\n  Second paragraph\n\n  * [/] Child\n* Ordinary\n");
    document.body.append(taskParent);
    const taskList = taskParent.firstElementChild as HTMLElement;
    const ordinaryItem = taskParent.querySelector<HTMLElement>('.li[data-subtype="u"]');
    taskList.insertBefore(ordinaryItem, taskList.lastElementChild);
    const taskItem = taskList.querySelector<HTMLElement>(".li");
    const taskId = taskItem.dataset.nodeId;
    const taskHost = document.createElement("div");
    taskHost.style.width = "700px";
    taskParent.append(taskHost);
    const operations: {id: string, before: string, after: string}[] = [];
    const taskAPI = new Function("readListMindmap", "canEdit", "Constants", "dayjs", "updateTransaction", "showMessage",
        "getListMindmapTabItem", "getTabTask", "cleanListMindmapHTML",
        taskSource + "; return {setTaskListItemMarker, nextTaskListMarker, nextTaskListStatus, TaskController};")(
        api.readListMindmap, (owner: any) => !owner.disabled && !owner.history && !owner.embedded,
        {CB_GET_HISTORY: "history", ATTRIBUTE_EDITING: "data-editing"},
        () => ({format: () => "20260920000000"}),
        (_owner: unknown, element: HTMLElement, before: string) => operations.push({id: element.dataset.nodeId,
            before, after: api.cleanListMindmapHTML(element.outerHTML)}), () => check.fail("Task update failed"),
        api.getListMindmapTabItem, api.getTabTask, api.cleanListMindmapHTML);
    const owner = {disabled: false, history: false, embedded: false, options: {action: [] as string[]}};
    let finishTask: boolean | Promise<boolean> = true;
    let menus = 0;
    let taskEdits = 0;
    const taskView = new api.ListMindmapView({host: taskHost, model: api.readListMindmap(taskList),
        labels: new Proxy({}, {get: (_target, key) => String(key)}), onExit: () => {},
        onEdit: () => taskEdits++, onMove: () => check.fail("Task control started a drag"),
        onRelationAdd: () => check.fail("Task control created a relation"),
        finishEdit: () => finishTask, onTaskMenu: () => menus++,
        isTaskCycle: (event: KeyboardEvent) => event.ctrlKey && event.key === "l",
        onTaskToggle: (id: string, cycle: boolean) => controller.setTask(id,
            cycle ? taskAPI.nextTaskListStatus : taskAPI.nextTaskListMarker)});
    const controller = Object.assign(new taskAPI.TaskController(), {owner, list: taskList, disposed: false,
        taskChanges: Promise.resolve(), refresh: () => taskView.update(api.readListMindmap(taskList))});
    const taskNode = () => taskHost.querySelector<HTMLElement>(`[data-mindmap-id="${taskId}"]`);
    const taskButton = () => taskNode().querySelector<HTMLButtonElement>(".list-mindmap__task");
    const compare = () => {
        const sourceAction = taskItem.querySelector(".protyle-action--task");
        const button = taskButton();
        check.equal(button.querySelector("use").getAttribute("xlink:href"),
            sourceAction.querySelector("use").getAttribute("xlink:href"));
        for (const property of ["content", "fontSize", "transform"] as const) {
            check.equal(getComputedStyle(button, "::before")[property],
                getComputedStyle(sourceAction, "::before")[property]);
        }
        for (const property of ["maskImage", "height"] as const) {
            check.equal(getComputedStyle(button.querySelector("svg"))[property],
                getComputedStyle(sourceAction.querySelector("svg"))[property]);
        }
        const originals = taskItem.querySelectorAll(":scope > .p");
        const previews = taskNode().querySelectorAll(":scope > .list-mindmap__content > .p");
        check.equal(previews.length, originals.length);
        originals.forEach((original, index) => {
            for (const property of ["color", "textDecorationLine"] as const) {
                check.equal(getComputedStyle(previews[index])[property], getComputedStyle(original)[property]);
            }
        });
    };
    taskParent.style.fontSize = "16px";
    taskParent.style.color = "#223344";
    for (const marker of [" ", "/", "X", "x", "-", "?", "A", "\"", "&", "<", "\\"]) {
        taskAPI.setTaskListItemMarker(owner, taskItem, marker);
        controller.refresh();
        await settle();
        compare();
        check.equal(taskNode().querySelector("[data-node-id]"), null);
        check.equal(taskHost.querySelectorAll(".list-mindmap__task").length, 2);
        check.equal(taskView.model.root.taskMarker, undefined, "virtual roots are not tasks");
        const child = taskView.model.nodes.get(taskId).children[0];
        check.equal(taskView.model.nodes.get(child.id).taskMarker, "/");
        const childNode = taskHost.querySelector(`[data-mindmap-id="${child.id}"] .p`);
        check.equal(getComputedStyle(childNode).textDecorationLine, "none", "parent state never styles child tasks");
    }
    taskHost.scrollIntoView({block: "center"});
    await settle();
    const taskTextBounds = taskView.getContentHost(taskId).firstElementChild.getBoundingClientRect();
    const taskTextPoint = {x: Math.round(taskTextBounds.left + taskTextBounds.width / 2),
        y: Math.round(taskTextBounds.top + taskTextBounds.height / 2)};
    await require("electron").ipcRenderer.invoke("list-mindmap-native-input", [
        {type: "mouseMove", ...taskTextPoint},
        {type: "mouseDown", ...taskTextPoint, button: "left", clickCount: 1},
        {type: "mouseUp", ...taskTextPoint, button: "left", clickCount: 1},
        {type: "mouseDown", ...taskTextPoint, button: "left", clickCount: 2},
        {type: "mouseUp", ...taskTextPoint, button: "left", clickCount: 2},
    ]);
    await settle();
    check.equal(taskEdits, 1, "native double click opens the task node editor");
    taskEdits = 0;
    taskView.setEditing(undefined);
    const taskSourceHTML = taskList.outerHTML;
    taskView.setReadOnly(true);
    taskButton().click();
    taskButton().dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
    await settle();
    check.equal(taskList.outerHTML, taskSourceHTML);
    check.equal(menus, 0);
    check.equal(taskButton().disabled, true);
    taskView.setReadOnly(false);
    check.equal(taskButton().disabled, false);
    taskButton().dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
    check.equal(menus, 1);
    taskAPI.setTaskListItemMarker(owner, taskItem, " ");
    controller.refresh();
    operations.length = 0;
    taskButton().click();
    taskButton().click();
    await controller.taskChanges;
    check.equal(taskItem.dataset.task, " ");
    check.equal(operations.length, 2);
    check.ok(operations.every(operation => operation.id === taskId && !operation.after.includes("list-mindmap__")));
    const operation = operations[0];
    const replay = document.createElement("div");
    for (const [html, marker] of [[operation.after, "X"], [operation.before, " "]] as const) {
        replay.innerHTML = lute.SpinBlockDOM(html);
        check.equal(replay.querySelector(".li").getAttribute("data-task"), marker, "transaction snapshots preserve redo and undo states");
    }
    taskButton().dispatchEvent(new KeyboardEvent("keydown", {key: "l", ctrlKey: true, bubbles: true, cancelable: true}));
    await controller.taskChanges;
    check.equal(taskItem.dataset.task, "/");
    taskButton().dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    check.equal(taskEdits, 0);
    finishTask = false;
    taskButton().click();
    await controller.taskChanges;
    check.equal(taskItem.dataset.task, "/", "failed content saves prevent task changes");
    finishTask = true;
    for (const mode of ["disabled", "history", "embedded"] as const) {
        owner[mode] = true;
        await controller.setTask(taskId, () => "X");
        check.equal(taskItem.dataset.task, "/");
        owner[mode] = false;
    }
    let release: (result: boolean) => void;
    controller.activeEditor = {finish: () => new Promise<boolean>(resolve => release = resolve)};
    const pendingChange = controller.setTask(taskId, () => "X");
    await Promise.resolve();
    owner.disabled = true;
    release(true);
    await pendingChange;
    check.equal(taskItem.dataset.task, "/", "permission is rechecked after content saves");
    owner.disabled = false;
    controller.activeEditor = undefined;
    taskView.enterFullscreen();
    check.equal(getComputedStyle(taskButton().querySelector("svg")).maskImage.includes("task-in-progress.svg"), true);
    taskView.exitFullscreen();
    // 导出 DOM 的标记可以位于任务图标上；真实任务根节点仍显示复选框。
    const exportedTaskList = taskList.cloneNode(true) as HTMLElement;
    exportedTaskList.querySelectorAll<HTMLElement>('.li[data-subtype="t"]').forEach(item => {
        item.querySelector(".protyle-action--task").setAttribute("data-task", item.dataset.task);
        item.removeAttribute("data-task");
    });
    check.equal(api.readListMindmap(exportedTaskList).nodes.get(taskId).taskMarker, "/");
    exportedTaskList.querySelector(':scope > .li[data-subtype="u"]').remove();
    const rootModel = api.readListMindmap(exportedTaskList);
    check.equal(rootModel.root.virtual, false);
    check.equal(rootModel.root.taskMarker, "/");
    taskView.setReadOnly(true);
    taskView.update(rootModel);
    check.ok(taskButton());
    taskView.destroy();
    // 页签预览将任务操作交给所属脑图保存，外层页签渲染器不能接管派生控件。
    taskParent.innerHTML = lute.Md2BlockDOM("- Container\n");
    const tabList = taskParent.firstElementChild as HTMLElement;
    const tabNode = tabList.querySelector<HTMLElement>(".li");
    const tabNodeID = tabNode.dataset.nodeId;
    const tabContent = document.createElement("div");
    tabContent.innerHTML = lute.Md2BlockDOM("::: tabs\n@tab First\n\nOne\n@tab Second\n\nTwo\n:::\n{: tabs-task=\"true\"}\n");
    tabNode.querySelector(".p").replaceWith(tabContent.firstElementChild);
    const tabSource = tabNode.querySelector<HTMLElement>(".tabs");
    const sourceActiveTab = tabSource.getAttribute("tabs-active-id");
    const tabItemIDs = Array.from(tabSource.querySelectorAll<HTMLElement>(":scope > .tab-item"))
        .map(item => item.dataset.nodeId);
    const tabHost = document.createElement("div");
    tabList.append(tabHost);
    const tabController = Object.assign(new taskAPI.TaskController(), {owner, list: tabList, disposed: false,
        taskChanges: Promise.resolve(), refresh: () => tabView.update(api.readListMindmap(tabList))});
    let tabMenus = 0;
    const tabView = new api.ListMindmapView({host: tabHost, model: api.readListMindmap(tabList), onExit: () => {},
        onTabTaskToggle: (id: string, itemID: string) => tabController.setTabTask(id, itemID, taskAPI.nextTaskListMarker),
        onTabTaskMenu: (id: string, itemID: string, anchor: HTMLElement) => {
            check.equal(id, tabNodeID);
            check.equal(itemID, tabItemIDs[1]);
            check.ok(anchor.classList.contains("tabs-task"));
            tabMenus++;
        }});
    const outerOptions = {readonly: () => false, task: () => check.fail("Outer editor claimed a preview task")};
    api.tabsRender(taskParent, outerOptions);
    const previewTask = (index = 1) => tabHost.querySelectorAll<HTMLElement>(".tabs-task")[index];
    const previewTab = (index = 1) => tabHost.querySelectorAll<HTMLElement>(".tabs-tab")[index];
    previewTab().click();
    operations.length = 0;
    previewTask().click();
    await tabController.taskChanges;
    check.equal(operations.length, 1);
    check.equal(operations[0].id, tabList.dataset.nodeId);
    check.equal(api.getTabTask(api.getListMindmapTabItem(tabList, tabNodeID, tabItemIDs[1])), "X");
    check.equal(previewTask().getAttribute("data-task"), "X");
    check.equal(previewTab().getAttribute("aria-selected"), "true", "saving a task preserves the visible preview tab");
    check.equal(tabHost.querySelector(".tabs-control"), null, "preview only exposes supported writes");
    check.equal(tabHost.querySelector("[data-node-id]"), null);
    check.equal(tabSource.getAttribute("tabs-active-id"), sourceActiveTab, "preview navigation does not change source navigation");
    for (const [html, marker] of [[operations[0].after, "X"], [operations[0].before, " "]] as const) {
        replay.innerHTML = lute.SpinBlockDOM(html);
        check.equal(api.getTabTask(replay.querySelectorAll(".tab-item")[1]), marker);
        check.ok(!html.includes("list-mindmap__"));
    }
    api.tabsRender(taskParent, outerOptions);
    previewTask().dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
    check.equal(tabMenus, 1);
    previewTask().click();
    previewTask().click();
    await tabController.taskChanges;
    check.equal(previewTask().getAttribute("data-task"), "X", "queued clicks read the latest source state");
    previewTask().dispatchEvent(new KeyboardEvent("keydown", {key: " ", bubbles: true, cancelable: true}));
    await tabController.taskChanges;
    check.equal(previewTask().getAttribute("data-task"), " ");
    const savedCount = operations.length;
    tabView.setReadOnly(true);
    check.equal(previewTask().getAttribute("aria-disabled"), "true");
    previewTask().click();
    await tabController.taskChanges;
    check.equal(operations.length, savedCount);
    previewTab(0).click();
    check.equal(previewTab(0).getAttribute("aria-selected"), "true", "readonly previews still navigate");
    tabView.setReadOnly(false);
    for (const mode of ["disabled", "history", "embedded"] as const) {
        owner[mode] = true;
        await tabController.setTabTask(tabNodeID, tabItemIDs[1], () => "X");
        check.equal(operations.length, savedCount);
        owner[mode] = false;
    }
    tabController.activeEditor = {finish: async () => false};
    previewTask().click();
    await tabController.taskChanges;
    check.equal(operations.length, savedCount, "failed content saves prevent tab task changes");
    tabController.activeEditor = undefined;
    const removedTab = api.getListMindmapTabItem(tabList, tabNodeID, tabItemIDs[1]);
    removedTab.remove();
    await tabController.setTabTask(tabNodeID, tabItemIDs[1], () => "X");
    check.equal(operations.length, savedCount, "removed tab IDs never produce an update");
    tabView.destroy();
    api.destroyTabsRender(taskParent);
    taskParent.remove();

    // 使用编辑器的实际划选监听器，验证从两侧进入脑图、跨块移动及松手清理。
    const dragParent = document.createElement("div");
    dragParent.style.cssText = "position:fixed;inset:0;background:white;z-index:9999;overflow:auto";
    const dragEditor = document.createElement("div");
    dragEditor.className = "protyle-wysiwyg";
    dragEditor.style.cssText = "padding:20px 64px;box-sizing:border-box";
    dragEditor.innerHTML = lute.Md2BlockDOM("Before\n\n- Alpha\n- Beta\n\nAfter\n");
    const dragList = dragEditor.querySelector<HTMLElement>(".list");
    dragList.setAttribute("custom-sy-list-mindmap", "1");
    dragList.dataset.listMindmapRendered = "true";
    const dragHost = document.createElement("div");
    dragHost.className = "list-mindmap";
    dragHost.style.height = "260px";
    dragList.append(dragHost);
    const dragView = new api.ListMindmapView({host: dragHost, model: api.readListMindmap(dragList)});
    const dragOverlay = document.createElement("div");
    dragOverlay.className = "fn__none";
    dragOverlay.style.position = "absolute";
    const dragStyle = document.createElement("style");
    dragStyle.textContent = ".fn__none {display:none} .drag-selection {position:absolute;pointer-events:none}";
    dragOverlay.classList.add("drag-selection");
    dragParent.append(dragEditor, dragOverlay, dragStyle);
    document.body.append(dragParent);
    const noop = () => {};
    const absent = () => false;
    const selectedCounts: string[][] = [];
    const services = {
        Constants: {ZWSP: "\u200b"},
        getAVTemplateInteractiveElement: absent, getAVSelectionRoot: absent, isAVDragSelectSupported: absent,
        isTableLikeView: absent, isMobile: absent, shouldFoldEmbeddedListByAlt: absent,
        shouldOpenListItemAttr: absent, isHiddenTabContent: absent,
        isOnlyMeta: (event: MouseEvent) => (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey,
        repairHiddenTabSelection: noop, clearSelect: noop, hideAllElements: noop, globalClickHideMenu: noop,
        dragOverScroll: noop, stopScrollAnimation: noop, countBlockWord: (ids: string[]) => selectedCounts.push(ids),
    };
    const dragOwner = {
        element: dragParent, contentElement: dragParent, selectElement: dragOverlay,
        wysiwyg: {element: dragEditor}, options: {render: {breadcrumb: false}},
        toolbar: {isMultiSelectMode: absent},
        hint: {deactivateEmojiPanel: noop, element: document.createElement("div")},
    };
    new Function("protyle", "services", `const {${Object.keys(services).join(",")}} = services;\n` + dragSource)
        .call(Object.assign(dragOwner.wysiwyg, {host: dragHost, owner: dragOwner}), dragOwner, services);
    const dragErrors: string[] = [];
    const collectDragError = (event: ErrorEvent) => dragErrors.push(event.message);
    window.addEventListener("error", collectDragError);
    await settle();
    const selectedIDs = () => Array.from(dragEditor.querySelectorAll<HTMLElement>(".protyle-wysiwyg--select"))
        .map(item => item.dataset.nodeId);
    for (const side of ["left", "right"]) {
        for (const direction of [1, -1]) {
            dragEditor.querySelectorAll(".protyle-wysiwyg--select").forEach(item =>
                item.classList.remove("protyle-wysiwyg--select"));
            const rect = dragHost.getBoundingClientRect();
            const start = {x: Math.round(side === "left" ? rect.left - 32 : rect.right + 32),
                y: Math.round(rect.top + rect.height / 2)};
            const inside = {x: Math.round(side === "left" ? rect.left + 24 : rect.right - 24),
                y: start.y + 30 * direction};
            check.ok(dragHost.contains(document.elementFromPoint(inside.x, inside.y)));
            await nativeInput([
                {type: "mouseMove", ...start},
                {type: "mouseDown", ...start, button: "left", clickCount: 1},
                {type: "mouseMove", ...inside, button: "left"},
            ]);
            check.deepEqual(dragErrors, []);
            check.deepEqual(selectedIDs(), [dragList.dataset.nodeId], `${side} ${direction}: selects the whole mind map`);
            const adjacent = direction === 1 ? dragList.nextElementSibling : dragList.previousElementSibling;
            const outside = {x: inside.x, y: Math.round(adjacent.getBoundingClientRect().top + 10)};
            await nativeInput([{type: "mouseMove", ...outside, button: "left"}]);
            check.deepEqual(new Set(selectedIDs()), new Set([dragList.dataset.nodeId, adjacent.getAttribute("data-node-id")]));
            await nativeInput([{type: "mouseMove", ...inside, button: "left"}]);
            check.deepEqual(selectedIDs(), [dragList.dataset.nodeId], "returning into the mind map shrinks the selection");
            await nativeInput([{type: "mouseUp", ...inside, button: "left", clickCount: 1}]);
            check.deepEqual(dragErrors, []);
            check.equal(dragEditor.classList.contains("fn__pointer-none"), false);
            check.ok(dragOverlay.classList.contains("fn__none"));
            await nativeInput([{type: "mouseMove", ...outside}]);
            check.deepEqual(selectedIDs(), [dragList.dataset.nodeId], "moving after release does not extend the selection");
            check.ok(dragOverlay.classList.contains("fn__none"));

            // 点击空白画布或节点均退出块选中状态，并清理多块选区、端点标记和状态栏计数。
            adjacent.classList.add("protyle-wysiwyg--select");
            dragList.classList.add("protyle-wysiwyg--select-mode");
            dragList.setAttribute("select-start", "true");
            dragList.setAttribute("select-end", "true");
            selectedCounts.length = 0;
            const clickPoint = side === "left" ? inside : centerPoint(dragHost.querySelector(".list-mindmap__node"));
            await nativeInput([
                {type: "mouseMove", ...clickPoint},
                {type: "mouseDown", ...clickPoint, button: "left", clickCount: 1},
                {type: "mouseUp", ...clickPoint, button: "left", clickCount: 1},
            ]);
            check.deepEqual(dragErrors, []);
            check.deepEqual(selectedIDs(), [], "clicking the mind map clears the outer block selection");
            check.equal(dragList.classList.contains("protyle-wysiwyg--select-mode"), false);
            check.equal(dragList.hasAttribute("select-start"), false);
            check.equal(dragList.hasAttribute("select-end"), false);
            check.deepEqual(selectedCounts, [[]]);
        }
    }
    // 右键和多选工具栏操作保留选区，内嵌编辑器的工具栏同样不能取消其操作对象。
    dragList.classList.add("protyle-wysiwyg--select");
    const selectionPointerDown = (element: Element, button = 0) =>
        element.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, button}));
    selectionPointerDown(dragHost, 2);
    check.deepEqual(selectedIDs(), [dragList.dataset.nodeId]);
    dragOwner.toolbar.isMultiSelectMode = () => true;
    selectionPointerDown(dragHost);
    check.deepEqual(selectedIDs(), [dragList.dataset.nodeId]);
    dragOwner.toolbar.isMultiSelectMode = absent;
    const selectionToolbar = document.createElement("div");
    selectionToolbar.className = "protyle-toolbar";
    dragHost.append(selectionToolbar);
    selectionPointerDown(selectionToolbar);
    check.deepEqual(selectedIDs(), [dragList.dataset.nodeId]);
    check.deepEqual(dragErrors, []);
    window.removeEventListener("error", collectDragError);
    dragView.destroy();
    dragParent.remove();
    taskStyle.remove();
    hostParent.remove();
    style.remove();
    return "List mindmap DOM cases passed";
};

test("list mindmap mutations preserve block data in the real DOM and Lute", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-list-mindmap-test-"));
    const script = path.join(temporary, "run.cjs");
    const typescript = require("typescript") as typeof import("typescript");
    const compile = (file: string) => typescript.transpileModule(
        readFileSync(file, "utf8").replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
            compilerOptions: {target: typescript.ScriptTarget.ES2021},
        }).outputText;
    const inputModules = ["../../../util/escape.ts", "../../util/normalizeText.ts", "../../runtimeCapabilities.ts",
        "../../../util/keymapBindings.ts", "../../util/hotKey.ts",
        "../../util/longTextWrap.ts", "../../util/inlineElementBoundary.ts", "../../util/inlineElementMarker.ts",
        "../../util/hasClosest.ts", "../../wysiwyg/getBlock.ts", "../../util/selection.ts",
        "../../wysiwyg/taskListMarker.ts", "../../wysiwyg/turnIntoList.ts", "../../wysiwyg/input.ts"];
    let inputSource = inputModules.map(file => {
        const filename = path.join(__dirname, file);
        const module = typescript.createSourceFile(file, readFileSync(filename, "utf8"), typescript.ScriptTarget.ES2021, true);
        const names = module.statements.filter(typescript.isVariableStatement).filter(statement =>
            statement.modifiers?.some(modifier => modifier.kind === typescript.SyntaxKind.ExportKeyword))
            .flatMap(statement => statement.declarationList.declarations.map(declaration => declaration.name.getText(module)));
        return `const {${names.join(", ")}} = (() => {${compile(filename)}\nreturn {${names.join(", ")}};})();\n`;
    }).join("\n");
    const editorSource = typescript.createSourceFile("editor.ts", readFileSync(path.join(__dirname, "editor.ts"), "utf8"),
        typescript.ScriptTarget.ES2021, true);
    const listItemCapabilities: import("typescript").PropertyAssignment[] = [];
    const findListItemCapability = (node: import("typescript").Node) => {
        if (typescript.isPropertyAssignment(node) && node.name.getText(editorSource) === "listItemFragment") {
            listItemCapabilities.push(node);
        }
        typescript.forEachChild(node, findListItemCapability);
    };
    findListItemCapability(editorSource);
    assert.equal(listItemCapabilities.length, 1);
    inputSource += `\nconst configureListItemInput = (protyle) => {
        registerProtyleRuntimeCapabilities(protyle, {${listItemCapabilities.map(item => item.getText(editorSource)).join(",\n")}});
    };`;
    const keydownSource = typescript.createSourceFile("keydown.ts", readFileSync(path.join(__dirname, "../../wysiwyg/keydown.ts"), "utf8"),
        typescript.ScriptTarget.ES2021, true);
    const shortcutStatements: import("typescript").Node[] = [];
    const findShortcut = (node: import("typescript").Node) => {
        if ((typescript.isVariableStatement(node) && node.declarationList.declarations.some(item =>
            ["isMatchList", "isMatchOList", "isMatchCheck", "isMatchQuote"].includes(item.name.getText(keydownSource)))) ||
            (typescript.isIfStatement(node) && node.expression.getText(keydownSource).includes("isProtyleListItemFragment("))) {
            shortcutStatements.push(node);
        }
        typescript.forEachChild(node, findShortcut);
    };
    findShortcut(keydownSource);
    assert.equal(shortcutStatements.length, 5);
    const hintSource = typescript.createSourceFile("hint.ts", readFileSync(path.join(__dirname, "../../hint/index.ts"), "utf8"),
        typescript.ScriptTarget.ES2021, true);
    const hint = hintSource.statements.filter(typescript.isClassDeclaration).find(item => item.name?.text === "Hint");
    const fill = hint.members.find(item => item.name?.getText(hintSource) === "fill");
    inputSource += typescript.transpileModule(`\nconst listShortcut = (protyle, nodeElement, event) => {
        ${shortcutStatements.map(item => item.getText(keydownSource)).join("\n")}
    };
    class ListHint {${fill.getText(hintSource)}}`, {compilerOptions: {target: typescript.ScriptTarget.ES2021}}).outputText;
    const tabsSource = "const {tabsRender, destroyTabsRender, getTabTask} = (() => {" +
        ["../../../util/escape.ts", "../tabsState.ts", "../tabsDrag.ts", "../tabsAttributes.ts", "../tabsRender.ts"]
            .map(file => compile(path.join(__dirname, file))).join("\n") +
        "return {tabsRender, destroyTabsRender, getTabTask};})();\n";
    const source = tabsSource + compile(path.join(__dirname, "../av/richTextValue.ts")) + compile(path.join(__dirname, "../../wysiwyg/listContext.ts")) +
        compile(path.join(__dirname, "model.ts")) + compile(path.join(__dirname, "routing.ts")) + compile(path.join(__dirname, "view.ts")) +
        compile(path.join(__dirname, "legacy.ts")) + compile(path.join(__dirname, "migrate.ts")) +
        compile(path.join(__dirname, "create.ts"));
    const css = require("sass").compile(path.resolve(__dirname, "../../../assets/scss/business/_block.scss")).css +
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss/business/_color.scss")).css +
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss/component/_tooltips.scss")).css +
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss/protyle/_list-mindmap.scss")).css;
    const taskCSS = require("sass").compile(path.resolve(__dirname, "../../../assets/scss/protyle/_wysiwyg.scss")).css +
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss/component/_typography.scss")).css;
    const indexSource = typescript.createSourceFile("index.ts", readFileSync(path.join(__dirname, "index.ts"), "utf8"),
        typescript.ScriptTarget.Latest, true);
    const controller = indexSource.statements.find(typescript.isClassDeclaration);
    const taskMethods = controller.members.filter(member => ["setTask", "setTabTask", "queueTask", "change"]
        .includes(member.name?.getText(indexSource)));
    const listSource = typescript.createSourceFile("list.ts", readFileSync(path.join(__dirname, "../../wysiwyg/list.ts"), "utf8"),
        typescript.ScriptTarget.Latest, true);
    const setter = listSource.statements.filter(typescript.isVariableStatement).find(statement =>
        statement.declarationList.declarations.some(item => item.name.getText(listSource) === "setTaskListItemMarker"));
    const taskSource = compile(path.join(__dirname, "../../wysiwyg/taskListMarker.ts")) +
        typescript.transpileModule(setter.getText(listSource).replace(/^export /, "") +
            `\nclass TaskController {${taskMethods.map(member => member.getText(indexSource)).join("\n")}}`, {
                compilerOptions: {target: typescript.ScriptTarget.ES2021},
            }).outputText;
    const wysiwygSource = typescript.createSourceFile("index.ts",
        readFileSync(path.join(__dirname, "../../wysiwyg/index.ts"), "utf8"), typescript.ScriptTarget.Latest, true);
    let mouseDownBinding: import("typescript").CallExpression;
    const findMouseDown = (node: import("typescript").Node) => {
        if (typescript.isCallExpression(node) && node.expression.getText(wysiwygSource) === "this.element.addEventListener" &&
            node.arguments[0]?.getText(wysiwygSource) === '"mousedown"') {
            mouseDownBinding = node;
        }
        typescript.forEachChild(node, findMouseDown);
    };
    findMouseDown(wysiwygSource);
    assert.ok(mouseDownBinding);
    const constructor = controller.members.find(typescript.isConstructorDeclaration);
    const pointerDownBinding = constructor.body.statements.find(statement =>
        typescript.isExpressionStatement(statement) && typescript.isCallExpression(statement.expression) &&
        statement.expression.expression.getText(indexSource) === "this.host.addEventListener" &&
        statement.expression.arguments[0]?.getText(indexSource) === '"pointerdown"');
    assert.ok(pointerDownBinding);
    const dragSource = compile(path.join(__dirname, "../../util/hasClosest.ts")) +
        compile(path.join(__dirname, "../../wysiwyg/getBlock.ts")) +
        compile(path.join(__dirname, "../../wysiwyg/blockDragSelect.ts")) +
        "const {getBlockSelectionModeElement, clearBlockSelectionMode} = (() => {" +
        compile(path.join(__dirname, "../../wysiwyg/blockSelection.ts")) +
        "return {getBlockSelectionModeElement, clearBlockSelectionMode};})();\n" +
        "const {hideElements} = (() => {" + compile(path.join(__dirname, "../../ui/hideElements.ts")) +
        "return {hideElements};})();\n" +
        typescript.transpileModule(mouseDownBinding.getText(wysiwygSource) + ";\n" + pointerDownBinding.getText(indexSource), {
            compilerOptions: {target: typescript.ScriptTarget.ES2021},
        }).outputText;
    const lutePath = path.resolve(__dirname, "../../../../stage/protyle/js/lute/lute.min.js");
    // 展开测试函数，避免断言失败时 Node 从压缩后的源码提取表达式而掩盖实际错误。
    const browserSource = typescript.transpileModule(`(${browserCases.toString()})`, {
        compilerOptions: {target: typescript.ScriptTarget.ES2021},
    }).outputText.trim().replace(/;$/, "");
    const code = `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    win.webContents.debugger.attach("1.3");
    ipcMain.handle("list-mindmap-print-media", async (_event, media) => {
        await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {media});
    });
    ipcMain.handle("list-mindmap-native-input", async (_event, events) => {
        for (const event of events) {
            win.webContents.sendInputEvent(event);
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    });
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lutePath)}, "utf8"));
        const result = await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserSource})(${JSON.stringify(source)}, ${JSON.stringify(css)}, ${JSON.stringify(taskSource)}, ${JSON.stringify(taskCSS)}, ${JSON.stringify(dragSource)}, ${JSON.stringify(inputSource)})`)});
        console.log(result);
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`;
    writeFileSync(script, code, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const executable = require("electron") as unknown as string;
        const result = await promisify(execFile)(executable, [script], {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /List mindmap DOM cases passed/);
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
