import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {compile} from "sass";
import {createMarkdownTooltips} from "./tooltip";

const fixture = () => {
    const previous = new Map<string, PropertyDescriptor>();
    const setGlobal = (name: string, value: unknown) => {
        previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, {value, configurable: true});
    };
    class Element extends EventTarget {
        ownerDocument: typeof document;
        parentElement: Element;
        children: Element[] = [];
        dataset: Record<string, string> = {};
        style: Record<string, string> = {};
        attributes = new Map<string, string>();
        classes = new Set<string>();
        classList = Object.assign(this.classes, {contains: (name: string) => this.classes.has(name)});
        id = "";
        className = "";
        hidden = false;
        textContent = "";
        bounds = {left: 100, right: 140, top: 100, bottom: 120, width: 40, height: 20};
        get offsetWidth() {return Math.min(200, parseFloat(this.style.maxWidth) || 200);}
        get offsetHeight() {return 40;}
        setAttribute(name: string, value: string) {this.attributes.set(name, value);}
        getAttribute(name: string) {return this.attributes.get(name) ?? null;}
        removeAttribute(name: string) {this.attributes.delete(name);}
        append(element: Element) {element.parentElement = this; this.children.push(element);}
        remove() {this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = undefined;}
        contains(element: Element): boolean {return element === this || !!element?.parentElement && this.contains(element.parentElement);}
        closest(selector: string): Element {
            if (selector === "[inert]" ? this.attributes.has("inert") :
                this.dataset.tooltip !== undefined || this.classes.has("vditor-tooltipped") && this.attributes.has("aria-label")) return this;
            return this.parentElement?.closest(selector);
        }
        getBoundingClientRect() {return this.bounds;}
        getClientRects() {return this.hidden ? [] : [this.bounds];}
    }
    const view = Object.assign(new EventTarget(), {clearTimeout, setTimeout, innerWidth: 800, innerHeight: 600, matchMedia: () => ({matches: false})});
    const document = Object.assign(new EventTarget(), {defaultView: view, body: new Element(), createElement: () => new Element()});
    const root = new Element(); root.ownerDocument = document; document.body.append(root);
    let observe: (records: Array<{type: string; attributeName?: string; target?: Element}>) => void;
    let disconnected = false;
    setGlobal("Element", Element);
    setGlobal("MutationObserver", class {
        constructor(callback: typeof observe) {observe = callback;}
        observe() {}
        disconnect() {disconnected = true;}
    });
    const instance = createMarkdownTooltips(root as unknown as HTMLElement);
    const tooltip = document.body.children.at(-1);
    const control = (message: string) => {const element = new Element(); element.dataset.tooltip = message; root.append(element); return element;};
    const dispatch = (type: string, target: Element, extra: Record<string, unknown> = {}, owner: EventTarget = root) => {
        const event = new Event(type);
        Object.defineProperties(event, Object.fromEntries(Object.entries({target, pointerType: "mouse", ...extra})
            .map(([key, value]) => [key, {value}])));
        owner.dispatchEvent(event);
    };
    return {root, view, document, tooltip, control, dispatch, instance,
        changed: () => observe([{type: "childList"}]), disconnected: () => disconnected,
        cleanup() {
            instance.destroy();
            for (const [name, descriptor] of previous) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else Reflect.deleteProperty(globalThis, name);
            }
        }};
};

test("Markdown tooltips preserve literal labels, disabled hints and existing accessible descriptions", () => {
    const f = fixture();
    try {
        const control = f.control('A%2FB <img src="x"> & Notes');
        control.setAttribute("aria-label", "Files");
        control.setAttribute("aria-describedby", "existing-description");
        control.setAttribute("disabled", "");
        f.dispatch("pointerover", control);
        assert.equal(f.tooltip.hidden, false);
        assert.equal(f.tooltip.textContent, control.dataset.tooltip);
        assert.equal(control.getAttribute("aria-label"), "Files");
        assert.equal(control.getAttribute("aria-describedby"), `existing-description ${f.tooltip.id}`);
        control.dataset.tooltip = "Changed <Ctrl+Alt+O>";
        f.changed();
        assert.equal(f.tooltip.textContent, control.dataset.tooltip, "hovered shortcuts update without stale labels");
        control.dataset.tooltip = "Files";
        control.dataset.tooltipShortcut = "Alt+1"; f.changed();
        assert.equal(f.tooltip.textContent, "Files Alt+1");
        control.dataset.tooltip = "Folder"; f.changed();
        assert.equal(f.tooltip.textContent, "Folder Alt+1", "tree label refreshes retain the configured shortcut");
        control.dataset.tooltipShortcut = "Ctrl+Shift+L"; f.changed();
        assert.equal(f.tooltip.textContent, "Folder Ctrl+Shift+L");
        control.dataset.tooltipShortcut = ""; f.changed();
        assert.equal(f.tooltip.textContent, "Folder", "unavailable actions clear their shortcut suffix");
        f.dispatch("pointerout", control);
        assert.equal(f.tooltip.hidden, true);
        assert.equal(control.getAttribute("aria-describedby"), "existing-description");
        const content = f.control("");
        delete content.dataset.tooltip;
        content.setAttribute("title", "Document title");
        f.dispatch("pointerover", content);
        assert.equal(f.tooltip.hidden, true);
        assert.equal(content.getAttribute("title"), "Document title", "document metadata is not changed");
    } finally {f.cleanup();}
});

