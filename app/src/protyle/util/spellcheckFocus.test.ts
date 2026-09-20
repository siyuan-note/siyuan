import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {bindSpellcheckFocus, recordRestoredSpellcheckFocus} from "./spellcheckFocus";

const fixture = () => {
    const listeners = new Map<string, (event?: any) => void>();
    const windowListeners = new Map<string, (event: any) => void>();
    const outside = {};
    let enabled = true;
    let blurCount = 0;
    let selectedBlocks = false;
    let excludedTarget = false;
    const selection = {rangeCount: 1, isCollapsed: true, anchorNode: {}};
    const doc = {
        activeElement: outside,
        getSelection: () => selection,
        defaultView: {
            addEventListener: (type: string, listener: (event: any) => void) => windowListeners.set(type, listener),
            removeEventListener: (type: string) => windowListeners.delete(type),
        },
    };
    const root = {
        ownerDocument: doc,
        isConnected: true,
        isContentEditable: true,
        spellcheck: true,
        contains: (node: unknown) => node === selection.anchorNode,
        querySelector: () => selectedBlocks ? {} : null,
        addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
        blur: () => {
            blurCount++;
            doc.activeElement = outside;
            listeners.get("focusout")?.();
        },
    };
    const element = root as unknown as HTMLElement;
    const block = {parentElement: root as unknown, isSameNode: (node: unknown) => node === block};
    const editable = {parentElement: block};
    const target = {
        isContentEditable: true,
        spellcheck: true,
        closest: (selector: string) => selector === '[data-type="NodeParagraph"]' ? block :
            selector === '[contenteditable="true"]' ? editable : excludedTarget ? {} : null,
    };
    const dispose = bindSpellcheckFocus(element, () => enabled);
    const restore = () => {
        const previousActiveElement = doc.activeElement;
        doc.activeElement = root;
        recordRestoredSpellcheckFocus(element, previousActiveElement as Element);
    };
    const mouseDown = (options: Record<string, unknown> = {}, afterCapture?: (event: any) => void,
                       pointerType = "mouse") => {
        listeners.get("pointerdown")?.({isPrimary: true, pointerType});
        const event = {
            target, isTrusted: true, defaultPrevented: false, button: 0, detail: 1,
            shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...options,
        };
        listeners.get("mousedown")?.(event);
        afterCapture?.(event);
        windowListeners.get("mousedown")?.(event);
    };
    return {
        root, element, target, block, doc, outside, selection, listeners, windowListeners, restore, mouseDown, dispose,
        blurCount: () => blurCount,
        setEnabled: (value: boolean) => enabled = value,
        selectBlocks: () => selectedBlocks = true,
        excludeTarget: () => excludedTarget = true,
    };
};

