import * as assert from "node:assert/strict";
import {test} from "node:test";
import {compile, Logger} from "sass";
import {browserSources, runBrowserCase} from "../../datePicker/test/browser";

test("font selection preserves the menu scroll, search highlights and keyboard selection", async () => {
    const sources = browserSources({
        appearance: "src/config/tabs/appearanceTab.ts",
        fontInputs: "src/config/tabs/appearanceFontSettings.ts",
        keyboard: "src/util/upDownHint.ts",
        ...Object.fromEntries(["menus/Menu", "menus/menuPosition", "menus/menuMouseScroll", "menus/menuGroup",
            "menus/sheetOpen", "menus/sheetActions", "mobile/util/mobileSheetGesture", "mobile/util/keyboardSheetState",
            "util/setPosition", "util/zIndex", "protyle/util/hasClosest", "plugin/Menu", "menus/overlayOwnership"]
            .map(name => [name, `src/${name}.ts`])),
    });
    const css = ["component/_menu.scss", "component/_text-field.scss", "util/_function.scss"]
        .map(name => compile(`src/assets/scss/${name}`, {logger: Logger.silent}).css).join("\n");
    const result = await runBrowserCase(async (sources, css) => {
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
        Object.assign(window, {siyuan: {config, zIndex: 0, storage: {}, menus: {},
            mobile: {size: {portrait: {height1: innerHeight}}},
            languages: {default: "Default", showAll: "Show all", back: "Back"}}});
        let mobile = false;
        let open: Promise<void>;
        const modules: Record<string, unknown> = {
            "util/functions": {isMobile: () => mobile},
            "protyle/util/compatibility": {getEventName: () => "click", isInMobileApp: () => false, updateHotkeyTip: (text: string) => text},
            "layout/getTopBarHeight": {getTopBarHeight: () => 32},
            constants: {Constants: {ATTRIBUTE_MENU_KEYMAP: "data-keymap"}},
            "protyle/undo": {electronUndo() {}},
            "util/escape": {escapeAttr: (text: string) => text},
            "menus/menuKeyboard": {setMenuInputCurrent() {}},
            "plugin/EventBusCore": {forEachPluginSubscriber() {}},
            "mobile/util/keyboardToolbar": {activeBlur() {}},
            "block/popoverLifecycle": {setPopoverMenuOpen() {}},
            "config/entryVisibility/runtime": {applyMenuEntryVisibility() {}},
            "menus/menuToggle": {},
        };
        const loadMenu = (name: string): any => {
            if (modules[name]) return modules[name];
            check(sources[name], `Unexpected menu dependency: ${name}`);
            const exports = {};
            modules[name] = exports;
            new Function("require", "exports", sources[name])((dependency: string) => {
                const parts = name.split("/");
                parts.pop();
                dependency.split("/").forEach(part => {
                    if (part === "..") parts.pop();
                    else if (part !== ".") parts.push(part);
                });
                return loadMenu(parts.join("/"));
            }, exports);
            return exports;
        };
        const {Menu: CoreMenu} = loadMenu("menus/Menu") as typeof import("../../menus/Menu");
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
            "../../menus/Menu": loadMenu("menus/Menu"),
            "../../menus/menuToggle": {toggleMenu: (options: {build: (menu: unknown, session: unknown) => Promise<void>}) =>
                open = options.build(undefined, {isCurrent: () => true, show: (callback: () => void) => callback()})},
            "../../plugin/Menu": loadMenu("plugin/Menu"),
        }) as {mountFont: (root: HTMLElement, key: string) => void};
        const style = document.createElement("style");
        style.textContent = css + ":root { --b3-font-size: 16px; } body { margin: 0; } " +
            "svg { width: 12px; height: 12px; }";
        document.head.append(style);
        const settle = async () => {
            for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
        };

        for (const scenario of [false, true].flatMap(touch => ["", "font"].flatMap(keyword =>
            ["globalFontFamilies", "fontFamilies", "codeFontFamilies"].map(key => ({touch, keyword, key}))))) {
            const {key, keyword} = scenario;
            mobile = scenario.touch;
            config.appearance.globalFontFamilies = [fonts[25], regular];
            config.editor.fontFamilies = [fonts[25], regular];
            config.editor.codeFontFamilies = [proportional];
            document.body.innerHTML = `<div data-font-config-key="${key}"><div data-type="selected-fonts"></div>
                <input id="${key === "globalFontFamilies" ? "appearance" : "editor"}.${key}"></div>
                <div id="commonMenu" class="b3-menu fn__none">
                    <div class="b3-menu__title fn__none"><span class="b3-menu__label"></span></div>
                    <div class="b3-menu__items"></div>
                </div>`;
            const menu = new CoreMenu();
            window.siyuan.menus.menu = menu;
            appearance.mountFont(document.body, key);
            const input = document.querySelector("input");
            input.click();
            await open;
            await settle();
            await Promise.all(menu.element.getAnimations().map(animation => animation.finished));
            const search = document.querySelector<HTMLInputElement>('[data-type="font-search"]');
            check((document.activeElement === search) === !mobile, `${key}: unexpected search focus`);
            search.value = keyword;
            search.dispatchEvent(new Event("input"));
            await settle();
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
                await settle();
                check(current.parentElement.classList.contains("fn__none"), "deselected proportional font must be hidden");
                check(focused()?.getAttribute("data-name") === "Font 52", "focus should move to the adjacent visible font");
                check(list.scrollTop > 0, "hiding a font must not scroll to the top");
                document.querySelector<HTMLElement>('[data-type="show-all-fonts"]').click();
                check(!current.parentElement.classList.contains("fn__none"), "Show all must restore proportional fonts");
                current.click();
                await settle();
                check(selected(proportional.displayName), "a proportional font can be selected again");
                menu.remove();
                continue;
            }
            const earlier = selected(fonts[25].displayName);
            const mark = find(bold.displayName).querySelector("mark");
            list.scrollTop = 48 * 24;
            const scrollTop = list.scrollTop;
            check(scrollTop > 0 && earlier && (!!mark === !!keyword), `${key}: incomplete test setup`);
            find(bold.displayName).click();
            await settle();
            check(list.isConnected && list.scrollTop === scrollTop,
                `${key}: font selection moved the list from ${scrollTop} to ${list.scrollTop}`);
            check(selected(bold.displayName) && !selected(regular.displayName), `${key}: old weight still selected`);
            check(selected(fonts[25].displayName) === earlier, `${key}: an unrelated checkmark was replaced`);
            check(search.value === keyword && find(bold.displayName).querySelector("mark") === mark, `${key}: search was rebuilt`);
            check(focused() === find(bold.displayName), `${key}: keyboard focus did not follow selection`);
            enter();
            await settle();
            check(!selected(bold.displayName) && list.scrollTop === scrollTop, `${key}: Enter did not deselect in place`);
            menu.remove();
        }
        return "Font menus kept their place";
    }, sources, css, {width: 600, height: 500});
    assert.match(result, /Font menus kept their place/);
});
