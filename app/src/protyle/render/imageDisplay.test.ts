import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, luteSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    new Function(luteSource)();
    const lute = Lute.New();
    const config = {editor: {displayImgName: true, displayImgAlt: true}, readonly: false};
    Object.assign(window, {siyuan: {config, languages: {rename: "Rename"}}});
    const renamed: {path: string, name: string}[] = [];
    const getExtension = (value: string) => require("node:path").posix.extname(value.split("?")[0]);
    const dependencies = {
        getAssetExtension: getExtension,
        getAssetName: (value: string) => require("node:path").posix.basename(value.split("?")[0], getExtension(value))
            .replace(/-\d{14}-\w{7}$/, ""),
        isEncryptedBox: (box: string) => box === "encrypted",
        validateName: () => true,
        renameAssetFile: async (assetPath: string, name: string) => {
            renamed.push({path: assetPath, name});
            return "assets/renamed.png";
        },
    };
    const render = new Function(...Object.keys(dependencies), source + "\nreturn renderImageDisplay;")(...Object.values(dependencies));
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    root.innerHTML = lute.Md2BlockDOM('![description](assets/example-20260930090000-abcdefg.png "caption")');
    document.body.append(root);
    const original = lute.BlockDOM2StdMd(root.innerHTML);
    render(root);
    render(root);
    check.equal(root.querySelectorAll(".img__name").length, 1);
    const name = root.querySelector<HTMLElement>(".img__name");
    check.equal(name.textContent, "example.png");
    const alt = root.querySelector<HTMLElement>(".img__alt");
    check.equal(alt.textContent, "description");
    check.equal(alt.previousElementSibling.className, "protyle-action__title");
    check.equal(lute.BlockDOM2StdMd(root.innerHTML), original);
    name.click();
    let input = name.querySelector("input");
    check.equal(input.value, "example");
    check.equal(lute.BlockDOM2StdMd(root.innerHTML), original);
    input.value = "renamed";
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    await new Promise(resolve => setTimeout(resolve, 0));
    check.deepEqual(renamed, [{path: "assets/example-20260930090000-abcdefg.png", name: "renamed"}]);
    name.click();
    input = name.querySelector("input");
    input.value = "discarded";
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    check.equal(name.querySelector("input"), null);
    check.equal(renamed.length, 1);
    root.setAttribute("data-readonly", "true");
    name.click();
    check.equal(name.querySelector("input"), null);
    root.setAttribute("data-readonly", "false");
    root.setAttribute("data-notebook-id", "encrypted");
    name.click();
    check.equal(name.querySelector("input"), null);
    config.editor.displayImgName = false;
    config.editor.displayImgAlt = false;
    render(root);
    check.equal(root.querySelector(".img__name"), null);
    check.equal(root.querySelector(".img__alt"), null);
    check.equal(lute.BlockDOM2StdMd(root.innerHTML), original);
    config.editor.displayImgName = true;
    root.removeAttribute("data-notebook-id");
    render(root);
    const snapshot = root.innerHTML;
    root.innerHTML = snapshot;
    render(root);
    const restoredName = root.querySelector<HTMLElement>(".img__name");
    restoredName.click();
    check.ok(restoredName.querySelector("input"), "restored image names remain editable");
    return "Image display cases passed";
};

test("image names support inline renaming without changing document serialization", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = transpileModule(readFileSync(path.resolve(__dirname, "imageDisplay.ts"), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const luteSource = readFileSync("stage/protyle/js/lute/lute.min.js", "utf8");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-image-display-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" +
        JSON.stringify(source) + "," + JSON.stringify(luteSource) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 40000});
        assert.match(result.stdout, /Image display cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-image-display-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
