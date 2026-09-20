import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    const mount: typeof import("./liteSlashMenu").mountLiteSlashMenu = new Function(source +
        "\nreturn mountLiteSlashMenu;")();
    window.siyuan = {languages: {emptyContent: "Empty"}} as unknown as typeof window.siyuan;
    const element = document.createElement("div");
    element.className = "protyle-hint fn__none";
    document.body.appendChild(element);
    const next = document.createElement("div");
    document.body.appendChild(next);
    const panel = document.createElement("div");
    document.body.appendChild(panel);
    let finishRequest: () => void;
    const hint = {
        element,
        enableExtend: false,
        genHTML: (items: IHintData[]) => {
            element.innerHTML = '<div style="flex:1;overflow:auto"></div>';
            items.forEach(item => {
                const button = document.createElement("button");
                button.className = "b3-list-item";
                button.dataset.value = item.value;
                button.innerHTML = item.html;
                element.firstElementChild.appendChild(button);
            });
            element.classList.remove("fn__none");
        },
    };
    const provider = {key: "/", hint: () => [{value: "```", html: "Code"}, {value: "$$", html: "Math", focus: false}]};
    const protyle = {hint, options: {hint: {extend: [provider]}}} as unknown as IProtyle;
    let unmount = mount(protyle, panel);
    check.equal(panel.querySelectorAll("button[data-value]").length, 2);
    check.equal(panel.querySelector('[data-value="$$"]').getAttribute("data-focus"), "false");
    check.equal(hint.enableExtend, true);
    unmount();
    check.equal(element.parentElement, document.body);
    check.equal(element.nextSibling, next);
    check.equal(element.classList.contains("fn__none"), true);
    provider.hint = () => {
        element.classList.remove("fn__none");
        element.textContent = "Loading";
        finishRequest = () => {
            if (hint.enableExtend && !element.classList.contains("fn__none")) {
                hint.genHTML([{value: "skill", html: "Skill"}]);
            }
        };
        return [];
    };
    unmount = mount(protyle, panel);
    check.equal(panel.textContent, "Loading");
    await Promise.resolve();
    finishRequest();
    check.equal(panel.querySelector('[data-value="skill"]').textContent, "Skill");
    unmount();
    unmount = mount(protyle, panel);
    unmount();
    finishRequest();
    check.equal(element.classList.contains("fn__none"), true);
    check.equal(panel.children.length, 0);
    provider.hint = () => [];
    unmount = mount(protyle, panel);
    check.equal(panel.textContent, "Empty");
    unmount();
    return "Mobile slash cases passed";
};

test("mobile slash panel retains synchronous and asynchronous candidates and releases its owner", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = transpileModule(readFileSync(path.join(__dirname, "liteSlashMenu.ts"), "utf8")
        .replace(/^export /gm, ""), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-mobile-slash-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
        browserCases.toString() + ")(" + JSON.stringify(source) + ")")}));
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Mobile slash cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-mobile-slash-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
