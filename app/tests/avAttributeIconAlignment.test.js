const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {test} = require("node:test");
const sass = require("sass");

const stylesheet = name => sass.compile(path.join(__dirname, `../src/assets/scss/${name}.scss`), {
    logger: sass.Logger.silent,
}).css;
const declarations = (css, selector) => {
    const result = {};
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!match[1].split(",").map(item => item.trim()).includes(selector)) {
            continue;
        }
        for (const declaration of match[2].split(";")) {
            const separator = declaration.indexOf(":");
            if (separator > -1) {
                result[declaration.slice(0, separator).trim()] = declaration.slice(separator + 1).trim();
            }
        }
    }
    return result;
};

for (const name of ["base", "mobile"]) {
    test(`${name} attribute labels center emoji text without changing icon boxes or label truncation`, () => {
        const css = stylesheet(name);
        const label = ".custom-attr .block__logo:not(.popover__block)";
        const icon = declarations(css, `${label} > span.block__logoicon`);
        assert.equal(icon.display, "flex");
        assert.equal(icon["align-items"], "center");
        assert.equal(icon["justify-content"], "center");
        assert.equal(declarations(css, `${label} span`).overflow, undefined);
        const text = declarations(css, `${label} > span:not(.block__logoicon)`);
        assert.equal(text.overflow, "hidden");
        assert.equal(text["text-overflow"], "ellipsis");
        assert.equal(text["white-space"], "nowrap");
        const box = declarations(css, ".block__logoicon");
        assert.equal(box.height, "16px");
        assert.equal(box.width, "16px");
        assert.equal(box.padding, "4px");
    });
}

const browserCases = css => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css + "body {font-family:sans-serif;}";
    document.head.append(style);
    const center = rect => rect.top + rect.height / 2;
    const textRect = element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect();
    };
    for (const surface of ["", "protyle-db-attr__body", "protyle-db-row__body"]) {
        for (const [fontSize, lineHeight] of [[20, "2.5"], [14, "normal"], [16, "normal"], [20, "normal"], [24, "normal"]]) {
            for (const emoji of ["1️⃣", "😀", "👩‍💻"]) {
                document.body.style.fontSize = fontSize + "px";
                document.body.style.lineHeight = lineHeight;
                document.body.innerHTML = `<div class="custom-attr ${surface}"><div data-av-id="database"><div class="block__icons av__row">
<div class="block__logo block__logo--icon"><span class="block__logoicon">${emoji}</span><span>Very long database field name</span></div>
</div></div></div>`;
                const label = document.querySelector(".block__logo");
                const icon = label.firstElementChild;
                const text = label.lastElementChild;
                const bounds = icon.getBoundingClientRect();
                check.equal(bounds.width, 24);
                check.equal(bounds.height, 24);
                check.ok(Math.abs(center(bounds) - center(label.getBoundingClientRect())) < 1);
                // 同一字体的自由行盒作为字形基线参照，避免依赖平台专属的 emoji 字体度量。
                const reference = document.createElement("span");
                reference.textContent = emoji;
                reference.style.cssText = "position:absolute;display:block;font-variant-emoji:emoji";
                document.body.append(reference);
                const expected = center(textRect(reference)) - center(reference.getBoundingClientRect());
                check.ok(Math.abs(center(textRect(icon)) - center(bounds) - expected) < 1,
                    `${surface}/${fontSize}/${lineHeight}/${emoji}: glyph is centered inside the icon box`);
                check.equal(getComputedStyle(icon).overflow, "visible");
                check.equal(getComputedStyle(text).textOverflow, "ellipsis");
                check.ok(text.scrollWidth > text.clientWidth, "long names still truncate");
                for (const tag of ["svg", "img"]) {
                    const replacement = tag === "svg" ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);
                    replacement.setAttribute("class", "block__logoicon");
                    label.replaceChild(replacement, label.firstElementChild);
                    const rect = replacement.getBoundingClientRect();
                    check.equal(rect.width, bounds.width);
                    check.equal(rect.height, bounds.height);
                    check.equal(rect.top, bounds.top);
                    check.notEqual(getComputedStyle(replacement).display, "flex");
                }
            }
        }
    }
    document.body.innerHTML = '<div class="block__logo"><span class="block__logoicon">😀</span></div>' +
        '<div class="custom-attr"><div class="block__logo popover__block"><span class="block__logoicon">😀</span></div></div>';
    for (const icon of document.querySelectorAll(".block__logoicon")) {
        check.notEqual(getComputedStyle(icon).display, "flex", "other logos retain their layout");
    }
    return "Attribute icon alignment cases passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
        win.webContents.on("console-message", event => console.error(event.message));
        try {
            for (const [name, theme, width] of [["base", "daylight", 1280], ["base", "midnight", 420],
                ["mobile", "daylight", 420], ["mobile", "midnight", 1280]]) {
                win.setSize(width, 900);
                await win.loadURL("data:text/html,<html><body></body></html>");
                const css = readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8") + stylesheet(name);
                assert.equal(await win.webContents.executeJavaScript(
                    `try { (${browserCases.toString()})(${JSON.stringify(css)}) } catch (error) { console.error(error.stack); throw error; }`),
                "Attribute icon alignment cases passed");
            }
            console.log("Attribute icon alignment cases passed");
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
    test("attribute icon alignment survives font changes and switching icon types on every panel", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-attribute-icon-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Attribute icon alignment cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-attribute-icon-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
