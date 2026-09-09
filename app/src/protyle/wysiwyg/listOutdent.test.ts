import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/wysiwyg/list.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

class TestElement {
    parentElement: TestElement;
    children: TestElement[] = [];
    private attrs = new Map<string, string>();
    classList = {contains: (name: string) => this.attrs.get("class")?.split(" ").includes(name) || false};

    constructor(name: string, id?: string) {
        this.attrs.set("class", name);
        if (id) {
            this.attrs.set("data-node-id", id);
        }
    }

    append(...children: TestElement[]) {
        children.forEach(child => {
            child.remove();
            child.parentElement = this;
            this.children.push(child);
        });
        return this;
    }

    remove() {
        if (this.parentElement) {
            this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
            this.parentElement = undefined;
        }
    }

    after(element: TestElement) {
        element.remove();
        element.parentElement = this.parentElement;
        this.parentElement.children.splice(this.parentElement.children.indexOf(this) + 1, 0, element);
    }

    get previousElementSibling(): TestElement {
        return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1];
    }

    get nextElementSibling(): TestElement {
        return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1];
    }

    get lastElementChild() {
        return this.children[this.children.length - 1];
    }

    get childElementCount() {
        return this.children.length;
    }

    get isConnected(): boolean {
        return this.classList.contains("protyle-wysiwyg") || !!this.parentElement?.isConnected;
    }

    get outerHTML(): string {
        const attrs = Array.from(this.attrs).map(([name, value]) => ` ${name}="${value}"`).join("");
        return `<div${attrs}>${this.children.map(child => child.outerHTML).join("")}</div>`;
    }

    getAttribute(name: string) {
        return this.attrs.get(name) || null;
    }

    removeAttribute(name: string) {
        this.attrs.delete(name);
    }

    contains(element: TestElement): boolean {
        return element === this || this.children.some(child => child.contains(element));
    }
}

const fixture = (single: boolean, containerClass = "tab-item") => {
    const attr = () => new TestElement("protyle-attr");
    const paragraph = new TestElement("p", "empty-paragraph").append(new TestElement("editable"), attr());
    const item = new TestElement("li", "empty-item").append(new TestElement("protyle-action"), paragraph, attr());
    const previousItem = new TestElement("li", "previous-item");
    const list = new TestElement("list", "list").append(...(single ? [] : [previousItem]), item, attr());
    const before = new TestElement("p", "before");
    const content = new TestElement("tab-item-content").append(before, list);
    const title = new TestElement("tab-item-info");
    const container = new TestElement(containerClass, "container").append(title, content, attr());
    const otherTab = new TestElement("tab-item", "other-tab");
    const tabs = new TestElement("tabs", "tabs").append(container, otherTab, attr());
    new TestElement("protyle-wysiwyg").append(tabs);
    const operations: {doOperations: IOperation[], undoOperations: IOperation[]}[] = [];
    let focused: TestElement;
    const exports: any = {};
    const dependencies = {
        getParentBlock: (element: TestElement) => element.parentElement === content ? container : element.parentElement,
        getPreviousBlockSibling: (element: TestElement) => element.previousElementSibling,
        getEmbedChildOperationContext: (): void => undefined,
        activateTrackedRangeInsertion: (): void => undefined,
        moveToPrevious: (): void => undefined,
        isBlockElement: (element: TestElement) => !!element.getAttribute("data-node-id"),
        transaction: (_protyle: IProtyle, doOperations: IOperation[], undoOperations: IOperation[]) =>
            operations.push({doOperations, undoOperations}),
        focusByWbr: (element: TestElement) => focused = element,
    };
    runInNewContext(compiled, {
        exports,
        require: () => dependencies,
        window: {siyuan: {config: {editor: {listLogicalOutdent: true}}}},
        document: {createElement: (name: string) => new TestElement(name)},
    });
    const range = {
        startContainer: paragraph.children[0],
        collapse: (): void => undefined,
        insertNode: (element: TestElement) => paragraph.children[0].append(element),
    };
    const protyle = {block: {id: "doc", parentID: "doc"}};
    return {
        paragraph, item, list, before, content, title, container, tabs, otherTab, operations,
        run: () => exports.listOutdent(protyle, [item], range),
        focused: () => focused,
    };
};

for (const single of [false, true]) {
    test(`页签内${single ? "唯一" : "末尾"}空列表项退出为同一页签的段落，并保留撤销父级`, async () => {
        const f = fixture(single);
        await f.run();
        assert.equal(f.paragraph.parentElement, f.content);
        assert.equal(f.content.lastElementChild, f.paragraph);
        assert.equal(f.item.parentElement, undefined);
        assert.equal(f.title.parentElement, f.container);
        assert.equal(f.otherTab.parentElement, f.tabs);
        assert.equal(f.tabs.childElementCount, 3);
        assert.equal(f.focused(), f.container);
        assert.equal(f.operations.length, 1);
        const {doOperations, undoOperations} = f.operations[0];
        assert.equal(doOperations[0].action, "move");
        assert.equal(doOperations[0].id, "empty-paragraph");
        assert.equal(doOperations[0].parentID, "container");
        assert.equal(doOperations[0].previousID, "list");
        assert.equal(undoOperations.find(op => op.action === "move").parentID, "empty-item");
        if (single) {
            assert.equal(f.list.parentElement, undefined);
            const restore = undoOperations.find(op => op.action === "insert");
            assert.equal(restore.id, "list");
            assert.equal(restore.parentID, "container");
            assert.equal(restore.previousID, "before");
        } else {
            assert.equal(f.list.parentElement, f.content);
            assert.equal(doOperations[1].action, "update");
            assert.equal(doOperations[1].id, "list");
        }
    });
}
