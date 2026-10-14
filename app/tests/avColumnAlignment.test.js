const assert = require("node:assert/strict");
const {mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {test} = require("node:test");
const sass = require("sass");

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
const sidePadding = (styles, side) => {
    const shorthand = (styles.padding || "0").split(/\s+/);
    return parseFloat(styles[`padding-${side}`] ??
        (side === "left" ? shorthand[3] || shorthand[1] || shorthand[0] : shorthand[1] || shorthand[0]));
};
const primarySelector = ".av__cell[data-dtype=block]:not(.av__cell--header)";
const getCellStyles = (css, header, alignment = "") => ({
    ...declarations(css, ".av__cell"),
    ...declarations(css, header ? ".av__cell--header" : primarySelector),
    ...declarations(css, `${header ? ".av__cell--header" : primarySelector}[data-align=${alignment}]`),
});

test("mobile primary columns keep the same outer width as headers at every supported alignment", () => {
    const css = stylesheet("mobile");
    for (const alignment of ["", "left", "center", "right"]) {
        const header = getCellStyles(css, true, alignment);
        const body = getCellStyles(css, false, alignment);
        assert.equal(body["box-sizing"], "border-box");
        assert.equal(body["flex-shrink"], "0");
        for (const width of [25, 26, 64, 85, 86, 100, 154, 155, 200]) {
            // border-box 的内容宽度不能为负，外框至少要容纳两侧内边距和边框。
            const outerWidth = styles => Math.max(width, sidePadding(styles, "left") +
                sidePadding(styles, "right") + parseFloat(styles["border-right"]));
            assert.equal(outerWidth(body), outerWidth(header), `${alignment || "left"}, ${width}px`);
            assert.equal(outerWidth(body), width);
        }
    }
});

test("mobile action spacing remains inside primary content while buttons retain their existing behavior", () => {
    const css = stylesheet("mobile");
    const base = declarations(css, `${primarySelector} > .av__cellprimary`);
    assert.equal(base.display, "block");
    for (const alignment of ["", "left", "center", "right"]) {
        const inner = {...base, ...declarations(css, `${primarySelector}[data-align=${alignment}] > .av__cellprimary`)};
        const body = getCellStyles(css, false, alignment);
        const content = 200 - sidePadding(body, "left") - sidePadding(body, "right") - 1 -
            sidePadding(inner, "left") - sidePadding(inner, "right");
        assert.equal(content, alignment === "center" ? 45 : 114, alignment);
    }
    const actions = declarations(css, `${primarySelector} > .av__row-actions`);
    assert.equal(actions.opacity, "1");
    assert.equal(actions["pointer-events"], "auto");
    const buttons = declarations(css, ".av__row-actions .av__row-action");
    assert.equal(buttons.width, "28px");
    assert.equal(buttons.height, "28px");
    assert.equal(declarations(stylesheet("base"), `${primarySelector} > .av__cellprimary`).display, undefined,
        "the content wrapper remains an ordinary inline span on desktop");
});

const browserCases = css => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css + `
html,body {display:block;height:auto;overflow:auto;font:16px sans-serif}
.av {width:366px;--b3-parent-background:white;--b3-theme-surface-lighter:#ccc}
`;
    document.head.append(style);
    const dimensions = [25, 26, 64, 86, 100, 155, 200];
    for (const width of dimensions) {
        for (const align of ["", "left", "center", "right"]) {
            for (const frozen of [false, true]) {
                const cells = header => [
                    `<div class="av__cell${header ? " av__cell--header" : ""}" data-dtype="block" data-align="${align}" data-wrap="false" style="width:${width}px">${header ?
                        '<span class="av__celltext">Primary</span>' :
                        '<span class="av__cellprimary"><span class="b3-menu__avemoji">-</span><span class="av__celltext">Primary title</span></span><span class="av__row-actions"><button class="av__row-action av__cell-action" data-type="av-row-open">O</button><button class="av__row-action av__cell-action" data-type="av-row-update">B</button></span>'}</div>`,
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
                    header.forEach((cell, index) => {
                        const top = cell.getBoundingClientRect();
                        const bottom = body[index].getBoundingClientRect();
                        const label = `${width}px/${align}/${frozen}/${offset}/${index}`;
                        check.ok(Math.abs(top.width - bottom.width) < 1, `width ${label}`);
                        check.ok(Math.abs(top.left - bottom.left) < 1, `left ${label}`);
                        check.ok(Math.abs(top.right - bottom.right) < 1, `right ${label}`);
                    });
                    if (width >= 86) {
                        const primary = body[0].getBoundingClientRect();
                        for (const button of body[0].querySelectorAll(".av__row-action")) {
                            const bounds = button.getBoundingClientRect();
                            check.equal(Math.round(bounds.width), 28);
                            check.ok(bounds.left >= primary.left && bounds.right <= primary.right);
                            check.equal(getComputedStyle(button.parentElement).pointerEvents, "auto");
                        }
                    }
                }
            }
        }
    }
    return "Database column alignment cases passed";
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 414, height: 896,
        webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        const result = await win.webContents.executeJavaScript(
            `(${browserCases.toString()})(${JSON.stringify(stylesheet("mobile"))})`);
        assert.equal(result, "Database column alignment cases passed");
        console.log(result);
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
    test("narrow mobile columns align through frozen layouts and horizontal scrolling", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-column-alignment-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Database column alignment cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-column-alignment-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
