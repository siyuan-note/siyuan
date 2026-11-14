import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const checkSnapshotPreview = async (previewSource: string, detailSource: string, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const root = document.createElement("div");
    root.style.height = "80vh";
    root.style.fontSize = "24px";
    document.body.append(root);
    const requests: Array<(response: {data: {title: string, content: string, displayInText?: boolean}}) => void> = [];
    const files = [
        {id: "original", path: "/box/original.sy"},
        {id: "image", path: "/assets/image.png"},
        {id: "large", path: "/box/large.sy"},
        {id: "untitled", path: "/box/untitled.sy"},
    ];
    const load = (source: string, modules: Record<string, unknown>) => {
        const exports = {};
        new Function("exports", "require", source)(exports, (name: string) => modules[name] ?? {});
        return exports;
    };
    const fetch = {
        fetchPost: (_url: string, _request: unknown, callback: typeof requests[number]) => requests.push(callback),
        fetchSyncPost: async () => ({code: 0, data: {snapshots: [{id: "snapshot", created: 1, memo: "", files}]}}),
    };
    const repoFile = load(previewSource, {
        "../asset/renderAssets": {renderAssetsPreview: () => "<img>"},
        "../constants": {Constants: {SIYUAN_ASSETS_IMAGE: [".png"], SIYUAN_ASSETS_AUDIO: [], SIYUAN_ASSETS_VIDEO: []}},
        "../protyle": {Protyle: class {
            protyle: HTMLElement;
            constructor(_app: unknown, container: HTMLElement) {
                container.classList.add("protyle");
                this.protyle = container;
            }
            destroy() { this.protyle.replaceChildren(); }
        }},
        "../protyle/util/onGet": {
            disabledProtyle() {},
            onGet: ({data, protyle}: {data: {data: {content: string}}, protyle: HTMLElement}) => {
                protyle.textContent = data.data.content;
            },
        },
        "../util/fetch": fetch,
        "../util/pathName": {pathPosix: () => require("node:path").posix},
    });
    const {mountSnapshotDetail} = load(detailSource, {
        "./repoFile": repoFile,
        "../util/fetch": fetch,
        "../util/escape": {escapeHtml: (value: string) => value},
        "dayjs": {__esModule: true, default: () => ({format: () => "2026-01-01"})},
    }) as typeof import("./snapshotDetail");
    Object.assign(window, {siyuan: {languages: {loading: "Loading"}}});
    const detail = mountSnapshotDetail(undefined, root, {id: "snapshot", fileID: "original", tags: [], created: 1, memo: ""}, "box");
    await detail.loaded;
    check.equal(requests.length, 1, root.querySelector("[data-detail-status]").textContent);
    const title = root.querySelector<HTMLElement>('[data-type="snapshotFileTitle"]');
    const body = root.querySelector<HTMLElement>('[data-type="snapshotFileContent"]');
    const select = (id: string) => root.querySelector<HTMLElement>(`li[data-id="${id}"]`).click();
    const reply = (data: Parameters<typeof requests[number]>[0]["data"]) => requests.shift()({data});
    const storedTitle = "<em>Old title</em> " + "long".repeat(150);
    check.equal(getComputedStyle(title).display, "none");
    reply({title: storedTitle, content: "Snapshot body"});
    check.equal(title.textContent, storedTitle);
    check.notEqual(getComputedStyle(title).display, "none");
    check.equal(title.children.length, 0);
    check.equal(body.textContent, "Snapshot body");
    check.ok(title.getBoundingClientRect().bottom <= body.getBoundingClientRect().top);
    check.ok(title.scrollWidth <= title.clientWidth + 1);
    check.ok(body.clientHeight >= body.firstElementChild.clientHeight);
    check.ok(body.firstElementChild.clientHeight >= 155);

    select("large");
    check.equal(getComputedStyle(title).display, "none");
    select("image");
    const lateDocument = requests.shift();
    reply({title: "/assets/image.png", content: "assets/image.png", displayInText: true});
    lateDocument({data: {title: "Late title", content: "Old body"}});
    check.equal(title.textContent, "");
    check.equal(getComputedStyle(title).display, "none");
    check.ok(body.querySelector("img"));

    select("large");
    reply({title: "Large snapshot document", content: "Markdown body", displayInText: true});
    check.equal(title.textContent, "Large snapshot document");
    check.equal(body.querySelector("textarea").value, "Markdown body");

    select("untitled");
    reply({title: "", content: "Untitled document body"});
    check.equal(getComputedStyle(title).display, "none");
    check.equal(body.textContent, "Untitled document body");

    select("original");
    detail.destroy();
    reply({title: "Closed preview", content: "Closed preview"});
    check.equal(title.textContent, "");
    return "Snapshot file preview passed";
};

for (const [name, width, height, theme] of [["base", 1000, 720, "daylight"], ["mobile", 360, 640, "midnight"]] as const) {
    test(`${name} snapshot detail shows only the selected document's stored title`, {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 30000,
    }, async () => {
        const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-snapshot-detail-"));
        try {
            const source = (file: string) => transpileModule(readFileSync(path.join(__dirname, file), "utf8"), {
                compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
            }).outputText;
            const css = compile(path.join(__dirname, `../assets/scss/${name}.scss`), {logger: {warn() {}}}).css;
            const themeCSS = readFileSync(path.join(__dirname, `../../appearance/themes/${theme}/theme.css`), "utf8");
            const expression = "const __name = value => value; (" + checkSnapshotPreview.toString() + ")(" +
                [source("repoFile.ts"), source("snapshotDetail.ts"), css + themeCSS].map(value => JSON.stringify(value)).join(",") + ")";
            const script = path.join(temporary, "run.cjs");
            writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: ${width}, height: ${height}, useContentSize: true,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(expression)}));
        app.exit(0);
    } catch (error) {
        console.error(error);
        app.exit(1);
    }
});`, "utf8");
            const env = {...process.env};
            delete env.ELECTRON_RUN_AS_NODE;
            const {stdout} = await promisify(execFile)(require("electron"), [script], {env, timeout: 25000, windowsHide: true});
            assert.match(stdout, /Snapshot file preview passed/);
        } finally {
            if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
                path.basename(temporary).startsWith("siyuan-snapshot-detail-")) {
                rmSync(temporary, {recursive: true, force: true});
            }
        }
    });
}
