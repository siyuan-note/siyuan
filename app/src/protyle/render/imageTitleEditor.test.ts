import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";
import {compile} from "sass";

const browserCases = async (source: string, luteSource: string, css: string, caseName: string) => {
    const check: typeof assert = require("node:assert/strict");
    new Function(luteSource)();
    const lute = Lute.New();
    Object.assign(window, {siyuan: {config: {editor: {displayImgName: false, displayImgAlt: false}, readonly: false},
        languages: {title: "Title"}, zIndex: 1}});
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    root.innerHTML = lute.Md2BlockDOM('![description](assets/image.png "original")');
    document.body.append(root);
    root.style.width = "min(600px, calc(100vw - 32px))";
    root.style.margin = "40px 16px";
    const next = document.createElement("p");
    next.textContent = "Following paragraph";
    document.body.append(next);
    const transactions: {oldHTML: string, newHTML: string}[] = [];
    const api = new Function("dayjs", "hideTooltip", "hasClosestBlock", "updateTransaction", "TABLE_CELL_RICH_ATTRIBUTE",
        "getAssetName", "getAssetExtension", "renameAsset", "isEncryptedBox", "callMobileAppShowKeyboard", source +
        "\nreturn {bindImageTitleEditor, renderImageDisplay, getImageTitle, setImageTitle, getAnchoredInputMask};")(
        () => ({format: () => "20261010140000"}), () => {}, (element: HTMLElement) => element.closest("[data-node-id]"),
        (_protyle: IProtyle, block: HTMLElement, oldHTML: string) => transactions.push({oldHTML, newHTML: block.outerHTML}),
        "custom-sy-cell-rich", () => "image", () => ".png", () => {}, () => false, () => {},
    );
    const protyle = {disabled: false, toolbar: {isMultiSelectMode: () => false}};
    api.renderImageDisplay(root);
    const binding = api.bindImageTitleEditor(protyle, root);
    let editorClicks = 0;
    let editorInputs = 0;
    let editorKeys = 0;
    root.addEventListener("click", () => editorClicks++);
    root.addEventListener("input", () => editorInputs++);
    root.addEventListener("keydown", () => editorKeys++);
    const caption = () => root.querySelector<HTMLElement>(".protyle-action__title");
    const image = () => root.querySelector<HTMLImageElement>("img");
    const textarea = () => document.querySelector<HTMLTextAreaElement>(".b3-text-field__mask textarea");
    const original = lute.BlockDOM2StdMd(root.innerHTML);
    image().style.width = "180px";
    image().style.height = "140px";
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    const originalHTML = root.innerHTML;
    const originalNextTop = next.getBoundingClientRect().top;
    check.equal(caption().tabIndex, 0);
    caption().dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    check.equal(editorKeys, 0, "caption activation does not insert a paragraph");
    check.equal(textarea().value, "original");
    check.equal(root.querySelector("textarea"), null, "draft input is outside the editable document");
    check.equal(api.getAnchoredInputMask().parentElement, document.body);
    check.equal(api.getAnchoredInputMask().getAttribute("aria-modal"), "true");
    check.equal(document.elementFromPoint(innerWidth - 8, innerHeight - 8), api.getAnchoredInputMask(),
        "global mask intercepts background pointer actions");
    if (process.env.SIYUAN_IMAGE_TITLE_CAPTURE) {
        await require("electron").ipcRenderer.invoke("capture", caseName);
    }
    check.equal(editorClicks, 0, "caption clicks do not trigger image menus or previews");
    textarea().value = "cancelled\n".repeat(50);
    textarea().dispatchEvent(new InputEvent("input", {bubbles: true}));
    await new Promise(requestAnimationFrame);
    check.equal(root.innerHTML, originalHTML, "typing does not mutate document nodes");
    check.equal(next.getBoundingClientRect().top, originalNextTop, "growing input does not shift following content");
    check.ok(textarea().getBoundingClientRect().bottom <= innerHeight - 8);
    check.equal(getComputedStyle(textarea()).resize, "none", "resizing cannot stretch the editor layout");
    check.equal(editorInputs, 0);
    textarea().dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    check.equal(textarea(), null);
    check.equal(transactions.length, 0);
    check.equal(lute.BlockDOM2StdMd(root.innerHTML), original);

    caption().click();
    textarea().value = "<literal> & updated";
    textarea().dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", isComposing: true, bubbles: true}));
    check.ok(textarea(), "IME confirmation does not save the draft");
    textarea().dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    check.equal(transactions.length, 1);
    check.equal(api.getImageTitle(image()), "<literal> & updated");
    check.equal(caption().textContent, "<literal> & updated");
    check.equal(caption().querySelector("literal"), null);
    check.equal(image().hasAttribute("title"), false);
    check.match(lute.BlockDOM2StdMd(root.innerHTML), /"<literal> & updated"/);
    check.equal(lute.BlockDOM2StdMd(transactions[0].oldHTML), original);
    check.equal(transactions[0].newHTML.includes("textarea"), false);
    check.equal(transactions[0].oldHTML.includes("textarea"), false);

    root.innerHTML = transactions[0].oldHTML;
    api.renderImageDisplay(root);
    check.equal(lute.BlockDOM2StdMd(root.innerHTML), original, "undo restores the previous caption");
    root.setAttribute("contenteditable", "false");
    caption().dispatchEvent(new PointerEvent("pointerdown", {pointerType: "touch", bubbles: true}));
    caption().click();
    check.ok(textarea(), "mobile captions use the same editing entry point");
    textarea().value = "touch edit";
    check.equal(document.activeElement, textarea(), "title textarea receives focus on touch editing");
    textarea().blur();
    textarea()?.dispatchEvent(new FocusEvent("blur"));
    check.equal(textarea(), null, "blur closes the floating title editor");
    check.equal(transactions.length, 2);
    check.equal(api.getImageTitle(image()), "touch edit");

    root.setAttribute("data-readonly", "true");
    caption().click();
    check.equal(textarea(), null);
    root.removeAttribute("data-readonly");
    caption().click();
    textarea().value = "locked draft";
    protyle.disabled = true;
    binding.flush();
    check.equal(transactions.length, 2);
    check.equal(api.getImageTitle(image()), "touch edit");
    protyle.disabled = false;
    caption().click();
    textarea().value = "pending draft";
    binding.flush();
    check.equal(transactions.length, 3, "editor handoff saves the pending draft");
    check.equal(textarea(), null);

    api.setImageTitle(image(), "first\nsecond");
    caption().firstElementChild.textContent = "first\nsecond";
    caption().click();
    check.equal(textarea().value, "first\nsecond");
    textarea().blur();
    textarea()?.dispatchEvent(new FocusEvent("blur"));
    check.equal(transactions.length, 3, "opening a multiline title preserves it without creating a transaction");
    caption().click();
    textarea().value = "stale draft";
    api.setImageTitle(image(), "remote title");
    binding.flush();
    check.equal(api.getImageTitle(image()), "remote title");
    check.equal(caption().textContent, "remote title");
    check.equal(transactions.length, 3, "concurrent title updates are not overwritten");
    const clicksBeforeMask = editorClicks;
    caption().click();
    textarea().value = "outside save";
    const mask = api.getAnchoredInputMask();
    mask.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, cancelable: true}));
    check.ok(textarea(), "mask stays in place until click to prevent click-through");
    mask.click();
    check.equal(api.getImageTitle(image()), "outside save");
    check.equal(editorClicks, clicksBeforeMask, "outside click does not reach the editor behind the mask");
    check.equal(transactions.length, 4);
    caption().click();
    textarea().value = "tab save";
    textarea().dispatchEvent(new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true}));
    check.equal(api.getImageTitle(image()), "tab save");
    check.equal(document.activeElement, caption());
    check.equal(transactions.length, 5);
    caption().click();
    textarea().value = "detached draft";
    const block = image().closest("[data-node-id]");
    const savedBlock = block.outerHTML;
    block.remove();
    await new Promise(requestAnimationFrame);
    check.equal(textarea(), null, "removing the owning image releases the global mask");
    check.equal(api.getAnchoredInputMask(), undefined);
    check.equal(transactions.length, 5);
    root.insertAdjacentHTML("afterbegin", savedBlock);
    api.renderImageDisplay(root);
    caption().click();
    textarea().value = "";
    binding.destroy();
    check.equal(transactions.length, 6);
    check.equal(api.getImageTitle(image()), "");
    check.equal(image().hasAttribute("data-title"), false);
    check.equal(textarea(), null);
    caption().click();
    check.equal(textarea(), null, "destroy removes delegated listeners");
    return "Image title editor cases passed";
};

