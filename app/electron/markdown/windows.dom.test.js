const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {execFile} = require("node:child_process");
const {promisify} = require("node:util");
const {prepareMarkdownAssets} = require("../../scripts/markdown-assets");

const runElectron = async options => {
    const {app, BrowserWindow, ipcMain, protocol, nativeTheme} = require("electron");
    const fs = require("node:fs/promises");
    const assert = require("node:assert/strict");
    const {createMarkdownWindows, registerMarkdownSchemes} = require(options.manager);
    registerMarkdownSchemes(protocol);
    app.setPath("userData", options.profile);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
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
    try {
        const manager = createMarkdownWindows({app, BrowserWindow: HiddenWindow, ipcMain, nativeTheme,
            rootDirectory: options.root, configDirectory: options.config,
            dialog: {showMessageBox: async () => ({response: 0})}, shell: {openExternal: async () => { throw new Error("Unexpected link"); }}});
        window = await manager.open(options.document);
        await window.webContents.executeJavaScript(`new Promise((resolve,reject) => {
            const deadline = Date.now() + 15000;
            const check = () => {
                if (document.querySelector('#markdownEditor[aria-busy="false"] .vditor-ir')) return resolve();
                if (Date.now() > deadline) return reject(new Error('Editor did not initialize: '+document.body.innerText));
                setTimeout(check, 25);
            }; check();
        })`);
        const security = await window.webContents.executeJavaScript(`({node: typeof require, process: typeof process,
            host: typeof window.siyuanMarkdown.host.write, unsafe: typeof window.siyuanMarkdown.invoke,
            origin: location.href, text: document.querySelector('#markdownEditor').innerText})`);
        assert.equal(security.node, "undefined");
        assert.equal(security.process, "undefined");
        assert.equal(security.host, "function");
        assert.equal(security.unsafe, "undefined");
        assert.match(security.origin, /^siyuan-markdown:\/\/[a-f\d-]+\/index.html$/);
        assert.match(security.text, /Original document/);
        assert.equal(await fs.readFile(options.document, "utf8"), "# Original document\n");
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
            return window.webContents.executeJavaScript(`(async () => {
                const input = document.querySelector('textarea.vditor-sv');
                input.value = ${JSON.stringify(pendingContent)};
                input.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'insertText'}));
                await new Promise((resolve,reject) => {
                    const deadline = Date.now() + 10000;
                    const click = () => {
                        const row = [...document.querySelectorAll('.markdown-tree [data-node-id]')].find(item => item.querySelector('.b3-list-item__text')?.textContent === ${JSON.stringify(filename)});
                        if (row) { row.click(); resolve(); return; }
                        if (Date.now() > deadline) {reject(new Error('File tree did not list the destination')); return;}
                        setTimeout(click,25);
                    }; click();
                });
                await new Promise((resolve,reject) => {
                    const deadline = Date.now() + 15000;
                    const check = () => {
                        const input = document.querySelector('textarea.vditor-sv');
                        if (document.querySelector('#markdownName').textContent === ${JSON.stringify(filename)} &&
                            document.querySelector('#markdownEditor[aria-busy="false"]') && input?.value === ${JSON.stringify(expectedContent)}) {resolve(); return;}
                        if (Date.now() > deadline) {reject(new Error('Tree switch did not finish: '+document.body.innerText)); return;}
                        setTimeout(check,25);
                    }; check();
                });
                if (document.querySelectorAll('.markdown-header').length !== 1) throw new Error('Switch duplicated the editor header');
                if (!document.getElementById('vditor-icon-bold')) throw new Error('Switch lost the shared formatting icons');
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
        assert.equal(await manager.prepareQuit(), true);
        assert.equal(await manager.closeAll(), true);
        assert.equal(manager.hasWindows(), false);
        assert.deepEqual(errors, []);
        console.log("Sandboxed Markdown page and real host passed");
        app.exit(0);
    } catch (error) {
        console.error(error, errors);
        window?.destroy();
        app.exit(1);
    }
};

test("the real sandboxed page saves and switches A to B to A through its restricted host and file tree", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-markdown-sandbox-"));
    const root = path.join(temporary, "app");
    const output = path.join(root, "stage/build/markdown");
    try {
        prepareMarkdownAssets(output);
        fs.mkdirSync(path.join(root, "appearance/langs"), {recursive: true});
        fs.copyFileSync(path.resolve(__dirname, "../../appearance/langs/en.json"), path.join(root, "appearance/langs/en.json"));
        const esbuild = require(require.resolve("esbuild", {paths: [path.dirname(require.resolve("esbuild-loader"))]}));
        await esbuild.build({entryPoints: [path.resolve(__dirname, "../../src/markdown/index.ts")], bundle: true,
            outfile: path.join(output, "test.js"), platform: "browser", target: "es2022", define: {SIYUAN_VERSION: '"test"'},
            plugins: [{name: "test-style", setup(build) { build.onLoad({filter: /\.scss$/}, () => ({contents: "", loader: "js"})); }}]});
        const style = require("sass").compile(path.resolve(__dirname, "../../src/assets/scss/markdown.scss")).css;
        fs.writeFileSync(path.join(output, "ui.css"), style);
        const template = fs.readFileSync(path.resolve(__dirname, "../../src/assets/template/markdown/index.tpl"), "utf8")
            .replace("</head>", '<link rel="stylesheet" href="./test.css"><link rel="stylesheet" href="./ui.css"><script defer src="./test.js"></script></head>');
        fs.writeFileSync(path.join(output, "index.html"), template);
        const documents = path.join(temporary, "documents");
        fs.mkdirSync(documents);
        const document = path.join(documents, "A.md");
        const secondDocument = path.join(documents, "B.md");
        fs.writeFileSync(document, "# Original document\n");
        fs.writeFileSync(secondDocument, "# Second document\n");
        const script = path.join(temporary, "run.cjs");
        fs.writeFileSync(script, `(${runElectron.toString()})(${JSON.stringify({root, document, secondDocument,
            manager: path.join(__dirname, "windows.js"), profile: path.join(temporary, "profile"), config: path.join(temporary, "config")})});`);
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await promisify(execFile)(require("electron"), [script], {env, windowsHide: true, timeout: 40000});
        assert.match(result.stdout, /Sandboxed Markdown page and real host passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
        fs.rmSync(temporary, {recursive: true, force: true, maxRetries: 3});
    }
});
