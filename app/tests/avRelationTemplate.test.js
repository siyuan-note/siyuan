const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runCases = sources => {
    const assert = require("node:assert/strict");
    const escape = text => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    window.Lute = {EscapeHTMLStr: escape};
    window.siyuan = {languages: {untitled: "Untitled"}, config: {editor: {allowHTMLBLockScript: false}}};
    const sanitized = [];
    window.DOMPurify = {sanitize: content => {
        sanitized.push(content);
        return content;
    }};
    const dependencies = {
        "../../../util/escape": {escapeAttr: escape, escapeHtml: escape},
        "../../../emoji/fileTreeIcon": {getFileTreeIconHTML: () => ""},
        "../../../util/hostCapabilities": {getHostCapabilities: () => ({remoteKernel: true})},
    };
    const load = name => {
        if (!dependencies[name]) {
            const exports = {};
            dependencies[name] = exports;
            if (sources[name]) {
                new Function("require", "exports", sources[name])(load, exports);
            }
        }
        return dependencies[name];
    };
    const {renderCell, genCellValueByElement} = load("./cell");
    const {genAVValueHTML, getAVTemplateInteractiveElement} = load("./attributeValue");
    for (const isDetached of [true, false]) {
        for (const renderedContent of [undefined, "", '<b>Formatted</b><a href="https://example.com">Link</a>']) {
            const item = {type: "block", id: "value", keyID: "primary", blockID: "row", isDetached,
                block: {content: "Raw <title>", id: "bound-block", refSubtype: "s"},
                ...(renderedContent === undefined ? {} : {hasRenderTemplate: true}),
                ...(renderedContent ? {renderedContent} : {})};
            const relation = {type: "relation", relation: {blockIDs: ["row"], contents: [item]}};
            for (const layout of ["table", "list", "calendar", "gallery", "kanban", "attributes"]) {
                const cell = document.createElement("div");
                cell.innerHTML = layout === "attributes" ? genAVValueHTML(relation) :
                    renderCell(relation, 0, true, layout);
                document.body.replaceChildren(cell);
                const label = cell.querySelector(".av__celltext");
                assert.equal(label.textContent, renderedContent === undefined ? "Raw <title>" :
                    renderedContent ? "FormattedLink" : "");
                assert.equal(label.classList.contains("av__celltext--template"), renderedContent !== undefined);
                const recovered = genCellValueByElement("relation", cell);
                assert.deepEqual(recovered.relation.blockIDs, ["row"]);
                assert.equal(recovered.relation.contents[0].block.content, "Raw <title>");
                assert.equal(recovered.relation.contents[0].blockID, "row");
                assert.equal(recovered.relation.contents[0].hasRenderTemplate, undefined);
                assert.equal(recovered.relation.contents[0].renderedContent, undefined);
                if (!isDetached) {
                    assert.equal(label.dataset.id, "bound-block");
                    assert.equal(label.dataset.subtype, "s");
                }
                if (renderedContent) {
                    assert.equal(getAVTemplateInteractiveElement(label.querySelector("a")), label.querySelector("a"));
                }
            }
        }
    }
    assert.ok(sanitized.includes(""));
    assert.ok(sanitized.some(content => content.includes("<b>Formatted</b>")));
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    let exitCode = 0;
    try {
        const ts = require("typescript");
        const sources = Object.fromEntries(["cell", "cellValue", "attributeValue"].map(name => ["./" + name,
            ts.transpileModule(readFileSync(path.join(__dirname, `../src/protyle/render/av/${name}.ts`), "utf8"),
                {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText]));
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources)})`);
        console.log("AV relation template cases passed");
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    require("node:test").it("renders related primary templates while retaining raw values and navigation", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-av-relation-template-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /AV relation template cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-av-relation-template-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
