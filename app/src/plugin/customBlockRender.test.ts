import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    activateCustomBlockPlugin,
    customBlockRender,
    deactivateCustomBlockPlugin,
    decodeCustomBlockInfo,
    encodeCustomBlockInfo,
    isCustomBlockContentValid,
    registerCustomBlockRoot,
    setCustomBlockRootReady,
    unregisterCustomBlockRoot,
} from "./customBlockRender";

describe("custom block info", () => {
    it("round trips plugin and block names", () => {
        const info = encodeCustomBlockInfo("mind map plugin", "tree/main");

        assert.equal(info, "mind%20map%20plugin/tree%2Fmain");
        assert.deepEqual(decodeCustomBlockInfo(info), {
            pluginName: "mind map plugin",
            blockType: "tree/main",
        });
    });

    it("rejects malformed values", () => {
        ["", "plugin", "/block", "plugin/", "plugin/block/extra", "plugin/%E0%A4%A"].forEach(info => {
            assert.equal(decodeCustomBlockInfo(info), undefined);
        });
    });

    it("rejects content that would close the Markdown fence", () => {
        assert.equal(isCustomBlockContentValid("safe\ncontent"), true);
        assert.equal(isCustomBlockContentValid("before\n;;;\nafter"), false);
        assert.equal(isCustomBlockContentValid(";;;\r\nafter"), false);
        assert.equal(isCustomBlockContentValid("before\r\n ;;;\t\r\nafter"), false);
        assert.equal(isCustomBlockContentValid("before\n‸;;;‸\nafter"), false);
    });
});

class TestDocument {
    root?: TestElement;

    createElement(tagName: string) {
        return new TestElement(this, tagName);
    }

    querySelectorAll(selector: string) {
        return this.root?.querySelectorAll(selector) || [];
    }
}

class TestElement {
    public children: TestElement[] = [];
    public classList = {
        contains: (className: string) => this.classes.has(className),
    };
    public isConnected = true;
    public parentElement?: TestElement;
    private attributes = new Map<string, string>();
    private classes = new Set<string>();
    private listeners = new Map<string, Array<(event: {stopPropagation: () => void}) => void>>();
    private ownText = "";

    constructor(public ownerDocument: TestDocument, public tagName = "div") {
    }

    set className(value: string) {
        this.classes = new Set(value.split(/\s+/).filter(Boolean));
    }

    get className() {
        return Array.from(this.classes).join(" ");
    }

    set textContent(value: string) {
        this.ownText = value;
        this.children = [];
    }

    get textContent() {
        return this.children.length > 0 ? this.children.map(item => item.textContent).join("") : this.ownText;
    }

    get outerHTML(): string {
        const attributes = Array.from(this.attributes).map(([name, value]) => ` ${name}="${value}"`).join("");
        const className = this.className ? ` class="${this.className}"` : "";
        const content: string = this.children.length > 0 ?
            this.children.map(item => item.outerHTML).join("") : this.ownText;
        return `<${this.tagName}${className}${attributes}>${content}</${this.tagName}>`;
    }

    append(...elements: TestElement[]) {
        elements.forEach(element => {
            element.parentElement = this;
            this.children.push(element);
        });
        return this;
    }

    addEventListener(type: string, listener: (event: {stopPropagation: () => void}) => void) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    dispatch(type: string) {
        let stopped = false;
        const event = {stopPropagation: () => stopped = true};
        this.listeners.get(type)?.forEach(listener => listener(event));
        let element = this.parentElement;
        while (element) {
            if (stopped) {
                break;
            }
            element.listeners.get(type)?.forEach(listener => listener(event));
            element = element.parentElement;
        }
    }

    contains(element: TestElement): boolean {
        return this === element || this.children.some(child => child.contains(element));
    }

    closest(selector: string): TestElement | null {
        if (this.matchesSelector(selector)) {
            return this;
        }
        let element = this.parentElement;
        while (element) {
            if (element.matchesSelector(selector)) {
                return element;
            }
            element = element.parentElement;
        }
        return null;
    }

    private matchesSelector(selector: string) {
        return (selector === ".protyle-wysiwyg" && this.classList.contains("protyle-wysiwyg")) ||
            (selector === '[data-type="NodeCustomBlock"]' &&
                this.getAttribute("data-type") === "NodeCustomBlock");
    }

    getAttribute(name: string) {
        return this.attributes.get(name) || null;
    }

    insertBefore(element: TestElement, reference: TestElement | null) {
        element.parentElement = this;
        const index = reference ? this.children.indexOf(reference) : -1;
        if (index < 0) {
            this.children.push(element);
        } else {
            this.children.splice(index, 0, element);
        }
    }

