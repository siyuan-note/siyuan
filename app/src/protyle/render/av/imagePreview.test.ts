import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {DOMFixture, DOMElement} from "./testDOM";
import type {IAVPanelAction, IAVPanelContext} from "./panels/types";
import * as host from "./host";

const compile = (file: string) => transpileModule(readFileSync(join(__dirname, file), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;
const sources = {action: compile("action.ts"), asset: compile("asset.ts"), panel: compile("panels/asset.ts")};

for (const {mobile, related} of [false, true].flatMap(mobile =>
    [false, true].map(related => ({mobile, related})))) {
    const scenario = related ? "stay within the related host" : "preserve their source group";
    test(`database image preview entries ${scenario} (${mobile ? "mobile" : "desktop"})`, () => {
        const document = Object.assign(new DOMFixture(), {
            querySelector: (selector: string): null => {
                assert.equal(selector, ".av__panel > .b3-menu");
                return null;
            },
        });
        const block = document.createElement("div");
        block.innerHTML = `<span data-type="av-search"> Alpha </span>
<div class="av__body" data-group-id="first"><div class="av__cell"><img class="av__cellassetimg" src="assets/first.png"></div></div>
<div class="av__body" data-group-id="second"><div class="av__cell"><img class="av__cellassetimg" src="assets/second.png"></div></div>`;
        block.setAttribute("data-av-id", "av");
        block.setAttribute("data-type", "NodeAttributeView");
        if (!related) block.setAttribute("data-node-id", "carrier");
        block.setAttribute("custom-sy-av-view", "view");
        document.body.append(block);
        const relationHost: host.IAVRelationHost = {relationContext: {
            sourceAvID: "source", sourceItemID: "entry", relationKeyID: "relation",
        }, sourceBlockID: "source-carrier", viewID: "view", temporaryFilters: [], active: true,
        available: true, readonly: () => false, rendered() {}, failed() {}};
        if (related) {
            block.dataset.avHost = "related-panel";
            host.setAVRelationHost(block as unknown as HTMLElement, relationHost);
        }
        const previews: unknown[][] = [];
        const scopedPreviews: unknown[][] = [];
        const popupPreviews: Array<() => void> = [];
        const items = new Map<string, {click: () => void}>();
        class Menu {
            readonly element = document.createElement("div");
            addItem(item: {id: string, click: () => void}) {
                items.set(item.id, item);
                if (item.id === "link") {
                    const input = document.createElement("textarea");
                    Object.assign(input, {select() {}});
                    this.element.append(input);
                }
            }
            addSeparator() {}
            fullscreen() {}
            open() {}
        }
        class MenuItem {
            readonly element = document.createElement("div");
        }
        const dependencies = new Proxy({
            ...host,
            Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view"}, Menu, MenuItem,
            isMobile: () => mobile,
            hasClosestByClassName: (element: DOMElement, name: string) => element.closest("." + name),
            getAVTemplateInteractiveElement: (): null => null,
            isOnlyMeta: () => false,
            removeCompressURL: (src: string) => src,
            getAVBatchEditMode: () => "replace",
            genCellValueByElement: (type: TAVCol, cell: DOMElement): IAVCellValue => ({type,
                mAsset: [{type: "image", name: "", content: cell.querySelector("img").getAttribute("src")}],
            }),
            isBrowserRenderableImagePath: () => true,
            openMenu: (): unknown[] => [],
            previewAttrViewImages: (...args: unknown[]) => previews.push(args),
            previewImages: (images: string[], current: string) => scopedPreviews.push([Array.from(images), current]),
        }, {get: (target, key) => key in target ? Reflect.get(target, key) : (): undefined => undefined});
        const load = <T>(code: string, modules: Record<string, unknown> = {}): T => {
            const exports = {};
            runInNewContext(code, {exports, require: (id: string) => modules[id] || dependencies, document,
                window: {siyuan: {languages: {}, menus: {menu: {append() {}}}}}});
            return exports as T;
        };
        const action = load<typeof import("./action")>(sources.action);
        const asset = load<typeof import("./asset")>(sources.asset);
        const panel = load<typeof import("./panels/asset")>(sources.panel, {"../asset": asset});
        for (const cell of block.querySelectorAll(".av__cell")) {
            const image = cell.querySelector("img");
            const event = {target: image, preventDefault() {}, stopPropagation() {}};
            const protyle = {app: {}, disabled: false} as IProtyle;
            assert.equal(action.avClick(protyle, event as unknown as MouseEvent & {target: HTMLElement}), true);
            asset.editAssetItem({protyle, blockElement: block as unknown as Element,
                cellElements: [cell as unknown as HTMLElement], content: image.getAttribute("src"),
                type: "image", name: "", index: 0, rect: cell.getBoundingClientRect() as DOMRect});
            const menuPreview = items.get("cardPreview").click;
            menuPreview();
            const target = document.createElement("span");
            target.dataset.type = "image";
            target.dataset.content = image.getAttribute("src");
            const button = document.createElement("span");
            target.append(button);
            const context = {avID: "av", options: {protyle, blockElement: block, cellElements: [cell]}};
            const popupPreview = () => panel.assetPanel.actions.openAssetItem(context as unknown as IAVPanelContext,
                {target: button, event} as unknown as IAVPanelAction);
            popupPreview();
            popupPreviews.push(menuPreview, popupPreview);
            if (related) {
                assert.deepEqual(previews, [], "related previews never request the entire target database");
                assert.deepEqual(scopedPreviews.splice(0), Array.from({length: 3}, () => [
                    ["assets/first.png", "assets/second.png"], image.getAttribute("src"),
                ]));
            } else {
                assert.deepEqual(previews.splice(0), Array.from({length: 3}, () => [image.getAttribute("src"),
                    "av", "carrier", "view", "Alpha", cell.closest(".av__body").dataset.groupId]));
                assert.deepEqual(scopedPreviews, []);
            }
        }
        if (related) {
            const blockedPreview = () => {
                popupPreviews.forEach(preview => preview());
                assert.deepEqual(previews, [], "a stale related popup cannot fall back to an ordinary request");
                assert.deepEqual(scopedPreviews, [], "a stale related popup cannot reopen cached images");
            };
            relationHost.active = false;
            blockedPreview();
            relationHost.active = true;
            relationHost.available = false;
            blockedPreview();
            relationHost.available = true;
            block.remove();
            blockedPreview();
            document.body.append(block);
            host.deleteAVRelationHost(block as unknown as HTMLElement);
            blockedPreview();
        }
    });
}

test("database image preview forwards optional groups and preserves response order and selected image", async () => {
    const document = new DOMFixture();
    const requests: Array<{path: string, body: Record<string, string>}> = [];
    const displayed: Array<{sources: string[], index: number}> = [];
    let responseData: string[] | null = ["assets/Beta.png", "assets/file.bin", "assets/Alpha.png"];
    class Viewer {
        constructor(element: DOMElement, options: {initialViewIndex: number}) {
            displayed.push({sources: element.querySelectorAll("img").map(item => item.getAttribute("src")),
                index: options.initialViewIndex});
        }
        destroy() {}
        show() {}
    }
    const exports = {} as typeof import("../../preview/image");
    runInNewContext(compile("../../preview/image.ts"), {exports, document, Viewer,
        window: {siyuan: {}},
        require: () => ({Constants: {}, addScript: () => Promise.resolve(),
            isBrowserRenderableImagePath: (src: string) => src.endsWith(".png"),
            fetchPost: (path: string, body: Record<string, string>, callback: (response: unknown) => void) => {
                requests.push({path, body});
                callback({code: 0, data: responseData});
            }}),
    });
    for (const group of [undefined, "", "group"]) {
        exports.previewAttrViewImages("assets/Alpha.png", "av", "carrier", "view", "query", group);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(requests.at(-1).path, "/api/av/getCurrentAttrViewImages");
        assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1).body)), {
            id: "av", blockID: "carrier", viewID: "view", query: "query",
            ...(group === undefined ? {} : {groupID: group}),
        });
        assert.deepEqual(displayed.at(-1), {sources: ["assets/Beta.png", "assets/Alpha.png"], index: 1});
    }
    for (const empty of [null, [], ["assets/file.bin"]]) {
        responseData = empty;
        exports.previewAttrViewImages("assets/Alpha.png", "av", "carrier", "view", "query", "group");
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(displayed.length, 3, "empty results do not open an empty viewer");
    }
});
