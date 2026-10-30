const assert = require("node:assert/strict");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const sass = require("sass");
const ts = require("typescript");
const postcss = require("postcss");

const stylesheet = name => sass.compile(path.join(__dirname, `../src/assets/scss/${name}.scss`), {
    logger: sass.Logger.silent,
}).css;

const primaryHTML = () => {
    const file = path.join(__dirname, "../src/protyle/render/av/cell.ts");
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
    const statement = source.statements.find(node => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(source) === "renderCell"));
    const render = runInNewContext(ts.transpileModule(statement.getText(source).replace(/^export /, ""), {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText + "\nrenderCell", {
        window: {siyuan: {languages: {openBy: "Open", bind: "Bind", more: "More"}}},
        hasAVRenderTemplateResult: () => false, renderAVBlockIcon: () => "",
        escapeHtmlTextAndAttr: value => value,
    });
    return render({type: "block", isDetached: true, block: {content: "12月 a longer primary title"}}, 0, false, "table", undefined, "", undefined, false);
};

const browserCases = (css, primary, legacy) => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css + `
html,body {display:block;height:auto;overflow:auto;font:16px sans-serif}
.av {width:366px;--b3-parent-background:white;--b3-theme-surface-lighter:#ccc}
`;
    document.head.append(style);
    for (const fontSize of [16, 24]) {
        document.body.style.fontSize = fontSize + "px";
        for (const width of [25, 26, 64, 80, 85, 86, 100, 154, 155, 200]) {
            for (const align of ["", "left", "center", "right"]) {
                for (const frozen of [false, true]) {
                    for (const wrap of [false, true]) {
                        const cells = header => [
                            `<div class="av__cell${header ? " av__cell--header" : ""}" data-dtype="block" data-align="${align}" data-wrap="${wrap}" style="width:${width}px">${header ? '<span class="av__celltext">Primary</span>' : primary}</div>`,
                            '<div class="av__cell" data-dtype="date" style="width:200px">Date</div>',
                            '<div class="av__cell" data-dtype="text" style="width:200px">Place</div>',
                        ];
                        const row = header => {
                            const content = cells(header);
                            const first = '<div class="av__firstcol"><svg></svg></div>';
                            return `<div class="av__row${header ? " av__row--header" : ""}">${frozen ?
                                `<div class="av__colsticky av__colsticky--freeze">${first}${content[0]}</div>${content.slice(1).join("")}` :
                                `<div class="av__colsticky">${first}</div>${content.join("")}`}</div>`;
                        };
                        document.body.innerHTML = `<div class="av" data-av-type="table"><div class="av__scroll"><div class="av__body" style="float:left">${row(true)}${row(false)}</div></div></div>`;
                        const scroll = document.querySelector(".av__scroll");
                        for (const offset of [0, 100]) {
                            scroll.scrollLeft = offset;
                            const rows = [...document.querySelectorAll(".av__row")];
                            const header = [...rows[0].querySelectorAll(".av__cell")];
                            const body = [...rows[1].querySelectorAll(".av__cell")];
                            const label = `${fontSize}px/${width}px/${align}/${frozen}/${wrap}/${offset}/${legacy}`;
                            header.forEach((cell, index) => {
                                const top = cell.getBoundingClientRect();
                                const bottom = body[index].getBoundingClientRect();
                                check.ok(Math.abs(top.width - bottom.width) < 1, `width ${label}`);
                                check.ok(Math.abs(top.left - bottom.left) < 1, `left ${label}`);
                                check.ok(Math.abs(top.right - bottom.right) < 1, `right ${label}`);
                            });
                            check.equal(Math.round(body[0].getBoundingClientRect().width), width, label);
                            const title = body[0].querySelector(".av__cellprimary");
                            const textBounds = title.getBoundingClientRect();
                            check.equal(getComputedStyle(title).overflowX, "hidden", label);
                            const buttons = [...body[0].querySelectorAll(".av__row-action")]
                                .filter(button => getComputedStyle(button).display !== "none" && button.getClientRects().length > 0);
                            const container = body[0].querySelector(".av__primary-container");
                            const available = container.getBoundingClientRect().width;
                            const font = parseFloat(getComputedStyle(container).fontSize);
                            const count = legacy ? 1 : available <= 32 + font ? 0 : available >= 64 + 4 * font ? 2 : 1;
                            check.equal(buttons.length, count, label);
                            for (const button of buttons) {
                                const bounds = button.getBoundingClientRect();
                                check.equal(Math.round(bounds.width), 28, label);
                                check.equal(Math.round(bounds.height), 28, label);
                                check.ok(textBounds.right <= bounds.left + 1 || textBounds.left >= bounds.right - 1 || textBounds.width === 0,
                                    `text and actions must not overlap: ${label}`);
                                check.equal(getComputedStyle(button.parentElement).pointerEvents, "auto", label);
                                const cellBounds = body[0].getBoundingClientRect();
                                const x = (bounds.left + bounds.right) / 2;
                                const y = (bounds.top + bounds.bottom) / 2;
                                const actionBounds = button.parentElement.getBoundingClientRect();
                                const stickyRight = rows[1].querySelector(".av__colsticky").getBoundingClientRect().right;
                                if (x > 0 && x < 366 && y < innerHeight && x >= cellBounds.left && x <= cellBounds.right &&
                                    x >= actionBounds.left && x <= actionBounds.right &&
                                    (frozen || x >= stickyRight)) {
                                    check.equal(document.elementFromPoint(x, y)?.closest("button"), button, `button hit target: ${label}`);
                                }
                            }
                            if (count === 1) {
                                check.equal(buttons[0].dataset.type, "av-row-more", label);
                            }
                        }
                    }
                }
            }
        }
    }
    return "Database column alignment and action layout cases passed";
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 414, height: 896,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        for (const legacy of [false, true]) {
            await win.loadURL("about:blank");
            let css = stylesheet("mobile");
            if (legacy) {
                const root = postcss.parse(css);
                root.walkAtRules("container", rule => rule.remove());
                root.walkDecls(/^container(?:-type|-name)?$/, declaration => declaration.remove());
                css = root.toString();
            }
            const result = await win.webContents.executeJavaScript(
                `try { (${browserCases.toString()})(${JSON.stringify(css)}, ${JSON.stringify(primaryHTML())}, ${legacy}) } catch (error) { error.stack }`);
            assert.equal(result, "Database column alignment and action layout cases passed");
        }
        console.log("Database column alignment and action layout cases passed");
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    test("narrow mobile columns keep text clear of reachable actions, align through freezing and scrolling, and support legacy WebViews", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-column-alignment-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
            assert.match(stdout, /Database column alignment and action layout cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-column-alignment-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
