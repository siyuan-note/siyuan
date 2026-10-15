const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const sass = require("sass");
const ts = require("typescript");

const compile = file => ts.transpileModule(readFileSync(path.join(__dirname, "../src", file), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
}).outputText;

// 使用实际菜单与搜索逻辑，在真实移动端样式下验证交互和尺寸，避免输入框撑开顶栏。
const browserCases = async ({css, modules, languages}) => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    window.siyuan = {languages, config: {readonly: false, lang: "en_US"}, storage: {collapsed: ["settings"]}};
    let blurs = 0;
    let mounts = 0;
    let unmounts = 0;
    const dependencies = {
        Constants: {LOCAL_MOBILE_MENU_COLLAPSED: "collapsed"},
        setStorageVal() {},
        isDisabledFeature: () => false,
        isInMobileApp: () => false,
        getHostCapabilities: () => ({importExport: true}),
        getSettingTabDefs: () => [{id: "editor", title: "Editor", icon: "iconEdit"}],
        settingTabToMenuId: id => `menu-${id}`,
        bindSettingSaveDelegation() {},
        unmountSettingTab: () => unmounts++,
        activeBlur() {
            blurs++;
            document.activeElement?.blur();
        },
        getSettingTab: () => ({
            scanSearch: keywords => ({matches: keywords === "editor", visibleItemIds: [], visibleGroupIds: []}),
            async mount(root) {
                mounts++;
                root.innerHTML = '<input class="b3-text-field" aria-label="Setting value">';
            },
        }),
    };
    const load = code => {
        const exports = {};
        new Function("exports", "require", code)(exports, () => dependencies);
        Object.assign(dependencies, exports);
        return exports;
    };
    modules.forEach(load);
    const near = (actual, expected, label) => check.ok(Math.abs(actual - expected) < 1,
        `${label}: ${actual} / ${expected}`);
    const visible = element => getComputedStyle(element).display !== "none";
    for (const width of [240, 320, 390, 768]) {
        for (const fontSize of [14, 32]) {
            document.body.style.fontSize = `${fontSize}px`;
            document.body.innerHTML = '<div id="menu" class="fn__flex-column" style="transform:none;position:relative"></div>';
            const menu = document.getElementById("menu");
            menu.style.width = `${width}px`;
            menu.innerHTML = dependencies.renderMobileMainMenuHTML();
            const toolbar = menu.querySelector(".toolbar");
            const input = menu.querySelector(".mobile-main-menu__search input");
            const open = menu.querySelector('[data-type="menu-search-open"]');
            const close = menu.querySelector('[data-type="menu-search-close"]');
            const title = menu.querySelector(".mobile-main-menu__title");
            const back = toolbar.firstElementChild;
            const groups = menu.querySelector(".mobile-main-menu__groups");
            const settings = menu.querySelector('[data-menu-group="settings"] > .b3-menu__group-items');
            const search = dependencies.createMainMenuSearch({}, menu);
            search.reset(true);
            check.ok(visible(title) && visible(open) && !visible(close));
            check.ok(!visible(input.parentElement));
            const initialHeight = toolbar.getBoundingClientRect().height;
            const backRect = back.getBoundingClientRect();
            near(backRect.width, 40, "return icon width including padding");
            near(backRect.height, 40, "return icon height including padding");
            near(open.getBoundingClientRect().width, 48, "search button keeps the shared touch target");
            near(open.getBoundingClientRect().height, 48, "search button keeps the shared touch target");
            near(open.querySelector("svg").getBoundingClientRect().width, 20, "search glyph width");
            near(open.querySelector("svg").getBoundingClientRect().height, 20, "search glyph height");
            check.ok(settings.classList.contains("fn__none"));

            open.click();
            check.equal(document.activeElement, input);
            check.ok(visible(input.parentElement) && visible(close) && !visible(title) && !visible(open));
            check.equal(open.getAttribute("aria-expanded"), "true");
            near(toolbar.getBoundingClientRect().height, initialHeight, "search preserves toolbar height");
            near(back.getBoundingClientRect().width, backRect.width, "search preserves return button width");
            near(close.getBoundingClientRect().width, 48, "cancel button width");
            near(close.getBoundingClientRect().height, 48, "cancel button height");
            check.ok(toolbar.scrollWidth <= toolbar.clientWidth, `toolbar fits ${width}px/${fontSize}px`);
            check.ok(input.getBoundingClientRect().left >= back.getBoundingClientRect().right);
            check.ok(input.getBoundingClientRect().right <= close.getBoundingClientRect().left);
            const inputHeight = input.getBoundingClientRect().height;

            // 与原有常驻输入框顶栏比较，而不是通过放大控件取得相同高度。
            const baseline = document.createElement("div");
            baseline.className = "toolbar toolbar--border";
            baseline.innerHTML = back.outerHTML + '<div class="mobile-main-menu__search" style="padding-right:11px">' + input.outerHTML + "</div>";
            menu.append(baseline);
            near(initialHeight, baseline.getBoundingClientRect().height, "default preserves previous toolbar height");
            near(inputHeight, baseline.querySelector("input").getBoundingClientRect().height, "input keeps previous height");
            baseline.remove();

            input.value = "editor";
            input.dispatchEvent(new InputEvent("input", {isComposing: true}));
            check.ok(settings.classList.contains("fn__none"), "composition does not start filtering early");
            input.dispatchEvent(new CompositionEvent("compositionend"));
            await Promise.resolve();
            await Promise.resolve();
            const resultInput = menu.querySelector(".mobile-setting-menu__result input");
            check.ok(resultInput, "setting search result mounts");
            resultInput.focus();
            input.dispatchEvent(new FocusEvent("blur", {relatedTarget: resultInput}));
            check.ok(visible(input.parentElement), "editing a setting retains the visible filter");
            check.equal(input.value, "editor");
            check.ok(!settings.classList.contains("fn__none"), "search reveals collapsed groups");
            close.click();
            check.equal(search.keywords(), "");
            check.equal(document.activeElement, open, "cancel restores focus to the search button");
            check.ok(visible(title) && visible(open) && !visible(input.parentElement));
            check.ok(!menu.querySelector(".mobile-setting-menu__result input"), "cancel unmounts settings");
            check.ok(settings.classList.contains("fn__none"), "cancel restores saved group collapse");

            open.click();
            input.blur();
            input.dispatchEvent(new FocusEvent("blur"));
            check.ok(visible(title) && !visible(input.parentElement), "empty blur restores the title");
            open.click();
            input.value = "missing";
            input.dispatchEvent(new InputEvent("input"));
            check.ok(visible(menu.querySelector('[data-type="menu-search-empty"]')));
            groups.scrollTop = 100;
            const previousBlurs = blurs;
            search.reset(true);
            check.equal(blurs, previousBlurs, "keyboard-preserving close does not request a blur");
            check.equal(groups.scrollTop, 0);
            check.equal(input.value, "");
            check.ok(!visible(menu.querySelector('[data-type="menu-search-empty"]')));
            check.ok(visible(title) && !visible(input.parentElement));
            check.equal(open.getAttribute("aria-expanded"), "false");
        }
    }
    check.ok(mounts > 0 && unmounts >= mounts);
    return "Mobile main menu search cases passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 1000, height: 900,
            webPreferences: {nodeIntegration: true, contextIsolation: false}});
        try {
            const css = sass.compile(path.join(__dirname, "../src/assets/scss/mobile.scss"), {
                logger: sass.Logger.silent,
            }).css;
            const modules = ["util/escape.ts", "config/search/normalize.ts", "mobile/menu/searchFilter.ts",
                "mobile/dock/mobileFilterInput.ts", "mobile/menu/mainMenuCollapse.ts", "mobile/menu/mainMenu.ts",
                "mobile/menu/mainMenuSearch.ts"].map(compile);
            const languages = JSON.parse(readFileSync(path.join(__dirname, "../appearance/langs/en.json"), "utf8"));
            for (const theme of ["daylight", "midnight"]) {
                await win.loadURL("data:text/html,<html><body></body></html>");
                const themeCSS = readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8");
                assert.equal(await win.webContents.executeJavaScript(
                    `(async () => { try { return await (${browserCases.toString()})(${JSON.stringify({css: css + themeCSS, modules, languages})}); } catch (error) { return error.stack; } })()`),
                "Mobile main menu search cases passed");
            }
            console.log("Mobile main menu search cases passed");
            win.destroy();
            app.exit(0);
        } catch (error) {
            console.error(error);
            win.destroy();
            app.exit(1);
        }
    }).catch(error => {
        console.error(error);
        app.exit(1);
    });
} else {
    test("mobile main menu search preserves dimensions, filters and keyboard lifecycle", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 120000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-mobile-menu-search-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 110000});
            assert.match(stdout, /Mobile main menu search cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-mobile-menu-search-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
