const assert = require("node:assert/strict");
const {execFile} = require("node:child_process");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {promisify} = require("node:util");
const sass = require("sass");
const ts = require("typescript");

const slashItemSource = () => {
    const filename = path.join(__dirname, "../src/mobile/util/keyboardToolbar.ts");
    const file = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
    const statement = file.statements.find(item => ts.isVariableStatement(item) &&
        item.declarationList.declarations.some(declaration => declaration.name.getText(file) === "getSlashItem"));
    return ts.transpileModule(statement.getText(file), {
        compilerOptions: {target: ts.ScriptTarget.ES2021},
    }).outputText;
};

const browserCases = (css, mobile, fontSize, getSlashItem) => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css + `button {font-size:${fontSize}px;}`;
    document.head.append(style);
    const icon = '<svg width="16" height="16" style="flex:none;vertical-align:middle"><use xlink:href="#iconAdd"></use></svg>';
    const first = (text, graphic = "", meta = "") => `<div class="b3-list-item__first">${graphic}<span class="b3-list-item__text">${text}</span>${meta}</div>`;
    const custom = first("测试块", icon);
    const sample = first("插入表情", "", '<span class="b3-list-item__meta">😊</span>');
    const long = first("Long plugin command ".repeat(20), icon, '<span class="b3-list-item__meta">😊</span>');
    const value = "plugin\u200bminimal-test-siyuan\u200binsertMinimalTestBlock";
    const html = [custom, sample, long].map((content, index) => mobile ?
        getSlashItem(`plugin:sample:${index}`, value, "", content, "true") :
        `<button style="width:calc(100% - 16px)" class="b3-list-item b3-list-item--two" data-value="${encodeURIComponent(value)}">${content}</button>`).join("");
    document.body.innerHTML = mobile ?
        `<div class="keyboard"><div class="keyboard__util"><div class="keyboard__slash-block">${html}</div></div></div>` :
        `<div style="width:280px">${html}</div>`;
    if (mobile) {
        const group = document.querySelector(".keyboard__slash-block");
        group.insertAdjacentHTML("beforeend", getSlashItem("heading1", "# ", "iconH1", "Heading", "true"));
        group.insertAdjacentHTML("beforeend", getSlashItem("raw", "raw", "", "Raw <em>HTML</em>", "true"));
        // 常用分组复用按钮副本，也应保留插件内容布局。
        group.appendChild(group.firstElementChild.cloneNode(true));
    }
    const overlaps = (a, b) => Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
    for (const row of document.querySelectorAll(".b3-list-item__first")) {
        const bounds = row.getBoundingClientRect();
        const children = Array.from(row.children, element => element.getBoundingClientRect());
        check.ok(bounds.height <= Math.max(...children.map(rect => rect.height)) + 1,
            "plugin icons, labels and metadata occupy one row");
        for (let i = 1; i < children.length; i++) {
            check.ok(overlaps(children[i - 1], children[i]), "adjacent plugin elements overlap vertically");
            check.ok(children[i - 1].right <= children[i].left + 1, "plugin elements retain their horizontal order");
        }
        check.ok(bounds.right <= row.closest("button").getBoundingClientRect().right + 1,
            "plugin contents fit inside the button");
    }
    const buttons = document.querySelectorAll("button");
    const longLabel = buttons[2].querySelector(".b3-list-item__text");
    check.ok(longLabel.scrollWidth > longLabel.clientWidth || longLabel.scrollHeight > longLabel.clientHeight,
        "long plugin labels retain truncation");
    check.equal(getComputedStyle(longLabel).webkitLineClamp, "1");
    check.equal(buttons[1].querySelector(".b3-list-item__meta").textContent, "😊");
    let clicks = 0;
    document.body.addEventListener("click", event => {
        const button = event.target.closest("button");
        check.equal(decodeURIComponent(button.dataset.value), value);
        clicks++;
    });
    buttons[0].querySelector("svg").dispatchEvent(new MouseEvent("click", {bubbles: true}));
    buttons[0].querySelector(".b3-list-item__text").click();
    buttons[1].querySelector(".b3-list-item__meta").click();
    check.equal(clicks, 3, "icons, text and metadata still target the plugin command button");
    if (mobile) {
        const builtin = buttons[3];
        check.ok(overlaps(builtin.querySelector("svg").getBoundingClientRect(),
            builtin.querySelector(".keyboard__slash-text").getBoundingClientRect()));
        check.equal(builtin.querySelector("svg").getBoundingClientRect().width, 20);
        check.equal(buttons[4].querySelector("em").textContent, "HTML", "raw plugin HTML survives");
    }
    return "Plugin slash layout cases passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
        win.webContents.on("console-message", event => console.error(event.message));
        try {
            for (const name of ["mobile", "base"]) {
                const css = sass.compile(path.join(__dirname, `../src/assets/scss/${name}.scss`), {
                    logger: sass.Logger.silent,
                }).css;
                for (const theme of ["daylight", "midnight"]) {
                    const themedCSS = readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8") + css;
                    for (const width of [320, 390, 768]) {
                        win.setSize(width, 900);
                        for (const fontSize of [14, 24]) {
                            await win.loadURL("data:text/html,<html><body></body></html>");
                            const result = await win.webContents.executeJavaScript(
                                `try { const escapeHtml = value => value; ${slashItemSource()}
                                (${browserCases.toString()})(${JSON.stringify(themedCSS)}, ${name === "mobile"}, ${fontSize}, getSlashItem);
                                } catch (error) { console.error(error.stack); throw error; }`);
                            assert.equal(result, "Plugin slash layout cases passed", `${name}/${theme}/${width}/${fontSize}`);
                        }
                    }
                }
            }
            console.log("Plugin slash layout cases passed");
            app.exit(0);
        } catch (error) {
            console.error(error);
            app.exit(1);
        }
    }).catch(error => {
        console.error(error);
        app.exit(1);
    });
} else {
    test("plugin slash icons, labels and metadata stay in one row on mobile and desktop", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-plugin-slash-"));
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, windowsHide: true, timeout: 55000,
            });
            assert.match(stdout, /Plugin slash layout cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-plugin-slash-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
