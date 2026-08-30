import {after, before, describe, it} from "node:test";
import * as assert from "node:assert/strict";

const originalLute = Object.getOwnPropertyDescriptor(globalThis, "Lute");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalNodeEnv = Object.getOwnPropertyDescriptor(globalThis, "NODE_ENV");
const originalSiYuanVersion = Object.getOwnPropertyDescriptor(globalThis, "SIYUAN_VERSION");
let getFileTreeDefaultIconAttr: typeof import("./fileTreeIcon").getFileTreeDefaultIconAttr;
let getFileTreeIconHTML: typeof import("./fileTreeIcon").getFileTreeIconHTML;
let getDocumentIconHTML: typeof import("./fileTreeIcon").getDocumentIconHTML;
let refreshDefaultFileTreeIcons: typeof import("./fileTreeIcon").refreshDefaultFileTreeIcons;
let syncFileTreeItemDefaultIcon: typeof import("./fileTreeIcon").syncFileTreeItemDefaultIcon;
let updateFileTreeItemIcon: typeof import("./fileTreeIcon").updateFileTreeItemIcon;

before(async () => {
    Object.defineProperty(globalThis, "NODE_ENV", {configurable: true, value: "test"});
    Object.defineProperty(globalThis, "SIYUAN_VERSION", {configurable: true, value: "test"});
    Object.defineProperty(globalThis, "Lute", {
        configurable: true,
        value: {Sanitize: (value: string) => value},
    });
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            siyuan: {
                config: {fileTree: {useSVGDefaultIcon: false}},
                storage: {"local-images": {file: "1f4c4", folder: "1f4d1", note: "1f5c3"}},
            },
        },
    });
    ({
        getFileTreeDefaultIconAttr,
        getFileTreeIconHTML,
        getDocumentIconHTML,
        refreshDefaultFileTreeIcons,
        syncFileTreeItemDefaultIcon,
        updateFileTreeItemIcon,
    } = await import("./fileTreeIcon"));
});

after(() => {
    if (originalLute) {
        Object.defineProperty(globalThis, "Lute", originalLute);
    } else {
        Reflect.deleteProperty(globalThis, "Lute");
    }
    if (originalWindow) {
        Object.defineProperty(globalThis, "window", originalWindow);
    } else {
        Reflect.deleteProperty(globalThis, "window");
    }
    if (originalNodeEnv) {
        Object.defineProperty(globalThis, "NODE_ENV", originalNodeEnv);
    } else {
        Reflect.deleteProperty(globalThis, "NODE_ENV");
    }
    if (originalSiYuanVersion) {
        Object.defineProperty(globalThis, "SIYUAN_VERSION", originalSiYuanVersion);
    } else {
        Reflect.deleteProperty(globalThis, "SIYUAN_VERSION");
    }
});

describe("file tree icon", () => {
    it("renders the configured SVG defaults", () => {
        assert.match(getFileTreeIconHTML("", "notebook", "", false, true), /#iconNotebook/);
        assert.match(getFileTreeIconHTML("", "folder", "", false, true), /#iconFileText/);
        assert.match(getFileTreeIconHTML("", "file", "", false, true), /#iconFile/);
        assert.equal(getFileTreeIconHTML("", "notebook", "b3-menu__icon", true, true),
            '<svg class="b3-menu__icon"><use xlink:href="#iconNotebook"></use></svg>');
        assert.equal(getDocumentIconHTML("", "mobile-tabs__item-icon", true),
            '<svg class="mobile-tabs__item-icon"><use xlink:href="#iconFile"></use></svg>');
    });

    it("keeps the Emoji defaults when SVG icons are disabled", () => {
        assert.equal(getFileTreeIconHTML("", "notebook", "", false, false), "🗃");
        assert.equal(getFileTreeIconHTML("", "folder", "", false, false), "📑");
        assert.equal(getFileTreeIconHTML("", "file", "", false, false), "📄");
        assert.equal(getDocumentIconHTML("", "mobile-tabs__item-icon", false),
            '<span class="mobile-tabs__item-icon">📄</span>');
    });

    it("treats an explicitly configured icon as custom", () => {
        assert.equal(getFileTreeIconHTML("1f4c4", "folder", "", false, true), "📄");
        assert.equal(getDocumentIconHTML("1f4c4", "mobile-tabs__item-icon", true),
            '<span class="mobile-tabs__item-icon">📄</span>');
        assert.equal(getFileTreeDefaultIconAttr("1f4c4", "folder"), "");
        assert.equal(getFileTreeDefaultIconAttr("", "folder"), ' data-default-icon="folder"');
        assert.equal(getFileTreeDefaultIconAttr("", "notebook", true), "");
    });

    it("updates only marked default icons when document state or the setting changes", () => {
        const classes = (...values: string[]) => ({contains: (value: string) => values.includes(value)});
        const toggleElement = {classList: classes("b3-list-item__toggle")};
        const iconElement = {classList: classes("b3-list-item__icon"), innerHTML: ""};
        const dataset: Record<string, string> = {defaultIcon: "file"};
        const liElement = {
            children: [toggleElement, iconElement],
            dataset,
            getAttribute: (name: string) => name === "data-type" ? "navigation-file" : null,
            hasAttribute: (name: string) => name === "data-default-icon" && "defaultIcon" in dataset,
        } as unknown as HTMLElement;
        window.siyuan.config.fileTree.useSVGDefaultIcon = true;

        syncFileTreeItemDefaultIcon(liElement);
        assert.equal(dataset.defaultIcon, "folder");
        assert.match(iconElement.innerHTML, /#iconFileText/);

        updateFileTreeItemIcon(liElement, "1f4c4");
        assert.equal("defaultIcon" in dataset, false);
        assert.equal(iconElement.innerHTML, "📄");

        updateFileTreeItemIcon(liElement, "", "file");
        window.siyuan.config.fileTree.useSVGDefaultIcon = false;
        refreshDefaultFileTreeIcons({querySelectorAll: () => [liElement]} as unknown as ParentNode);
        assert.equal(dataset.defaultIcon, "file");
        assert.equal(iconElement.innerHTML, "📄");
    });
});
