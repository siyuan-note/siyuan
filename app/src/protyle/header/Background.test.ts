import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, forEachChild, isCallExpression, isMethodDeclaration, ScriptTarget, transpileModule} from "typescript";

test("adding a document icon opens selection without changing the document or its header", () => {
    const source = createSourceFile("Background.ts", readFileSync(__dirname + "/Background.ts", "utf8"), ScriptTarget.Latest, true);
    let listener: string;
    const collect = (node: import("typescript").Node) => {
        if (isCallExpression(node) && node.expression.getText(source) === "this.element.addEventListener" &&
            node.arguments[0].getText(source) === '"click"') {
            listener = node.getText(source);
        }
        forEachChild(node, collect);
    };
    collect(source);
    assert.ok(listener);
    const element = new EventTarget();
    Object.defineProperty(element, "isEqualNode", {value: (other: EventTarget) => other === element});
    const panels: unknown[][] = [];
    const writes: unknown[] = [];
    const changes: string[] = [];
    const iconRect = {left: 100, bottom: 200, height: 60, width: 60};
    const buttonRect = {left: 120, bottom: 240, height: 28, width: 110};
    const target = (type: string) => ({
        getAttribute: () => type, getBoundingClientRect: () => type === "icon" ? buttonRect : iconRect,
        isEqualNode: (): boolean => false, parentElement: element, querySelector: (): null => null,
    });
    const background = {element, iconElement: {
        getBoundingClientRect: () => iconRect,
        classList: {remove: (name: string) => changes.push(name)},
    }};
    const protyle = {element: {}, block: {rootID: "document"}, disabled: false,
        model: {parent: {setDocIcon: (value: string) => changes.push(value)}}};
    new Function("protyle", "hideElements", "openEmojiPanel", "fetchPost", transpileModule(listener, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText).call(background, protyle, () => {}, (...args: unknown[]) => panels.push(args),
        (...args: unknown[]) => writes.push(args));
    const click = (type: string) => {
        const event = new Event("click", {cancelable: true});
        Object.defineProperty(event, "target", {value: target(type)});
        element.dispatchEvent(event);
        return event;
    };
    assert.equal(click("icon").defaultPrevented, true);
    assert.deepEqual(panels[0], ["document", "doc", {
        x: buttonRect.left, y: buttonRect.bottom, h: buttonRect.height, w: buttonRect.width,
    }, undefined, undefined, {ownerElement: protyle.element}]);
    assert.deepEqual(writes, [], "opening the picker does not persist a provisional icon");
    assert.deepEqual(changes, [], "opening the picker does not reveal or replace the document icon");
    click("open-emoji");
    assert.deepEqual(panels[1], ["document", "doc", {
        x: iconRect.left, y: iconRect.bottom, h: iconRect.height, w: iconRect.width,
    }, undefined, null, {ownerElement: protyle.element}], "existing icons retain their own picker anchor");
    protyle.disabled = true;
    click("icon");
    assert.equal(panels.length, 2, "read-only headers cannot open icon selection");
});

const createCoverHarness = (mobile: boolean) => {
    const {parse} = require("ifdef-loader/preprocessor");
    const source = createSourceFile("Background.ts", parse(readFileSync(__dirname + "/Background.ts", "utf8"),
        {MOBILE: mobile, BROWSER: false}), ScriptTarget.Latest, true);
    const methods: string[] = [];
    let listener: string;
    const collect = (node: import("typescript").Node) => {
        if (isMethodDeclaration(node) && ["openBackgroundMenu", "openBuiltInPicker", "openAssetMenu", "openLinkDialog"].includes(node.name.getText(source))) {
            methods.push(node.getText(source));
        }
        if (isCallExpression(node) && node.expression.getText(source) === "this.element.addEventListener" &&
            node.arguments[0].getText(source) === '"click"') {
            listener = node.getText(source);
        }
        forEachChild(node, collect);
    };
    collect(source);
    const writes: unknown[] = [];
    const uploads: string[] = [];
    const renders: unknown[] = [];
    const items: Array<{label: string; click: () => void}> = [];
    const positions: unknown[] = [];
    let anchor: unknown;
    let asset: {position: IPosition; select: (url: string) => void};
    let link: {value: string; onConfirm: (value: string, dialog: {destroy: () => void}) => void};
    let builtIn: {select: (name: string) => void; fallback: (dialog: unknown) => void};
    const dialog = {element: {setAttribute: () => {}}, destroy: () => {}};
    const menu = {
        remove: () => { anchor = undefined; items.length = 0; },
        addItem: (item: typeof items[number]) => items.push(item),
        popup: (position: IPosition) => positions.push(position),
        fullscreen: (position: string) => positions.push(position),
    };
    const protyle = {element: {}, block: {rootID: "document"}, disabled: false};
    const window = {siyuan: {menus: {menu}, languages: {upload: "upload", link: "link", assets: "assets", builtIn: "builtIn"}}};
    const toggleMenu = (options: {target: unknown; build: (value: typeof menu) => void; show: (value: typeof menu) => void}) => {
        if (anchor === options.target) {
            menu.remove();
            return;
        }
        menu.remove();
        anchor = options.target;
        options.build(menu);
        options.show(menu);
    };
    const Background = new Function("window", "toggleMenu", "assetMenu", "openInputDialog", "openCoverPicker",
        "bindPopoverDialog", "Constants", "fetchPost", "hideElements", transpileModule(
            `class Background {${methods.join("\n")} bind(protyle) {${listener}}} return Background;`,
            {compilerOptions: {target: ScriptTarget.ES2021}}).outputText)(window, toggleMenu,
        (_protyle: unknown, position: IPosition, select: (url: string) => void) => {
            assert.equal(anchor, undefined, "the source menu closes before the asset picker opens");
            asset = {position, select};
        }, (options: typeof link) => { link = options; return dialog; },
        (options: typeof builtIn) => { builtIn = options; return dialog; }, () => {},
        {SIYUAN_ASSETS_IMAGE: [".png"]}, (...args: unknown[]) => writes.push(args), () => {});
    const background = new Background();
    const element = new EventTarget();
    Object.assign(element, {isEqualNode: (other: unknown) => other === element,
        querySelector: () => ({click: () => uploads.push("file-picker")})});
    Object.assign(background, {element, ial: {}, imgElement: {src: "data:image/png;base64,placeholder"},
        render: (...args: unknown[]) => renders.push(args), uploadBuiltInCover: (_protyle: unknown, name: string) => uploads.push(name)});
    background.bind(protyle);
    const target = {getAttribute: () => "random", isEqualNode: () => false, parentElement: element,
        getBoundingClientRect: () => ({left: 10, bottom: 30}),};
    Object.assign(element, {getBoundingClientRect: () => ({right: 100})});
    const click = (type = "random") => {
        const event = new Event("click", {cancelable: true});
        Object.defineProperty(event, "target", {value: {...target, getAttribute: () => type}});
        element.dispatchEvent(event);
        return event;
    };
    return {background, protyle, writes, uploads, renders, items, positions, click, menu,
        asset: () => asset, link: () => link, builtIn: () => builtIn, dialog};
};

for (const mobile of [false, true]) {
    test(`adding a cover selects a source without provisional writes (${mobile ? "mobile" : "desktop"})`, () => {
        const h = createCoverHarness(mobile);
        assert.equal(h.click().defaultPrevented, true);
        assert.deepEqual(h.items.map(item => item.label), ["upload", "link", "assets", "builtIn"]);
        assert.deepEqual(h.positions, [mobile ? "bottom" : {x: 10, y: 30}]);
        h.menu.remove();
        assert.deepEqual(h.writes, []);
        assert.deepEqual(h.uploads, []);
        assert.deepEqual(h.renders, []);
        assert.deepEqual(h.background.ial, {});
        h.protyle.disabled = true;
        h.click();
        assert.equal(h.items.length, 0, "read-only documents cannot open source selection");
    });

    test(`cover sources save only after selection (${mobile ? "mobile" : "desktop"})`, () => {
        const h = createCoverHarness(mobile);
        h.click();
        h.items[0].click();
        assert.deepEqual(h.uploads, ["file-picker"]);
        assert.deepEqual(h.writes, [], "canceling the file picker does not save a cover");
        h.click();
        h.items[1].click();
        assert.equal(h.link().value, "");
        h.dialog.destroy();
        assert.deepEqual(h.writes, [], "canceling the link dialog does not save a cover");
        h.click();
        h.items[1].click();
        h.link().onConfirm("assets/cover.png?box=notebook", h.dialog);
        assert.deepEqual(h.writes[0], ["/api/attr/setBlockAttrs", {id: "document",
            attrs: {"title-img": 'background-image:url("assets/cover.png?box=notebook");'}}]);
        h.click();
        h.items[2].click();
        assert.equal(h.asset().position.y, 38);
        assert.equal(h.writes.length, 1, "opening the asset picker does not save a cover");
        h.asset().select("assets/existing.png?box=encrypted");
        assert.equal(h.background.ial["title-img"], 'background-image:url("assets/existing.png?box=encrypted")');
        assert.deepEqual(h.uploads, ["file-picker"], "existing resources are referenced without uploading");
        h.click();
        h.items[3].click();
        h.dialog.destroy();
        assert.deepEqual(h.uploads, ["file-picker"], "canceling the built-in picker does not import a cover");
        h.click();
        h.items[3].click();
        h.builtIn().select("selected.jpg");
        assert.deepEqual(h.uploads, ["file-picker", "selected.jpg"]);
        assert.equal(h.writes.length, 2);
    });
}
