import * as assert from "node:assert/strict";
import {test} from "node:test";
import {browserSources, runBrowserCase} from "../../datePicker/test/browser";

test("font selection preserves the menu scroll, search highlights and keyboard selection", async () => {
    const sources = browserSources({
        appearance: "src/config/tabs/appearanceTab.ts",
        fontInputs: "src/config/tabs/appearanceFontSettings.ts",
        keyboard: "src/util/upDownHint.ts",
    });
    const result = await runBrowserCase(async sources => {
        const check = (ok: unknown, message: string) => {
            if (!ok) throw new Error(message);
        };
        const load = (code: string, dependencies: Record<string, unknown> = {}) => {
            const exports = {};
            new Function("require", "exports", code)((name: string) => dependencies[name] || {}, exports);
            return exports;
        };
        const fontInputs = load(sources.fontInputs) as typeof import("./appearanceFontSettings");
        const fonts = Array.from({length: 80}, (_, i) => ({
            family: `Font ${i}`, displayName: `Font ${i}`, weight: 400, spacing: "monospace",
        }));
        const regular = fonts[50];
        const bold = {...regular, weight: 700, displayName: "Font 50 Bold"};
        const proportional = {...fonts[51], spacing: "proportional"};
        fonts.splice(51, 1, bold, proportional);
        const config = {
            appearance: {globalFontFamilies: [fonts[25], regular]},
            editor: {fontFamilies: [fonts[25], regular], codeFontFamilies: [proportional]},
        };
        Object.assign(window, {siyuan: {config, languages: {default: "Default", showAll: "Show all"}}});
        let mobile = false;
        let open: Promise<void>;
        class FontMenu {
            element = document.createElement("div");
            addItem(item: {label: string; bind: (element: HTMLElement) => void}) {
                this.element.innerHTML = item.label;
                item.bind(this.element);
            }
            open() { document.body.append(this.element); }
        }
        const appearance = load(sources.appearance + "\nexports.mountFont = mountAppearanceFontFamily;", {
            "./appearanceFontSettings": fontInputs,
            "./appearanceRuntime": {appearanceConfigApi: {
                patch: async (_key: string, value: typeof fonts) => {
                    config.appearance.globalFontFamilies = value;
                    fontInputs.syncAppearanceFontInputs("globalFontFamilies");
                },
            }},
            "./editorRuntime": {editorConfigApi: {
                patch: async (key: keyof typeof config.editor, value: typeof fonts, applied: () => void) => {
                    config.editor[key] = value;
                    applied();
                },
            }},
            "../../util/availableFont": {loadAvailableFonts: async () => ({customFonts: [] as never[], fontItems: fonts})},
            "../../util/escape": {escapeAttr: (value: string) => value || "", escapeHtml: (value: string) => value || ""},
            "../../util/fontPreview": {observeFontPreview: () => () => {}},
            "../../util/functions": {isMobile: () => mobile},
            "../../util/upDownHint": load(sources.keyboard),
            "../../menus/Menu": {markMenuInnerScroll() {}},
            "../../menus/menuToggle": {toggleMenu: (options: {build: (menu: unknown, session: unknown) => Promise<void>}) =>
                open = options.build(undefined, {isCurrent: () => true, show: (callback: () => void) => callback()})},
            "../../plugin/Menu": {Menu: FontMenu},
        }) as {mountFont: (root: HTMLElement, key: string) => void};
        const style = document.createElement("style");
        style.textContent = '[data-type="available-fonts"] { height: 160px; overflow: auto; } .b3-list-item { height: 24px; } ' +
            ".fn__none { display: none; } svg { width: 12px; height: 12px; }";
        document.head.append(style);

        for (const key of ["globalFontFamilies", "fontFamilies", "codeFontFamilies"] as const) {
            mobile = key === "fontFamilies";
            document.body.innerHTML = `<div data-font-config-key="${key}"><div data-type="selected-fonts"></div>
                <input id="${key === "globalFontFamilies" ? "appearance" : "editor"}.${key}"></div>`;
            appearance.mountFont(document.body, key);
            const input = document.querySelector("input");
            input.click();
            await open;
            const search = document.querySelector<HTMLInputElement>('[data-type="font-search"]');
            check((document.activeElement === search) === !mobile, `${key}: unexpected search focus`);
            search.value = "font";
            search.dispatchEvent(new Event("input"));
            const list = document.querySelector<HTMLElement>('[data-type="available-fonts"]');
            const find = (name: string) => list.querySelector<HTMLElement>(`[data-name="${name}"]`);
            const selected = (name: string) => find(name).parentElement.querySelector(".b3-menu__checked");
            const focused = () => list.querySelector(".b3-list-item--focus .b3-menu__label");
            const enter = () => search.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter"}));
            if (key === "codeFontFamilies") {
                const current = find(proportional.displayName);
                check(!current.parentElement.classList.contains("fn__none"), "a configured proportional font must be visible");
                list.scrollTop = 80 * 12;
                current.click();
                check(current.parentElement.classList.contains("fn__none"), "deselected proportional font must be hidden");
                check(focused()?.getAttribute("data-name") === "Font 52", "focus should move to the adjacent visible font");
                check(list.scrollTop > 0, "hiding a font must not scroll to the top");
                document.querySelector<HTMLElement>('[data-type="show-all-fonts"]').click();
                check(!current.parentElement.classList.contains("fn__none"), "Show all must restore proportional fonts");
                current.click();
                check(selected(proportional.displayName), "a proportional font can be selected again");
                continue;
            }
            const earlier = selected(fonts[25].displayName);
            const mark = find(bold.displayName).querySelector("mark");
            list.scrollTop = 48 * 24;
            const scrollTop = list.scrollTop;
            check(scrollTop > 0 && earlier && mark, `${key}: incomplete test setup`);
            find(bold.displayName).click();
            await new Promise(requestAnimationFrame);
            check(list.isConnected && list.scrollTop === scrollTop, `${key}: font selection moved the list`);
            check(selected(bold.displayName) && !selected(regular.displayName), `${key}: old weight still selected`);
            check(selected(fonts[25].displayName) === earlier, `${key}: an unrelated checkmark was replaced`);
            check(search.value === "font" && find(bold.displayName).querySelector("mark") === mark, `${key}: search was rebuilt`);
            check(focused() === find(bold.displayName), `${key}: keyboard focus did not follow selection`);
            enter();
            check(!selected(bold.displayName) && list.scrollTop === scrollTop, `${key}: Enter did not deselect in place`);
        }
        return "Font menus kept their place";
    }, sources, "", {width: 600, height: 500});
    assert.match(result, /Font menus kept their place/);
});
