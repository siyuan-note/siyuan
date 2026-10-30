const {readFileSync} = require("node:fs");
const path = require("node:path");

exports.sources = () => {
    const ts = require("typescript");
    return Object.fromEntries(["types", "DocTreeModel", "DocTreeController", "transactionOperations"].map(name => [name,
        ts.transpileModule(readFileSync(path.join(__dirname, name === "transactionOperations" ? "../src/util" :
            "../src/layout/dock/docTree", name + ".ts"), "utf8"), {
            compilerOptions: {target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS},
        }).outputText]));
};

exports.cases = async sources => {
    const check = require("node:assert/strict");
    const modules = {};
    const load = name => {
        name = name.split("/").pop();
        if (name === "dataSource") { return {}; }
        if (!modules[name]) {
            modules[name] = {};
            new Function("require", "exports", sources[name])(load, modules[name]);
        }
        return modules[name];
    };
    const {DocTreeController} = load("DocTreeController");
    window.siyuan = {config: {fileTree: {docTreeBatchSize: 32}}, languages: {loading: "Loading", retry: "Retry"}};
    document.head.innerHTML = "<style>.b3-list-item{box-sizing:border-box;min-height:var(--b3-ui-list-height,28px);height:var(--b3-ui-list-height,28px);margin:1px 8px;list-style:none}ul{margin:0;padding:0}</style>";
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const fullyVisible = (row, viewport) => {
        const bounds = row.getBoundingClientRect();
        const view = viewport.getBoundingClientRect();
        check.ok(bounds.top >= view.top && bounds.bottom <= view.bottom,
            `row ${row.dataset.treeKey} clipped: ${bounds.top}..${bounds.bottom}, viewport ${view.top}..${view.bottom}`);
    };
    const file = (id, parent = "", children = 0) => ({id, name: id, path: `/${parent ? parent + "/" : ""}${id}.sy`,
        subFileCount: children, icon: "", name1: "", alias: "", memo: "", bookmark: "", count: 0,
        hMtime: "", hCtime: "", hSize: ""});
    const make = (size = 100000) => {
        const directories = new Map([["", Array.from({length: size}, (_, index) => file("d" + index))]]);
        const requests = [];
        const locates = [];
        let revision = "one";
        const source = {
            async range(request) {
                requests.push({...request});
                const files = directories.get(request.parentID) || [];
                const stale = Boolean(request.revision && request.revision !== revision);
                return {box: "box", parentID: request.parentID, path: request.parentID ? `/${request.parentID}.sy` : "/",
                    files: stale ? [] : files.slice(request.offset, request.offset + request.limit), total: files.length,
                    offset: request.offset, limit: request.limit, effectiveSortMode: 0, revision, stale};
            },
            async locate(request) {
                locates.push(request.id);
                const steps = [];
                let id = request.id;
                while (id !== "box") {
                    let found;
                    for (const [parentID, files] of directories) {
                        const index = files.findIndex(item => item.id === id);
                        if (index >= 0) { found = {parentID, index, files}; break; }
                    }
                    if (!found) { return {box: "box", id: request.id, steps: []}; }
                    steps.unshift({parentID: found.parentID, path: found.parentID ? `/${found.parentID}.sy` : "/",
                        id, index: found.index, total: found.files.length, effectiveSortMode: 0, revision});
                    id = found.parentID || "box";
                }
                return {box: "box", id: request.id, steps};
            },
        };
        const element = document.createElement("div");
        element.style.cssText = "height:280px;width:300px;overflow:auto;position:relative";
        document.body.append(element);
        const progress = [];
        const controller = new DocTreeController({element, source,
            roots: [{id: "box", notebookId: "box", kind: "notebook", name: "Box", path: "/", subFileCount: size}],
            renderRow: item => {
                const row = document.createElement("li");
                row.className = "b3-list-item";
                row.dataset.type = item.kind === "notebook" ? "navigation-root" : "navigation-file";
                row.innerHTML = '<span class="b3-list-item__toggle"><svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg></span><span class="b3-list-item__text"></span>';
                row.querySelector(".b3-list-item__text").textContent = item.name;
                return row;
            }, onSelectionProgress: (loaded, total, cancel) => progress.push({loaded, total, cancel}),
        });
        return {controller, element, directories, requests, locates, source, progress,
            revise: value => { revision = value; }, destroy: () => { controller.destroy(); element.remove(); }};
    };
    {
        const fixture = make();
        const {controller, element, requests, locates} = fixture;
        await controller.toggle("notebook:box", true);
        check.equal(controller.model.rowCount, 100001);
        check.equal(element.querySelector('[data-type="navigation-root"]').getAttribute("data-node-id"), null);
        const far = await controller.locate("box", "d90000");
        await frame();
        check.equal(far.dataset.nodeId, "d90000");
        fullyVisible(far, element);
        check.deepEqual(locates, ["d90000"]);
        check.ok(requests.length < 8, "far location must not load preceding ranges");
        check.ok(element.querySelectorAll("[data-tree-key]").length <= 28);
        const key = far.dataset.treeKey;
        controller.retain(key);
        element.scrollTop = 0;
        element.dispatchEvent(new Event("scroll"));
        await frame();
        check.equal(controller.getMountedElement(key), far, "dragging keeps the original DOM row");
        controller.release(key);
        await frame();
        check.equal(controller.getMountedElement(key), undefined);
        check.equal(controller.getSelectedItems()[0].id, "d90000", "recycling keeps logical selection");
        check.equal(controller.getSelectionElements()[0].dataset.nodeId, "d90000");
        await controller.focusRelative(1);
        fullyVisible(controller.getMountedElement("notebook:box/d90001"), element);
        element.style.setProperty("--b3-ui-list-height", "40px");
        await controller.focusBoundary("last");
        fullyVisible(controller.getMountedElement("notebook:box/d99999"), element);
        await controller.focusBoundary("first");
        fullyVisible(controller.getMountedElement("notebook:box"), element);
        fixture.destroy();
    }
    {
        const fixture = make(5000);
        const {controller, element} = fixture;
        await controller.toggle("notebook:box", true);
        await controller.locate("box", "d100", {scroll: false});
        for (let offset = 2048; offset <= 4352; offset += 32) {
            await controller.itemAtDirectoryIndex("notebook:box", offset);
        }
        check.equal(controller.model.getItem("notebook:box/d100"), undefined, "anchor page was actually evicted");
        controller.setRoots(controller.model.roots);
        check.deepEqual(controller.getSelectedItems().map(item => item.id), ["d100"], "root refresh preserves unloaded selection");
        await controller.select("notebook:box/d4320", {range: true, scroll: false});
        check.equal(controller.getSelectedItems().length, 4221, "range retains its anchor after page eviction");
        check.equal(controller.getSelectedItems()[0].id, "d100");
        check.ok(controller.model.directory(controller.model.roots[0]).files.size <= 64 * 32,
            "selection does not pin all range pages");
        fullyVisible(await controller.ensureRendered("notebook:box/d100"), element);
        await controller.select("notebook:box/d100", {scroll: false});
        await controller.select("notebook:box/d100", {toggle: true, scroll: false});
        element.scrollTop = 0;
        controller.render();
        for (let offset = 2048; offset <= 4352; offset += 32) {
            await controller.itemAtDirectoryIndex("notebook:box", offset);
        }
        check.equal(controller.model.getItem("notebook:box/d100"), undefined);
        check.equal(controller.getSelectedItems().length, 0);
        check.equal(controller.getFocusedItem().id, "d100", "deselected focus survives page eviction");
        await controller.select("notebook:box/d4320", {range: true, scroll: false});
        check.equal(controller.getSelectedItems().length, 4221, "deselected range anchor survives page eviction");
        controller.setRoots([]);
        check.equal(controller.getSelectedItems().length, 0);
        check.equal(controller.getFocusedItem(), undefined);
        fixture.destroy();
    }
    {
        const fixture = make(500);
        const {controller, element, requests, locates, progress} = fixture;
        await controller.toggle("notebook:box", true);
        await controller.select("notebook:box/d0", {scroll: false});
        await controller.locate("box", "d299", {select: false, scroll: false});
        await controller.select("notebook:box/d299", {range: true, scroll: false});
        check.equal(controller.getSelectedItems().length, 300);
        check.equal(controller.getSelectionElements().length, 300);
        check.ok(element.querySelectorAll("[data-tree-key]").length < 30);
        check.ok(progress.some(item => item.total === 300));
        check.equal(progress.at(-1).total, 0);
        const version = controller.selectionVersion;
        element.scrollTop = 2000;
        element.dispatchEvent(new Event("scroll"));
        await frame();
        check.equal(controller.selectionVersion, version);
        requests.length = 0;
        locates.length = 0;
        fixture.revise("two");
        await controller.reload({notebook: "box", parentID: ""});
        check.equal(controller.getSelectedItems().length, 300);
        check.equal(locates.length, 0);
        check.ok(requests.length <= 11, "bulk selection refresh is batched");
        fixture.destroy();
    }
    {
        const fixture = make(2);
        const {controller, directories} = fixture;
        directories.set("", [file("a", "", 1), file("c")]);
        directories.set("a", [file("child", "a", 1)]);
        directories.set("child", [file("grandchild", "a/child")]);
        await controller.toggle("notebook:box", true);
        await controller.toggle("notebook:box/a", true);
        await controller.toggle("notebook:box/a/child", true);
        directories.set("", [file("c"), file("b"), file("a", "", 1)]);
        fixture.revise("two");
        await controller.reload({notebook: "box", parentID: ""});
        await controller.locate("box", "b");
        check.ok(controller.isExpanded("notebook:box/a"));
        check.ok(controller.isExpanded("notebook:box/a/child"));
        check.equal(controller.model.rowAt(controller.model.indexOf("notebook:box/a") + 1).item.id, "child");
        check.equal(controller.model.rowAt(controller.model.indexOf("notebook:box/a/child") + 1).item.id, "grandchild");
        await controller.toggle("notebook:box/a", false);
        check.ok(!controller.isExpanded("notebook:box/a/child"), "collapsing removes descendant expansion intent");
        await controller.reload();
        check.ok(!controller.isExpanded("notebook:box/a"), "refresh cannot reopen a collapsed ancestor");
        fixture.destroy();
    }
    {
        const fixture = make(100);
        const {controller, source} = fixture;
        const original = source.range;
        let release;
        source.range = request => new Promise(resolve => { release = async () => resolve(await original(request)); });
        const restore = controller.restoreExpanded([
            {notebookId: "box", id: "box", kind: "notebook"},
            {notebookId: "box", id: "d0", kind: "document"},
        ]);
        controller.collapseAll();
        await release();
        await restore;
        check.equal(controller.getExpandedItems().length, 0, "user collapse cancels an older multi-step restore");
        fixture.destroy();
    }
    {
        const fixture = make(100);
        const {controller, source} = fixture;
        const original = source.locate;
        let release;
        source.locate = request => request.id === "d0" ? new Promise(resolve => {
            release = async () => resolve(await original(request));
        }) : original(request);
        const restore = controller.restoreExpanded([{notebookId: "box", id: "d0", kind: "document"}]);
        controller.collapseAll();
        await release();
        await restore;
        check.equal(controller.getExpandedItems().length, 0, "late locate cannot expand a restored ancestor");
        const old = controller.locate("box", "d0");
        await controller.locate("box", "d80");
        await release();
        await old;
        check.deepEqual(controller.getSelectedItems().map(item => item.id), ["d80"],
            "a newer user location wins over an older location");
        fixture.destroy();
    }
    {
        const fixture = make(80);
        const {controller, source, element} = fixture;
        let release;
        const original = source.range;
        source.range = request => new Promise(resolve => { release = async () => resolve(await original(request)); });
        const pending = controller.toggle("notebook:box", true);
        controller.removeNotebook("box");
        await release();
        await pending;
        await frame();
        check.equal(controller.model.directories.size, 0);
        check.equal(controller.getSelectionElements().length, 0);
        check.equal(element.querySelectorAll("[data-tree-key]").length, 0);
        fixture.destroy();
    }
    {
        const fixture = make(200);
        const {controller, progress} = fixture;
        await controller.toggle("notebook:box", true);
        await controller.select("notebook:box/d0", {scroll: false});
        await controller.locate("box", "d150", {select: false, scroll: false});
        const pending = controller.select("notebook:box/d150", {range: true, scroll: false});
        progress.at(-1).cancel();
        await pending;
        check.deepEqual(controller.getSelectedItems().map(item => item.id), ["d0"]);
        check.equal(progress.at(-1).total, 0);
        fixture.destroy();
    }
    {
        const fixture = make(100);
        const {controller, source, directories} = fixture;
        directories.get("")[0].subFileCount = 1;
        directories.set("d0", [file("child", "d0")]);
        await controller.toggle("notebook:box", true);
        await controller.toggle("notebook:box/d0", true);
        await controller.select("notebook:box/d0", {scroll: false});
        const original = source.range;
        let release;
        source.range = async request => {
            const response = await original(request);
            if (request.offset === 64 && !release) {
                return new Promise(resolve => { release = () => resolve(response); });
            }
            return response;
        };
        const old = controller.itemAtDirectoryIndex("notebook:box", 64);
        await Promise.resolve();
        await Promise.resolve();
        const files = directories.get("");
        const moved = files.shift();
        files.splice(70, 0, moved);
        fixture.revise("two");
        await controller.itemAtDirectoryIndex("notebook:box", 96);
        release();
        await old;
        await frame();
        check.equal(controller.findItem("box", "d0").index, 70);
        check.equal(controller.model.directory(controller.model.roots[0]).revision, "two");
        check.equal(controller.model.child(controller.model.roots[0], 70).id, "d0",
            "a late old range must not overwrite a rebuilt revision");
        check.ok(controller.isExpanded("notebook:box/d0"));
        check.equal(controller.model.rowAt(controller.model.indexOf("notebook:box/d0") + 1).item.id, "child");
        check.deepEqual(controller.getSelectedItems().map(item => item.id), ["d0"]);
        fixture.destroy();
    }
    {
        const fixture = make(220);
        const {controller, source, progress, element} = fixture;
        await controller.toggle("notebook:box", true);
        await controller.locate("box", "d150", {select: false, scroll: false});
        await controller.locate("box", "d210", {select: false, scroll: false});
        await controller.select("notebook:box/d0", {scroll: false});
        const original = source.range;
        const pending = new Map();
        source.range = request => [32, 64].includes(request.offset) ? new Promise(resolve => {
            pending.set(request.offset, async () => resolve(await original(request)));
        }) : original(request);
        const first = controller.select("notebook:box/d150", {range: true, scroll: false});
        while (!pending.has(32)) { await Promise.resolve(); }
        const second = controller.select("notebook:box/d210", {range: true, scroll: false});
        pending.get(32)();
        await first;
        while (!pending.has(64)) { await Promise.resolve(); }
        check.equal(element.querySelector('[role="tree"]').getAttribute("aria-busy"), "true");
        check.equal(progress.at(-1).total, 211, "an older range cannot dismiss the newer progress indicator");
        pending.get(64)();
        await second;
        check.equal(controller.getSelectedItems().length, 211);
        check.equal(progress.at(-1).total, 0);
        fixture.destroy();
    }
    {
        const fixture = make(100);
        const {controller, source} = fixture;
        await controller.toggle("notebook:box", true);
        await controller.select("notebook:box/d0", {scroll: false});
        const original = source.range;
        let release;
        source.range = async request => {
            const response = await original(request);
            if (request.offset === 0 && !release) {
                return new Promise(resolve => { release = () => resolve(response); });
            }
            return response;
        };
        const refresh = controller.reload({notebook: "box", parentID: ""});
        await Promise.resolve();
        await Promise.resolve();
        await controller.locate("box", "d80");
        release();
        await refresh;
        check.deepEqual(controller.getSelectedItems().map(item => item.id), ["d80"],
            "user selection wins over an older refresh");
        fixture.destroy();
    }
    {
        const fixture = make(100);
        const {controller, source, element} = fixture;
        await controller.toggle("notebook:box", true);
        const original = source.range;
        let release;
        source.range = async request => {
            const response = await original(request);
            if (request.offset === 0 && !release) {
                return new Promise(resolve => { release = () => resolve(response); });
            }
            return response;
        };
        const refresh = controller.reload();
        while (!release) { await Promise.resolve(); }
        element.dispatchEvent(new WheelEvent("wheel", {deltaY: 1120}));
        element.scrollTop = 1120;
        element.dispatchEvent(new Event("scroll"));
        release();
        await refresh;
        check.equal(element.scrollTop, 1120, "an older refresh cannot undo user scrolling");
        fixture.destroy();
    }
    {
        const fixture = make(10000);
        const {controller, source, element, directories} = fixture;
        await controller.locate("box", "d9000");
        const before = controller.getMountedElement("notebook:box/d9000");
        const top = element.scrollTop;
        const original = source.range;
        const pending = new Map();
        source.range = async request => {
            const response = await original(request);
            if ([0, 8992].includes(request.offset)) {
                return new Promise(resolve => pending.set(request.offset, () => resolve(response)));
            }
            return response;
        };
        directories.get("")[9000] = {...directories.get("")[9000], name: "Renamed"};
        fixture.revise("two");
        const refreshing = controller.reload({notebook: "box", parentID: ""});
        while (!pending.has(0)) { await Promise.resolve(); }
        await frame();
        check.equal(controller.getMountedElement("notebook:box/d9000"), before, "refresh retains the visible row while the first range loads");
        check.equal(element.querySelector("[data-tree-loading]"), null, "rename never replaces the panel with loading rows");
        pending.get(0)();
        while (!pending.has(8992)) { await Promise.resolve(); }
        await frame();
        check.equal(controller.getMountedElement("notebook:box/d9000"), before, "refresh retains rows until the offscreen anchor range is ready");
        check.equal(element.querySelector("[data-tree-loading]"), null);
        pending.get(8992)();
        await refreshing;
        check.equal(controller.getMountedElement("notebook:box/d9000").textContent, "Renamed");
        check.equal(element.scrollTop, top);
        check.deepEqual(controller.getSelectedItems().map(item => item.id), ["d9000"]);
        fullyVisible(controller.getMountedElement("notebook:box/d9000"), element);
        fixture.destroy();
    }
    {
        const fixture = make(10);
        const {controller, source, element} = fixture;
        await controller.toggle("notebook:box", true);
        const original = source.range;
        let reject;
        source.range = request => reject ? original(request) : new Promise((_resolve, fail) => { reject = fail; });
        const older = controller.reload();
        while (!reject) { await Promise.resolve(); }
        const newer = controller.reload();
        const warnings = [];
        const warn = console.warn;
        console.warn = (...args) => warnings.push(args);
        try {
            reject(new Error("document tree changed, please retry"));
            await older;
            await newer;
        } finally {
            console.warn = warn;
        }
        check.equal(warnings.length, 1, "a failed refresh is reported once before its queued successor recovers");
        check.equal(element.querySelector("[data-tree-loading]"), null);
        check.ok(controller.getMountedElement("notebook:box/d0"), "an older failure cannot replace the newer completed refresh");
        fixture.destroy();
    }
    {
        const fixture = make(6);
        const {controller, source, element, directories, locates} = fixture;
        directories.get("")[1].subFileCount = 1;
        directories.set("d1", [file("child", "d1")]);
        await controller.toggle("notebook:box", true);
        await controller.toggle("notebook:box/d1", true);
        controller.setRoots([...controller.model.roots, {id: "d1", notebookId: "box", kind: "document",
            occurrenceKey: "pin:d1", name: "Pinned", path: "/d1.sy", subFileCount: 1}]);
        await controller.toggle("pin:d1", true);
        await controller.select("notebook:box/d1", {scroll: false});
        await controller.select("notebook:box/d1/child", {toggle: true, scroll: false});
        await controller.select("pin:d1", {toggle: true, scroll: false});
        await controller.select("notebook:box/d3", {toggle: true, scroll: false});
        controller.render();
        locates.length = 0;
        const original = source.range;
        let release;
        source.range = async request => {
            const response = await original(request);
            return new Promise(resolve => { release = () => resolve(response); });
        };
        directories.set("", directories.get("").filter(item => item.id !== "d1"));
        directories.delete("d1");
        fixture.revise("two");
        const reload = controller.reload.bind(controller);
        let refreshed;
        controller.reload = filter => { refreshed = reload(filter); return refreshed; };
        controller.handleMessage({cmd: "removeDoc", data: {ids: ["d1", "child"]}});
        check.equal(element.querySelector('[data-node-id="d1"]'), null, "confirmed deletion removes all visible occurrences before refreshing");
        check.equal(element.querySelector('[data-node-id="child"]'), null, "confirmed deletion removes expanded descendants immediately");
        check.ok(controller.getMountedElement("notebook:box/d0"), "deletion keeps unaffected rows visible");
        check.ok(controller.getSelectedItems().every(item => !["d1", "child"].includes(item.id)),
            "deleted entries cannot remain selected while the remaining selection is revalidated");
        check.ok(!controller.isExpanded("notebook:box/d1"));
        check.ok(!controller.isExpanded("pin:d1"));
        check.equal(controller.model.roots.some(item => item.id === "d1"), false);
        while (!release) { await Promise.resolve(); }
        source.range = original;
        release();
        await refreshed;
        check.ok(!locates.includes("d1") && !locates.includes("child"), "refresh never tries to restore deleted identities");
        check.equal(element.querySelector('[data-node-id="d1"]'), null);
        check.deepEqual(controller.getSelectedItems().map(item => item.id), ["d3"]);
        fixture.destroy();
    }
    {
        const fixture = make(0);
        const {controller, directories} = fixture;
        await controller.toggle("notebook:box", true);
        directories.set("", [file("new")]);
        fixture.revise("two");
        await controller.reload();
        check.equal(controller.model.rowCount, 2, "a previously empty directory still reloads its new total");
        check.equal(controller.findItem("box", "new").id, "new");
        fixture.destroy();
    }
    {
        const fixture = make(10);
        const {controller, element, source, directories, requests} = fixture;
        await controller.toggle("notebook:box", true);
        await frame();
        const before = controller.getMountedElement("notebook:box/d0");
        const unobserved = [];
        const originalUnobserve = controller.observer.unobserve.bind(controller.observer);
        controller.observer.unobserve = row => { unobserved.push(row); originalUnobserve(row); };
        controller.setRoots(controller.model.roots);
        check.equal(controller.getMountedElement("notebook:box/d0"), before, "unchanged rows preserve their DOM");
        controller.handleMessage({cmd: "transactions", data: [{doOperations: [{action: "updateAttrs", id: "d0", rootID: "d0",
            data: {old: {icon: ""}, new: {icon: "1f600"}}}]}]});
        await frame();
        check.equal(controller.findItem("box", "d0").file.icon, "1f600");
        check.notEqual(controller.getMountedElement("notebook:box/d0"), before, "changed metadata refreshes its row");
        check.ok(unobserved.includes(before), "metadata replacement releases the old row from ResizeObserver");
        for (const [title, empty] of [["Updated title", false], ["Literal.sy", false], ["Untitled", true], ["", false]]) {
            controller.handleMessage({cmd: "transactions", data: [{doOperations: [{action: "updateAttrs", id: "d0", rootID: "d0",
                data: {old: {title: "old"}, new: {title, "custom-sy-title-empty": String(empty)}}}]}]});
            controller.render();
            check.equal(controller.findItem("box", "d0").name, title, "attribute titles remain literal display names");
            check.equal(controller.findItem("box", "d0").file.titleEmpty, empty);
            check.equal(controller.getMountedElement("notebook:box/d0").querySelector(".b3-list-item__text").textContent, title);
        }
        await controller.select("notebook:box/d0", {scroll: false});
        const directory = controller.model.directory(controller.model.roots[0]);
        directory.files.delete(0);
        directory.indices.delete("d0");
        controller.handleMessage({cmd: "reloadDocInfo", data: {rootID: "d0", name: "Renamed", subFileCount: 3}});
        controller.handleMessage({cmd: "transactions", data: [{doOperations: [{action: "updateAttrs", id: "d0", rootID: "d0",
            data: {old: {icon: "1f600"}, new: {icon: "1f601"}}}]}]});
        check.equal(controller.getSelectedItems()[0].name, "Renamed");
        check.equal(controller.getSelectedItems()[0].file.icon, "1f601", "evicted selected metadata remains current");
        directories.get("")[0] = {...directories.get("")[0], icon: "1f601", name: "Renamed"};
        await controller.locate("box", "d0");
        check.equal(controller.findItem("box", "d0").file.icon, "1f601");
        check.ok(requests.length < 5, "metadata updates do not reload an unchanged name-sorted directory");
        element.style.setProperty("--b3-ui-list-height", "40px");
        await frame();
        check.equal(controller.getMountedElement("notebook:box/d0").getBoundingClientRect().height, 40);
        const original = source.range;
        source.range = async () => { throw new Error("offline"); };
        await controller.reload();
        await frame();
        check.equal(element.querySelector("[data-tree-loading]").textContent, "Retry");
        const root = controller.getMountedElement("notebook:box");
        check.equal(root.getAttribute("aria-busy"), "false", "a failed range stops the loading arrow");
        check.equal(root.querySelector(".fn__rotate"), null);
        let retry;
        source.range = async request => {
            await new Promise(resolve => { retry = resolve; });
            return original(request);
        };
        element.querySelector("[data-tree-loading]").click();
        controller.render();
        check.equal(root.querySelector(".fn__rotate"), null, "retrying keeps the arrow during the initial wait");
        await new Promise(resolve => setTimeout(resolve, 220));
        await frame();
        check.equal(root.getAttribute("aria-busy"), "true", "retrying animates the parent arrow");
        check.equal(root.querySelector(".fn__rotate use").getAttribute("xlink:href"), "#iconRefresh");
        check.equal(element.querySelector("[data-tree-loading]").textContent, "");
        retry();
        await frame();
        check.equal(root.getAttribute("aria-busy"), "false");
        check.ok(controller.getMountedElement("notebook:box/d0"));
        fixture.destroy();
    }
    {
        const fixture = make(15);
        const {controller, source} = fixture;
        await controller.toggle("notebook:box", true);
        await controller.select("notebook:box/d0", {scroll: false});
        await frame();
        const row = controller.getMountedElement("notebook:box/d5");
        const range = source.range;
        let release;
        source.range = async request => {
            await new Promise(resolve => { release = resolve; });
            return range(request);
        };
        const refresh = controller.reload();
        while (!release) { await new Promise(resolve => setTimeout(resolve, 1)); }
        check.equal(controller.getItemFromElement(row).id, "d5", "visible refresh rows remain actionable");
        check.deepEqual(controller.getSelectedItems().map(item => item.id), ["d0"]);
        row.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        await controller.select(row.dataset.treeKey, {scroll: false});
        source.range = range;
        release();
        await refresh;
        check.deepEqual(controller.getSelectedItems().map(item => item.id), ["d5"], "refresh cannot restore an older selection over a click");
        fixture.destroy();
    }
    {
        const fixture = make(10);
        const {controller, source} = fixture;
        await controller.toggle("notebook:box", true);
        await controller.select("notebook:box/d5", {scroll: false});
        const range = source.range;
        let release;
        source.range = async request => {
            await new Promise(resolve => { release = resolve; });
            return range(request);
        };
        const first = controller.reload();
        while (!release) { await new Promise(resolve => setTimeout(resolve, 1)); }
        const second = controller.reload({notebook: "box", parentID: ""});
        source.range = range;
        release();
        await Promise.all([first, second]);
        check.deepEqual(controller.getSelectedItems().map(item => item.id), ["d5"], "overlapping refreshes retain selection");
        let stale = true;
        source.range = async request => {
            const result = await range(request);
            if (stale) { stale = false; return {...result, stale: true, files: []}; }
            return result;
        };
        await controller.reload();
        await controller.reloadTail;
        check.deepEqual(controller.getSelectedItems().map(item => item.id), ["d5"], "stale ranges during refresh do not deadlock the refresh queue");
        fixture.destroy();
    }
    {
        const fixture = make(70);
        const {controller, source, directories} = fixture;
        const range = source.range;
        source.range = async request => ({...await range(request), effectiveSortMode: 3});
        await controller.toggle("notebook:box", true);
        const directory = controller.model.directory(controller.model.roots[0]);
        check.equal(directory.indices.has("d69"), false);
        directories.get("").unshift(directories.get("").pop());
        fixture.revise("two");
        controller.handleMessage({cmd: "reloadDocInfo", data: {box: "box", rootID: "d69", hMtime: "updated"}});
        await controller.reloadTail;
        check.equal(directory.files.get(0).id, "d69", "offscreen metadata changes invalidate dependent sorting");
        fixture.destroy();
    }
    {
        const fixture = make(50000);
        const {controller, element} = fixture;
        element.style.height = "280.4px";
        element.style.border = "1px solid transparent";
        controller.list.style.paddingTop = "2px";
        for (const height of [28, 40]) {
            element.style.setProperty("--b3-ui-list-height", height + "px");
            const last = await controller.locate("box", "d49999");
            fullyVisible(last, element);
            const viewport = element.getBoundingClientRect();
            check.ok(last.getBoundingClientRect().bottom <= viewport.top + element.clientTop + element.clientHeight,
                "far location uses the actual inner viewport after row-height changes");
            await controller.focusBoundary("first");
            fullyVisible(controller.getMountedElement("notebook:box"), element);
        }
        fixture.destroy();
    }
    {
        const fixture = make(10);
        const {controller, source} = fixture;
        const locate = source.locate;
        const options = [];
        source.locate = (request, flags) => { options.push(flags); return locate(request); };
        await controller.restoreExpanded([{notebookId: "box", id: "missing", kind: "document"}]);
        check.deepEqual(options.at(-1), {ignoreUnavailable: true}, "saved stale targets are probed quietly");
        await controller.locate("box", "missing");
        check.deepEqual(options.at(-1), {ignoreUnavailable: false}, "explicit targets keep error feedback");
        await controller.locate("box", "d0", {select: false});
        check.deepEqual(options.at(-1), {ignoreUnavailable: false}, "a scrolling locate retains user feedback");
        fixture.destroy();
    }
    {
        const fixture = make(200);
        const {controller, element} = fixture;
        await controller.toggle("notebook:box", true);
        element.scrollTop = 600;
        element.dispatchEvent(new Event("scroll"));
        await frame();
        const row = controller.getMountedElement("notebook:box/d25");
        const top = row.getBoundingClientRect().top;
        const scrollTop = element.scrollTop;
        // 焦点行和逐步布局使浏览器在占位区间替换期间执行滚动锚定。
        row.focus({preventScroll: true});
        const insertBefore = controller.list.insertBefore.bind(controller.list);
        controller.list.insertBefore = (...args) => {
            const inserted = insertBefore(...args);
            controller.list.getBoundingClientRect();
            return inserted;
        };
        await controller.select(row.dataset.treeKey, {scroll: false});
        await frame();
        check.equal(element.scrollTop, scrollTop, "selecting a visible row keeps its viewport during layout");
        check.equal(row.getBoundingClientRect().top, top, "spacer replacement keeps the clicked row in place");
        fullyVisible(await controller.locate("box", "d180"), element);
        await controller.focusRelative(1);
        fullyVisible(controller.getMountedElement("notebook:box/d181"), element);
        fixture.destroy();
    }
    {
        const fixture = make(12);
        const {controller, element, source, directories} = fixture;
        directories.get("")[0] = file("d0", "", 2);
        directories.get("")[1] = file("d1", "", 2);
        directories.set("d0", [file("a", "d0"), file("b", "d0")]);
        directories.set("d1", [file("c", "d1"), file("d", "d1")]);
        await controller.toggle("notebook:box", true);
        const range = source.range;
        const releases = new Map();
        source.range = async request => {
            await new Promise(resolve => releases.set(request.parentID, resolve));
            return range(request);
        };
        const arrowState = key => {
            const row = controller.getMountedElement(key);
            const arrow = row.querySelector(".b3-list-item__arrow");
            return {busy: row.getAttribute("aria-busy"), spinning: arrow.classList.contains("fn__rotate"),
                icon: arrow.querySelector("use").getAttribute("xlink:href"),
                expanded: arrow.classList.contains("b3-list-item__arrow--open")};
        };
        const busy = {busy: "true", spinning: true, icon: "#iconRefresh", expanded: false};
        const idle = {busy: "false", spinning: false, icon: "#iconRight", expanded: true};
        const rowCount = controller.model.rowCount;
        const siblingTop = controller.getMountedElement("notebook:box/d2").getBoundingClientRect().top;
        const first = controller.toggle("notebook:box/d0", true);
        const second = controller.toggle("notebook:box/d1", true);
        controller.render();
        check.deepEqual(arrowState("notebook:box/d0"), {...idle, expanded: false, busy: "true"}, "new requests keep the closed arrow");
        check.deepEqual(arrowState("notebook:box/d1"), {...idle, expanded: false, busy: "true"});
        await new Promise(resolve => setTimeout(resolve, 220));
        await frame();
        check.deepEqual(arrowState("notebook:box/d0"), busy, "expanding a slow directory animates its arrow");
        check.deepEqual(arrowState("notebook:box/d1"), busy);
        check.equal(controller.model.rowCount, rowCount, "pending expansions do not project blank children");
        check.equal(controller.getMountedElement("notebook:box/d2").getBoundingClientRect().top, siblingTop);
        check.equal(element.querySelector("[data-tree-loading]"), null);
        check.equal(controller.isExpanded("notebook:box/d0"), false);
        releases.get("d0")();
        await first;
        await frame();
        check.deepEqual(arrowState("notebook:box/d0"), idle, "completed siblings restore their expansion arrow");
        check.deepEqual(arrowState("notebook:box/d1"), busy, "another pending directory keeps animating");
        await controller.toggle("notebook:box/d1", false);
        check.deepEqual(arrowState("notebook:box/d1"), {...idle, expanded: false}, "collapsing stops the visible animation");
        const reopened = controller.toggle("notebook:box/d1", true);
        await frame();
        check.deepEqual(arrowState("notebook:box/d1"), busy, "reopening shares the pending request and restores animation");
        releases.get("d1")();
        await Promise.all([second, reopened]);
        await frame();
        check.deepEqual(arrowState("notebook:box/d1"), idle);
        check.ok(controller.getMountedElement("notebook:box/d1/c"));
        await controller.toggle("notebook:box/d1", false);
        await controller.toggle("notebook:box/d1", true);
        check.deepEqual(arrowState("notebook:box/d1"), idle, "cached expansions keep the ordinary arrow");
        const iconUpdates = [];
        element.querySelectorAll("use").forEach(use => {
            const setAttribute = use.setAttribute.bind(use);
            use.setAttribute = (name, value) => {
                if (name === "xlink:href") { iconUpdates.push(value); }
                setAttribute(name, value);
            };
        });
        const sibling = controller.getMountedElement("notebook:box/d2");
        await controller.select("notebook:box/d2", {scroll: false});
        controller.render();
        controller.render();
        await frame();
        check.equal(controller.getMountedElement("notebook:box/d2"), sibling);
        check.equal(iconUpdates.length, 0, "ordinary clicks and redraws do not invalidate unchanged SVG references");
        fixture.destroy();
    }
    {
        const fixture = make(2);
        const {controller, element, source, directories} = fixture;
        const range = source.range;
        let release;
        let requests = 0;
        source.range = async request => {
            requests++;
            await new Promise(resolve => { release = resolve; });
            return range(request);
        };
        const opening = controller.toggle("notebook:box", true);
        controller.render();
        check.equal(element.querySelector(".fn__rotate"), null, "fast notebook loads do not flash an indicator");
        await frame();
        check.equal(element.querySelector("[data-tree-key]").getAttribute("aria-busy"), "true",
            "notebook expansion displays loading on its own arrow");
        release();
        await opening;
        directories.set("parent", [file("child", "parent")]);
        controller.setRoots(["first", "second"].map(occurrenceKey => ({id: "parent", notebookId: "box",
            kind: "document", name: "Parent", path: "/parent.sy", subFileCount: 1, occurrenceKey})));
        const first = controller.toggle("first", true);
        const second = controller.toggle("second", true);
        await frame();
        check.equal(requests, 2, "duplicate pinned occurrences share one directory request");
        for (const key of ["first", "second"]) {
            check.equal(controller.getMountedElement(key).getAttribute("aria-busy"), "true");
        }
        release();
        await Promise.all([first, second]);
        await frame();
        for (const key of ["first", "second"]) {
            check.equal(controller.getMountedElement(key).getAttribute("aria-busy"), "false");
            check.ok(controller.getMountedElement(key + "/child"));
        }
        fixture.destroy();
    }
    {
        const fixture = make(64);
        const {controller, source} = fixture;
        await controller.toggle("notebook:box", true);
        const range = source.range;
        let release;
        source.range = async request => {
            if (request.offset === 32) { await new Promise(resolve => { release = resolve; }); }
            return range(request);
        };
        const oldPage = controller.itemAtDirectoryIndex("notebook:box", 40);
        await frame();
        check.equal(controller.getMountedElement("notebook:box").getAttribute("aria-busy"), "true");
        fixture.revise("two");
        await controller.locate("box", "d0");
        await frame();
        check.equal(controller.getMountedElement("notebook:box").getAttribute("aria-busy"), "false",
            "obsolete pages cannot keep a revised directory's loading arrow spinning");
        release();
        await oldPage;
        fixture.destroy();
    }
    {
        const fixture = make(3);
        const {controller, element, source} = fixture;
        const range = source.range;
        let release;
        source.range = async request => {
            await new Promise(resolve => { release = resolve; });
            return range(request);
        };
        const flashed = [];
        const observer = new MutationObserver(records => {
            records.forEach(record => {
                if (record.target.classList?.contains("fn__rotate")) { flashed.push(record.target); }
            });
        });
        observer.observe(element, {subtree: true, attributes: true, attributeFilter: ["class"]});
        const opening = controller.toggle("notebook:box", true);
        controller.render();
        release();
        await opening;
        await new Promise(resolve => setTimeout(resolve, 250));
        await frame();
        check.equal(element.querySelector(".fn__rotate"), null, "a completed fast request never starts a delayed animation");
        check.equal(flashed.length, 0);
        check.ok(controller.getMountedElement("notebook:box/d0"));
        observer.disconnect();
        fixture.destroy();
    }
    {
        const fixture = make(2);
        const {controller, element, source} = fixture;
        const range = source.range;
        let release;
        source.range = async request => {
            await new Promise(resolve => { release = resolve; });
            return range(request);
        };
        const opening = controller.toggle("notebook:box");
        await controller.toggle("notebook:box");
        release();
        await opening;
        await frame();
        check.equal(controller.isExpanded("notebook:box"), false, "clicking a pending arrow again cancels its expansion");
        check.equal(controller.model.rowCount, 1);
        check.equal(element.querySelector("[data-tree-loading]"), null);
        controller.model.invalidate("box");
        const restoring = controller.restoreExpanded([{notebookId: "box", id: "box", kind: "notebook"}]);
        element.dispatchEvent(new WheelEvent("wheel", {bubbles: true}));
        release();
        await restoring;
        check.equal(controller.isExpanded("notebook:box"), false, "new input cancels an unfinished saved expansion");
        // 清空缓存后验证首次请求失败仍保持折叠，并能从原箭头重试。
        const directory = controller.model.directory(controller.model.roots[0]);
        controller.model.invalidate("box");
        source.range = async () => { throw new Error("offline"); };
        await controller.toggle("notebook:box", true);
        await frame();
        const root = controller.getMountedElement("notebook:box");
        check.equal(root.getAttribute("aria-expanded"), "false");
        check.equal(root.querySelector(".fn__rotate"), null);
        check.equal(root.querySelector("use").getAttribute("xlink:href"), "#iconRefresh");
        check.equal(root.querySelector(".b3-list-item__arrow").getAttribute("aria-label"), "Retry");
        check.equal(directory.files.size, 0);
        source.range = range;
        await controller.toggle("notebook:box");
        check.equal(root.getAttribute("aria-expanded"), "true");
        check.ok(controller.getMountedElement("notebook:box/d0"));
        fixture.destroy();
    }
    {
        const fixture = make(2);
        const {controller, source} = fixture;
        const range = source.range;
        let release;
        let requests = 0;
        source.range = async request => {
            if (++requests === 1) { await new Promise(resolve => { release = resolve; }); }
            return range(request);
        };
        const opening = controller.toggle("notebook:box", true);
        await controller.reload({notebook: "box"});
        release();
        await opening;
        check.equal(requests, 2, "a pending expansion reloads its first page after a concurrent refresh");
        check.equal(controller.isExpanded("notebook:box"), true);
        check.ok(controller.getMountedElement("notebook:box/d0"));
        fixture.destroy();
    }
    {
        const fixture = make(3000);
        const {controller, source, directories} = fixture;
        directories.get("")[0] = file("d0", "", 1);
        directories.set("d0", [file("child", "d0")]);
        await controller.toggle("notebook:box", true);
        const range = source.range;
        let release;
        source.range = async request => {
            if (request.parentID === "d0") { await new Promise(resolve => { release = resolve; }); }
            return range(request);
        };
        const opening = controller.toggle("notebook:box/d0", true);
        for (let page = 1; page <= 70; page++) {
            await controller.itemAtDirectoryIndex("notebook:box", page * 32);
        }
        check.ok(controller.model.getItem("notebook:box/d0"), "page eviction retains pending parent metadata");
        release();
        await opening;
        check.equal(controller.isExpanded("notebook:box/d0"), true);
        check.ok(controller.getMountedElement("notebook:box/d0/child"));
        fixture.destroy();
    }
    {
        const fixture = make(200);
        const {controller, element, directories} = fixture;
        directories.get("")[25] = file("d25", "", 2);
        directories.set("d25", [file("a", "d25"), file("b", "d25")]);
        await controller.toggle("notebook:box", true);
        element.scrollTop = 600;
        element.dispatchEvent(new Event("scroll"));
        await frame();
        check.ok(controller.list.firstElementChild.dataset.treeSpacer, "the scrolled viewport has a leading spacer");
        const row = controller.getMountedElement("notebook:box/d25");
        const rows = new Set(element.querySelectorAll("[data-tree-key]"));
        const removed = [];
        const observer = new MutationObserver(records => records.forEach(record => {
            record.removedNodes.forEach(node => { if (rows.has(node)) { removed.push(node); } });
        }));
        observer.observe(controller.list, {childList: true});
        element.addEventListener("click", event => {
            const target = event.target.closest("[data-tree-key]");
            if (target) { void controller.select(target.dataset.treeKey, {scroll: false}); }
        });
        const rect = row.getBoundingClientRect();
        await require("electron").ipcRenderer.invoke("file-tree-click", {
            x: Math.ceil(rect.left + 50), y: Math.ceil(rect.top + rect.height / 2),
        });
        await frame();
        check.equal(controller.getSelectedItems()[0]?.id, "d25", "native input reaches the visible row");
        check.equal(removed.length, 0, "clicking a scrolled tree never detaches unchanged visible rows");
        check.equal(document.activeElement, row, "the clicked row keeps native focus during redraw");
        const top = row.getBoundingClientRect().top;
        await controller.toggle(row.dataset.treeKey, true);
        await frame();
        check.ok(!removed.includes(row), "expansion inserts children without detaching the clicked parent");
        check.equal(document.activeElement, row);
        check.equal(row.getBoundingClientRect().top, top);
        await controller.toggle(row.dataset.treeKey, false);
        await frame();
        check.ok(!removed.includes(row), "collapse preserves the parent row too");
        check.equal(document.activeElement, row);
        observer.disconnect();
        fixture.destroy();
    }
    return "File tree selection cases passed";
};
