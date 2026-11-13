import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {compile, Logger} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {canRunBrowser, runBrowserCase} from "../datePicker/test/browser";

for (const mobile of [false, true]) {
    test(`AI direct prompt preserves selection and search on ${mobile ? "mobile" : "desktop"}`, {
        timeout: 45000, skip: !canRunBrowser,
    }, async () => {
        const preprocess = (source: string) => source.replace(
            /\/\/\/ #if MOBILE\n([\s\S]*?)\/\/\/ #endif/g,
            (_match, content: string) => {
                const [yes, no = ""] = content.split("/// #else");
                return mobile ? yes : no;
            });
        const compile = (source: string) => transpileModule(source, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        const result = await runBrowserCase(async sources => {
            const mobile = sources.mobile === "true";
            const check = (condition: boolean, message: string) => { if (!condition) throw Error(message); };
            document.body.innerHTML = '<p contenteditable="true">Selected source text</p><div id="commonMenu"></div>';
            const block = document.querySelector("p");
            const sourceRange = document.createRange();
            sourceRange.setStart(block.firstChild, 0);
            sourceRange.setEnd(block.firstChild, 8);
            const protyle = {toolbar: {range: sourceRange}, element: block, wysiwyg: {element: document.body}};
            const elements = [block];
            const calls: unknown[][] = [];
            let requests = 0;
            let cleared = 0;
            let closed = 0;
            let fullscreen = 0;
            const root = document.getElementById("commonMenu");
            const languages = {
                aiOneTimeAction: "Describe an edit", use: "Use", search: "Search",
                aiContinueWrite: "Continue", aiExtractSummary: "Summary", aiBrainStorm: "Brainstorm",
                aiFixGrammarSpell: "Grammar", clearContext: "Clear context", aiCustomAction: "Custom action",
            };
            Object.assign(window, {siyuan: {languages, menus: {menu: {remove: () => { root.innerHTML = ""; }}}}});
            const helper = {};
            new Function("exports", sources.helper)(helper);
            const dependencies = {
                ...helper,
                Constants: {MENU_AI: "ai"}, isMobile: () => mobile,
                escapeAttr: (value: string) => value, escapeAriaLabel: (value: string) => value,
                escapeHtml: (value: string) => value,
                fetchPost: () => { requests++; }, fetchSyncPost: () => { requests++; },
                focusByRange: () => {},
                markMenuInnerScroll: () => root.lastElementChild.classList.add("b3-menu__items--inner-scroll"),
                upDownHint: () => {}, showMessage: () => {},
                clearAIEditorHistory: () => { cleared++; },
                startAIEditorAction: (...args: unknown[]) => calls.push(args),
                Menu: class {
                    element = root;
                    addItem(item: {label: string; bind: (element: HTMLElement) => void}) {
                        root.innerHTML = '<div class="b3-menu__items"><div>' + item.label + "</div></div>";
                        item.bind(root.firstElementChild.firstElementChild as HTMLElement);
                    }
                    close() { closed++; }
                    open() {}
                    fullscreen() { fullscreen++; }
                },
            };
            const exports = {} as {open: (...args: unknown[]) => void};
            new Function("exports", "require", sources.actions)(exports, () => dependencies);
            const open = () => {
                exports.open([{id: "saved", name: "Saved action", action: "Saved instruction"}], elements, protyle, sourceRange);
                return {
                    prompt: root.querySelector("textarea"), search: root.querySelector("input"),
                    button: root.querySelector("button"),
                };
            };
            const key = (element: HTMLElement, options: KeyboardEventInit = {}) => {
                const event = new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true, ...options});
                element.dispatchEvent(event);
                return event;
            };
            let {prompt, search, button} = open();
            check(mobile ? fullscreen === 1 : document.activeElement === prompt, "platform opening/focus");
            check(button.disabled, "empty prompt disabled");
            prompt.value = "   ";
            prompt.dispatchEvent(new Event("input"));
            key(prompt);
            check(calls.length === 0 && closed === 0, "whitespace must not execute or close");
            prompt.value = "Rewrite this\nwith details";
            prompt.dispatchEvent(new Event("input"));
            check(!button.disabled, "prompt enables action");
            check(!key(prompt, {shiftKey: true}).defaultPrevented, "Shift Enter preserves newline");
            prompt.dispatchEvent(new CompositionEvent("compositionstart"));
            key(prompt);
            check(button.disabled && calls.length === 0, "composition blocks execution");
            prompt.dispatchEvent(new CompositionEvent("compositionend"));
            key(prompt, {isComposing: true});
            key(prompt, {keyCode: 229});
            check(calls.length === 0, "IME Enter must not submit");
            search.value = "Saved";
            search.dispatchEvent(new Event("input", {bubbles: true}));
            check(prompt.value === "Rewrite this\nwith details", "search preserves prompt");
            check(root.querySelector('[data-id="saved"]').classList.contains("b3-list-item--focus"), "search filters saved actions");
            const enter = key(prompt);
            if (mobile) {
                check(!enter.defaultPrevented && calls.length === 0, "mobile Enter preserves newline");
                button.click();
            }
            check(calls.length === 1 && closed === 1, "direct prompt executes exactly once");
            check(calls[0][0] === protyle && calls[0][1] === elements && calls[0][2] === sourceRange,
                "original source and selected range survive input focus");
            check(calls[0][3] === "Rewrite this\nwith details", "direct prompt is not the highlighted saved action");
            button.click();
            key(prompt);
            check(calls.length === 1, "duplicate submission blocked");
            ({prompt, search, button} = open());
            prompt.value = "Do not execute this";
            search.value = "Saved";
            search.dispatchEvent(new Event("input"));
            key(search);
            check(calls.length === 2 && calls[1][3] === "Saved instruction", "search Enter retains operation behavior");
            ({prompt, search, button} = open());
            prompt.value = "Clear context";
            prompt.dispatchEvent(new Event("input"));
            button.click();
            check(calls[2][3] === "Clear context" && cleared === 0, "one-time text is not a management action");
            check(requests === 0, "one-time execution never saves an action");
            const style = document.createElement("style");
            document.head.append(style);
            const metrics = [];
            for (const theme of ["daylight", "midnight"]) {
                style.textContent = sources[theme] + sources.css;
                root.className = "b3-menu" + (mobile ? " b3-menu--fullscreen" : "");
                for (const width of [320, 390]) {
                    root.style.cssText = `top:0;left:0;width:${width}px;${mobile ? "height:332px;" : ""}`;
                    exports.open(Array.from({length: 30}, (_, index) => ({
                        id: String(index), name: `Saved action ${index}`, action: `Instruction ${index}`,
                    })), elements, protyle, sourceRange);
                    const items = root.firstElementChild as HTMLElement;
                    items.style.maxHeight = "300px";
                    const controls = [root.querySelector("textarea"), root.querySelector("button"), root.querySelector("input")];
                    const list = root.querySelector<HTMLElement>(".b3-list");
                    const rects = controls.map(control => control.getBoundingClientRect());
                    for (let index = 0; index < rects.length; index++) {
                        const rect = rects[index];
                        check(rect.height > 15 && rect.width > 50, `visible control ${theme}/${width}/${index}`);
                        check(rect.left >= 0 && rect.right <= width + 1,
                            `control fits width ${theme}/${width}/${index}: ${rect.left},${rect.right}; root ${root.getBoundingClientRect().width}`);
                        if (index > 0) check(rect.top >= rects[index - 1].bottom, `controls do not overlap ${theme}/${width}`);
                    }
                    const listRect = list.getBoundingClientRect();
                    check(listRect.top >= rects[2].bottom, `list below search ${theme}/${width}`);
                    check(list.clientHeight >= 30, `list keeps usable space ${theme}/${width}: ${list.clientHeight}`);
                    check(list.scrollHeight > list.clientHeight, `list overflows ${theme}/${width}`);
                    list.scrollTop = list.scrollHeight;
                    check(list.scrollTop > 0, `list can scroll ${theme}/${width}`);
                    check(listRect.bottom <= items.getBoundingClientRect().bottom + 1, `list fits content ${theme}/${width}`);
                    metrics.push({theme, width, listHeight: list.clientHeight});
                }
            }
            return "passed " + JSON.stringify(metrics);
        }, {
            mobile: String(mobile),
            actions: compile(preprocess(readFileSync("src/ai/actions.ts", "utf8")) + "\nexports.open = openAIActions;"),
            helper: compile(readFileSync("src/ai/oneTimeAction.ts", "utf8")),
            css: compileStyles(mobile),
            daylight: readFileSync("appearance/themes/daylight/theme.css", "utf8"),
            midnight: readFileSync("appearance/themes/midnight/theme.css", "utf8"),
        });
        assert.match(result, /passed/);
    });
}

const compileStyles = (mobile: boolean) => compile(`src/assets/scss/${mobile ? "mobile" : "base"}.scss`, {
    logger: Logger.silent,
}).css;
