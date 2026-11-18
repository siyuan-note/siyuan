const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const setup = async (directory, mobile, fullHeight) => {
    const check = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const ts = require(path.join(directory, "node_modules/typescript"));
    const wait = () => new Promise(resolve => setTimeout(resolve, 250));
    window.SIYUAN_VERSION = "test";
    window.NODE_ENV = "test";
    window.Lute = {Sanitize: value => value};
    let id = 0;
    const categories = ["people", "nature", "objects", "custom"].map((name, index) => ({
        id: name, title: name, unicode: "1f600", items: Array.from({length: 400}, (_, item) => ({
            unicode: name === "custom" ? `test-${item}.png` : (0x1f600 + index * 400 + item).toString(16),
            description: `${name} ${item}`, description_zh_cn: `${name} ${item}`,
            description_ja_jp: `${name} ${item}`, keywords: name,
        })),
    }));
    const overrides = {
        "util/genID": {genUUID: () => String(++id)},
        "dialog/moveResize": {moveResize() {}},
        "dialog/anchoredInput": {getAnchoredInputMask() {}},
        "layout/getTopBarHeight": {getTopBarHeight: () => 0},
        "util/functions": {isMobile: () => mobile, getRandom: () => 0},
        "protyle": {},
        "protyle/util/compatibility": {isNotCtrl: () => true, isInMobileApp: () => mobile, isIOSDevice: () => false,
            updateHotkeyTip: value => value, setStorageVal() {}},
        "util/fetch": {fetchPost: (url, _data, callback) => {
            check.equal(url, "/api/system/getEmojiConf", "layout interactions never write document data");
            callback({data: categories});
        }},
        "layout/getAll": {getAllEditor: () => [], getAllModels: () => []},
        "layout/dock/docTree/rowData": {}, "protyle/breadcrumb/iconRefresh": {},
        "config/util/configApi": {}, "protyle/render/setLute": {}, "emoji/fileTreeIcon": {},
        "colorPicker": {}, "colorPicker/model": {}, "dialog/message": {},
        "datePicker/binding": {bindDatePicker: () => ({destroy() {}})},
        "mobile/util/keyboardToolbar": {activeBlur() {}},
        "mobile/util/bindEmojiSheetSelection": {},
    };
    const cache = new Map();
    const load = (name, parent = "") => {
        if (name === "dayjs") return require(path.join(directory, "node_modules/dayjs"));
        const key = path.posix.normalize(path.posix.join(parent, name)).replace(/^src\//, "").replace(/\.ts$/, "");
        if (overrides[key]) return overrides[key];
        if (cache.has(key)) return cache.get(key);
        let file = path.join(directory, "src", key + ".ts");
        let moduleKey = key;
        if (!fs.existsSync(file)) {file = path.join(directory, "src", key, "index.ts"); moduleKey += "/index";}
        const exports = {};
        cache.set(key, exports);
        const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
        }).outputText;
        new Function("require", "exports", code)(name => load(name, path.posix.dirname(moduleKey)), exports);
        return exports;
    };
    const {Constants} = load("src/constants.ts");
    Constants.TIMEOUT_OPENDIALOG = 0;
    Constants.TIMEOUT_DBLCLICK = 0;
    window.siyuan = {dialogs: [], zIndex: 1, emojis: categories,
        config: {lang: "en_US", readonly: false, editor: {emoji: []}},
        storage: {[Constants.LOCAL_EMOJIS]: {currentTab: "emoji"}},
        mobile: {size: {portrait: {height1: fullHeight}, landscape: {height1: fullHeight}, isLandscape: innerWidth > fullHeight}},
        languages: JSON.parse(fs.readFileSync(path.join(directory, "appearance/langs/en.json"), "utf8")),
        menus: {menu: {element: document.createElement("div"), remove() {}}}};
    document.documentElement.dataset.frontend = mobile ? "mobile" : "desktop";
    document.body.className = mobile ? "body--android" : "body--windows";
    const {openEmojiPanel} = load("src/emoji/index.ts");
    openEmojiPanel("fixture-document", "doc", {x: 24, y: 24, w: 40, h: 20});
    const dialog = window.siyuan.dialogs.at(-1);
    const panel = dialog.element.querySelector(".emojis__panel");
    const container = dialog.element.querySelector(".b3-dialog__container");
    await wait();
    for (let attempt = 0; attempt < 12 && getComputedStyle(container).visibility === "hidden"; attempt++) await wait();
    check.notEqual(getComputedStyle(container).visibility, "hidden", "the sheet waits for the keyboard before accepting input");
    await wait();
    const header = dialog.element.querySelector(".emojis__tabheader");
    const types = dialog.element.querySelector(".emojis__types");
    const tabbody = dialog.element.querySelector(".emojis__tabbody");
    const geometry = () => {
        const box = panel.getBoundingClientRect();
        const bounds = container.getBoundingClientRect();
        check.ok(panel.clientHeight > 20, "the emoji grid retains a visible scroll area");
        check.ok(panel.scrollHeight > panel.clientHeight + 200, "long emoji lists overflow their viewport: " +
            JSON.stringify([...dialog.element.querySelectorAll(".b3-dialog__body,.emojis,.emojis__tabbody,.emojis__panel")]
                .map(element => ({class: element.className, height: element.clientHeight, scrollHeight: element.scrollHeight}))));
        check.ok(box.bottom <= types.getBoundingClientRect().top + 1, "categories remain below the grid");
        check.ok(types.getBoundingClientRect().bottom <= bounds.bottom + 1, "category buttons remain inside the sheet");
        check.ok(header.getBoundingClientRect().top >= bounds.top, "tab navigation stays inside the sheet");
        return {x: box.x + box.width / 2, y: box.y + box.height * .8, distance: Math.min(120, box.height * .6),
            gridHeight: panel.clientHeight, scrollHeight: panel.scrollHeight};
    };
    geometry();
    const headerTop = header.getBoundingClientRect().top;
    const categoriesTop = types.getBoundingClientRect().top;
    panel.scrollTop = 180;
    await wait();
    check.ok(panel.scrollTop > 100, "the rendered emoji grid can scroll");
    check.equal(header.getBoundingClientRect().top, headerTop, "scrolling does not move tabs");
    check.equal(types.getBoundingClientRect().top, categoriesTop, "scrolling does not move categories");
    panel.scrollTop = 0;
    await wait();
    window.emojiLayoutCase = {geometry, panel, dialog, tabbody, async finish() {
        check.ok(panel.scrollTop > 0, "touch swipes scroll the emoji grid: " +
            JSON.stringify({top: panel.scrollTop, ...geometry()}));
        dialog.element.querySelector('.emojis__tabheader [data-type="tab-custom"]').click();
        await wait();
        geometry();
        panel.scrollTop = 200;
        check.ok(panel.scrollTop > 100, "custom icons scroll in the same bounded grid");
        const sheetHeight = container.getBoundingClientRect().height;
        const custom = categories.find(category => category.id === "custom");
        for (const items of [[], custom.items.slice(0, 1)]) {
            custom.items = items;
            dialog.element.querySelector('.emojis__tabheader [data-type="tab-emoji"]').click();
            dialog.element.querySelector('.emojis__tabheader [data-type="tab-custom"]').click();
            await wait();
            check.ok(Math.abs(container.getBoundingClientRect().height - sheetHeight) < 1,
                "empty and short custom lists retain the icon picker height");
            check.ok(panel.clientHeight > 0, "short custom lists retain a usable grid");
        }
        dialog.element.querySelector('.emojis__tabheader [data-type="tab-dynamic"]').click();
        await wait();
        const bodyBox = tabbody.getBoundingClientRect();
        check.ok(bodyBox.bottom <= container.getBoundingClientRect().bottom + 1, "dynamic icons stay bounded");
        if (tabbody.scrollHeight > tabbody.clientHeight) {
            tabbody.scrollTop = 100;
            check.ok(tabbody.scrollTop > 0, "dynamic icons remain scrollable in short viewports");
        }
        dialog.element.querySelector('.emojis__tabheader [data-type="tab-link"]').click();
        await wait();
        check.ok(tabbody.getBoundingClientRect().bottom <= container.getBoundingClientRect().bottom + 1,
            "upload controls remain in the bounded tab body");
        dialog.destroy();
        await wait();
        check.equal(dialog.element.isConnected, false);
        return "passed";
    }};
    return geometry();
};

