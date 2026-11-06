const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const tableHTML = `<div class="av__container">
    <div class="av__header"><div class="av__views fn__flex">
        <div class="fn__flex-1"></div>
        <span data-type="av-filter" class="block__icon"><svg></svg></span><div class="fn__space"></div>
        <span data-type="av-sort" class="block__icon"><svg></svg></span><div class="fn__space"></div>
        <button data-type="av-search-icon" class="block__icon"><svg></svg></button>
        <div class="fn__flex av__search"><div data-type="av-search" class="b3-text-field b3-text-field--text" style="width:128px">Query</div></div>
    </div><div class="av__title">Database title</div></div>
    <div class="av__body">
        <div class="av__row av__row--header"><div class="av__colsticky"><div class="av__firstcol"><svg></svg></div></div>
            <div class="av__cell av__cell--header" style="width:200px"><svg class="av__cellheadericon"></svg><span class="av__celltext">Primary</span></div>
            <div class="av__cell av__cell--header" style="width:200px"><svg class="av__cellheadericon"></svg><span class="av__celltext">Related</span></div>
            <div class="block__icons fn__none"></div>
        </div>
        <div class="av__row" data-id="row"><div class="av__colsticky"><div class="av__firstcol"><svg></svg></div></div>
            <div class="av__cell" data-dtype="mSelect" style="width:200px"><span class="b3-chip">Value</span></div>
            <div class="av__cell" data-dtype="relation" style="width:200px"><span class="av__cell--relation"><svg></svg><span class="av__celltext">Related value</span></span></div><div></div>
        </div>
    </div></div>`;

const browserCases = (tableHTML) => {
    const check = require("node:assert/strict");
    const snapshot = (root, selector) => {
        const style = getComputedStyle(root.querySelector(selector));
        return Object.fromEntries(["fontSize", "lineHeight", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
            "marginTop", "marginRight", "marginBottom", "marginLeft", "position", "alignSelf"]
            .map(key => [key, style[key]]));
    };
    for (const panelClass of ["protyle-db-attr__body", "protyle-db-row__body", ""]) {
        for (const width of [320, 1100]) {
            for (const fontSize of [16, 28]) {
                document.body.style.fontSize = fontSize + "px";
                document.documentElement.style.setProperty("--b3-font-size-editor", fontSize + "px");
                document.body.innerHTML = `<div class="protyle-wysiwyg" style="width:${width}px">
                    <div id="native" class="av" data-node-id="native" data-type="NodeAttributeView">${tableHTML}</div></div>
                    <div class="custom-attr ${panelClass}" style="width:${width}px"><div data-av-id="source">
                        <div class="custom-attr__avheader">Attributes</div>
                        <div class="block__icons av__row" data-col-id="field">
                            <span class="block__icon" draggable="true"><svg></svg></span>
                            <span class="block__logo">Field</span>
                            <div class="custom-attr__avvalue"><input class="b3-text-field b3-text-field--text"></div>
                        </div><section class="av-related-view">
                            <div id="related" class="av av-related-view__table" data-type="NodeAttributeView">${tableHTML}</div>
                        </section></div></div>`;
                const native = document.getElementById("native");
                const related = document.getElementById("related");
                const context = `${panelClass || "dialog"}/${width}/${fontSize}`;
                for (const selector of [".av__title", ".av__row--header .av__cell", ".av__cellheadericon",
                    ".av__row[data-id] .av__cell", ".av__cell--relation svg", ".av__celltext", ".b3-chip",
                    '[data-type="av-search"]', '[data-type="av-filter"]', '[data-type="av-sort"]']) {
                    check.deepEqual(snapshot(related, selector), snapshot(native, selector), context + " " + selector);
                }
                check.equal(related.querySelector(".av__title").getBoundingClientRect().height, fontSize * 1.625, context);
                check.equal(related.querySelector('[data-type="av-search"]').getBoundingClientRect().height,
                    native.querySelector('[data-type="av-search"]').getBoundingClientRect().height, context + " search height");
                const cells = related.querySelectorAll(".av__row[data-id] > .av__cell");
                check.notEqual(getComputedStyle(cells[0]).borderRightColor, "rgba(0, 0, 0, 0)", context + " internal separator");
                check.equal(getComputedStyle(cells[1]).borderRightColor, "rgba(0, 0, 0, 0)", context + " outer separator");
                const title = related.querySelector(".av__title");
                check.ok(title.getBoundingClientRect().bottom <= related.querySelector(".av__body").getBoundingClientRect().top,
                    context + " title does not overlap table");
                check.ok(related.getBoundingClientRect().width <= width, context + " host fits panel");
                const input = document.querySelector(".custom-attr__avvalue input");
                check.equal(getComputedStyle(input).minHeight, "34px", context + " field controls keep their sizing");
                if (panelClass) {
                    const drag = document.querySelector(".block__icon[draggable]");
                    check.equal(getComputedStyle(drag).position, "absolute", context + " field drag placement");
                }
            }
        }
    }
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 1500, height: 1000,
            webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
        try {
            const root = path.join(__dirname, "..");
            await win.loadURL("about:blank");
            for (const entry of ["base", "mobile"]) {
                const css = require("sass").compile(path.join(root, `src/assets/scss/${entry}.scss`)).css;
                for (const theme of ["daylight", "midnight"]) {
                    const themeCSS = readFileSync(path.join(root, "appearance/themes", theme, "theme.css"), "utf8");
                    await win.webContents.executeJavaScript(`document.head.innerHTML = "";
                    {const style = document.createElement("style"); style.textContent = ${JSON.stringify(css + themeCSS)};
                    document.head.append(style);}`);
                    const error = await win.webContents.executeJavaScript(`(() => {try {
                    (${browserCases.toString()})(${JSON.stringify(tableHTML)});
                } catch (error) {return error.stack;}})()`);
                    assert.equal(error, undefined, entry + "/" + theme);
                }
            }
            console.log("Related table style cases passed");
            win.destroy(); app.exit(0);
        } catch (error) { console.error(error); win.destroy(); app.exit(1); }
    });
} else {
    require("node:test").test("related tables retain native styles outside the editor in both themes", {timeout: 60000}, async () => {
        const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-related-table-style-"));
        try {
            const args = [__filename, profile];
            if (process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) args.push("--ozone-platform=headless");
            if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(require("electron"), args,
                {env, timeout: 55000, windowsHide: true});
            assert.match(stdout, /Related table style cases passed/);
        } finally { rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}); }
    });
}
