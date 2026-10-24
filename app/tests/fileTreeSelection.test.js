const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sources = () => {
    const ts = require("typescript");
    return ["layout/dock/Files.ts", "mobile/dock/MobileFiles.ts"].map(file => {
        const source = ts.createSourceFile(file, readFileSync(path.join(__dirname, "../src", file), "utf8"),
            ts.ScriptTarget.Latest, true);
        const declaration = source.statements.find(ts.isClassDeclaration);
        const methods = declaration.members.filter(member =>
            ["onLsSelect", "onLsHTML", "selectItem"].includes(member.name?.getText(source)));
        assert.equal(methods.length, 3);
        return ts.transpileModule(`class FileTree {${methods.map(member => member.getText(source)).join("\n")}}`, {
            compilerOptions: {target: ts.ScriptTarget.ES2021},
        }).outputText;
    });
};

const cases = async sources => {
    const check = require("node:assert/strict");
    const itemHTML = (id, itemPath, open = false) => `<li class="b3-list-item" data-node-id="${id}" data-path="${itemPath}">
<span class="b3-list-item__toggle"><span class="b3-list-item__arrow${open ? " b3-list-item__arrow--open" : ""}"></span></span></li>`;
    for (const source of sources) {
        for (const parentPath of ["/", "/parent.sy"]) {
            for (const expanded of [true, false]) {
                const prefix = parentPath === "/" ? "" : "/parent";
                const a = `${prefix}/a.sy`;
                const b = `${prefix}/b.sy`;
                const c = `${prefix}/c.sy`;
                const data = {box: "box", path: parentPath, files: [
                    {id: "a", path: a}, {id: "b", path: b}, {id: "c", path: c},
                ]};
                document.body.innerHTML = `<div id="tree"><ul data-url="box">${itemHTML("parent", parentPath, expanded)}${expanded ?
                    `<ul>${itemHTML("a", a, true)}<ul>${itemHTML("child", `${prefix}/a/child.sy`, true)}<ul><li data-node-id="grandchild">Preserved</li></ul></ul>${itemHTML("c", c)}</ul>` : ""}</ul></div>`;
                const tree = document.querySelector("#tree");
                const oldSubtree = tree.querySelector('[data-node-id="a"]')?.nextElementSibling.innerHTML;
                let stored = 0;
                const FileTree = new Function("window", "pathPosix", "fetchSyncPost", "Constants",
                    "getResponseEffectiveSortMode", "FILE_TREE_EFFECTIVE_SORT_MODE", "hasClosestByClassName",
                    "syncFileTreeItemDefaultIcon", "expandFileTree", source + "; return FileTree;")(
                    {siyuan: {config: {fileTree: {boxDocEnabled: false}}}},
                    () => ({dirname: value => value.slice(0, value.lastIndexOf("/")) || "/"}),
                    async () => ({code: 0, data}), {}, () => 0, "data-sort-mode",
                    (element, name) => element.closest(`.${name}`), () => {}, (_element, callback) => callback());
                const panel = new FileTree();
                Object.assign(panel, {
                    element: tree, parentDocClick: {cancel() {}},
                    genFileHTML: item => itemHTML(item.id, item.path),
                    restoreMovedExpandedItems() {}, refreshPublishAccessSwitch() {},
                    getOpenPaths: () => { stored++; },
                    setCurrent: element => {
                        tree.querySelectorAll(".b3-list-item--focus").forEach(item => item.classList.remove("b3-list-item--focus"));
                        element.classList.add("b3-list-item--focus");
                    },
                });
                const selected = await panel.selectItem("box", b);
                check.equal(selected.dataset.nodeId, "b");
                check.ok(selected.classList.contains("b3-list-item--focus"));
                check.equal(stored, 1);
                check.equal(tree.querySelectorAll('[data-node-id="b"]').length, 1);
                check.ok(tree.querySelector('[data-node-id="parent"] .b3-list-item__arrow--open'));
                check.equal(tree.querySelector('[data-node-id="c"] .b3-list-item__arrow--open'), null);
                if (expanded) {
                    check.ok(tree.querySelector('[data-node-id="a"] .b3-list-item__arrow--open'),
                        "creating a sibling must preserve the expanded branch");
                    check.equal(tree.querySelector('[data-node-id="a"]').nextElementSibling.innerHTML, oldSubtree);
                    check.ok(tree.querySelector('[data-node-id="child"] .b3-list-item__arrow--open'));
                }
            }
        }
    }
    return "File tree selection cases passed";
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(`(${cases.toString()})(${JSON.stringify(sources())})`));
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
    require("node:test").test("creating a sibling preserves expanded subtrees in desktop and mobile file trees", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-file-tree-selection-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /File tree selection cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-file-tree-selection-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
