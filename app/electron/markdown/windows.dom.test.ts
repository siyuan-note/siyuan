import {test} from "node:test";
import type {Configuration, Stats} from "webpack";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {execFile} = require("node:child_process");
const {promisify} = require("node:util");

const compile = async (config: Configuration): Promise<void> => {
    const compiler = require("webpack")(config);
    try {
        const stats = await new Promise<Stats>((resolve, reject) =>
            compiler.run((error, value) => error ? reject(error) : resolve(value)));
        assert.equal(stats.hasErrors(), false, stats.toString({all: false, errors: true}));
    } finally {
        await new Promise<void>((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
    }
};

const runElectron = async options => {
    const {app, BrowserWindow, ipcMain, protocol, nativeTheme} = require("electron");
    const fs = require("node:fs/promises");
    const assert = require("node:assert/strict");
    const {createMarkdownWindows, registerMarkdownSchemes} = require(options.manager);
    const {isDevToolsShortcut, toggleDevTools} = require(options.devTools);
    const {once} = require("node:events");
    const {windowControls} = require(options.windowControlsStub);
    registerMarkdownSchemes(protocol);
    app.setPath("userData", options.profile);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    nativeTheme.themeSource = "dark";
    const errors = [];
    let createdWindows = 0;
    class HiddenWindow extends BrowserWindow {
        constructor(settings) {
            super({...settings, webPreferences: {...settings.webPreferences, backgroundThrottling: false}});
            createdWindows++;
            this.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
        }
        show() {}
    }
    let window;
    let imageServer;
    try {
        const manager = createMarkdownWindows({app, BrowserWindow: HiddenWindow, ipcMain, nativeTheme,
            rootDirectory: options.root, configDirectory: options.config, windowControls,
            devTools: {isShortcut: isDevToolsShortcut, toggle: toggleDevTools},
            dialog: {showMessageBox: async () => ({response: 0})}, shell: {openExternal: async () => { throw new Error("Unexpected link"); }}});
        window = await manager.open(options.document);
        await window.webContents.executeJavaScript(`new Promise((resolve,reject) => {
            const deadline = Date.now() + 15000;
            const check = () => {
                if (document.querySelector('#markdownEditor[aria-busy="false"] .vditor-ir') &&
                    document.getElementById('vditorContentTheme')?.sheet) return resolve();
                if (Date.now() > deadline) return reject(new Error('Editor did not initialize: '+document.body.innerText));
                setTimeout(check, 25);
            }; check();
        })`);
        assert.equal(window.getTitle(), "A.md", "page initialization keeps the native filename title");
        const pageTitleChanged = once(window, "page-title-updated", {signal: AbortSignal.timeout(5000)});
        await window.webContents.executeJavaScript("document.title = 'SiYuan'; void 0;");
        await pageTitleChanged;
        assert.equal(window.getTitle(), "A.md", "a temporary page title cannot replace the native filename");
        await window.webContents.executeJavaScript("document.title = 'A.md'; void 0;");
        const security = await window.webContents.executeJavaScript(`({node: typeof require, process: typeof process,
            host: typeof window.siyuanMarkdown.host.write, unsafe: typeof window.siyuanMarkdown.invoke,
            origin: location.href, text: document.querySelector('#markdownEditor').innerText,
            contentTheme: document.getElementById('vditorContentTheme').href,
            textColor: getComputedStyle(document.querySelector('#markdownEditor h1')).color})`);
        assert.equal(security.node, "undefined");
        assert.equal(security.process, "undefined");
        assert.equal(security.host, "function");
        assert.equal(security.unsafe, "undefined");
        for (const opened of [true, false]) {
            const changed = once(window.webContents, opened ? "devtools-opened" : "devtools-closed", {signal: AbortSignal.timeout(10000)});
            const modifiers = process.platform === "darwin" ? ["meta", "alt"] : ["control", "shift"];
            window.webContents.sendInputEvent({type: "keyDown", keyCode: "I", modifiers});
            window.webContents.sendInputEvent({type: "keyUp", keyCode: "I", modifiers});
            await changed;
            assert.equal(window.webContents.isDevToolsOpened(), opened);
        }
        // 恢复页面焦点，再等待停靠面板收起后的可见树行，避免点击隐藏行的零坐标。
        window.webContents.focus();
        assert.match(security.origin, /^siyuan-markdown:\/\/\d{14}-[a-z\d]{7}\/index.html$/);
        assert.match(security.text, /Original document/);
        assert.match(security.contentTheme, /\/dark\.css$/);
        assert.ok(security.textColor.match(/\d+/g).slice(0, 3).every(value => Number(value) > 128),
            `dark sandbox heading remains readable: ${security.textColor}`);
        assert.equal(await fs.readFile(options.document, "utf8"), options.initialContent);
        await window.webContents.executeJavaScript(`new Promise((resolve,reject) => {
            const deadline = Date.now() + 10000;
            const check = () => {
                const code = document.querySelector('#markdownEditor .vditor-ir__marker--pre > code');
                if (code?.querySelector('.hljs-title') && code.querySelector('.hljs-string') &&
                    document.getElementById('vditorHljsStyle')?.sheet) return resolve();
                if (Date.now() > deadline) return reject(new Error('Production code highlighting is unavailable'));
                setTimeout(check, 25);
            }; check();
        })`);
        const codeState = await window.webContents.executeJavaScript(`(() => {
            const code = document.querySelector('#markdownEditor .vditor-ir__marker--pre > code');
            code.parentElement.parentElement.querySelector('.vditor-ir__preview').click();
            return {text: code.textContent, foreground: getComputedStyle(code).color,
                title: getComputedStyle(code.querySelector('.hljs-title')).color,
                string: getComputedStyle(code.querySelector('.hljs-string')).color};
        })()`);
        assert.equal(codeState.text, "document.body.insertAdjacentHTML('afterbegin', ``);\n");
        assert.notEqual(codeState.title, codeState.foreground);
        assert.notEqual(codeState.string, codeState.foreground);
        assert.equal(await fs.readFile(options.document, "utf8"), options.initialContent);
        for (const heading of ["Original document1", "Original document", "Third external version"]) {
            const content = `# ${heading}\n`;
            await fs.writeFile(options.document, content);
            await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
                const deadline = Date.now() + 5000;
                const check = () => {
                    if (document.querySelector('#markdownEditor h1')?.textContent === ${JSON.stringify("# " + heading)}) return resolve();
                    if (Date.now() > deadline) return reject(new Error('Consecutive external save did not reload: ' + JSON.stringify({
                        expected: ${JSON.stringify(heading)}, actual: document.querySelector('#markdownEditor h1')?.textContent,
                        status: document.getElementById('markdownStatus').innerText})));
                    setTimeout(check, 25);
                }; check();
            })`);
            assert.equal(await fs.readFile(options.document, "utf8"), content);
        }
        const initialSession = await window.webContents.executeJavaScript("window.siyuanMarkdown.bootstrap().then(value => value.sessionId)");
        const containerId = window.id;
        const contentsId = window.webContents.id;
        await window.webContents.executeJavaScript(`(async () => {
            document.getElementById('markdownMoreButton').click();
            document.getElementById('markdownMode').click();
            const sourceMode = document.querySelector('#markdownMode button[data-value="sv"]');
            if (!sourceMode.checkVisibility()) throw new Error('Source mode is not reachable in its submenu');
            sourceMode.click();
            await new Promise(resolve => setTimeout(resolve, 50));
            if (sourceMode.getAttribute('aria-checked') !== 'true') throw new Error('Mode submenu did not select source mode');
            if (document.querySelector('.markdown-header select')) throw new Error('Header still has a mode selector');
            const input = document.querySelector('textarea.vditor-sv');
            input.value = '# Saved through sandbox\\n';
            input.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'insertText'}));
            document.getElementById('markdownMoreButton').click();
            if (!document.getElementById('markdownMore').open) throw new Error('File actions menu did not open');
            document.getElementById('markdownSave').click();
            await new Promise((resolve,reject) => {
                const deadline=Date.now()+10000;
                const check=()=>{if(document.getElementById('markdownStatus').dataset.status==='saved') return resolve();
                    if(Date.now()>deadline) return reject(new Error(document.getElementById('markdownStatus').innerText));setTimeout(check,25);};
                setTimeout(check,25);
            });
        })()`);
        assert.equal(await fs.readFile(options.document, "utf8"), "# Saved through sandbox\n");
        const switchThroughTree = async (filename, pendingContent, expectedContent) => {
            const point = await window.webContents.executeJavaScript(`(async () => {
                const input = document.querySelector('textarea.vditor-sv');
                input.focus();
                input.value = ${JSON.stringify(pendingContent)};
                input.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'insertText'}));
                return new Promise((resolve,reject) => {
                    const deadline = Date.now() + 10000;
                    const click = () => {
                        const row = [...document.querySelectorAll('.markdown-tree [data-node-id]')].find(item => item.querySelector('.b3-list-item__text')?.textContent === ${JSON.stringify(filename)});
                        if (row?.checkVisibility()) {const rect=row.getBoundingClientRect();resolve({x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)});return;}
                        if (Date.now() > deadline) {reject(new Error('File tree did not list the destination')); return;}
                        setTimeout(click,25);
                    }; click();
                });
            })()`);
            window.webContents.sendInputEvent({type:"mouseDown",...point,button:"left",clickCount:1});
            window.webContents.sendInputEvent({type:"mouseUp",...point,button:"left",clickCount:1});
            return window.webContents.executeJavaScript(`(async () => {
                await new Promise((resolve,reject) => {
                    const deadline = Date.now() + 15000;
                    const check = () => {
                        const input = document.querySelector('textarea.vditor-sv');
                        if (document.querySelector('#markdownName').textContent === ${JSON.stringify(filename)} &&
                            document.querySelector('#markdownEditor[aria-busy="false"]') && document.getElementById('markdownApp').getAttribute('aria-busy') !== 'true' && input?.value === ${JSON.stringify(expectedContent)}) {resolve(); return;}
                        if (Date.now() > deadline) {reject(new Error('Tree switch did not finish: '+document.body.innerText)); return;}
                        setTimeout(check,25);
                    }; check();
                });
                if (document.querySelectorAll('.markdown-header').length !== 1) throw new Error('Switch duplicated the editor header');
                if (!document.getElementById('vditor-icon-bold')) throw new Error('Switch lost the shared formatting icons');
                const preview = document.querySelector('.vditor-preview .vditor-reset');
                if (preview.textContent.trim() !== ${JSON.stringify(expectedContent.replace(/^# /, "").trim())}) throw new Error('Switch exposed an empty or stale preview');
                const files = [...document.querySelectorAll('.markdown-tree [data-node-id] .b3-list-item__text')].map(item => item.textContent);
                if (!files.includes('A.md') || !files.includes('B.md')) throw new Error('Switch exposed an unloaded directory');
                return {sessionId: (await window.siyuanMarkdown.bootstrap()).sessionId, origin: location.href};
            })()`);
        };
        const second = await switchThroughTree("B.md", "# A pending before switching\n", "# Second document\n");
        assert.notEqual(second.sessionId, initialSession);
        assert.equal(second.origin, security.origin);
        assert.equal(await fs.readFile(options.document, "utf8"), "# A pending before switching\n");
        const returned = await switchThroughTree("A.md", "# B pending before switching\n", "# A pending before switching\n");
        assert.notEqual(returned.sessionId, initialSession);
        assert.notEqual(returned.sessionId, second.sessionId);
        assert.equal(returned.origin, security.origin);
        assert.equal(window.id, containerId);
        assert.equal(window.webContents.id, contentsId);
        assert.equal(createdWindows, 1);
        assert.equal(window.isDestroyed(), false);
        assert.equal(await fs.readFile(options.secondDocument, "utf8"), "# B pending before switching\n");
        const imageRequests = [];
        imageServer = require("node:http").createServer((request, response) => {
            imageRequests.push({path: request.url, referrer: request.headers.referer});
            response.setHeader("Content-Type", "image/svg+xml");
            response.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><rect width="80" height="20" fill="green"/><script>parent.imageScriptExecuted=true</script></svg>');
        });
        await new Promise(resolve => imageServer.listen(0, "127.0.0.1", resolve));
        const origin = "http://127.0.0.1:" + imageServer.address().port;
        const networkDocument = options.document + ".network.md";
        const networkContent = `# Network image\n\n![Badge](${origin}/badge.svg)\n\n<script src="${origin}/script.js"></script>\n\n<iframe src="${origin}/frame"></iframe>\n`;
        await fs.writeFile(networkDocument, networkContent);
        window = await manager.open(networkDocument);
        await window.webContents.executeJavaScript(`new Promise((resolve,reject) => {
            const deadline=Date.now()+10000;
            const check=()=>{
                const image=document.querySelector('img[src="${origin}/badge.svg"]');
                if(image?.complete && image.naturalWidth>0) return resolve();
                if(Date.now()>deadline) return reject(new Error('Sandboxed network image did not display'));
                setTimeout(check,25);
            };check();
        })`);
        assert.equal(await window.webContents.executeJavaScript("typeof window.imageScriptExecuted"), "undefined");
        assert.equal(await window.webContents.executeJavaScript("document.querySelector('#markdownEditor iframe, #markdownEditor script') === null"), true);
        assert.equal(await fs.readFile(networkDocument, "utf8"), networkContent);
        assert.ok(imageRequests.length > 0);
        assert.ok(imageRequests.every(request => request.path === "/badge.svg" && request.referrer === undefined));
        assert.equal(await manager.prepareQuit(), true);
        assert.equal(await manager.closeAll(), true);
        assert.equal(manager.hasWindows(), false);
        assert.deepEqual(errors, []);
        imageServer.close();
        console.log("Sandboxed Markdown page and real host passed");
        app.exit(0);
    } catch (error) {
        console.error(error, errors);
        window?.destroy();
        imageServer?.close();
        app.exit(1);
    }
};

test("the production sandboxed page highlights code and preserves save, switch and resource isolation", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 90000,
}, async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-markdown-sandbox-"));
    const root = path.join(temporary, "app");
    const output = path.join(root, "stage/build/markdown");
    try {
        fs.mkdirSync(path.join(root, "appearance/langs"), {recursive: true});
        fs.copyFileSync(path.resolve(__dirname, "../../appearance/langs/en.json"), path.join(root, "appearance/langs/en.json"));
        const sharedLute = path.join(root, "stage/protyle/js/lute/lute.min.js");
        fs.mkdirSync(path.dirname(sharedLute), {recursive: true});
        fs.copyFileSync(path.resolve(__dirname, "../../stage/protyle/js/lute/lute.min.js"), sharedLute);
        const config = require("../../webpack.markdown")({}, {mode: "production"});
        config.context = path.resolve(__dirname, "../.."); config.watch = false; config.devtool = false;
        config.output = {...config.output, path: output};
        await compile(config);
        const runtime = path.join(temporary, "electron");
        const electronConfig = require("../../webpack.electron");
        await compile({...electronConfig, context: path.resolve(__dirname, "../.."), entry: {
            windows: {import: path.join(__dirname, "windows.ts"), library: {type: "commonjs2"}},
            devTools: {import: path.join(__dirname, "../window/devToolsDock.ts"), library: {type: "commonjs2"}},
            preload: path.join(__dirname, "preload.ts"),
        }, output: {...electronConfig.output, path: runtime}});
        fs.copyFileSync(path.join(__dirname, "replaceFile.ps1"), path.join(runtime, "replaceFile.ps1"));
        const documents = path.join(temporary, "documents");
        fs.mkdirSync(documents);
        const document = path.join(documents, "A.md");
        const secondDocument = path.join(documents, "B.md");
        const initialContent = "# Original document\n\n```js\ndocument.body.insertAdjacentHTML('afterbegin', ``);\n```\n";
        fs.writeFileSync(document, initialContent);
        fs.writeFileSync(secondDocument, "# Second document\n");
        const script = path.join(temporary, "run.cjs");
        fs.writeFileSync(script, `const __name = value => value;\n(${runElectron.toString()})(${JSON.stringify({root, document, secondDocument, initialContent,
    manager: path.join(runtime, "windows.js"), devTools: path.join(runtime, "devTools.js"),
    windowControlsStub: path.join(__dirname, "../fixtures/windowControlsStub.cjs"),
    profile: path.join(temporary, "profile"), config: path.join(temporary, "config")})});`);
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await promisify(execFile)(require("electron"), [script], {env, windowsHide: true, timeout: 40000});
        assert.match(result.stdout, /Sandboxed Markdown page and real host passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
        fs.rmSync(temporary, {recursive: true, force: true, maxRetries: 3});
    }
});