test("Markdown tooltips follow pointer, keyboard and dismissal lifecycle without intercepting activation", () => {
    const f = fixture();
    try {
        const control = f.control("Info");
        f.dispatch("pointerover", control, {pointerType: "touch"});
        f.dispatch("focusin", control);
        assert.equal(f.tooltip.hidden, true);
        f.dispatch("keydown", control, {key: "Tab"}, f.document);
        f.dispatch("focusin", control);
        assert.equal(f.tooltip.hidden, false);
        f.dispatch("keydown", control, {key: "Escape"}, f.document);
        f.dispatch("pointermove", control);
        assert.equal(f.tooltip.hidden, true, "Escape stays dismissed until the pointer leaves");
        f.dispatch("pointerout", control);
        f.dispatch("pointerover", control, {pointerType: "pen"});
        assert.equal(f.tooltip.hidden, false);
        f.dispatch("scroll", control, {}, f.document);
        assert.equal(f.tooltip.hidden, true);
        f.dispatch("pointerover", control);
        control.remove(); f.changed();
        assert.equal(f.tooltip.hidden, true, "virtualized rows cannot leave stale overlays");
        const wrapper = f.control("Code language");
        const input = f.control(""); delete input.dataset.tooltip;
        input.setAttribute("aria-label", "Language"); wrapper.append(input);
        f.dispatch("focusin", input);
        assert.equal(input.getAttribute("aria-describedby"), f.tooltip.id);
        assert.equal(input.getAttribute("aria-label"), "Language");
        input.remove(); f.changed();
        assert.equal(f.tooltip.hidden, true, "replaced popover inputs release their descriptions");
        f.instance.destroy(); f.instance.destroy();
        assert.equal(f.root.dataset.tooltips, undefined);
        assert.equal(f.disconnected(), true);
        assert.equal(f.tooltip.parentElement, undefined);
        f.dispatch("pointerover", f.control("Disposed"));
        assert.equal(f.tooltip.hidden, true);
    } finally {f.cleanup();}
});

test("Markdown tooltip placement flips at viewport edges and follows Vditor directions", () => {
    const f = fixture();
    try {
        const control = f.control("Position");
        const hover = () => {f.dispatch("pointerout", control); f.dispatch("pointerover", control);};
        hover();
        assert.equal(f.tooltip.style.top, "120.5px");
        assert.equal(f.tooltip.style.left, "20px");
        control.bounds = {left: 780, right: 800, top: 580, bottom: 600, width: 20, height: 20};
        hover();
        assert.equal(f.tooltip.style.top, "539.5px");
        assert.equal(f.tooltip.style.left, "600px");
        control.dataset.position = "east";
        hover();
        assert.equal(f.tooltip.style.left, "579.5px");
        assert.equal(f.tooltip.style.top, "560px");
        control.bounds = {left: 0, right: 20, top: 0, bottom: 20, width: 20, height: 20};
        control.dataset.position = "west";
        hover();
        assert.equal(f.tooltip.style.left, "20.5px");
        delete control.dataset.position; delete control.dataset.tooltip;
        control.classes.add("vditor-tooltipped"); control.classes.add("vditor-tooltipped__n");
        control.setAttribute("aria-label", "Language<Alt+Enter>");
        hover();
        assert.equal(f.tooltip.textContent, "Language<Alt+Enter>");
        assert.equal(f.tooltip.style.top, "20.5px");
        f.view.innerWidth = 100; f.view.innerHeight = 80;
        control.bounds = {left: 0, right: 20, top: 30, bottom: 50, width: 20, height: 20};
        hover();
        assert.equal(f.tooltip.style.maxWidth, "100px");
        assert.equal(f.tooltip.style.left, "0px");
        assert.equal(f.tooltip.style.maxHeight, "29.5px");
        assert.equal(f.tooltip.style.top, "0px");
    } finally {f.cleanup();}
});

test("Markdown reuses main tooltip colors, delay and animation while suppressing only vendor UI tips", () => {
    const css = compile(path.resolve(__dirname, "../assets/scss/markdown.scss")).css;
    const shared = compile(path.resolve(__dirname, "../assets/scss/component/_tooltips.scss")).css;
    const tooltip = shared.slice(shared.indexOf(".tooltip {"), shared.indexOf("\n}")) + "\n}";
    assert.ok(css.includes(tooltip), "shared component declarations are included unchanged");
    assert.match(tooltip, /animation-delay: 300ms/);
    assert.match(tooltip, /animation-duration: 150ms/);
    assert.match(css, /@keyframes zoomIn/);
    assert.match(css, /\.markdown-app\[data-tooltips\] \.vditor-tooltipped::before,[\s\S]*?content: none/);
    const chrome = readFileSync(path.join(__dirname, "windowChrome.ts"), "utf8");
    assert.doesNotMatch(chrome, /\.title\s*=/);
    assert.match(chrome, /maximize\.dataset\.tooltip = label/);
});
