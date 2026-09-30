import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import * as path from "node:path";
import test from "node:test";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

// 使用项目已有的 HTML 解析器承载节点操作，Lute 负责真实块 DOM 的生成和转换。
const parse5 = createRequire(require.resolve("html-loader"))("parse5");
class ElementFixture {
    constructor(public node: any) {}
    get ownerDocument() { return documentFixture; }
    get children(): ElementFixture[] { return (this.node.childNodes || []).filter((node: any) => node.tagName).map(wrap); }
    get childNodes(): ElementFixture[] { return (this.node.childNodes || []).map(wrap); }
    get firstElementChild() { return this.children[0]; }
    get parentElement() { return this.node.parentNode ? wrap(this.node.parentNode) : undefined; }
    get attributes() { return this.node.attrs || []; }
    get nodeType() { return this.node.tagName ? 1 : this.node.nodeName === "#comment" ? 8 : 11; }
    get nodeValue() { return this.node.data; }
    get dataset() { return {nodeId: this.getAttribute("data-node-id"), subtype: this.getAttribute("data-subtype"),
        type: this.getAttribute("data-type")}; }
    get classList() {
        const classes = () => (this.getAttribute("class") || "").split(/\s+/);
        return {contains: (name: string) => classes().includes(name), replace: (from: string, to: string) =>
            this.setAttribute("class", classes().map(name => name === from ? to : name).join(" "))};
    }
    getAttribute(name: string): string | null { return this.attributes.find((attr: any) => attr.name === name)?.value ?? null; }
    hasAttribute(name: string) { return this.getAttribute(name) !== null; }
    setAttribute(name: string, value: string) {
        this.removeAttribute(name);
        (this.node.attrs ||= []).push({name, value});
    }
    removeAttribute(name: string) { this.node.attrs = this.attributes.filter((attr: any) => attr.name !== name); }
    get outerHTML(): string { return parse5.serialize({nodeName: "#document-fragment", childNodes: [this.node]}); }
    get innerHTML(): string { return parse5.serialize(this.node); }
    set innerHTML(value: string) {
        this.node.childNodes = parse5.parseFragment(value).childNodes;
        this.node.childNodes.forEach((child: any) => { child.parentNode = this.node; });
    }
    get textContent(): string {
        return this.node.nodeName === "#text" ? this.node.value : this.childNodes.map(child => child.textContent).join("");
    }
    set textContent(value: string) {
        this.node.childNodes = [{nodeName: "#text", value, parentNode: this.node}];
    }
    remove() {
        if (this.node.parentNode) {
            this.node.parentNode.childNodes = this.node.parentNode.childNodes.filter((child: any) => child !== this.node);
            this.node.parentNode = undefined;
        }
    }
    insertBefore(child: ElementFixture, before: ElementFixture | null) {
        child.remove();
        const index = before ? this.node.childNodes.indexOf(before.node) : this.node.childNodes.length;
        assert.ok(index >= 0);
        this.node.childNodes.splice(index, 0, child.node);
        child.node.parentNode = this.node;
    }
    replaceChildren(...children: ElementFixture[]) {
        this.childNodes.forEach(child => child.remove());
        children.forEach(child => this.insertBefore(child, null));
    }
    cloneNode() { return wrap(parse5.parseFragment(this.outerHTML)).firstElementChild; }
    querySelector<T = ElementFixture>(selector: string): T | null { return this.querySelectorAll<T>(selector)[0] || null; }
    querySelectorAll<T = ElementFixture>(selector: string): T[] {
        if (selector.includes(", ")) {
            return selector.split(", ").flatMap(part => this.querySelectorAll<T>(part));
        }
        const matches = (element: ElementFixture, value: string) => {
            if (value.startsWith(".")) { return element.classList.contains(value.slice(1)); }
            const attr = value.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
            return attr ? attr[2] === undefined ? element.hasAttribute(attr[1]) :
                element.getAttribute(attr[1]) === attr[2] : element.node.tagName === value;
        };
        if (selector.startsWith(":scope > ")) {
            return this.children.filter(child => matches(child, selector.slice(9))) as T[];
        }
        const parts = selector.split(" > ");
        const descendants: ElementFixture[] = [];
        const visit = (element: ElementFixture) => element.children.forEach(child => { descendants.push(child); visit(child); });
        visit(this);
        return descendants.filter(child => matches(child, parts[parts.length - 1]) &&
            (parts.length === 1 || matches(child.parentElement, parts[0]))) as T[];
    }
}
const wrap = (node: any) => new ElementFixture(node);
const documentFixture = {createTreeWalker: (root: ElementFixture) => {
    const comments: ElementFixture[] = [];
    const visit = (element: ElementFixture) => element.childNodes.forEach(child => {
        if (child.nodeType === 8) { comments.push(child); }
        visit(child);
    });
    visit(root);
    let index = -1;
    return {nextNode: () => comments[++index], get currentNode() { return comments[index]; }};
}, createElement: (name: string) => {
    if (name !== "template") { return wrap(parse5.parseFragment(`<${name}></${name}>`)).firstElementChild; }
    const fragment = wrap(parse5.parseFragment(""));
    return {content: fragment, get innerHTML() { return fragment.innerHTML; },
        set innerHTML(value: string) { fragment.innerHTML = value; }};
}};
require(path.resolve("stage/protyle/js/lute/lute.min.js"));
const lute = Lute.New();
lute.SetKramdownIAL(true);
lute.SetProtyleWYSIWYG(true);
const source = readFileSync(path.join(__dirname, "model.ts"), "utf8")
    .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
