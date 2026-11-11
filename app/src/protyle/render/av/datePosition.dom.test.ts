import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {compile} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "../../../datePicker/test/browser";

for (const theme of ["daylight", "midnight"]) {
for (const [width, height, mobile] of [[1536, 825, false], [400, 600, false], [320, 400, false], [320, 400, true]] as const) {
    test(`date panel expansion and cleanup at ${width}x${height}, mobile=${mobile}, theme=${theme}`, {
        timeout: 45000, skip: !canRunBrowser,
    }, async () => {
        const sources = browserSources(Object.fromEntries([
            ["model", "../../../datePicker/model.ts"], ["yearInput", "../../../datePicker/yearInput.ts"],
            ["field", "../../../datePicker/field.ts"], ["inline", "../../../datePicker/inline.ts"],
            ["lunarCalendar", "lunarCalendar.ts"], ["dateFormat", "dateFormat.ts"], ["lunarDate", "lunarDate.ts"],
            ["dateSubmit", "dateSubmit.ts"], ["date", "date.ts"], ["datePanel", "panels/date.ts"],
            ["datePosition", "datePosition.ts"], ["setPosition", "../../../util/setPosition.ts"],
        ].map(([name, path]) => [name, join(__dirname, path)])));
        sources.dayjs = readFileSync(require.resolve("dayjs"), "utf8");
        sources.languages = readFileSync("appearance/langs/zh-CN.json", "utf8");
        sources.mobile = String(mobile);
        sources.icons = readFileSync("appearance/icons/litheness/icon.js", "utf8");
        sources.lunarData = readFileSync("../kernel/av/lunar_calendar_data.json", "utf8");
        const css = readFileSync(`appearance/themes/${theme}/theme.css`, "utf8") +
            compile("src/assets/scss/base.scss", {logger: {warn() {}}}).css;
        const result = await runBrowserCase(async (source, stylesheet) => {
            const ok = (value: boolean, message: string) => { if (!value) { throw Error(message); } };
            const tick = () => new Promise(resolve => setTimeout(resolve, 80));
            const mobile = source.mobile === "true";
            const style = document.createElement("style"); style.textContent = stylesheet; document.head.append(style);
            document.documentElement.lang = "zh-CN";
            if (innerWidth === 400) { document.documentElement.style.setProperty("--b3-font-size", "24px"); }
            document.documentElement.dataset.frontend = mobile ? "browser-mobile" : "desktop-window";
            Object.assign(window, {siyuan: {languages: JSON.parse(source.languages)}});
            new Function(source.icons)();
            const observers = new Set<ResizeObserver>();
            const NativeObserver = ResizeObserver;
            window.ResizeObserver = class extends NativeObserver {
                observe(target: Element) { observers.add(this); super.observe(target); }
                disconnect() { observers.delete(this); super.disconnect(); }
            };
            const initial = {content: new Date(2026, 1, 10).getTime(), content2: 0,
                isNotEmpty: true, isNotEmpty2: false, hasEndDate: false, isNotTime: true};
            const dayjs = {exports: {}};
            new Function("module", "exports", source.dayjs)(dayjs, dayjs.exports);
            let writes = 0;
            const fallback = {isMobile: () => mobile, getTopBarHeight: () => 32, getColId: () => "date",
                escapeHtml: String, escapeAttr: String, getFieldsByData: (): unknown[] => [], genCellValueByElement: () => ({date: initial}), updateCellsValue: () => writes++};
            const modules: Record<string, any> = {dayjs: dayjs.exports, "lunar_calendar_data.json": JSON.parse(source.lunarData)};
            for (const name of ["model", "yearInput", "field", "inline", "dateSubmit", "lunarCalendar", "dateFormat", "lunarDate", "date", "setPosition", "datePosition", "datePanel"]) {
                const exports = modules[name] = {};
                new Function("exports", "require", source[name])(exports, (path: string) => modules[path.split("/").at(-1)] || fallback);
            }
            const cell = document.createElement("div"); document.body.append(cell);
            cell.style.cssText = `position:fixed;left:${innerWidth - 180}px;top:${innerHeight - 300}px;height:24px;width:120px`;
            const panel = document.createElement("div"); panel.className = "av__panel"; document.body.append(panel);
            const menu = document.createElement("div"); menu.className = "b3-menu"; panel.append(menu);
            if (mobile) {
                menu.classList.add("b3-menu--fullscreen", "b3-menu--sheet");
                menu.style.cssText = "top:0;height:100%;max-height:100%;transform:none";
            }
            const context: any = {options: {cellElements: [cell], requireExplicitChange: true}, data: {}, fields: [],
                menuElement: menu, avPanelElement: panel, cellRect: cell.getBoundingClientRect()};
            const mount = () => {
                menu.innerHTML = modules.date.getDateHTML([cell], context.fields[0]?.dateFormat);
                modules.datePanel.datePanel.bind(context);
            };
            mount(); await tick();
            const inputs = menu.querySelectorAll<HTMLInputElement>("input:not([data-date-picker-part])");
            let items = menu.querySelector<HTMLElement>(".b3-menu__items");
            const check = (step: string) => {
                const rect = menu.getBoundingClientRect();
                ok(rect.top >= (mobile ? 0 : 32) - 1 && rect.bottom <= innerHeight + 1, step + " vertical fit");
                ok(rect.left >= -1 && rect.right <= innerWidth + 1, step + " horizontal fit");
                items.scrollTop = items.scrollHeight;
                const clear = menu.querySelector('[data-type="clearDate"]').getBoundingClientRect();
                ok(clear.bottom <= rect.bottom + 1 && clear.top >= rect.top, step + " clear reachable by scrolling");
                items.scrollTop = 0;
            };
            check("initial");
            if (!mobile) { ok(Math.abs(menu.getBoundingClientRect().width - 260) <= 1, "compact desktop width is explicit"); }
            const calendar = menu.querySelector(".date-picker__calendar").getBoundingClientRect();
            ok(calendar.width <= (mobile ? 320 : 244), "inline calendar width is bounded");
            for (const button of menu.querySelectorAll<HTMLElement>(".date-picker__calendar button")) {
                ok(button.getBoundingClientRect().height >= (mobile ? 44 : 28), "day touch target");
            }
            for (const button of menu.querySelectorAll<HTMLElement>(".date-picker__navigation .block__icon")) {
                const rect = button.getBoundingClientRect();
                ok(rect.width >= (mobile ? 44 : 24) && rect.height >= (mobile ? 44 : 24), "navigation target");
                const svg = button.querySelector("svg").getBoundingClientRect();
                ok(svg.width > 0 && svg.height > 0, "real navigation icon remains visible");
            }
            for (let cycle = 0; cycle < 2; cycle++) {
                inputs[2].click(); await tick(); check("range");
                inputs[3].click(); await tick(); check("time");
                for (const split of menu.querySelectorAll<HTMLElement>(".date-picker__split")) {
                    const pair = Array.from(split.querySelectorAll<HTMLInputElement>("input"));
                    const [dateRect, timeRect] = pair.map(input => input.getBoundingClientRect());
                    ok(Math.abs(dateRect.width - timeRect.width) <= 1, "date and time inputs have equal widths");
                    ok(Math.abs(parseFloat(getComputedStyle(split).gap) - 8) <= 1, "split inputs retain an eight pixel gap");
                    const inputStyle = getComputedStyle(pair[0]);
                    const canvas = document.createElement("canvas");
                    const context = canvas.getContext("2d");
                    context.font = inputStyle.font;
                    const textWidth = context.measureText("2026-12-31").width;
                    ok(pair[0].clientWidth - parseFloat(inputStyle.paddingLeft) - parseFloat(inputStyle.paddingRight) >= textWidth,
                        "date text fits without horizontal clipping");
                    if (Math.abs(dateRect.top - timeRect.top) <= 1) {
                        ok(Math.abs(timeRect.left - dateRect.right - 8) <= 1, "side by side inputs have the requested gap");
                    } else {
                        ok(Math.abs(dateRect.left - timeRect.left) <= 1, "wrapped inputs remain aligned");
                    }
                }
                inputs[1].focus(); await tick(); check("end focus");
                const endpoint = menu.querySelector(".date-picker__endpoint > span").getBoundingClientRect();
                const toggle = inputs[2].parentElement.firstElementChild.getBoundingClientRect();
                ok(Math.abs(endpoint.left - toggle.left) <= 1, "endpoint and menu row labels align");
                menu.querySelector<HTMLButtonElement>(".date-picker__month-toggle").click(); await tick(); check("year editor");
                const year = menu.querySelector<HTMLInputElement>(".date-picker__month-editor input");
                year.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
                inputs[3].click(); inputs[2].click(); await tick(); check("collapsed");
            }
            for (const top of [40, innerHeight / 2, innerHeight - 24]) {
                cell.style.top = top + "px";
                window.dispatchEvent(new Event("resize")); await tick(); check("changed anchor");
            }
            ok(writes === 0, "layout changes do not submit before closing");
            context.closeCB();
            ok(observers.size === 0, "close releases positioning observer");
            context.fields = [{id: "date", dateFormat: "lunar"}];
            mount(); await tick();
            items = menu.querySelector<HTMLElement>(".b3-menu__items");
            check("lunar initial");
            menu.querySelector<HTMLInputElement>("[data-lunar-end]").click(); await tick(); check("lunar range");
            menu.querySelector<HTMLInputElement>("[data-lunar-include-time]").click(); await tick(); check("lunar time");
            panel.remove(); await tick();
            ok(observers.size === 0, "direct removal releases positioning observer");
            document.body.append(panel);
            context.fields = []; mount(); await tick();
            items = menu.querySelector<HTMLElement>(".b3-menu__items");
            const baselineWrites = writes;
            Object.assign(window, {datePanelQA: {menu, panel, check,
                inspect: () => ({top: menu.getBoundingClientRect().top, writes: writes - baselineWrites,
                    date: menu.querySelector<HTMLInputElement>("input").value}),
                close: () => { context.closeCB(); panel.remove(); },
                disposed: () => observers.size === 0}});
            return "date positioning passed";
        }, sources, css, {width, height, interact: async win => {
            const run = (script: string) => win.webContents.executeJavaScript(script);
            const assert = require("node:assert/strict");
            const tick = () => new Promise(resolve => setTimeout(resolve, 100));
            const before = await run("datePanelQA.inspect()");
            for (const index of [2, 3]) {
                const p = await run(`(() => {const input = datePanelQA.menu.querySelectorAll('input:not([data-date-picker-part])')[${index}];
                    input.scrollIntoView({block:'nearest'}); const r = input.getBoundingClientRect();
                    return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
                const top = (await run("datePanelQA.inspect()")).top;
                win.webContents.sendInputEvent({type: "mouseMove", ...p});
                win.webContents.sendInputEvent({type: "mouseDown", button: "left", clickCount: 1, ...p});
                await tick();
                assert.equal((await run("datePanelQA.inspect()")).top, top, "No reflow while toggle pointer is held");
                win.webContents.sendInputEvent({type: "mouseUp", button: "left", clickCount: 1, ...p});
                await tick();
                const after = await run("datePanelQA.inspect()");
                assert.equal(after.writes, 0, "Toggle release does not click clear or submit");
                assert.equal(after.date.substring(0, 10), before.date.substring(0, 10), "Toggle release does not select a shifted calendar day");
                assert.equal(await run(`datePanelQA.menu.querySelectorAll('input:not([data-date-picker-part])')[${index}].checked`), true);
                await run("datePanelQA.check('pointer expansion')");
            }
            win.setContentSize(320, 400); await tick();
            await run("datePanelQA.check('window shrink')");
            win.setContentSize(800, 825); await tick();
            await run("datePanelQA.check('window restore')");
            await run("datePanelQA.close()"); await tick();
            assert.equal(await run("datePanelQA.disposed()"), true);
            return "date positioning passed";
        }});
        assert.match(result, /date positioning passed/);
    });
}
}
