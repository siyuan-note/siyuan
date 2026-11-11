import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, forEachChild, isCallExpression, isMethodDeclaration, ScriptTarget, transpileModule} from "typescript";
import {getAssetUploadSuccesses} from "../upload/uploadResult";

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

const createCoverHarness = (mobile: boolean, importCovers = false) => {
    const {parse} = require("ifdef-loader/preprocessor");
    const source = createSourceFile("Background.ts", parse(readFileSync(__dirname + "/Background.ts", "utf8"),
        {MOBILE: mobile, BROWSER: false}), ScriptTarget.Latest, true);
    const methods: string[] = [];
    let listener: string;
    const collect = (node: import("typescript").Node) => {
        if (isMethodDeclaration(node) && ["openBackgroundMenu", "openBuiltInPicker", "openAssetMenu", "openLinkDialog",
            "setRandomBackground", "uploadBuiltInCover"].includes(node.name.getText(source))) {
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
    const files: File[] = [];
    const uploadCallbacks: Array<(response: string) => void> = [];
    const uploadOptions: unknown[] = [];
    const reads: string[] = [];
    const messages: string[] = [];
    const errors: unknown[] = [];
    const randomRanges: number[][] = [];
    let coverData: Promise<{allCovers: {file: string}[]} | null> = Promise.resolve({
        allCovers: [{file: "first.webp"}, {file: "last cover.webp"}],
    });
    let coverResponse = Promise.resolve(new Response("cover", {headers: {"Content-Type": "image/webp"}}));
    const renders: unknown[] = [];
    const items: Array<{label: string; icon: string; click: () => void}> = [];
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
    const window = {siyuan: {menus: {menu}, languages: {upload: "upload", link: "link", assets: "assets",
        builtIn: "builtIn", random: "random", uploadError: "uploadError"}}};
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
    const Background = new Function("window", "toggleMenu", "assetMenu", "mobileInputDialog", "openCoverPicker",
        "bindPopoverDialog", "Constants", "fetchPost", "hideElements", "fetchCoverData", "getRandom", "bgs",
        "fetch", "uploadFiles", "getAssetUploadSuccesses", "showMessage", "console", transpileModule(
            `class Background {${methods.join("\n")} bind(protyle) {${listener}}} return Background;`,
            {compilerOptions: {target: ScriptTarget.ES2021}}).outputText)(window, toggleMenu,
        (_protyle: unknown, position: IPosition, select: (url: string) => void) => {
            assert.equal(anchor, undefined, "the source menu closes before the asset picker opens");
            asset = {position, select};
        }, (options: typeof link) => { link = options; return dialog; },
        (options: typeof builtIn) => { builtIn = options; return dialog; }, () => {},
        {SIYUAN_ASSETS_IMAGE: [".png"]}, (...args: unknown[]) => writes.push(args), () => {},
        () => {
            assert.equal(anchor, undefined, "random selection closes the source menu before loading covers");
            return coverData;
        }, (min: number, max: number) => { randomRanges.push([min, max]); return max; },
        ["background:pattern-first", "background:pattern-last"],
        (url: string) => { reads.push(url); return coverResponse; },
        (_protyle: unknown, uploaded: File[], _progress: unknown, callback: (response: string) => void,
         _error: unknown, options: unknown) => {
            files.push(...uploaded);
            uploadCallbacks.push(callback);
            uploadOptions.push(options);
        }, getAssetUploadSuccesses, (message: string) => messages.push(message), {error: (error: unknown) => errors.push(error)});
    const background = new Background();
    const element = new EventTarget();
    Object.assign(element, {isEqualNode: (other: unknown) => other === element, isConnected: true,
        querySelector: () => ({click: () => uploads.push("file-picker")})});
    Object.assign(background, {element, ial: {}, imgElement: {src: "data:image/png;base64,placeholder"},
        render: (...args: unknown[]) => renders.push(args)});
    if (!importCovers) {
        background.uploadBuiltInCover = (_protyle: unknown, name: string) => uploads.push(name);
    }
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
        asset: () => asset, link: () => link, builtIn: () => builtIn, dialog, files, uploadCallbacks, uploadOptions,
        reads, messages, errors, randomRanges, setCovers: (value: typeof coverData) => { coverData = value; },
        setResponse: (value: typeof coverResponse) => { coverResponse = value; }};
};

const settleCover = () => new Promise(resolve => setImmediate(resolve));

for (const mobile of [false, true]) {
    test(`adding a cover selects a source without provisional writes (${mobile ? "mobile" : "desktop"})`, () => {
        const h = createCoverHarness(mobile);
        assert.equal(h.click().defaultPrevented, true);
        assert.deepEqual(h.items.map(item => [item.label, item.icon]), [["upload", "iconUpload"], ["link", "iconLink"],
            ["assets", "iconImage"], ["builtIn", "iconGallery"], ["random", "iconDices"]]);
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

    test(`random covers use explicit menu and toolbar actions (${mobile ? "mobile" : "desktop"})`, async () => {
        const h = createCoverHarness(mobile);
        h.click();
        h.items[4].click();
        assert.equal(h.items.length, 0);
        assert.deepEqual(h.uploads, []);
        await settleCover();
        assert.deepEqual(h.uploads, ["last cover.webp"]);
        assert.deepEqual(h.randomRanges, [[0, 1]]);
        assert.equal(h.click("random-cover").defaultPrevented, true);
        await settleCover();
        assert.deepEqual(h.uploads, ["last cover.webp", "last cover.webp"], "independent draws can repeat");
        assert.deepEqual(h.writes, [], "the selected image is saved by the upload success callback");
        h.protyle.disabled = true;
        h.click("random-cover");
        await settleCover();
        assert.equal(h.uploads.length, 2);
    });

    test(`unavailable and empty cover lists select a CSS pattern (${mobile ? "mobile" : "desktop"})`, async () => {
        const unavailable: Array<{allCovers: {file: string}[]} | null> = [null, {allCovers: []}];
        for (const data of unavailable) {
            const h = createCoverHarness(mobile);
            h.setCovers(Promise.resolve(data));
            h.click("random-cover");
            await settleCover();
            assert.deepEqual(h.uploads, []);
            assert.equal(h.background.ial["title-img"], "background:pattern-last");
            assert.deepEqual(h.writes, [["/api/attr/setBlockAttrs", {id: "document",
                attrs: {"title-img": "background:pattern-last"}}]]);
            assert.equal(h.renders.length, 1);
        }
    });

    test(`random selection stops when its document becomes unavailable (${mobile ? "mobile" : "desktop"})`, async () => {
        for (const invalidate of [
            (h: ReturnType<typeof createCoverHarness>) => { h.protyle.disabled = true; },
            (h: ReturnType<typeof createCoverHarness>) => { h.background.element.isConnected = false; },
            (h: ReturnType<typeof createCoverHarness>) => { h.protyle.block.rootID = "other-document"; },
        ]) {
            const h = createCoverHarness(mobile);
            let resolve: (value: {allCovers: {file: string}[]}) => void;
            h.setCovers(new Promise(done => { resolve = done; }));
            h.click("random-cover");
            invalidate(h);
            resolve({allCovers: [{file: "late.webp"}]});
            await settleCover();
            assert.deepEqual(h.uploads, []);
            assert.deepEqual(h.writes, []);
            assert.deepEqual(h.renders, []);
        }
    });

    test(`random covers save the uploaded asset path (${mobile ? "mobile" : "desktop"})`, async () => {
        const h = createCoverHarness(mobile, true);
        h.click("random-cover");
        await settleCover();
        assert.deepEqual(h.reads, ["/appearance/covers/last%20cover.webp"]);
        assert.equal(h.files[0].name, "last cover.webp");
        assert.equal(h.files[0].type, "image/webp");
        assert.equal(await h.files[0].text(), "cover");
        assert.deepEqual(h.uploadOptions, [{source: "programmatic", target: "background"}]);
        assert.deepEqual(h.writes, []);
        const url = "assets/random.webp?box=encrypted";
        h.uploadCallbacks[0](JSON.stringify({code: 0, data: {
            succFiles: [{index: 0, name: "last cover.webp", path: url}],
        }}));
        assert.deepEqual(h.writes, [["/api/attr/setBlockAttrs", {id: "document",
            attrs: {"title-img": `background-image:url("${url}")`}}]]);
        assert.equal(h.renders.length, 1);
    });

    test(`failed random cover imports preserve the existing cover (${mobile ? "mobile" : "desktop"})`, async () => {
        for (const failure of ["download", "upload"]) {
            const h = createCoverHarness(mobile, true);
            const original = 'background-image:url("assets/original.webp")';
            h.background.ial["title-img"] = original;
            if (failure === "download") {
                h.setResponse(Promise.resolve(new Response(null, {status: 404, statusText: "Not Found"})));
            }
            h.click("random-cover");
            await settleCover();
            if (failure === "upload") {
                h.uploadCallbacks[0](JSON.stringify({code: 0, data: {succFiles: [], errFiles: ["last cover.webp"]}}));
                assert.deepEqual(h.messages, []);
            } else {
                assert.deepEqual(h.messages, ["uploadError"]);
                assert.equal(h.errors.length, 1);
                assert.equal(h.files.length, 0);
            }
            assert.equal(h.background.ial["title-img"], original);
            assert.deepEqual(h.writes, []);
            assert.deepEqual(h.renders, []);
        }
    });

    test(`cover imports stop before uploading or saving an unavailable document (${mobile ? "mobile" : "desktop"})`, async () => {
        const h = createCoverHarness(mobile, true);
        let resolve: (value: Response) => void;
        h.setResponse(new Promise(done => { resolve = done; }));
        h.click("random-cover");
        await settleCover();
        h.protyle.disabled = true;
        resolve(new Response("cover"));
        await settleCover();
        assert.equal(h.files.length, 0);
        assert.deepEqual(h.writes, []);
        const importing = createCoverHarness(mobile, true);
        importing.click("random-cover");
        await settleCover();
        importing.protyle.block.rootID = "other-document";
        importing.uploadCallbacks[0](JSON.stringify({code: 0, data: {succMap: {"last cover.webp": "assets/late.webp"}}}));
        assert.deepEqual(importing.writes, []);
        assert.deepEqual(importing.renders, []);
    });
}
