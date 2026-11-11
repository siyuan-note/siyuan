import * as assert from "node:assert/strict";
import {join} from "node:path";
import test from "node:test";
import {browserSources, canRunBrowser, runBrowserCase} from "./test/browser";

test("split datetime accepts native keyboard and clipboard input while keeping canonical values and calendar focus", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources(Object.fromEntries(["model", "yearInput", "field", "inline"].map(name => [name, join(__dirname, name + ".ts")])));
    const result = await runBrowserCase(async source => {
        const modules: Record<string, any> = {};
        for (const name of ["model", "yearInput", "field", "inline"]) {
            const exports = modules[name] = {};
            new Function("exports", "require", source[name])(exports, (path: string) => modules[path.split("/").at(-1)]);
        }
        document.body.innerHTML = '<input id="date" type="datetime-local" step="any" value="2026-11-11T09:35:27.123"><div id="calendar"></div>';
        const input = document.querySelector<HTMLInputElement>("#date");
        const host = document.querySelector<HTMLElement>("#calendar");
        const events: unknown[] = [];
        const binding = modules.inline.bindInlineDatePicker(host, input, {languages: {invalid: "Invalid", date: "Date", month: "Month", year: "Year"},
            onChange: (_input: unknown, state: unknown) => events.push(state)});
        Object.assign(window, {dateCase: {input, host, binding, events, ...modules.inline}});
        input.focus();
        const time = document.querySelector<HTMLInputElement>('[data-date-picker-part="time"]');
        Object.assign((window as any).dateCase, {time});
        if (input.value !== "2026-11-11" || time.value !== "09:35:27.123" || input.placeholder !== "YYYY-MM-DD" || time.placeholder !== "HH:mm") { throw Error("Separate initial date and time"); }
        input.setSelectionRange(0, 4, "backward");
        binding.update();
        if (input.selectionStart !== 0 || input.selectionEnd !== 4 || input.selectionDirection !== "backward") { throw Error("Update preserves selection"); }
        modules.inline.setInlineDateValue(input, "2026-11-12T10:45:27.123");
        if (input.selectionStart !== 0 || input.selectionEnd !== 4 || input.selectionDirection !== "backward") { throw Error("Changed date preserves selection"); }
        input.value = "2026-11-";
        input.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
        binding.update();
        if (input.value !== "2026-11-" || binding.validate()) { throw Error("IME draft preserved and blocked"); }
        input.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
        modules.inline.setInlineDateValue(input, "");
        input.focus();
        return "ready";
    }, sources, "", {interact: async win => {
        const {clipboard, ClipboardItem} = require("electron");
        const clipboardItems = await clipboard.read();
        const canRestoreClipboard = clipboardItems.every((item: import("electron").ClipboardItem) => item.types.length > 0);
        const originalClipboard = canRestoreClipboard ? await Promise.all(clipboardItems.map(async (item: import("electron").ClipboardItem) =>
            new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)])))))) : [];
        let writtenClipboard: string;
        try {
        const check = async (expression: string, message: string) => {
            for (let attempt = 0; attempt < 10; attempt++) {
                if (await win.webContents.executeJavaScript(expression)) { return; }
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            throw Error(message + ": " + await win.webContents.executeJavaScript("JSON.stringify({value:dateCase.input.value,active:document.activeElement?.outerHTML})"));
        };
        const clickDay = async (date: string) => {
            const point = await win.webContents.executeJavaScript(`(() => {const r=dateCase.host.querySelector('button[data-date="${date}"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
            win.webContents.sendInputEvent({type: "mouseMove", ...point});
            win.webContents.sendInputEvent({type: "mouseDown", button: "left", clickCount: 1, ...point});
            win.webContents.sendInputEvent({type: "mouseUp", button: "left", clickCount: 1, ...point});
        };
        for (const key of "2026-11-13") {
            win.webContents.sendInputEvent({type: "keyDown", keyCode: key});
            win.webContents.sendInputEvent({type: "char", keyCode: key});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: key});
        }
        await check('dateCase.input.value === "2026-11-13" && !dateCase.binding.validate()', "Half filled date cannot save");
        win.webContents.sendInputEvent({type: "keyDown", keyCode: "Tab"});
        win.webContents.sendInputEvent({type: "keyUp", keyCode: "Tab"});
        await check('document.activeElement === dateCase.time && dateCase.binding.isActive() && !dateCase.events.some(e=>e.kind === "change")', "Tab stays in the group without commit");
        let timeDraft = "";
        for (const key of "1045") {
            win.webContents.sendInputEvent({type: "keyDown", keyCode: key});
            win.webContents.sendInputEvent({type: "char", keyCode: key});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: key});
            timeDraft += key;
            await check(`dateCase.time.value === ${JSON.stringify(timeDraft)}`, "Each native digit preserves the unfinished draft");
            await win.webContents.executeJavaScript("dateCase.binding.update()");
            await check(`dateCase.time.value === ${JSON.stringify(timeDraft)}`, "Constraint refresh does not normalize an active time draft");
        }
        await check('dateCase.getInlineDateValue(dateCase.input) === "2026-11-13T10:45" && dateCase.binding.validate()', "Independent time completes canonical value");
        await check('dateCase.time.value === "1045"', "Native digit typing leaves the draft untouched before commit");
        await clickDay("2026-11-14");
        await check('dateCase.getInlineDateValue(dateCase.input) === "2026-11-14T10:45"', "First click after native typing selects immediately");
        await win.webContents.executeJavaScript("dateCase.input.focus()");
        win.webContents.sendInputEvent({type: "keyDown", keyCode: "Down", modifiers: ["alt"]});
        win.webContents.sendInputEvent({type: "keyUp", keyCode: "Down", modifiers: ["alt"]});
        await check("dateCase.host.contains(document.activeElement)", "AltDown focuses the current calendar after real blur change");
        win.webContents.sendInputEvent({type: "keyDown", keyCode: "Right"});
        win.webContents.sendInputEvent({type: "keyUp", keyCode: "Right"});
        win.webContents.sendInputEvent({type: "keyDown", keyCode: "Return"});
        win.webContents.sendInputEvent({type: "char", keyCode: "\r"});
        win.webContents.sendInputEvent({type: "keyUp", keyCode: "Return"});
        await check('dateCase.getInlineDateValue(dateCase.input) === "2026-11-15T10:45"', "Keyboard calendar selection retains time");
        for (const value of ["2026-11-14T12:34:56.123", "2026-11-14 12:34:56.123"]) {
            await win.webContents.executeJavaScript("dateCase.input.focus(); dateCase.input.select()");
            if (canRestoreClipboard) {
                await clipboard.writeText(value);
                writtenClipboard = value;
                win.webContents.paste();
            } else {
                console.log("Native clipboard paste not run: existing clipboard formats cannot be restored safely");
                win.webContents.insertText(value);
            }
            await check('dateCase.getInlineDateValue(dateCase.input) === "2026-11-14T12:34:56.123" && dateCase.binding.validate()', "Clipboard canonical value and precision");
            await win.webContents.executeJavaScript("dateCase.binding.update()");
            await check('dateCase.input.value === "2026-11-14" && dateCase.time.value === "12:34:56.123"', "Clipboard distributes both visible components");
        }
        await clickDay("2026-11-15");
        await check('dateCase.getInlineDateValue(dateCase.input) === "2026-11-15T12:34:56.123"', "Choosing a day retains seconds and milliseconds");
        await win.webContents.executeJavaScript('dateCase.input.value="2026-02-31 12:00"; dateCase.input.dispatchEvent(new Event("input",{bubbles:true}))');
        await check('dateCase.input.value === "2026-02-31 12:00" && !dateCase.binding.validate()', "Invalid draft remains visible");
        await win.webContents.executeJavaScript('dateCase.setInlineDateValue(dateCase.input, ""); dateCase.binding.update()');
        await check('dateCase.binding.validate() && dateCase.getInlineDateValue(dateCase.input) === ""', "Clear remains empty");
        return "native datetime cases passed";
        } finally {
            if (writtenClipboard !== undefined && await clipboard.readText() === writtenClipboard) {
                if (originalClipboard.length) { await clipboard.write(originalClipboard); }
                else { clipboard.clear(); }
            }
        }
    }});
    assert.match(result, /native datetime cases passed/);
});
