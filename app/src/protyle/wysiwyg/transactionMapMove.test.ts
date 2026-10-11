import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {DOMElement, DOMFixture} from "../render/av/map/testDOM";
import {cloneMoveElements, getVisibleMoveElements} from "./transactionMove";
import {getMoveAffectedEmbedElements} from "./transactionEmbed";

const compiled = transpileModule(readFileSync("src/protyle/wysiwyg/transaction.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const wrappers = new WeakMap<DOMFixture, WeakMap<object, MoveElement>>();

class MoveDocument extends DOMFixture {
    wrap(node: object): MoveElement {
        let elements = wrappers.get(this);
        if (!elements) {
            elements = new WeakMap();
            wrappers.set(this, elements);
        }
        if (!elements.has(node)) elements.set(node, new MoveElement(node, this));
        return elements.get(node);
    }

    querySelectorAll(selector: string) { return this.documentElement.querySelectorAll(selector); }
}

// 仅补齐移动回放需要的克隆、兄弟插入、模板和后代选择器，不修改共享地图 DOM 测试夹具。
class MoveElement extends DOMElement {
    get content() {
        assert.equal(this.tagName, "TEMPLATE");
        this.node.content ||= {nodeName: "#document-fragment", attrs: [], childNodes: []};
        return this.ownerDocument.wrap(this.node.content);
    }

    get innerHTML(): string { return this.node.tagName === "template" ? this.content.innerHTML : super.innerHTML; }
    set innerHTML(value: string) {
        if (this.node.tagName === "template") this.content.innerHTML = value;
        else super.innerHTML = value;
    }

    cloneNode(deep = false) {
        const clone = this.ownerDocument.createElement(this.node.tagName);
        this.node.attrs.forEach(({name, value}: {name: string; value: string}) => clone.setAttribute(name, value));
        if (deep) clone.innerHTML = this.innerHTML;
        return clone;
    }

    before(...children: DOMElement[]) { children.forEach(child => super.before(child)); }

    replaceWith(child: DOMElement) {
        if (child.node.nodeName === "#document-fragment") {
            this.before(...child.node.childNodes.map((node: object) => this.ownerDocument.wrap(node)));
            this.remove();
        } else {
            super.replaceWith(child);
        }
    }

    after(...children: DOMElement[]) {
        assert.ok(this.parentElement);
        const next = this.nextElementSibling;
        children.forEach(child => next ? next.before(child) : this.parentElement.append(child));
    }

    prepend(...children: DOMElement[]) {
        [...children].reverse().forEach(child => this.firstElementChild ? this.firstElementChild.before(child) : this.append(child));
    }

    querySelectorAll(selector: string): DOMElement[] {
        if (!selector.startsWith(":scope > ") && selector.includes(" ")) {
            const parts = selector.split(" ");
            assert.equal(parts.length, 2, `Unsupported move fixture selector: ${selector}`);
            return super.querySelectorAll(parts[1]).filter(item => item.parentElement?.closest(parts[0]));
        }
        return super.querySelectorAll(selector);
    }
}

const mapHTML = (id: string, runtime = true) => `<div class="av" data-node-id="${id}" data-type="NodeAttributeView" data-av-type="map"${runtime ? ' data-render="true"' : ""}>
<div class="av__container">${runtime ? '<div class="av__map"><webview partition="siyuan-map-old"></webview></div>' : ""}<div class="av__scroll"></div></div></div>`;

const fixture = () => {
    const document = new MoveDocument();
    const rendered: Array<{element: DOMElement; protyle: IProtyle}> = [];
    const requests: Array<{id: string; notebook: string; reply: (response: unknown) => void}> = [];
    const models: Array<{editor: {protyle: IProtyle}}> = [];
    const exports: typeof import("./transaction") = {} as typeof import("./transaction");
    const dependencies = {
        cloneMoveElements,
        getVisibleMoveElements,
        getMoveAffectedEmbedElements,
        Constants: {},
        invalidateTrackedRangesByOperations() {},
        invalidateViewFoldRequests() {},
        handleViewFoldSourceOperation: () => false,
        isInEmbedBlock: () => false,
        getAllModels: () => ({editor: models}),
        normalizeHTMLAssetIFrameBlockDOM: (html: string) => html,
        refreshSbResize() {},
        applyViewFoldStates() {},
        queueHeadingNumberRefresh() {},
        refreshHeadingFoldIndicators() {},
        shouldReloadForHeadingBatch: () => false,
        avRender: (element: DOMElement, protyle: IProtyle) => {
            assert.equal(element.isConnected, true, "Hydration must follow insertion into the document");
            assert.equal(element.closest(".protyle-wysiwyg"), protyle.wysiwyg.element);
            rendered.push({element, protyle});
        },
        fetchPost: (url: string, data: {id: string; notebook: string}, reply: (response: unknown) => void) => {
            assert.equal(url, "/api/block/getBlockDOM");
            requests.push({...data, reply});
        },
    };
    runInNewContext(compiled, {
        exports, document, require: () => dependencies,
        window: {siyuan: {blockPanels: []}},
        getSelection: () => ({rangeCount: 0}),
    });
    const editor = (id: string, html: string) => {
        const element = document.createElement("div");
        element.setAttribute("data-id", id);
        const wysiwyg = document.createElement("div");
        wysiwyg.className = "protyle-wysiwyg";
        wysiwyg.innerHTML = html;
        element.append(wysiwyg);
        document.body.append(element);
        const protyle = {element, wysiwyg: {element: wysiwyg}, notebookId: "notebook-" + id,
            block: {rootID: "document-" + id, showAll: true}, options: {}} as unknown as IProtyle;
        return {protyle, root: wysiwyg};
    };
    const replay = (protyle: IProtyle, operation: Partial<IOperation>) =>
        exports.onTransaction(protyle, [{action: "move", ...operation} as IOperation], false);
    const reply = (index: number, html = mapHTML("moved", false)) => requests[index].reply({
        code: 0, data: {id: requests[index].id, dom: html},
    });
    return {document, editor, replay, rendered, requests, reply, models};
};

for (const anchor of ["nextID", "previousID", "parentID"] as const) {
    test(`move replay hydrates a cleaned root map after ${anchor} placement`, () => {
        const f = fixture();
        const {protyle, root} = f.editor("destination", '<div data-node-id="target"></div>' + mapHTML("moved") + mapHTML("untouched"));
        const original = root.querySelector('[data-node-id="moved"]');
        const originalRuntime = original.querySelector(".av__map");
        const untouched = root.querySelector('[data-node-id="untouched"]');
        f.replay(protyle, {id: "moved", [anchor]: "target"});
        const moved = root.querySelector('[data-node-id="moved"]');
        assert.notEqual(moved, original);
        assert.equal(original.isConnected, false);
        assert.equal(original.querySelector(".av__map"), originalRuntime);
        assert.equal(moved.querySelector(".av__map"), null);
        assert.equal(moved.hasAttribute("data-render"), false);
        assert.deepEqual(f.rendered, [{element: moved, protyle}]);
        assert.equal(untouched.hasAttribute("data-render"), true);
        assert.ok(untouched.querySelector(".av__map"));
        const target = root.querySelector('[data-node-id="target"]');
        if (anchor === "nextID") assert.equal(moved.nextElementSibling, target);
        if (anchor === "previousID") assert.equal(moved.previousElementSibling, target);
        if (anchor === "parentID") assert.equal(moved.parentElement, target);
        assert.equal(f.requests.length, 0);
    });
}

test("move replay rehydrates maps nested in a moved container and a moved heading group", () => {
    const f = fixture();
    const {protyle, root} = f.editor("destination", '<div data-node-id="target"></div>' +
        '<div data-node-id="heading" data-type="NodeHeading"></div>' +
        '<div data-node-id="container" data-type="NodeSuperBlock">' + mapHTML("nested") + "</div>" + mapHTML("sibling"));
    f.replay(protyle, {id: "heading", blockIDs: ["container", "sibling"], nextID: "target"});
    assert.deepEqual(root.children.map(item => item.dataset.nodeId), ["heading", "container", "sibling", "target"]);
    const nested = root.querySelector('[data-node-id="nested"]');
    const sibling = root.querySelector('[data-node-id="sibling"]');
    assert.deepEqual(f.rendered, [{element: nested, protyle}, {element: sibling, protyle}]);
    assert.equal(nested.hasAttribute("data-render"), false);
    assert.equal(sibling.hasAttribute("data-render"), false);
    assert.equal(root.querySelector("webview"), null);
});

test("replay using another editor's map copy preserves that source and hydrates the destination", () => {
    const f = fixture();
    const source = f.editor("source", mapHTML("moved"));
    const destination = f.editor("destination", '<div data-node-id="target"></div>');
    const original = source.root.firstElementChild;
    f.models.push({editor: {protyle: source.protyle}});
    f.replay(destination.protyle, {id: "moved", previousID: "target"});
    const moved = destination.root.querySelector('[data-node-id="moved"]');
    assert.ok(original.isConnected);
    assert.ok(original.querySelector("webview"));
    assert.equal(original.getAttribute("data-render"), "true");
    assert.equal(moved.querySelector("webview"), null);
    assert.deepEqual(f.rendered, [{element: moved, protyle: destination.protyle}]);
    assert.equal(f.requests.length, 0);
});

test("async fallback hydrates concurrent same-block placeholders only in their requesting editor", () => {
    const f = fixture();
    const first = f.editor("first", '<div data-node-id="target"></div>');
    const second = f.editor("second", '<div data-node-id="target"></div>');
    for (const editor of [first, second]) f.replay(editor.protyle, {id: "moved", nextID: "target"});
    const firstPlaceholder = first.root.querySelector('[data-node-id="moved"]');
    const secondPlaceholder = second.root.querySelector('[data-node-id="moved"]');
    assert.equal(firstPlaceholder.getAttribute("data-protyle-id"), "first");
    assert.equal(secondPlaceholder.getAttribute("data-protyle-id"), "second");
    assert.deepEqual(f.requests.map(request => request.notebook), ["notebook-first", "notebook-second"]);
    assert.equal(f.rendered.length, 0);
    f.reply(1);
    assert.equal(first.root.querySelector('[data-node-id="moved"]'), firstPlaceholder);
    assert.equal(secondPlaceholder.isConnected, false);
    assert.deepEqual(f.rendered, [{element: second.root.querySelector('[data-node-id="moved"]'), protyle: second.protyle}]);
    f.reply(0);
    assert.equal(firstPlaceholder.isConnected, false);
    assert.deepEqual(f.rendered.map(item => item.protyle), [second.protyle, first.protyle]);
    assert.equal(first.root.querySelector('[data-protyle-id="first"]'), null);
    assert.equal(second.root.querySelector('[data-protyle-id="second"]'), null);
});

test("fallback does not hydrate a matching owner ID after its placeholder moves to another editor", () => {
    const f = fixture();
    const first = f.editor("first", '<div data-node-id="target"></div>');
    const second = f.editor("second", "");
    f.replay(first.protyle, {id: "moved", nextID: "target"});
    const placeholder = first.root.querySelector('[data-node-id="moved"]');
    second.root.append(placeholder);
    f.reply(0);
    assert.equal(second.root.firstElementChild, placeholder);
    assert.equal(placeholder.getAttribute("data-protyle-id"), "first");
    assert.equal(f.rendered.length, 0);
});

test("fallback preserves every returned sibling and hydrates a trailing map after fragment insertion", () => {
    const f = fixture();
    const {protyle, root} = f.editor("destination", '<div data-node-id="target"></div>');
    f.replay(protyle, {id: "moved", nextID: "target"});
    f.reply(0, '<div data-node-id="moved" data-type="NodeHeading">Heading</div>\n' +
        '<div data-node-id="paragraph">Paragraph</div>\n' + mapHTML("trailing-map", false));
    assert.deepEqual(root.children.map(item => item.dataset.nodeId), ["moved", "paragraph", "trailing-map", "target"]);
    assert.deepEqual(f.rendered.map(item => item.element.dataset.nodeId), ["moved", "paragraph", "trailing-map"]);
    assert.ok(f.rendered.every(item => item.protyle === protyle));
    assert.equal(root.querySelector("template"), null);
    assert.equal(root.querySelector('[data-node-id="paragraph"]').textContent, "Paragraph");
    assert.equal(root.querySelector('[data-protyle-id="destination"]'), null);
});

test("fallback ignores removed placeholders and mismatched owner IDs in the original editor", () => {
    for (const change of ["removed", "different-owner"]) {
        const f = fixture();
        const {protyle, root} = f.editor("destination", '<div data-node-id="target"></div>');
        f.replay(protyle, {id: "moved", nextID: "target"});
        const placeholder = root.querySelector('[data-node-id="moved"]');
        if (change === "removed") placeholder.remove();
        else placeholder.setAttribute("data-protyle-id", "other");
        f.reply(0);
        assert.equal(root.querySelector(".av"), null);
        assert.equal(f.rendered.length, 0);
    }
});