if (process.versions.electron && process.type === "browser") {
    (async () => {
        const {app, BrowserWindow} = require("electron");
        app.setPath("userData", process.argv[2]);
        app.on("window-all-closed", () => {});
        await app.whenReady();
        const directory = path.join(__dirname, "..");
        const sass = require("sass");
        const styles = {};
        const entries = {mobile: "src/assets/scss/mobile.scss", base: "src/assets/scss/base.scss"};
        for (const [entry, file] of Object.entries(entries)) {
            styles[entry] = sass.compile(path.join(directory, file),
                {logger: {warn() {}, debug() {}}}).css;
        }
        for (const [width, height, mobile, theme, font, fullHeight = height] of [
            [384, 808, true, "daylight", 16], [320, 568, true, "midnight", 24],
            [824, 350, true, "daylight", 16], [390, 270, true, "midnight", 20, 808],
            [1000, 900, false, "daylight", 16],
        ]) {
            const win = new BrowserWindow({show: false, webPreferences: {
                nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false,
            }});
            win.setContentSize(width, height);
            await win.loadURL("data:text/html,<html><body></body></html>");
            await win.webContents.insertCSS(fs.readFileSync(path.join(directory, `appearance/themes/${theme}/theme.css`), "utf8"));
            await win.webContents.insertCSS(styles[mobile ? "mobile" : "base"]);
            await win.webContents.insertCSS(`body {--b3-font-size:${font}px;margin:0}`);
            const geometry = await win.webContents.executeJavaScript(`(${setup.toString()})(${JSON.stringify(directory)}, ${mobile}, ${fullHeight})`);
            win.webContents.debugger.attach("1.3");
            await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: true, maxTouchPoints: 1});
            const touch = async (type, y) => win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {
                type, touchPoints: type === "touchEnd" ? [] : [{x: geometry.x, y, radiusX: 1, radiusY: 1, force: 1, id: 1}],
            });
            await touch("touchStart", geometry.y);
            for (let step = 1; step <= 12; step++) {
                await new Promise(resolve => setTimeout(resolve, 20));
                await touch("touchMove", geometry.y - geometry.distance * step / 12);
            }
            await touch("touchEnd", 0);
            await new Promise(resolve => setTimeout(resolve, 250));
            assert.equal(await win.webContents.executeJavaScript("emojiLayoutCase.finish()"), "passed");
            console.log(JSON.stringify({width, height, mobile, theme, font, ...geometry}));
            win.destroy();
        }
        console.log("Emoji panel layout cases passed");
        app.exit(0);
    })().catch(error => {console.error(error); require("electron").app.exit(1);});
} else {
    require("node:test").test("emoji picker grids scroll inside mobile sheets and desktop dialogs", {timeout: 60000}, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-emoji-layout-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const headless = process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY ?
            ["--no-sandbox", "--disable-gpu", "--ozone-platform=headless"] : [];
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile, ...headless], {env, windowsHide: true, timeout: 55000});
            assert.match(stdout, /Emoji panel layout cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-emoji-layout-"));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
