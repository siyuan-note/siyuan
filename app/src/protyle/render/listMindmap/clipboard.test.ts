import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import test from "node:test";
import {promisify} from "node:util";
import * as ts from "typescript";

const browserCases = async (source: string, css: string) => {
    const check = require("node:assert/strict");
    const constants = {CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap",
        CUSTOM_SY_LIST_MINDMAP_DATA: "custom-sy-list-mindmap-data", TIMEOUT_DBLCLICK: 200};
    const messages: string[] = [];
    let write: () => Promise<{status: string}> = async () => ({status: "rich"});
    let read: () => Promise<IClipboardData> = async () => ({});
    const api = new Function("Constants", "mathRender", "canEdit", "showMessage", "writeClipboardData",
        "readClipboard", "prepareExternalClipboardHTML", "removeZWJ", "getTabTask", "destroyTabsRender", "tabsRender",
        "genListItemElement", "disposeCustomBlocksInElement", "processRender", "highlightRender", "avRender", "blockRender",
        source + "; return {readListMindmap, retagMindmapBranch, writeListMindmapMetadata, copyMindmapBranches, " +
        "readMindmapClipboard, pasteMindmapBranches, canCutMindmapBranches, removeMindmapBranches, " +
        "ListMindmapView, ClipboardController, assignListMindmapBranchColors, resolveListMindmapColors};")(
        constants, async () => {}, (owner: {disabled?: boolean}) => !owner.disabled,
        (message: string) => messages.push(message), () => write(), () => read(),
        (html: string) => html, (html: string) => html, (): null => null, (): void => {}, (): void => {},
        () => {
            const template = document.createElement("template");
            template.innerHTML = Lute.New().Md2BlockDOM("- \n");
            return template.content.querySelector('[data-type="NodeListItem"]');
        }, (): void => {}, (): void => {}, (): void => {}, (): void => {}, (): void => {});
    const lute = Lute.New();
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    window.siyuan = {languages: new Proxy({}, {get: (_, key) => String(key)}),
        config: {editor: {}}, storage: {}} as unknown as typeof window.siyuan;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const makeList = (native = true) => {
        const holder = document.createElement("div");
        holder.innerHTML = lute.Md2BlockDOM("- Root\n  - Alpha **bold**\n    - Child\n  - Beta\n  - Gamma\n");
        const list = holder.firstElementChild as HTMLElement;
        if (native) {
            api.retagMindmapBranch(list, true);
        } else {
            list.setAttribute(constants.CUSTOM_SY_LIST_MINDMAP, "1");
        }
        return list;
    };
    for (const {native, nodeStyle} of [true, false].flatMap(native =>
        ["layered", "branch"].map(nodeStyle => ({native, nodeStyle})))) {
        const list = makeList(native);
        const model = api.readListMindmap(list);
        const [a, b, c] = model.root.children;
        model.metadata.nodes[a.id] = {backgroundColor: "red"};
        model.metadata.appearance = {version: 1, palette: ["#2563eb", "#15803d"], rootColor: "#1e293b", nodeStyle, backgroundColor: "#1e1e1e"};
        api.assignListMindmapBranchColors(model);
        model.metadata.relations = [
            {id: Lute.NewNodeID(), from: a.id, to: b.id, label: "Inside"},
            {id: Lute.NewNodeID(), from: a.id, to: c.id, label: "Outside"},
        ];
        model.metadata.summaries = [{id: Lute.NewNodeID(), parentId: model.root.id,
            nodeIds: [a.id, b.id], label: "Group"}];
        api.writeListMindmapMetadata(list, model.metadata);
        const before = list.outerHTML;
        const copied = api.copyMindmapBranches(list, [b.id, a.children[0].id, a.id]);
        check.equal(list.outerHTML, before);
        const payload = api.readMindmapClipboard(copied);
        const selected = api.readListMindmap(payload);
        check.deepEqual(selected.metadata.appearance, model.metadata.appearance);
        check.deepEqual(selected.root.children.map((node: {id: string}) => node.id), [a.id, b.id],
            "copy follows source order and excludes duplicate descendants");
        check.equal(selected.nodes.size, 4);
        check.equal(selected.metadata.relations.length, 1);
        check.equal(selected.metadata.summaries[0].parentId, payload.dataset.nodeId);
        for (const {placement, destinationStyle} of ["child", "after"].flatMap(placement =>
            ["layered", "branch"].map(destinationStyle => ({placement, destinationStyle})))) {
            const destination = list.cloneNode(true) as HTMLElement;
            const destinationModel = api.readListMindmap(destination);
            destinationModel.metadata.appearance = {version: 1, palette: ["#166534", "#047857"], rootColor: "#14532d", nodeStyle: destinationStyle, backgroundColor: "#ffffff"};
            api.writeListMindmapMetadata(destination, destinationModel.metadata);
            const pasted = api.pasteMindmapBranches(destination, payload, c.id, placement, lute);
            check.ok(pasted);
            const next = api.readListMindmap(pasted.list);
            const oldIDs = new Set([list.dataset.nodeId, ...Array.from(list.querySelectorAll<HTMLElement>("[data-node-id]"))
                .map(node => node.dataset.nodeId)]);
            const newIDs = Array.from((pasted.list as HTMLElement).querySelectorAll<HTMLElement>("[data-node-id]"))
                .map(node => node.dataset.nodeId).filter(id => !oldIDs.has(id));
            check.equal(new Set(newIDs).size, newIDs.length);
            check.equal(next.nodes.get(pasted.ids[0]).children.length, 1);
            check.match(next.nodes.get(pasted.ids[0]).element.outerHTML, /bold/);
            check.equal(next.metadata.nodes[pasted.ids[0]].backgroundColor, "red");
            check.equal(next.metadata.nodes[pasted.ids[0]].branchColor, model.metadata.nodes[a.id].branchColor,
                "copied branch color slots follow remapped node IDs");
            check.deepEqual(next.metadata.appearance, destinationModel.metadata.appearance,
                "pasting branches retains the destination appearance");
            check.equal(next.metadata.relations.length, 3);
            const relation = next.metadata.relations[2];
            check.deepEqual([relation.from, relation.to], pasted.ids);
            check.notEqual(relation.id, selected.metadata.relations[0].id);
            const summary = next.metadata.summaries[1];
            check.deepEqual(summary.nodeIds, pasted.ids);
            check.equal(summary.parentId, placement === "child" ? c.id : model.root.id);
            check.equal(api.readListMindmap(api.readMindmapClipboard(lute.SpinBlockDOM(pasted.list.outerHTML)))
                .nodes.size, next.nodes.size, "Lute persistence keeps the complete pasted hierarchy");
        }
        const removed = api.removeMindmapBranches(list, [a.id, a.children[0].id, b.id]);
        check.ok(removed);
        check.deepEqual(api.readListMindmap(removed).root.children.map((node: {id: string}) => node.id), [c.id]);
        check.equal(list.outerHTML, before, "preparing cut/delete leaves the source intact");
        check.equal(api.canCutMindmapBranches(model, [model.root.id]), false);
        check.equal(api.removeMindmapBranches(list, [model.root.id]), false);
        check.equal(api.readMindmapClipboard('<div data-type="NodeParagraph">ordinary</div>'), undefined);
        check.throws(() => api.readMindmapClipboard(copied.replace('data-node-id="' + a.id, 'data-node-id="' + b.id)));
    }
    const virtual = document.createElement("div");
    virtual.innerHTML = lute.Md2BlockDOM("- A\n- B\n");
    const virtualList = virtual.firstElementChild as HTMLElement;
    api.retagMindmapBranch(virtualList, true);
    const virtualModel = api.readListMindmap(virtualList);
    virtualModel.metadata.rootTitle = "Named center";
    api.writeListMindmapMetadata(virtualList, virtualModel.metadata);
    check.equal(api.canCutMindmapBranches(virtualModel, virtualModel.root.children.map((node: {id: string}) => node.id)), false);
    const destination = makeList();
    const rootID = api.readListMindmap(destination).root.id;
    const virtualCopy = api.readMindmapClipboard(api.copyMindmapBranches(virtualList, [virtualModel.root.id]));
    const virtualPaste = api.pasteMindmapBranches(destination, virtualCopy, rootID, "child", lute);
    const pastedCenter = api.readListMindmap(virtualPaste.list).nodes.get(virtualPaste.ids[0]);
    check.match(pastedCenter.element.textContent, /Named center/);
    check.equal(pastedCenter.children.length, 2, "a named virtual center is preserved as a real parent");

    const list = makeList();
    document.body.append(list);
    const model = api.readListMindmap(list);
    const [a, b] = model.root.children;
    model.metadata.appearance = {version: 1, palette: ["#2563eb", "#15803d"], rootColor: "#1e293b", backgroundColor: "#1e1e1e"};
    api.assignListMindmapBranchColors(model);
    model.metadata.nodes[a.id].backgroundColor = "red";
    model.metadata.nodes[a.id].textColor = "white";
    api.writeListMindmapMetadata(list, model.metadata);
    const host = document.createElement("div");
    host.className = "mindmap-view";
    host.style.cssText = "position:relative;width:850px;height:500px";
    document.body.append(host);
    const copied: {ids: string[], cut: boolean}[] = [];
    const pasted: {id: string, kind: string}[] = [];
    const menus: {anchor: HTMLElement, ids: string[]}[] = [];
    const styleChanges: {ids: string[], patch: Record<string, string>}[] = [];
    // Synthetic events have no native pointer capture; geometry and handlers still run in Chromium.
    const capture = HTMLElement.prototype.setPointerCapture;
    const hasCapture = HTMLElement.prototype.hasPointerCapture;
    HTMLElement.prototype.setPointerCapture = () => {};
    HTMLElement.prototype.hasPointerCapture = () => false;
    const view = new api.ListMindmapView({host, model, onExit() {},
        onCopy: (ids: string[], cut: boolean) => copied.push({ids, cut}),
        onPaste: (id: string, kind: string) => pasted.push({id, kind}),
        onClipboardMenu: (anchor: HTMLElement, ids: string[]) => menus.push({anchor, ids}), onDeleteNodes() {},
        nodeColors: () => [{label: "Batch orange", color: "#000000", backgroundColor: "#fed7aa"}],
        colors: () => [{label: "Branch green", value: "#15803d"}],
        onNodesStyle: (ids: string[], patch: Record<string, string>) => {
            styleChanges.push({ids, patch});
            ids.forEach(id => model.metadata.nodes[id] = {...model.metadata.nodes[id], ...patch});
            api.writeListMindmapMetadata(list, model.metadata);
            view.update(model);
        }});
    const wait = () => new Promise(resolve => setTimeout(resolve, 40));
    await wait();
    check.equal(view.viewport.style.backgroundColor, "rgb(30, 30, 30)");
    check.equal(view.nodeElements.get(a.id).style.backgroundColor, "red", "manual colors survive applying a theme");
    check.equal(view.nodeElements.get(b.id).style.backgroundColor, "rgb(21, 128, 61)");
    check.equal(view.nodeElements.get(a.children[0].id).style.backgroundColor, "rgb(37, 99, 235)",
        "descendants follow their branch theme independently of a parent's manual override");
    const pointer = (id: string, modifiers: PointerEventInit = {}) => {
        const node = view.nodeElements.get(id) as HTMLElement;
        const rect = node.getBoundingClientRect();
        node.dispatchEvent(new PointerEvent("pointerdown", {pointerId: 1, pointerType: "mouse", button: 0,
            bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2, ...modifiers}));
        view.viewport.dispatchEvent(new PointerEvent("pointerup", {pointerId: 1, bubbles: true}));
    };
    const checkNodeMenu = async () => {
        for (const width of [240, 320, 850]) {
            host.style.width = `${width}px`;
            view.renderInspector();
            await wait();
            const inspector = host.querySelector<HTMLElement>(".mindmap-view__inspector");
            check.deepEqual(Array.from(inspector.children).map(item => item.getAttribute("aria-label")),
                ["connect", "listMindmapSummary", "color", "width", "copy", "paste", "delete", "more"],
                "the compact bar keeps eight actions in visual and keyboard order");
            const more = inspector.querySelector<HTMLButtonElement>('[aria-label="more"]');
            check.equal(inspector.lastElementChild, more, "More follows the node actions in keyboard order");
            const right = more.getBoundingClientRect().right;
            for (const control of Array.from(inspector.children) as HTMLElement[]) {
                check.ok(control.getBoundingClientRect().right <= right + 1,
                    `More stays rightmost in single and multiple node menus, width=${width}`);
            }
            more.click();
            check.equal(menus.at(-1).anchor, more);
            check.deepEqual(menus.at(-1).ids, view.getSelectedIds(), "More retains the current node selection");
        }
    };
    pointer(a.id);
    await checkNodeMenu();
    const action = (key: string) => host.querySelector<HTMLButtonElement>(`.mindmap-view__inspector > [aria-label="${key}"]`);
    for (const key of ["copy", "paste"]) {
        check.ok(action(key), `${key} is directly available on the bottom bar`);
        check.equal(action(key).disabled, false);
        action(key).dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "touch", pointerId: 12}));
        check.deepEqual(view.getSelectedIds(), [a.id], "touching a clipboard button keeps the node selection");
        action(key).click();
    }
    check.equal(action("cut"), null, "cut remains available through More and clipboard shortcuts");
    check.deepEqual(copied.map(item => item.cut), [false]);
    check.deepEqual(pasted, [{id: a.id, kind: "child"}]);
    copied.length = 0;
    pasted.length = 0;
    pointer(b.id, {ctrlKey: true});
    await checkNodeMenu();
    check.equal(action("paste").disabled, true, "multiple targets cannot receive a paste");
    view.focusNode(model.root.id);
    check.equal(action("delete").disabled, true, "the map root cannot be deleted");
    pointer(a.id);
    pointer(b.id, {ctrlKey: true});
    check.deepEqual(new Set(view.getSelectedIds()), new Set([a.id, b.id]));
    host.querySelector<HTMLButtonElement>('.mindmap-view__inspector [aria-label="color"]').click();
    host.querySelector<HTMLButtonElement>('[aria-label="Batch orange"]').click();
    check.equal(styleChanges.length, 1, "batch colors use one callback for the complete selection");
    check.deepEqual(new Set(styleChanges[0].ids), new Set([a.id, b.id]));
    check.equal(view.nodeElements.get(a.id).style.backgroundColor, "rgb(254, 215, 170)");
    check.equal(view.nodeElements.get(b.id).style.backgroundColor, "rgb(254, 215, 170)");
    host.querySelector<HTMLButtonElement>('[aria-label="Branch green"]').click();
    check.equal(styleChanges.length, 2);
    check.equal(model.metadata.nodes[a.id].lineColor, "#15803d");
    check.equal(model.metadata.nodes[b.id].lineColor, "#15803d");
    const nodePalette = host.querySelector<HTMLElement>('.mindmap-view__palette[aria-label="listMindmapNodeColor"]');
    check.ok(nodePalette, "the node color palette uses its dedicated accessible label");
    nodePalette.querySelector<HTMLButtonElement>('[aria-label="default"]').click();
    check.equal(view.nodeElements.get(a.id).style.backgroundColor, "rgb(37, 99, 235)",
        "resetting manual node colors restores the branch theme");
    const persisted = api.readMindmapClipboard(lute.SpinBlockDOM(list.outerHTML));
    for (const printLayout of [false, true]) {
        const previewHost = document.createElement("div");
        previewHost.className = "mindmap-view";
        previewHost.style.cssText = "width:760px;height:460px";
        document.body.append(previewHost);
        const preview = new api.ListMindmapView({host: previewHost, model: api.readListMindmap(persisted),
            readOnly: true, printLayout, onExit() {}});
        await wait();
        check.equal(preview.viewport.style.backgroundColor, "rgb(30, 30, 30)");
        check.equal(preview.nodeElements.get(a.id).style.backgroundColor, "rgb(37, 99, 235)",
            "read-only HTML and PDF layout render the saved palette");
        check.equal(preview.nodeElements.get(model.root.id).style.backgroundColor, "rgb(30, 41, 59)",
            "read-only HTML and PDF layout retain the independent root color");
        preview.destroy();
        previewHost.remove();
    }
    check.equal(host.querySelectorAll('[aria-selected="true"]').length, 2);
    host.dispatchEvent(new ClipboardEvent("copy", {bubbles: true, cancelable: true, clipboardData: new DataTransfer()}));
    check.deepEqual(new Set(copied[0].ids), new Set([a.id, b.id]));
    for (const key of ["c", "x"]) {
        const event = new KeyboardEvent("keydown", {key, ctrlKey: true, bubbles: true, cancelable: true});
        host.dispatchEvent(event);
        check.equal(event.defaultPrevented, true, "canvas shortcuts do not depend on a DOM text selection");
    }
    check.deepEqual(copied.slice(1).map(item => item.cut), [false, true]);
    pointer(a.id, {metaKey: true});
    check.deepEqual(view.getSelectedIds(), [b.id], "Command-click toggles membership too");
    host.querySelector<HTMLButtonElement>('[aria-label="multiSelect"]').click();
    pointer(a.id, {pointerType: "touch", isPrimary: true});
    check.equal(view.getSelectedIds().length, 2, "touch multi-selection shares the same selection");
    host.querySelector<HTMLButtonElement>('[aria-label="multiSelect"]').click();
    view.focusNode(a.id);
    const beforePan = [view.offsetX, view.offsetY];
    const viewport = view.viewport.getBoundingClientRect();
    const rects = [a.id, b.id].map(id => view.nodeElements.get(id).getBoundingClientRect());
    const left = Math.min(...rects.map(rect => rect.left)) - 4;
    const top = Math.min(...rects.map(rect => rect.top)) - 4;
    const right = Math.max(...rects.map(rect => rect.right)) + 4;
    const bottom = Math.max(...rects.map(rect => rect.bottom)) + 4;
    view.findLine = (): undefined => undefined;
    view.viewport.dispatchEvent(new PointerEvent("pointerdown", {pointerId: 3, pointerType: "mouse",
        button: 0, bubbles: true, clientX: left, clientY: top}));
    view.viewport.dispatchEvent(new PointerEvent("pointermove", {pointerId: 3, pointerType: "mouse",
        bubbles: true, clientX: right, clientY: bottom}));
    view.viewport.dispatchEvent(new PointerEvent("pointerup", {pointerId: 3, pointerType: "mouse",
        bubbles: true, clientX: right, clientY: bottom}));
    check.ok(view.getSelectedIds().includes(a.id) && view.getSelectedIds().includes(b.id));
    check.deepEqual([view.offsetX, view.offsetY], beforePan, "marquee selection does not pan");
    check.ok(viewport.width > 0);
    view.focusNode(a.id);
    const data = new DataTransfer();
    data.setData("text/plain", "Text");
    host.dispatchEvent(new ClipboardEvent("paste", {bubbles: true, cancelable: true, clipboardData: data}));
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "V", ctrlKey: true, shiftKey: true,
        bubbles: true, cancelable: true}));
    check.deepEqual(pasted.map(item => item.kind), ["child", "sibling"]);
    view.setEditing(a.id);
    const count = pasted.length;
    host.dispatchEvent(new ClipboardEvent("paste", {bubbles: true, cancelable: true, clipboardData: data}));
    check.equal(pasted.length, count, "editing delegates text and image paste to the fragment editor");
    view.setEditing(undefined);
    view.setReadOnly(true);
    host.dispatchEvent(new ClipboardEvent("cut", {bubbles: true, cancelable: true, clipboardData: data}));
    check.equal(copied.length, 3, "read-only maps cannot cut nodes");
    view.destroy();
    HTMLElement.prototype.setPointerCapture = capture;
    HTMLElement.prototype.hasPointerCapture = hasCapture;
    host.remove();

    const controller = new api.ClipboardController();
    let transactionCount = 0;
    let selected = a.id;
    Object.assign(controller, {
        list, host: document.createElement("div"), model, owner: {lute, block: {rootID: "document"}, disabled: false},
        view: {getSelectedId: () => selected, getSelectedIds: () => [selected], focusNode: (id: string) => selected = id,
            getContentHost: () => controller.host},
        change: async (action: () => boolean | void) => {
            const before = list.outerHTML;
            if (action() === false) {
                return false;
            }
            if (list.outerHTML !== before) {
                transactionCount++;
            }
            controller.model = api.readListMindmap(list);
            return true;
        },
    });
    controller.host.className = "mindmap-view";
    list.append(controller.host);
    const before = list.outerHTML;
    write = async () => ({status: "failed"});
    await controller.copyNodes([a.id], true);
    check.equal(list.outerHTML, before);
    check.equal(transactionCount, 0);
    write = async () => ({status: "plain"});
    await controller.copyNodes([a.id], true);
    check.equal(list.outerHTML, before, "plain-only clipboard support never destroys a rich branch");
    let finishWrite: (value: {status: string}) => void;
    write = () => new Promise(resolve => finishWrite = resolve);
    const pending = controller.copyNodes([a.id], true);
    list.setAttribute("custom-concurrent", "change");
    finishWrite({status: "rich"});
    await pending;
    check.ok(api.readListMindmap(list).nodes.has(a.id), "a concurrent source change cancels deletion");
    write = async () => ({status: "rich"});
    await controller.copyNodes([a.id], true);
    check.equal(api.readListMindmap(list).nodes.has(a.id), false);
    check.equal(transactionCount, 1, "cut deletes the subtree in one transaction");
    selected = b.id;
    const clipboard = api.copyMindmapBranches(list, [b.id]);
    const fullscreenMarker = document.createComment("mindmap-view");
    controller.host.replaceWith(fullscreenMarker);
    document.body.append(controller.host);
    await controller.pasteNodes(b.id, "sibling", {siyuanHTML: clipboard});
    check.equal(transactionCount, 2, "hierarchy paste uses one transaction");
    check.notEqual(selected, b.id);
    check.equal(controller.host.parentElement, document.body, "full-screen paste preserves the canvas host");
    check.equal(fullscreenMarker.parentElement, list, "the full-screen return marker survives the transaction");
    let finishRead: (data: IClipboardData) => void;
    read = () => new Promise(resolve => finishRead = resolve);
    const pendingPaste = controller.pasteNodes(selected, "child");
    selected = rootID;
    finishRead({siyuanHTML: clipboard});
    await pendingPaste;
    check.equal(transactionCount, 2, "late clipboard reads cannot paste into a changed selection");
    const forwarded: {id: string, data: IClipboardData}[] = [];
    controller.edit = async (id: string, _host: HTMLElement, _text: string, data: IClipboardData) => {
        check.equal(_host, controller.host);
        check.equal(_text, undefined);
        check.equal(controller.model.nodes.get(id).parentId, b.id);
        forwarded.push({id, data});
    };
    for (const data of [{textPlain: "external text"}, {textHTML: "<p><strong>rich</strong></p>"},
        {siyuanHTML: lute.Md2BlockDOM("Internal **block**")},
        {files: [new File(["image"], "image.png", {type: "image/png"})]}]) {
        selected = b.id;
        await controller.pasteNodes(b.id, "child", data);
        check.equal(forwarded.at(-1)?.data, data, "external content reaches the new node's standard paste pipeline");
    }
    check.equal(forwarded.length, 4);
    check.equal(messages.length, 2);
    controller.host.remove();
    list.remove();
    return "mindmap-node-clipboard-ok";
};