    remove() {
        if (!this.parentElement) {
            return;
        }
        const index = this.parentElement.children.indexOf(this);
        if (index > -1) {
            this.parentElement.children.splice(index, 1);
        }
        this.parentElement = undefined;
    }

    querySelectorAll(selector: string): TestElement[] {
        const elements: TestElement[] = [];
        this.children.forEach(child => {
            if (selector === '[data-type="NodeCustomBlock"]' &&
                child.getAttribute("data-type") === "NodeCustomBlock") {
                elements.push(child);
            }
            elements.push(...child.querySelectorAll(selector));
        });
        return elements;
    }

    replaceChildren(...elements: TestElement[]) {
        this.children = [];
        this.ownText = "";
        this.append(...elements);
    }

    setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
        return this;
    }
}

class TestMutationObserver {
    private static instances: TestMutationObserver[] = [];
    private target?: TestElement;
    private records: MutationRecord[] = [];

    constructor(private callback: MutationCallback) {
        TestMutationObserver.instances.push(this);
    }

    static notify(target: TestElement, addedNodes: TestElement[], removedNodes: TestElement[]) {
        const record = {addedNodes, removedNodes} as unknown as MutationRecord;
        TestMutationObserver.instances.filter(item => item.target === target).forEach(item =>
            item.callback([record], item as unknown as MutationObserver));
    }

    static queue(target: TestElement, addedNodes: TestElement[], removedNodes: TestElement[]) {
        const record = {addedNodes, removedNodes} as unknown as MutationRecord;
        TestMutationObserver.instances.filter(item => item.target === target).forEach(item => item.records.push(record));
    }

    static reset() {
        TestMutationObserver.instances = [];
    }

    disconnect() {
        this.target = undefined;
        this.records = [];
    }

    observe(target: Node) {
        this.target = target as unknown as TestElement;
    }

    takeRecords() {
        const records = this.records;
        this.records = [];
        return records;
    }
}

