import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {compile} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "../../datePicker/test/browser";

test("tag panels virtualize the complete tree and reorder only siblings", {timeout: 100000, skip: !canRunBrowser}, async t => {
    const sources = browserSources({
        TagTree: join(__dirname, "TagTree.ts"),
        tagFilter: join(__dirname, "tagFilter.ts"),
        DocTreeModel: join(__dirname, "docTree/DocTreeModel.ts"),
        escape: join(__dirname, "../../util/escape.ts"),
        treeItemTail: join(__dirname, "../../util/treeItemTail.ts"),
        touchDragBridge: join(__dirname, "../../util/touchDragBridge.ts"),
        touchDragBridgeCore: join(__dirname, "../../util/touchDragBridgeCore.ts"),
        tagSortMenu: join(__dirname, "tagSortMenu.ts"),
    });
    const stylesheet = (file: string) => compile(join(__dirname, "../../assets/scss", file), {logger: {warn() {}}}).css;
    const baseCSS = stylesheet("base.scss");
    const mobileCSS = stylesheet("mobile.scss");

    for (const mobile of [false, true]) {
        await t.test(mobile ? "mobile touch" : "desktop mouse", async () => {
            const theme = mobile ? "midnight" : "daylight";
            const css = readFileSync(join(__dirname, "../../../appearance/themes", theme, "theme.css"), "utf8") +
                baseCSS + (mobile ? mobileCSS : "");
            const result = await runBrowserCase(async (sources, css) => {
                const mobile = sources.platform === "mobile";
                const style = document.createElement("style");
                style.textContent = css;
                document.head.append(style);
                const shell = document.createElement("div");
                shell.className = mobile ? "b3-list--mobile" : "file-tree";
                const panel = document.createElement("section");
                panel.style.height = "204px";
                panel.style.width = mobile ? "260px" : "460px";
                const input = document.createElement("input");
                shell.append(input, panel);
                document.body.append(shell);

                function tag(label: string, children: IBlockTree[] = []): IBlockTree {
                    return {name: label.split("/").at(-1), label, children, type: "tag", depth: label.split("/").length - 1, count: 1};
                }
                const project = tag("Project", [tag("Project/A"), tag("Project/B")]);
                const data = [project, ...Array.from({length: 1000}, (_, i) => tag("Tag " + String(i).padStart(4, "0")))];
                const requests: unknown[] = [];
                const activated: string[] = [];
                let full = true;
                const modules: Record<string, unknown> = {
                    constants: {Constants: {SIYUAN_APPID: "test", SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 460,
                        SIYUAN_DROP_GUTTER: "gutter"}, TAG_SORT_MANUAL: 6, TAG_SORT_CREATED_DESC: 11},
                    dragover: {stopScrollAnimation() {}},
                    compatibility: {isInAndroid: () => false, isInHarmony: () => false},
                    functions: {isMobile: () => mobile},
                    gutterVisibility: {setGutterTouchDragging() {}},
                    electron: {ipcRenderer: {on() {}}},
                    types: {},
                    fetch: {fetchSyncPost: async (url: string, request: {ignoreMaxListHint?: boolean; label?: string; target?: string; position?: string}) => {
                        if (url === "/api/tag/getTag") {
                            full = full && request.ignoreMaxListHint === true;
                            return {code: 0, data: structuredClone(data)};
                        }
                        requests.push(request);
                        const group = project.children;
                        const source = group.findIndex(row => row.label === request.label);
                        const moved = group.splice(source, 1)[0];
                        const target = group.findIndex(row => row.label === request.target);
                        group.splice(target + (request.position === "after" ? 1 : 0), 0, moved);
                        return {code: 0, data: null};
                    }},
                };
                const load = (name: string) => {
                    const module = {exports: {}};
                    new Function("require", "exports", sources[name])((path: string) => modules[path.split("/").at(-1)], module.exports);
                    modules[name] = module.exports;
                    return module.exports;
                };
                Object.assign(window, {
                    siyuan: {config: {tag: {sort: 6}, readonly: false}, zIndex: 100,
                        languages: {customSort: "Custom Sorting", emptyContent: "Empty"}},
                    Lute: {UnEscapeHTMLStr: (value: string) => value},
                });
                ["tagFilter", "DocTreeModel", "escape", "treeItemTail"].forEach(load);
                if (mobile) {
                    load("touchDragBridgeCore");
                    (load("touchDragBridge") as typeof import("../../util/touchDragBridge")).initTouchDragBridge();
                }
                const menuItems: IMenu[] = [];
                modules.Menu = {MenuItem: class {
                    public element: IMenu;
                    constructor(item: IMenu) { this.element = item; }
                }};
                Object.assign(window.siyuan, {menus: {menu: {append: (item: IMenu) => menuItems.push(item)}}});
                (load("tagSortMenu") as typeof import("./tagSortMenu")).appendTagSortMenu(() => {});
                const checkedSort = menuItems.filter(item => item.checked).map(item => item.label);
                const leadingCheck = menuItems.some(item => item.icon === "iconSelect");
                const {TagTree} = load("TagTree") as typeof import("./TagTree");
                const tree = new TagTree({element: panel, input, mobile, open: label => activated.push(label), menu() {}, setLoading() {}});
                const waitForPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const row = (label: string) => panel.querySelector<HTMLElement>("li[data-label=" + JSON.stringify(label) + "]");
                await tree.update();
                await waitForPaint();
                const firstCount = panel.querySelectorAll("li").length;
                const toggle = row("Project").querySelector<HTMLElement>(".b3-list-item__toggle");
                let clickedInsidePanel = false;
                shell.addEventListener("click", event => { clickedInsidePanel = panel.contains(event.target as Node); }, {once: true});
                toggle.click();
                const collapsed = !row("Project/A") && !toggle.querySelector(".b3-list-item__arrow--open");
                input.value = "Project/B";
                tree.filter();
                const filtered = !!row("Project/B") && !panel.querySelector('[draggable="true"]');
                input.value = "";
                tree.filter();
                const restored = !row("Project/A");
                toggle.click();
                const expanded = !!row("Project/A") && !!toggle.querySelector(".b3-list-item__arrow--open");
                panel.scrollTop = panel.scrollHeight;
                await waitForPaint();
                const last = !!row("Tag 0999");
                const lastCount = panel.querySelectorAll("li").length;
                panel.scrollTop = 0;
                await waitForPaint();
                row("Project/A").querySelector<HTMLElement>(".b3-list-item__text").click();

                Object.assign(window, {tagTest: {
                    points(target: string) {
                        const source = row("Project/B").querySelector(".b3-list-item__text").getBoundingClientRect();
                        const destination = row(target).getBoundingClientRect();
                        return {start: {x: source.x + source.width / 2, y: source.y + source.height / 2},
                            end: {x: destination.x + destination.width / 2, y: destination.y + destination.height / 4}};
                    },
                    indicator: () => panel.querySelector("li.dragover__top")?.getAttribute("data-label"),
                    dragging: () => panel.classList.contains("tag-tree--dragging"),
                    async snapshot() {
                        await tree.update();
                        const order = Array.from(panel.querySelectorAll("li[data-label]")).slice(0, 3).map(item => item.getAttribute("data-label"));
                        window.siyuan.config.readonly = true;
                        await tree.update();
                        const readOnly = !panel.querySelector('[draggable="true"]');
                        return {full, firstCount, collapsed, clickedInsidePanel, expanded, filtered, restored, last, lastCount, activated, requests, order,
                            readOnly, checkedSort, leadingCheck};
                    }
                }});
                return "ready";
            }, {...sources, platform: mobile ? "mobile" : "desktop"}, css, {
                width: mobile ? 360 : 640,
                height: 440,
                interact: async win => {
                    const mobile = await win.webContents.executeJavaScript("document.querySelector('.b3-list--mobile') !== null");
                    const {debugger: driver} = win.webContents;
                    if (mobile) {
                        await driver.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: true, maxTouchPoints: 1});
                    }
                    const drag = async (target: string) => {
                        const {start, end} = await win.webContents.executeJavaScript("tagTest.points(" + JSON.stringify(target) + ")");
                        if (mobile) {
                            await driver.sendCommand("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [{...start, id: 1}]});
                            await new Promise(resolve => setTimeout(resolve, 500));
                            await driver.sendCommand("Input.dispatchTouchEvent", {type: "touchMove", touchPoints: [{...end, id: 1}]});
                        } else {
                            await driver.sendCommand("Input.dispatchMouseEvent", {type: "mouseMoved", ...start});
                            await driver.sendCommand("Input.dispatchMouseEvent", {type: "mousePressed", ...start, button: "left", buttons: 1, clickCount: 1});
                            await driver.sendCommand("Input.dispatchMouseEvent", {type: "mouseMoved", x: start.x + 12, y: start.y, button: "left", buttons: 1});
                            await driver.sendCommand("Input.dispatchMouseEvent", {type: "mouseMoved", ...end, button: "left", buttons: 1});
                        }
                        const indicator = await win.webContents.executeJavaScript("tagTest.indicator() || ''");
                        const dragging = await win.webContents.executeJavaScript("tagTest.dragging()");
                        if (mobile) {
                            await driver.sendCommand("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
                        } else {
                            await driver.sendCommand("Input.dispatchMouseEvent", {type: "mouseReleased", ...end, button: "left", clickCount: 1});
                        }
                        const settled = !await win.webContents.executeJavaScript("tagTest.dragging()");
                        return {indicator, dragging, settled};
                    };
                    const crossGroup = await drag("Project");
                    const sibling = await drag("Project/A");
                    const report = await win.webContents.executeJavaScript("tagTest.snapshot()");
                    return JSON.stringify({...report, crossGroup, sibling});
                },
            });
            const report = JSON.parse(result.trim());
            assert.equal(report.full, true);
            assert.equal(report.collapsed && report.clickedInsidePanel && report.expanded, true);
            assert.equal(report.filtered && report.restored, true);
            assert.equal(report.last, true);
            assert.ok(report.firstCount < 35 && report.lastCount < 35);
            assert.deepEqual(report.activated, ["Project/A"]);
            assert.deepEqual(report.requests, [{label: "Project/B", target: "Project/A", position: "before"}]);
            assert.deepEqual(report.order, ["Project", "Project/B", "Project/A"]);
            assert.deepEqual(report.crossGroup, {indicator: "", dragging: true, settled: true});
            assert.deepEqual(report.sibling, {indicator: "Project/A", dragging: true, settled: true});
            assert.equal(report.readOnly, true);
            assert.deepEqual(report.checkedSort, ["Custom Sorting"]);
            assert.equal(report.leadingCheck, false);
        });
    }
});
