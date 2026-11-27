const assert = require("node:assert/strict");
const {execFile} = require("node:child_process");
const {mkdtempSync, readFileSync, rmSync, writeFileSync} = require("node:fs");
const {tmpdir} = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {promisify} = require("node:util");
const sass = require("sass");
const {sources} = require("./docTreeController.fixture");

const browserCases = async (sources, css, markup) => {
    const check = require("node:assert/strict");
    const modules = {};
    const load = name => {
        name = name.split("/").pop();
        if (name === "dataSource" || name === "fetch" || name === "mathRender") return {};
        if (name === "hostCapabilities") return {sanitizeKernelHTML: value => value};
        if (name === "pathName") return {getDocDisplayName: value => value};
        if (!modules[name]) {
            check.ok(sources[name], `Unexpected dependency: ${name}`);
            modules[name] = {};
            new Function("require", "exports", sources[name])(load, modules[name]);
        }
        return modules[name];
    };
    const {DocTreeController} = load("DocTreeController");
    window.siyuan = {config: {fileTree: {docTreeBatchSize: 32}}, languages: {}};
    document.head.innerHTML = `<style>${css}body{display:block}.b3-list-item{height:28px;min-height:28px;box-sizing:border-box;margin:1px 8px}</style>`;
    const settle = async () => {
        // 暂停的离屏动画不持续产生绘制帧，按时间等待尺寸观察与渲染队列完成。
        await new Promise(resolve => setTimeout(resolve, 80));
    };
    const make = async count => {
        document.body.innerHTML = `<div class="fn__flex-column" style="height:500px;min-height:0;width:300px"><div class="fn__flex-1" data-file-tree-scroll><div><div class="file-tree__pins">${markup}</div><div class="file-tree__items"></div></div></div></div>`;
        const element = document.querySelector("[data-pin-list]");
        const scrollElement = document.querySelector("[data-file-tree-scroll]");
        const files = Array.from({length: count}, (_, i) => ({id: `c${i}`, name: `Child ${i}`, path: `/p/c${i}.sy`, subFileCount: 0}));
        const source = {range: async request => ({box: "box", parentID: request.parentID, path: "/p.sy",
            files: files.slice(request.offset, request.offset + request.limit), total: files.length,
            offset: request.offset, limit: request.limit, revision: "one", stale: false, effectiveSortMode: 0})};
        const controller = new DocTreeController({element, scrollElement, source, roots: [
            {id: "p", notebookId: "box", path: "/p.sy", name: "Parent", kind: "document", occurrenceKey: "pin:p", subFileCount: count},
            {id: "next", notebookId: "box", path: "/next.sy", name: "Next", kind: "document", occurrenceKey: "pin:next", subFileCount: 0},
        ], renderRow: item => {
            const row = document.createElement("li");
            row.className = "b3-list-item";
            row.textContent = item.name;
            return row;
        }});
        await settle();
        return {controller, element, scrollElement};
    };
    const groupOf = element => element.querySelector("[data-tree-animation]");
    const waitForTransitionCleanup = async (element, message) => {
        const deadline = performance.now() + 2000;
        while (groupOf(element) && performance.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        check.equal(groupOf(element), null, message);
    };
    for (const count of [3, 20, 10000]) {
        const {controller, element} = await make(count);
        for (const expanded of [true, false]) {
            await controller.toggle("pin:p", expanded);
            const group = groupOf(element);
            check.ok(group, "pinned subtree starts a transition");
            const animation = group.getAnimations()[0];
            animation.pause();
            for (const time of [40, 100, 160]) {
                animation.currentTime = time;
                await settle();
                check.equal(groupOf(element), group, `own height changes must preserve the transition: ${count}/${expanded}/${time}`);
                const height = group.getBoundingClientRect().height;
                check.ok(height > 0 && height < count * 30);
                check.ok(element.querySelectorAll("[data-tree-key]").length < 60, "animation preserves virtualization");
            }
            animation.finish();
            await waitForTransitionCleanup(element, "finished animation must remove the transition group");
            check.equal(controller.isExpanded("pin:p"), expanded);
            if (expanded) {
                const parent = controller.getMountedElement("pin:p");
                const child = controller.getMountedElement("pin:p/c0");
                check.ok(child && Math.abs(child.getBoundingClientRect().top - parent.getBoundingClientRect().bottom - 2) < 1,
                    "the completed window has no gap before the first child");
            }
        }
        controller.destroy();
    }
    for (const change of ["width", "row-height", "available-height", "scroll", "rapid-toggle", "destroy"]) {
        const {controller, element, scrollElement} = await make(20);
        await controller.toggle("pin:p", true);
        const group = groupOf(element);
        const animation = group.getAnimations()[0];
        animation.pause();
        animation.currentTime = 100;
        await settle();
        check.equal(groupOf(element), group);
        if (change === "width") element.style.width = "240px";
        if (change === "row-height") controller.getMountedElement("pin:p").style.height = "40px";
        if (change === "available-height") scrollElement.style.maxHeight = "80px";
        if (change === "scroll") scrollElement.dispatchEvent(new Event("wheel"));
        if (change === "rapid-toggle") {
            await controller.toggle("pin:p", false);
            check.equal(group.isConnected, false, "a new toggle ends the previous transition");
            scrollElement.dispatchEvent(new Event("wheel"));
        }
        if (change === "destroy") controller.destroy();
        await waitForTransitionCleanup(element, `${change} must end the transition`);
        if (change !== "destroy") controller.destroy();
    }

    const {controller, element, scrollElement} = await make(10000);
    const files = document.querySelector(".file-tree__items");
    const ordinary = new DocTreeController({element: files, scrollElement, roots: Array.from({length: 300}, (_, index) => ({
        id: `book${index}`, notebookId: `book${index}`, path: "/", name: `Notebook ${index}`, kind: "notebook",
        occurrenceKey: `notebook:book${index}`, subFileCount: 0,
    })), renderRow: item => {
        const row = document.createElement("li");
        row.className = "b3-list-item";
        row.textContent = item.name;
        return row;
    }});
    await controller.toggle("pin:p", true, false);
    await settle();
    check.equal(ordinary.getScrollAnchor(), undefined, "notebooks do not own the pin viewport's anchor");
    const notebook = await ordinary.ensureRendered("notebook:book120", "center");
    const viewport = scrollElement.getBoundingClientRect();
    check.ok(notebook.getBoundingClientRect().top > viewport.top && notebook.getBoundingClientRect().bottom < viewport.bottom);
    check.ok(scrollElement.scrollTop > 10000 * 28, "locating a notebook crosses the preceding pinned rows");
    await settle();
    check.ok(element.querySelectorAll("[data-tree-key]").length < 60 && files.querySelectorAll("[data-tree-key]").length < 60);
    const notebookScroll = scrollElement.scrollTop;
    const notebookAnchor = ordinary.getScrollAnchor();
    check.ok(notebookAnchor.occurrenceKey.startsWith("notebook:book"));
    await controller.ensureRendered("pin:p");
    check.ok(scrollElement.scrollTop < viewport.height, "locating a pin returns to the top section");
    ordinary.restoreScrollAnchor(notebookAnchor);
    check.ok(Math.abs(scrollElement.scrollTop - notebookScroll) <= 1, "restoring the notebook anchor includes the pinned section's offset");
    ordinary.destroy();
    controller.destroy();
    return "Pinned animation cases passed";
};

test("shared desktop and mobile document viewport preserves animations, virtualization and scroll anchors", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 60000,
}, async () => {
    const sheets = ["base", "mobile"].map(name => sass.compile(path.join(__dirname, `../src/assets/scss/${name}.scss`), {logger: sass.Logger.silent}).css);
    const source = readFileSync(path.join(__dirname, "../src/layout/dock/PinnedDocs.ts"), "utf8");
    const markup = source.match(/this\.element\.innerHTML = `([\s\S]+?)`;/)[1].replace("${window.siyuan.languages.pinnedDocs}", "Pinned");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-pinned-animation-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app,BrowserWindow}=require("electron");
app.setPath("userData",${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:900,height:750,webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true,backgroundThrottling:false}});
 try{
  await win.loadURL("about:blank");
  win.webContents.debugger.attach("1.3");
  await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]});
  for(const css of ${JSON.stringify(sheets)}){
   await win.loadURL("about:blank");
   console.log(await win.webContents.executeJavaScript("("+${JSON.stringify(browserCases.toString())}+")("+JSON.stringify(${JSON.stringify(sources())})+","+JSON.stringify(css)+","+JSON.stringify(${JSON.stringify(markup)})+")"));
  }
  win.destroy();app.exit(0);
 }catch(error){console.error(error);win.destroy();app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron"), [script], {env, windowsHide: true, timeout: 50000});
        assert.equal(result.stdout.match(/Pinned animation cases passed/g)?.length, 2);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-pinned-animation-"));
        rmSync(temporary, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    }
});
