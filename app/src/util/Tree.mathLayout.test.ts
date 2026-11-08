import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {pathToFileURL} from "node:url";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile, Logger} from "sass";

const browserCases = async (styles: string[], katexPath: string) => {
    const check: typeof assert = require("node:assert/strict");
    const katex: typeof window.katex = require(katexPath);
    const style = document.createElement("style");
    document.head.append(style);
    for (const css of styles) {
        style.textContent = css;
        for (const fontSize of [14, 24]) {
            for (const width of [140, 180, 220, 260, 320]) {
                for (const variable of ["I", "A"]) {
                    const root = document.createElement("ul");
                    root.className = "b3-list b3-list--background";
                    root.style.cssText = `width:${width}px;font-size:${fontSize}px;--b3-ui-list-height:2em;`;
                    root.innerHTML = '<li class="b3-list-item b3-list-item--hide-action" data-treetype="outline">' +
                        '<span class="b3-list-item__text">' + "啊".repeat(5) + '<span data-type="inline-math">' +
                        katex.renderToString(`A_{\\mathrm{AAA}}-${variable}_{\\mathrm{AA}}`, {
                            displayMode: false, output: "html", macros: {}, trust: false, strict: () => "warn",
                        }) +
                        "</span>" + "啊".repeat(5) + '</span><span class="b3-list-item__action">...</span></li>';
                    document.body.append(root);
                    await document.fonts.ready;
                    const row = root.firstElementChild.getBoundingClientRect();
                    for (const hover of [false, true, false]) {
                        await require("electron").ipcRenderer.invoke("outline-hover", hover ? row.left + 5 : 750,
                            hover ? row.top + row.height / 2 : 550);
                        await new Promise(resolve => requestAnimationFrame(resolve));
                        const formula = root.querySelector<HTMLElement>('[data-type="inline-math"]');
                        check.equal(formula.getClientRects().length, 1,
                            `outline formula must remain one box at width ${width}, font ${fontSize}, variable ${variable}`);
                        const bounds = formula.getBoundingClientRect();
                        formula.querySelectorAll<HTMLElement>(".katex-base").forEach(base => {
                            const rect = base.getBoundingClientRect();
                            check.ok(rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1,
                                "formula bases remain inside the same clipping box");
                        });
                        check.equal(getComputedStyle(root.querySelector(".b3-list-item__action")).display,
                            hover ? "flex" : "none", "hover changes the space available for the title");
                    }
                    root.remove();
                }
            }
        }
    }
    return "Outline math layout passed";
};

test("desktop and mobile outlines keep inline formulas together when truncating headings", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const katexPath = path.resolve(__dirname, "../../stage/protyle/js/katex/katex.min.js");
    const katexCSS = readFileSync(path.join(path.dirname(katexPath), "katex.min.css"), "utf8")
        .replace(/url\(fonts\//g, `url(${pathToFileURL(path.join(path.dirname(katexPath), "fonts")).href}/`);
    const styles = ["base", "mobile"].flatMap(name => {
        const css = compile(path.resolve(__dirname, `../assets/scss/${name}.scss`), {logger: Logger.silent}).css;
        return ["daylight", "midnight"].map(theme => readFileSync(path.resolve(__dirname,
            `../../appearance/themes/${theme}/theme.css`), "utf8") + css + katexCSS);
    });
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-outline-math-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false,
    }});
    ipcMain.handle("outline-hover", (event, x, y) => event.sender.sendInputEvent({type: "mouseMove", x, y}));
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + JSON.stringify(styles) + ", " + JSON.stringify(katexPath) + ")")}));
        win.destroy();
        app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Outline math layout passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-outline-math-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
