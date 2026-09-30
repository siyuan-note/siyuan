import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {bindMobileBarsScroll, clearMobileBarsScroll} from "./mobileBars";
import {MOBILE_BARS_CONFIG_KEY} from "./mobileBarsConfig";
import * as mobileBarsState from "./mobileBarsState";

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
    for (const keyboardAlreadyOpen of [false, true]) {
        it(`keeps the title editable when focused with the keyboard ${keyboardAlreadyOpen ? "open" : "closed"}`, () => {
            const windowListeners = new Map<string, (event: {detail: boolean}) => void>();
            const documentListeners = new Map<string, () => void>();
            const classes = new Set<string>();
            const topbarElement = new TestBreadcrumbElement();
            const breadcrumbElement = new TestBreadcrumbElement();
            const bottomBarElement = new TestBreadcrumbElement();
            const scrollElement = new TestScrollElement();
            let frame: FrameRequestCallback;
            let finishScroll: () => void;
            const mockDocument = {
                activeElement: {id: "body"},
                body: {classList: {toggle: (name: string, active: boolean) => {
                    if (active) {
                        classes.add(name);
                    } else {
                        classes.delete(name);
                    }
                }}},
                getElementById: (id: string) => {
                    if (id === "mobileTopBar") {
                        return topbarElement;
                    }
                    return id === "mobileBottomBar" ? bottomBarElement : undefined;
                },
                querySelector: () => breadcrumbElement,
                addEventListener: (name: string, callback: () => void) => documentListeners.set(name, callback),
            };
            const moduleExports: Partial<typeof import("./mobileBars")> = {};
            const source = readFileSync(resolve(process.cwd(), "src/mobile/util/mobileBars.ts"), "utf8");
            runInNewContext(transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText, {
                exports: moduleExports,
                require: (name: string) => name === "./mobileBarsState" ? mobileBarsState :
                    {isMobileBarsAutoHide: () => true},
                document: mockDocument,
                window: {
                    addEventListener: (name: string, callback: (event: {detail: boolean}) => void) =>
                        windowListeners.set(name, callback),
                    setTimeout: (callback: () => void) => {
                        finishScroll = callback;
                        return 1;
                    },
                },
                clearTimeout: () => {},
                requestAnimationFrame: (callback: FrameRequestCallback) => {
                    frame = callback;
                    return 1;
                },
                cancelAnimationFrame: () => {},
                getSelection: (): undefined => undefined,
                MutationObserver: class {
                    observe(): void {}
                    disconnect(): void {}
                },
            });
            moduleExports.initMobileBars();
            moduleExports.bindMobileBarsScroll(scrollElement as unknown as HTMLElement);
            const changeKeyboard = (open: boolean) => windowListeners.get("siyuan-mobile-keyboard-change")({detail: open});
            const assertTitleVisible = () => {
                assert.equal(topbarElement.style.getPropertyValue("--mobile-bar-translate-y"),
                    "calc(0 * (var(--mobile-topbar-height) + var(--mobile-breadcrumb-height)))");
                assert.equal(topbarElement.attributes.has("inert"), false);
                assert.equal(topbarElement.attributes.get("aria-hidden"), "false");
                assert.equal(classes.has("mobile-chrome--hidden"), false);
            };
            if (keyboardAlreadyOpen) {
                changeKeyboard(true);
                assert.equal(topbarElement.attributes.has("inert"), true);
            }
            mockDocument.activeElement = {id: "toolbarName"};
            documentListeners.get("focusin")();
            assertTitleVisible();
            changeKeyboard(true);
            assertTitleVisible();
            assert.equal(bottomBarElement.attributes.has("inert"), true);
            finishScroll();
            scrollElement.scrollTop = 100;
            scrollElement.onScroll();
            frame(0);
            assertTitleVisible();
            mockDocument.activeElement = {id: "body"};
            changeKeyboard(false);
            finishScroll();
            assertTitleVisible();
            assert.equal(bottomBarElement.attributes.has("inert"), false);
            changeKeyboard(true);
            assert.equal(topbarElement.attributes.has("inert"), true);
        });
    }

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
        const topbarElement = new TestBreadcrumbElement();
        const scrollElement = new TestScrollElement();
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: {
                body: {classList: new TestClassList()},
                getElementById: (id: string): TestBreadcrumbElement | undefined =>
                    id === "mobileTopBar" ? topbarElement : undefined,
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
            const assertPosition = (progress: number) => {
                const translation = `calc(${0 - progress} * (var(--mobile-topbar-height) + var(--mobile-breadcrumb-height)))`;
                assert.equal(breadcrumbElement.style.getPropertyValue("--mobile-bar-translate-y"), translation);
                assert.equal(topbarElement.style.getPropertyValue("--mobile-bar-translate-y"), translation);
                assert.equal(breadcrumbElement.style.getPropertyValue("--mobile-bar-opacity"), "");
            };
            assertPosition(0);
            assert.equal(breadcrumbElement.attributes.has("inert"), false);
            assert.equal(breadcrumbElement.attributes.get("aria-hidden"), "false");
            const scrollTo = (top: number) => {
                scrollElement.scrollTop = top;
                scrollElement.onScroll();
                frame(0);
            };
            scrollTo(24);
            assertPosition(0.5);
            scrollTo(47);
            assertPosition(47 / 48);
            scrollTo(48);
            assertPosition(1);
            assert.equal(breadcrumbElement.attributes.has("inert"), true);
            assert.equal(breadcrumbElement.attributes.get("aria-hidden"), "true");
            scrollTo(47);
            assertPosition(47 / 48);
            assert.equal(breadcrumbElement.attributes.get("aria-hidden"), "false");
            scrollTo(0);
            assertPosition(0);
            assert.equal(breadcrumbElement.attributes.has("inert"), false);
            storage[MOBILE_BARS_CONFIG_KEY].autoHide = false;
            scrollTo(100);
            assertPosition(0);
            assert.equal(breadcrumbElement.attributes.get("aria-hidden"), "false");
            storage[MOBILE_BARS_CONFIG_KEY].autoHide = true;
            scrollTo(148);
            assertPosition(1);
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
