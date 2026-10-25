const assert = require("node:assert/strict");
const {readFileSync, writeFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");

const source = ts.createSourceFile("bazaar.ts", readFileSync(path.join(__dirname,
    "../src/config/bazaar.ts"), "utf8"), ts.ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(source) === "bazaar"));
const methods = declaration.declarationList.declarations[0].initializer.properties.filter(property =>
    ["_bindLocalPackageEvent", "_getLocalPackageFile"].includes(property.name?.getText(source)));
const compiled = ts.transpileModule(`const bazaar = {${methods.map(method => method.getText(source)).join(",")}}; return bazaar;`, {
    compilerOptions: {target: ts.ScriptTarget.ES2021},
}).outputText;

const runCases = compiled => {
    const assert = require("node:assert/strict");
    const errors = [];
    const installed = [];
    let frontend = "desktop";
    const bazaar = new Function("getFrontend", "showMessage", "hasDataTransferFiles", compiled)(
        () => frontend, message => errors.push(message),
        types => Array.from(types).includes("Files"));
    window.siyuan = {languages: {localBazaarPackageFileError: "Expected one ZIP file"}};
    bazaar._installLocalPackage = file => installed.push(file.name);
    const mount = () => {
        const element = document.createElement("div");
        element.innerHTML = '<div><div class="config-bazaar__drop fn__none"></div>' +
            '<input type="file" data-type="local-package-file"><div id="configBazaarReadme">' +
            '<a href="https://example.com"><img src="data:image/png;base64,iVBORw0KGgo="></a>' +
            '<span draggable="true">Text</span></div></div>';
        document.body.replaceChildren(element);
        bazaar._bindLocalPackageEvent({}, {element});
        return element;
    };
    const dispatch = (target, type, dataTransfer = new DataTransfer()) => {
        const event = new DragEvent(type, {bubbles: true, cancelable: true, dataTransfer});
        target.dispatchEvent(event);
        return event;
    };
    const files = (...names) => {
        const transfer = new DataTransfer();
        names.forEach(name => transfer.items.add(new File(["test"], name)));
        return transfer;
    };
    const typedFiles = (...entries) => {
        const transfer = new DataTransfer();
        entries.forEach(([name, type]) => transfer.items.add(new File(["test"], name, {type})));
        return transfer;
    };
    for (frontend of ["desktop", "desktop-window", "browser-desktop", "browser-mobile"]) {
        const root = mount();
        const overlay = root.querySelector(".config-bazaar__drop");
        const readme = root.querySelector("#configBazaarReadme");
        const hidden = () => overlay.classList.contains("fn__none");
        // Chromium 中拖动页面内图片时，拖拽数据仍会携带 Files 类型
        const imageTransfer = files("image.png");
        imageTransfer.setData("text/html", '<img src="https://example.com/image.png">');
        imageTransfer.setData("text/uri-list", "https://example.com/image.png");
        const image = readme.querySelector("img");
        assert.equal(dispatch(image, "dragstart", imageTransfer).defaultPrevented, false,
            `${frontend}: internal content keeps its native drag`);
        assert.equal(dispatch(image, "dragenter", imageTransfer).defaultPrevented, false,
            "Internal drags are not treated as local files");
        assert.equal(hidden(), true, "Internal drags do not show the drop overlay");
        assert.equal(dispatch(overlay, "drop", imageTransfer).defaultPrevented, false);
        assert.equal(hidden(), true);
        assert.equal(errors.length, 0);
        assert.equal(installed.length, 0, "Internal drags never install a package");

        dispatch(image, "dragend", imageTransfer);
        readme.replaceChildren(document.createElement("img"));
        const refreshed = readme.querySelector("img");
        dispatch(refreshed, "dragstart", imageTransfer);
        dispatch(refreshed, "dragend", imageTransfer);
        assert.equal(hidden(), true);

        const textTransfer = new DataTransfer();
        textTransfer.setData("text/plain", "Selected text");
        assert.equal(dispatch(readme, "dragenter", textTransfer).defaultPrevented, false);
        assert.equal(dispatch(readme, "drop", textTransfer).defaultPrevented, false);
        assert.equal(hidden(), true);
        assert.equal(errors.length, 0);

        const zip = typedFiles(["package.ZIP", "application/zip"]);
        assert.equal(dispatch(readme, "dragenter", zip).defaultPrevented, true,
            "Local files still install after an internal drag finished");
        assert.equal(hidden(), false);
        dispatch(overlay, "dragenter", zip);
        dispatch(readme, "dragleave", zip);
        assert.equal(hidden(), false, "Moving over a child keeps the overlay visible");
        assert.equal(dispatch(overlay, "dragover", zip).defaultPrevented, true);
        dispatch(overlay, "dragleave", zip);
        assert.equal(hidden(), true, "Leaving the drop zone clears the overlay");
        dispatch(readme, "dragenter", zip);
        assert.equal(dispatch(overlay, "drop", zip).defaultPrevented, true);
        assert.equal(hidden(), true);
        assert.equal(installed.pop(), "package.ZIP");

        // 系统拖入已知非 ZIP 文件时不显示安装遮罩，但仍接管拖拽，避免浏览器直接打开该文件
        const photo = typedFiles(["photo.png", "image/png"]);
        assert.equal(dispatch(readme, "dragenter", photo).defaultPrevented, true,
            "Known non-ZIP files are still intercepted");
        assert.equal(hidden(), true, "Known non-ZIP files do not show the overlay");
        assert.equal(dispatch(overlay, "dragover", photo).defaultPrevented, true);
        assert.equal(dispatch(overlay, "drop", photo).defaultPrevented, true);
        assert.equal(errors.pop(), "Expected one ZIP file");
        assert.equal(installed.length, 0);

        // 拖拽数据中的文件类型可能缺失，此时按未知处理并保留遮罩
        const unknown = typedFiles(["archive", ""]);
        assert.equal(dispatch(readme, "dragenter", unknown).defaultPrevented, true);
        assert.equal(hidden(), false, "Unknown file types keep the overlay");
        assert.equal(dispatch(overlay, "drop", unknown).defaultPrevented, true);
        assert.equal(hidden(), true);
        assert.equal(errors.pop(), "Expected one ZIP file");
        assert.equal(installed.length, 0);

        const unknownZip = files("package.zip");
        assert.equal(dispatch(readme, "dragenter", unknownZip).defaultPrevented, true);
        assert.equal(hidden(), false, "A ZIP without a readable type keeps the overlay");
        assert.equal(dispatch(overlay, "drop", unknownZip).defaultPrevented, true);
        assert.equal(installed.pop(), "package.zip");

        for (const invalid of [typedFiles(["image.png", "image/png"]),
            typedFiles(["one.zip", "application/zip"], ["two.zip", "application/zip"])]) {
            dispatch(readme, "dragenter", invalid);
            dispatch(overlay, "drop", invalid);
            assert.equal(hidden(), true);
            assert.equal(errors.pop(), "Expected one ZIP file");
            assert.equal(installed.length, 0);
        }

        // 拖拽源移除后在集市外结束拖拽，不影响下一次本地文件拖入
        dispatch(refreshed, "dragstart", imageTransfer);
        refreshed.remove();
        dispatch(refreshed, "dragend", imageTransfer);
        document.body.dispatchEvent(new MouseEvent("mouseup", {bubbles: true}));
        assert.equal(dispatch(readme, "dragenter", imageTransfer).defaultPrevented, false,
            "The removed source's transfer remains internal");
        assert.equal(hidden(), true);
        assert.equal(dispatch(readme, "dragenter", zip).defaultPrevented, true,
            "A new file drag is independent of the removed source's lifecycle");
        assert.equal(hidden(), false);
        assert.equal(dispatch(overlay, "drop", zip).defaultPrevented, true);
        assert.equal(installed.pop(), "package.ZIP");

        // 即使内部拖拽没有任何结束事件，新的拖拽数据也应独立判断
        dispatch(readme, "dragstart", imageTransfer);
        assert.equal(dispatch(readme, "dragenter", zip).defaultPrevented, true);
        assert.equal(dispatch(overlay, "drop", zip).defaultPrevented, true);
        assert.equal(installed.pop(), "package.ZIP");
    }
    frontend = "mobile";
    const root = mount();
    const zip = files("mobile.zip");
    assert.equal(dispatch(root.firstElementChild, "dragenter", zip).defaultPrevented, false,
        "Mobile does not bind desktop drop installation");
    const input = root.querySelector("input");
    input.files = zip.files;
    input.dispatchEvent(new Event("change"));
    assert.equal(installed.pop(), "mobile.zip", "Mobile keeps file-picker installation");
    assert.equal(input.value, "");
    assert.equal(errors.length, 0);
    return "Bazaar local package drag cases passed";
};