test("image titles use a global floating input without changing document layout or leaking drafts", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = ["../../dialog/anchoredInputPosition.ts", "../../dialog/anchoredInput.ts",
        "imageTitle.ts", "imageDisplay.ts", "imageTitleEditor.ts"].map(file =>
        transpileModule(readFileSync(path.join(__dirname, file), "utf8")
            .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText).join("\n");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-image-title-test-"));
    const script = path.join(temporary, "run.cjs");
    const css = compile("src/assets/scss/base.scss", {logger: {warn: () => {}}}).css;
    const cases = [{name: "daylight", width: 800, theme: "daylight"}, {name: "dark", width: 800, theme: "midnight"},
        {name: "narrow-large-font", width: 320, theme: "daylight"}].map(fixture => ({...fixture,
        code: "const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(source) + "," +
            JSON.stringify(readFileSync("stage/protyle/js/lute/lute.min.js", "utf8")) + "," +
            JSON.stringify(css + readFileSync(`appearance/themes/${fixture.theme}/theme.css`, "utf8") +
                (fixture.width === 320 ? ".protyle-wysiwyg {font-size:32px;}" : "")) + "," +
            JSON.stringify(fixture.name) + ")",
    }));
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
const {writeFileSync} = require("node:fs");
const path = require("node:path");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
    let win;
    ipcMain.handle("capture", async (_event, name) => {
        writeFileSync(path.join(process.env.SIYUAN_IMAGE_TITLE_CAPTURE, name + ".png"), (await win.capturePage()).toPNG());
    });
    try {
        for (const fixture of ${JSON.stringify(cases)}) {
            win = new BrowserWindow({show: false, width: fixture.width, height: 600,
                webPreferences: {nodeIntegration: true, contextIsolation: false}});
            await win.loadURL("data:text/html,<html><body></body></html>");
            console.log(await win.webContents.executeJavaScript(fixture.code));
            win.destroy();
        }
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 40000});
        assert.match(result.stdout, /Image title editor cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) && path.basename(temporary).startsWith("siyuan-image-title-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