describe("spellcheck focus after document restoration", () => {
    it("releases restored focus once without replacing the selection or refocusing in script", () => {
        const f = fixture();
        f.restore();
        const selection = {...f.selection};
        f.mouseDown();
        assert.equal(f.blurCount(), 1);
        assert.equal(f.doc.activeElement, f.outside);
        assert.deepEqual(f.selection, selection);
        // 模拟随后由浏览器默认鼠标行为聚焦，正常点击不再重复失焦。
        f.doc.activeElement = f.root;
        f.mouseDown();
        assert.equal(f.blurCount(), 1);
        f.dispose();
    });

    it("leaves naturally focused editors and ordinary selection restoration alone", () => {
        const f = fixture();
        f.doc.activeElement = f.root;
        f.restore();
        f.mouseDown();
        assert.equal(f.blurCount(), 0);
        f.dispose();
    });

    it("discards pending work when focus leaves and allows another document restoration", () => {
        const f = fixture();
        f.restore();
        f.listeners.get("focusout")();
        f.mouseDown();
        assert.equal(f.blurCount(), 0);
        f.doc.activeElement = f.outside;
        f.restore();
        f.mouseDown();
        assert.equal(f.blurCount(), 1);
        f.dispose();
    });

    it("waits for ancestor handlers and preserves a later eligible click after cancellation", () => {
        const f = fixture();
        f.restore();
        f.mouseDown({}, event => {
            assert.equal(f.blurCount(), 0);
            event.defaultPrevented = true;
        });
        assert.equal(f.blurCount(), 0);
        f.mouseDown();
        assert.equal(f.blurCount(), 1);
        f.dispose();
    });

    it("skips modified clicks, right click, repeated clicks and synthetic events", () => {
        const f = fixture();
        f.restore();
        for (const options of [{shiftKey: true}, {ctrlKey: true}, {metaKey: true}, {altKey: true},
            {button: 2}, {detail: 2}, {detail: 3}, {isTrusted: false}, {defaultPrevented: true}]) {
            f.mouseDown(options);
        }
        assert.equal(f.blurCount(), 0);
        f.dispose();
    });

    it("preserves existing text selections even if editor handlers collapse them", () => {
        const f = fixture();
        f.restore();
        f.selection.isCollapsed = false;
        f.mouseDown({}, () => f.selection.isCollapsed = true);
        assert.equal(f.blurCount(), 0);
        f.mouseDown({}, () => f.selection.isCollapsed = false);
        assert.equal(f.blurCount(), 0);
        f.dispose();
    });

    it("skips composition, including a composition that ends during this pointer gesture", () => {
        const f = fixture();
        f.restore();
        f.listeners.get("compositionstart")();
        f.mouseDown({}, () => f.listeners.get("compositionend")());
        assert.equal(f.blurCount(), 0);
        f.mouseDown();
        assert.equal(f.blurCount(), 1);
        f.dispose();
    });

    it("skips touch and pen compatibility mouse events", () => {
        const f = fixture();
        f.restore();
        f.mouseDown({}, undefined, "touch");
        f.mouseDown({}, undefined, "pen");
        assert.equal(f.blurCount(), 0);
        f.dispose();
    });

    it("skips disabled, readonly, detached and no longer focused editors", () => {
        for (const change of [
            (f: ReturnType<typeof fixture>) => f.setEnabled(false),
            (f: ReturnType<typeof fixture>) => f.root.isContentEditable = false,
            (f: ReturnType<typeof fixture>) => f.root.spellcheck = false,
            (f: ReturnType<typeof fixture>) => f.root.isConnected = false,
            (f: ReturnType<typeof fixture>) => f.doc.activeElement = f.outside,
        ]) {
            const f = fixture();
            f.restore();
            f.mouseDown({}, () => change(f));
            assert.equal(f.blurCount(), 0);
            f.dispose();
        }
    });

    it("skips controls, nested blocks, non-editable text and block selections", () => {
        for (const change of [
            (f: ReturnType<typeof fixture>) => f.excludeTarget(),
            (f: ReturnType<typeof fixture>) => f.block.parentElement = {},
            (f: ReturnType<typeof fixture>) => f.target.isContentEditable = false,
            (f: ReturnType<typeof fixture>) => f.target.spellcheck = false,
            (f: ReturnType<typeof fixture>) => f.selectBlocks(),
        ]) {
            const f = fixture();
            f.restore();
            change(f);
            f.mouseDown();
            assert.equal(f.blurCount(), 0);
            f.dispose();
        }
    });

    it("does not arm while disabled and removes all listeners on destruction", () => {
        const f = fixture();
        f.setEnabled(false);
        f.restore();
        f.setEnabled(true);
        f.mouseDown();
        assert.equal(f.blurCount(), 0);
        f.dispose();
        assert.equal(f.listeners.size, 0);
        assert.equal(f.windowListeners.size, 0);
        f.doc.activeElement = f.outside;
        f.restore();
        f.mouseDown();
        assert.equal(f.blurCount(), 0);
    });
});