const runRemovedSourceDragCase = async (win, compiled, profile) => {
    const setup = compiled => {
        document.body.innerHTML = '<div id="mount"><div id="target" style="width:400px;height:250px">' +
            '<div class="config-bazaar__drop fn__none"></div><div id="source" draggable="true" ' +
            'style="width:100px;height:100px">Drag source</div></div></div>';
        const installed = [];
        const bazaar = new Function("getFrontend", "showMessage", "hasDataTransferFiles", compiled)(
            () => "desktop", message => { throw new Error(message); }, types => Array.from(types).includes("Files"));
        bazaar._installLocalPackage = file => installed.push(file.name);
        bazaar._bindLocalPackageEvent({}, {element: document.getElementById("mount")});
        document.getElementById("source").addEventListener("dragstart", event => {
            event.dataTransfer.setData("text/plain", "Internal content");
        });
        const fileEvents = [];
        for (const type of ["dragenter", "drop"]) {
            document.getElementById("target").addEventListener(type, event => {
                fileEvents.push({type, trusted: event.isTrusted, prevented: event.defaultPrevented});
            });
        }
        window.getDragState = () => ({installed, fileEvents,
            hidden: document.querySelector(".config-bazaar__drop").classList.contains("fn__none")});
    };
    await win.webContents.executeJavaScript(`(${setup.toString()})(${JSON.stringify(compiled)})`);
    win.webContents.debugger.attach("1.3");
    const send = (method, params) => win.webContents.debugger.sendCommand(method, params);
    let intercepted;
    const onMessage = (event, method, params) => {
        if (method === "Input.dragIntercepted") intercepted = params.data;
    };
    win.webContents.debugger.on("message", onMessage);
    try {
        await send("Input.setInterceptDrags", {enabled: true});
        await send("Input.dispatchMouseEvent", {type: "mouseMoved", x: 40, y: 40});
        await send("Input.dispatchMouseEvent", {type: "mousePressed", x: 40, y: 40,
            button: "left", buttons: 1, clickCount: 1});
        await send("Input.dispatchMouseEvent", {type: "mouseMoved", x: 70, y: 70, button: "left", buttons: 1});
        await send("Input.dispatchMouseEvent", {type: "mouseMoved", x: 200, y: 200, button: "left", buttons: 1});
        await require("node:timers/promises").setTimeout(100);
        assert.ok(intercepted, "Chromium starts a native internal drag");
        assert.ok(intercepted.items.some(item => item.mimeType === "text/plain" && item.data === "Internal content"),
            "Origin tracking preserves native drag data");
        await win.webContents.executeJavaScript('document.getElementById("source").remove()');
        for (const type of ["dragEnter", "dragOver", "drop"]) {
            await send("Input.dispatchDragEvent", {type, x: 600, y: 400, data: intercepted});
        }
        await send("Input.dispatchMouseEvent", {type: "mouseReleased", x: 600, y: 400,
            button: "left", buttons: 0, clickCount: 1});

        const zipPath = path.join(profile, "native-package.zip");
        writeFileSync(zipPath, "test");
        const data = {items: [], files: [zipPath], dragOperationsMask: 1};
        await send("Input.dispatchDragEvent", {type: "dragEnter", x: 250, y: 200, data});
        const entered = await win.webContents.executeJavaScript("getDragState()");
        assert.equal(entered.hidden, false, "A native ZIP drag shows the overlay after the source was removed");
        assert.deepEqual(entered.fileEvents, [{type: "dragenter", trusted: true, prevented: true}]);
        await send("Input.dispatchDragEvent", {type: "dragOver", x: 250, y: 200, data});
        await send("Input.dispatchDragEvent", {type: "drop", x: 250, y: 200, data});
        const dropped = await win.webContents.executeJavaScript("getDragState()");
        assert.equal(dropped.hidden, true);
        assert.deepEqual(dropped.installed, ["native-package.zip"]);
        assert.deepEqual(dropped.fileEvents.at(-1), {type: "drop", trusted: true, prevented: true});
    } finally {
        win.webContents.debugger.removeListener("message", onMessage);
        win.webContents.debugger.detach();
    }
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, webPreferences: {
            nodeIntegration: true, contextIsolation: false, offscreen: true,
        }});
        let code = 0;
        try {
            await win.loadURL("data:text/html,<html><body></body></html>");
            const result = await win.webContents.executeJavaScript(`(() => { try {
                return (${runCases.toString()})(${JSON.stringify(compiled)});
            } catch (error) { return error.stack; } })()`);
            assert.equal(result, "Bazaar local package drag cases passed");
            await runRemovedSourceDragCase(win, compiled, process.argv[2]);
            console.log(result);
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            win.destroy();
            app.exit(code);
        }
    }).catch(error => { console.error(error); app.exit(1); });
} else {
    require("node:test").test("bazaar ignores internal drags, filters known non-ZIP files and preserves external ZIP drops and mobile file selection", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-bazaar-drop-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Bazaar local package drag cases passed/);
        } finally {
            assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
            rmSync(profile, {recursive: true, force: true});
        }
    });
}
