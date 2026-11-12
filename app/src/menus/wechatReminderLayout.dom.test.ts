import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {compile} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "../datePicker/test/browser";

test("compact reminder dialogs fit their real fields, translations and three actions", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources({model: "src/datePicker/model.ts", yearInput: "src/datePicker/yearInput.ts",
        field: "src/datePicker/field.ts", inline: "src/datePicker/inline.ts", menu: "src/menus/commonMenuItem.ts"});
    sources.languages = JSON.stringify(["zh-CN", "en", "de", "ru", "ja", "ar"].map(language =>
        JSON.parse(readFileSync(`appearance/langs/${language}.json`, "utf8"))));
    const css = readFileSync("appearance/themes/daylight/theme.css", "utf8") + compile("src/assets/scss/base.scss").css;
    const result = await runBrowserCase(async (source, styles) => {
        const style = document.createElement("style");
        style.textContent = styles;
        document.head.append(style);
        document.documentElement.dataset.frontend = "browser-desktop";
        const modules: Record<string, any> = {};
        let current: HTMLElement;
        class Dialog {
            element: HTMLElement;
            constructor(options: any) {
                this.element = document.createElement("div");
                this.element.innerHTML = `<div class="b3-dialog"><div class="b3-dialog__container ${options.containerClassName}" style="width:${options.width};opacity:1;transform:none"><div class="b3-dialog__header">${options.title}</div><div class="b3-dialog__body">${options.content}</div></div></div>`;
                document.body.replaceChildren(this.element);
                current = this.element;
            }
        }
        const fallback = {MobileDialog: Dialog, isMobile: () => false, isEncryptedBox: () => false, getEditorRange: () => ({}),
            Constants: {CUSTOM_REMINDER_WECHAT: "reminder", DIALOG_WECHATREMINDER: "wechat"},
            fetchPost: (_url: string, _body: unknown, callback: (data: unknown) => void) => callback({data: {ial: {}}})};
        for (const name of ["model", "yearInput", "field", "inline", "menu"]) {
            const exports = modules[name] = {};
            new Function("exports", "require", source[name])(exports, (path: string) => modules[path.split("/").at(-1)] || fallback);
        }
        const check = (condition: boolean, message: string) => { if (!condition) throw Error(message); };
        for (const languages of JSON.parse(source.languages)) {
            (window as any).siyuan = {languages};
            for (const fontSize of [14, 18]) {
                document.body.style.fontSize = `${fontSize}px`;
                for (const file of [false, true]) {
                    if (file) modules.menu.openFileWechatNotify("document", "notebook");
                    else modules.menu.openWechatNotify({getAttribute: (name: string) => name === "data-node-id" ? "block" : undefined});
                    const dialog = current.querySelector<HTMLElement>(".b3-dialog__container");
                    const rect = dialog.getBoundingClientRect();
                    check(rect.width <= 300 && rect.width > 240, "Reminder uses its compact dialog width");
                    for (const element of current.querySelectorAll<HTMLElement>("input, .b3-dialog__action button, .b3-label__text, .date-picker__calendar")) {
                        const child = element.getBoundingClientRect();
                        if (!child.width || !child.height) continue;
                        check(child.left >= rect.left && child.right <= rect.right, `Reminder content stays inside the dialog: ${languages.name}/${fontSize}/${element.className}/${child.left},${child.right}/${rect.left},${rect.right}`);
                        check(element.scrollWidth <= element.clientWidth + 1, `Reminder content is not clipped: ${element.className}`);
                    }
                    const buttons = Array.from(current.querySelectorAll<HTMLElement>(".b3-dialog__action button"));
                    check(buttons.length === 3, "All three reminder actions are present");
                    for (let index = 1; index < buttons.length; index++) {
                        const previous = buttons[index - 1].getBoundingClientRect();
                        const next = buttons[index].getBoundingClientRect();
                        check(next.top >= previous.bottom || next.left >= previous.right, "Reminder actions do not overlap");
                    }
                }
            }
        }
        return "Real reminder layout passed";
    }, sources, css, {width: 320, height: 900});
    assert.match(result, /Real reminder layout passed/);
});
