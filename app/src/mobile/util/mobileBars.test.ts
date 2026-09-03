import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {bindMobileBarsScroll, clearMobileBarsScroll} from "./mobileBars";

class TestClassList {
    public toggle(): boolean {
        return false;
    }
}

class TestStyle {
    private values = new Map<string, string>();

    public getPropertyValue(name: string): string {
        return this.values.get(name) || "";
    }

    public setProperty(name: string, value: string): void {
        this.values.set(name, value);
    }
}

class TestBreadcrumbElement {
    public style = new TestStyle();
}

class TestScrollElement {
    public scrollTop = 0;

    public addEventListener(): void {
        // 测试无需触发滚动事件
    }

    public removeEventListener(): void {
        // 测试无需触发滚动事件
    }

    public closest(): undefined {
        return undefined;
    }
}

describe("mobile bars", () => {
    it("notifies after applying the breadcrumb position", () => {
        const originalDocument = globalThis.document;
        const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
        const originalGetSelection = globalThis.getSelection;
        const breadcrumbElement = new TestBreadcrumbElement();
        const scrollElement = new TestScrollElement();
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: {
                body: {classList: new TestClassList()},
                getElementById: (): undefined => undefined,
                querySelector: (): TestBreadcrumbElement => breadcrumbElement,
            },
        });
        Object.defineProperty(globalThis, "cancelAnimationFrame", {
            configurable: true,
            value: (): undefined => undefined,
        });
        Object.defineProperty(globalThis, "getSelection", {
            configurable: true,
            value: (): undefined => undefined,
        });

        try {
            let notified = 0;
            bindMobileBarsScroll(scrollElement as unknown as HTMLElement, () => {
                assert.equal(breadcrumbElement.style.getPropertyValue("--mobile-bar-translate-y"), "0px");
                notified++;
            });
            assert.equal(notified, 1);
        } finally {
            clearMobileBarsScroll();
            Object.defineProperty(globalThis, "document", {configurable: true, value: originalDocument});
            Object.defineProperty(globalThis, "cancelAnimationFrame", {
                configurable: true,
                value: originalCancelAnimationFrame,
            });
            Object.defineProperty(globalThis, "getSelection", {configurable: true, value: originalGetSelection});
        }
    });
});
