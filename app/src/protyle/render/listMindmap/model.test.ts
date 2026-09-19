import * as assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import type {ListMindmapLayoutNode} from "./model";

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

const browserCases = async (sourceCode: string, css: string) => {
    const check = require("node:assert/strict");
    const api = new Function("mathRender", "Constants", sourceCode + "; return {readListMindmap, moveListMindmapNode, addListMindmapNode, " +
        "deleteListMindmapNode, replaceListMindmapContent, cleanListMindmapHTML, remapListMindmapIDs, writeListMindmapMetadata, ListMindmapView};")(
        async (element: Element) => {
            const formulas = element.querySelectorAll('[data-subtype="math"]:not([data-render="true"])');
            await Promise.resolve();
            formulas.forEach(formula => {
                formula.innerHTML = '<span class="katex">rendered formula</span>';
                formula.setAttribute("data-render", "true");
            });
        }, {TIMEOUT_DBLCLICK: 190, CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap",
            CUSTOM_SY_LIST_MINDMAP_DATA: "custom-sy-list-mindmap-data"});
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
        ["* Alpha\n* Beta\n", [["UL2OL", "o"], ["UL2TL", "t"]]],
        ["1. Alpha\n2. Beta\n", [["OL2UL", "u"], ["OL2TL", "t"]]],
        ["* [ ] Alpha\n* [x] Beta\n", [["TL2UL", "u"], ["TL2OL", "o"]]],
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
            converted.innerHTML = (lute as any)[conversion](api.cleanListMindmapHTML(sourceList.outerHTML));
            const result = converted.firstElementChild;
            check.equal(result.getAttribute("data-subtype"), subtype);
            check.equal(result.getAttribute("data-node-id"), sourceList.getAttribute("data-node-id"));
            check.equal(result.getAttribute("custom-sy-list-mindmap"), "1");
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
    list.setAttribute("custom-sy-list-mindmap-data", JSON.stringify({version: 1, extension: "keep",
        nodes: {a: {bold: true}, b: {italic: true}, deleted: {bold: true}},
        relations: [{id: "relation", from: "a", to: "b", label: "keep"},
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
    check.deepEqual(remapped.relations, [{id: "relation", from: "new-a", to: "new-b", label: "keep"}]);
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
    const sendPointer = (element: Element, type: string, x: number, y: number) => element.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, clientX: x, clientY: y,
    }));
    const sourceRect = nodeElement(alpha).getBoundingClientRect();
    const targetRect = nodeElement(beta).getBoundingClientRect();
    const sourcePoint = {x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2};
    const targetPoint = {x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2};
    check.ok(sourceRect.width >= 64 && sourceRect.height >= 32);
    check.equal(host.querySelector("[data-node-id]"), null);
    sendPointer(nodeElement(alpha), "pointerdown", sourcePoint.x, sourcePoint.y);
    sendPointer(viewport, "pointerup", sourcePoint.x, sourcePoint.y);
    check.equal(edits.length, 0);
    check.equal(moves.length, 0);
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
    check.ok(relationButton.nextElementSibling.classList.contains("list-mindmap__zoom-control"));
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
    check.equal(getComputedStyle(inspector).bottom, "8px");
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
    await settle();
    const parentBounds = nodeElement(model.nodes.get(beta).parentId).getBoundingClientRect();
    const childBounds = nodeElement(beta).getBoundingClientRect();
    const lineX = (parentBounds.right + childBounds.left) / 2;
    const parentY = model.nodes.get(beta).parentId === model.root.id ? parentBounds.top + parentBounds.height / 2 : parentBounds.bottom;
    const lineY = (parentY + childBounds.bottom) / 2;
    sendPointer(viewport, "pointermove", lineX, lineY);
    check.equal(viewport.classList.contains("list-mindmap__viewport--line-hover"), true);
    viewport.dispatchEvent(new PointerEvent("pointerleave"));
    check.equal(viewport.classList.contains("list-mindmap__viewport--line-hover"), false);
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
    check.equal(getComputedStyle(inspector).bottom, "8px");
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
            check.ok(input, "double-clicking either arrow edits that relation");
            input.value = id;
            input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
            check.deepEqual(relationChanges[relationChanges.length - 1], [id, {label: id}]);
            pressDelete();
            check.equal(relationDeletions[relationDeletions.length - 1], id);
        }
    }
    view.scale = 1;
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
        check.deepEqual({width: node.offsetWidth, height: node.offsetHeight}, before,
            "entering root title editing preserves dimensions");
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
    check.equal(titleView.getContentHost(model.root.id).textContent, "listMindmapRoot");
    titleView.destroy();

    const singleList = reset("* Single\n");
    const single = new api.ListMindmapView({...options, model: api.readListMindmap(singleList)});
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
    const source = compile(path.join(__dirname, "../av/richTextValue.ts")) + compile(path.join(__dirname, "../../wysiwyg/listContext.ts")) +
        compile(path.join(__dirname, "model.ts")) + compile(path.join(__dirname, "routing.ts")) + compile(path.join(__dirname, "view.ts"));
    const css = require("sass").compile(path.resolve(__dirname, "../../../assets/scss/business/_block.scss")).css +
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss/business/_color.scss")).css +
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss/protyle/_list-mindmap.scss")).css;
    const lutePath = path.resolve(__dirname, "../../../../stage/protyle/js/lute/lute.min.js");
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
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(css)})`)});
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
