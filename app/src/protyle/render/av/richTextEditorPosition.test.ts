import * as assert from "node:assert/strict";
import {after, before, describe, it} from "node:test";
import {positionAVRichTextEditor} from "./richTextEditorPosition";

interface RectOptions {
    left: number;
    top: number;
    width: number;
    height: number;
}

const createRect = (options: RectOptions): DOMRect => ({
    x: options.left,
    y: options.top,
    left: options.left,
    top: options.top,
    width: options.width,
    height: options.height,
    right: options.left + options.width,
    bottom: options.top + options.height,
    toJSON: () => ({}),
});

const createPanel = (height: number) => {
    const style: Record<string, string> = {};
    const panel = {
        dataset: {} as DOMStringMap,
        style,
        height,
        getBoundingClientRect() {
            return createRect({
                left: parseFloat(style.left) || 0,
                top: parseFloat(style.top) || 0,
                width: parseFloat(style.width) || 0,
                height: this.height,
            });
        },
    };
    return panel;
};

const createAnchor = (options: RectOptions) => ({
    getBoundingClientRect: () => createRect(options),
}) as HTMLElement;

describe("attribute view rich-text editor positioning", () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");

    before(() => {
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {innerWidth: 1066, innerHeight: 540},
        });
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: {getElementById: (id: string) => id === "sidebar" ? {} : null},
        });
    });

    after(() => {
        if (windowDescriptor) {
            Object.defineProperty(globalThis, "window", windowDescriptor);
        } else {
            delete (globalThis as {window?: Window}).window;
        }
        if (documentDescriptor) {
            Object.defineProperty(globalThis, "document", documentDescriptor);
        } else {
            delete (globalThis as {document?: Document}).document;
        }
    });

    it("places the measured panel directly above a low cell", () => {
        const panel = createPanel(240);
        const anchor = createAnchor({left: 551, top: 412, width: 199, height: 32});

        positionAVRichTextEditor(panel as unknown as HTMLElement, anchor);

        assert.equal(panel.style.left, "551px");
        assert.equal(panel.style.top, "172px");
        assert.equal(panel.style.width, "420px");
        assert.equal(panel.style.maxHeight, "480px");
        assert.equal(panel.getBoundingClientRect().bottom, anchor.getBoundingClientRect().top);
    });

    it("places the panel directly below a cell when it fits", () => {
        Object.assign(window, {innerWidth: 1000, innerHeight: 800});
        const panel = createPanel(240);
        const anchor = createAnchor({left: 100, top: 100, width: 150, height: 32});

        positionAVRichTextEditor(panel as unknown as HTMLElement, anchor);

        assert.equal(panel.style.top, "132px");
        assert.equal(panel.getBoundingClientRect().top, anchor.getBoundingClientRect().bottom);
    });

    it("keeps horizontal margins and follows changes to the measured panel height", () => {
        Object.assign(window, {innerWidth: 600, innerHeight: 540});
        const panel = createPanel(240);
        const anchor = createAnchor({left: 551, top: 412, width: 199, height: 32});

        positionAVRichTextEditor(panel as unknown as HTMLElement, anchor);
        assert.equal(panel.style.left, "172px");
        assert.equal(panel.style.top, "172px");

        panel.height = 300;
        positionAVRichTextEditor(panel as unknown as HTMLElement, anchor);
        assert.equal(panel.style.top, "112px");
        assert.equal(panel.getBoundingClientRect().bottom, anchor.getBoundingClientRect().top);
    });
});
