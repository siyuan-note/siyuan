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
        const elements = new Map<string, TestElement>([
            ["mobileTopBar", topBarElement],
            ["editor", editorElement],
            ["toolbarName", toolbarName],
            ["toolbarNameReadonly", toolbarNameReadonly],
            ["toolbarSync", toolbarSync],
        ]);
        editorElement.breadcrumbSpace = breadcrumbSpace;
        topBarElement.appendChild(toolbarName);
        topBarElement.appendChild(toolbarNameReadonly);
        topBarElement.appendChild(toolbarSync);
        let landscape = true;

        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: {
                body: bodyElement,
                getElementById: (id: string) => elements.get(id),
            },
        });
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {
                matchMedia: () => ({matches: landscape}),
            },
        });

        try {
            updateMobileTopBarLayout();
            assert.equal(bodyElement.classList.contains("mobile-topbar--merged"), true);
            assert.equal(breadcrumbSpace.classList.contains("protyle-breadcrumb__space--mobile-title"), true);
            assert.deepEqual(breadcrumbSpace.children, [toolbarName, toolbarNameReadonly, toolbarSync]);

            restoreMobileTopBarLayout();
            assert.equal(bodyElement.classList.contains("mobile-topbar--merged"), false);
            assert.equal(breadcrumbSpace.classList.contains("protyle-breadcrumb__space--mobile-title"), false);
            assert.deepEqual(topBarElement.children, [toolbarName, toolbarNameReadonly, toolbarSync]);

            const replacementBreadcrumbSpace = new TestElement();
            editorElement.breadcrumbSpace = replacementBreadcrumbSpace;
            updateMobileTopBarLayout();
            assert.equal(bodyElement.classList.contains("mobile-topbar--merged"), true);
            assert.equal(replacementBreadcrumbSpace.classList.contains("protyle-breadcrumb__space--mobile-title"), true);
            assert.deepEqual(replacementBreadcrumbSpace.children, [toolbarName, toolbarNameReadonly, toolbarSync]);

            landscape = false;
            updateMobileTopBarLayout();
            assert.equal(bodyElement.classList.contains("mobile-topbar--merged"), false);
            assert.equal(replacementBreadcrumbSpace.classList.contains("protyle-breadcrumb__space--mobile-title"), false);
            assert.deepEqual(topBarElement.children, [toolbarName, toolbarNameReadonly, toolbarSync]);

            landscape = true;
            editorElement.classList.add("fn__none");
            updateMobileTopBarLayout();
            assert.equal(bodyElement.classList.contains("mobile-topbar--merged"), false);
            assert.deepEqual(topBarElement.children, [toolbarName, toolbarNameReadonly, toolbarSync]);
        } finally {
            Object.defineProperty(globalThis, "document", {configurable: true, value: originalDocument});
            Object.defineProperty(globalThis, "window", {configurable: true, value: originalWindow});
        }
    });
});
