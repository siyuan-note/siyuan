const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const selectionSource = () => {
    const extract = (file, names) => {
        const source = ts.createSourceFile(file, readFileSync(path.join(__dirname, "../src", file + ".ts"), "utf8"),
            ts.ScriptTarget.Latest, true);
        const declarations = source.statements.filter(statement => ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
        assert.equal(declarations.length, names.length);
        return declarations.map(statement => statement.getText(source).replace(/^export /, "")).join("\n");
    };
    return ts.transpileModule([
        extract("protyle/util/hasClosest", ["hasClosestByTag"]),
        extract("protyle/wysiwyg/getBlock", ["getContenteditableElement"]),
        readFileSync(path.join(__dirname, "../src/protyle/wysiwyg/blockSelection.ts"), "utf8")
            .replace(/^export /gm, ""),
        extract("protyle/util/selectionOffsets", ["selectIsEditor", "getSelectionOffset", "focusByRange"]),
        extract("protyle/util/selection", ["selectAll"]),
    ].join("\n"), {compilerOptions: {target: ts.ScriptTarget.ES2020}}).outputText;
};

const runCases = source => {
    const check = require("node:assert/strict");
    const noop = () => {};
    const selectAll = new Function("hideElements", "countBlockWord", "countSelectWord", "revealTabsForTarget",
        source + "; return selectAll;")(noop, noop, noop, noop);
    const emoji = '<img class="emoji" alt="custom" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
    const cases = [
        ["leading emoji", emoji + "Alpha"],
        ["trailing emoji", "Alpha" + emoji],
        ["both boundaries", emoji + "Alpha" + emoji],
        ["middle emoji", "Alpha" + emoji + "beta"],
        ["emoji only", emoji],
        ["multiple emoji only", emoji + emoji],
        ["nested boundaries", `<b><i>${emoji}Alpha${emoji}</i></b>`],
        ["ordinary text", "Alpha <b>beta</b>"],
        ["soft break", "Alpha<br>beta"],
        ["trailing break", "Alpha<br>"],
    ];
    for (const table of [false, true]) {
        for (const allowBlockSelection of [false, true]) {
            for (const [name, html] of cases) {
                const label = `${name}, table=${table}, block selection=${allowBlockSelection}`;
                const editor = document.createElement("div");
                editor.className = "protyle-wysiwyg";
                editor.innerHTML = table ?
                    `<div data-node-id="one" data-type="NodeTable"><table><tbody><tr><td contenteditable="true">${html}</td><td contenteditable="true">Other cell</td></tr></tbody></table></div>` :
                    `<div data-node-id="one" data-type="NodeParagraph"><div contenteditable="true">${html}</div><div class="protyle-attr">Attribute</div></div>`;
                editor.insertAdjacentHTML("beforeend", '<div data-node-id="two" data-type="NodeParagraph"><div contenteditable="true">Other block</div></div>');
                document.body.replaceChildren(editor);
                const block = editor.firstElementChild;
                const editable = block.querySelector('[contenteditable="true"]');
                const range = document.createRange();
                range.selectNodeContents(editable);
                const text = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT).nextNode();
                if (text) {
                    range.setStart(text, Math.floor(text.textContent.length / 2));
                }
                range.collapse(true);
                getSelection().removeAllRanges();
                getSelection().addRange(range);
                const protyle = {wysiwyg: {element: editor}, toolbar: {render: noop}};

                check.equal(selectAll(protyle, block, range, allowBlockSelection), true, label);
                check.equal(range.toString(), editable.textContent, label);
                check.equal(range.cloneContents().querySelectorAll(".emoji").length,
                    editable.querySelectorAll(".emoji").length, label);
                check.equal(range.cloneContents().querySelectorAll("br").length,
                    editable.querySelectorAll("br").length, label);
                check.equal(range.collapsed, false, label);
                check.equal(editor.querySelector(".protyle-wysiwyg--select"), null, label);

                // A second invocation selects document blocks, or preserves the text range in editors without block menus.
                check.equal(selectAll(protyle, block, range, allowBlockSelection), !allowBlockSelection, label);
                if (allowBlockSelection) {
                    check.equal(editor.querySelectorAll(".protyle-wysiwyg--select").length, 2, label);
                } else {
                    check.equal(range.toString(), editable.textContent, label);
                    check.equal(range.cloneContents().querySelectorAll(".emoji").length,
                        editable.querySelectorAll(".emoji").length, label);
                    check.equal(editor.querySelector(".protyle-wysiwyg--select"), null, label);
                }
            }
        }
    }
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        let code = 0;
        try {
            await win.loadURL("about:blank");
            const result = await win.webContents.executeJavaScript(`(() => {
                try {
                    (${runCases.toString()})(${JSON.stringify(selectionSource())});
                    return "passed";
                } catch (error) {
                    return error.stack;
                }
            })()`);
            assert.equal(result, "passed");
            console.log("Select-all range cases passed");
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            win.destroy();
            app.exit(code);
        }
    });
} else {
    require("node:test").test("selectAll includes boundary emoji and advances to document selection", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-selection-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Select-all range cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-selection-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
