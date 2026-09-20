import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {createDefaultMobileSidePanelConfig, MOBILE_SIDE_PANEL_DOCK_IDS, normalizeMobileSidePanelConfig} from "./mobileSidePanelConfig";

test("side panel rendering hides docks, selects a visible fallback and closes an empty panel", () => {
    const element = (type: string) => {
        const classes = new Set<string>();
        return {
            dataset: {},
            getAttribute: () => type,
            classList: {
                contains: (name: string) => classes.has(name),
                toggle: (name: string, enabled: boolean) => enabled ? classes.add(name) : classes.delete(name),
            },
        };
    };
    const tabs = new Map(MOBILE_SIDE_PANEL_DOCK_IDS.map(id => [id, element(`sidebar-${id}-tab`)]));
    const contents = new Map(MOBILE_SIDE_PANEL_DOCK_IDS.map(id => [id, element(`sidebar-${id}`)]));
    type DockElement = ReturnType<typeof element>;
    const panel = () => {
        const children: DockElement[] = [];
        return {
            style: {transform: ""},
            firstElementChild: {
                firstElementChild: {append: (item: DockElement) => {
                    const index = children.indexOf(item);
                    if (index >= 0) {
                        children.splice(index, 1);
                    }
                    children.push(item);
                }},
                querySelector: () => children.find(item => item.classList.contains("toolbar__icon--active")),
            },
            lastElementChild: {append: (): void => undefined},
        };
    };
    const left = panel();
    const right = panel();
    let closed = 0;
    let aiDisabled = false;
    const moduleExports = {} as {renderMobileSidePanelLayout: (app: unknown, config: unknown) => void};
    const compiled = transpileModule(readFileSync("src/mobile/util/initFramework.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    runInNewContext(compiled, {
        exports: moduleExports,
        CSS: {escape: (value: string) => value},
        window: {siyuan: {config: {readonly: false}, isPublish: false}},
        document: {
            getElementById: (id: string) => id === "sidebar" ? left : right,
            querySelectorAll: (): DockElement[] => [],
            querySelector: (selector: string) => {
                const type = selector.match(/sidebar-(.*?)(-tab)?"/);
                return (type[2] ? tabs : contents).get(type[1] as typeof MOBILE_SIDE_PANEL_DOCK_IDS[number]);
            },
        },
        require: () => ({
            normalizeMobileSidePanelConfig, MOBILE_SIDE_PANEL_DOCK_IDS,
            getMobilePluginDockEntries: (): unknown[] => [],
            getMobilePluginDockLayouts: (): unknown[] => [],
            isDisabledFeature: () => aiDisabled,
            closePanel: () => closed++,
        }),
    });
    const render = (hidden: string[]) => moduleExports.renderMobileSidePanelLayout({}, {
        ...createDefaultMobileSidePanelConfig(), hidden,
    });
    render([]);
    assert.equal(tabs.get("file").classList.contains("toolbar__icon--active"), true);
    render(["file", "inbox"]);
    assert.equal(tabs.get("file").classList.contains("fn__none"), true);
    assert.equal(contents.get("file").classList.contains("fn__none"), true);
    assert.equal(tabs.get("inbox").classList.contains("fn__none"), true);
    assert.equal(tabs.get("bookmark").classList.contains("toolbar__icon--active"), true);
    left.style.transform = "translateX(0px)";
    render([...MOBILE_SIDE_PANEL_DOCK_IDS]);
    assert.equal(closed, 1);
    assert.equal(left.style.transform, "");
    tabs.forEach(tab => assert.equal(tab.classList.contains("toolbar__icon--active"), false));
    contents.forEach(content => assert.equal(content.classList.contains("fn__none"), true));
    aiDisabled = true;
    render([]);
    assert.equal(tabs.get("file").classList.contains("fn__none"), false);
    assert.equal(tabs.get("file").classList.contains("toolbar__icon--active"), true);
    assert.equal(tabs.get("agent").classList.contains("fn__none"), true);
    aiDisabled = false;
    render([]);
    assert.equal(tabs.get("agent").classList.contains("fn__none"), false);
});