const api = new Function("Constants", "Lute", "document", "NodeFilter", transpileModule(source, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText + "; return {convertListMindmapToList, readListMindmap, retagMindmapBranch, listMindmapConversionSource, cleanListMindmapHTML};")({
    CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap", CUSTOM_SY_LIST_MINDMAP_DATA: "custom-sy-list-mindmap-data",
}, Lute, documentFixture, {SHOW_COMMENT: 8});
const parse = (html: string) => wrap(parse5.parseFragment(html)).firstElementChild;
const ids = (element: ElementFixture) => [element, ...element.querySelectorAll<ElementFixture>("[data-node-id]")]
    .map(item => item.dataset.nodeId);
const dataAttr = "custom-sy-list-mindmap-data";
const tabsSource = transpileModule(readFileSync(path.join(__dirname, "../../wysiwyg/tabsList.ts"), "utf8")
    .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;
const completeSource = new Function(tabsSource + "; return completeTabsListSource;")();
const transactionSource = createSourceFile("transaction.ts", readFileSync(path.join(__dirname,
    "../../wysiwyg/transaction.ts"), "utf8"), ScriptTarget.ES2021, true);
const updateDeclaration = transactionSource.statements.filter(isVariableStatement).find(statement =>
    statement.declarationList.declarations.some(item => item.name.getText(transactionSource) === "updateTransaction"));
const updateSource = transpileModule(updateDeclaration.getText(transactionSource).replace(/^export /, ""), {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;
const getUpdateOperations = (element: ElementFixture, before: string) => {
    let operations: {doOperations: IOperation[], undoOperations: IOperation[]};
    const dependencies = {Constants: {ATTRIBUTE_EDITING: "data-editing"}, cleanListMindmapHTML: api.cleanListMindmapHTML,
        cleanHeadingNumberHTML: (html: string) => html, cleanTableCellRichHTML: (html: string) => html,
        cleanBlockSelectionModeHTML: (html: string) => html,
        transaction: (_owner: IProtyle, doOperations: IOperation[], undoOperations: IOperation[]) => {
            operations = {doOperations, undoOperations};
        }};
    new Function(...Object.keys(dependencies), updateSource + "; return updateTransaction;")(
        ...Object.values(dependencies))({}, element, before);
    element.removeAttribute("data-editing");
    return operations;
};

test("titled virtual roots preserve content, identities and associations across every list type", () => {
    for (const legacy of [false, true]) {
        for (const marker of ["*", "3.", "* [X]"]) {
            for (const conversion of ["OL2UL", "UL2OL", "UL2TL"]) {
                const indent = marker === "3." ? "   " : "  ";
                const original = parse(lute.Md2BlockDOM(`${marker} Alpha\n${indent}* Nested\n${marker} Beta\n`));
                if (legacy) { original.setAttribute("custom-sy-list-mindmap", "1"); }
                else { api.retagMindmapBranch(original, true); }
                const children = original.children.filter(child => child.dataset.nodeId);
                assert.equal(children.length, 2);
                children[0].setAttribute("custom-keep", "value");
                children[0].setAttribute("fold", "1");
                original.setAttribute("custom-container", "keep");
                const rootID = original.dataset.nodeId;
                const metadata = {version: 1, rootTitle: "<Root> & **literal**", extension: "keep",
                    nodes: {[rootID]: {bold: true, extension: "keep"}, [children[0].dataset.nodeId]: {italic: true}},
                    relations: [{id: "r", from: rootID, to: children[0].dataset.nodeId, label: "link"}],
                    summaries: [{id: "s", parentId: rootID, nodeIds: children.map(child => child.dataset.nodeId), label: "both"}]};
                original.setAttribute(dataAttr, JSON.stringify(metadata));
                const before = original.outerHTML;
                const oldIDs = ids(original);
                const result = parse(api.convertListMindmapToList(original, conversion, lute));
                const model = api.readListMindmap(result);
                assert.equal(original.outerHTML, before, "undo source is unchanged");
                assert.equal(result.dataset.type, "NodeList");
                assert.equal(result.dataset.nodeId, rootID);
                assert.equal(result.getAttribute("custom-container"), "keep");
                assert.equal(model.root.virtual, false);
                assert.equal(model.root.contentBlocks[0].querySelector("[contenteditable]").textContent, metadata.rootTitle);
                assert.equal(model.root.children.length, 2);
                assert.equal(model.root.children[0].element.getAttribute("custom-keep"), "value");
                assert.equal(model.root.children[0].element.getAttribute("fold"), "1");
                assert.ok(oldIDs.every(id => ids(result).includes(id)));
                assert.equal(ids(result).length, oldIDs.length + 3);
                assert.equal(new Set(ids(result)).size, ids(result).length);
                assert.equal(model.metadata.rootTitle, undefined);
                assert.equal(model.metadata.extension, "keep");
                assert.deepEqual(model.metadata.nodes[model.root.id], metadata.nodes[rootID]);
                assert.equal(model.metadata.relations[0].from, model.root.id);
                assert.equal(model.metadata.relations[0].to, children[0].dataset.nodeId);
                assert.equal(model.metadata.summaries[0].parentId, model.root.id);
                assert.deepEqual(model.metadata.summaries[0].nodeIds, metadata.summaries[0].nodeIds);
                if (marker === "* [X]" && conversion === "UL2TL") {
                    assert.equal(model.root.taskMarker, " ");
                    assert.equal(model.root.children[0].taskMarker, "X");
                }
                const operations = getUpdateOperations(result, before);
                assert.equal(operations.doOperations.length, 1);
                assert.equal(operations.undoOperations.length, 1);
                assert.equal(operations.doOperations[0].id, rootID);
                assert.equal(operations.undoOperations[0].id, rootID);
                const undo = parse(operations.undoOperations[0].data as string);
                assert.deepEqual(ids(undo), oldIDs);
                assert.equal(undo.getAttribute(dataAttr), JSON.stringify(metadata));
                assert.equal(undo.dataset.type, original.dataset.type);
                const redo = parse(operations.doOperations[0].data as string);
                assert.deepEqual(ids(redo), ids(result));
                assert.equal(redo.getAttribute(dataAttr), result.getAttribute(dataAttr));
                const savedIDs = ids(result);
                api.retagMindmapBranch(result, true);
                const again = parse(api.convertListMindmapToList(result, conversion, lute));
                assert.deepEqual(ids(again), savedIDs, "round trips do not add another parent");
                assert.equal(api.readListMindmap(again).root.children.length, 2);
            }
        }
    }
});

test("empty titles and existing real roots retain their original hierarchy", () => {
    for (const [markdown, title] of [["* One\n* Two\n", "  \n"], ["* Root\n  * Child\n", "Dormant title"]]) {
        const list = parse(lute.Md2BlockDOM(markdown));
        api.retagMindmapBranch(list, true);
        const metadata = JSON.stringify({version: 1, rootTitle: title, nodes: {}, relations: []});
        list.setAttribute(dataAttr, metadata);
        const result = parse(api.convertListMindmapToList(list, "UL2OL", lute));
        assert.deepEqual(ids(result), ids(list));
        assert.equal(result.getAttribute(dataAttr), metadata);
    }
});

test("shared sources for tabs and paragraph conversion do not acquire a parent", () => {
    const list = parse(lute.Md2BlockDOM("* One\n* Two\n"));
    api.retagMindmapBranch(list, true);
    const metadata = JSON.stringify({version: 1, rootTitle: "Title", nodes: {}, relations: []});
    list.setAttribute(dataAttr, metadata);
    const result = api.listMindmapConversionSource(list);
    assert.deepEqual(ids(result), ids(list));
    assert.equal(result.getAttribute(dataAttr), metadata);
    assert.equal(api.convertListMindmapToList(list, "CancelList", lute), undefined);
});

test("completing a partial folded map preserves local edits and every hidden block before conversion and undo", () => {
    const full = parse(lute.Md2BlockDOM("* Alpha\n  * Hidden\n* Beta\n"));
    api.retagMindmapBranch(full, true);
    full.setAttribute(dataAttr, JSON.stringify({version: 1, rootTitle: "Title", nodes: {}, relations: []}));
    const visible = full.cloneNode();
    const items = visible.children.filter(child => child.dataset.nodeId);
    items[1].remove();
    items[0].querySelector<ElementFixture>('[data-type="NodeMindmap"]').remove();
    items[0].querySelector<ElementFixture>("[contenteditable]").textContent = "Edited";
    items[0].setAttribute("fold", "1");
    const before = visible.outerHTML;
    assert.equal(api.readListMindmap(visible).root.virtual, false, "partial source alone cannot identify the virtual root");
    const complete = completeSource(visible, full);
    assert.equal(visible.outerHTML, before);
    assert.deepEqual(ids(complete), ids(full));
    const result = parse(api.convertListMindmapToList(complete, "UL2TL", lute));
    const model = api.readListMindmap(result);
    assert.equal(model.root.contentBlocks[0].querySelector("[contenteditable]").textContent, "Title");
    assert.equal(model.root.children[0].contentBlocks[0].querySelector("[contenteditable]").textContent, "Edited");
    assert.equal(model.root.children[0].children.length, 1);
    assert.ok(ids(full).every(id => ids(result).includes(id)));
    const operations = getUpdateOperations(result, complete.outerHTML);
    const undo = parse(operations.undoOperations[0].data as string);
    assert.deepEqual(ids(undo), ids(full));
    assert.equal(undo.querySelector<ElementFixture>("[contenteditable]").textContent, "Edited");
    assert.equal(api.readListMindmap(undo).metadata.rootTitle, "Title");
});
