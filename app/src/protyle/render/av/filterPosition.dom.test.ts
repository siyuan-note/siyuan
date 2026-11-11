import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {compile} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "../../../datePicker/test/browser";

for (const width of [400, 800]) {
    test(`date filters reposition their existing hosts after pointer and keyboard expansion at ${width}px`, {
        timeout: 45000, skip: !canRunBrowser,
    }, async () => {
        const sources = {...browserSources(Object.fromEntries([
            ["model", "../../../datePicker/model.ts"], ["yearInput", "../../../datePicker/yearInput.ts"],
            ["field", "../../../datePicker/field.ts"], ["inline", "../../../datePicker/inline.ts"],
            ["capabilities.generated", "capabilities.generated.ts"], ["capabilities", "capabilities.ts"],
            ["filterTree", "filterTree.ts"], ["filter", "filter.ts"],
            ["setPosition", "../../../util/setPosition.ts"], ["automationPosition", "automationPosition.ts"], ["filters", "panels/filters.ts"],
            ["automationTemplateFunctions", "automationTemplateFunctions.ts"], ["automation", "automation.ts"],
            ["conditionalColorMenu", "conditionalColorMenu.ts"],
        ].map(([name, path]) => [name, join(__dirname, path)]))),
        languages: readFileSync("appearance/langs/de.json", "utf8"),
        icons: readFileSync("appearance/icons/litheness/icon.js", "utf8")};
        const css = readFileSync("appearance/themes/daylight/theme.css", "utf8") +
            compile("src/assets/scss/base.scss", {logger: {warn() {}}}).css;
        const result = await runBrowserCase(async (source, stylesheet) => {
            const style = document.createElement("style"); style.textContent = stylesheet; document.head.append(style);
            new Function(source.icons)();
            document.documentElement.style.setProperty("--b3-font-size", "24px");
            const state = window as any;
            state.siyuan = {languages: JSON.parse(source.languages), config: {}, menus: {menu: {remove() {}}}};
            state.transactions = 0;
            state.positions = 0;
            const observers = new Set<ResizeObserver>();
            const NativeObserver = window.ResizeObserver;
            window.ResizeObserver = class extends NativeObserver {
                observe(target: Element) { observers.add(this); super.observe(target); }
                disconnect() { observers.delete(this); super.disconnect(); }
            };
            const dateFilter = () => ({column: "date", operator: "Is between", value: {type: "date"}});
            const database = {id: "database", name: "Database", viewID: "view", keyValues: [
                {key: {id: "date", name: "Voraussichtliches Fertigstellungsdatum", type: "date"}},
            ], automations: {spec: 1, rules: [{id: "rule", name: "Date rule", enabled: false, trigger: "update",
                conditions: [dateFilter()], actions: [{type: "edit", target: "filtered", avID: "database",
                    filters: [dateFilter()], fields: {}}]}]}};
            const modules: Record<string, any> = {};
            const fallback = {getTopBarHeight: () => 0, isMobile: () => false};
            const stubs: Record<string, any> = {
                "./view": {getFieldsByData: (data: any) => data.view.columns},
                "./col": {getColIconByType: () => "iconCalendar"},
                "../../../util/escape": {escapeHtml: String, escapeAttr: String},
                "../../wysiwyg/transaction": {transaction: () => { state.transactions++; }},
                "../../../util/fetch": {fetchSyncPost: async () => ({code: 0, data: {av: database}})},
                "./conditionalColor": {getConditionalBackground: () => ""},
                "./filterDropdown": {closeInlineFilterDropdowns() {}},
            };
            for (const name of Object.keys(source).filter(name => name !== "languages" && name !== "icons")) {
                const exports = modules[name] = {};
                new Function("exports", "require", source[name])(exports, (path: string) =>
                    stubs[path] || modules[path.split("/").at(-1)] || fallback);
            }
            const setPosition = modules.setPosition.setPosition;
            modules.setPosition.setPosition = (...args: any[]) => { state.positions++; setPosition(...args); };
            state.openCase = async (kind: string) => {
                state.panel?.remove();
                const panel = document.createElement("div"); panel.className = "av__panel";
                const menu = document.createElement("div"); menu.className = "b3-menu";
                panel.append(menu); document.body.append(panel);
                state.panel = panel; state.menu = menu;
                const anchor = {right: innerWidth - 16, bottom: 560, height: 24} as DOMRect;
                const position = () => {
                    if (kind === "automation") { modules.automationPosition.setAutomationMenuPosition(menu, anchor); }
                    else { modules.setPosition.setPosition(menu, anchor.right - menu.clientWidth, anchor.bottom, anchor.height, 0, true); }
                };
                const data: any = {id: "database", viewID: "view", viewType: "table", view: {
                    columns: database.keyValues.map(item => item.key), filters: [dateFilter()],
                    conditionalColors: [{id: "color-rule", target: "item", color: null, matchOption: false, filter: dateFilter()}],
                }};
                const options = {protyle: {options: {}}, blockElement: {dataset: {nodeId: "carrier"}},
                    avID: "database", data, menuElement: menu, onResize: position};
                if (kind === "view") {
                    menu.classList.add("av__filter-panel"); menu.innerHTML = modules.filter.getFiltersHTML(data);
                    position();
                    modules.filters.filtersPanel.bind({avPanelElement: panel, menuElement: menu, data,
                        avID: "database", blockID: "carrier", tabRect: anchor, options: {protyle: {}}});
                } else if (kind === "color") { await modules.conditionalColorMenu.openConditionalColorsMenu(options); }
                else { await modules.automation.openAutomationMenu(options); }
                state.input = menu.querySelector('[data-type="absDate"]');
                state.beforeTop = menu.getBoundingClientRect().top;
                state.transactions = 0;
            };
            state.inspect = () => ({top: state.menu.getBoundingClientRect().top, bottom: state.menu.getBoundingClientRect().bottom,
                positions: state.positions, transactions: state.transactions, observers: observers.size,
                active: document.activeElement === state.input, calendars: state.menu.querySelectorAll(".date-picker--inline").length});
            state.checkReachable = () => {
                const menu = state.menu as HTMLElement;
                const rect = menu.getBoundingClientRect();
                if (rect.top < 0 || rect.bottom > innerHeight + 1 || rect.left < 0 || rect.right > innerWidth + 1) {
                    throw new Error("Menu leaves the viewport: " + JSON.stringify(state.inspect()));
                }
                const buttons = menu.querySelectorAll<HTMLElement>("[data-date]:not(:disabled), [data-type=addFilterCondition], [data-type=removeFilters], [data-action=add], [data-add-condition]");
                for (const button of buttons) {
                    button.scrollIntoView({block: "nearest", inline: "nearest"});
                    const r = button.getBoundingClientRect();
                    const target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                    if (target !== button && !button.contains(target)) { throw new Error("Date or action is unreachable: " + button.outerHTML); }
                }
                return true;
            };
            return "ready";
        }, sources, css, {width, height: 800, interact: async win => {
            const run = (source: string) => win.webContents.executeJavaScript(source);
            const tick = () => new Promise<void>(resolve => setTimeout(resolve, 150));
            const equal = (actual: unknown, expected: unknown, message: string) => {
                if (actual !== expected) { throw new Error(`${message}: ${actual} !== ${expected}`); }
            };
            const point = (selector: string) => run(`(()=>{const button=menu.querySelector(${JSON.stringify(selector)});button.scrollIntoView({block:"nearest"});const r=button.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
            const down = (p: {x: number, y: number}) => {
                win.webContents.sendInputEvent({type: "mouseMove", ...p});
                win.webContents.sendInputEvent({type: "mouseDown", button: "left", clickCount: 1, ...p});
            };
            const up = (p: {x: number, y: number}) => win.webContents.sendInputEvent({type: "mouseUp", button: "left", clickCount: 1, ...p});
            for (const kind of ["view", "color", "automation"]) {
                await run(`openCase(${JSON.stringify(kind)})`); await tick();
                const before = await run("inspect()");
                const p = await point('[data-type="absDate"]');
                down(p); await tick();
                const held = await run("inspect()");
                equal(held.top, before.top, kind + " does not move during the first press");
                equal(held.transactions, 0, kind + " pointer down does not save");
                up(p); await tick();
                const after = await run("inspect()");
                equal(after.transactions, 0, kind + " first click cannot select a moved calendar day");
                equal(after.active, true, kind + " first click focuses the original input");
                equal(after.calendars, 1, kind + " first click expands one calendar");
                equal(await run("checkReachable()"), true, kind + " expanded host stays reachable");
                const toggle = await point(".date-picker__month-toggle"); down(toggle); up(toggle); await tick();
                equal(await run("checkReachable()"), true, kind + " year editor growth stays reachable");
                equal((await run("inspect()")).transactions, 0, kind + " year browsing does not save");
                await run("panel.remove()"); await tick();
                equal((await run("inspect()")).observers, 0, kind + " detach releases local observers");

                await run(`openCase(${JSON.stringify(kind)})`); await tick();
                await run('menu.querySelector("[data-type=operation]").focus()');
                win.webContents.sendInputEvent({type: "keyDown", keyCode: "Tab"});
                win.webContents.sendInputEvent({type: "keyUp", keyCode: "Tab"}); await tick();
                equal((await run("inspect()")).active, true, kind + " Tab reaches the date input");
                equal(await run("checkReachable()"), true, kind + " keyboard expansion needs no pointer release");
                equal((await run("inspect()")).transactions, 0, kind + " keyboard focus does not save");
                await run("panel.remove()"); await tick();
                equal((await run("inspect()")).observers, 0, kind + " repeated open and close releases observers");
            }
            await run('openCase("view")');
            await run('input.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:7})); input.focus()'); await tick();
            const heldPositions = await run("inspect().positions");
            await run('document.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,pointerId:8}))'); await tick();
            equal((await run("inspect()")).positions, heldPositions, "an unrelated pointer cancellation does not move the menu");
            await run('window.dispatchEvent(new Event("blur"))'); await tick();
            equal((await run("inspect()")).positions, heldPositions + 1, "leaving the window releases a missing pointerup");
            equal(await run("checkReachable()"), true, "interrupted pointer expansion still fits its host");
            await run("panel.remove()"); await tick();
            equal((await run("inspect()")).observers, 0, "interrupted pointer listeners and observer are released");
            await run('openCase("view")');
            await run('input.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true})); input.focus()'); await tick();
            const pending = await run("inspect().positions");
            await run('document.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true})); panel.remove(); openCase("view")');
            const replacement = await run("inspect().positions"); await tick();
            equal((await run("inspect()")).positions, replacement, "a cancelled old frame cannot reposition a replacement menu");
            equal((await run("inspect()")).observers, 0, "cancellation and detachment release the observer");
            equal(replacement, pending + 1, "only the replacement's initial positioning ran");
            return "Filter host positioning passed";
        }});
        assert.match(result, /Filter host positioning passed/);
    });
}
