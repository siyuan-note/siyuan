import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, luteSource: string, renameSource: string) => {
    const check: typeof assert = require("node:assert/strict");
    new Function(luteSource)();
    const lute = Lute.New();
    const config = {editor: {displayImgName: true, displayImgAlt: true}, readonly: false};
    Object.assign(window, {siyuan: {config, languages: {rename: "Rename", renameAssetTip: "Updates all links"}}});
    const renamed: {path: string, name: string}[] = [];
    const getExtension = (value: string) => require("node:path").posix.extname(value.split("?")[0]);
    const dependencies = {
        getAssetExtension: getExtension,
        getAssetName: (value: string) => require("node:path").posix.basename(value.split("?")[0], getExtension(value))
            .replace(/-\d{14}-\w{7}$/, ""),
        isEncryptedBox: (box: string) => box === "encrypted",
    };
    let options: {value: string, description: string, onConfirm: (value: string, dialog: {destroy: () => void}) => Promise<void>};
    let opens = 0;
    let closes = 0;
    const dialog = {element: document.createElement("div"), destroy: () => closes++};
    const renameAsset = new Function("getAssetName", "openInputDialog", "Constants", "fetchSyncPost", "getAllModels", "getAllEditor",
        renameSource + "\nreturn renameAsset;")(dependencies.getAssetName,
        (value: typeof options) => { options = value; opens++; return dialog; }, {},
        async (_url: string, body: {oldPath: string, newName: string}) => {
            renamed.push({path: body.oldPath, name: body.newName});
            return {code: 0, data: {newPath: "assets/renamed.png"}};
        }, (): {asset: {path: string}[]} => ({asset: []}), (): {reload: (value: boolean) => void}[] => []);
    const render = new Function(...Object.keys(dependencies), "renameAsset", source + "\nreturn renderImageDisplay;")(...Object.values(dependencies), renameAsset);
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
    check.equal(name.querySelector("input"), null);
    check.equal(options.value, "example");
    check.equal(options.description, "Updates all links");
    check.equal(renamed.length, 0);
    check.equal(lute.BlockDOM2StdMd(root.innerHTML), original);
    await options.onConfirm("renamed", dialog);
    check.deepEqual(renamed, [{path: "assets/example-20260930090000-abcdefg.png", name: "renamed"}]);
    name.click();
    dialog.destroy();
    check.equal(name.querySelector("input"), null);
    check.equal(renamed.length, 1);
    check.equal(closes, 2);
    check.equal(opens, 2);
    root.setAttribute("data-readonly", "true");
    name.click();
    check.equal(name.querySelector("input"), null);
    check.equal(opens, 2);
    root.setAttribute("data-readonly", "false");
    root.setAttribute("data-notebook-id", "encrypted");
    name.click();
    check.equal(name.querySelector("input"), null);
    check.equal(opens, 2);
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
    check.equal(opens, 3, "restored image names open the rename dialog");
    check.equal(restoredName.querySelector("input"), null);
    return "Image display cases passed";
};

test("image names open a rename dialog that updates references only after confirmation", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = transpileModule(readFileSync(path.resolve(__dirname, "imageDisplay.ts"), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const luteSource = readFileSync("stage/protyle/js/lute/lute.min.js", "utf8");
    const renameSource = transpileModule(readFileSync(path.resolve(__dirname, "../../editor/rename.ts"), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-image-display-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" +
        JSON.stringify(source) + "," + JSON.stringify(luteSource) + "," + JSON.stringify(renameSource) + ")";
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
