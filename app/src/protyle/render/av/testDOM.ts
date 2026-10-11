import * as assert from "node:assert/strict";
import {createRequire} from "node:module";

// 复用已安装的 HTML 解析器，只查询模板中实际存在的节点。
// 仅实现测试需要的 DOM 接口；不支持的选择器直接失败，避免掩盖模板错误。
const parse5 = createRequire(require.resolve("html-loader"))("parse5");

export class DOMFixture {
    activeElement: DOMElement;
    private elements = new WeakMap<object, DOMElement>();
    readonly body = this.createElement("body");
    readonly documentElement = this.createElement("html");
    constructor() { this.documentElement.append(this.body); }
    wrap(node: any): DOMElement {
        if (!this.elements.has(node)) this.elements.set(node, new DOMElement(node, this));
        return this.elements.get(node);
    }
    createElement(name: string): DOMElement {
        return this.wrap({nodeName: name, tagName: name, attrs: [], childNodes: [],
            namespaceURI: "http://www.w3.org/1999/xhtml"});
    }
}

export class DOMElement {
    readonly events = new Map<string, Array<(event: any) => void>>();
    private inputValue: string;
    constructor(readonly node: any, readonly ownerDocument: DOMFixture) {}
    get children(): DOMElement[] { return (this.node.childNodes || []).filter((node: any) => node.tagName).map((node: any) => this.ownerDocument.wrap(node)); }
    get firstElementChild() { return this.children[0] || null; }
    get lastElementChild() { return this.children[this.children.length - 1] || null; }
    get parentElement(): DOMElement | null { return this.node.parentNode?.tagName ? this.ownerDocument.wrap(this.node.parentNode) : null; }
    get previousElementSibling(): DOMElement | null { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null; }
    get nextElementSibling(): DOMElement | null { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
    get isConnected(): boolean { return this === this.ownerDocument.documentElement || this.parentElement?.isConnected || false; }
    get tagName(): string { return this.node.tagName.toUpperCase(); }
    get className(): string { return this.getAttribute("class") || ""; }
    set className(value: string) { this.setAttribute("class", value); }
    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(value: boolean) { if (value) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }
    get value(): string { return this.inputValue ?? this.getAttribute("value") ?? ""; }
    set value(value: string) { this.inputValue = value; }
    get dataset(): Record<string, string> {
        const attribute = (key: string) => "data-" + key.replace(/[A-Z]/g, char => "-" + char.toLowerCase());
        return new Proxy({}, {get: (_target, key: string) => this.getAttribute(attribute(key)) ?? undefined,
            set: (_target, key: string, value: string) => { this.setAttribute(attribute(key), value); return true; }});
    }
    get classList() {
        const values = () => new Set(this.className.split(/\s+/).filter(Boolean));
        const toggle = (name: string, force?: boolean) => {
            const classes = values();
            const enabled = force ?? !classes.has(name);
            if (enabled) classes.add(name); else classes.delete(name);
            this.className = [...classes].join(" ");
            return enabled;
        };
        return {contains: (name: string) => values().has(name), toggle,
            add: (...names: string[]) => names.forEach(name => toggle(name, true)),
            remove: (...names: string[]) => names.forEach(name => toggle(name, false))};
    }
    getAttribute(name: string): string | null { return this.node.attrs.find((attr: any) => attr.name === name)?.value ?? null; }
    hasAttribute(name: string) { return this.getAttribute(name) !== null; }
    setAttribute(name: string, value: string) { this.removeAttribute(name); this.node.attrs.push({name, value}); }
    removeAttribute(name: string) { this.node.attrs = this.node.attrs.filter((attr: any) => attr.name !== name); }
    get innerHTML(): string { return parse5.serialize(this.node); }
    set innerHTML(value: string) {
        this.children.forEach(child => child.remove());
        this.node.childNodes = parse5.parseFragment(value).childNodes;
        this.node.childNodes.forEach((child: any) => { child.parentNode = this.node; });
    }
    get textContent(): string {
        const read = (node: any): string => node.nodeName === "#text" ? node.value : (node.childNodes || []).map(read).join("");
        return read(this.node);
    }
    set textContent(value: string) {
        this.children.forEach(child => child.remove());
        this.node.childNodes = [{nodeName: "#text", value, parentNode: this.node}];
    }
    remove() {
        if (this.node.parentNode) {
            this.node.parentNode.childNodes = this.node.parentNode.childNodes.filter((node: any) => node !== this.node);
            this.node.parentNode = undefined;
        }
    }
    append(child: DOMElement) { child.remove(); child.node.parentNode = this.node; this.node.childNodes.push(child.node); }
    before(child: DOMElement) {
        assert.ok(this.parentElement, "Cannot insert before an unmounted element");
        child.remove();
        const parent = this.node.parentNode;
        parent.childNodes.splice(parent.childNodes.indexOf(this.node), 0, child.node);
        child.node.parentNode = parent;
    }
    replaceWith(child: DOMElement) { this.before(child); this.remove(); }
    insertAdjacentHTML(position: string, html: string) {
        assert.equal(position, "beforeend");
        parse5.parseFragment(html).childNodes.forEach((node: any) => { node.parentNode = this.node; this.node.childNodes.push(node); });
    }
    contains(other: DOMElement): boolean { return this === other || this.children.some(child => child.contains(other)); }
    isEqualNode(other: DOMElement) { return this === other; }
    matches(selector: string): boolean {
        const tokens = selector.match(/^[a-z]+|\.[\w-]+|\[[\w-]+(?:="[^"]*")?\]/g);
        assert.equal(tokens?.join(""), selector, `Unsupported fixture selector: ${selector}`);
        return tokens.every(token => {
            if (token.startsWith(".")) return this.classList.contains(token.slice(1));
            if (!token.startsWith("[")) return this.node.tagName === token;
            const [, name, value] = token.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
            return value === undefined ? this.hasAttribute(name) : this.getAttribute(name) === value;
        });
    }
    closest(selector: string): DOMElement | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelector(selector: string): DOMElement | null { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector: string): DOMElement[] {
        if (selector.startsWith(":scope > ")) {
            const [first, ...rest] = selector.slice(9).split(" > ");
            return this.children.filter(child => child.matches(first)).flatMap(child => rest.length ? child.querySelectorAll(":scope > " + rest.join(" > ")) : [child]);
        }
        const descendants = (element: DOMElement): DOMElement[] => element.children.flatMap(child => [child, ...descendants(child)]);
        return descendants(this).filter(child => child.matches(selector));
    }
    addEventListener(type: string, listener: (event: any) => void) {
        if (!this.events.has(type)) this.events.set(type, []);
        this.events.get(type).push(listener);
    }
    dispatch(type: string, options: {key?: string; bubbles?: boolean} = {}) {
        let stopped = false;
        let immediate = false;
        const event = {target: this, key: options.key, defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; immediate = true; }};
        const dispatchTo = (element: DOMElement) => {
            for (const listener of element.events.get(type) || []) { listener(event); if (immediate) break; }
            if (options.bubbles !== false && !stopped && element.parentElement) dispatchTo(element.parentElement);
        };
        dispatchTo(this);
        return event;
    }
    focus() { this.ownerDocument.activeElement = this; }
    getBoundingClientRect() { return {left: 10, right: 110, top: 20, bottom: 50, width: 100, height: 30}; }
}

export const requireFixture = (modules: Record<string, unknown>) => (id: string) => {
    assert.ok(Object.prototype.hasOwnProperty.call(modules, id), `Unexpected require: ${id}`);
    return modules[id];
};
