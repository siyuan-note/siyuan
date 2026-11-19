import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {compile} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "./test/browser";

test("native pointer activation completes before month editing changes the anchored layout", {timeout: 45000, skip: !canRunBrowser}, async () => {
    const files = Object.fromEntries(["model", "yearInput", "field", "runtime", "owners", "binding", "position", "index"]
        .map(name => [name, join(__dirname, name + ".ts")]));
    const sources = browserSources({...files, menuPosition: join(__dirname, "../menus/menuPosition.ts"),
        dialog: join(__dirname, "../dialog/index.ts"), overlayOwnership: join(__dirname, "../menus/overlayOwnership.ts")});
    const css = readFileSync(join(__dirname, "../../appearance/themes/daylight/theme.css"), "utf8") +
        compile(join(__dirname, "../assets/scss/base.scss"), {logger: {warn() {}}}).css;
    assert.match(await runBrowserCase(async (sources, css) => {
        const style = document.createElement("style"); style.textContent = css; document.head.append(style);
        const modules: Record<string, any> = {};
        let uuid = 0;
        const fallback = {genUUID: () => String(++uuid), getZIndex: () => 0, isAbove: () => false, isMobile: () => false,
            isNotCtrl: () => true, moveResize() {}, Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0},
            destroyDialogBlockPanels() {}, getDialogBlockPanel() {}, getAnchoredInputMask() {}};
        const load = (name: string) => {
            const exports = modules[name] ||= {};
            new Function("exports", "require", sources[name])(exports, (path: string) => modules[path.split("/").at(-1)] || fallback);
            return exports;
        };
        const languages = {date: "Date", datePickerTime: "Time", month: "Month", year: "Year", previous: "Previous", next: "Next",
            calendarToday: "Today", clear: "Clear", confirm: "Confirm", cancel: "Cancel", invalid: "Invalid"};
        const menu = document.createElement("div"); document.body.append(menu);
        const state = window as any;
        state.siyuan = {dialogs: [], zIndex: 10, config: {}, languages, menus: {menu: {element: menu, remove() {}}}};
        ["overlayOwnership", "dialog", "model", "yearInput", "field", "runtime", "owners", "menuPosition", "position"].forEach(load);
        modules.panel = {registerDatePickerWindow() {}}; modules.index = {}; load("binding"); const api = load("index");
        modules.runtime.registerDatePickerRuntime(document, (options: unknown) => new modules.dialog.Dialog(options), () => languages);
        const owner = document.createElement("input"); owner.type = "date";
        owner.style.cssText = "position:fixed;left:100px;width:180px;height:28px"; document.body.append(owner);
        state.openCase = (top: number, draft: string, autoConfirm: boolean) => {
            owner.style.top = top + "px"; owner.focus(); state.result = undefined; state.resolutions = 0;
            const handle = api.openInternalDatePicker({ownerElement: owner, type: "date", value: "2024-02-28", locale: "en-US", autoConfirm});
            handle.result.then((value: unknown) => { state.result = value; state.resolutions++; });
            state.root = state.siyuan.dialogs.at(-1).element;
            state.root.querySelector(".date-picker__month-toggle").click();
            state.year = state.root.querySelector(".date-picker__month-editor input");
            if (draft) { state.year.value = draft; state.year.dispatchEvent(new InputEvent("input", {bubbles: true, data: draft})); }
            state.close = () => handle.destroy();
        };
        state.inspect = () => ({result: state.result, resolutions: state.resolutions,
            value: state.root.querySelector(".date-picker__fields input")?.value,
            caption: state.root.querySelector("caption")?.textContent, year: state.year.value,
            activeOwner: document.activeElement === owner, today: modules.model.formatDate(modules.model.localToday())});
        return "ready";
    }, sources, css, {width: 900, height: 700, interact: async win => {
        const run = (source: string) => win.webContents.executeJavaScript(source);
        const tick = (time = 60) => new Promise<void>(resolve => setTimeout(resolve, time));
        const click = async (selector: string) => {
            const point = await run(`(()=>{const r=root.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
            win.webContents.sendInputEvent({type: "mouseMove", ...point});
            win.webContents.sendInputEvent({type: "mouseDown", button: "left", clickCount: 1, ...point});
            await tick(200);
            win.webContents.sendInputEvent({type: "mouseUp", button: "left", clickCount: 1, ...point});
            await tick();
        };
        const equal = (actual: unknown, expected: unknown, message: string) => {
            if (JSON.stringify(actual) !== JSON.stringify(expected)) { throw new Error(message + ": " + JSON.stringify({actual, expected})); }
        };
        for (const top of [40, 650]) {
            for (const draft of ["", "2030"]) {
                await run(`openCase(${top},${JSON.stringify(draft)},true)`); await tick();
                const selected = draft ? "2030-02-28" : "2024-02-29";
                await click(`[data-date="${selected}"]`);
                const state = await run("inspect()");
                equal(state.result?.value, selected, "Pointer selects the displayed date including a live year preview");
                equal(state.resolutions, 1, "Date selection resolves exactly once");
                equal(state.activeOwner, true, "Selection restores owner focus");
            }
            for (const action of ["today", "clear", "next", "confirm", "confirm-preview", "cancel"]) {
                await run(`openCase(${top},"${action === "confirm-preview" ? "2030" : ""}",${action === "today" || action === "clear"})`); await tick();
                const selector = action === "today" ? ".date-picker__navigation > button:nth-child(2)" :
                    action === "clear" ? '[data-action="clear"]' : action === "next" ? '[aria-label="Next"]' :
                        `[data-action="${action === "confirm-preview" ? "confirm" : action}"]`;
                await click(selector);
                const state = await run("inspect()");
                if (action === "next") {
                    equal(state.caption, "March 2024", "Next activates on the first press");
                    equal(state.value, "2024-02-28", "Month navigation does not commit a date");
                    await run("close()");
                } else {
                    equal(state.result?.type, action === "cancel" ? "cancel" : "confirm", action + " activates on the first press");
                    equal(state.resolutions, 1, action + " resolves once");
                    if (action !== "cancel") {
                        equal(state.result.value, action === "today" ? state.today : action === "clear" ? "" : "2024-02-28",
                            action + " preserves its saving semantics");
                    }
                }
            }
        }
        await run('openCase(40,"2030",false)'); await tick();
        win.webContents.sendInputEvent({type: "keyDown", keyCode: "Tab"});
        win.webContents.sendInputEvent({type: "keyUp", keyCode: "Tab"}); await tick();
        equal(await run('root.querySelector(".date-picker__month-toggle").getAttribute("aria-expanded")'), "false",
            "Keyboard Tab leaving the editor collapses it");
        equal(await run('document.activeElement.dataset.date?.startsWith("2030-")'), true, "Tab reaches the displayed year calendar");
        equal((await run("inspect()")).value, "2024-02-28", "Tab commits browsing without selecting a date");
        await run("close()");
        return "Native date picker pointer activation passed";
    }}), /Native date picker pointer activation passed/);
});
