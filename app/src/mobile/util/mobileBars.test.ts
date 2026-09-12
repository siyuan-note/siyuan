import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {bindMobileBarsScroll, clearMobileBarsScroll} from "./mobileBars";
import {MOBILE_BARS_CONFIG_KEY} from "./mobileBarsConfig";

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
    public attributes = new Map<string, string>();

    public toggleAttribute(name: string, force: boolean): void {
        if (force) {
            this.attributes.set(name, "");
        } else {
            this.attributes.delete(name);
        }
    }

    public setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }
}

class TestScrollElement {
    public scrollTop = 0;
    public onScroll: () => void;

    public addEventListener(_name: string, callback: () => void): void {
        this.onScroll = callback;
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
        const originalWindow = globalThis.window;
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        let frame: FrameRequestCallback;
        const storage = {[MOBILE_BARS_CONFIG_KEY]: {autoHide: true}};
        Object.defineProperty(globalThis, "window", {configurable: true, value: {siyuan: {storage}}});
        Object.defineProperty(globalThis, "requestAnimationFrame", {
            configurable: true,
            value: (callback: FrameRequestCallback) => {
                frame = callback;
                return 1;
            },
        });
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
                notified++;
            });
            assert.equal(notified, 1);
            assert.equal(breadcrumbElement.style.getPropertyValue("--mobile-bar-translate-y"), "0px");
            assert.equal(breadcrumbElement.style.getPropertyValue("--mobile-bar-opacity"), "1");
            assert.equal(breadcrumbElement.attributes.has("inert"), false);
            assert.equal(breadcrumbElement.attributes.get("aria-hidden"), "false");
            const scrollTo = (top: number) => {
                scrollElement.scrollTop = top;
                scrollElement.onScroll();
                frame(0);
            };
            scrollTo(24);
            assert.equal(breadcrumbElement.style.getPropertyValue("--mobile-bar-opacity"), "0.5");
            scrollTo(48);
            assert.equal(breadcrumbElement.style.getPropertyValue("--mobile-bar-opacity"), "0");
            assert.equal(breadcrumbElement.attributes.has("inert"), true);
            assert.equal(breadcrumbElement.attributes.get("aria-hidden"), "true");
            scrollTo(0);
            assert.equal(breadcrumbElement.style.getPropertyValue("--mobile-bar-opacity"), "1");
            assert.equal(breadcrumbElement.attributes.has("inert"), false);
            storage[MOBILE_BARS_CONFIG_KEY].autoHide = false;
            scrollTo(100);
            assert.equal(breadcrumbElement.style.getPropertyValue("--mobile-bar-opacity"), "1");
            assert.equal(breadcrumbElement.attributes.get("aria-hidden"), "false");
            storage[MOBILE_BARS_CONFIG_KEY].autoHide = true;
            scrollTo(148);
            assert.equal(breadcrumbElement.style.getPropertyValue("--mobile-bar-opacity"), "0");
        } finally {
            clearMobileBarsScroll();
            Object.defineProperty(globalThis, "document", {configurable: true, value: originalDocument});
            Object.defineProperty(globalThis, "cancelAnimationFrame", {
                configurable: true,
                value: originalCancelAnimationFrame,
            });
            Object.defineProperty(globalThis, "getSelection", {configurable: true, value: originalGetSelection});
            Object.defineProperty(globalThis, "window", {configurable: true, value: originalWindow});
            Object.defineProperty(globalThis, "requestAnimationFrame", {
                configurable: true, value: originalRequestAnimationFrame,
            });
        }
    });
});
