const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// 搜索框固定、滚动交给内层列表的菜单（AI 编辑、字体族、背景图、模型选择、汇总）结构一致：
// .b3-menu__items--inner-scroll（由 markMenuInnerScroll() 标记，并保留 open() 写入的可用高度）
// > div > .b3-menu__filter > .b3-list

const browserCases = (entries) => {
    const listHTML = count => Array.from({length: count}, (_, index) =>
        `<div class="b3-list-item b3-list-item--narrow">Option ${index + 1}</div>`).join("");
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    document.head.append(style);
    const menu = document.createElement("div");
    menu.id = "verifyMenu";
    menu.className = "b3-menu";
    document.body.append(menu);

    const build = ({count, maxHeight, mobile = false, internalScroll = true}) => {
        style.textContent = mobile ? entries.mobile : entries.base;
        menu.className = mobile ? "b3-menu b3-menu--fullscreen" : "b3-menu";
        menu.removeAttribute("style");
        menu.innerHTML = '<div class="b3-menu__title fn__none"></div><div class="b3-menu__items">' +
            '<div><div class="fn__flex-column b3-menu__filter"><input class="b3-text-field fn__flex-shrink">' +
            '<div class="fn__hr"></div><div class="b3-list fn__flex-1 b3-list--background">' +
            listHTML(count) + "</div></div></div></div>";
        menu.style.left = "120px";
        menu.style.top = mobile ? "0" : "60px";
        const items = menu.querySelector(".b3-menu__items");
        if (internalScroll) {
            items.classList.add("b3-menu__items--inner-scroll");
        }
        if (maxHeight) {
            items.style.maxHeight = maxHeight;
        }
        if (mobile) {
            menu.querySelector(".b3-menu__items > div").style.cssText = "padding: 0 8px;height: 100%";
        }
        return {items, filter: menu.querySelector(".b3-menu__filter"), list: menu.querySelector(".b3-list"),
            input: menu.querySelector("input"), rect: menu.getBoundingClientRect()};
    };

    try {
        // 可用高度与 Menu.setPopupPosition() 一致：锚点下方剩余空间
        const available = Math.max(0, window.innerHeight - 60 - 20);

        const long = build({count: 40, maxHeight: `${available}px`});
        check.ok(long.filter.getBoundingClientRect().height > window.innerHeight * .5 + 20,
            `search menus use the available height instead of 50vh: ${long.filter.getBoundingClientRect().height}`);
        check.ok(long.rect.bottom <= window.innerHeight + .5, "the menu stays inside the viewport");
        check.ok(long.list.scrollHeight > long.list.clientHeight + 1, "a long list still scrolls");
        check.equal(getComputedStyle(long.items).overflow, "visible", "the container does not scroll by itself");
        const inputTop = long.input.getBoundingClientRect().top;
        long.list.scrollTop = 200;
        check.equal(long.input.getBoundingClientRect().top, inputTop,
            "the search field stays fixed while the list scrolls");

        const short = build({count: 12, maxHeight: `${available}px`});
        check.ok(short.list.scrollHeight <= short.list.clientHeight + 1,
            "a short list fits without a scrollbar while the window still has room");

        const plain = build({count: 40, maxHeight: `${available}px`, internalScroll: false});
        check.ok(Math.abs(parseFloat(getComputedStyle(plain.filter).maxHeight) - window.innerHeight * .5) < 1,
            `menus that scroll as a whole keep the 50vh filter limit: ${getComputedStyle(plain.filter).maxHeight}`);
        check.equal(getComputedStyle(plain.items).overflow, "auto");
        check.equal(plain.items.classList.contains("b3-menu__items--inner-scroll"), false);

        const sheet = build({count: 60, mobile: true});
        const sheetRect = menu.getBoundingClientRect();
        const sheetList = sheet.list.getBoundingClientRect();
        check.ok(Math.abs(sheetRect.height - window.innerHeight) < 2,
            `the fullscreen sheet fills the window: ${sheetRect.height}`);
        check.ok(sheet.items.getBoundingClientRect().height <= sheetRect.height + .5,
            "the sheet items do not overflow the fullscreen menu");
        check.ok(sheetList.height < sheetRect.height, "the sheet list is bounded by the menu");
        check.ok(sheet.list.scrollHeight > sheet.list.clientHeight + 1, "the sheet list scrolls inside the menu");
        check.equal(getComputedStyle(sheet.items).overflow, "visible",
            "the sheet overrides its own horizontal clipping so only the list scrolls");
        return "ok";
    } catch (error) {
        return `${error.message} (viewport ${window.innerWidth}x${window.innerHeight})`;
    }
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.disableHardwareAcceleration();
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 900, height: 900,
            webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
        const watchdog = setTimeout(() => app.exit(1), 50000);
        try {
            const entries = Object.fromEntries(["base", "mobile"].map(name => [name,
                require("sass").compile(path.join(__dirname, `../src/assets/scss/${name}.scss`),
                    {logger: require("sass").Logger.silent}).css]));
            await win.loadURL("about:blank");
            const result = await win.webContents.executeJavaScript(
                `(${browserCases.toString()})(${JSON.stringify(entries)})`);
            if (result !== "ok") {
                throw new Error(result);
            }
            console.log("Verified search menu height, fixed search field, sheet layout and unchanged plain menus");
            win.destroy();
            clearTimeout(watchdog);
            app.exit(0);
        } catch (error) {
            console.error(error);
            win.destroy();
            app.exit(1);
        }
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("search menus fill the available height and keep the search field visible", {timeout: 60000}, async () => {
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-menu-filter-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const result = await promisify(execFile)(require("electron"), [__filename, temporary],
                {env, windowsHide: true, timeout: 55000});
            assert.match(result.stdout, /Verified search menu height/);
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
            fs.rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
