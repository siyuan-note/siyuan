import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {restoreMobileTopBarLayout, updateMobileTopBarLayout} from "./mobileTopBar";

class TestClassList {
    private classes = new Set<string>();

    public add(value: string) {
        this.classes.add(value);
    }

    public remove(value: string) {
        this.classes.delete(value);
    }

    public contains(value: string) {
        return this.classes.has(value);
    }

    public toggle(value: string, force?: boolean) {
        const enabled = force ?? !this.classes.has(value);
        if (enabled) {
            this.classes.add(value);
        } else {
            this.classes.delete(value);
        }
        return enabled;
    }
}

class TestElement {
    public classList = new TestClassList();
    public parentElement?: TestElement;
    public children: TestElement[] = [];
    public breadcrumbSpace?: TestElement;

    public appendChild(element: TestElement) {
        if (element.parentElement) {
            element.parentElement.children = element.parentElement.children.filter((item) => item !== element);
        }
        element.parentElement = this;
        this.children.push(element);
    }

    public querySelector(selector: string) {
        return selector === ".protyle-breadcrumb__space" ? this.breadcrumbSpace : undefined;
    }
}

describe("mobile top bar layout", () => {
    it("moves title controls into the landscape breadcrumb and restores them in portrait", () => {
        const originalDocument = globalThis.document;
        const originalWindow = globalThis.window;
        const bodyElement = new TestElement();
        const topBarElement = new TestElement();
        const editorElement = new TestElement();
        const breadcrumbSpace = new TestElement();
        const toolbarName = new TestElement();
        const toolbarNameReadonly = new TestElement();
        const toolbarSync = new TestElement();
        const toolbarSidebarLeft = new TestElement();
        const toolbarSidebarRight = new TestElement();
        const elements = new Map<string, TestElement>([
            ["mobileTopBar", topBarElement],
            ["editor", editorElement],
            ["toolbarName", toolbarName],
            ["toolbarNameReadonly", toolbarNameReadonly],
            ["toolbarSync", toolbarSync],
            ["toolbarSidebarLeft", toolbarSidebarLeft],
            ["toolbarSidebarRight", toolbarSidebarRight],
        ]);
        editorElement.breadcrumbSpace = breadcrumbSpace;
        topBarElement.appendChild(toolbarSidebarLeft);
        topBarElement.appendChild(toolbarName);
        topBarElement.appendChild(toolbarNameReadonly);
        topBarElement.appendChild(toolbarSync);
        topBarElement.appendChild(toolbarSidebarRight);
        const screen = {orientation: {type: "landscape-primary"}, width: 1200, height: 800};
        const browser = {
            screen,
            innerWidth: 1200,
            innerHeight: 800,
            matchMedia: () => ({matches: browser.innerWidth > browser.innerHeight}),
        };

        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: {
                body: bodyElement,
                getElementById: (id: string) => elements.get(id),
            },
        });
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: browser,
        });

        try {
            updateMobileTopBarLayout();
            assert.equal(bodyElement.classList.contains("mobile-topbar--merged"), true);
            assert.equal(breadcrumbSpace.classList.contains("protyle-breadcrumb__space--mobile-title"), true);
            assert.deepEqual(breadcrumbSpace.children, [toolbarSidebarLeft, toolbarName, toolbarNameReadonly, toolbarSync, toolbarSidebarRight]);

            restoreMobileTopBarLayout();
            assert.equal(bodyElement.classList.contains("mobile-topbar--merged"), false);
            assert.equal(breadcrumbSpace.classList.contains("protyle-breadcrumb__space--mobile-title"), false);
            assert.deepEqual(topBarElement.children, [toolbarSidebarLeft, toolbarName, toolbarNameReadonly, toolbarSync, toolbarSidebarRight]);

            const replacementBreadcrumbSpace = new TestElement();
            editorElement.breadcrumbSpace = replacementBreadcrumbSpace;
            updateMobileTopBarLayout();
            assert.equal(bodyElement.classList.contains("mobile-topbar--merged"), true);
            assert.equal(replacementBreadcrumbSpace.classList.contains("protyle-breadcrumb__space--mobile-title"), true);
            assert.deepEqual(replacementBreadcrumbSpace.children, [toolbarSidebarLeft, toolbarName, toolbarNameReadonly, toolbarSync, toolbarSidebarRight]);

            screen.orientation.type = "portrait-primary";
            screen.width = 800;
            screen.height = 1200;
            browser.innerWidth = 800;
            browser.innerHeight = 1200;
            updateMobileTopBarLayout();
            assert.equal(bodyElement.classList.contains("mobile-topbar--merged"), false);
            assert.equal(replacementBreadcrumbSpace.classList.contains("protyle-breadcrumb__space--mobile-title"), false);
            assert.deepEqual(topBarElement.children, [toolbarSidebarLeft, toolbarName, toolbarNameReadonly, toolbarSync, toolbarSidebarRight]);

            // 软键盘压缩视口后媒体查询会变成横屏，但屏幕方向和标题栏布局保持竖屏。
            for (const height of [450, 1200, 450]) {
                browser.innerHeight = height;
                updateMobileTopBarLayout();
                assert.equal(bodyElement.classList.contains("mobile-topbar--merged"), false);
                assert.deepEqual(topBarElement.children, [toolbarSidebarLeft, toolbarName, toolbarNameReadonly, toolbarSync, toolbarSidebarRight]);
            }

            screen.orientation.type = "landscape-primary";
            updateMobileTopBarLayout();
            assert.equal(bodyElement.classList.contains("mobile-topbar--merged"), true);
            editorElement.classList.add("fn__none");
            updateMobileTopBarLayout();
            assert.equal(bodyElement.classList.contains("mobile-topbar--merged"), false);
            assert.deepEqual(topBarElement.children, [toolbarSidebarLeft, toolbarName, toolbarNameReadonly, toolbarSync, toolbarSidebarRight]);
        } finally {
            Object.defineProperty(globalThis, "document", {configurable: true, value: originalDocument});
            Object.defineProperty(globalThis, "window", {configurable: true, value: originalWindow});
        }
    });
});
