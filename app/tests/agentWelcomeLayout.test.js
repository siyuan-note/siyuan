const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, readdirSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const sass = require("sass");
const ts = require("typescript");

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
    test(`${name} welcome isolates greetings while suggestions size to their contents within the available width`, () => {
        const css = stylesheet(name);
        const messages = declarations(css, ".agent-chat__messages");
        assert.equal(messages.display, "flex");
        assert.equal(messages["flex-direction"], "column");
        assert.ok([undefined, "normal", "stretch"].includes(messages["align-items"]));
        const welcome = declarations(css, ".agent-welcome");
        assert.equal(welcome.margin, "auto 0");
        assert.equal(welcome.width, undefined);
        assert.equal(welcome.padding, "16px 24px");
        assert.equal(welcome["align-items"], "center");
        assert.equal(welcome["text-align"], "center");
        const examples = declarations(css, ".agent-welcome__examples");
        assert.equal(examples.width, "max-content");
        assert.equal(examples["max-width"], "min(100%, 300px)");
        assert.equal(declarations(css, ".agent-welcome__example")["overflow-wrap"], "anywhere");
        assert.equal(declarations(css, ".agent-welcome__greeting")["white-space"], "pre-line");
    });
}

const compile = file => ts.transpileModule(readFileSync(path.join(__dirname, "../src", file), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
}).outputText;
const samples = () => {
    const escape = {};
    runInNewContext(compile("util/escape.ts"), {exports: escape});
    const renderer = compile("layout/dock/agent/AgentMessageRenderer.ts");
    const directory = path.join(__dirname, "../appearance/langs");
    return readdirSync(directory).filter(file => file.endsWith(".json")).map(file => {
        const languages = JSON.parse(readFileSync(path.join(directory, file), "utf8"));
        const exports = {};
        runInNewContext(renderer, {exports, require: () => escape, window: {siyuan: {languages}}});
        const keys = Object.keys(languages).filter(key => /^agentWelcome(?:First|Return|Morning|Day|Evening|Late)\d$/.test(key));
        assert.equal(keys.length, 24, `${file}: all greeting variants enter the layout regression`);
        return {locale: file, greetings: keys.map(key => ({key, html: exports.renderWelcomeHTML(true, key),
            noModelHTML: exports.renderWelcomeHTML(false, key)}))};
    });
};