test("mind map selection and clipboard preserve branches, metadata, identities and failed-cut safety", {timeout: 45000}, async () => {
    const compile = (file: string) => ts.transpileModule(readFileSync(path.resolve(__dirname, file), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
        compilerOptions: {target: ts.ScriptTarget.ES2021},
    }).outputText;
    const sourceFile = ts.createSourceFile("index.ts", readFileSync(path.join(__dirname, "index.ts"), "utf8"),
        ts.ScriptTarget.Latest, true);
    const controller = sourceFile.statements.find(ts.isClassDeclaration);
    const methods = controller.members.filter(member =>
        ["copyNodes", "removeNodes", "replaceClipboardSource", "replaceSourceChildren", "pasteNodes", "add"]
            .includes(member.name?.getText(sourceFile)));
    const source = ["../../wysiwyg/listContext.ts", "summary.ts", "appearance.ts", "model.ts", "../../util/tabsCopy.ts", "clipboard.ts",
        "fold.ts", "routing.ts", "pan.ts", "connectors.ts", "../av/richTextValue.ts", "view.ts",
        "../../util/blockDOMClipboard.ts", "../../util/clipboardData.ts"].map(compile).join("\n") +
        ts.transpileModule(`class ClipboardController {${methods.map(method => method.getText(sourceFile)).join("\n")}}`,
            {compilerOptions: {target: ts.ScriptTarget.ES2021}}).outputText;
    const css = ["business/_block.scss", "business/_color.scss", "component/_svg.scss", "component/_slider.scss",
        "component/_text-field.scss", "protyle/_mindmap-view.scss"].map(file =>
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss", file)).css).join("\n");
    const dir = mkdtempSync(path.join(tmpdir(), "siyuan-mindmap-clipboard-"));
    const script = path.join(dir, "run.cjs");
    const browser = ts.transpileModule(`(${browserCases.toString()})`, {compilerOptions: {target: ts.ScriptTarget.ES2021}})
        .outputText.trim().replace(/^"use strict";\s*/, "").replace(/;$/, "");
    writeFileSync(script, `
const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(dir, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
 const win = new BrowserWindow({show:false, webPreferences:{nodeIntegration:true,contextIsolation:false}});
 win.webContents.on("console-message", event => console.error(event.message));
 try {
  await win.loadURL("data:text/html,<html><body></body></html>");
  await win.webContents.executeJavaScript(require("fs").readFileSync(${JSON.stringify(path.resolve("stage/protyle/js/lute/lute.min.js"))}, "utf8"));
  console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browser})(${JSON.stringify(source)}, ${JSON.stringify(css)})`)}));
  win.destroy(); app.exit(0);
 } catch (error) {console.error(error); win.destroy(); app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as string, [script],
            {env, windowsHide: true, timeout: 40000});
        assert.match(result.stdout, /mindmap-node-clipboard-ok/);
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
});