describe("custom block renderer lifecycle", () => {
    it("activates after plugin mount, persists the latest content, and cleans up on unload", async () => {
        const pluginName = "mind-map-test";
        const document = new TestDocument();
        const workspace = document.createElement("div");
        const root = document.createElement("div");
        root.className = "protyle-wysiwyg";
        const targetRoot = document.createElement("div");
        targetRoot.className = "protyle-wysiwyg";
        const block = document.createElement("div")
            .setAttribute("data-type", "NodeCustomBlock")
            .setAttribute("data-info", `${pluginName}/mindmap`)
            .setAttribute("data-content", "old");
        const mount = document.createElement("div");
        mount.className = "custom-block__content";
        const attr = document.createElement("div");
        attr.className = "protyle-attr";
        workspace.append(root.append(block.append(mount, attr)), targetRoot);
        document.root = workspace;

        let cleanupCount = 0;
        let editorEventCount = 0;
        let pluginEventCount = 0;
        let renderCount = 0;
        const lifecycleOrder: string[] = [];
        let setContent: (content: string) => boolean = () => false;
        const updates: string[] = [];
        const targetUpdates: string[] = [];
        const originalGlobals = {
            document: globalThis.document,
            Element: globalThis.Element,
            MutationObserver: globalThis.MutationObserver,
            Node: globalThis.Node,
            window: globalThis.window,
        };
        const plugin = {
            name: pluginName,
            customBlockRenders: {
                mindmap: {
                    render: (options: {element: TestElement, setContent: (content: string) => boolean}) => {
                        const renderedBlock = options.element.parentElement as TestElement;
                        renderCount++;
                        lifecycleOrder.push(`render:${renderedBlock.getAttribute("data-content")}`);
                        setContent = options.setContent;
                        options.element.className = "plugin-render";
                        options.element.setAttribute("style", "color: red");
                        options.element.setAttribute("data-plugin-render", "true");
                        ["keydown", "focusout", "mousewheel", "wheel"].forEach(type =>
                            options.element.addEventListener(type, () => pluginEventCount++));
                        return () => {
                            cleanupCount++;
                            lifecycleOrder.push(`cleanup:${renderedBlock.getAttribute("data-content")}`);
                        };
                    },
                },
            },
        };
        Object.assign(globalThis, {
            document,
            Element: TestElement,
            MutationObserver: TestMutationObserver,
            Node: TestElement,
            window: {siyuan: {ws: {app: {plugins: [plugin]}}}},
        });
        ["keydown", "focusout", "mousewheel"].forEach(type =>
            root.addEventListener(type, () => editorEventCount++));

        registerCustomBlockRoot(root as unknown as HTMLElement, {
            disabled: () => false,
            update: (element, oldHTML) => updates.push(`${oldHTML}\n${element.outerHTML}`),
        });
        registerCustomBlockRoot(targetRoot as unknown as HTMLElement, {
            disabled: () => false,
            update: (element, oldHTML) => targetUpdates.push(`${oldHTML}\n${element.outerHTML}`),
        });
        setCustomBlockRootReady(root as unknown as HTMLElement, true);
        setCustomBlockRootReady(targetRoot as unknown as HTMLElement, true);
        try {
            customBlockRender(root as unknown as Element);
            assert.equal(renderCount, 0);
            assert.equal(block.children[0].textContent, "old");
            block.children[0].dispatch("keydown");
            assert.equal(editorEventCount, 1);

            activateCustomBlockPlugin(pluginName);
            assert.equal(renderCount, 1);
            ["keydown", "focusout", "mousewheel", "wheel"].forEach(type => block.children[0].dispatch(type));
            assert.equal(pluginEventCount, 4);
            assert.equal(editorEventCount, 1);
            assert.equal(setContent("new"), true);
            assert.equal(setContent("latest"), true);
            assert.equal(setContent("before\n;;;\nafter"), false);
            await Promise.resolve();
            assert.equal(block.getAttribute("data-content"), "latest");
            assert.equal(updates.length, 1);
            assert.doesNotMatch(updates[0], /plugin-render|color: red|data-plugin-render/);
            assert.equal(renderCount, 2);
            assert.equal(cleanupCount, 1);

            const sourceSetContent = setContent;
            assert.equal(sourceSetContent("queued-in-source"), true);
            block.remove();
            targetRoot.append(block);
            TestMutationObserver.queue(root, [], [block]);
            TestMutationObserver.queue(targetRoot, [block], []);
            await Promise.resolve();
            assert.equal(block.getAttribute("data-content"), "latest");
            assert.equal(updates.length, 1);
            assert.equal(targetUpdates.length, 0);
            customBlockRender(block as unknown as Element);
            assert.deepEqual(lifecycleOrder.slice(-2), ["cleanup:latest", "render:latest"]);
            assert.equal(renderCount, 3);
            assert.equal(cleanupCount, 2);
            assert.equal(sourceSetContent("stale-source"), false);

            assert.equal(setContent("moved"), true);
            await Promise.resolve();
            assert.equal(block.getAttribute("data-content"), "moved");
            assert.equal(updates.length, 1);
            assert.equal(targetUpdates.length, 1);
            assert.equal(renderCount, 4);
            assert.equal(cleanupCount, 3);

            const targetSetContent = setContent;
            block.remove();
            root.append(block);
            TestMutationObserver.notify(targetRoot, [], [block]);
            TestMutationObserver.notify(root, [block], []);
            await Promise.resolve();
            assert.deepEqual(lifecycleOrder.slice(-2), ["cleanup:moved", "render:moved"]);
            assert.equal(renderCount, 5);
            assert.equal(cleanupCount, 4);
            assert.equal(targetSetContent("stale-target"), false);

            const copiedBlock = document.createElement("div")
                .setAttribute("data-type", "NodeCustomBlock")
                .setAttribute("data-info", `${pluginName}/mindmap`)
                .setAttribute("data-content", "copied");
            const copiedMount = document.createElement("div");
            copiedMount.className = "plugin-render";
            copiedMount.setAttribute("data-plugin-render", "snapshot");
            const copiedAttr = document.createElement("div");
            copiedAttr.className = "protyle-attr";
            targetRoot.append(copiedBlock.append(copiedMount, copiedAttr));
            TestMutationObserver.notify(targetRoot, [copiedBlock], []);
            await Promise.resolve();
            assert.equal(renderCount, 6);
            assert.equal(copiedBlock.children[0].classList.contains("plugin-render"), true);
            assert.equal(copiedBlock.children[0].getAttribute("data-plugin-render"), "true");

            deactivateCustomBlockPlugin(pluginName);
            assert.equal(cleanupCount, 6);
            assert.equal(block.children[0].textContent, "moved");
            assert.equal(copiedBlock.children[0].textContent, "copied");
            assert.equal(setContent("stale"), false);
            await Promise.resolve();
            assert.equal(updates.length, 1);
            assert.equal(targetUpdates.length, 1);
        } finally {
            deactivateCustomBlockPlugin(pluginName);
            unregisterCustomBlockRoot(targetRoot as unknown as HTMLElement);
            unregisterCustomBlockRoot(root as unknown as HTMLElement);
            TestMutationObserver.reset();
            Object.assign(globalThis, originalGlobals);
        }
    });
});