// 使用真实渲染器和编译样式测量布局；无浏览器的环境只执行上面的样式契约检查。
const browserCases = ({css, languages, mobile}) => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css + "body{font-size:14px}#host{display:flex;flex-direction:column;height:800px}";
    document.head.append(style);
    document.body.innerHTML = `<div id="host" class="sy__agentChat${mobile ? " sy__agentChat--mobile" : ""}">` +
        '<div class="agent-chat__messages-wrap"><div class="agent-chat__messages fn__flex-1"></div></div></div>';
    const host = document.getElementById("host");
    const messages = document.querySelector(".agent-chat__messages");
    const near = (actual, expected, label) => check.ok(Math.abs(actual - expected) < 1, `${label}: ${actual} / ${expected}`);
    for (const width of [240, 320, 380, 760]) {
        host.style.width = width + "px";
        for (const language of languages) {
            host.dir = ["ar.json", "he.json"].includes(language.locale) ? "rtl" : "ltr";
            let firstWidth;
            let naturalWidth;
            for (const greeting of language.greetings) {
                for (const hasModel of [true, false]) {
                    messages.innerHTML = hasModel ? greeting.html : greeting.noModelHTML;
                    const label = `${mobile}/${width}/${language.locale}/${greeting.key}/${hasModel}`;
                    const welcome = document.querySelector(".agent-welcome");
                    const outer = welcome.getBoundingClientRect();
                    const padding = getComputedStyle(welcome);
                    const messagePadding = getComputedStyle(messages);
                    const available = messages.clientWidth - parseFloat(messagePadding.paddingLeft) - parseFloat(messagePadding.paddingRight);
                    near(outer.width, available, `welcome includes padding ${label}`);
                    near(outer.left, messages.getBoundingClientRect().left + messages.clientLeft +
                        parseFloat(messagePadding.paddingLeft), `left edge ${label}`);
                    if (hasModel) {
                        const innerWidth = outer.width - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
                        const buttons = [...document.querySelectorAll(".agent-welcome__example")];
                        check.equal(buttons.length, 4, label);
                        if (naturalWidth === undefined) {
                            // 克隆真实按钮以保留字体和盒模型，单独测量各条文案未换行的外宽。
                            naturalWidth = Math.max(...buttons.map(button => {
                                const probe = button.cloneNode(true);
                                probe.style.cssText = "position:fixed;visibility:hidden;width:max-content;max-width:none;white-space:nowrap";
                                button.parentElement.append(probe);
                                const measured = probe.getBoundingClientRect().width;
                                probe.remove();
                                return measured;
                            }));
                        }
                        const expected = Math.min(naturalWidth, 300, innerWidth);
                        for (const button of buttons) {
                            const bounds = button.getBoundingClientRect();
                            near(bounds.width, expected, `button width ${label}`);
                            near(bounds.left + bounds.width / 2, outer.left + outer.width / 2, `center ${label}`);
                            near(bounds.width, firstWidth ?? bounds.width, `stable across greetings ${label}`);
                        }
                        firstWidth = buttons[0].getBoundingClientRect().width;
                    } else {
                        const card = document.querySelector(".agent-welcome__no-model").getBoundingClientRect();
                        check.ok(card.left >= outer.left && card.right <= outer.right, `no-model bounds ${label}`);
                        near(card.left + card.width / 2, outer.left + outer.width / 2, `no-model center ${label}`);
                    }
                }
            }
        }
    }
    for (const direction of ["ltr", "rtl"]) {
        host.dir = direction;
        for (const width of [240, 760]) {
            host.style.width = width + "px";
            messages.innerHTML = languages[0].greetings[0].html;
            const buttons = [...document.querySelectorAll(".agent-welcome__example")];
            buttons[0].textContent = "W".repeat(120);
            const welcome = document.querySelector(".agent-welcome");
            const padding = getComputedStyle(welcome);
            const innerWidth = welcome.getBoundingClientRect().width - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
            const expected = Math.min(300, innerWidth);
            const label = `${mobile}/${direction}/${width}`;
            for (const button of buttons) {
                near(button.getBoundingClientRect().width, expected, `long token keeps equal bounded widths ${label}`);
            }
            check.ok(buttons[0].scrollWidth <= buttons[0].clientWidth + 1, `long token stays inside the button ${label}`);
            const range = document.createRange();
            range.selectNodeContents(buttons[0]);
            check.ok(range.getClientRects().length > 1, `long token wraps ${label}`);
        }
    }
    return "Agent welcome layout cases passed";
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 900, height: 900,
            webPreferences: {nodeIntegration: true, contextIsolation: false}});
        try {
            const languages = samples();
            for (const name of ["base", "mobile"]) {
                const compiled = stylesheet(name);
                for (const theme of ["daylight", "midnight"]) {
                    await win.loadURL("data:text/html,<html><body></body></html>");
                    const css = readFileSync(path.join(__dirname, `../appearance/themes/${theme}/theme.css`), "utf8") + compiled;
                    assert.equal(await win.webContents.executeJavaScript(
                        `(${browserCases.toString()})(${JSON.stringify({css, languages, mobile: name === "mobile"})})`),
                    "Agent welcome layout cases passed");
                }
            }
            console.log("Agent welcome layout cases passed");
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
    test("welcome buttons stay stable across localized greetings, narrow widths and both model states", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 120000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-agent-welcome-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 110000});
            assert.match(stdout, /Agent welcome layout cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-agent-welcome-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
