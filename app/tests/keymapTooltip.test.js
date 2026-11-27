const assert = require("node:assert/strict");
const {execFile} = require("node:child_process");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const {tmpdir} = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {setTimeout: delay} = require("node:timers/promises");
const {promisify} = require("node:util");

const appDir = path.resolve(__dirname, "..");

const buildRenderer = () => {
    const ts = require("typescript");
    const read = name => readFileSync(path.join(appDir, "src/config/tabs", name), "utf8");
    const ui = ts.createSourceFile("keymapUi.ts", read("keymapUi.ts"), ts.ScriptTarget.ES2022, true);
    const row = ts.createSourceFile("keymapRow.ts", read("keymapRow.ts"), ts.ScriptTarget.ES2022, true);
    const binder = ui.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
        .find(declaration => declaration.name.getText(ui) === "bindKeymapList");
    const names = new Set(["recording", "outsideRecording", "cancelRecording", "refreshBindings", "saveRow"]);
    const statements = binder.initializer.body.statements.filter(statement =>
        ts.isVariableStatement(statement) && statement.declarationList.declarations.some(item => names.has(item.name.getText(ui))) ||
        ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) &&
        statement.expression.expression.getText(ui) === "keymapListElement.addEventListener" &&
        ["click", "keydown", "focusout"].includes(statement.expression.arguments[0]?.text));
    assert.ok(statements.length > 0);
    const declarations = row.statements.filter(ts.isVariableStatement).map(statement => statement.getText(row).replace(/^export /, ""));
    return ts.transpileModule(declarations.concat(statements.map(statement => statement.getText(ui))).join("\n"), {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText;
};

const mountRenderer = source => {
    window.siyuan = {languages: {keymapAdd: "Add shortcut", remove: "Remove", reset: "Reset", keymapRecording: "Recording"},
        ws: {app: {}}};
    const root = document.getElementById("keymapList");
    const commands = [[], ["F9"]];
    const dependencies = {
        root, keymapListElement: root, Constants: {ZWSP: "|"},
        escapeAttr: value => value, escapeHtml: value => value, updateHotkeyTip: value => value,
        getDefaultKeymapBindings: item => item, getKeymapBindings: item => item,
        getKeymapString: event => event.key, matchHotKey: (key, event) => key === event.key,
        isMac: () => false, isReservedKeymap: () => false, isDisallowedTextInputHotkey: () => false,
        refreshKeymapBindings() {}, hideMessage() {}, sendGlobalShortcut() {}, sendUnregisterGlobalShortcut() {},
        saveKeymapRow() {},
    };
    const renderRow = new Function(...Object.keys(dependencies), source + "\nreturn genKeymapRowHtml;")(...Object.values(dependencies));
    root.innerHTML = commands.map((keys, index) => renderRow("Command " + (index + 1), "general|" + index, keys)).join("");
    const target = () => root.firstElementChild.querySelector('[data-type="add"]');
    const opacities = [];
    let sampling = false;
    const collect = () => {
        if (sampling) {
            opacities.push(Number(getComputedStyle(target(), "::after").opacity));
            requestAnimationFrame(collect);
        }
    };
    Object.assign(window, {
        getPoint: type => {
            const rect = root.firstElementChild.querySelector('[data-type="' + type + '"]').getBoundingClientRect();
            return {x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2)};
        },
        readTarget: () => {
            const button = target();
            const tooltip = getComputedStyle(button, "::after");
            return {focused: document.activeElement === button, hovered: button.matches(":hover"),
                opacity: Number(tooltip.opacity), content: tooltip.content, keys: JSON.parse(root.firstElementChild.dataset.keys)};
        },
        focusButton: type => root.firstElementChild.querySelector('[data-type="' + type + '"]').focus(),
        startSampling: () => { opacities.length = 0; sampling = true; requestAnimationFrame(collect); },
        stopSampling: () => { sampling = false; return [...opacities]; },
    });
};

const driveElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 900, height: 580, useContentSize: true,
        webPreferences: {offscreen: true, backgroundThrottling: false}});
    try {
        const contents = win.webContents;
        const read = async script => {
            const result = await contents.executeJavaScript("(() => {try { return {value: (" + script + ")}; } catch (error) { return {error: error.stack}; }})()");
            if (result.error) { throw new Error(result.error); }
            return result.value;
        };
        contents.on("console-message", event => { if (event.level === "error") { console.error(event.message); } });
        const html = '<!doctype html><html><body><div class="config-keymap" id="keymapList" style="margin:80px 120px"></div></body></html>';
        await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
        const sass = require("sass");
        await contents.insertCSS(sass.compile(path.join(appDir, "src/assets/scss/base.scss"), {logger: sass.Logger.silent}).css);
        await contents.insertCSS(readFileSync(path.join(appDir, "appearance/themes/daylight/theme.css"), "utf8"));
        await read("(" + mountRenderer.toString() + ")(" + JSON.stringify(buildRenderer()) + ")");
        contents.focus();
        const snapshot = () => read("readTarget()");
        const point = type => read("getPoint(" + JSON.stringify(type) + ")");
        const move = coords => contents.sendInputEvent({type: "mouseMove", ...coords});
        const away = () => move({x: 10, y: 20});
        const click = async type => {
            const coords = await point(type);
            move(coords);
            for (const eventType of ["mouseDown", "mouseUp"]) {
                contents.sendInputEvent({type: eventType, button: "left", clickCount: 1, ...coords});
            }
        };
        const press = keyCode => {
            contents.sendInputEvent({type: "keyDown", keyCode});
            if (keyCode === "Enter") contents.sendInputEvent({type: "char", keyCode: "\r"});
            contents.sendInputEvent({type: "keyUp", keyCode});
        };
        const hover = async () => {
            away();
            await delay(525);
            const before = await snapshot();
            await read("startSampling()");
            move(await point("add"));
            await delay(650);
            const samples = await read("stopSampling()");
            const after = await snapshot();
            return {before, after, faded: samples.some(opacity => opacity > 0 && opacity < 1)};
        };

        await click("add");
        away();
        press("F10");
        await delay(40);
        const pointerSave = await hover();

        away();
        await read('focusButton("add")');
        press("Enter");
        await delay(40);
        assert.equal(await read('Boolean(document.querySelector(".config-keymap__record"))'), true, "Enter opens recording");
        press("F11");
        await delay(40);
        const keyboardSave = await hover();
        const keyboardRehover = await hover();

        await click("remove");
        away();
        await delay(550);
        const pointerRemove = await snapshot();
        const hoverAfterRemove = await hover();

        away();
        await read('focusButton("remove")');
        press("Enter");
        await delay(550);
        const keyboardRemove = await snapshot();
        press("Enter");
        await delay(40);
        assert.equal(await read('Boolean(document.querySelector(".config-keymap__record"))'), true);
        press("Escape");
        await delay(525);
        const canceled = await snapshot();
        process.stdout.write(JSON.stringify({pointerSave, keyboardSave, keyboardRehover, pointerRemove, hoverAfterRemove, keyboardRemove, canceled}) + "\n");
    } finally {
        win.destroy();
    }
};

if (process.versions.electron && process.type === "browser") {
    driveElectron().then(() => require("electron").app.exit(0), error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    test("shortcut tooltips fade on re-hover and mouse deletion leaves focus clear", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const profile = mkdtempSync(path.join(tmpdir(), "siyuan-keymap-tooltip-"));
        try {
            const env = {...process.env};
            delete env.ELECTRON_RUN_AS_NODE;
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, timeout: 55000, windowsHide: true,
            });
            const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
            for (const [action, state] of Object.entries({
                pointerSave: result.pointerSave, keyboardSave: result.keyboardSave,
                keyboardRehover: result.keyboardRehover, hoverAfterRemove: result.hoverAfterRemove,
            })) {
                assert.equal(state.before.opacity, 0, action + " starts with the tooltip hidden");
                assert.equal(state.faded, true, action + " has an intermediate opacity");
                assert.equal(state.after.hovered, true, action + " ends over the add button");
                assert.equal(state.after.opacity, 1, action + " ends with the tooltip visible");
                assert.equal(state.after.content, '"Add shortcut"', action + " has the add tooltip text");
            }
            assert.deepEqual(result.pointerSave.before.keys, ["F10"]);
            assert.equal(result.pointerSave.before.focused, false);
            assert.deepEqual(result.keyboardSave.before.keys, ["F10", "F11"]);
            assert.equal(result.keyboardSave.before.focused, true);
            assert.deepEqual(result.pointerRemove.keys, ["F11"]);
            assert.equal(result.pointerRemove.focused, false);
            assert.equal(result.pointerRemove.opacity, 0);
            assert.deepEqual(result.keyboardRemove.keys, []);
            assert.equal(result.keyboardRemove.focused, true);
            assert.equal(result.keyboardRemove.opacity, 0);
            assert.deepEqual(result.canceled.keys, []);
            assert.equal(result.canceled.focused, true);
            assert.equal(result.canceled.opacity, 0);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-keymap-tooltip-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
