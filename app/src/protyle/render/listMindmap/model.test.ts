import * as assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {runInNewContext} from "node:vm";
import type {ListMindmapLayoutNode, ListMindmapNode} from "./model";
import type {ListMindmapFoldTarget} from "./fold";
import {routeMindmapRelation} from "./routing";
import {layoutListMindmapSummaries} from "./summary";
import {getListConversionType, type TListSubtype} from "../../wysiwyg/listContext";

const buildGlobals = ["SIYUAN_VERSION", "NODE_ENV"].map(name => ({
    name, descriptor: Object.getOwnPropertyDescriptor(globalThis, name),
}));
buildGlobals.forEach(({name}) => Object.defineProperty(globalThis, name, {configurable: true, value: "test"}));
const {layoutListMindmap, parseListMindmapMetadata, isListMindmapListConversion}: typeof import("./model") = require("./model");
buildGlobals.forEach(({name, descriptor}) => {
    if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
    } else {
        Reflect.deleteProperty(globalThis, name);
    }
});

const measured = (id: string, width = 100, height = 40,
                  children: ListMindmapLayoutNode[] = []): ListMindmapLayoutNode => ({id, width, height, children});

test("mindmap list conversion accepts exactly the shared list conversion actions", () => {
    const conversions = new Set<string>();
    const subtypes: TListSubtype[] = ["u", "o", "t"];
    for (const from of subtypes) {
        for (const to of subtypes) {
            const conversion = getListConversionType(from, to);
            if (conversion) {
                conversions.add(conversion);
            }
        }
    }
    for (const legacy of [false, true]) {
        const element = {getAttribute: (name: string) => name === "data-type" ?
            (legacy ? "NodeList" : "NodeMindmap") : legacy ? "1" : null} as unknown as Element;
        const candidates = ["OL2UL", "UL2OL", "UL2TL", "OL2TL", "TL2UL", "TL2OL",
            "UL2UL", "OL2OL", "TL2TL", "CancelList", "Blocks2UL", "invalid", ""];
        assert.deepEqual(new Set(candidates.filter(type => isListMindmapListConversion(element, type))), conversions);
    }
});

test("relation label spacing only expands the requested branch boundary", () => {
    const root = measured("root", 100, 40, [measured("a"), measured("b"), measured("c")]);
    const expanded = layoutListMindmap(root, {verticalGaps: new Map([["b", 64]])}).nodes;
    assert.equal(expanded.get("b").y - expanded.get("a").y - 40, 64);
    assert.equal(expanded.get("c").y - expanded.get("b").y - 40, 16);
    const normal = layoutListMindmap(root).nodes;
    assert.equal(normal.get("b").y - normal.get("a").y - 40, 16);
    const horizontal = layoutListMindmap(root, {horizontalGaps: new Map([["b", 150]])}).nodes;
    assert.equal(horizontal.get("b").x - horizontal.get("root").x - 100, 150);
    assert.equal(horizontal.get("a").x - horizontal.get("root").x - 100, 40);
    assert.equal(horizontal.get("c").x - horizontal.get("root").x - 100, 40);
});

test("default sibling packing reduces height while preserving node sizes and control clearance", () => {
    const root = measured("root", 100, 40, [measured("a", 80, 32), measured("b", 160, 80),
        measured("c", 120, 160), measured("d", 60, 32)]);
    const snapshot = JSON.stringify(root);
    const previous = layoutListMindmap(root, {verticalGap: 24});
    const compact = layoutListMindmap(root);
    assert.ok(compact.height < previous.height);
    assert.equal(compact.width, previous.width);
    root.children.forEach((child, index) => {
        const position = compact.nodes.get(child.id);
        assert.equal(position.width, child.width);
        assert.equal(position.height, child.height);
        if (index) {
            const above = compact.nodes.get(root.children[index - 1].id);
            assert.ok(position.y > above.y + above.height + 14, "the lower hover corridor stays clear of its sibling");
        }
        assert.ok(position.x >= compact.nodes.get(root.id).x + root.width + 39,
            "fold and add-child buttons retain their horizontal space");
    });
    assert.equal(JSON.stringify(root), snapshot);
});

test("compact view spacing retains draggable relations without expanding unrelated siblings", () => {
    const typescript = require("typescript") as typeof import("typescript");
    const source = typescript.createSourceFile("view.ts", readFileSync(path.join(__dirname, "view.ts"), "utf8"),
        typescript.ScriptTarget.ES2021, true);
    const declaration = source.statements.find(typescript.isClassDeclaration);
    const methods = declaration.members.filter(member =>
        ["refreshLayout", "positionNodes", "resizeViewport", "getViewportAnchorY"].includes(member.name?.getText(source)));
    assert.equal(methods.length, 4);
    const compiled = typescript.transpileModule(`class View {${methods.map(member => member.getText(source)).join("\n")}} globalThis.View = View;`, {
        compilerOptions: {target: typescript.ScriptTarget.ES2021},
    }).outputText;
    let frame: () => void;
    const context: any = {layoutListMindmap, layoutListMindmapSummaries,
        requestAnimationFrame: (callback: () => void) => { frame = callback; return 1; }};
    runInNewContext(compiled, context);
    const view = new context.View();
    const root = measured("root", 100, 32, [measured("a", 100, 32), measured("b", 100, 32), measured("c", 100, 32)]);
    const elements = new Map([root, ...root.children].map(node => [node.id,
        {offsetWidth: node.width, offsetHeight: node.height, hidden: false, style: {}}]));
    const model = {root, nodes: new Map([root, ...root.children].map(node => [node.id, node])),
        metadata: {version: 1, nodes: {}, relations: [] as {id: string, from: string, to: string, label: string}[]}};
    Object.assign(view, {model, options: {}, frame: 0, positions: new Map(), folded: new Map(),
        nodeElements: elements, relationElements: new Map(), summaryElements: new Map(), relationRoutes: new Map(),
        fallbackRoutes: new Set(), anchorFallbackRoutes: new Set(), offsetX: 0, offsetY: 0, scale: 1,
        viewport: {clientWidth: 760, clientHeight: 460},
        calculateRelationRoute: (_relation: unknown, from: Parameters<typeof routeMindmapRelation>[0],
                                 to: Parameters<typeof routeMindmapRelation>[1]) =>
            routeMindmapRelation(from, to, [...view.positions.values()]),
        boundedPan: (x: number, y: number) => ({x, y}), draw: () => {},
    });
    const layout = () => { view.refreshLayout(); frame(); };
    const gap = (from: string, to: string) => view.positions.get(to).y - view.positions.get(from).y -
        view.positions.get(from).height;
    layout();
    const compactGap = gap("a", "b");
    model.metadata.relations.push({id: "relation", from: "a", to: "b", label: ""});
    const snapshot = JSON.stringify(model);
    layout();
    const points = view.relationRoutes.get("relation") as {x: number, y: number}[];
    assert.ok(points.slice(1).some((point, index) =>
        Math.hypot(point.x - points[index].x, point.y - points[index].y) >= 12),
    "an unlabeled relation retains a segment long enough for its drag handle");
    assert.ok(gap("a", "b") > compactGap);
    assert.equal(gap("b", "c"), compactGap);
    assert.equal(JSON.stringify(model), snapshot);
    assert.equal(view.scale, 1);
    model.metadata.relations[0].label = "Connection";
    view.relationElements.set("relation", {offsetWidth: 120, offsetHeight: 20, hidden: true});
    layout();
    assert.ok(gap("a", "b") >= 20 + 32, "relation text reserves its measured height and clearance");
    assert.equal(gap("b", "c"), compactGap);
    model.metadata.relations = [];
    layout();
    assert.equal(gap("a", "b"), compactGap);
});

test("mindmap metadata rejects unknown formats and invalid values without replacing original data", () => {
    const value = '{"version":1,"nodes":{"a":{"bold":true,"fontSize":18,"extension":"retained"}},' +
        '"relations":[{"id":"r","from":"a","to":"b","label":"label","dash":true}],"extension":42}';
    assert.equal(JSON.stringify(parseListMindmapMetadata(value)), value);
    assert.deepEqual(parseListMindmapMetadata(null).relations, []);
    for (const invalid of ["", "null", "[]", "{", '{"version":3,"nodes":{},"relations":[]}',
        '{"version":1,"nodes":{"a":{"fontSize":"18"}},"relations":[]}',
        '{"version":1,"nodes":{"a":{"lineWidth":-1}},"relations":[]}',
        '{"version":1,"nodes":{},"relations":[],"viewLocked":"true"}',
        '{"version":1,"nodes":{},"relations":[{"id":"r","from":"a","to":"b"}]}',
        '{"version":1,"nodes":{},"relations":[{"id":"r","from":"a","to":"b","label":"","dash":0}]}']) {
        assert.throws(() => parseListMindmapMetadata(invalid), /Invalid list mindmap metadata/);
    }
});

test("node widths round trip in both metadata versions without changing existing styles", () => {
    for (const version of [1, 2]) {
        const previous = {version, nodes: {a: {textColor: "red", extension: "retained"}}, relations: [] as unknown[]};
        assert.deepEqual(parseListMindmapMetadata(JSON.stringify(previous)), previous);
        for (const width of [0, 32, 680]) {
            const next = {...previous, nodes: {a: {...previous.nodes.a, width}}};
            assert.deepEqual(parseListMindmapMetadata(JSON.stringify(next)), next);
        }
        for (const width of [-1, "600", null]) {
            assert.throws(() => parseListMindmapMetadata(JSON.stringify({
                ...previous, nodes: {a: {width}},
            })));
        }
    }
});

test("connector presets extend both metadata versions without migrating legacy configurations", () => {
    for (const version of [1, 2]) {
        const legacy = JSON.stringify({version, nodes: {a: {lineColor: "red"}}, relations: [], extension: "keep"});
        assert.equal(JSON.stringify(parseListMindmapMetadata(legacy)), legacy);
        assert.equal(parseListMindmapMetadata(legacy).connectorStyle, undefined);
        for (const connectorStyle of ["spline", "orthogonal", "bezier", "rounded"]) {
            const value = JSON.stringify({...JSON.parse(legacy), connectorStyle});
            assert.equal(JSON.stringify(parseListMindmapMetadata(value)), value);
        }
        for (const connectorStyle of [null, "", "future-style", 0, false, {}, []]) {
            const value = JSON.stringify({...JSON.parse(legacy), connectorStyle});
            assert.throws(() => parseListMindmapMetadata(value), /Invalid list mindmap metadata/);
        }
    }
});

test("appearance metadata is additive and rejects invalid palettes and branch slots without changing source", () => {
    for (const version of [1, 2]) {
        const base = {version, nodes: {a: {branchColor: 2, lineColor: "red"}}, relations: [] as unknown[], extension: "keep"};
        const appearance = {version: 1, palette: ["#123456", "#abcdef"], backgroundColor: "#ffffff", extension: "keep"};
        const source = JSON.stringify({...base, appearance});
        assert.equal(JSON.stringify(parseListMindmapMetadata(source)), source);
        for (const nodeStyle of ["layered", "branch"]) {
            const withRootColor = JSON.stringify({...base, appearance: {...appearance, rootColor: "#112233", nodeStyle}});
            assert.equal(JSON.stringify(parseListMindmapMetadata(withRootColor)), withRootColor);
        }
        for (const invalid of [null, [], {}, {...appearance, version: 2}, {...appearance, palette: ["red"]},
            {...appearance, backgroundColor: "url(x)"},
            ...[null, "", "red", "url(x)", 123].map(rootColor => ({...appearance, rootColor})),
            ...[null, "", "flat", "unknown", 123].map(nodeStyle => ({...appearance, nodeStyle}))]) {
            const value = JSON.stringify({...base, appearance: invalid});
            assert.throws(() => parseListMindmapMetadata(value), /Invalid list mindmap metadata/);
        }
        for (const branchColor of [-1, .5, null, "1", 9007199254740992]) {
            const value = JSON.stringify({...base, nodes: {a: {branchColor}}, appearance});
            assert.throws(() => parseListMindmapMetadata(value), /Invalid list mindmap metadata/);
        }
    }
});

test("manual relation routes are optional, versioned and validated without dropping extension fields", () => {
    const route = {version: 1, points: [{x: -40, y: 25.5, t: .4, extension: "keep"}], extension: "keep"};
    const metadata = {version: 1, nodes: {}, relations: [{id: "r", from: "a", to: "b", label: "", route}]};
    const value = JSON.stringify(metadata);
    assert.equal(JSON.stringify(parseListMindmapMetadata(value)), value);
    for (const invalid of [null, {}, {...route, version: 2}, {...route, points: []},
        {...route, points: Array(65).fill(route.points[0])}, ...[
            {x: "0", y: 0, t: 0}, {x: 0, y: 0, t: -1}, {x: 0, y: 0, t: 1.1},
            {x: 1e7, y: 0, t: .5}, {x: 0, y: null, t: .5}, {x: 0, y: 0},
        ].map(point => ({version: 1, points: [point]}))]) {
        const data = JSON.stringify({...metadata, relations: [{...metadata.relations[0], route: invalid}]});
        assert.throws(() => parseListMindmapMetadata(data), /Invalid list mindmap metadata/);
    }
});

test("relation arrow directions are optional and validated without dropping metadata", () => {
    const relation = {id: "r", from: "a", to: "b", label: "Keep", color: "red", extension: "keep",
        route: {version: 1, points: [{x: 10, y: 20, t: .5}]}};
    const metadata = {version: 1, nodes: {}, relations: [relation]};
    const original = JSON.stringify(metadata);
    assert.equal(JSON.stringify(parseListMindmapMetadata(original)), original);
    for (const arrowDirection of ["forward", "reverse", "both", "none"]) {
        const value = JSON.stringify({...metadata, relations: [{...relation, arrowDirection}]});
        assert.equal(JSON.stringify(parseListMindmapMetadata(value)), value);
    }
    for (const arrowDirection of [null, "", "backward", 0, false, {}, []]) {
        const value = JSON.stringify({...metadata, relations: [{...relation, arrowDirection}]});
        assert.throws(() => parseListMindmapMetadata(value), /Invalid list mindmap metadata/);
    }
});

test("summary metadata is optional and rejects damaged groups while retaining extension fields", () => {
    const old = '{"version":1,"rootTitle":"Root","nodes":{},"relations":[]}';
    assert.equal(JSON.stringify(parseListMindmapMetadata(old)), old);
    const summary = {id: "s", parentId: "root", nodeIds: ["a", "b"], label: "Summary", extension: "keep"};
    const value = {...JSON.parse(old), summaries: [summary]};
    assert.equal(JSON.stringify(parseListMindmapMetadata(JSON.stringify(value))), JSON.stringify(value));
    for (const summaries of [null, {}, [{...summary, nodeIds: []}], [{...summary, nodeIds: ["a", "a"]}],
        [{...summary, nodeIds: ["root"]}], [{...summary, label: 1}], [{...summary, color: 1}],
        [summary, {...summary, id: "other"}], [summary, {...summary, nodeIds: ["c"]}]]) {
        assert.throws(() => parseListMindmapMetadata(JSON.stringify({...value, summaries})), /Invalid list mindmap metadata/);
    }
});

test("versioned nested summaries retain legacy fixtures and reject crossing or damaged configurations", () => {
    const fixture = readFileSync(path.resolve(__dirname, "../../../../../kernel/model/testdata/list_mindmap_summary_v1.json"), "utf8").trim();
    assert.equal(JSON.stringify(parseListMindmapMetadata(fixture)), fixture);
    const data = JSON.parse(fixture);
    data.summaries.push({...data.summaries[0], id: "inner", nodeIds: ["a"]});
    assert.throws(() => parseListMindmapMetadata(JSON.stringify(data)), /Invalid list mindmap metadata/);
    data.version = 2;
    assert.equal(JSON.stringify(parseListMindmapMetadata(JSON.stringify(data))), JSON.stringify(data));
    for (const nodes of [["b", "c"], ["a", "a"]]) {
        data.summaries[1].nodeIds = nodes;
        assert.throws(() => parseListMindmapMetadata(JSON.stringify(data)), /Invalid list mindmap metadata/);
    }
});

test("large summary labels reserve space on both sides of the group", () => {
    const root = measured("root", 100, 40, [measured("before"), measured("a"), measured("b"), measured("after")]);
    const {nodes} = layoutListMindmap(root, {summaries: [{nodeIds: ["a", "b"], height: 500}]});
    const center = (nodes.get("a").y + nodes.get("b").y + 40) / 2;
    assert.ok(center - 250 > nodes.get("before").y + 40);
    assert.ok(center + 250 < nodes.get("after").y);
});

test("variable-size mindmap branches keep their order and never overlap", () => {
    const root = measured("root", 90, 55, [
        measured("a", 220, 200, [measured("a1", 150, 36), measured("a2", 90, 92)]),
        measured("b", 70, 34, [measured("b1", 200, 160), measured("b2", 60, 30)]),
        measured("c", 80, 55),
    ]);
    const snapshot = JSON.stringify(root);
    const layout = layoutListMindmap(root, {horizontalGap: 48, verticalGap: 20, padding: 30});
    const positions = [...layout.nodes.values()];
    assert.equal(positions.length, 8);
    assert.equal(layout.edges.length, 7);
    assert.equal(JSON.stringify(root), snapshot);
    for (const position of positions) {
        assert.ok(position.x >= 30 && position.y >= 30);
        assert.ok(position.x + position.width <= layout.width - 30);
        assert.ok(position.y + position.height <= layout.height - 30);
        if (position.parentId) {
            const parent = layout.nodes.get(position.parentId);
            assert.equal(position.x - parent.x - parent.width, 48);
        }
        for (const other of positions) {
            if (other.id !== position.id) {
                assert.ok(position.x + position.width <= other.x || other.x + other.width <= position.x ||
                    position.y + position.height <= other.y || other.y + other.height <= position.y);
            }
        }
    }
    assert.ok(layout.nodes.get("a").y < layout.nodes.get("b").y);
    assert.ok(layout.nodes.get("b").y < layout.nodes.get("c").y);
    assert.equal(layout.nodes.get("a1").x - layout.nodes.get("b2").x, 150);
});

test("folded branches disappear from layout and restore deterministically", () => {
    const root = measured("root", 100, 40, [measured("branch", 100, 40, [measured("leaf", 100, 80)])]);
    const before = layoutListMindmap(root);
    root.children[0].collapsed = true;
    const folded = layoutListMindmap(root);
    assert.equal(folded.nodes.has("leaf"), false);
    assert.ok(folded.width < before.width);
    assert.ok(folded.height < before.height);
    root.children[0].collapsed = false;
    assert.deepEqual(layoutListMindmap(root), before);
});

test("layout rejects cyclic or invalid trees and supports deep nesting without recursive overflow", () => {
    const cyclic = measured("root");
    cyclic.children.push(cyclic);
    assert.throws(() => layoutListMindmap(cyclic), /Invalid list mindmap layout node/);
    assert.throws(() => layoutListMindmap(measured("a", 0)), /Invalid list mindmap layout node/);
    assert.throws(() => layoutListMindmap(measured("a"), {padding: Number.NaN}), /Invalid list mindmap layout spacing/);
    let root = measured("leaf");
    for (let index = 0; index < 5000; index++) {
        root = measured(`node-${index}`, 100, 40, [root]);
    }
    assert.equal(layoutListMindmap(root).nodes.size, 5001);
});

const browserCases = async (sourceCode: string, css: string, taskSource: string, taskCSS: string, dragSource: string,
                            inputSource: string, controllerSource: string) => {
    const check = require("node:assert/strict");
    const api = new Function("mathRender", "Constants", "highlightRender", sourceCode + "; return {readListMindmap, moveListMindmapNode, addListMindmapNode, " +
        "deleteListMindmapNode, replaceListMindmapContent, cleanListMindmapHTML, convertListMindmapToList, listMindmapConversionSource, remapListMindmapIDs, writeListMindmapMetadata, retagMindmapBranch, " +
        "getListMindmapSiblingIDs, normalizeListMindmapSummaryMetadata, getListMindmapSummaryRange, getListMindmapSiblingFoldStates, " +
        "addListMindmapSummaryRanges, getListMindmapSummarySnapshot, " +
        "normalizeLegacyMindmapCodes, replaceLegacyMindmapHTML, spinListMindmapDOM, focusListMindmap, " +
        "initializeListMindmapConnectorStyle, LIST_MINDMAP_DEFAULT_CONNECTOR_STYLE_KEY, " +
        "tabsRender, destroyTabsRender, getTabTask, getListMindmapTabItem, convertTabsList, completeTabsListSource, ListMindmapView, registerListMindmapView, resolveVisibleListMindmapBlock, getListMindmapElements, registerListMindmapRoot, restoreListMindmapFocus};")(
        async (element: Element) => {
            const formulas = element.querySelectorAll('[data-subtype="math"]:not([data-render="true"])');
            await Promise.resolve();
            formulas.forEach(formula => {
                formula.innerHTML = '<span class="katex">rendered formula</span>';
                formula.setAttribute("data-render", "true");
            });
        }, {TIMEOUT_DBLCLICK: 190, TIMEOUT_LONGPRESS: 460, CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap",
            CUSTOM_SY_LIST_MINDMAP_DATA: "custom-sy-list-mindmap-data", CUSTOM_SY_MINDMAP_CODE: "custom-sy-mindmap-code",
            CUSTOM_SY_CODE_TAB_SPACES: "custom-sy-code-tab-spaces"}, () => {});
    const lute = Lute.New();
    lute.SetKramdownIAL(true);
    lute.SetProtyleWYSIWYG(true);
    window.siyuan = {languages: new Proxy({}, {get: (_target, key) => String(key)}),
        config: {editor: {}, keymap: {editor: {general: {}, list: {}}}}, storage: {}} as unknown as typeof window.siyuan;
    for (const mobile of [false, true]) {
        const root = document.createElement("div");
        root.className = "protyle-wysiwyg";
        root.innerHTML = lute.Md2BlockDOM("- Original\n  - Folded child\n- Following\n");
        const original = root.firstElementChild as HTMLElement;
        api.retagMindmapBranch(original, true);
        original.firstElementChild.setAttribute("fold", "1");
        const full = original.outerHTML;
        const copies = ["first", "second"].map(id => {
            const query = document.createElement("div");
            query.dataset.type = "NodeBlockQueryEmbed";
            query.dataset.nodeId = id;
            query.innerHTML = '<div class="protyle-wysiwyg__embed" data-allow-child-operation="true" ' +
                'data-root-id="source-document">' + full + "</div>";
            const result = query.firstElementChild as HTMLElement;
            result.dataset.id = original.dataset.nodeId;
            root.append(query);
            return result.firstElementChild as HTMLElement;
        });
        document.body.append(root);
        const owner = {block: {rootID: "host-document"}, notebookId: "box", lute, options: {action: [] as string[], render: {}},
            wysiwyg: {element: root, flushPendingInput: async () => {}},
            toolbar: {isMultiSelectMode: () => false}};
        const operations: {doOperations: IOperation[], undoOperations: IOperation[]}[] = [];
        const controllers: any[] = [];
        const historyRoots: string[] = [];
        const dependencies = {...api,
            Constants: {CB_GET_HISTORY: "history", ATTRIBUTE_EDITING: "data-editing",
                CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap", CUSTOM_SY_LIST_MINDMAP_DATA: "custom-sy-list-mindmap-data"},
            isProtyleListItemFragment: () => false, isHiddenTabContent: () => false,
            matchHotKey: (binding: {custom: string} | undefined, event: KeyboardEvent) => !!binding?.custom &&
                (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey &&
                binding.custom === "⌘" + event.key.toUpperCase(),
            isMobile: () => mobile, waitForPendingTransactions: async () => {},
            preserveUndoViewport: () => () => {},
            isEncryptedBox: () => false,
            setStorageVal: () => check.fail("Embedded previews cannot persist viewport positions"),
            fetchSyncPost: async () => ({code: 0, data: {dom: full}}),
            normalizeHTMLAssetIFrameBlockDOM: (html: string) => html,
            cleanHeadingNumberHTML: (html: string) => html, cleanTableCellRichHTML: (html: string) => html,
            cleanBlockSelectionModeHTML: (html: string) => html,
            syncListMindmapHeight: () => {}, bindListMindmapResize: () => ({refresh() {}, destroy() {}}),
            showMessage: () => check.fail("Embedded edit failed"), globalClickHideMenu: () => {},
            hideAllElements: () => {}, hideElements: () => {}, suspendBlockPopover: () => () => {},
            getInlineStylesCache: () => ({}), getVisibleOrderedStyleKeys: (): string[] => [],
            openListMindmapEditor: (options: any) => {
                editorOptions = options;
                return {finish: async () => { options.onFinish(); return true; }, destroy() {}};
            },
            genListItemElement: () => {
                const holder = document.createElement("div");
                holder.innerHTML = lute.Md2BlockDOM("- Added\n");
                return holder.firstElementChild.firstElementChild;
            },
            processRender: () => {}, highlightRender: () => {}, avRender: () => {}, blockRender: () => {},
            disposeCustomBlocksInElement: () => {},
            transaction: (_owner: unknown, forward: IOperation[], backward: IOperation[]) => {
                operations.push({doOperations: forward, undoOperations: backward});
                const operation = forward[0];
                check.equal(operation.id, original.dataset.nodeId);
                root.firstElementChild.outerHTML = operation.data as string;
                controllers.slice(1).forEach(controller => check.equal(controller.replay(operation.data), true));
            },
            requestUndo: async (_owner: unknown, rootID: string) => {
                historyRoots.push(rootID);
                controllers.forEach(controller => check.equal(controller.replay(operations.at(-1).undoOperations[0].data), true));
            },
            requestRedo: async (_owner: unknown, rootID: string) => {
                historyRoots.push(rootID);
                controllers.forEach(controller => check.equal(controller.replay(operations.at(-1).doOperations[0].data), true));
            },
        };
        let editorOptions: any;
        const embedded = new Function(...Object.keys(dependencies), controllerSource +
            "; return {ListMindmapController, completeList, canEdit};")(...Object.values(dependencies));
        copies[0].querySelector('[data-type="NodeMindmap"]').remove();
        check.equal(await embedded.completeList(owner, copies[0]), "complete");
        check.match(copies[0].textContent, /Folded child/);
        copies.forEach(copy => controllers.push(new embedded.ListMindmapController(owner, copy)));
        const target = controllers[0];
        const itemID = copies[0].firstElementChild.getAttribute("data-node-id");
        const followingID = target.model.root.children[1].id;
        await target.view.options.onNodeStyle(itemID, {backgroundColor: "#ff0000"});
        check.equal(api.readListMindmap(copies[1]).metadata.nodes[itemID].backgroundColor, "#ff0000");
        check.equal(operations[0].undoOperations[0].context.undoFocusEmbedId, "first");
        check.equal(operations[0].undoOperations[0].context.undoFocusIndex, "1");
        check.match(operations[0].doOperations[0].data as string, /Folded child/);
        await target.view.options.onAdd(itemID, "child");
        const addedID = target.view.getSelectedId();
        check.notEqual(addedID, itemID);
        check.equal(target.activeEditor, undefined, "new nodes remain selected without mounting an editor");
        check.equal(editorOptions, undefined);
        check.equal(document.activeElement, target.host.querySelector(".mindmap-view__selection-input"),
            "new nodes prepare an editable target for the first IME keystroke");
        check.match(copies[1].textContent, /Added/);
        // Direct typing opens the new node's editor and preserves the embedded source identity.
        target.host.dispatchEvent(new KeyboardEvent("keydown", {key: "x", bubbles: true, cancelable: true}));
        await new Promise(resolve => setTimeout(resolve, 0));
        check.ok(editorOptions, "typing opens the newly selected node editor");
        check.equal(editorOptions.node.id, addedID);
        check.equal(editorOptions.replaceFirstParagraph, "x");
        check.equal(editorOptions.rootID, "source-document");
        await target.finish();
        check.equal(target.activeEditor, undefined, "finishing text input releases the node editor");
        await target.undo(false);
        check.doesNotMatch(copies[0].textContent, /Added/);
        await target.undo(true);
        check.match(copies[0].textContent, /Added/);
        check.deepEqual(historyRoots, ["source-document", "source-document"]);
        // An explicitly created sibling can be deleted immediately, without Esc.
        editorOptions = undefined;
        await target.view.options.onAdd(itemID, "sibling");
        const siblingID = target.view.getSelectedId();
        check.equal(target.activeEditor, undefined);
        target.host.dispatchEvent(new KeyboardEvent("keydown", {key: "Delete", bubbles: true, cancelable: true}));
        await new Promise(resolve => setTimeout(resolve, 0));
        check.equal(target.model.nodes.has(siblingID), false);
        check.equal(target.view.getSelectedId(), itemID, "canceling a new sibling returns to its creation source instead of the following sibling");
        check.equal(operations.at(-1).doOperations[0].context.undoFocusId, itemID,
            "redo of the deletion also returns to the creation source");
        check.equal(editorOptions, undefined, "deleting a newly selected node never opens an editor");
        check.equal(target.model.nodes.has(addedID), true, "deleting the sibling preserves the previously added child");
        await target.view.options.onAdd(itemID, "child");
        const canceledChildID = target.view.getSelectedId();
        target.host.dispatchEvent(new KeyboardEvent("keydown", {key: "Backspace", bubbles: true, cancelable: true}));
        await new Promise(resolve => setTimeout(resolve, 0));
        check.equal(target.model.nodes.has(canceledChildID), false);
        check.equal(target.view.getSelectedId(), itemID, "canceling a new child returns to the parent even when sibling children remain");
        check.equal(operations.at(-1).doOperations[0].context.undoFocusId, itemID);
        // Entering editing ends the cancellation shortcut, even without changing the text.
        await target.view.options.onAdd(itemID, "sibling");
        const editedID = target.view.getSelectedId();
        target.view.getContentHost(editedID).dispatchEvent(new MouseEvent("dblclick", {bubbles: true, cancelable: true}));
        await new Promise(resolve => setTimeout(resolve, 0));
        check.ok(editorOptions, "double-click opens the newly selected sibling editor");
        check.equal(editorOptions.node.id, editedID);
        check.equal(editorOptions.replaceFirstParagraph, undefined);
        await target.finish();
        target.host.dispatchEvent(new KeyboardEvent("keydown", {key: "Delete", bubbles: true, cancelable: true}));
        await new Promise(resolve => setTimeout(resolve, 0));
        check.equal(target.view.getSelectedId(), followingID, "after entering editing, deletion keeps the normal next-sibling policy");
        check.equal(operations.at(-1).doOperations[0].context.undoFocusId, followingID);
        // 创建副本快捷键在节点选择态新增同级节点，空白画布仍交给外层块快捷键处理。
        let outerDuplicates = 0;
        const duplicate = (key: string, init: KeyboardEventInit = {}) => {
            const event = new KeyboardEvent("keydown", {key, ctrlKey: true, bubbles: true, cancelable: true, ...init});
            target.host.dispatchEvent(event);
            return event;
        };
        const receiveDuplicate = () => outerDuplicates++;
        root.addEventListener("keydown", receiveDuplicate);
        for (const key of ["d", "p"]) {
            window.siyuan.config.keymap.editor.general.duplicate = {default: "⌘D", custom: "⌘" + key.toUpperCase()};
            for (const modifier of [{ctrlKey: true}, {ctrlKey: false, metaKey: true}]) {
                target.view.focusNode(itemID);
                const count = operations.length;
                const beforeChildren = target.model.nodes.get(itemID).children.length;
                check.equal(duplicate(key, modifier).defaultPrevented, true);
                await new Promise(resolve => setTimeout(resolve, 0));
                const created = target.model.nodes.get(target.view.getSelectedId());
                check.notEqual(created.id, itemID);
                check.equal(created.parentId, target.model.nodes.get(itemID).parentId);
                check.equal(created.element.previousElementSibling.dataset.nodeId, itemID);
                check.equal(created.children.length, 0, "node insertion does not duplicate the source branch");
                check.equal(target.model.nodes.get(itemID).children.length, beforeChildren);
                check.equal(operations.length, count + 1, "insertion uses one undoable transaction");
                check.equal(outerDuplicates, 0, "selected-node shortcuts never reach whole-map duplication");
                check.equal(operations.at(-1).undoOperations[0].context.undoFocusId, itemID);
                check.equal(operations.at(-1).doOperations[0].context.undoFocusId, created.id);
                await target.undo(false);
                check.equal(target.model.nodes.has(created.id), false);
                await target.undo(true);
                check.equal(target.model.nodes.has(created.id), true);
            }
        }
        target.view.focusNode(itemID);
        const count = operations.length;
        check.equal(duplicate("p", {repeat: true}).defaultPrevented, true);
        await new Promise(resolve => setTimeout(resolve, 0));
        check.equal(operations.length, count, "holding the shortcut does not insert repeatedly");
        target.view.clearSelection();
        check.equal(duplicate("p").defaultPrevented, false);
        check.equal(outerDuplicates, 1, "a canvas with no selected node keeps whole-map duplication");
        target.view.focusNode(target.model.root.id);
        check.equal(duplicate("p").defaultPrevented, true);
        check.equal(outerDuplicates, 1, "the virtual root cannot fall back to whole-map duplication");
        target.view.focusNode(itemID);
        target.view.setEditing(itemID);
        check.equal(duplicate("p").defaultPrevented, false, "text editing keeps its own shortcut routing");
        target.view.setEditing();
        target.view.setReadOnly(true);
        duplicate("p");
        check.equal(operations.length, count, "read-only maps cannot insert nodes");
        target.view.setReadOnly(false);
        root.removeEventListener("keydown", receiveDuplicate);
        delete window.siyuan.config.keymap.editor.general.duplicate;
        controllers.forEach(controller => controller.destroy());
        root.remove();
    }
    const holder = document.createElement("div");
    const reset = (markdown: string) => {
        holder.innerHTML = lute.Md2BlockDOM(markdown);
        return holder.firstElementChild as HTMLElement;
    };
    const ids = (list: HTMLElement) => Array.from(list.querySelectorAll("[data-node-id]")).map(element =>
        element.getAttribute("data-node-id"));

    // 虚拟根直属节点的首段复用列表输入链路，输入和保存均保留正文、块身份及光标。
    const inputTransactions: {forward: IOperation[], backward: IOperation[]}[] = [];
    const inputAPI = new Function("Constants", "dayjs", "transaction", "hideElements", "mathRender", "highlightRender",
        "normalizeInlineFontFamilyStyle", "getBlockquoteContext", "revealTabsForTarget",
        "updateTransaction", "isMac", "isOnlyMeta", "isNotCtrl", "isMobile", inputSource +
        "; return {input, configureListItemInput, listShortcut, ListHint};")(
        {ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing", KEYCODELIST: {76: "L", 74: "J"}}, () => ({format: () => "20260922120000"}),
        (_protyle: IProtyle, forward: IOperation[], backward: IOperation[]) => inputTransactions.push({forward, backward}),
        () => {}, () => {}, () => {}, (value: string) => value, (): undefined => undefined, () => {},
        (_protyle: IProtyle, block: HTMLElement, before: string) => {
            inputTransactions.push({forward: [{action: "update", id: block.dataset.nodeId, data: block.outerHTML}],
                backward: [{action: "update", id: block.dataset.nodeId, data: before}]});
        }, () => false, (event: KeyboardEvent) => event.ctrlKey && !event.metaKey,
        (event: KeyboardEvent) => !event.ctrlKey && !event.metaKey, () => false);
    window.siyuan = {config: {editor: {markdown: {}}, keymap: {editor: {insert: {
        list: {custom: "⌘J"}, "ordered-list": {custom: "⇧⌘J"}, check: {custom: "⌘L"}, quote: {custom: ""},
    }}}}, storage: {}} as unknown as typeof window.siyuan;
    document.body.append(holder);
    const inputHost = document.createElement("div");
    inputHost.className = "protyle-wysiwyg";
    inputHost.contentEditable = "true";
    document.body.append(inputHost);
    const inputProtyle = {lute, wysiwyg: {element: inputHost, lastHTMLs: {}},
        hint: {render: () => {}}, toolbar: {}, block: {parentID: "document"},
        options: {typewriterMode: false}} as unknown as IProtyle;
    const caretOffset = (element: Element) => {
        const selection = getSelection();
        check.ok(selection.isCollapsed);
        check.ok(element.contains(selection.anchorNode));
        const range = document.createRange();
        range.selectNodeContents(element);
        range.setEnd(selection.anchorNode, selection.anchorOffset);
        return range.toString().length;
    };
    const typeAtCaret = async (value: string) => {
        const range = getSelection().getRangeAt(0);
        const block = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element :
            range.startContainer.parentElement).closest<HTMLElement>('[data-type="NodeParagraph"]');
        inputProtyle.wysiwyg.lastHTMLs[block.dataset.nodeId] = block.outerHTML;
        const text = document.createTextNode(value);
        range.insertNode(text);
        range.setStartAfter(text);
        range.collapse(true);
        await inputAPI.input(inputProtyle, block, range, true,
            new InputEvent("input", {inputType: "insertText", data: value}));
    };
    for (const body of ["", "Text **bold** and *italic*"]) {
        const list = reset("- " + (body || "Empty") + "\n- Sibling\n");
        const model = api.readListMindmap(list);
        const node = model.root.children[0];
        inputHost.innerHTML = node.contentBlocks.map((block: HTMLElement) => block.outerHTML).join("");
        inputAPI.configureListItemInput(inputProtyle);
        const blockID = node.contentBlocks[0].dataset.nodeId;
        const content = inputHost.firstElementChild.firstElementChild;
        if (!body) {
            content.textContent = "";
        }
        const before = content.innerHTML;
        const sourceIDs = ids(list);
        inputHost.focus();
        getSelection().setBaseAndExtent(content, 0, content, 0);
        inputTransactions.length = 0;
        await typeAtCaret("*");
        check.equal(inputHost.firstElementChild.getAttribute("data-type"), "NodeParagraph");
        check.equal(caretOffset(inputHost.firstElementChild.firstElementChild), 1);
        await typeAtCaret(" ");
        const paragraph = inputHost.firstElementChild;
        check.equal(paragraph.getAttribute("data-node-id"), blockID);
        check.equal(paragraph.firstElementChild.innerHTML, before);
        check.equal(caretOffset(paragraph.firstElementChild), 0);
        check.equal(inputHost.querySelector('[data-type="NodeList"]'), null);
        check.ok(inputTransactions.every(item => item.forward.every(operation => operation.action === "update")));
        const undoData = inputTransactions.at(-1).backward[0].data;
        check.ok(typeof undoData === "string" && undoData.includes("*"), "undo retains the typed marker");
        api.replaceListMindmapContent(list, node.id, inputHost.innerHTML);
        check.deepEqual(ids(list), sourceIDs);
        check.equal(api.readListMindmap(list).nodes.size, model.nodes.size);
        await typeAtCaret("x");
        check.equal(caretOffset(paragraph.firstElementChild), 1);
        check.ok(paragraph.firstElementChild.textContent.startsWith("x"));
    }
    // 真实根节点和下级节点的首段使用相同规则，后续段落仍可生成子列表。
    for (const [markdown, nodeIndex, paragraphIndex] of [
        ["- Single root\n", 0, 0],
        ["- Parent\n  - Nested\n- Sibling\n", 2, 0],
        ["- First\n\n  Second\n- Sibling\n", 0, 1],
    ] as const) {
        const model = api.readListMindmap(reset(markdown));
        const node = [...model.nodes.values()].filter((item: ListMindmapNode) => !item.virtual)[nodeIndex];
        inputHost.innerHTML = node.contentBlocks.map((block: HTMLElement) => block.outerHTML).join("");
        inputAPI.configureListItemInput(inputProtyle);
        const content = inputHost.children[paragraphIndex].firstElementChild;
        inputHost.focus();
        getSelection().setBaseAndExtent(content, 0, content, 0);
        await typeAtCaret("* ");
        if (paragraphIndex === 0) {
            check.equal(inputHost.querySelector(".list"), null);
        } else {
            check.ok(inputHost.children[paragraphIndex].classList.contains("list"), markdown);
        }
    }
    const checkListStructure = (list: HTMLElement) => {
        list.querySelectorAll<HTMLElement>('[data-type="NodeListItem"]').forEach(item => {
            check.equal(item.querySelector(":scope > [data-node-id]")?.getAttribute("data-type"), "NodeParagraph");
        });
    };
    // 每层节点都移除首段的列表标记，保存后仍以段落开头，正文、子树及块身份保持不变。
    for (const markdown of [
        "- Text &lt;tag&gt; &amp; **bold**\n\n  Second\n",
        "- Text **bold**\n\n  Second\n- Other\n",
        "- Parent\n  - Text **bold**\n\n    Second\n    - Descendant\n- Other\n",
    ]) {
        const list = reset(markdown);
        const model = api.readListMindmap(list);
        const node = [...model.nodes.values()].find((item: ListMindmapNode) =>
            item.contentBlocks[0]?.textContent.startsWith("Text"));
        const sourceIDs = ids(list);
        inputAPI.configureListItemInput(inputProtyle);
        for (const marker of ["* ", "- ", "+ ", "1. ", "2) ", "[]", "[x]"]) {
            inputHost.innerHTML = node.contentBlocks.map((block: HTMLElement) => block.outerHTML).join("");
            const content = inputHost.firstElementChild.firstElementChild;
            const before = content.innerHTML;
            inputHost.focus();
            getSelection().setBaseAndExtent(content, 0, content, 0);
            await typeAtCaret(marker);
            check.equal(content.innerHTML, before, marker);
            check.equal(caretOffset(content), 0);
            check.equal(inputHost.querySelector('[data-type="NodeList"]'), null);
            check.equal(api.replaceListMindmapContent(list, node.id, inputHost.innerHTML), true);
            check.deepEqual(ids(list), sourceIDs);
            check.equal(node.element.dataset.subtype, "u");
            checkListStructure(list);
            const saved = document.createElement("div");
            saved.innerHTML = lute.SpinBlockDOM(list.outerHTML);
            check.equal(saved.childElementCount, 1);
            check.deepEqual(ids(saved.firstElementChild as HTMLElement), sourceIDs);
            checkListStructure(saved);
        }
        // 列表快捷键和残留的斜杠菜单命令在所有段落都保持文本及选区。
        inputHost.innerHTML = node.contentBlocks.map((block: HTMLElement) => block.outerHTML).join("");
        const before = inputHost.innerHTML;
        for (const block of Array.from(inputHost.children)) {
            const content = block.firstElementChild;
            inputHost.focus();
            getSelection().setBaseAndExtent(content.firstChild, 0, content.firstChild, 2);
            const selected = getSelection().toString();
            for (const subtype of ["u", "o", "t"]) {
                const event = new KeyboardEvent("keydown", {key: subtype === "t" ? "l" : "j",
                    keyCode: subtype === "t" ? 76 : 74, ctrlKey: true, shiftKey: subtype === "o", cancelable: true});
                inputAPI.listShortcut(inputProtyle, block, event);
                check.ok(event.defaultPrevented);
                const hint = new inputAPI.ListHint();
                hint.splitChar = "/";
                hint.lastIndex = 0;
                inputProtyle.toolbar.range = getSelection().getRangeAt(0);
                hint.fill((subtype === "o" ? "1. " : subtype === "t" ? "- [ ] " : "- ") + Lute.Caret, inputProtyle, false);
                check.equal(getSelection().toString(), selected);
                check.equal(inputHost.innerHTML, before);
            }
        }
    }
    inputHost.remove();

    // mindmap 与其他语言一样生成可直接编辑的代码块，编辑重排时不会恢复图表节点。
    const legacySource = "- **Root**\n  - [X] Done\n  - [/] Progress\n";
    const legacyBlock = reset("```mindmap\n" + legacySource + "```\n");
    const legacyID = legacyBlock.dataset.nodeId;
    document.body.append(holder);
    check.ok(legacyBlock.classList.contains("code-block"));
    check.equal(legacyBlock.querySelector(".mindmap-view__node"), null);
    check.equal(legacyBlock.dataset.nodeId, legacyID);
    check.equal(legacyBlock.dataset.type, "NodeCodeBlock");
    const legacySaved = api.cleanListMindmapHTML(legacyBlock.outerHTML);
    check.ok(!legacySaved.includes("mindmap-view__node"));
    check.ok(lute.BlockDOM2StdMd(legacySaved).includes(legacySource.trim()));
    const invalidBlock = reset("```mindmap\n- List\n\nOutside text\n```\n");
    const invalidSource = "- List\n\nOutside text\n";
    const invalidID = invalidBlock.dataset.nodeId;
    invalidBlock.setAttribute("custom-test", "preserved");
    check.equal(invalidBlock.querySelector(".hljs > [contenteditable=true]").textContent, invalidSource);
    check.equal(invalidBlock.dataset.type, "NodeCodeBlock");
    check.equal(invalidBlock.dataset.nodeId, invalidID);
    check.equal(invalidBlock.getAttribute("custom-test"), "preserved");
    check.equal(invalidBlock.classList.contains("render-node"), false);
    check.equal(invalidBlock.classList.contains("code-block"), true);
    check.equal(invalidBlock.hasAttribute("data-subtype"), false);
    check.equal(invalidBlock.hasAttribute("data-content"), false);
    check.equal(invalidBlock.querySelector(".protyle-action__language").textContent, "mindmap");
    check.equal(invalidBlock.querySelectorAll("[data-node-id]").length, 0);
    check.ok(invalidBlock.querySelector(".protyle-action__copy"));
    check.ok(invalidBlock.querySelector(".protyle-action__menu"));
    check.ok(lute.BlockDOM2StdMd(invalidBlock.outerHTML).includes("```mindmap"));
    invalidBlock.querySelector(".hljs > [contenteditable=true]").textContent = "- Now a valid list";
    holder.innerHTML = lute.SpinBlockDOM(invalidBlock.outerHTML);
    // 断言原始 SpinBlockDOM 的返回值，不能由渲染后的修补掩盖解析错误。
    check.ok(holder.firstElementChild.classList.contains("code-block"));
    check.equal(holder.querySelector(".mindmap-view"), null);
    check.equal(holder.querySelector(".hljs > [contenteditable=true]").textContent, "- Now a valid list\n");
    const rawCode = holder.firstElementChild as HTMLElement;
    const edit = rawCode.querySelector(".hljs > [contenteditable=true]");
    edit.innerHTML = "1<wbr>2\n  &amp;lt;script&amp;gt;\n";
    holder.innerHTML = lute.SpinBlockDOM(rawCode.outerHTML);
    check.ok(holder.firstElementChild.classList.contains("code-block"));
    check.equal(holder.querySelector(".render-node"), null);
    check.ok(holder.querySelector(".hljs wbr"));
    const oldDOM = document.createElement("div");
    oldDOM.className = "render-node";
    oldDOM.dataset.type = "NodeCodeBlock";
    oldDOM.dataset.nodeId = legacyID;
    oldDOM.dataset.subtype = "mindmap";
    oldDOM.dataset.content = Lute.EscapeHTMLStr(invalidSource);
    oldDOM.innerHTML = '<div spin="1"></div><div class="protyle-attr" contenteditable="false"></div>';
    api.normalizeLegacyMindmapCodes(oldDOM);
    check.ok(oldDOM.classList.contains("code-block"));
    check.equal(oldDOM.hasAttribute("data-subtype"), false);
    check.equal(oldDOM.querySelector(".protyle-action__language").textContent, "mindmap");
    const newMindmap = reset(`- ${Lute.Caret}\n{: custom-sy-list-mindmap="1"}`);
    check.equal(newMindmap.dataset.type, "NodeList");
    check.equal(newMindmap.getAttribute("custom-sy-list-mindmap"), "1");
    const creationSource = `- ${Lute.Caret}`;
    const preferenceKey = api.LIST_MINDMAP_DEFAULT_CONNECTOR_STYLE_KEY;
    lute.SetTabs(true);
    for (const style of ["spline", "orthogonal", "bezier", "rounded"]) {
        window.siyuan.storage[preferenceKey] = style;
        holder.innerHTML = api.spinListMindmapDOM(lute, creationSource);
        const created = holder.firstElementChild as HTMLElement;
        check.equal(api.readListMindmap(created).metadata.connectorStyle, style);
        const saved = lute.SpinBlockDOM(created.outerHTML);
        window.siyuan.storage[preferenceKey] = "orthogonal";
        holder.innerHTML = saved;
        check.equal(api.readListMindmap(holder.firstElementChild).metadata.connectorStyle, style,
            "saved maps keep their creation snapshot after the preference changes");
        const tabs = api.convertTabsList(reset("* First\n* Second\n"), "List2Tabs", lute);
        window.siyuan.storage[preferenceKey] = style;
        const converted = api.convertTabsList(tabs, "Tabs2Mindmap", lute);
        check.equal(api.readListMindmap(converted).metadata.connectorStyle, style, "first tab conversion uses the preference");
        window.siyuan.storage[preferenceKey] = "rounded";
        const tabRoundTrip = api.convertTabsList(api.listMindmapConversionSource(converted), "List2Tabs", lute);
        check.equal(api.readListMindmap(api.convertTabsList(tabRoundTrip, "Tabs2Mindmap", lute)).metadata.connectorStyle,
            style, "tab round trips retain the stored style");
    }
    window.siyuan.storage[preferenceKey] = "rounded";
    for (const legacy of [false, true]) {
        const old = reset("* Old\n");
        if (legacy) { old.setAttribute("custom-sy-list-mindmap", "1"); }
        else { api.retagMindmapBranch(old, true); }
        check.equal(api.readListMindmap(old).metadata.connectorStyle, undefined,
            "opening legacy maps cannot apply the local default");
        const listAgain = api.listMindmapConversionSource(old);
        api.initializeListMindmapConnectorStyle(listAgain, "rounded");
        check.equal(api.readListMindmap(listAgain).metadata.connectorStyle, "bezier",
            "old maps without metadata retain the fixed legacy style after leaving and returning");
    }
    delete window.siyuan.storage[preferenceKey];
    const paragraph = reset("Empty\n");
    const paragraphID = paragraph.dataset.nodeId;
    paragraph.querySelector('[contenteditable="true"]').textContent = creationSource;
    for (const input of [creationSource, paragraph.outerHTML]) {
        holder.innerHTML = api.spinListMindmapDOM(lute, input);
        check.equal(holder.childElementCount, 1);
        check.equal(holder.firstElementChild.getAttribute("data-type"), "NodeMindmap");
        check.equal(holder.firstElementChild.querySelector("[data-type=\"NodeMindmapItem\"]") !== null, true);
        check.equal(holder.firstElementChild.getAttribute("custom-sy-list-mindmap"), null);
        if (input === paragraph.outerHTML) {
            check.equal(holder.firstElementChild.getAttribute("data-node-id"), paragraphID);
        }
        const createdModel = api.readListMindmap(holder.firstElementChild);
        check.equal(createdModel.nodes.size, 1);
        const saved = lute.SpinBlockDOM(holder.innerHTML);
        holder.innerHTML = saved;
        check.equal(holder.childElementCount, 1);
        check.equal(holder.firstElementChild.getAttribute("data-type"), "NodeMindmap");
    }
    const typedMindmap = holder.firstElementChild as HTMLElement;
    const typedRootItem = typedMindmap.querySelector<HTMLElement>('[data-type="NodeMindmapItem"]');
    check.ok(api.replaceListMindmapContent(typedMindmap, typedRootItem.dataset.nodeId,
        lute.Md2BlockDOM("- Child")));
    check.equal(typedRootItem.querySelector(':scope > [data-type="NodeList"]'), null);
    check.ok(typedRootItem.querySelector(':scope > [data-type="NodeMindmap"] > [data-type="NodeMindmapItem"]'));
    check.equal(api.readListMindmap(typedMindmap).root.children.length, 1);
    const layered = document.createElement("div");
    layered.innerHTML = '<div data-type="NodeList" class="list"><div data-type="NodeListItem" class="li">' +
        '<div data-type="NodeSuperBlock"><div data-type="NodeList" class="list"></div></div>' +
        '<div data-type="NodeList" class="list"><div data-type="NodeListItem" class="li"></div></div></div></div>';
    api.retagMindmapBranch(layered.firstElementChild, true);
    check.equal(layered.querySelector('[data-type="NodeSuperBlock"] > [data-type="NodeList"]') !== null, true);
    check.equal(layered.querySelector(':scope > [data-type="NodeMindmap"] > [data-type="NodeMindmapItem"] > [data-type="NodeMindmap"] > [data-type="NodeMindmapItem"]') !== null, true);
    const focusRoot = document.createElement("div");
    focusRoot.className = "protyle-wysiwyg";
    focusRoot.contentEditable = "true";
    focusRoot.innerHTML = api.spinListMindmapDOM(lute, creationSource);
    document.body.append(focusRoot);
    const focusList = focusRoot.firstElementChild as HTMLElement;
    const focusHost = document.createElement("div");
    focusList.append(focusHost);
    let mindmapKeys = 0;
    let documentKeys = 0;
    focusRoot.addEventListener("keydown", () => documentKeys++);
    const focusView = new api.ListMindmapView({host: focusHost, model: api.readListMindmap(focusList),
        onExit: () => {}, onAdd: () => mindmapKeys++});
    const sourceRange = document.createRange();
    sourceRange.selectNodeContents(focusList.querySelector('[contenteditable="true"]'));
    sourceRange.collapse(true);
    focusRoot.focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(sourceRange);
    check.ok(api.focusListMindmap(focusList, focusHost));
    // 隐藏窗口在尚未接收原生指针事件时只更新 activeElement，补发焦点事件验证选区交接。
    focusHost.dispatchEvent(new FocusEvent("focus"));
    await new Promise(resolve => setTimeout(resolve, 0));
    check.equal(document.activeElement, focusHost.querySelector(".mindmap-view__selection-input"),
        "creating a mindmap retains the editable input focus while moving the source selection");
    check.ok(focusHost.contains(window.getSelection().anchorNode));
    focusHost.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
    check.equal(mindmapKeys, 1);
    check.equal(documentKeys, 0, "new mindmap keys never reach the hidden source list");
    // 普通、只读和锁定脑图均透传未处理的应用快捷键，脑图自身操作仍保持隔离。
    const shortcutEvents: KeyboardEvent[] = [];
    const receiveShortcut = (event: KeyboardEvent) => shortcutEvents.push(event);
    window.addEventListener("keydown", receiveShortcut);
    for (const mode of ["editable", "readonly", "locked"]) {
        focusView.setReadOnly(mode === "readonly");
        const focusModel = api.readListMindmap(focusList);
        focusModel.metadata.viewLocked = mode === "locked";
        focusView.update(focusModel);
        for (const key of ["p", "f", "e"]) {
            for (const modifiers of [{ctrlKey: true}, {metaKey: true}]) {
                const event = new KeyboardEvent("keydown", {key, ...modifiers, bubbles: true, cancelable: true});
                const before = shortcutEvents.length;
                focusHost.dispatchEvent(event);
                check.equal(shortcutEvents.length, before + 1, `${mode}: ${key} reaches application shortcuts`);
                check.equal(shortcutEvents[before], event, "the original keyboard event is preserved");
                check.equal(event.defaultPrevented, false);
            }
        }
        const composing = new KeyboardEvent("keydown", {key: "p", ctrlKey: true, isComposing: true, bubbles: true});
        const before = shortcutEvents.length;
        focusHost.dispatchEvent(composing);
        check.equal(shortcutEvents.length, before, "composition stays inside the mindmap");
    }
    focusView.update(api.readListMindmap(focusList));
    focusView.setReadOnly(false);
    focusView.selectNode(focusList.querySelector<HTMLElement>('[data-type="NodeMindmapItem"]').dataset.nodeId);
    const beforeLocalKey = shortcutEvents.length;
    focusHost.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
    check.equal(shortcutEvents.length, beforeLocalKey, "mindmap node insertion remains local");
    window.removeEventListener("keydown", receiveShortcut);
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    elsewhere.focus();
    check.equal(api.focusListMindmap(focusList, focusHost), undefined);
    check.equal(document.activeElement, elsewhere, "mounting does not steal focus from another input");
    focusView.destroy();
    focusRoot.remove();
    elsewhere.remove();
    const canonical = [{id: legacyID, dom: newMindmap.outerHTML}];
    const embedded = `<div data-type="NodeBlockQueryEmbed">${legacySaved}</div>`;
    holder.innerHTML = api.replaceLegacyMindmapHTML(legacySaved + embedded, canonical);
    check.equal(holder.firstElementChild.getAttribute("data-type"), "NodeList");
    check.ok(holder.querySelector('[data-type="NodeBlockQueryEmbed"] .code-block'));
    const oldList = '<div data-type="NodeList" data-node-id="old-list" custom-sy-list-mindmap="1"></div>';
    holder.innerHTML = api.replaceLegacyMindmapHTML(oldList + `<div data-type="NodeBlockQueryEmbed">${oldList}</div>`,
        [{id: "old-list", dom: '<div data-type="NodeMindmap" data-node-id="old-list"></div>'}]);
    check.equal(holder.firstElementChild.getAttribute("data-type"), "NodeMindmap");
    check.equal(holder.querySelector('[data-type="NodeBlockQueryEmbed"] > [data-type="NodeList"]') !== null, true);
    holder.remove();

    // 直属子列表形成分支，其他正文中的嵌套列表属于正文，读取不会重建或移动任何原始块。
    let list = reset("* Parent\n\n  Second paragraph\n\n  * Child\n    * Grandchild\n\n* Sibling\n");
    let model = api.readListMindmap(list);
    check.equal(model.root.virtual, true);
    check.equal(model.root.id, list.dataset.nodeId);
    check.equal(model.root.children.length, 2);
    const parent = model.root.children[0];
    check.equal(parent.contentBlocks.length, 2);
    check.equal(parent.children.length, 1);
    check.equal(parent.children[0].children.length, 1);
    const beforeRead = list.outerHTML;
    check.equal(api.readListMindmap(list).nodes.get(parent.id).element, parent.element);
    check.equal(list.outerHTML, beforeRead);
    check.throws(() => api.readListMindmap(parent.element), /requires a container block/);

    // 移动子树保持正文对象、块 ID、引用和自定义属性，并拒绝循环及跨树目标。
    parent.contentBlocks[0].setAttribute("custom-preserve", "value");
    const source = parent.children[0];
    const sibling = model.root.children[1];
    const sourceHTML = source.element.outerHTML;
    const previousChildListId = source.element.parentElement.dataset.nodeId;
    const allIds = ids(list);
    check.equal(api.moveListMindmapNode(list, parent.id, source.id, "child"), false);
    check.equal(api.moveListMindmapNode(list, source.id, "not-in-this-tree", "child"), false);
    check.equal(api.moveListMindmapNode(list, source.id, sibling.id, "child", () => Lute.NewNodeID()), true);
    model = api.readListMindmap(list);
    check.equal(model.nodes.get(sibling.id).children[0].element, source.element);
    check.equal(source.element.outerHTML, sourceHTML);
    check.equal(parent.contentBlocks[0].getAttribute("custom-preserve"), "value");
    check.equal(parent.element.querySelector(':scope > [data-type="NodeList"]'), null);
    check.deepEqual(ids(list).filter(id => id !== source.element.parentElement.dataset.nodeId).sort(),
        allIds.filter(id => id !== previousChildListId).sort());

    // 有序列表移动首项时保留原起始编号，目标列表同时重新编号。
    list = reset("0. First\n1. Second\n2. Third\n");
    model = api.readListMindmap(list);
    const [first, second, third] = model.root.children;
    check.equal(api.moveListMindmapNode(list, first.id, third.id, "after"), true);
    check.deepEqual(Array.from(list.querySelectorAll(':scope > [data-type="NodeListItem"]')).map((item: Element) =>
        item.getAttribute("data-marker")), ["0.", "1.", "2."]);
    check.equal(api.readListMindmap(list).root.children[2].id, first.id);
    check.equal(api.moveListMindmapNode(list, third.id, second.id, "child", () => Lute.NewNodeID()), true);
    check.equal(third.element.getAttribute("data-marker"), "1.");
    check.equal(third.element.parentElement.getAttribute("data-subtype"), "o");
    check.deepEqual(Array.from(list.querySelectorAll(':scope > [data-type="NodeListItem"]')).map((item: Element) =>
        item.getAttribute("data-marker")), ["0.", "1."]);

    // 删除节点同步清理已删除子树的关系线和样式，其他关系及最后一个实际节点保留。
    list.setAttribute("custom-sy-list-mindmap-data", JSON.stringify({version: 1,
        nodes: {[second.id]: {bold: true}, [third.id]: {textColor: "red"}, [first.id]: {italic: true}},
        relations: [{id: "r1", from: second.id, to: first.id, label: "remove"},
            {id: "r2", from: third.id, to: first.id, label: "remove child"},
            {id: "r3", from: first.id, to: list.dataset.nodeId, label: "retain"}]}));
    check.equal(api.deleteListMindmapNode(list, second.id), true);
    model = api.readListMindmap(list);
    check.equal(model.root.id, first.id);
    check.equal(model.root.virtual, false);
    check.equal(model.metadata.nodes[third.id], undefined);
    check.deepEqual(model.metadata.nodes[first.id], {italic: true});
    check.deepEqual(model.metadata.relations.map((relation: {id: string}) => relation.id), ["r3"]);
    check.equal(api.deleteListMindmapNode(list, first.id), false);
    const inserted = reset("* New\n").firstElementChild as HTMLElement;
    check.equal(api.addListMindmapNode(list, first.id, "child", inserted, () => Lute.NewNodeID()), true);
    check.equal(inserted.dataset.subtype, "o");
    check.equal(inserted.dataset.marker, "1.");

    // 未知版本或损坏配置在任何编辑之前报错，原内容保持不变。
    list.setAttribute("custom-sy-list-mindmap-data", '{"version":3,"nodes":{},"relations":[]}');
    const corrupt = list.outerHTML;
    check.throws(() => api.moveListMindmapNode(list, inserted.dataset.nodeId, first.id, "after"), /metadata/);
    check.throws(() => api.deleteListMindmapNode(list, inserted.dataset.nodeId), /metadata/);
    check.equal(list.outerHTML, corrupt);

    // 正文编辑保留所有原块身份、属性和复杂内联内容，并保留穿插子列表的对象及位置。
    list = reset("* Parent\n\n  Second paragraph\n\n  * Child\n\n* Sibling\n");
    model = api.readListMindmap(list);
    const editable = model.root.children[0];
    const originalBlocks: HTMLElement[] = editable.contentBlocks;
    const childList = editable.element.querySelector(':scope > [data-type="NodeList"]');
    const childHTML = childList.outerHTML;
    originalBlocks[0].setAttribute("custom-preserve", "custom");
    originalBlocks[0].setAttribute("name", "named");
    originalBlocks[0].setAttribute("style", "color: red;");
    const rich = originalBlocks[0].querySelector('[contenteditable="true"]');
    rich.innerHTML = '<span data-type="block-ref" data-id="20260916000000-abcdefg" data-subtype="s">Reference</span>' +
        '<span class="img"><img src="assets/image.png" alt="image"></span><span data-type="code">literal</span>';
    const replacement = originalBlocks.map(block => block.cloneNode(true) as HTMLElement);
    replacement[0].removeAttribute("custom-preserve");
    replacement[0].removeAttribute("name");
    replacement[0].removeAttribute("style");
    replacement[1].querySelector('[contenteditable="true"]').textContent = "Updated";
    const extra = document.createElement("div");
    extra.innerHTML = lute.Md2BlockDOM("New paragraph\n");
    const added = extra.firstElementChild as HTMLElement;
    const editHTML = replacement.map(block => block.outerHTML).join("") + added.outerHTML + "<wbr>";
    const activeEditor = document.createElement("div");
    activeEditor.className = "mindmap-view";
    activeEditor.innerHTML = editHTML;
    list.appendChild(activeEditor);
    check.equal(api.replaceListMindmapContent(list, editable.id, editHTML), true);
    activeEditor.remove();
    const edited = api.readListMindmap(list).nodes.get(editable.id);
    check.equal(edited.contentBlocks.length, 3);
    check.equal(edited.contentBlocks[0].dataset.nodeId, originalBlocks[0].dataset.nodeId);
    check.equal(edited.contentBlocks[0].getAttribute("custom-preserve"), "custom");
    check.equal(edited.contentBlocks[0].getAttribute("name"), "named");
    check.equal(edited.contentBlocks[0].getAttribute("style"), "color: red;");
    check.equal(edited.contentBlocks[0].querySelector('[data-type="block-ref"]').getAttribute("data-id"), "20260916000000-abcdefg");
    check.equal(edited.contentBlocks[0].querySelector("img").getAttribute("src"), "assets/image.png");
    check.equal(edited.contentBlocks[0].querySelector('[data-type="code"]').textContent, "literal");
    check.equal(edited.contentBlocks[1].dataset.nodeId, originalBlocks[1].dataset.nodeId);
    check.equal(edited.contentBlocks[2].dataset.nodeId, added.dataset.nodeId);
    check.equal(editable.element.querySelector(':scope > [data-type="NodeList"]'), childList);
    check.equal(childList.outerHTML, childHTML);
    const codeSettingHolder = document.createElement("div");
    codeSettingHolder.innerHTML = lute.Md2BlockDOM("- Parent\n\n  ```js\n  x\n  ```\n");
    const codeSettingList = codeSettingHolder.firstElementChild as HTMLElement;
    const codeSettingNode = api.readListMindmap(codeSettingList).root;
    const codeSettingBlocks: HTMLElement[] = codeSettingNode.contentBlocks.map((block: HTMLElement) =>
        block.cloneNode(true) as HTMLElement);
    const settingCode = codeSettingBlocks.find(block => block.dataset.type === "NodeCodeBlock");
    check.ok(settingCode);
    const codeSettingID = settingCode.dataset.nodeId;
    const oldCodeSettings = codeSettingList.outerHTML;
    const codeSettings = [["linewrap", "false"], ["ligatures", "true"], ["linenumber", "false"],
        ["custom-sy-code-tab-spaces", "2"]];
    for (const [name, value] of codeSettings) {
        settingCode.setAttribute(name, value);
    }
    check.equal(api.replaceListMindmapContent(codeSettingList, codeSettingNode.id,
        codeSettingBlocks.map(block => block.outerHTML).join("")), true);
    const newCodeSettings = codeSettingList.outerHTML;
    for (const html of [newCodeSettings, oldCodeSettings, newCodeSettings]) {
        const roundTrip = document.createElement("div");
        roundTrip.innerHTML = lute.Md2BlockDOM(lute.BlockDOM2Md(html));
        const restoredCode = roundTrip.querySelector(`[data-node-id="${codeSettingID}"]`);
        check.ok(restoredCode, "code settings keep the source block identity");
        for (const [name, value] of codeSettings) {
            check.equal(restoredCode.getAttribute(name), html === oldCodeSettings ? null : value,
                "source snapshots restore code settings through undo and redo");
        }
    }
    settingCode.removeAttribute("custom-sy-code-tab-spaces");
    check.equal(api.replaceListMindmapContent(codeSettingList, codeSettingNode.id,
        codeSettingBlocks.map(block => block.outerHTML).join("")), true);
    const resetCodeSettings = codeSettingList.outerHTML;
    const resetCodeHolder = document.createElement("div");
    resetCodeHolder.innerHTML = lute.Md2BlockDOM(lute.BlockDOM2Md(resetCodeSettings));
    check.equal(resetCodeHolder.querySelector(`[data-node-id="${codeSettingID}"]`)
        .hasAttribute("custom-sy-code-tab-spaces"), false, "default Tab spacing removes the saved override");
    for (const html of [newCodeSettings, resetCodeSettings]) {
        resetCodeHolder.innerHTML = lute.Md2BlockDOM(lute.BlockDOM2Md(html));
        check.equal(resetCodeHolder.querySelector(`[data-node-id="${codeSettingID}"]`)
            .getAttribute("custom-sy-code-tab-spaces"), html === newCodeSettings ? "2" : null);
    }
    const nestedTaskHolder = document.createElement("div");
    lute.SetDataTask(true);
    nestedTaskHolder.innerHTML = lute.Md2BlockDOM("- Node\n\n  > - [ ] Nested task\n");
    const nestedTaskList = nestedTaskHolder.firstElementChild as HTMLElement;
    const nestedTaskModel = api.readListMindmap(nestedTaskList);
    const nestedContent: HTMLElement[] = nestedTaskModel.root.contentBlocks.map((block: HTMLElement) => block.cloneNode(true) as HTMLElement);
    const nestedTask = nestedContent.find((block: HTMLElement) => block.dataset.type === "NodeBlockquote")
        .querySelector<HTMLElement>('.li[data-subtype="t"]');
    nestedTask.setAttribute("data-task", "X");
    nestedTask.classList.add("protyle-task--done");
    nestedTask.querySelector(".protyle-action--task").setAttribute("data-task", "X");
    check.equal(api.replaceListMindmapContent(nestedTaskList, nestedTaskModel.root.id,
        nestedContent.map((block: HTMLElement) => block.outerHTML).join("")), true);
    check.equal(nestedTaskList.querySelector('.li[data-subtype="t"]').getAttribute("data-task"), "X",
        "saving rich content retains its edited nested task marker");
    check.equal(list.querySelector("wbr"), null);
    const beforeRejectedEdit = list.outerHTML;
    check.equal(api.replaceListMindmapContent(list, editable.id, childHTML), false);
    check.equal(api.replaceListMindmapContent(list, editable.id, edited.contentBlocks[0].outerHTML.repeat(2)), false);
    check.equal(api.replaceListMindmapContent(list, editable.id, ""), false);
    check.equal(list.outerHTML, beforeRejectedEdit);
    extra.innerHTML = lute.Md2BlockDOM("* New child\n");
    check.equal(api.replaceListMindmapContent(list, editable.id,
        edited.contentBlocks.map((block: HTMLElement) => block.outerHTML).join("") + extra.innerHTML), true);
    check.equal(api.readListMindmap(list).nodes.get(editable.id).children.length, 2);
    check.equal(childList.outerHTML, childHTML);

    // 图片编辑状态不进入脑图快照，单独的正文片段也要清理，并保留实际图片尺寸和说明。
    const imageSnapshot = document.createElement("div");
    imageSnapshot.innerHTML = lute.Md2BlockDOM('![description](assets/image.png "caption")');
    const snapshotImage = imageSnapshot.querySelector("img");
    snapshotImage.parentElement.className = "protyle-image-container";
    snapshotImage.parentElement.style.width = "180px";
    const cleanImage = api.cleanListMindmapHTML(imageSnapshot.innerHTML);
    snapshotImage.closest(".img").classList.add("img--select", "img--drag");
    snapshotImage.parentElement.classList.add("protyle-image-container--compact");
    snapshotImage.parentElement.insertAdjacentHTML("beforeend", '<span class="protyle-image-resize">' +
        '<span class="protyle-block-resize touch-resize-active" data-resize-axis="both"></span></span>');
    check.equal(api.cleanListMindmapHTML(imageSnapshot.innerHTML), cleanImage);
    for (const state of ["img--select", "img--drag"]) {
        check.equal(api.cleanListMindmapHTML(`<span class="img ${state}"><img src="assets/image.png"></span>`),
            '<span class="img"><img src="assets/image.png"></span>');
    }

    // 渲染和编辑标记不会进入持久化 DOM，列表视图属性及关系线配置仍然保留。
    list.setAttribute("custom-sy-list-mindmap", "1");
    list.setAttribute("data-mindmap-view-rendered", "true");
    list.setAttribute("data-mindmap-view-editing", "true");
    const derived = document.createElement("div");
    derived.className = "mindmap-view";
    derived.innerHTML = '<div class="mindmap-view__editor">Derived editor</div>';
    list.appendChild(derived);
    list.appendChild(document.createComment("mindmap-view"));
    list.appendChild(document.createComment("unrelated mindmap-view comment"));
    const cleaned = api.cleanListMindmapHTML(list.outerHTML);
    // 列表转换只接收源块，脑图工具栏、画布和节点预览不能传给 Lute。
    for (const [markdown, conversions] of [
        ["* Alpha\n* Beta\n", [["OL2UL", "u"], ["UL2OL", "o"], ["UL2TL", "t"]]],
        ["1. Alpha\n2. Beta\n", [["OL2UL", "u"], ["UL2OL", "o"], ["UL2TL", "t"]]],
        ["* [ ] Alpha\n* [x] Beta\n", [["OL2UL", "u"], ["UL2OL", "o"], ["UL2TL", "t"]]],
    ] as [string, [string, string][]][]) {
        const source = document.createElement("div");
        source.innerHTML = lute.Md2BlockDOM(markdown);
        const sourceList = source.firstElementChild;
        sourceList.setAttribute("custom-sy-list-mindmap", "1");
        sourceList.setAttribute("data-mindmap-view-rendered", "true");
        const metadata = JSON.stringify({version: 1, nodes: {}, relations: [], rootTitle: ""});
        sourceList.setAttribute("custom-sy-list-mindmap-data", metadata);
        sourceList.classList.add("protyle-wysiwyg--select");
        sourceList.querySelector('[contenteditable="true"]').insertAdjacentHTML("afterbegin", "<wbr>");
        sourceList.prepend(derived.cloneNode(true));
        for (const [conversion, subtype] of conversions) {
            const converted = document.createElement("div");
            converted.innerHTML = api.convertListMindmapToList(sourceList, conversion, lute);
            const result = converted.firstElementChild;
            check.equal(result.getAttribute("data-subtype"), subtype);
            check.equal(result.getAttribute("data-node-id"), sourceList.getAttribute("data-node-id"));
            check.equal(result.getAttribute("custom-sy-list-mindmap"), null);
            check.equal(sourceList.getAttribute("custom-sy-list-mindmap"), "1", "undo source retains mind map view");
            check.equal(result.getAttribute("custom-sy-list-mindmap-data"), metadata);
            check.equal(result.querySelector(".mindmap-view"), null);
            check.equal(result.hasAttribute("data-mindmap-view-rendered"), false);
            check.equal(result.classList.contains("protyle-wysiwyg--select"), false);
            check.ok(result.querySelector('[data-type="NodeParagraph"] [contenteditable="true"] > wbr'));
            check.ok(sourceList.classList.contains("protyle-wysiwyg--select"));
            check.ok(result.textContent.includes("Alpha") && result.textContent.includes("Beta"));
        }
    }
    const typedSource = document.createElement("div");
    typedSource.innerHTML = lute.Md2BlockDOM("* Alpha\n  * Nested\n* Beta\n");
    const typedList = typedSource.firstElementChild as HTMLElement;
    const typedIDs = ids(typedList);
    const typedMetadata = JSON.stringify({version: 1, nodes: {}, relations: [], rootTitle: ""});
    typedList.setAttribute("custom-sy-list-mindmap-data", typedMetadata);
    api.retagMindmapBranch(typedList, true);
    typedList.classList.add("protyle-wysiwyg--select");
    typedList.querySelector('[contenteditable="true"]').insertAdjacentHTML("afterbegin", "<wbr>");
    typedList.append(derived.cloneNode(true));
    const typedBefore = typedList.outerHTML;
    const normalized = api.listMindmapConversionSource(typedList);
    check.equal(normalized.getAttribute("data-type"), "NodeList");
    check.deepEqual(ids(normalized), typedIDs);
    check.equal(normalized.querySelector(".mindmap-view"), null);
    check.equal(typedList.outerHTML, typedBefore, "preparing a conversion never mutates the undo source");
    for (const [conversion, subtype] of [["OL2UL", "u"], ["UL2OL", "o"], ["UL2TL", "t"]]) {
        const converted = document.createElement("div");
        converted.innerHTML = api.convertListMindmapToList(typedList, conversion, lute);
        const result = converted.firstElementChild as HTMLElement;
        check.equal(result.getAttribute("data-type"), "NodeList");
        check.equal(result.getAttribute("data-subtype"), subtype);
        check.equal(result.querySelector("[data-type=\"NodeMindmapItem\"]"), null);
        check.equal(result.querySelector("[data-type=\"NodeMindmap\"]"), null);
        check.deepEqual(ids(result), typedIDs);
        check.equal(result.getAttribute("custom-sy-list-mindmap-data"), typedMetadata);
        check.equal(result.querySelector(".mindmap-view"), null);
        check.equal(result.classList.contains("protyle-wysiwyg--select"), false);
        check.ok(result.querySelector('[data-type="NodeParagraph"] [contenteditable="true"] > wbr'));
        check.ok(result.textContent.includes("Nested"));
    }
    const paragraphs = document.createElement("div");
    // @ts-expect-error Lute 的类型声明未包含列表取消方法。
    paragraphs.innerHTML = lute.CancelList(normalized.outerHTML);
    check.ok(paragraphs.textContent.includes("Alpha") && paragraphs.textContent.includes("Nested"));
    check.equal(paragraphs.querySelector('[data-type="NodeMindmap"]'), null);
    lute.SetTabs(true);
    const convertedTabs = api.convertTabsList(normalized, "List2Tabs", lute);
    check.equal(convertedTabs.getAttribute("data-type"), "NodeTabs");
    check.equal(convertedTabs.querySelectorAll(':scope > [data-type="NodeTabItem"]').length, 2);
    check.ok(convertedTabs.textContent.includes("Nested"));
    const tabsBefore = convertedTabs.outerHTML;
    const tabsIDs = ids(convertedTabs).filter(id =>
        convertedTabs.querySelector(`[data-node-id="${id}"]`).getAttribute("tabs-placeholder") !== "true");
    const directMindmap = api.convertTabsList(convertedTabs, "Tabs2Mindmap", lute);
    check.equal(directMindmap.getAttribute("data-type"), "NodeMindmap");
    check.equal(directMindmap.getAttribute("data-node-id"), convertedTabs.getAttribute("data-node-id"));
    check.equal(directMindmap.querySelectorAll(':scope > [data-type="NodeMindmapItem"]').length, 2);
    check.ok(directMindmap.querySelector('[data-type="NodeMindmapItem"] [data-type="NodeMindmap"]'));
    check.deepEqual(ids(directMindmap), tabsIDs);
    check.equal(directMindmap.querySelector('[data-type="NodeTabs"], [data-type="NodeTabItem"]'), null);
    check.equal(directMindmap.getAttribute("tabs-active-id"), null);
    check.ok(directMindmap.textContent.includes("Alpha") && directMindmap.textContent.includes("Nested") &&
        directMindmap.textContent.includes("Beta"));
    check.equal(lute.BlockDOM2Md(directMindmap.outerHTML).includes("Nested"), true);
    check.equal(convertedTabs.outerHTML, tabsBefore, "direct conversion preserves the undo source");
    // 空标题与首段正文分别保留，持久化后的往返转换也不能将正文提升为标题。
    for (const title of ["", "**Title**"]) {
        for (const conversion of ["Tabs2Mindmap", "Tabs2UL", "Tabs2OL", "Tabs2TL"] as const) {
            const original = reset(`::: tabs\n@tab ${title}\n\nFirst paragraph\n\nSecond paragraph\n\n:::\n`);
            const originalHTML = original.outerHTML;
            const bodyIDs = ids(original);
            const converted = api.convertTabsList(original, conversion, lute);
            const persisted = document.createElement("div");
            persisted.innerHTML = lute.SpinBlockDOM(converted.outerHTML);
            const restored = api.convertTabsList(api.listMindmapConversionSource(persisted.firstElementChild), "List2Tabs", lute);
            const titleBlock = restored.querySelector('.tab-item-info > [tabs-title="true"]');
            check.equal(titleBlock.textContent.replace(/\u200b/g, ""), title ? "Title" : "", `${conversion} preserves the title`);
            check.equal(!!titleBlock.querySelector('[data-type="strong"]'), !!title);
            const body = restored.querySelector(".tab-item-content") as HTMLElement;
            check.deepEqual(ids(body), bodyIDs.slice(1), `${conversion} preserves body block IDs`);
            check.deepEqual(Array.from(body.querySelectorAll(':scope > [data-type="NodeParagraph"]'))
                .map(block => block.textContent.replace(/\u200b/g, "")), ["First paragraph", "Second paragraph"]);
            check.equal(original.outerHTML, originalHTML, "conversion preserves the undo source");
        }
    }
    check.equal(typedList.outerHTML, typedBefore);
    check.equal(cleaned.includes("Derived editor"), false);
    check.equal(cleaned.includes("data-mindmap-view-rendered"), false);
    check.equal(cleaned.includes("data-mindmap-view-editing"), false);
    check.equal(cleaned.includes("<!--mindmap-view-->"), false);
    check.equal(cleaned.includes("<!--unrelated mindmap-view comment-->"), true);
    check.equal(cleaned.includes('custom-sy-list-mindmap="1"'), true);
    check.ok(list.contains(derived));
    check.equal(api.cleanListMindmapHTML("<div>unrelated</div>"), "<div>unrelated</div>");
    check.ok(lute.BlockDOM2Md(cleaned).includes("New child"));

    // 复制后关系线与节点样式引用新块 ID，遇到任一损坏配置时不进行部分迁移。
    const copiedRoute = {version: 1, points: [{x: -35, y: 20, t: .5}], extension: "keep"};
    list.setAttribute("custom-sy-list-mindmap-data", JSON.stringify({version: 1, extension: "keep",
        nodes: {a: {bold: true}, b: {italic: true}, deleted: {bold: true}},
        relations: [{id: "relation", from: "a", to: "b", label: "keep", route: copiedRoute, arrowDirection: "both"},
            {id: "orphan", from: "a", to: "deleted", label: "remove"}]}));
    const copiedItems = list.querySelectorAll('[data-type="NodeListItem"]');
    copiedItems[0].setAttribute("data-node-id", "new-a");
    copiedItems[1].setAttribute("data-node-id", "new-b");
    const child = list.querySelector('[data-type="NodeList"]');
    child.setAttribute("custom-sy-list-mindmap-data", '{"version":3,"nodes":{},"relations":[]}');
    const beforeRemap = list.outerHTML;
    check.throws(() => api.remapListMindmapIDs(list, new Map([["a", "new-a"], ["b", "new-b"]])), /metadata/);
    check.equal(list.outerHTML, beforeRemap);
    child.removeAttribute("custom-sy-list-mindmap-data");
    api.remapListMindmapIDs(list, new Map([["a", "new-a"], ["b", "new-b"]]));
    const remapped = JSON.parse(list.getAttribute("custom-sy-list-mindmap-data"));
    check.deepEqual(remapped.nodes, {"new-a": {bold: true}, "new-b": {italic: true}});
    check.deepEqual(remapped.relations, [{id: "relation", from: "new-a", to: "new-b", label: "keep",
        route: copiedRoute, arrowDirection: "both"}]);
    check.equal(remapped.extension, "keep");
    check.equal(list.querySelector(".mindmap-view"), null);
    check.equal(list.hasAttribute("data-mindmap-view-rendered"), false);
    check.equal(list.hasAttribute("data-mindmap-view-editing"), false);
    check.equal(list.outerHTML.includes("<!--mindmap-view-->"), false);

    // 使用真实布局和事件验证单击拖拽、双击挂载、撤销入口、只读折叠及全屏还原。
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const hostParent = document.createElement("div");
    hostParent.style.width = "760px";
    const host = document.createElement("div");
    hostParent.append(host);
    document.body.append(hostParent);
    list = reset("* Alpha\n  * Child\n* Beta\n");
    model = api.readListMindmap(list);
    const alpha = model.root.children[0].id;
    const beta = model.root.children[1].id;
    const edits: string[] = [];
    const editTexts: Array<string | undefined> = [];
    const moves: unknown[] = [];
    const additions: unknown[] = [];
    const folds: string[] = [];
    const deletions: string[] = [];
    const relationDeletions: string[] = [];
    const relationAdditions: unknown[] = [];
    const relationChanges: unknown[] = [];
    const nodeStyles: unknown[] = [];
    const fullscreenChanges: boolean[] = [];
    let interactions = 0;
    let settingsOpened = 0;
    const colorSettings: {kind: string, anchor?: HTMLButtonElement}[] = [];
    let overflowExpand: ((level: number | "expandAll" | "foldAll") => void) | undefined;
    let panMenu: {active: boolean, toggle: () => void};
    let finishAllowed: boolean | Promise<boolean> = true;
    const options = {
        host, model,
        labels: new Proxy({}, {get: (_target, key) => String(key)}),
        colors: () => [{label: "Appearance background", value: "var(--b3-font-background1)"}],
        nodeColors: () => [{label: "Appearance combined", color: "var(--b3-font-color1)",
            backgroundColor: "var(--b3-font-background1)", preview: {color: "#112233", backgroundColor: "#ddeeff"}}],
        onManageNodeColors: (anchor: HTMLButtonElement) => colorSettings.push({kind: "node", anchor}),
        onManageLineColors: () => colorSettings.push({kind: "line"}),
        onFullscreen: (enter: boolean) => fullscreenChanges.push(enter),
        onInteractionStart: () => {
            interactions++;
            return () => interactions--;
        },
        onEdit: (id: string, _contentHost: HTMLElement, text?: string) => {
            edits.push(id);
            editTexts.push(text);
        },
        isAddSiblingShortcut: (event: KeyboardEvent) => event.ctrlKey && event.key === "Enter" && !event.shiftKey,
        isAddChildShortcut: (event: KeyboardEvent) => event.ctrlKey && event.key === "Enter" && event.shiftKey,
        finishEdit: () => finishAllowed,
        onMove: (...args: unknown[]) => moves.push(args),
        onAdd: (...args: unknown[]) => additions.push(args),
        onDelete: (id: string) => {
            deletions.push(id);
        },
        onFold: (id: string) => folds.push(id),
        onSettingsMenu: (_anchor: HTMLElement, expand?: typeof overflowExpand, pan?: typeof panMenu) => {
            settingsOpened++;
            overflowExpand = expand;
            panMenu = pan;
        },
        onNodeStyle: (...args: unknown[]) => nodeStyles.push(args),
        onNodesStyle: (...args: unknown[]) => nodeStyles.push(args),
        onNodeWidths: async (widths: {id: string, width: number}[], expected: string) => {
            check.equal(expected, JSON.stringify(widths.map(({id}) => ({id, width: model.metadata.nodes[id]?.width || 0}))));
            widths.forEach(({id, width}) => {
                nodeStyles.push([id, {width}]);
                model.metadata.nodes[id] = {...model.metadata.nodes[id], width};
            });
            view.update(model);
            return true;
        },
        onRelationAdd: (...args: unknown[]) => relationAdditions.push(args),
        onRelationChange: (...args: unknown[]) => relationChanges.push(args),
        onRelationDelete: (id: string) => relationDeletions.push(id),
        onExit: (): void => undefined,
    };
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const settle = async () => { await frame(); await frame(); };
    const settleFold = async (current: {stopFoldAnimation?: () => void}) => {
        await settle();
        const deadline = performance.now() + 1000;
        while (current.stopFoldAnimation && performance.now() < deadline) {
            await frame();
        }
        check.equal(current.stopFoldAnimation, undefined, "fold transitions finish without leaving a pending frame");
    };
    const enableHand = (targetHost: HTMLElement) => {
        targetHost.querySelector<HTMLButtonElement>('[aria-label="more"]').click();
        check.ok(panMenu);
        check.equal(panMenu.active, false);
        panMenu.toggle();
    };

    // 应用菜单位于导图外，按下菜单项会先停用交互，随后才执行菜单的点击动作。
    for (const pointerType of ["mouse", "touch"]) {
        const menuHost = document.createElement("div");
        hostParent.append(menuHost);
        const menuView = new api.ListMindmapView({...options, host: menuHost,
            onSettingsMenu: (_anchor: HTMLElement, _expand: unknown, pan: typeof panMenu) => panMenu = pan});
        const menuItem = document.createElement("button");
        document.body.append(menuItem);
        for (const active of [false, true, false, true]) {
            menuHost.querySelector<HTMLButtonElement>('[aria-label="more"]').click();
            check.equal(panMenu.active, active);
            const toggle = panMenu.toggle;
            menuItem.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType}));
            check.equal(menuHost.classList.contains("mindmap-view--pan"), false);
            toggle();
            check.equal(menuHost.classList.contains("mindmap-view--pan"), !active,
                `${pointerType} menu clicks apply the inverse of the displayed checked state`);
            const hand = menuHost.querySelector<HTMLButtonElement>('[aria-label="cursorHand"]');
            check.equal(hand.getAttribute("aria-pressed"), String(!active));
            check.equal(hand.hidden, active);
        }
        menuItem.remove();
        menuView.destroy();
        menuHost.remove();
    }

    // 方向键选中视口外的节点时自动平移，待完成的布局和只读视图使用同一定位逻辑。
    const navigationHost = document.createElement("div");
    navigationHost.style.width = "400px";
    hostParent.append(navigationHost);
    const navigationView = new api.ListMindmapView({...options, host: navigationHost});
    await settle();
    const navigationViewport = navigationHost.querySelector<HTMLElement>(".mindmap-view__viewport");
    const navigationCases = [
        {key: "ArrowLeft", from: alpha, to: model.root.id, x: -1000, y: 0},
        {key: "ArrowRight", from: alpha, to: model.nodes.get(alpha).children[0].id, x: 1000, y: 0},
        {key: "ArrowUp", from: beta, to: alpha, x: 0, y: -1000},
        {key: "ArrowDown", from: alpha, to: beta, x: 0, y: 1000},
    ];
    for (const readOnly of [false, true]) {
        navigationView.setReadOnly(readOnly);
        for (const item of navigationCases) {
            navigationView.selectNode(item.from);
            const offset = navigationView.boundedPan(item.x, item.y);
            navigationView.offsetX = offset.x;
            navigationView.offsetY = offset.y;
            navigationView.draw();
            const node = navigationHost.querySelector<HTMLElement>(`[data-mindmap-id="${item.to}"]`);
            const viewportRect = navigationViewport.getBoundingClientRect();
            const before = node.getBoundingClientRect();
            check.ok(before.left < viewportRect.left || before.right > viewportRect.right ||
                before.top < viewportRect.top || before.bottom > viewportRect.bottom, "target starts outside the viewport");
            navigationView.refreshLayout();
            navigationHost.focus();
            navigationHost.dispatchEvent(new KeyboardEvent("keydown", {key: item.key, bubbles: true, cancelable: true}));
            await settle();
            const after = node.getBoundingClientRect();
            check.equal(navigationView.getSelectedId(), item.to);
            check.ok(after.left >= viewportRect.left && after.right <= viewportRect.right &&
                after.top >= viewportRect.top && after.bottom <= viewportRect.bottom,
                `${item.key} reveals the target after layout, readOnly=${readOnly}`);
            check.equal(document.activeElement, readOnly ? navigationHost : navigationHost.querySelector(".mindmap-view__selection-input"),
                "navigation prepares the selected node for native text input");
        }
        navigationView.fit();
        navigationView.selectNode(model.root.id);
        const transform = [navigationView.scale, navigationView.offsetX, navigationView.offsetY];
        navigationHost.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
        await settle();
        check.equal(navigationView.getSelectedId(), alpha);
        check.deepEqual([navigationView.scale, navigationView.offsetX, navigationView.offsetY], transform,
            "navigating to a visible node preserves the viewport");
    }
    // 新节点和方向键导航均避开底部菜单，窄画布、缩放及菜单尺寸变化后仍按实际遮挡范围定位。
    const navigationSource = list.cloneNode(true) as HTMLElement;
    const addedSource = document.createElement("div");
    addedSource.innerHTML = lute.Md2BlockDOM("- New node\n");
    const addedItem = addedSource.querySelector<HTMLElement>('[data-type="NodeListItem"]');
    check.ok(api.addListMindmapNode(navigationSource, beta, "after", addedItem));
    navigationView.setReadOnly(false);
    navigationView.update(api.readListMindmap(navigationSource));
    await settle();
    const addedNode = navigationHost.querySelector<HTMLElement>(`[data-mindmap-id="${addedItem.dataset.nodeId}"]`);
    const navigationInspector = navigationHost.querySelector<HTMLElement>(".mindmap-view__inspector");
    const placeUnderInspector = (bounds: DOMRect) => {
        const rect = addedNode.getBoundingClientRect();
        const viewportBounds = navigationViewport.getBoundingClientRect();
        const scaleX = viewportBounds.width / navigationViewport.offsetWidth;
        const scaleY = viewportBounds.height / navigationViewport.offsetHeight;
        navigationView.offsetX += (bounds.left + bounds.width / 2 - rect.left - rect.width / 2) / scaleX;
        navigationView.offsetY += (bounds.top + 8 * scaleY - rect.bottom) / scaleY;
        navigationView.draw();
    };
    for (const width of [400, 240, 300]) {
        const scale = width === 300 ? .5 : 1;
        navigationHost.style.width = `${width}px`;
        navigationHost.style.transform = `scale(${scale})`;
        navigationHost.style.transformOrigin = "top left";
        navigationInspector.style.paddingTop = width === 240 ? "18px" : "4px";
        navigationInspector.style.paddingBottom = navigationInspector.style.paddingTop;
        navigationView.refreshLayout();
        await settle();
        for (const keyboard of [false, true]) {
            navigationView.selectNode(beta);
            const menuBounds = navigationInspector.getBoundingClientRect();
            check.ok(menuBounds.width > 0 && menuBounds.height > 0);
            placeUnderInspector(menuBounds);
            const before = addedNode.getBoundingClientRect();
            check.ok(before.bottom > menuBounds.top && before.top < menuBounds.bottom);
            navigationView.refreshLayout();
            if (keyboard) {
                navigationHost.dispatchEvent(new KeyboardEvent("keydown", {
                    key: "ArrowDown", bubbles: true, cancelable: true,
                }));
            } else {
                navigationView.focusNode(addedItem.dataset.nodeId);
            }
            await settle();
            const after = addedNode.getBoundingClientRect();
            check.equal(navigationView.getSelectedId(), addedItem.dataset.nodeId);
            check.ok(after.bottom <= navigationInspector.getBoundingClientRect().top - 15 * scale,
                `node stays above the menu, width=${width}, keyboard=${keyboard}`);
            check.ok(after.top >= navigationViewport.getBoundingClientRect().top + 15 * scale);
        }
    }
    const visibleMenuBounds = navigationInspector.getBoundingClientRect();
    navigationView.setReadOnly(true);
    await settle();
    placeUnderInspector(visibleMenuBounds);
    const hiddenMenuTransform = [navigationView.offsetX, navigationView.offsetY];
    navigationView.focusNode(addedItem.dataset.nodeId);
    await settle();
    check.deepEqual([navigationView.offsetX, navigationView.offsetY], hiddenMenuTransform,
        "a hidden menu does not reduce the node's visible area");

    // 顶部控件按悬停、焦点和全屏的实际可见状态避让，缩放画布保持相同的局部间距。
    const navigationToolbar = navigationHost.querySelector<HTMLElement>(".mindmap-view__toolbar");
    const navigationFit = () => navigationToolbar.querySelector<HTMLButtonElement>('[aria-label="listMindmapFit"]');
    const navigationControl = () => navigationToolbar.querySelector<HTMLButtonElement>('[aria-label="more"]');
    const moveNavigationPointer = async (inside: boolean) => {
        navigationHost.scrollIntoView({block: "start"});
        const bounds = navigationHost.getBoundingClientRect();
        await require("electron").ipcRenderer.invoke("mindmap-view-native-input", [{
            type: "mouseMove", x: inside ? Math.round(bounds.left + 20) : 2,
            y: inside ? Math.round(bounds.top + 100) : 2,
        }]);
        await settle();
    };
    const placeAtToolbar = (left?: number) => {
        const controlBounds = navigationControl().getBoundingClientRect();
        const viewportBounds = navigationViewport.getBoundingClientRect();
        const rect = addedNode.getBoundingClientRect();
        const scaleX = viewportBounds.width / navigationViewport.offsetWidth;
        const scaleY = viewportBounds.height / navigationViewport.offsetHeight;
        const targetLeft = left ?? Math.min(controlBounds.left, viewportBounds.right - rect.width - 16 * scaleX);
        navigationView.offsetX += (targetLeft - rect.left) / scaleX;
        navigationView.offsetY += (viewportBounds.top + 16 * scaleY - rect.top) / scaleY;
        navigationView.draw();
    };
    for (const mode of ["hover", "focus", "fullscreen"]) {
        for (const width of [760, 400, 300]) {
            const scale = width === 300 ? .5 : 1;
            navigationView.setReadOnly(width !== 400);
            navigationHost.classList.toggle("fullscreen", mode === "fullscreen");
            navigationHost.style.width = `${width}px`;
            navigationHost.style.transform = `scale(${scale})`;
            navigationView.refreshLayout();
            navigationHost.focus();
            await moveNavigationPointer(mode === "hover");
            if (mode === "focus") {
                navigationControl().focus();
            }
            check.equal(getComputedStyle(navigationToolbar).opacity, "1", `${mode} shows the toolbar`);
            placeAtToolbar();
            const before = addedNode.getBoundingClientRect();
            check.ok(before.top < navigationControl().getBoundingClientRect().bottom, "target starts behind a toolbar control");
            navigationView.refreshLayout();
            if (mode === "focus") {
                navigationView.revealNode(addedItem.dataset.nodeId);
            } else {
                navigationView.selectNode(beta);
                navigationHost.dispatchEvent(new KeyboardEvent("keydown", {
                    key: "ArrowDown", bubbles: true, cancelable: true,
                }));
            }
            await settle();
            check.ok(addedNode.getBoundingClientRect().top >= navigationControl().getBoundingClientRect().bottom + 15 * scale,
                `node stays below visible toolbar controls, mode=${mode}, width=${width}`);
        }
    }
    navigationHost.classList.remove("fullscreen");
    navigationHost.style.width = "760px";
    navigationHost.style.transform = "";
    navigationView.refreshLayout();
    navigationHost.focus();
    await moveNavigationPointer(true);
    placeAtToolbar(navigationViewport.getBoundingClientRect().left + 20);
    const toolbarGapTransform = [navigationView.offsetX, navigationView.offsetY];
    check.ok(addedNode.getBoundingClientRect().right < navigationToolbar.querySelector("button").getBoundingClientRect().left);
    navigationView.focusNode(addedItem.dataset.nodeId);
    await settle();
    check.deepEqual([navigationView.offsetX, navigationView.offsetY], toolbarGapTransform,
        "the toolbar's left spacer does not obstruct a node");
    navigationToolbar.querySelector<HTMLElement>(".mindmap-view__zoom").focus();
    await moveNavigationPointer(false);
    const zoomActions = navigationToolbar.querySelector<HTMLElement>(".mindmap-view__zoom-actions");
    const zoomBounds = zoomActions.getBoundingClientRect();
    check.ok(zoomBounds.width > 0 && zoomBounds.height > 0, "focused zoom controls show their popup");
    placeAtToolbar(zoomBounds.left);
    navigationView.revealNode(addedItem.dataset.nodeId);
    await settle();
    check.ok(addedNode.getBoundingClientRect().top >= zoomActions.getBoundingClientRect().bottom + 15,
        "the visible zoom popup also leaves clearance for the node");
    navigationHost.focus();
    navigationHost.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    await moveNavigationPointer(false);
    check.equal(getComputedStyle(navigationToolbar).opacity, "0");
    placeAtToolbar();
    const hiddenToolbarTransform = [navigationView.offsetX, navigationView.offsetY];
    const hiddenToolbarNode = addedNode.getBoundingClientRect();
    const hiddenToolbarViewport = navigationViewport.getBoundingClientRect();
    check.ok(hiddenToolbarNode.left >= hiddenToolbarViewport.left + 15 &&
        hiddenToolbarNode.right <= hiddenToolbarViewport.right - 15 &&
        hiddenToolbarNode.top >= hiddenToolbarViewport.top + 15, "hidden-toolbar target starts within the viewport margins");
    navigationView.revealNode(addedItem.dataset.nodeId);
    await settle();
    check.deepEqual([navigationView.offsetX, navigationView.offsetY], hiddenToolbarTransform,
        "a hidden toolbar does not move a visible node");

    // 实际点击适应画布时不为临时浮层预留空间，全屏仍避让常驻按钮组，重复点击保持稳定。
    const fittingSource = document.createElement("div");
    fittingSource.innerHTML = lute.Md2BlockDOM("* Root\n" +
        Array.from({length: 20}, (_value, index) => `  * Branch ${index}\n`).join(""));
    navigationView.update(api.readListMindmap(fittingSource.firstElementChild as HTMLElement));
    navigationHost.style.height = "420px";
    const activateNavigationFit = async (keyboard: boolean, touch = false) => {
        navigationHost.scrollIntoView({block: "start"});
        const zoom = navigationToolbar.querySelector<HTMLElement>(".mindmap-view__zoom");
        const zoomBounds = zoom.getBoundingClientRect();
        const zoomPoint = {x: Math.round(zoomBounds.left + zoomBounds.width / 2),
            y: Math.round(zoomBounds.top + zoomBounds.height / 2)};
        if (touch) {
            await require("electron").ipcRenderer.invoke("mindmap-view-native-touch", [
                {type: "touchStart", touchPoints: [{...zoomPoint, id: 0}]},
                {type: "touchEnd", touchPoints: []},
            ]);
        } else if (keyboard) {
            zoom.focus();
        } else {
            await require("electron").ipcRenderer.invoke("mindmap-view-native-input", [
                {type: "mouseMove", ...zoomPoint},
            ]);
        }
        await settle();
        check.equal(getComputedStyle(navigationToolbar.querySelector(".mindmap-view__zoom-actions")).display, "flex",
            "hovering, focusing or tapping the percentage opens the zoom panel");
        const bounds = navigationFit().getBoundingClientRect();
        const point = {x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2)};
        check.equal(document.elementFromPoint(point.x, point.y)?.closest("button"), navigationFit(),
            "fit in the zoom panel is visible and reachable");
        if (touch) {
            await require("electron").ipcRenderer.invoke("mindmap-view-native-touch", [
                {type: "touchStart", touchPoints: [{...point, id: 0}]},
                {type: "touchEnd", touchPoints: []},
            ]);
            await settle();
            return;
        }
        if (keyboard) {
            navigationFit().focus();
        }
        await require("electron").ipcRenderer.invoke("mindmap-view-native-input", keyboard ? [
            {type: "keyDown", keyCode: "Return"}, {type: "char", keyCode: "\r"}, {type: "keyUp", keyCode: "Return"},
        ] : [
            {type: "mouseMove", ...point},
            {type: "mouseDown", ...point, button: "left", clickCount: 1},
            {type: "mouseUp", ...point, button: "left", clickCount: 1},
        ]);
        await settle();
    };
    for (const mode of ["hover", "focus", "fullscreen", "touch"]) {
        for (const width of [760, 400, 300]) {
            const outerScale = width === 300 ? .5 : 1;
            navigationView.setReadOnly(width !== 400);
            navigationHost.classList.toggle("fullscreen", mode === "fullscreen");
            navigationHost.style.width = `${width}px`;
            navigationHost.style.transform = `scale(${outerScale})`;
            navigationToolbar.style.paddingTop = width === 400 ? "18px" : "";
            navigationView.refreshLayout();
            navigationHost.focus();
            await moveNavigationPointer(mode === "hover");
            navigationView.scale = 1;
            navigationView.offsetX = 100;
            navigationView.offsetY = -100;
            navigationView.draw();
            await activateNavigationFit(mode === "focus", mode === "touch");
            check.equal(getComputedStyle(navigationToolbar).opacity, "1");
            check.ok(navigationView.scale < 1 && navigationView.scale > .15,
                `the tall map needs an unconstrained fit, mode=${mode}, width=${width}, scale=${navigationView.scale}`);
            const viewportBounds = navigationViewport.getBoundingClientRect();
            const toolbarBottom = Math.max(...navigationView.getToolbarBounds(false).filter((bounds: DOMRect) =>
                bounds.right > viewportBounds.left && bounds.left < viewportBounds.right).map((bounds: DOMRect) => bounds.bottom));
            const fittedContent = navigationView.contentBounds();
            const contentTop = viewportBounds.top + (fittedContent.top * navigationView.scale + navigationView.offsetY) * outerScale;
            const contentBottom = viewportBounds.top + (fittedContent.bottom * navigationView.scale + navigationView.offsetY) * outerScale;
            if (mode === "fullscreen") {
                check.ok(contentTop >= toolbarBottom + 15 * outerScale,
                    `fullscreen fit clears the persistent toolbar, width=${width}`);
            } else {
                check.ok(Math.abs(contentTop - viewportBounds.top - 16 * outerScale) < 1,
                    `document fit ignores triggered toolbars and the zoom popup, mode=${mode}, width=${width}`);
            }
            check.ok(Math.abs(contentBottom - viewportBounds.bottom + 16 * outerScale) < 1,
                "fit uses the bottom area without reserving space for the node menu");
            const fittedTransform = [navigationView.scale, navigationView.offsetX, navigationView.offsetY];
            await activateNavigationFit(mode === "focus", mode === "touch");
            check.deepEqual([navigationView.scale, navigationView.offsetX, navigationView.offsetY], fittedTransform,
                "repeated fit activation preserves scale and centering");
            navigationHost.focus();
            await moveNavigationPointer(false);
            check.equal(getComputedStyle(navigationToolbar.querySelector(".mindmap-view__zoom-actions")).display, "none",
                "the transient zoom popup can close after fitting");
            navigationView.fit();
            check.deepEqual([navigationView.scale, navigationView.offsetX, navigationView.offsetY], fittedTransform,
                "closing the transient popup does not change the fitted view");
            navigationToolbar.querySelector<HTMLButtonElement>('[aria-label="reset"]').click();
            check.equal(navigationView.scale, 1, "reset restores 100% independently of fit to canvas");
        }
    }
    navigationHost.classList.remove("fullscreen");
    navigationHost.style.width = "760px";
    navigationHost.style.transform = "";
    navigationToolbar.style.paddingTop = "";
    navigationHost.focus();
    navigationHost.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    navigationView.refreshLayout();
    await moveNavigationPointer(false);
    check.equal(getComputedStyle(navigationToolbar).opacity, "0");
    navigationView.fit();
    const hiddenFitBounds = navigationView.contentBounds();
    check.ok(Math.abs(hiddenFitBounds.top * navigationView.scale + navigationView.offsetY - 16) < 1,
        "fitting with a hidden toolbar keeps the normal top margin");
    const withoutInspector = [navigationView.scale, navigationView.offsetX, navigationView.offsetY];
    navigationView.setReadOnly(false);
    navigationView.setInteractionActive(true);
    navigationView.selectNode(navigationView.model.root.children[0].id);
    await settle();
    check.equal(navigationInspector.hidden, false, "selecting a node opens the bottom menu");
    check.ok(navigationInspector.getBoundingClientRect().height > 0, "the bottom menu occupies actual screen space");
    navigationView.fit();
    check.deepEqual([navigationView.scale, navigationView.offsetX, navigationView.offsetY], withoutInspector,
        "opening the bottom node menu does not shrink the fitted map");
    navigationView.setInteractionActive(false);
    await settle();
    check.equal(navigationInspector.hidden, true, "leaving interaction mode hides the node menu");
    navigationView.fit();
    check.deepEqual([navigationView.scale, navigationView.offsetX, navigationView.offsetY], withoutInspector,
        "hiding the bottom node menu keeps the fitted view stable");
    for (const background of ["rgb(255, 255, 255)", "rgb(30, 30, 30)"]) {
        for (const width of [760, 320, 220]) {
            for (const fullscreen of [false, true]) {
                navigationHost.classList.toggle("fullscreen", fullscreen);
                navigationHost.style.width = `${width}px`;
                navigationHost.style.setProperty("--b3-theme-background", background);
                navigationHost.style.fontSize = width === 220 ? "32px" : "14px";
                navigationView.setReadOnly(false);
                navigationHost.focus();
                navigationView.setInteractionActive(true);
                await settle();
                const group = navigationToolbar.querySelector<HTMLElement>(".mindmap-view__toolbar-group");
                const groupBounds = group.getBoundingClientRect();
                check.equal(getComputedStyle(group).backgroundColor, background,
                    "the toolbar masks underlying text and images with the current theme background");
                check.equal(getComputedStyle(navigationToolbar).backgroundColor, "rgba(0, 0, 0, 0)",
                    "the unused toolbar area leaves the map visible");
                for (const control of Array.from(group.children)) {
                    if ((control as HTMLElement).hidden) {
                        continue;
                    }
                    const rect = control.getBoundingClientRect();
                    check.ok(rect.left >= groupBounds.left && rect.right <= groupBounds.right + 1 &&
                        rect.top >= groupBounds.top && rect.bottom <= groupBounds.bottom + 1,
                    "the opaque group covers every control after wrapping");
                }
                const lock = group.querySelector<HTMLButtonElement>("button");
                lock.disabled = true;
                check.equal(getComputedStyle(group).opacity, "1", "disabled buttons retain an opaque backdrop");
                check.equal(getComputedStyle(group).pointerEvents, "auto", "masked gaps cannot activate underlying nodes");
                lock.disabled = false;
                check.ok(navigationView.getToolbarBounds().some((rect: DOMRect) =>
                    rect.left === groupBounds.left && rect.right === groupBounds.right && rect.bottom === groupBounds.bottom),
                "node reveal measures the complete opaque toolbar group");
            }
        }
    }
    navigationHost.classList.remove("fullscreen");
    navigationView.destroy();
    navigationHost.remove();

    const view = new api.ListMindmapView(options);
    await settle();
    const viewport = host.querySelector<HTMLElement>(".mindmap-view__viewport");
    const settings = host.querySelector<HTMLButtonElement>('[aria-label="more"]');
    check.equal(settings.getAttribute("aria-haspopup"), "menu");
    check.equal(settings.nextElementSibling, null, "More is the last toolbar control");
    check.equal(settings.previousElementSibling.getAttribute("aria-label"), "fullscreen");
    settings.click();
    check.equal(settingsOpened, 1, "the editable toolbar opens the shared settings menu");
    const toolbarWidth = host.style.width;
    for (const width of [320, 760]) {
        host.style.width = `${width}px`;
        await settle();
        settings.click();
        check.equal(typeof overflowExpand === "function", width < 360,
            "More includes global expansion only when its direct entry is hidden");
        check.equal(view.buttons.get("expandLevel").hidden, width < 360);
        if (overflowExpand) {
            let level: unknown;
            const expandToLevel = view.expandToLevel;
            view.expandToLevel = async (value: unknown) => { level = value; };
            overflowExpand(3);
            check.equal(level, 3, "the overflow entry invokes the same global folding action");
            view.expandToLevel = expandToLevel;
        }
    }
    host.style.width = toolbarWidth;
    await settle();
    const originalConnectorPositions = JSON.stringify([...view.positions]);
    const connectorSource = list.getAttribute("custom-sy-list-mindmap-data");
    for (const connectorStyle of ["spline", "orthogonal", "bezier", "rounded"]) {
        model.metadata.connectorStyle = connectorStyle;
        api.writeListMindmapMetadata(list, model.metadata);
        const reloaded = api.readListMindmap(list);
        check.equal(reloaded.metadata.connectorStyle, connectorStyle);
        view.update(reloaded);
        await settle();
        check.equal(JSON.stringify([...view.positions]), originalConnectorPositions, "connector changes preserve node layout");
        check.equal(view.linePaths.filter((line: {relation: boolean}) => !line.relation).length, view.edges.length);
        if (connectorStyle === "orthogonal" || connectorStyle === "rounded") {
            const from = view.positions.get(model.root.id);
            const children = model.root.children.map((child: {id: string}) => view.positions.get(child.id));
            const trunkX = (from.x + from.width + Math.min(...children.map((child: {x: number}) => child.x))) / 2;
            const branchYs = children.map((child: {y: number, height: number}) => child.y + child.height);
            const rect = viewport.getBoundingClientRect();
            const eventAt = (x: number, y: number) => new MouseEvent("click", {
                clientX: rect.left + view.offsetX + x * view.scale,
                clientY: rect.top + view.offsetY + y * view.scale,
            });
            check.equal(view.findLine(eventAt(trunkX, (Math.min(...branchYs) + Math.max(...branchYs)) / 2)), undefined,
                "the shared vertical trunk cannot be selected as an individual branch");
            const child = children[children.length - 1];
            const branch = eventAt((trunkX + child.x + child.width) / 2, child.y + child.height);
            check.equal(view.findLine(branch).id, child.id, "the real canvas hit test selects each horizontal branch");
        }
        view.setReadOnly(true);
        check.ok(host.querySelector('[aria-label="more"]'), "read-only views retain the fallback pan menu");
        check.equal(host.querySelector('[aria-label="connect"]'), null, "read-only views do not expose object editing actions");
        check.equal(view.linePaths.filter((line: {relation: boolean}) => !line.relation).length, view.edges.length);
        view.setReadOnly(false);
    }
    if (connectorSource === null) {
        list.removeAttribute("custom-sy-list-mindmap-data");
    } else {
        list.setAttribute("custom-sy-list-mindmap-data", connectorSource);
    }
    delete model.metadata.connectorStyle;
    view.update(model);
    await settle();
    check.equal(viewport.getAttribute("data-prevent-swipe"), "true");
    const originalCapture = HTMLElement.prototype.setPointerCapture;
    const originalHasCapture = HTMLElement.prototype.hasPointerCapture;
    const originalReleaseCapture = HTMLElement.prototype.releasePointerCapture;
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.hasPointerCapture = () => false;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
    const nodeElement = (id: string) => host.querySelector<HTMLElement>(`[data-mindmap-id="${id}"]`);
    const compactNode = nodeElement(alpha);
    compactNode.style.minHeight = "0";
    compactNode.style.height = "32px";
    view.refreshLayout();
    await settle();
    check.equal(view.positions.get(alpha).height, compactNode.offsetHeight,
        "connection geometry uses the actual compact node height");
    const compactPositions = JSON.stringify([...view.positions]);
    view.setEditing(alpha);
    await settle();
    check.equal(JSON.stringify([...view.positions]), compactPositions, "entering edit mode preserves connection geometry");
    view.setEditing(undefined);
    await settle();
    check.equal(JSON.stringify([...view.positions]), compactPositions, "leaving edit mode preserves connection geometry");
    compactNode.style.minHeight = "";
    compactNode.style.height = "";
    view.refreshLayout();
    await settle();
    const sendPointer = (element: Element, type: string, x: number, y: number, button = 0) => element.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button, clientX: x, clientY: y,
    }));
    const sourceRect = nodeElement(alpha).getBoundingClientRect();
    const targetRect = nodeElement(beta).getBoundingClientRect();
    const sourcePoint = {x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2};
    const targetPoint = {x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2};
    check.ok(sourceRect.width >= 32 && sourceRect.height >= 32);
    check.equal(host.querySelector("[data-node-id]"), null);
    sendPointer(nodeElement(alpha), "pointerdown", sourcePoint.x, sourcePoint.y);
    check.equal(interactions, 1, "hover is suspended before the drag threshold");
    sendPointer(viewport, "pointerup", sourcePoint.x, sourcePoint.y);
    check.equal(interactions, 0);
    check.equal(edits.length, 0);
    check.equal(moves.length, 0);

    for (const type of ["pointercancel", "lostpointercapture"]) {
        sendPointer(nodeElement(alpha), "pointerdown", sourcePoint.x, sourcePoint.y);
        check.equal(interactions, 1);
        viewport.dispatchEvent(new PointerEvent(type, {pointerId: 1, bubbles: true}));
        check.equal(interactions, 0, type);
        check.equal(view.pointer, undefined);
    }
    sendPointer(nodeElement(alpha), "pointerdown", sourcePoint.x, sourcePoint.y);
    window.dispatchEvent(new Event("blur"));
    check.equal(interactions, 0, "losing window focus resumes hover");
    check.equal(view.pointer, undefined);

    let finishPendingEdit: (result: boolean) => void;
    finishAllowed = new Promise(resolve => finishPendingEdit = resolve);
    sendPointer(nodeElement(alpha), "pointerdown", sourcePoint.x, sourcePoint.y);
    check.equal(interactions, 1, "pending editor commits also suspend hover");
    sendPointer(document.body, "pointerup", sourcePoint.x, sourcePoint.y);
    check.equal(interactions, 0, "releasing outside the canvas cancels a pending interaction");
    finishPendingEdit(true);
    await settle();
    check.equal(view.pointer, undefined);
    finishAllowed = true;

    const cancelledHost = document.createElement("div");
    document.body.append(cancelledHost);
    const cancelledView = new api.ListMindmapView({...options, host: cancelledHost});
    sendPointer(cancelledHost.querySelector(".mindmap-view__viewport"), "pointerdown", 5, 5);
    check.equal(interactions, 1);
    cancelledView.destroy();
    cancelledHost.remove();
    check.equal(interactions, 0, "destroying a view releases its interaction");
    const panOrigin = {x: view.offsetX, y: view.offsetY};
    sendPointer(nodeElement(alpha), "pointerdown", sourcePoint.x, sourcePoint.y, 2);
    sendPointer(viewport, "pointermove", sourcePoint.x + 30, sourcePoint.y + 20, 2);
    check.equal(view.offsetX, panOrigin.x + 30, "right drag pans over nodes");
    check.equal(view.offsetY, panOrigin.y + 20, "right drag pans vertically");
    check.equal(host.querySelector(".mindmap-view__ghost"), null);
    sendPointer(viewport, "pointerup", sourcePoint.x + 30, sourcePoint.y + 20, 2);
    const contextMenu = new MouseEvent("contextmenu", {bubbles: true, cancelable: true});
    viewport.dispatchEvent(contextMenu);
    check.equal(contextMenu.defaultPrevented, true, "right pan suppresses the native menu");
    check.equal(moves.length, 0, "right pan does not move nodes");
    view.offsetX = panOrigin.x;
    view.offsetY = panOrigin.y;
    view.draw();
    sendPointer(nodeElement(alpha), "pointerdown", sourcePoint.x, sourcePoint.y);
    sendPointer(viewport, "pointermove", targetPoint.x, targetPoint.y);
    check.ok(host.querySelector(".mindmap-view__ghost"));
    check.equal(nodeElement(beta).dataset.mindmapDrop, "child");
    sendPointer(viewport, "pointerup", targetPoint.x, targetPoint.y);
    check.deepEqual(moves, [[alpha, beta, "child"]]);
    check.equal(host.querySelector(".mindmap-view__ghost"), null);
    sendPointer(nodeElement(alpha), "pointerdown", sourcePoint.x, sourcePoint.y);
    sendPointer(viewport, "pointermove", targetPoint.x, targetPoint.y);
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    sendPointer(viewport, "pointerup", targetPoint.x, targetPoint.y);
    check.equal(moves.length, 1);
    nodeElement(alpha).dispatchEvent(new MouseEvent("dblclick", {bubbles: true, cancelable: true}));
    check.deepEqual(edits, [alpha]);
    const editorHost = view.getContentHost(alpha);
    const editorMarker = document.createElement("div");
    editorMarker.className = "protyle";
    editorHost.replaceChildren(editorMarker);
    view.update(api.readListMindmap(list));
    check.equal(view.getContentHost(alpha).firstElementChild, editorMarker);
    view.setEditing();
    view.update(api.readListMindmap(list));
    check.equal(host.querySelector('[data-type="undo"], [data-type="redo"]'), null,
        "history controls belong to the document menu and editing toolbar");
    finishAllowed = false;
    nodeElement(alpha).querySelector<HTMLButtonElement>(".mindmap-view__add-child").click();
    check.equal(additions.length, 0);
    finishAllowed = true;
    nodeElement(alpha).querySelector<HTMLButtonElement>(".mindmap-view__add-child").click();
    check.equal(additions.length, 1, "add callback after finishing editing");

    // 悬浮添加按钮不改变拖拽和双击语义，未选中节点也必须使用自身 ID 添加子节点。
    const nativeInput = (events: Record<string, unknown>[]) =>
        require("electron").ipcRenderer.invoke("mindmap-view-native-input", events);
    const centerPoint = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return {x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2)};
    };
    const moveMouse = async (element?: Element) => {
        await nativeInput([{type: "mouseMove", ...(element ? centerPoint(element) : {x: 2, y: 2})}]);
        await settle();
    };
    const clickMouse = async (element: Element) => {
        const point = centerPoint(element);
        await nativeInput([
            {type: "mouseMove", ...point},
            {type: "mouseDown", ...point, button: "left", clickCount: 1},
            {type: "mouseUp", ...point, button: "left", clickCount: 1},
        ]);
        await settle();
    };
    const addChildButton = (id: string) => nodeElement(id).querySelector<HTMLButtonElement>(".mindmap-view__add-child");
    const visiblyRendered = (element: HTMLElement) => {
        const computed = getComputedStyle(element);
        return !element.hidden && computed.display !== "none" && computed.visibility !== "hidden" &&
            Number(computed.opacity) > 0;
    };
    const betaAdd = addChildButton(beta);
    check.ok(betaAdd, "each editable node has its own add-child control");
    await moveMouse();
    check.equal(visiblyRendered(betaAdd), false, "add-child control is hidden before hovering");
    check.equal(nodeElement(beta).getAttribute("aria-selected"), "false");
    await moveMouse(nodeElement(beta));
    check.equal(visiblyRendered(betaAdd), true, "hovering the node exposes its add-child control");
    const betaRect = nodeElement(beta).getBoundingClientRect();
    const betaButtonRect = betaAdd.getBoundingClientRect();
    const nodeScale = betaRect.width / nodeElement(beta).offsetWidth;
    check.ok((betaButtonRect.left - betaRect.right) / nodeScale <= 5,
        "leaf add controls stay close to the node edge");
    await nativeInput([{type: "mouseMove", x: Math.round((betaRect.right + betaButtonRect.left) / 2),
        y: Math.round(betaButtonRect.top + betaButtonRect.height / 2)}]);
    await settle();
    check.equal(visiblyRendered(betaAdd), true, "crossing the gap to the add control keeps it visible");
    await nativeInput([{type: "mouseMove", x: Math.round((betaRect.right + betaButtonRect.left) / 2),
        y: Math.round(betaRect.top + 2)}]);
    await settle();
    check.equal(visiblyRendered(betaAdd), true, "the hover corridor covers the full node height");
    check.equal(host.querySelector<HTMLElement>('[role="tooltip"]').hidden, true,
        "the gap is not part of the clickable add button");
    await moveMouse(betaAdd);
    check.equal(visiblyRendered(betaAdd), true, "moving onto the protruding control keeps it visible");
    const buttonPoint = centerPoint(betaAdd);
    check.equal(document.elementFromPoint(buttonPoint.x, buttonPoint.y)?.closest(".mindmap-view__add-child"), betaAdd,
        "the visible add-child control remains pointer-accessible outside the node edge");
    const hoverTooltip = host.querySelector<HTMLElement>('[role="tooltip"]');
    check.equal(hoverTooltip.hidden, false);
    betaAdd.dispatchEvent(new PointerEvent("pointerout", {bubbles: true, relatedTarget: betaAdd.querySelector("svg")}));
    check.equal(hoverTooltip.hidden, false, "moving from the button to its icon must not hide the tooltip");
    betaAdd.querySelector("svg").dispatchEvent(new PointerEvent("pointerover", {bubbles: true, relatedTarget: betaAdd}));
    check.equal(hoverTooltip.hidden, false);
    const beforeButtonEdits = edits.length;
    const beforeButtonMoves = moves.length;
    await clickMouse(betaAdd);
    check.deepEqual(additions[additions.length - 1], [beta, "child"]);
    check.equal(edits.length, beforeButtonEdits);
    check.equal(moves.length, beforeButtonMoves);
    check.equal(host.querySelector(".mindmap-view__ghost"), null);
    betaAdd.dispatchEvent(new MouseEvent("dblclick", {bubbles: true, cancelable: true}));
    check.equal(edits.length, beforeButtonEdits, "double clicking the add control does not open a node editor");
    finishAllowed = false;
    const beforeRejectedAddition = additions.length;
    await clickMouse(betaAdd);
    check.equal(additions.length, beforeRejectedAddition, "a pending edit prevents adding a child");
    finishAllowed = true;
    view.setReadOnly(true);
    await settle();
    host.querySelectorAll<HTMLButtonElement>(".mindmap-view__add-child").forEach(button => {
        check.equal(visiblyRendered(button), false, "read-only nodes hide their add-child controls");
        button.click();
    });
    check.equal(additions.length, beforeRejectedAddition, "read-only add controls cannot invoke mutations");
    view.setReadOnly(false);
    await settle();
    await moveMouse(nodeElement(beta));
    check.equal(visiblyRendered(addChildButton(beta)), true, "restoring editing restores the hover control");
    await clickMouse(addChildButton(beta));
    check.equal(additions.length, beforeRejectedAddition + 1);
    check.deepEqual(additions[additions.length - 1], [beta, "child"]);
    // 鼠标从节点右下角斜向移出时，过渡区域必须连续，不能先落到连线上导致按钮消失。
    view.clearSelection();
    await moveMouse(nodeElement(alpha));
    const branchRect = nodeElement(alpha).getBoundingClientRect();
    const branchScale = branchRect.width / nodeElement(alpha).offsetWidth;
    const cornerPoint = {x: Math.round(branchRect.right - 3 * branchScale),
        y: Math.round(branchRect.bottom + 3 * branchScale)};
    await nativeInput([{type: "mouseMove", ...cornerPoint}]);
    await settle();
    const expandedFold = nodeElement(alpha).querySelector<HTMLButtonElement>(".mindmap-view__fold");
    check.equal(visiblyRendered(expandedFold), true, "the lower inner corner keeps the fold control visible");
    check.equal(document.elementFromPoint(cornerPoint.x, cornerPoint.y)?.closest(".mindmap-view__node"), nodeElement(alpha),
        "the lower corner selects the node instead of its connection");
    await moveMouse(expandedFold);
    const expandedPoint = centerPoint(expandedFold);
    check.equal(document.elementFromPoint(expandedPoint.x, expandedPoint.y)?.closest("button"), expandedFold);
    await clickMouse(nodeElement(alpha));
    await moveMouse();
    check.equal(visiblyRendered(expandedFold), true, "selected nodes keep their fold control visible without hovering");
    check.equal(visiblyRendered(addChildButton(alpha)), true);
    model.nodes.get(alpha).collapsed = true;
    view.update(model);
    await settle();
    await moveMouse(nodeElement(alpha));
    check.equal(visiblyRendered(addChildButton(alpha)), true, "folded nodes retain their add-child control");
    const foldButton = nodeElement(alpha).querySelector<HTMLButtonElement>(".mindmap-view__fold");
    const foldPoint = centerPoint(foldButton);
    check.equal(document.elementFromPoint(foldPoint.x, foldPoint.y)?.closest(".mindmap-view__fold"), foldButton,
        "the hover bridge does not cover the neighboring fold control");
    const beforeFoldAdditions = additions.length;
    await clickMouse(foldButton);
    check.deepEqual(folds, [alpha]);
    check.equal(additions.length, beforeFoldAdditions, "clicking fold must not add a child");
    await clickMouse(addChildButton(alpha));
    check.deepEqual(additions[additions.length - 1], [alpha, "child"]);
    check.equal(edits.length, beforeButtonEdits);
    check.equal(moves.length, beforeButtonMoves);

    // 删除只作用于选中的节点，编辑输入、只读状态及取消选中后均不得删除正文。
    const pressDelete = (target: Element = host, init: KeyboardEventInit = {}) =>
        target.dispatchEvent(new KeyboardEvent("keydown", {key: "Delete", bubbles: true, cancelable: true, ...init}));
    const select = (id: string) => {
        const point = centerPoint(nodeElement(id));
        sendPointer(nodeElement(id), "pointerdown", point.x, point.y);
        sendPointer(viewport, "pointerup", point.x, point.y);
    };
    select(beta);
    const beforeShortcuts = additions.length;
    const navigate = (key: string) => host.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}));
    navigate("ArrowUp");
    check.equal(view.selectedId, alpha);
    navigate("ArrowRight");
    check.equal(view.selectedId, alpha, "folded descendants cannot receive keyboard selection");
    navigate("ArrowUp");
    check.equal(view.selectedId, alpha, "navigation does not wrap at sibling boundaries");
    navigate("ArrowLeft");
    check.equal(view.selectedId, model.root.id);
    navigate("ArrowRight");
    check.equal(view.selectedId, alpha);
    model.nodes.get(alpha).collapsed = false;
    view.update(model);
    navigate("ArrowRight");
    check.equal(view.selectedId, model.nodes.get(alpha).children[0].id);
    navigate("ArrowLeft");
    navigate("ArrowDown");
    check.equal(view.selectedId, beta);
    const beforeSpaceEdit = edits.length;
    view.setReadOnly(true);
    navigate(" ");
    check.equal(edits.length, beforeSpaceEdit);
    view.setReadOnly(false);
    // 浏览器原生组合输入必须从选中态的可编辑目标开始，不能用合成 keydown 代替输入法。
    const selectionInput = host.querySelector<HTMLElement>(".mindmap-view__selection-input");
    const ime = (text: string) => require("electron").ipcRenderer.invoke("mindmap-view-ime", text);
    const insertText = (text: string) => require("electron").ipcRenderer.invoke("mindmap-view-insert-text", text);
    view.focusNode(beta);
    check.equal(document.activeElement, selectionInput);
    check.equal(selectionInput.isContentEditable, true);
    const beforeIME = edits.length;
    await ime("n");
    await ime("ni");
    check.equal(document.activeElement, selectionInput, "composition retains its original input target");
    check.equal(edits.length, beforeIME, "uncommitted phonetic text does not replace node content");
    check.equal(selectionInput.textContent, "ni");
    check.equal(getComputedStyle(selectionInput).opacity, "0", "composition does not expose an extra input box over the node");
    const confirmation = new KeyboardEvent("keydown", {key: "Enter", keyCode: 229, bubbles: true, cancelable: true});
    selectionInput.dispatchEvent(confirmation);
    check.equal(confirmation.defaultPrevented, false, "IME confirmation is not a node shortcut");
    await insertText("你好");
    await settle();
    check.equal(edits.length, beforeIME + 1);
    check.equal(editTexts[editTexts.length - 1], "你好", "the entire first composition reaches the node editor");
    check.equal(selectionInput.textContent, "");
    view.setEditing();
    view.focusNode(beta);
    await ime("n");
    await ime("");
    await settle();
    check.equal(edits.length, beforeIME + 1, "canceling composition preserves the original node");
    check.equal(getComputedStyle(selectionInput).opacity, "0");
    await nativeInput([{type: "keyDown", keyCode: "X"}, {type: "char", keyCode: "X"}, {type: "keyUp", keyCode: "X"}]);
    check.equal(editTexts[editTexts.length - 1], "X", "ordinary typing uses native input without duplicating the first key");
    view.setEditing();
    view.focusNode(beta);
    const beforeSpace = edits.length;
    await nativeInput([{type: "keyDown", keyCode: "Space"}, {type: "keyUp", keyCode: "Space"}]);
    check.equal(edits.length, beforeSpace + 1);
    check.equal(editTexts[editTexts.length - 1], undefined, "space retains its open-editor shortcut");
    view.setEditing();
    view.focusNode(beta);
    await nativeInput([{type: "keyDown", keyCode: "Up"}, {type: "keyUp", keyCode: "Up"}]);
    check.equal(view.selectedId, alpha, "the editable input target preserves node navigation");
    check.equal(document.activeElement, selectionInput);
    view.focusNode(beta);
    const beforeStaleIME = edits.length;
    await ime("n");
    view.focusNode(alpha);
    selectionInput.dispatchEvent(new CompositionEvent("compositionend", {data: "你", bubbles: true}));
    selectionInput.textContent = "你";
    selectionInput.dispatchEvent(new InputEvent("input", {data: "你", inputType: "insertText", bubbles: true}));
    await settle();
    check.equal(edits.length, beforeStaleIME, "changing selection does not insert stale composition text");
    check.equal(selectionInput.textContent, "", "late composition input cannot carry over to the new selection");
    view.focusNode(beta);
    let finishInput: (value: boolean) => void;
    finishAllowed = new Promise<boolean>(resolve => finishInput = resolve);
    await insertText("Pending");
    view.focusNode(alpha);
    view.focusNode(beta);
    finishInput(true);
    await settle();
    check.equal(edits.length, beforeStaleIME, "delayed editor activation cannot follow a newer selection, even of the same node");
    finishAllowed = true;
    let inputCopiedNodes: string[];
    view.options.onCopy = (ids: string[]) => inputCopiedNodes = ids;
    selectionInput.dispatchEvent(new ClipboardEvent("copy", {bubbles: true, cancelable: true}));
    check.deepEqual(inputCopiedNodes, [beta], "copy from the idle input still copies the selected node");
    view.options.onCopy = undefined;
    view.setReadOnly(true);
    check.equal(selectionInput.hidden, true);
    check.equal(document.activeElement, host, "read-only selection returns focus to the canvas");
    view.setReadOnly(false);
    document.body.classList.add("body--android");
    view.focusNode(beta);
    check.equal(document.activeElement, host, "mobile selection does not open the software keyboard");
    document.body.classList.remove("body--android");
    view.focusNode(model.root.id);
    await ime("zhong");
    await insertText("中文根节点");
    await settle();
    const composedTitle = host.querySelector<HTMLTextAreaElement>(".mindmap-view__root-title");
    check.equal(composedTitle.value, "中文根节点", "virtual roots receive the committed composition too");
    composedTitle.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    view.focusNode(beta);
    edits.length = beforeIME;
    navigate(" ");
    check.equal(edits[edits.length - 1], beta, "space opens the selected node editor");
    check.equal(editTexts[editTexts.length - 1], undefined, "space keeps the node content");
    navigate("ArrowUp");
    check.equal(view.selectedId, beta, "editing keeps arrow keys inside the editor");
    view.setEditing();
    navigate("x");
    check.equal(edits[edits.length - 1], beta, "typing opens the selected node editor");
    check.equal(editTexts[editTexts.length - 1], "x", "typing replaces the first paragraph");
    view.setEditing();
    const editsBeforeModifiers = edits.length;
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "x", ctrlKey: true, bubbles: true}));
    check.equal(edits.length, editsBeforeModifiers, "modified keys do not replace node text");
    view.setReadOnly(true);
    navigate("x");
    check.equal(edits.length, editsBeforeModifiers, "read-only nodes cannot be edited by typing");
    view.setReadOnly(false);
    const composition = new KeyboardEvent("keydown", {key: "Process", bubbles: true, cancelable: true});
    host.dispatchEvent(composition);
    check.equal(composition.defaultPrevented, false, "composition can continue in the node editor");
    check.equal(editTexts[editTexts.length - 1], "", "composition selects the first paragraph");
    view.setEditing();
    const composingKey = new KeyboardEvent("keydown", {
        key: "a", isComposing: true, bubbles: true, cancelable: true,
    });
    host.dispatchEvent(composingKey);
    check.equal(composingKey.defaultPrevented, false);
    check.equal(editTexts[editTexts.length - 1], "", "composing text is not inserted as a literal key");
    view.setEditing();
    select(model.root.id);
    navigate(" ");
    const titleInput = host.querySelector<HTMLTextAreaElement>(".mindmap-view__root-title");
    check.ok(titleInput);
    check.equal(titleInput.selectionStart, titleInput.value.length);
    check.equal(titleInput.selectionEnd, titleInput.value.length);
    titleInput.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    await settle();
    check.equal(document.activeElement, selectionInput);
    select(model.root.id);
    navigate("R");
    const typedTitleInput = host.querySelector<HTMLTextAreaElement>(".mindmap-view__root-title");
    check.equal(typedTitleInput.value, "R", "typing replaces the virtual root title");
    typedTitleInput.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    edits.length = beforeSpaceEdit;
    model.nodes.get(alpha).collapsed = true;
    view.update(model);
    select(beta);
    const originalEditable = host.parentElement.contentEditable;
    host.parentElement.contentEditable = "true";
    for (const key of ["Tab", "Enter"]) {
        const event = new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true});
        host.dispatchEvent(event);
        check.equal(event.defaultPrevented, true, "nested mindmap handles keys instead of moving toolbar focus");
    }
    check.deepEqual(additions.slice(beforeShortcuts), [[beta, "child"], [beta, "sibling"]]);
    for (const shiftKey of [false, true]) {
        const event = new KeyboardEvent("keydown", {
            key: "Enter", ctrlKey: true, shiftKey, bubbles: true, cancelable: true,
        });
        host.dispatchEvent(event);
        check.equal(event.defaultPrevented, true);
    }
    check.deepEqual(additions.slice(beforeShortcuts + 2), [[beta, "sibling"], [beta, "child"]]);
    const repeatedShortcut = new KeyboardEvent("keydown", {
        key: "Enter", ctrlKey: true, repeat: true, bubbles: true, cancelable: true,
    });
    host.dispatchEvent(repeatedShortcut);
    check.equal(repeatedShortcut.defaultPrevented, true);
    check.equal(additions.length, beforeShortcuts + 4);
    view.setEditing(beta);
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Tab", bubbles: true}));
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}));
    check.equal(additions.length, beforeShortcuts + 4, "editing does not create nodes via selection shortcuts");
    view.setEditing();
    view.setReadOnly(true);
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}));
    check.equal(additions.length, beforeShortcuts + 4, "read-only mindmaps ignore configured node shortcuts");
    view.setReadOnly(false);
    additions.length = beforeShortcuts;
    host.parentElement.contentEditable = originalEditable;
    const blank = () => {
        const rect = viewport.getBoundingClientRect();
        sendPointer(viewport, "pointerdown", rect.left + 5, rect.top + 5);
        sendPointer(viewport, "pointerup", rect.left + 5, rect.top + 5);
    };
    select(beta);
    pressDelete();
    check.deepEqual(deletions, [beta]);
    finishAllowed = false;
    pressDelete();
    finishAllowed = true;
    pressDelete(host, {isComposing: true});
    pressDelete(host, {ctrlKey: true});
    view.setEditing(beta);
    pressDelete(view.getContentHost(beta));
    view.setEditing();
    check.deepEqual(deletions, [beta]);
    let finishDelete: () => void;
    finishAllowed = new Promise<boolean>(resolve => finishDelete = () => resolve(true));
    pressDelete();
    blank();
    finishDelete();
    await settle();
    finishAllowed = true;
    check.deepEqual(deletions, [beta], "a pending deletion cannot follow a changed selection");
    view.update(model);
    check.equal(host.querySelector(".mindmap-view__node--selected"), null);
    pressDelete();
    check.deepEqual(deletions, [beta]);
    select(model.root.id);
    pressDelete();
    check.deepEqual(deletions, [beta], "virtual root cannot be deleted");

    // 面板外部点击关闭设置，外观颜色保存变量引用并解析为画布可用的实际颜色。
    const toolbar = host.querySelector(".mindmap-view__toolbar");
    ["listMindmapChild", "delete", "fold"].forEach(label =>
        check.equal(toolbar.querySelector(`[aria-label="${label}"]`), null));
    const relationButton = host.querySelector<HTMLButtonElement>('.mindmap-view__inspector [aria-label="connect"]');
    const toolbarPanButton = toolbar.querySelector<HTMLButtonElement>('[aria-label="cursorHand"]');
    check.equal(toolbar.querySelector('[aria-label="connect"]'), null);
    check.equal(toolbar.querySelector('[aria-label="listMindmapSummary"]'), null);
    check.ok(toolbarPanButton.previousElementSibling.classList.contains("mindmap-view__level-control"));
    check.ok(toolbarPanButton.nextElementSibling.classList.contains("mindmap-view__zoom-control"));
    check.equal(relationButton.querySelector("use").getAttribute("xlink:href"), "#iconRoute");
    const inspector = host.querySelector<HTMLElement>(".mindmap-view__inspector");
    const fitButton = toolbar.querySelector<HTMLButtonElement>('[aria-label="listMindmapFit"]');
    check.equal(fitButton.querySelector("use").getAttribute("xlink:href"), "#iconFocus");
    const originalHostStyle = host.style.cssText;
    const toolbarZoom = toolbar.querySelector<HTMLElement>(".mindmap-view__zoom");
    const toolbarPopup = toolbar.querySelector<HTMLElement>(".mindmap-view__zoom-actions");
    const toolbarGroup = toolbar.querySelector<HTMLElement>(".mindmap-view__toolbar-group");
    check.equal(fitButton.parentElement, toolbarPopup, "fit shares the zoom panel with the slider and reset");
    check.equal(toolbarGroup.querySelector(':scope > [aria-label="listMindmapFit"]'), null,
        "fit no longer occupies a separate top-level toolbar slot");
    for (const width of [96, 180, 240, 260, 320, 360, 700]) {
        for (const fontSize of [14, 32]) {
            host.style.width = `${width}px`;
            host.style.fontSize = `${fontSize}px`;
            await settle();
            toolbarZoom.focus();
            const bounds = host.getBoundingClientRect();
            for (const control of Array.from(toolbarGroup.children) as HTMLElement[]) {
                if (control.hidden) {
                    continue;
                }
                const rect = control.getBoundingClientRect();
                check.ok(rect.left >= bounds.left && rect.right <= bounds.right,
                    `toolbar control stays inside the map, width=${width}, fontSize=${fontSize}`);
            }
            const firstButton = toolbar.querySelector("button").getBoundingClientRect();
            const lastButton = toolbarGroup.lastElementChild.getBoundingClientRect();
            check.equal(toolbarGroup.lastElementChild.getAttribute("aria-label"), "more",
                "More stays last at every toolbar width");
            for (const control of Array.from(toolbarGroup.children) as HTMLElement[]) {
                if (!control.hidden) {
                    check.ok(control.getBoundingClientRect().right <= lastButton.right + 1,
                        `More stays rightmost after wrapping, width=${width}, fontSize=${fontSize}`);
                }
            }
            check.equal(lastButton.top > firstButton.top, width < 220,
                `compact global toolbars wrap only when necessary, width=${width}, fontSize=${fontSize}`);
            check.equal(getComputedStyle(toolbarPopup).display, "flex", "zoom popup remains visible");
            if (width >= 240) {
                const popupBounds = toolbarPopup.getBoundingClientRect();
                check.ok(popupBounds.left >= bounds.left && popupBounds.right <= bounds.right,
                    `zoom panel stays inside the map, width=${width}, fontSize=${fontSize}`);
                for (const control of toolbarPopup.querySelectorAll<HTMLElement>("button")) {
                    const rect = control.getBoundingClientRect();
                    check.equal(document.elementFromPoint(rect.left + rect.width / 2,
                        rect.top + rect.height / 2)?.closest("button"), control,
                    "reset and fit remain reachable in the zoom panel");
                }
            }
            if (width === 180) {
                const popupBounds = toolbarPopup.getBoundingClientRect();
                check.ok(popupBounds.bottom > toolbar.getBoundingClientRect().bottom,
                    "zoom popup extends below the compact toolbar");
                const slider = toolbarPopup.querySelector<HTMLInputElement>("input");
                const sliderBounds = slider.getBoundingClientRect();
                check.equal(document.elementFromPoint(sliderBounds.left + sliderBounds.width / 2,
                    sliderBounds.top + sliderBounds.height / 2), slider, "zoom slider is not clipped or covered");
                slider.value = "125";
                slider.dispatchEvent(new Event("input", {bubbles: true}));
                check.equal(view.scale, 1.25, "zoom controls remain usable at narrow widths");
            }
        }
    }
    host.style.cssText = originalHostStyle;
    host.focus();
    view.zoomAt(1);
    toolbarZoom.focus();
    fitButton.dispatchEvent(new PointerEvent("pointerover", {bubbles: true}));
    check.equal(host.querySelector<HTMLElement>('[role="tooltip"]').hidden, false);
    check.equal(host.querySelector('[role="tooltip"]').textContent, "listMindmapFit");
    host.focus();
    select(beta);
    check.equal(inspector.hidden, false);
    check.equal(inspector.classList.contains("mindmap-view__inspector--node"), true);
    check.equal(getComputedStyle(inspector).bottom, "8px");
    check.equal(host.querySelector(".mindmap-view__status"), null);
    const nodeMenuBounds = inspector.getBoundingClientRect();
    const panelBounds = host.getBoundingClientRect();
    check.ok(Math.abs(nodeMenuBounds.left + nodeMenuBounds.width / 2 - panelBounds.left - panelBounds.width / 2) < 2);
    check.ok(nodeMenuBounds.width < panelBounds.width / 2);
    check.ok(panelBounds.bottom - nodeMenuBounds.bottom >= 8);
    const originalNodeColors = options.nodeColors;
    options.nodeColors = () => Array.from({length: 30}, (_, i) => ({
        label: `Color ${i}`, color: `rgb(${i}, 0, 0)`, backgroundColor: "",
        preview: {color: `rgb(${i}, 0, 0)`, backgroundColor: ""},
    }));
    for (const width of [240, 320, 760]) {
        host.style.width = `${width}px`;
        view.renderInspector();
        await settle();
        inspector.querySelector<HTMLButtonElement>('[aria-label="color"]').click();
        const popup = host.querySelector<HTMLElement>(".mindmap-view__inspector-popover");
        const palette = popup.querySelector<HTMLElement>(".mindmap-view__palette");
        check.equal(palette.children.length, 31);
        const popupBounds = popup.getBoundingClientRect();
        check.ok(popupBounds.width <= host.offsetWidth - 16, "long palettes stay within the canvas");
        check.ok(popupBounds.bottom <= inspector.getBoundingClientRect().top, "node settings open above the bottom bar");
        const bounds = inspector.getBoundingClientRect();
        for (const key of ["connect", "listMindmapSummary", "delete"]) {
            const action = inspector.querySelector<HTMLElement>(`[aria-label="${key}"]`).getBoundingClientRect();
            check.ok(action.left >= bounds.left && action.right <= bounds.right,
                `node action ${key} stays visible at width ${width} while the palette scrolls`);
        }
    }
    const originalLineColors = options.colors;
    options.colors = () => Array.from({length: 15}, (_, i) => ({label: `Line ${i}`, value: `rgb(${i}, 0, 0)`}));
    host.style.setProperty("--b3-list-hover", "rgba(100, 100, 100, .4)");
    host.style.setProperty("--b3-menu-background", "#fff");
    host.style.setProperty("--b3-border-color", "#888");
    host.style.setProperty("--b3-theme-primary", "#3583ff");
    view.selectNode(alpha, true);
    for (const width of [240, 320, 760]) {
        host.style.width = `${width}px`;
        view.renderInspector();
        inspector.querySelector<HTMLButtonElement>('[aria-label="color"]').click();
        await settle();
        const popup = host.querySelector<HTMLElement>(".mindmap-view__inspector-popover");
        const palettes = popup.querySelectorAll<HTMLElement>(".mindmap-view__palette");
        check.equal(palettes.length, 2);
        check.equal(popup.getBoundingClientRect().width, inspector.getBoundingClientRect().width,
            "the palette popup matches the eight-action toolbar at every canvas width");
        check.equal(popup.getBoundingClientRect().left, inspector.getBoundingClientRect().left);
        check.equal(palettes[0].getAttribute("aria-label"), "listMindmapNodeColor");
        check.equal(palettes[1].getAttribute("aria-label"), "listMindmapLineColor");
        check.equal(popup.children.length, 2, "the popup has only two compact rows without visible headings");
        const managers = ["listMindmapManageNodeColors", "listMindmapManageLineColors"]
            .map(key => popup.querySelector<HTMLButtonElement>(`[aria-label="${key}"]`));
        check.deepEqual(managers.map(control => control.querySelector("use").getAttribute("xlink:href")),
            ["#iconFont", "#iconLine"], "distinct icons identify the two settings controls");
        check.equal(managers[0].getBoundingClientRect().right, managers[1].getBoundingClientRect().right,
            "settings stay in one fixed right-hand column with unequal custom palette sizes");
        check.ok(palettes[1].getBoundingClientRect().top >= palettes[0].getBoundingClientRect().bottom,
            "node colors are visually above line colors");
        const rowsHeight = Array.from(popup.children).reduce((height, row) => height + row.getBoundingClientRect().height, 0);
        check.ok(popup.offsetHeight <= Math.ceil(rowsHeight + 20),
            "the popup contains only the two rows, padding and their gap, including native scrollbars");
        for (const palette of palettes) {
            const buttons = Array.from(palette.children) as HTMLElement[];
            check.equal(new Set(buttons.map(button => button.offsetTop)).size, 1, "each palette keeps one row");
            check.ok(palette.getBoundingClientRect().right <= palette.nextElementSibling.getBoundingClientRect().left);
            check.ok(palette.scrollWidth > palette.clientWidth, "additional colors scroll even on wide canvases");
            check.ok(buttons[6].getBoundingClientRect().right <= palette.getBoundingClientRect().right + 1,
                "default and six colors fit before the fixed settings column");
            check.ok(buttons[7].getBoundingClientRect().left >= palette.getBoundingClientRect().right - 1,
                "the next color stays outside the first page");
        }
        const selectedColor = palettes[0].querySelector<HTMLElement>(".color__square--current");
        check.equal(getComputedStyle(selectedColor).boxShadow.match(/inset/g)?.length, 1,
            "selection preserves the thin original border instead of shrinking the color fill");
        check.equal(selectedColor.querySelector(".color__square-mark use")?.getAttribute("xlink:href"), "#iconSelect",
            "selected node colors display a check mark");
        check.equal(selectedColor.offsetWidth, 26);
        check.equal(selectedColor.offsetHeight, 26);
        const selectedLine = palettes[1].querySelector<HTMLElement>('[aria-pressed="true"]');
        check.equal(selectedLine.getAttribute("aria-label"), "default");
        check.ok(selectedLine.querySelector(".color__square-mark"), "multi-node line colors mark their common value");
        await moveMouse();
        for (const palette of palettes) {
            await moveMouse(palette.children[6]);
            check.equal(getComputedStyle(palette.children[6]).boxShadow, "rgb(53, 131, 255) 0px 0px 0px 1px inset",
                "node and line hover use a uniform thin border inside the last visible color");
        }
        const beforeSettings = nodeStyles.length;
        managers[0].focus();
        check.equal(host.querySelector('[role="tooltip"]').textContent, "listMindmapManageNodeColors");
        managers[0].click();
        managers[1].click();
        check.deepEqual(colorSettings.slice(-2), [{kind: "node", anchor: managers[0]}, {kind: "line"}]);
        check.equal(nodeStyles.length, beforeSettings, "opening settings does not apply colors");
        const managerLeft = managers[1].getBoundingClientRect().left;
        palettes[1].scrollLeft = palettes[1].scrollWidth;
        check.equal(managers[1].getBoundingClientRect().left, managerLeft, "scrolling colors never scrolls the settings button");
        palettes[1].querySelector<HTMLButtonElement>('[aria-label="Line 14"]').click();
        check.deepEqual(nodeStyles.at(-1), [view.getSelectedIds(), {lineColor: "rgb(14, 0, 0)"}]);
    }
    const originalAlphaStyle = model.metadata.nodes[alpha];
    const originalBetaStyle = model.metadata.nodes[beta];
    for (const [alphaColor, betaColor] of [["rgb(2, 0, 0)", "rgb(2, 0, 0)"], ["rgb(2, 0, 0)", "rgb(3, 0, 0)"]]) {
        model.metadata.nodes[alpha] = {...originalAlphaStyle, lineColor: alphaColor};
        model.metadata.nodes[beta] = {...originalBetaStyle, lineColor: betaColor};
        view.renderInspector();
        inspector.querySelector<HTMLButtonElement>('[aria-label="color"]').click();
        const lines = host.querySelectorAll<HTMLElement>(".mindmap-view__inspector-popover .mindmap-view__palette")[1];
        const selected = lines.querySelectorAll('[aria-pressed="true"]');
        check.equal(selected.length, alphaColor === betaColor ? 1 : 0, "mixed line colors never indicate a false common selection");
        if (selected.length) {
            check.equal(selected[0].getAttribute("aria-label"), "Line 2");
            check.ok(selected[0].querySelector(".color__square-mark"));
        }
    }
    if (originalAlphaStyle) {
        model.metadata.nodes[alpha] = originalAlphaStyle;
    } else {
        delete model.metadata.nodes[alpha];
    }
    if (originalBetaStyle) {
        model.metadata.nodes[beta] = originalBetaStyle;
    } else {
        delete model.metadata.nodes[beta];
    }
    options.nodeColors = () => Array.from({length: 13}, (_, i) => ({label: `Color ${i}`, color: `rgb(${i}, 0, 0)`, backgroundColor: "",
        preview: {color: `rgb(${i}, 0, 0)`, backgroundColor: ""}}));
    options.colors = () => Array.from({length: 13}, (_, i) => ({label: `Line ${i}`, value: `rgb(${i}, 0, 0)`}));
    view.renderInspector();
    inspector.querySelector<HTMLButtonElement>('[aria-label="color"]').click();
    const equalPalettes = host.querySelectorAll<HTMLElement>(".mindmap-view__inspector-popover .mindmap-view__palette");
    check.equal(equalPalettes[0].children.length, 14, "default and thirteen color cells occupy each row");
    check.equal(equalPalettes[1].children.length, 14);
    Array.from(equalPalettes[0].children).forEach((control, i) => {
        const nodeCell = control.getBoundingClientRect();
        const lineCell = equalPalettes[1].children[i].getBoundingClientRect();
        check.equal(nodeCell.left, lineCell.left, "equal default palettes align every column");
        check.equal(nodeCell.width, lineCell.width);
        check.equal(nodeCell.height, lineCell.height);
    });
    host.focus();
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
    const paletteSelection = view.getSelectedIds();
    const touchColorPoint = centerPoint(inspector.querySelector('[aria-label="color"]'));
    await require("electron").ipcRenderer.invoke("mindmap-view-native-touch", [
        {type: "touchStart", touchPoints: [{id: 1, ...touchColorPoint}]},
        {type: "touchEnd", touchPoints: []},
    ]);
    await settle();
    check.equal(host.querySelector<HTMLElement>(".mindmap-view__inspector-popover").hidden, false,
        "a native touch tap opens the same compact two-row palette");
    check.deepEqual(view.getSelectedIds(), paletteSelection, "opening the palette by touch preserves the selected nodes");
    const touchPalette = host.querySelector<HTMLElement>(".mindmap-view__inspector-popover .mindmap-view__palette");
    const touchBounds = touchPalette.getBoundingClientRect();
    const touchManager = touchPalette.nextElementSibling;
    const managerPosition = touchManager.getBoundingClientRect().left;
    const beforeColorSwipe = nodeStyles.length;
    const settlePalette = async () => {
        const deadline = performance.now() + 2000;
        let stable = 0;
        let last = -1;
        while (performance.now() < deadline && stable < 12) {
            await frame();
            stable = !touchPalette.hasAttribute("data-scrolling") && Math.abs(touchPalette.scrollLeft - last) < .1 ? stable + 1 : 0;
            last = touchPalette.scrollLeft;
        }
        const step = parseFloat(getComputedStyle(touchPalette).gridTemplateColumns);
        check.ok(Math.abs(touchPalette.scrollLeft - Math.round(touchPalette.scrollLeft / step) * step) < 1 ||
            Math.abs(touchPalette.scrollLeft - (touchPalette.scrollWidth - touchPalette.clientWidth)) < 1,
        "scrolling settles on a complete color column: " + JSON.stringify({left: touchPalette.scrollLeft, step}));
        check.ok(stable >= 12, "palette scrolling settles within the deadline");
    };
    const swipeStart = {x: Math.round(touchBounds.right - 12), y: Math.round(touchBounds.top + touchBounds.height / 2)};
    await require("electron").ipcRenderer.invoke("mindmap-view-native-touch", [
        {type: "touchStart", touchPoints: [{id: 1, ...swipeStart}]},
        ...[20, 40, 60, 80, 100, 120].map(delta => ({type: "touchMove",
            touchPoints: [{id: 1, x: swipeStart.x - delta, y: swipeStart.y}]})),
        {type: "touchEnd", touchPoints: []},
    ]);
    await settlePalette();
    check.ok(touchPalette.scrollLeft > 0, "a native horizontal swipe reaches colors beyond the first six groups");
    check.equal(touchManager.getBoundingClientRect().left, managerPosition, "swiping the palette keeps color settings fixed");
    check.equal(nodeStyles.length, beforeColorSwipe, "swiping colors does not apply a color or alter document styles");
    for (const scale of [1, .75]) {
        host.style.transformOrigin = "top left";
        host.style.transform = `scale(${scale})`;
        await settle();
        touchPalette.scrollLeft = 0;
        const bounds = touchPalette.getBoundingClientRect();
        const start = {x: Math.round(bounds.right - 12), y: Math.round(bounds.top + bounds.height / 2)};
        const canvasPosition = {x: view.offsetX, y: view.offsetY, scale: view.scale};
        const settingsPosition = touchManager.getBoundingClientRect().left;
        await nativeInput([
            {type: "mouseMove", ...start},
            ...Array.from({length: 20}, () => ({type: "mouseWheel", ...start, deltaX: -2, deltaY: 0})),
        ]);
        check.ok(touchPalette.scrollLeft > 30, "a continuous trackpad gesture scrolls the actual node palette");
        check.equal(touchPalette.hasAttribute("data-scrolling"), true,
            "the actual node palette keeps snapping disabled during a horizontal gesture");
        await settlePalette();
        check.deepEqual({x: view.offsetX, y: view.offsetY, scale: view.scale}, canvasPosition);
        check.equal(touchManager.getBoundingClientRect().left, settingsPosition);
        touchPalette.scrollLeft = 0;
        await nativeInput([
            {type: "mouseMove", ...start},
            {type: "mouseWheel", ...start, deltaX: 0, deltaY: -60},
        ]);
        await settle();
        check.ok(touchPalette.scrollLeft > 0, "a native vertical mouse wheel browses the horizontal palette");
        await settlePalette();
        touchPalette.scrollLeft = 0;
        await nativeInput([
            {type: "mouseMove", ...start},
            {type: "mouseDown", ...start, button: "left", clickCount: 1},
            ...[20, 40, 60, 80].map(delta => ({type: "mouseMove", x: start.x - delta, y: start.y, button: "left"})),
        ]);
        await settle();
        check.ok(Math.abs(touchPalette.scrollLeft - 80 / scale) < 2,
            "mouse dragging stays continuous and accounts for an outer editor scale before release");
        await nativeInput([{type: "mouseUp", x: start.x - 80, y: start.y, button: "left", clickCount: 1}]);
        await settlePalette();
        check.equal(nodeStyles.length, beforeColorSwipe, "drag release never applies the color underneath the pointer");
        check.deepEqual(view.getSelectedIds(), paletteSelection);
        check.deepEqual({x: view.offsetX, y: view.offsetY, scale: view.scale}, canvasPosition);
        check.equal(touchManager.getBoundingClientRect().left, settingsPosition);
    }
    const visibleColor = touchPalette.children[Math.ceil(touchPalette.scrollLeft /
        (touchPalette.scrollWidth / touchPalette.children.length)) + 1] as HTMLButtonElement;
    await clickMouse(visibleColor);
    check.equal(nodeStyles.length, beforeColorSwipe + 1, "a regular click after dragging still applies a color");
    visibleColor.focus({preventScroll: true});
    await nativeInput([{type: "keyDown", keyCode: "Return"}, {type: "char", keyCode: "\r"},
        {type: "keyUp", keyCode: "Return"}]);
    await settle();
    check.equal(nodeStyles.length, beforeColorSwipe + 2, "keyboard activation remains available after palette dragging");
    options.colors = originalLineColors;
    view.focusNode(beta);
    host.style.cssText = originalHostStyle;
    options.nodeColors = originalNodeColors;
    view.renderInspector();
    for (const borderColor of ["#d4d4d4", "#484848"]) {
        host.style.setProperty("--b3-border-color", borderColor);
        check.equal(getComputedStyle(inspector).boxShadow,
            getComputedStyle(host).borderTopColor + " 0px 0px 0px 1px");
    }
    host.style.removeProperty("--b3-border-color");
    check.equal(inspector.querySelectorAll('input[type="number"]').length, 0, "the width field is kept out of the main bar");
    inspector.querySelector<HTMLButtonElement>('[aria-label="width"]').click();
    const nodePopup = host.querySelector<HTMLElement>(".mindmap-view__inspector-popover");
    const widthInput = () => nodePopup.querySelector<HTMLInputElement>('input[type="number"]');
    check.equal(nodePopup.getBoundingClientRect().width, inspector.getBoundingClientRect().width);
    const widthControls = nodePopup.querySelector(".mindmap-view__node-width");
    check.deepEqual(Array.from(widthControls.children).map(control => control.tagName === "INPUT" ?
        control.getAttribute("type") : control.getAttribute("aria-label")),
    ["number", "range", "listMindmapRestoreWidth", "default"], "the width input precedes the centered slider and reset controls");
    for (const canvasWidth of [240, 320, 760]) {
        host.style.width = `${canvasWidth}px`;
        await settle();
        const row = widthControls.getBoundingClientRect();
        const numeric = widthInput().getBoundingClientRect();
        const range = widthControls.querySelector(".b3-slider").getBoundingClientRect();
        const restore = widthControls.querySelector('[aria-label="listMindmapRestoreWidth"]').getBoundingClientRect();
        const automatic = widthControls.querySelector('[aria-label="default"]').getBoundingClientRect();
        check.ok(Math.abs((range.left + range.right) / 2 - (row.left + row.right) / 2) < 1,
            "the width slider stays centered within the panel");
        check.ok(Math.abs(range.left - numeric.right - (restore.left - range.right)) < 1,
            "the slider has equal space beside the number field and reset controls");
        check.ok(Math.abs(numeric.width - (automatic.right - restore.left)) < 1,
            "the numeric field matches the combined width of the two right-hand controls");
        check.equal(getComputedStyle(widthInput()).paddingRight, "4px", "the compact number field retains a reachable native stepper");
    }
    host.style.cssText = originalHostStyle;
    widthInput().value = "640";
    widthInput().dispatchEvent(new Event("change", {bubbles: true}));
    await settle();
    check.deepEqual(nodeStyles.at(-1), [beta, {width: 640}]);
    const stepper = widthInput().getBoundingClientRect();
    const stepperPoint = {x: Math.round(stepper.right - 8), y: Math.round(stepper.top + 5)};
    await nativeInput([
        {type: "mouseMove", ...stepperPoint},
        {type: "mouseDown", ...stepperPoint, button: "left", clickCount: 1},
        {type: "mouseUp", ...stepperPoint, button: "left", clickCount: 1},
    ]);
    host.focus();
    await settle();
    check.deepEqual(nodeStyles.at(-1), [beta, {width: 641}], "the native number stepper stays reachable at the field's right edge");
    const styleCount = nodeStyles.length;
    widthInput().value = "12";
    widthInput().dispatchEvent(new Event("change", {bubbles: true}));
    await settle();
    check.equal(nodeStyles.length, styleCount, "invalid widths do not change metadata");
    widthInput().value = "";
    widthInput().dispatchEvent(new Event("change", {bubbles: true}));
    await settle();
    check.deepEqual(nodeStyles.at(-1), [beta, {width: 0}], "clearing restores automatic width");
    const oldAlphaWidth = model.metadata.nodes[alpha]?.width || 0;
    model.metadata.nodes[alpha] = {...model.metadata.nodes[alpha], width: 0};
    model.metadata.nodes[beta] = {...model.metadata.nodes[beta], width: 480};
    view.update(model);
    await settle();
    view.focusNode(alpha);
    view.selectNode(beta, true);
    const mixedWidthSelection = view.getSelectedIds();
    const widthButton = inspector.querySelector<HTMLButtonElement>('[aria-label="width"]');
    await moveMouse(widthButton);
    check.equal(nodePopup.hidden, false, "mouse hover opens node settings");
    const slider = () => nodePopup.querySelector<HTMLInputElement>('input[type="range"]');
    check.equal(slider().value, "0", "the slider starts centered on the current width");
    const beforeWidthDrag = nodeStyles.length;
    slider().value = "50";
    slider().dispatchEvent(new Event("input", {bubbles: true}));
    await settle();
    check.equal(nodeStyles.length, beforeWidthDrag, "drag previews do not write intermediate transactions");
    check.equal(nodeElement(beta).style.width, "960px");
    slider().dispatchEvent(new Event("change", {bubbles: true}));
    await settle();
    check.equal(nodeStyles.length, beforeWidthDrag + 2, "release saves one callback for all selected nodes");
    check.equal(model.metadata.nodes[alpha].width, 960);
    check.equal(model.metadata.nodes[beta].width, 960);
    widthInput().focus();
    widthInput().value = "1000";
    widthInput().dispatchEvent(new Event("input", {bubbles: true}));
    const beforeRestoreWidth = nodeStyles.length;
    await clickMouse(nodePopup.querySelector('[aria-label="listMindmapRestoreWidth"]'));
    check.equal(nodeStyles.length, beforeRestoreWidth + 2, "Restore replaces an unsaved numeric preview without an extra save");
    check.equal(model.metadata.nodes[alpha].width, 0, "restore retains an originally automatic width");
    check.equal(model.metadata.nodes[beta].width, 480, "restore retains each node's individual width");
    await clickMouse(nodePopup.querySelector('[aria-label="default"]'));
    check.equal(model.metadata.nodes[beta].width, 0, "default makes every selected width automatic");
    const beforeCancelWidth = nodeStyles.length;
    slider().value = "50";
    slider().dispatchEvent(new Event("input", {bubbles: true}));
    slider().dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
    await settle();
    check.equal(nodePopup.hidden, true, "Escape closes the popup");
    check.equal(nodeStyles.length, beforeCancelWidth, "canceling a preview does not save a width");
    check.equal(nodeElement(beta).style.width, "", "canceled previews restore persisted geometry");
    check.deepEqual(view.getSelectedIds(), mixedWidthSelection, "popup keyboard handling preserves node selection");
    const touchWidthButton = inspector.querySelector<HTMLButtonElement>('[aria-label="width"]');
    const touchWidthPoint = centerPoint(touchWidthButton);
    await require("electron").ipcRenderer.invoke("mindmap-view-native-touch", [
        {type: "touchStart", touchPoints: [{id: 1, ...touchWidthPoint}]},
        {type: "touchEnd", touchPoints: []},
    ]);
    await settle();
    check.equal(nodePopup.hidden, false, "a native touch tap opens the width panel");
    check.deepEqual(view.getSelectedIds(), mixedWidthSelection, "touch popup activation preserves the selection");
    host.focus();
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
    check.equal(nodePopup.hidden, true, "Escape also closes a hovered panel while canvas focus is retained");
    check.deepEqual(view.getSelectedIds(), mixedWidthSelection);
    model.metadata.nodes[alpha].width = oldAlphaWidth;
    view.update(model);
    view.focusNode(beta);
    inspector.querySelector<HTMLButtonElement>('[aria-label="color"]').click();
    check.equal(inspector.querySelectorAll('[role="group"]').length, 0, "palettes are kept out of the main bar");
    const nodePalette = nodePopup.querySelector<HTMLElement>('[role="group"][aria-label="listMindmapNodeColor"]');
    const nodeColorButton = nodePalette.querySelector<HTMLButtonElement>('[aria-label="Appearance combined"]');
    check.equal(nodeColorButton.textContent, "A");
    check.equal(nodeColorButton.classList.contains("color__square"), true);
    check.equal(getComputedStyle(nodeColorButton).color, "rgb(17, 34, 51)");
    check.equal(getComputedStyle(nodeColorButton).backgroundColor, "rgb(221, 238, 255)");
    nodeColorButton.click();
    check.deepEqual(nodeStyles[nodeStyles.length - 1], [beta, {textColor: "var(--b3-font-color1)", backgroundColor: "var(--b3-font-background1)"}]);
    host.style.setProperty("--b3-font-color1", "#123456");
    host.style.setProperty("--b3-font-background1", "#abcdef");
    model.metadata.nodes[beta] = {textColor: "var(--b3-font-color1)", backgroundColor: "var(--b3-font-background1)"};
    view.update(model);
    check.equal(getComputedStyle(nodeElement(beta)).backgroundColor, "rgb(171, 205, 239)");
    check.equal(getComputedStyle(nodeElement(beta)).color, "rgb(18, 52, 86)");
    check.equal(nodePopup.querySelector('[aria-label="Appearance combined"]').getAttribute("aria-pressed"), "true");
    host.style.setProperty("--b3-font-background1", "#334455");
    check.equal(getComputedStyle(nodeElement(beta)).backgroundColor, "rgb(51, 68, 85)",
        "node colors follow changes to the appearance palette");
    nodePopup.querySelector<HTMLButtonElement>('[aria-label="listMindmapNodeColor"] [aria-label="default"]').click();
    check.deepEqual(nodeStyles[nodeStyles.length - 1], [beta, {textColor: "", backgroundColor: ""}]);
    model.metadata.nodes[beta].backgroundColor = "";
    model.metadata.nodes[beta].textColor = "";
    view.update(model);
    check.equal(nodeElement(beta).style.backgroundColor, "", "default removes the node color override");
    check.equal(nodeElement(beta).style.color, "", "default removes the node text color override");
    await settle();
    const lineContext = host.querySelector("canvas").getContext("2d");
    const themedEdge = view.edges[view.edges.length - 1].to;
    const originalRootStyle = model.metadata.nodes[model.root.id];
    const originalEdgeStyle = model.metadata.nodes[themedEdge];
    const originalScale = view.scale;
    const themedProperties = ["color", "width", "hover-color", "hover-width", "selected-color", "selected-width"];
    const setLineTheme = (property: string, value: string) =>
        host.style.setProperty(`--b3-mindmap-line-${property}`, value);
    const checkLine = (color: string, width: number) => {
        view.draw();
        check.equal(lineContext.strokeStyle, color);
        check.equal(lineContext.lineWidth, width);
    };
    model.metadata.nodes[model.root.id] = {};
    model.metadata.nodes[themedEdge] = {};
    view.clearSelection();
    view.setHoveredLine();
    host.style.setProperty("--b3-border-color", "#314159");
    view.scale = 0.5;
    checkLine("#314159", 1.5);
    view.setHoveredLine(`edge:${themedEdge}`);
    checkLine("#314159", 4.5);
    view.selectedEdge = themedEdge;
    checkLine("#314159", 5.5);
    view.setHoveredLine();
    checkLine("#314159", 2.5);
    view.clearSelection();
    setLineTheme("color", "var(--b3-font-background1)");
    setLineTheme("width", "2px");
    checkLine("#334455", 2);
    setLineTheme("hover-color", "#445566");
    setLineTheme("hover-width", "4");
    setLineTheme("selected-color", "#778899");
    setLineTheme("selected-width", "6px");
    view.setHoveredLine(`edge:${themedEdge}`);
    checkLine("#445566", 4);
    view.selectedEdge = themedEdge;
    checkLine("#778899", 6);
    view.setHoveredLine();
    checkLine("#778899", 6);
    view.clearSelection();
    model.metadata.nodes[model.root.id] = {lineColor: "#aabbcc", lineWidth: 3};
    checkLine("#aabbcc", 3);
    model.metadata.nodes[themedEdge] = {lineColor: "#112233", lineWidth: 5};
    checkLine("#112233", 5);
    view.setHoveredLine(`edge:${themedEdge}`);
    checkLine("#112233", 4);
    view.selectedEdge = themedEdge;
    checkLine("#112233", 6);
    view.selectedEdge = undefined;
    setLineTheme("hover-color", "invalid-color");
    for (const width of ["auto", "0", "-2", "Infinity", "2em", "3px-invalid"]) {
        setLineTheme("hover-width", width);
        checkLine("#112233", 8);
    }
    view.selectedEdge = themedEdge;
    setLineTheme("selected-color", "initial");
    setLineTheme("selected-width", "auto");
    checkLine("#112233", 9);
    view.clearSelection();
    view.setHoveredLine();
    model.metadata.nodes[model.root.id] = {};
    model.metadata.nodes[themedEdge] = {};
    setLineTheme("color", "invalid-color");
    setLineTheme("width", "-1");
    checkLine("#314159", 1.5);
    view.scale = originalScale;
    model.metadata.nodes[model.root.id] = originalRootStyle;
    model.metadata.nodes[themedEdge] = originalEdgeStyle;
    themedProperties.forEach(property => host.style.removeProperty(`--b3-mindmap-line-${property}`));
    host.style.removeProperty("--b3-border-color");
    view.draw();
    const themedNodeBounds = nodeElement(themedEdge).getBoundingClientRect();
    const themedPosition = view.positions.get(themedEdge);
    const underlineY = viewport.getBoundingClientRect().top + view.offsetY +
        (themedPosition.y + themedPosition.height) * view.scale;
    check.ok(Math.abs(underlineY - themedNodeBounds.bottom - 3 * view.scale) < 0.1,
        "node backgrounds leave a gap above their underline");
    check.ok(Math.abs(centerPoint(addChildButton(themedEdge)).y - underlineY) <= view.scale + 1,
        "node controls remain aligned with the underline");
    host.style.setProperty("--b3-font-background1", "#123456");
    model.metadata.nodes[model.root.id] = {lineColor: "var(--b3-font-background1)"};
    view.update(model);
    check.equal(host.querySelector("canvas").getContext("2d").strokeStyle, "#123456");
    check.equal(getComputedStyle(nodeElement(beta)).borderWidth, "0px");
    view.clearSelection();
    await moveMouse();
    await settle();
    const parentBounds = nodeElement(model.nodes.get(beta).parentId).getBoundingClientRect();
    const childBounds = nodeElement(beta).getBoundingClientRect();
    const lineX = (parentBounds.right + childBounds.left) / 2;
    const parentY = model.nodes.get(beta).parentId === model.root.id ? parentBounds.top + parentBounds.height / 2 : parentBounds.bottom;
    const lineY = (parentY + childBounds.bottom) / 2;
    sendPointer(viewport, "pointermove", lineX, lineY);
    check.equal(viewport.classList.contains("mindmap-view__viewport--line-hover"), true);
    check.equal(visiblyRendered(addChildButton(beta)), true, "hovering a tree curve exposes its node controls");
    check.equal(nodeElement(beta).getAttribute("aria-selected"), "false", "line hover does not change selection");
    const alphaBounds = nodeElement(alpha).getBoundingClientRect();
    sendPointer(viewport, "pointermove", alphaBounds.left + alphaBounds.width / 2, alphaBounds.bottom + 1);
    check.equal(visiblyRendered(nodeElement(alpha).querySelector<HTMLButtonElement>(".mindmap-view__fold")), true,
        "hovering a branch underline exposes its fold control");
    check.equal(visiblyRendered(addChildButton(beta)), false, "moving to another line clears the previous node controls");
    viewport.dispatchEvent(new PointerEvent("pointerleave"));
    check.equal(viewport.classList.contains("mindmap-view__viewport--line-hover"), false);
    check.equal(nodeElement(alpha).classList.contains("mindmap-view__node--line-hover"), false);
    sendPointer(viewport, "pointerdown", lineX, lineY);
    sendPointer(viewport, "pointerup", lineX, lineY);
    check.equal(inspector.hidden, false, "clicking the tree curve opens its settings");
    check.equal(inspector.classList.contains("mindmap-view__inspector--line"), true);
    inspector.querySelector<HTMLButtonElement>('[aria-label="Appearance background"]').click();
    check.deepEqual(nodeStyles[nodeStyles.length - 1], [beta, {lineColor: "var(--b3-font-background1)"}]);
    blank();
    check.equal(inspector.hidden, true);
    select(beta);
    document.body.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
    check.equal(inspector.hidden, true);
    check.equal(nodeElement(beta).getAttribute("aria-selected"), "false");
    select(alpha);
    relationButton.click();
    blank();
    select(beta);
    check.equal(relationAdditions.length, 0, "outside click cancels pending relation creation");
    relationButton.click();
    select(alpha);
    check.deepEqual(relationAdditions, [[beta, alpha]]);
    model.metadata.relations.push({id: "relation-test", from: alpha, to: beta, label: "Relation"});
    view.update(model);
    await settle();
    view.clearSelection();
    view.setHoveredLine();
    const relationScale = view.scale;
    const primaryColor = host.style.getPropertyValue("--b3-theme-primary");
    host.style.setProperty("--b3-theme-primary", "#123abc");
    const setRelationTheme = (property: string, value: string) =>
        host.style.setProperty(`--b3-mindmap-relation-${property}`, value);
    const checkRelation = (color: string, width: number) => {
        checkLine(color, width);
        check.equal(lineContext.fillStyle, color, "relation arrows share the connector color");
    };
    view.scale = 0.5;
    setLineTheme("color", "#abcdef");
    setLineTheme("width", "9");
    checkRelation("#123abc", 1.5);
    view.setHoveredLine("relation:relation-test");
    checkRelation("#123abc", 4.5);
    view.selectedRelation = "relation-test";
    checkRelation("#123abc", 5.5);
    view.setHoveredLine();
    checkRelation("#123abc", 2.5);
    view.clearSelection();
    setRelationTheme("color", "var(--b3-font-background1)");
    setRelationTheme("width", "2px");
    checkRelation("#123456", 2);
    setRelationTheme("hover-color", "#445566");
    setRelationTheme("hover-width", "4");
    setRelationTheme("selected-color", "#778899");
    setRelationTheme("selected-width", "6px");
    view.setHoveredLine("relation:relation-test");
    checkRelation("#445566", 4);
    view.selectedRelation = "relation-test";
    checkRelation("#778899", 6);
    view.setHoveredLine();
    checkRelation("#778899", 6);
    view.clearSelection();
    const themedRelation = model.metadata.relations[0];
    themedRelation.color = "#aabbcc";
    themedRelation.width = 3;
    checkRelation("#aabbcc", 3);
    view.setHoveredLine("relation:relation-test");
    checkRelation("#aabbcc", 4);
    view.selectedRelation = "relation-test";
    checkRelation("#aabbcc", 6);
    view.selectedRelation = undefined;
    setRelationTheme("hover-color", "invalid-color");
    for (const width of ["auto", "0", "-2", "Infinity", "2em", "3px-invalid"]) {
        setRelationTheme("hover-width", width);
        checkRelation("#aabbcc", 6);
    }
    view.selectedRelation = "relation-test";
    setRelationTheme("selected-color", "initial");
    setRelationTheme("selected-width", "auto");
    checkRelation("#aabbcc", 7);
    view.clearSelection();
    view.setHoveredLine();
    view.relationFrom = alpha;
    view.relationPreview = {targetId: beta};
    checkRelation("#123456", 2);
    setRelationTheme("color", "invalid-color");
    setRelationTheme("width", "-1");
    checkRelation("#123abc", 1.5);
    view.relationFrom = undefined;
    view.relationPreview = undefined;
    delete themedRelation.color;
    delete themedRelation.width;
    checkRelation("#123abc", 1.5);
    view.scale = relationScale;
    themedProperties.forEach(property => {
        host.style.removeProperty(`--b3-mindmap-line-${property}`);
        host.style.removeProperty(`--b3-mindmap-relation-${property}`);
    });
    host.style.setProperty("--b3-theme-primary", primaryColor);
    view.draw();
    host.querySelector<HTMLButtonElement>(".mindmap-view__relation").click();
    const relationElement = host.querySelector<HTMLElement>(".mindmap-view__relation");
    relationElement.dispatchEvent(new PointerEvent("pointerover", {bubbles: true}));
    check.equal(host.querySelector<HTMLElement>('[role="tooltip"]').hidden, true);
    const relationPoint = centerPoint(relationElement);
    sendPointer(relationElement, "pointermove", relationPoint.x, relationPoint.y);
    check.equal(relationElement.classList.contains("mindmap-view__relation--hover"), true);
    viewport.dispatchEvent(new PointerEvent("pointerleave"));
    check.equal(relationElement.classList.contains("mindmap-view__relation--hover"), false);
    check.equal(inspector.hidden, false);
    check.equal(inspector.classList.contains("mindmap-view__inspector--line"), true);
    check.equal(getComputedStyle(inspector).bottom, "8px");
    const lineMenuBounds = inspector.getBoundingClientRect();
    check.ok(Math.abs(lineMenuBounds.left + lineMenuBounds.width / 2 - panelBounds.left - panelBounds.width / 2) < 2);
    check.ok(lineMenuBounds.width < panelBounds.width / 2);
    const routeStatus = host.querySelector<HTMLElement>(".mindmap-view__route-status");
    const statusHidden = routeStatus.hidden;
    routeStatus.hidden = false;
    check.ok(routeStatus.getBoundingClientRect().bottom < lineMenuBounds.top);
    routeStatus.hidden = statusHidden;
    hostParent.style.width = "320px";
    await settle();
    const narrowInspectorBounds = inspector.getBoundingClientRect();
    const narrowPanelBounds = host.getBoundingClientRect();
    check.ok(narrowInspectorBounds.left > narrowPanelBounds.left);
    check.ok(narrowInspectorBounds.right < narrowPanelBounds.right);
    hostParent.style.width = "180px";
    await settle();
    check.ok(inspector.scrollWidth > inspector.clientWidth, "the line menu scrolls when its actual controls no longer fit");
    inspector.scrollLeft = inspector.scrollWidth;
    check.ok(inspector.scrollLeft > 0);
    inspector.scrollLeft = 0;
    hostParent.style.width = "760px";
    await settle();
    check.equal(inspector.querySelector(".mindmap-view__section"), null);
    const arrowSelector = () => inspector.querySelector<HTMLSelectElement>('[aria-label="listMindmapArrowDirection"]');
    check.ok(arrowSelector().classList.contains("b3-select"));
    check.equal(arrowSelector().value, "forward", "old relations show the default arrow direction");
    check.equal(arrowSelector().options.length, 4);
    for (const arrowDirection of ["forward", "reverse", "both", "none"]) {
        const selector = arrowSelector();
        selector.focus();
        const keyboard = new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true});
        selector.dispatchEvent(keyboard);
        check.equal(keyboard.defaultPrevented, false, "direction keys belong to the shared select control");
        selector.value = arrowDirection;
        selector.dispatchEvent(new Event("change", {bubbles: true}));
        check.deepEqual(relationChanges.pop(), ["relation-test", {arrowDirection}]);
        model.metadata.relations[0].arrowDirection = arrowDirection;
        view.update(model);
        await settle();
        check.equal(arrowSelector().value, arrowDirection);
        check.equal(document.activeElement, arrowSelector(), "changing direction preserves keyboard focus");
    }
    delete model.metadata.relations[0].arrowDirection;
    view.update(model);
    await settle();
    host.querySelector(".mindmap-view__relation").dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    const relationLabel = host.querySelector<HTMLInputElement>(".mindmap-view__relation-editor");
    check.equal(document.activeElement, relationLabel);
    check.equal(relationLabel.selectionEnd, relationLabel.value.length);
    relationLabel.value = "Renamed";
    relationLabel.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    check.deepEqual(relationChanges.pop(), ["relation-test", {label: "Renamed"}]);
    check.equal(host.querySelector(".mindmap-view__relation-editor"), null);
    check.equal(getComputedStyle(relationElement).visibility, "hidden", "finishing text editing returns to handle mode");
    host.querySelector<HTMLButtonElement>(".mindmap-view__relation").click();
    host.querySelector(".mindmap-view__relation").dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    const cancelledLabel = host.querySelector<HTMLInputElement>(".mindmap-view__relation-editor");
    cancelledLabel.value = "Cancelled";
    cancelledLabel.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    check.equal(relationChanges.length, 0);
    host.querySelector<HTMLButtonElement>(".mindmap-view__relation").click();
    check.equal(inspector.querySelector("input"), null);
    inspector.querySelector<HTMLButtonElement>('[aria-label="Appearance background"]').click();
    check.deepEqual(relationChanges, [["relation-test", {color: "var(--b3-font-background1)"}]]);
    model.metadata.relations[0].color = "var(--b3-font-background1)";
    view.update(model);
    check.equal(host.querySelector("canvas").getContext("2d").strokeStyle, "#123456");
    pressDelete();
    check.deepEqual(relationDeletions, ["relation-test"]);
    blank();
    check.equal(inspector.hidden, true);
    check.equal(host.querySelector(".mindmap-view__relation--selected"), null);
    await settle();
    check.equal(getComputedStyle(relationElement).visibility, "visible", "deselecting restores relation text");

    const savedRelations = model.metadata.relations;
    // 短连线文字撑开节点间距，文字仍位于所属连线上。
    model.metadata.relations = [];
    view.update(model);
    await settle();
    const siblingGap = () => view.positions.get(beta).y - view.positions.get(alpha).y - view.positions.get(alpha).height;
    const originalGap = siblingGap();
    model.metadata.relations = [{id: "short-label", from: alpha, to: beta, label: "Connection label"}];
    view.update(model);
    await settle();
    const shortLabel = view.relationElements.get("short-label");
    const fromBox = view.positions.get(alpha);
    const toBox = view.positions.get(beta);
    check.ok(siblingGap() >= shortLabel.offsetHeight + 32);
    const labelRoute = view.relationPath("short-label", fromBox, toBox, shortLabel);
    check.ok(labelRoute.labelPoint, "short relations always retain their text");
    check.notEqual(shortLabel.style.visibility, "hidden");
    for (const box of [fromBox, toBox]) {
        const p = labelRoute.labelPoint;
        check.equal(p.x + shortLabel.offsetWidth / 2 > box.x && p.x - shortLabel.offsetWidth / 2 < box.x + box.width &&
            p.y + shortLabel.offsetHeight / 2 > box.y && p.y - shortLabel.offsetHeight / 2 < box.y + box.height, false);
    }
    const routePoints = view.relationRoutes.get("short-label");
    check.ok(routePoints.slice(1).some((point: any, index: number) => {
        const previous = routePoints[index];
        const p = labelRoute.labelPoint;
        return (point.x === previous.x && p.x === point.x && p.y >= Math.min(point.y, previous.y) &&
            p.y <= Math.max(point.y, previous.y)) ||
            (point.y === previous.y && p.y === point.y && p.x >= Math.min(point.x, previous.x) &&
                p.x <= Math.max(point.x, previous.x));
    }), "the label stays on its own connection");
    const beforeHandleGap = siblingGap();
    const beforeHandleLabel = shortLabel.getBoundingClientRect();
    shortLabel.click();
    check.equal(getComputedStyle(shortLabel).visibility, "hidden", "selecting a relation hides its label before dragging");
    const midpointHandle = host.querySelector<HTMLElement>(".mindmap-view__route-handle:not(.mindmap-view__route-endpoint)");
    check.ok(midpointHandle, "text no longer suppresses the segment handle");
    const midpoint = centerPoint(midpointHandle);
    check.equal(document.elementFromPoint(midpoint.x, midpoint.y), midpointHandle, "the drag handle receives the pointer");
    view.refreshLayout();
    await settle();
    check.equal(siblingGap(), beforeHandleGap, "hidden text keeps its layout measurements");
    check.equal(shortLabel.getBoundingClientRect().width, beforeHandleLabel.width);
    view.setReadOnly(true);
    check.equal(getComputedStyle(shortLabel).visibility, "visible", "read-only rendering retains relation text");
    view.setReadOnly(false);
    check.equal(getComputedStyle(shortLabel).visibility, "hidden");
    window.dispatchEvent(new Event("beforeprint"));
    check.equal(getComputedStyle(shortLabel).visibility, "visible", "printing retains selected relation text");
    window.dispatchEvent(new Event("afterprint"));
    check.equal(getComputedStyle(shortLabel).visibility, "hidden");
    blank();
    check.equal(getComputedStyle(shortLabel).visibility, "visible");
    model.metadata.relations[0].label = "";
    view.update(model);
    await settle();
    check.ok(siblingGap() > originalGap, "an unlabeled relation keeps space for its drag handle");
    check.ok(siblingGap() < beforeHandleGap, "removing the label releases its extra text spacing");
    model.metadata.relations = [];
    view.update(model);
    await settle();
    check.equal(siblingGap(), originalGap, "removing the relation restores the compact sibling spacing");
    model.metadata.relations = [
        {id: "forward", from: alpha, to: beta, label: ""},
        {id: "reverse", from: beta, to: alpha, label: ""},
    ];
    view.update(model);
    await settle();
    for (const scale of [0.5, 1, 2]) {
        view.scale = scale;
        view.draw();
        for (const id of ["forward", "reverse"]) {
            const end = view.linePaths.find((line: any) => line.id === id).arrows[0];
            const bounds = viewport.getBoundingClientRect();
            const x = bounds.left + view.offsetX + end.x * scale;
            const y = bounds.top + view.offsetY + end.y * scale;
            sendPointer(viewport, "pointermove", x, y);
            check.equal(view.hoveredLine, `relation:${id}`, "each arrow highlights its own direction");
            sendPointer(viewport, "pointerdown", x, y);
            sendPointer(viewport, "pointerup", x, y);
            check.equal(view.selectedRelation, id, "overlapping reverse relations can be selected independently");
            viewport.dispatchEvent(new MouseEvent("dblclick", {clientX: x, clientY: y, bubbles: true}));
            const input = host.querySelector<HTMLInputElement>(".mindmap-view__relation-editor");
            check.ok(input, "double-clicking either arrow edits its relation label");
            input.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
            pressDelete();
            check.equal(relationDeletions[relationDeletions.length - 1], id);
        }
    }
    // 短尾段仍绘制清晰的箭头，整体很短的双向直连则保留箭头间距。
    const arrowContext = host.querySelector("canvas").getContext("2d");
    const originalMoveTo = arrowContext.moveTo;
    const originalLineTo = arrowContext.lineTo;
    const originalFill = arrowContext.fill;
    let polygon: {x: number, y: number}[] = [];
    let arrows: {x: number, y: number}[][] = [];
    arrowContext.moveTo = (x, y) => { polygon = [{x, y}]; originalMoveTo.call(arrowContext, x, y); };
    arrowContext.lineTo = (x, y) => { polygon.push({x, y}); originalLineTo.call(arrowContext, x, y); };
    arrowContext.fill = () => { arrows.push(polygon); originalFill.call(arrowContext); };
    try {
        const straight = view.relationRoutes.get("forward");
        const start = straight[0];
        const end = straight[straight.length - 1];
        view.relationRoutes.set("forward", [start, {x: end.x + 100, y: start.y},
            {x: end.x + 100, y: end.y - 3}, {x: end.x, y: end.y - 3}, end]);
        view.selectedRelation = undefined;
        view.hoveredLine = undefined;
        for (const scale of [.5, 1, 2]) {
            view.scale = scale;
            arrows = [];
            view.draw();
            const width = (arrow: {x: number, y: number}[]) => Math.hypot(arrow[2].x - arrow[0].x, arrow[2].y - arrow[0].y) * scale;
            check.ok(width(arrows[0]) >= 6.9, "a three-unit tail retains a readable arrow at every zoom level");
            check.ok(width(arrows[1]) <= Math.hypot(end.x - start.x, end.y - start.y) * scale / 3 + .001,
                "short reverse connections retain space between arrowheads");
        }
    } finally {
        arrowContext.moveTo = originalMoveTo;
        arrowContext.lineTo = originalLineTo;
        arrowContext.fill = originalFill;
    }
    view.scale = 1;
    // 拖动短关系线只在松手时保存一次；取消、外部刷新和只读切换丢弃预览。
    model.metadata.relations = [{id: "drag-route", from: alpha, to: beta, label: ""}];
    view.update(model);
    await settle();
    view.selectedRelation = "drag-route";
    view.updateSelection();
    relationChanges.length = 0;
    for (const scale of [.5, 1, 2]) {
        view.scale = scale;
        view.draw();
        host.querySelector<HTMLButtonElement>('.mindmap-view__relation[data-relation-id="drag-route"]').click();
        const edit = inspector.querySelector<HTMLButtonElement>('[aria-label="edit"]');
        check.ok(edit, "short relations expose text editing outside their route handles");
        edit.click();
        const input = host.querySelector<HTMLInputElement>(".mindmap-view__relation-editor");
        check.equal(document.activeElement, input);
        check.equal(input.value, "");
        input.value = "Short connection";
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        check.deepEqual(relationChanges.pop(), ["drag-route", {label: "Short connection"}]);
        check.equal(host.querySelector(".mindmap-view__relation-editor"), null);
        host.querySelector<HTMLButtonElement>('.mindmap-view__relation[data-relation-id="drag-route"]').click();
        inspector.querySelector<HTMLButtonElement>('[aria-label="edit"]').click();
        host.querySelector<HTMLInputElement>(".mindmap-view__relation-editor")
            .dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        check.equal(relationChanges.length, 0);
    }
    view.scale = 1;
    view.draw();
    const automaticRoute = JSON.stringify(view.relationRoutes.get("drag-route"));
    const screenNodes = () => [alpha, beta].map(id => {
        const bounds = nodeElement(id).getBoundingClientRect();
        return {x: bounds.x, y: bounds.y};
    });
    const dragHandle = async (offset: number) => {
        const handle = host.querySelector<HTMLElement>(".mindmap-view__route-handle:not(.mindmap-view__route-endpoint)");
        check.ok(handle, "short relations expose a drag handle");
        const point = centerPoint(handle);
        const horizontal = handle.style.cursor === "ns-resize";
        sendPointer(handle, "pointerdown", point.x, point.y);
        check.ok(view.pointer?.relation);
        sendPointer(viewport, "pointermove", point.x + (horizontal ? 0 : offset), point.y + (horizontal ? offset : 0));
        await settle();
        return {x: point.x + (horizontal ? 0 : offset), y: point.y + (horizontal ? offset : 0)};
    };
    const beforeDragNodes = screenNodes();
    const beforeDragScale = view.scale;
    const blockedEnd = await dragHandle(-35);
    check.equal(view.pointer.relation.valid, false, "a control inside another node's buttons is rejected");
    sendPointer(viewport, "pointerup", blockedEnd.x, blockedEnd.y);
    check.equal(relationChanges.length, 0, "an invalid preview never saves");
    let dragEnd = await dragHandle(110);
    check.equal(view.pointer.relation.valid, true, "dragging a short relation creates a valid path");
    check.notEqual(JSON.stringify(view.relationRoutes.get("drag-route")), automaticRoute);
    check.deepEqual(screenNodes(), beforeDragNodes);
    check.equal(relationChanges.length, 0, "previews do not create transactions");
    viewport.dispatchEvent(new WheelEvent("wheel", {deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true}));
    check.equal(view.scale, beforeDragScale, "zoom stays fixed while dragging");
    sendPointer(viewport, "pointerup", dragEnd.x, dragEnd.y);
    check.equal(relationChanges.length, 1, "release saves exactly once");
    const savedRoute = (relationChanges[0] as any[])[1].route;
    check.equal((relationChanges[0] as any[])[2], JSON.stringify(model.metadata.relations[0]), "save guards against stale relations");
    check.ok(savedRoute.points.length);
    model.metadata.relations[0].route = savedRoute;
    view.update(model);
    await settle();
    check.deepEqual(screenNodes(), beforeDragNodes, "saving the path preserves the camera anchor");
    const savedGeometry = JSON.stringify(view.relationRoutes.get("drag-route"));
    const outwardPoints = view.relationRoutes.get("drag-route");
    const outwardColumn = JSON.parse(automaticRoute)[0].x + 110;
    const returningSegment = outwardPoints.findIndex((point: any, index: number) =>
        point.x === outwardColumn && outwardPoints[index + 1]?.x === outwardColumn);
    const returningHandle = view.routeHandles.get(`drag-route:${returningSegment}`);
    check.ok(returningHandle);
    const returningPoint = centerPoint(returningHandle);
    sendPointer(returningHandle, "pointerdown", returningPoint.x, returningPoint.y);
    sendPointer(viewport, "pointermove", returningPoint.x - 110 * view.scale, returningPoint.y);
    await settle();
    check.equal(view.pointer.relation.valid, true, "a saved outward path can be dragged back between its endpoints");
    check.equal(JSON.stringify(view.relationRoutes.get("drag-route")), automaticRoute);
    sendPointer(viewport, "pointerup", returningPoint.x - 110 * view.scale, returningPoint.y);
    check.equal(relationChanges.length, 2);
    model.metadata.relations[0].route = (relationChanges[1] as any[])[1].route;
    view.update(model);
    await settle();
    check.equal(JSON.stringify(view.relationRoutes.get("drag-route")), automaticRoute, "the returned route persists across refresh");
    model.metadata.relations[0].route = savedRoute;
    view.update(model);
    await settle();
    model.metadata.relations[0].route = {version: 1, points: [{x: 0, y: 0, t: 0}]};
    view.update(model);
    await settle();
    check.equal(view.fallbackRoutes.has("drag-route"), true);
    check.equal(host.querySelector<HTMLElement>(".mindmap-view__route-status").hidden, false);
    check.equal(model.metadata.relations[0].route.points.length, 1, "unavailable routes retain their saved controls");
    model.metadata.relations[0].route = savedRoute;
    view.update(model);
    await settle();
    check.equal(view.fallbackRoutes.has("drag-route"), false);
    check.equal(JSON.stringify(view.relationRoutes.get("drag-route")), savedGeometry);
    relationChanges.length = 0;
    await dragHandle(-15);
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    check.equal(view.pointer, undefined);
    check.equal(JSON.stringify(view.relationRoutes.get("drag-route")), savedGeometry);
    check.equal(relationChanges.length, 0);
    dragEnd = await dragHandle(-15);
    viewport.dispatchEvent(new PointerEvent("pointercancel", {pointerId: 1, bubbles: true}));
    sendPointer(viewport, "pointerup", dragEnd.x, dragEnd.y);
    check.equal(relationChanges.length, 0, "pointer cancellation discards the preview");
    dragEnd = await dragHandle(-15);
    view.update(model);
    sendPointer(viewport, "pointerup", dragEnd.x, dragEnd.y);
    await settle();
    check.equal(relationChanges.length, 0, "remote refresh cancels a stale drag");
    dragEnd = await dragHandle(-15);
    view.setReadOnly(true);
    sendPointer(viewport, "pointerup", dragEnd.x, dragEnd.y);
    check.equal(relationChanges.length, 0);
    check.equal(host.querySelector(".mindmap-view__route-handle:not(.mindmap-view__route-endpoint)"), null, "read-only render has no drag handles");
    await settle();
    check.equal(JSON.stringify(view.relationRoutes.get("drag-route")), savedGeometry, "read-only rendering uses the saved path");
    view.setReadOnly(false);
    view.selectedRelation = "drag-route";
    view.updateSelection();
    await settle();
    const resetEnd = view.linePaths.find((line: any) => line.id === "drag-route").arrows[0];
    const resetBounds = viewport.getBoundingClientRect();
    viewport.dispatchEvent(new MouseEvent("dblclick", {clientX: resetBounds.left + view.offsetX + resetEnd.x * view.scale,
        clientY: resetBounds.top + view.offsetY + resetEnd.y * view.scale, bubbles: true}));
    const lineEditor = host.querySelector<HTMLInputElement>(".mindmap-view__relation-editor");
    check.ok(lineEditor, "double-clicking a manual path edits its text");
    check.equal(relationChanges.length, 0, "double-clicking a line does not reset its route");
    lineEditor.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    host.querySelector(".mindmap-view__route-handle:not(.mindmap-view__route-endpoint)").dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    check.deepEqual(relationChanges.map((change: any[]) => change.slice(0, 2)), [["drag-route", {route: undefined}]],
        "double-clicking the drag handle clears only its manual route");
    delete model.metadata.relations[0].route;
    view.update(model);
    await settle();
    check.equal(JSON.stringify(view.relationRoutes.get("drag-route")), automaticRoute);
    check.equal(host.querySelector(".mindmap-view__relation-editor"), null);
    // 线条本身也可拖动，手柄在不同缩放下保持相同的点击尺寸。
    relationChanges.length = 0;
    const directPoints = view.relationRoutes.get("drag-route");
    const directX = resetBounds.left + view.offsetX + (directPoints[0].x + directPoints[1].x) / 2 * view.scale;
    const directY = resetBounds.top + view.offsetY + (directPoints[0].y + directPoints[1].y) / 2 * view.scale;
    sendPointer(viewport, "pointerdown", directX, directY);
    sendPointer(viewport, "pointermove", directX + 110, directY);
    sendPointer(viewport, "pointerup", directX + 110, directY);
    check.equal(relationChanges.length, 1);
    for (const scale of [.5, 2]) {
        view.scale = scale;
        view.draw();
        const handle = host.querySelector<HTMLElement>(".mindmap-view__route-handle:not(.mindmap-view__route-endpoint)").getBoundingClientRect();
        check.equal(handle.width, 20);
        check.equal(handle.height, 20);
    }
    view.scale = 1;
    view.draw();
    HTMLElement.prototype.setPointerCapture = originalCapture;
    HTMLElement.prototype.hasPointerCapture = originalHasCapture;
    HTMLElement.prototype.releasePointerCapture = originalReleaseCapture;
    relationChanges.length = 0;
    // 使用远离端点的手动路由，保留触屏设备的大触摸目标及真实命中测试。
    model.metadata.relations[0].route = savedRoute;
    view.update(model);
    await settle();
    const nativeRouteHandle = view.routeHandles.get(`drag-route:${returningSegment}`);
    check.ok(nativeRouteHandle);
    const nativeHandle = centerPoint(nativeRouteHandle);
    check.equal(document.elementFromPoint(nativeHandle.x, nativeHandle.y), nativeRouteHandle);
    await nativeInput([
        {type: "mouseMove", ...nativeHandle},
        {type: "mouseDown", ...nativeHandle, button: "left", clickCount: 1},
        {type: "mouseMove", x: nativeHandle.x + 110, y: nativeHandle.y, button: "left"},
        {type: "mouseUp", x: nativeHandle.x + 110, y: nativeHandle.y, button: "left", clickCount: 1},
    ]);
    check.equal(relationChanges.length, 1, "native pointer capture saves a drag exactly once");
    model.metadata.relations[0].route = (relationChanges[0] as any[])[1].route;
    view.update(model);
    await settle();
    const nativeReset = centerPoint(host.querySelector<HTMLElement>(".mindmap-view__route-handle:not(.mindmap-view__route-endpoint)"));
    await nativeInput([
        {type: "mouseMove", ...nativeReset},
        {type: "mouseDown", ...nativeReset, button: "left", clickCount: 1},
        {type: "mouseUp", ...nativeReset, button: "left", clickCount: 1},
        {type: "mouseDown", ...nativeReset, button: "left", clickCount: 2},
        {type: "mouseUp", ...nativeReset, button: "left", clickCount: 2},
    ]);
    check.equal(relationChanges.length, 2, "native double click restores automatic routing despite pointer capture");
    check.deepEqual((relationChanges[1] as any[]).slice(0, 2), ["drag-route", {route: undefined}]);
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.hasPointerCapture = () => false;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
    // 首尾标识分别更换起点和终点，空白、自身、重复连接及取消操作均保留原数据。
    const endpointModel = api.readListMindmap(reset("* Start\n* End\n* Alternate\n"));
    const [startNode, endNode, alternateNode] = endpointModel.root.children;
    endpointModel.metadata.relations = [{id: "endpoint-test", from: startNode.id, to: endNode.id,
        label: "Keep label", color: "red", route: savedRoute}];
    view.update(endpointModel);
    await settle();
    view.selectedRelation = "endpoint-test";
    view.updateSelection();
    check.equal(host.querySelectorAll(".mindmap-view__route-endpoint").length, 2);
    const dragEndpoint = async (endpoint: string, targetId?: string) => {
        const handle = host.querySelector<HTMLElement>(`.mindmap-view__route-endpoint[data-endpoint="${endpoint}"]`);
        const point = centerPoint(handle);
        const target = targetId ? centerPoint(nodeElement(targetId)) : {x: point.x + 100, y: panelBounds.top + 10};
        sendPointer(handle, "pointerdown", point.x, point.y);
        sendPointer(viewport, "pointermove", target.x, target.y);
        await settle();
        check.equal(host.querySelectorAll(".mindmap-view__route-endpoint").length, 2, "both endpoints remain marked during a drag");
        return target;
    };
    for (const endpoint of ["from", "to"]) {
        relationChanges.length = 0;
        const target = await dragEndpoint(endpoint, alternateNode.id);
        check.equal(view.pointer.relation.valid, true);
        check.ok(nodeElement(alternateNode.id).classList.contains("mindmap-view__node--relation"));
        check.equal(relationChanges.length, 0);
        sendPointer(viewport, "pointerup", target.x, target.y);
        check.deepEqual((relationChanges[0] as any[]).slice(0, 2), ["endpoint-test", {[endpoint]: alternateNode.id, route: undefined}]);
        check.equal(relationChanges.length, 1);
        check.equal((relationChanges[0] as any[])[2], JSON.stringify(endpointModel.metadata.relations[0]));
        await settle();
    }
    relationChanges.length = 0;
    for (const targetId of [undefined, startNode.id, endpointModel.root.id]) {
        const target = await dragEndpoint("to", targetId);
        check.equal(view.pointer.relation.valid, false);
        sendPointer(viewport, "pointerup", target.x, target.y);
        check.equal(relationChanges.length, 0);
        await settle();
    }
    const cancelTarget = await dragEndpoint("to", alternateNode.id);
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    sendPointer(viewport, "pointerup", cancelTarget.x, cancelTarget.y);
    check.equal(relationChanges.length, 0);
    await settle();
    HTMLElement.prototype.setPointerCapture = originalCapture;
    HTMLElement.prototype.hasPointerCapture = originalHasCapture;
    HTMLElement.prototype.releasePointerCapture = originalReleaseCapture;
    const nativeStart = centerPoint(host.querySelector<HTMLElement>('.mindmap-view__route-endpoint[data-endpoint="from"]'));
    const nativeTarget = centerPoint(nodeElement(alternateNode.id));
    await nativeInput([
        {type: "mouseMove", ...nativeStart},
        {type: "mouseDown", ...nativeStart, button: "left", clickCount: 1},
        {type: "mouseMove", ...nativeTarget, button: "left"},
        {type: "mouseUp", ...nativeTarget, button: "left", clickCount: 1},
    ]);
    check.equal(relationChanges.length, 1, "native endpoint capture reconnects the start node once");
    check.deepEqual((relationChanges[0] as any[]).slice(0, 2), ["endpoint-test", {from: alternateNode.id, route: undefined}]);
    relationChanges.length = 0;
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.hasPointerCapture = () => false;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
    endpointModel.metadata.relations.push({id: "existing", from: startNode.id, to: alternateNode.id, label: ""});
    view.update(endpointModel);
    await settle();
    const duplicateTarget = await dragEndpoint("to", alternateNode.id);
    check.equal(view.pointer.relation.valid, false);
    sendPointer(viewport, "pointerup", duplicateTarget.x, duplicateTarget.y);
    check.equal(relationChanges.length, 0);
    view.setReadOnly(true);
    check.equal(host.querySelectorAll(".mindmap-view__route-endpoint").length, 0);
    view.setReadOnly(false);
    model.metadata.relations = savedRelations;
    view.update(model);

    // 打印收紧画布高度，结束打印后恢复屏幕上的缩放和平移。
    await settle();
    const screenTransform = [view.scale, view.offsetX, view.offsetY];
    const screenHeight = host.offsetHeight;
    await require("electron").ipcRenderer.invoke("mindmap-view-print-media", "print");
    window.dispatchEvent(new Event("beforeprint"));
    await settle();
    check.ok(host.offsetHeight < screenHeight, "PDF does not retain the fixed editor canvas height");
    check.equal(getComputedStyle(selectionInput).display, "none", "printing excludes the IME input target");
    const printBounds = viewport.getBoundingClientRect();
    for (const node of view.positions.values()) {
        check.ok(node.x * view.scale + view.offsetX >= 0);
        check.ok((node.x + node.width) * view.scale + view.offsetX <= printBounds.width + 1);
        check.ok(node.y * view.scale + view.offsetY >= 0);
        check.ok((node.y + node.height) * view.scale + view.offsetY <= printBounds.height + 1);
    }
    await require("electron").ipcRenderer.invoke("mindmap-view-print-media", "screen");
    window.dispatchEvent(new Event("afterprint"));
    await settle();
    check.equal(host.offsetHeight, screenHeight);
    check.deepEqual([view.scale, view.offsetX, view.offsetY], screenTransform);

    // 锁定保留当前画面，滚轮与触摸交给文档，解锁后恢复原有编辑权限。
    const lockTransform = [view.scale, view.offsetX, view.offsetY];
    const editsBeforeLock = edits.length;
    const foldsBeforeLock = folds.length;
    host.querySelector<HTMLButtonElement>('[aria-label="listMindmapLock"]').click();
    await settle();
    check.equal(view.isLocked(), true);
    check.equal(getComputedStyle(viewport).touchAction, "pan-y");
    check.ok(host.querySelector('[aria-label="listMindmapUnlock"]'));
    check.equal(getComputedStyle(toolbar).opacity, "1", "locked maps keep the unlock entry visible");
    check.equal(host.querySelector('[aria-label="listMindmapUnlock"]').getAttribute("aria-pressed"), "true");
    check.equal(host.querySelector('[aria-label="cursorHand"]'), null);
    for (const ctrlKey of [false, true]) {
        const wheel = new WheelEvent("wheel", {bubbles: true, cancelable: true, deltaY: 120, ctrlKey});
        viewport.dispatchEvent(wheel);
        check.equal(wheel.defaultPrevented, false);
    }
    const finger = (identifier: number, clientX: number) => new Touch({identifier, target: viewport, clientX, clientY: 100});
    viewport.dispatchEvent(new TouchEvent("touchstart", {bubbles: true, cancelable: true, touches: [finger(1, 100), finger(2, 200)]}));
    viewport.dispatchEvent(new TouchEvent("touchmove", {bubbles: true, cancelable: true, touches: [finger(1, 50), finger(2, 250)]}));
    sendPointer(viewport, "pointerdown", 100, 100);
    sendPointer(viewport, "pointermove", 200, 200);
    sendPointer(viewport, "pointerup", 200, 200);
    nodeElement(beta).dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    nodeElement(model.root.id).querySelector<HTMLButtonElement>(".mindmap-view__fold").click();
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    await settle();
    check.deepEqual([view.scale, view.offsetX, view.offsetY], lockTransform);
    check.equal(edits.length, editsBeforeLock);
    check.equal(folds.length, foldsBeforeLock);
    view.setReadOnly(true);
    host.querySelector<HTMLButtonElement>('[aria-label="listMindmapUnlock"]').click();
    await settle();
    check.equal(view.isLocked(), false);
    check.equal(getComputedStyle(viewport).touchAction, "pan-y");
    nodeElement(beta).dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    check.equal(edits.length, editsBeforeLock, "unlocking a read-only document does not enable editing");
    view.setReadOnly(false);
    const savedLock = {...model, metadata: {...model.metadata, viewLocked: true}};
    view.update(savedLock);
    check.equal(view.isLocked(), true);
    view.update(model);
    check.equal(view.isLocked(), false, "undoing a saved lock updates the live view");

    // 全屏使用编辑器同款窗口内布局，不调用浏览器全屏，并在退出和销毁时恢复原位置。
    Object.defineProperty(host, "requestFullscreen", {configurable: true, value: () => check.fail("Native fullscreen must not be requested")});
    hostParent.style.transform = "translateX(5px)";
    hostParent.style.overflow = "hidden";
    host.querySelector<HTMLButtonElement>('[aria-label="fullscreen"]').click();
    await settle();
    check.equal(host.parentElement, document.body);
    check.equal(host.classList.contains("fullscreen"), true);
    check.equal(host.querySelector(".mindmap-view__toolbar").classList.contains("block__icons"), true);
    check.equal(host.getBoundingClientRect().left, 0);
    check.equal(host.getBoundingClientRect().width, window.innerWidth);
    check.equal(getComputedStyle(host).zIndex, "8");
    select(beta);
    check.equal(inspector.hidden, false);
    check.ok(host.getBoundingClientRect().bottom - inspector.getBoundingClientRect().bottom >= 8);
    check.deepEqual(fullscreenChanges, [true]);
    view.setReadOnly(true);
    check.ok(host.querySelector('[aria-label="exitFullscreen"]'));
    view.setReadOnly(false);
    host.querySelector<HTMLButtonElement>('[aria-label="exitFullscreen"]').click();
    check.equal(host.parentElement, hostParent);
    check.equal(host.classList.contains("fullscreen"), false);
    check.deepEqual(fullscreenChanges, [true, false]);
    host.querySelector<HTMLButtonElement>('[aria-label="fullscreen"]').click();
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    check.equal(host.parentElement, hostParent);
    check.equal(host.classList.contains("fullscreen"), false);
    check.equal(host.querySelector(".mindmap-view__toolbar").classList.contains("block__icons"), true);
    host.querySelector<HTMLButtonElement>('[aria-label="fullscreen"]').click();
    view.destroy();
    check.equal(host.parentElement, hostParent);
    check.equal(host.classList.contains("fullscreen"), false);
    check.deepEqual(fullscreenChanges, [true, false, true, false, true, false]);
    check.equal(Array.from(hostParent.childNodes).some(node => node.nodeType === Node.COMMENT_NODE), false);
    hostParent.style.transform = "";
    hostParent.style.overflow = "";

    const readonly = new api.ListMindmapView({...options, readOnly: true});
    await settle();
    check.equal(host.querySelector('.mindmap-view__toolbar [aria-label="listMindmapChild"]'), null);
    check.equal(host.querySelector('[aria-label="undo"]'), null);
    const editsBeforeReadonly = edits.length;
    nodeElement(beta).dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    host.dispatchEvent(new KeyboardEvent("keydown", {key: "z", ctrlKey: true, bubbles: true}));
    check.equal(edits.length, editsBeforeReadonly);
    const persistedBeforeFold = list.outerHTML;
    pressDelete();
    check.deepEqual(deletions, [beta]);
    const beforeCollapse = nodeElement(model.root.id).getBoundingClientRect();
    const foldContext = readonly.canvas.getContext("2d");
    const originalStroke = foldContext.stroke.bind(foldContext);
    const foldAlphas: number[] = [];
    foldContext.stroke = (path?: Path2D) => {
        foldAlphas.push(foldContext.globalAlpha);
        if (path) {
            originalStroke(path);
        } else {
            originalStroke();
        }
    };
    nodeElement(model.root.id).querySelector<HTMLButtonElement>(".mindmap-view__fold").click();
    await settle();
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        check.ok(readonly.stopFoldAnimation, "a user fold starts a visible transition");
        check.equal(nodeElement(alpha).hidden, false, "outgoing children remain visible during the transition");
        check.equal(nodeElement(alpha).inert, true, "outgoing children cannot receive pointer or keyboard input");
        check.ok(Number(nodeElement(alpha).style.opacity) > 0 && Number(nodeElement(alpha).style.opacity) < 1);
        check.ok(foldAlphas.some(alpha => alpha > 0 && alpha < 1), "real canvas connectors fade together with their nodes");
        check.ok(Math.abs(nodeElement(model.root.id).getBoundingClientRect().y - beforeCollapse.y) < 1,
            "the root stays anchored throughout the animation");
    }
    await settleFold(readonly);
    foldContext.stroke = originalStroke;
    const afterCollapse = nodeElement(model.root.id).getBoundingClientRect();
    check.ok(Math.abs(afterCollapse.y - beforeCollapse.y) < 1, "collapse keeps the root at its screen position");
    check.equal(nodeElement(alpha).hidden, true);
    const foldedButton = nodeElement(model.root.id).querySelector<HTMLButtonElement>(".mindmap-view__fold");
    check.equal(foldedButton.querySelector("span").textContent, String(model.nodes.size - 1));
    check.equal(getComputedStyle(foldedButton).visibility, "visible");
    foldedButton.click();
    await settle();
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        check.ok(readonly.stopFoldAnimation,
            "showing folded children must not let size observers end the expansion early");
        check.ok(Number(nodeElement(alpha).style.opacity) > 0 && Number(nodeElement(alpha).style.opacity) < 1,
            "newly visible children retain an intermediate expansion frame after size notifications");
    }
    await settleFold(readonly);
    check.equal(nodeElement(alpha).hidden, false);
    const afterExpand = nodeElement(model.root.id).getBoundingClientRect();
    check.ok(Math.abs(afterExpand.y - afterCollapse.y) < 1, "expansion keeps the root stable after size observers settle");
    check.ok(Math.abs(afterExpand.x - afterCollapse.x) < 1, "expansion preserves horizontal position");
    check.equal(list.outerHTML, persistedBeforeFold);
    foldedButton.click();
    await settle();
    foldedButton.click();
    await settleFold(readonly);
    check.equal(nodeElement(alpha).hidden, false, "rapid fold reversals finish in the latest requested state");
    check.equal(nodeElement(alpha).style.opacity, "");
    check.equal(nodeElement(alpha).inert, false);
    foldedButton.click();
    await settleFold(readonly);
    foldedButton.click();
    await settle();
    const measuredWidth = nodeElement(alpha).offsetWidth;
    nodeElement(alpha).style.minWidth = `${measuredWidth + 40}px`;
    await settle();
    check.equal(readonly.stopFoldAnimation, undefined,
        "a genuine node size change still ends the transition and lays out its new dimensions");
    check.equal(readonly.positions.get(alpha).width, nodeElement(alpha).offsetWidth);
    check.ok(readonly.positions.get(alpha).width > measuredWidth);
    nodeElement(alpha).style.minWidth = "";
    await settle();
    const levelSelect = host.querySelector<HTMLSelectElement>(".mindmap-view__level-select");
    check.deepEqual(Array.from(levelSelect.options).map(option => option.value),
        ["", "expandAll", "foldAll", "1", "2", "3", "4", "5", "6"]);
    const levelChild = model.nodes.get(alpha).children[0].id;
    readonly.selectNode(levelChild);
    const scaleBeforeLevel = readonly.scale;
    const beforeLevel = nodeElement(alpha).getBoundingClientRect();
    levelSelect.value = "1";
    levelSelect.dispatchEvent(new Event("change", {bubbles: true}));
    await settleFold(readonly);
    check.equal(nodeElement(levelChild).hidden, true);
    check.equal(nodeElement(alpha).hidden, false);
    check.equal(readonly.selectedId, alpha, "a hidden selection moves to its visible ancestor");
    check.equal(readonly.scale, scaleBeforeLevel);
    check.ok(Math.abs(nodeElement(alpha).getBoundingClientRect().y - beforeLevel.y) < 1);
    check.equal(list.outerHTML, persistedBeforeFold, "exported and read-only level changes never write the list");
    levelSelect.value = "foldAll";
    levelSelect.dispatchEvent(new Event("change", {bubbles: true}));
    await settleFold(readonly);
    check.equal(nodeElement(alpha).hidden, true);
    check.equal(readonly.selectedId, model.root.id);
    levelSelect.value = "expandAll";
    levelSelect.dispatchEvent(new Event("change", {bubbles: true}));
    await settleFold(readonly);
    check.equal(nodeElement(levelChild).hidden, false);
    check.equal(list.outerHTML, persistedBeforeFold);
    readonly.destroy();

    let chooseLevel: (level: ListMindmapFoldTarget) => void;
    let levelSaveAllowed = true;
    let levelSaves = 0;
    const levelView = new api.ListMindmapView({...options,
        onExpandLevelMenu: (anchor: HTMLElement, choose: (level: ListMindmapFoldTarget) => void) => {
            check.equal(anchor.getAttribute("aria-label"), "expandLevel");
            chooseLevel = choose;
        },
        onFoldLevel: async (level: ListMindmapFoldTarget) => {
            if (!levelSaveAllowed) {
                return false;
            }
            levelSaves++;
            const next = api.readListMindmap(list);
            const pending = [{node: next.root, depth: 1}];
            while (pending.length) {
                const current = pending.pop();
                if (current.node.children.length) {
                    const collapsed = level === "foldAll" || (typeof level === "number" && current.depth > level);
                    current.node.element?.setAttribute("fold", collapsed ? "1" : "0");
                    if (!collapsed) {
                        current.node.children.forEach((node: unknown) => pending.push({node, depth: current.depth + 1}));
                    }
                }
            }
            model = api.readListMindmap(list);
            levelView.update(model);
            return true;
        },
    });
    await settle();
    const levelButton = host.querySelector<HTMLButtonElement>('.mindmap-view__toolbar button[aria-label="expandLevel"]');
    check.equal(levelButton.previousElementSibling.getAttribute("aria-label"), "multiSelect");
    check.equal(levelButton.previousElementSibling.previousElementSibling.getAttribute("aria-label"), "listMindmapLock");
    check.equal(levelButton.nextElementSibling.getAttribute("aria-label"), "cursorHand");
    check.equal(host.querySelector(".mindmap-view__level-select"), null);
    levelView.selectNode(levelChild);
    await clickMouse(levelButton);
    levelView.clearSelection();
    chooseLevel(1);
    await settleFold(levelView);
    check.equal(levelSaves, 1);
    check.equal(levelView.selectedId, alpha, "menu clicks retain the selection anchor despite outside-pointer dismissal");
    check.equal(nodeElement(levelChild).hidden, true);
    check.equal(model.nodes.get(alpha).element.getAttribute("fold"), "1");
    levelSaveAllowed = false;
    levelButton.click();
    chooseLevel("expandAll");
    await settleFold(levelView);
    check.equal(nodeElement(levelChild).hidden, true, "failed saves do not apply optimistic folding overrides");
    levelSaveAllowed = true;
    levelButton.click();
    chooseLevel("expandAll");
    await settleFold(levelView);
    check.equal(nodeElement(levelChild).hidden, false);
    levelButton.click();
    chooseLevel("foldAll");
    await settleFold(levelView);
    check.equal(nodeElement(alpha).hidden, true, "the virtual center participates in batch folding");
    levelButton.click();
    chooseLevel(1);
    await settleFold(levelView);
    check.equal(nodeElement(alpha).hidden, false, "level selection expands a previously folded virtual center");
    levelView.destroy();

    // Alt 点击只切换同一父节点下的分支，普通点击和只读视图沿用各自的折叠行为。
    const siblingHolder = document.createElement("div");
    siblingHolder.innerHTML = lute.Md2BlockDOM("* First\n  * A\n    * A child\n      * A grandchild\n  * B\n    * B child\n  * Leaf\n* Second\n  * C\n    * C child\n");
    const siblingList = siblingHolder.firstElementChild as HTMLElement;
    const siblingHost = document.createElement("div");
    siblingHost.className = "mindmap-view";
    hostParent.append(siblingHost);
    let siblingModel = api.readListMindmap(siblingList);
    const [a, b, leaf] = siblingModel.root.children[0].children;
    const c = siblingModel.root.children[1].children[0];
    const deep = a.children[0];
    deep.element.setAttribute("fold", "1");
    siblingModel = api.readListMindmap(siblingList);
    const siblingSource = siblingList.outerHTML;
    let siblingFinishAllowed: boolean | Promise<boolean> = true;
    let siblingSaveAllowed = true;
    let siblingSaves = 0;
    const siblingView = new api.ListMindmapView({host: siblingHost, model: siblingModel, readOnly: true,
        finishEdit: () => siblingFinishAllowed,
        onFoldSiblings: async (id: string) => {
            if (!siblingSaveAllowed) {
                return false;
            }
            api.getListMindmapSiblingFoldStates(siblingModel, id).forEach((collapsed: boolean, siblingID: string) => {
                siblingModel.nodes.get(siblingID).element?.setAttribute("fold", collapsed ? "1" : "0");
            });
            siblingSaves++;
            siblingModel = api.readListMindmap(siblingList);
            siblingView.update(siblingModel);
            return true;
        },
    });
    const siblingElement = (id: string) => siblingHost.querySelector<HTMLElement>(`[data-mindmap-id="${id}"]`);
    const clickSiblingFold = async (id: string, altKey = true) => {
        siblingElement(id).querySelector(".mindmap-view__fold").dispatchEvent(new MouseEvent("click", {
            bubbles: true, altKey,
        }));
        await settleFold(siblingView);
    };
    await settle();
    const navigateSibling = (key: string, expected: string) => {
        const event = new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true});
        siblingHost.dispatchEvent(event);
        check.equal(event.defaultPrevented, true);
        check.equal(siblingView.selectedId, expected);
    };
    siblingView.focusNode(a.id);
    navigateSibling("ArrowUp", a.id);
    navigateSibling("ArrowDown", b.id);
    navigateSibling("ArrowDown", leaf.id);
    navigateSibling("ArrowDown", c.id);
    navigateSibling("ArrowDown", c.id);
    navigateSibling("ArrowUp", leaf.id);
    siblingView.focusNode(deep.id);
    navigateSibling("ArrowDown", b.children[0].id);
    navigateSibling("ArrowDown", c.children[0].id);
    navigateSibling("ArrowUp", b.children[0].id);
    await clickSiblingFold(b.id, false);
    siblingView.focusNode(deep.id);
    navigateSibling("ArrowDown", c.children[0].id);
    navigateSibling("ArrowUp", deep.id);
    await clickSiblingFold(b.id, false);
    await clickSiblingFold(a.id, false);
    check.equal(siblingElement(deep.id).hidden, true, "ordinary clicks only fold the clicked node");
    check.equal(siblingElement(b.children[0].id).hidden, false);
    await clickSiblingFold(b.id);
    check.equal(siblingElement(b.children[0].id).hidden, true, "mixed sibling states fold together");
    check.equal(siblingElement(c.children[0].id).hidden, false, "branches under other parents are untouched");
    check.equal(siblingElement(leaf.id).hidden, false);
    await clickSiblingFold(a.id);
    check.equal(siblingElement(deep.id).hidden, false);
    check.equal(siblingElement(deep.children[0].id).hidden, true, "deeper folding states survive sibling expansion");
    check.equal(siblingElement(b.children[0].id).hidden, false);
    check.equal(siblingList.outerHTML, siblingSource, "read-only sibling folding never writes source attributes");
    check.equal(siblingSaves, 0);
    siblingModel.metadata.viewLocked = true;
    siblingView.update(siblingModel);
    await clickSiblingFold(a.id);
    check.equal(siblingElement(deep.id).hidden, false, "locked views ignore Alt folding");
    siblingModel.metadata.viewLocked = false;
    siblingView.update(siblingModel);
    siblingView.setReadOnly(false);
    siblingSaveAllowed = false;
    await clickSiblingFold(a.id);
    check.equal(siblingElement(deep.id).hidden, false, "failed saves do not change sibling visibility");
    check.equal(siblingList.outerHTML, siblingSource);
    siblingSaveAllowed = true;
    siblingFinishAllowed = false;
    await clickSiblingFold(a.id);
    check.equal(siblingSaves, 0, "failed editor completion blocks sibling folding");
    siblingFinishAllowed = Promise.resolve(true);
    siblingView.selectNode(deep.id);
    await clickSiblingFold(b.id);
    check.equal(siblingSaves, 1);
    check.equal(siblingView.selectedId, a.id, "hidden selections move to the visible ancestor");
    check.equal(siblingElement(deep.id).hidden, true);
    check.equal(siblingElement(b.children[0].id).hidden, true);
    check.equal(siblingModel.nodes.get(c.id).collapsed, false);
    await clickSiblingFold(a.id);
    check.equal(siblingSaves, 2);
    check.equal(siblingElement(deep.id).hidden, false);
    check.equal(siblingElement(deep.children[0].id).hidden, true);
    siblingView.setReadOnly(true);
    await clickSiblingFold(siblingModel.root.id);
    check.equal(siblingElement(a.id).hidden, true, "a virtual center folds locally even without a parent");
    await clickSiblingFold(siblingModel.root.id);
    check.equal(siblingElement(a.id).hidden, false);
    siblingView.destroy();
    siblingHost.remove();
    list.outerHTML = persistedBeforeFold;
    list = holder.querySelector<HTMLElement>('[data-type="NodeList"]');
    model = api.readListMindmap(list);
    options.model = model;

    const titleView = new api.ListMindmapView({...options, onRootTitleChange: (title: string) => {
        model.metadata.rootTitle = title;
        api.writeListMindmapMetadata(list, model.metadata);
        titleView.update(model);
    }});
    await settle();
    const renameRoot = async (title: string, key: string) => {
        const node = nodeElement(model.root.id);
        const before = {width: node.offsetWidth, height: node.offsetHeight};
        titleView.getContentHost(model.root.id).dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
        const input = host.querySelector<HTMLTextAreaElement>(".mindmap-view__root-title");
        check.ok(input, "virtual root supports inline title editing");
        if (model.metadata.rootTitle) {
            check.deepEqual({width: node.offsetWidth, height: node.offsetHeight}, before,
                "entering named root title editing preserves dimensions");
        } else {
            check.equal(before.width, before.height, "the unnamed root is a compact square");
            check.equal(input.value, "", "editing an unnamed root starts with empty text");
        }
        input.value = "A long root title that grows while typing";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        await settle();
        const expanded = node.offsetWidth;
        input.value = "A";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        await settle();
        check.ok(node.offsetWidth < expanded, "root title resizes before leaving the editor");
        input.value = title;
        input.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true}));
    };
    await renameRoot("Custom root", "Enter");
    check.equal(api.readListMindmap(list).metadata.rootTitle, "Custom root");
    check.equal(titleView.getContentHost(model.root.id).textContent, "Custom root");
    await renameRoot("Canceled title", "Escape");
    check.equal(titleView.getContentHost(model.root.id).textContent, "Custom root");
    await renameRoot("", "Enter");
    check.equal(titleView.getContentHost(model.root.id).textContent, "");
    check.ok(nodeElement(model.root.id).classList.contains("mindmap-view__node--untitled"));
    check.equal(nodeElement(model.root.id).offsetWidth, nodeElement(model.root.id).offsetHeight);
    titleView.destroy();

    const singleList = reset("* Single\n");
    const single = new api.ListMindmapView({...options, model: api.readListMindmap(singleList)});
    await settle();
    check.equal(single.scale, 1, "initial layout keeps a single node at its normal size");
    const initialTransform = [single.scale, single.offsetX, single.offsetY];
    const panButton = host.querySelector<HTMLButtonElement>('[aria-label="cursorHand"]');
    const panViewport = host.querySelector<HTMLElement>(".mindmap-view__viewport");
    check.equal(getComputedStyle(panViewport).cursor, "default");
    check.equal(getComputedStyle(host.querySelector(".mindmap-view__node")).cursor, "default");
    check.equal(panButton.querySelector("use").getAttribute("xlink:href"), "#iconPan");
    check.equal(panButton.hidden, true, "the inactive hand tool is available through More without taking toolbar space");
    enableHand(host);
    check.equal(panButton.hidden, false, "the active mode provides a direct exit button");
    check.equal(panButton.getAttribute("aria-pressed"), "true");
    check.equal(getComputedStyle(panViewport).cursor, "grab");
    const panNode = host.querySelector<HTMLElement>(".mindmap-view__node");
    check.equal(getComputedStyle(panNode).pointerEvents, "none");
    const panBefore = {x: single.offsetX, y: single.offsetY};
    panNode.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerId: 81, clientX: 100, clientY: 100}));
    panNode.dispatchEvent(new PointerEvent("pointermove", {bubbles: true, pointerId: 81, clientX: 140, clientY: 125}));
    check.equal(getComputedStyle(panViewport).cursor, "grabbing");
    for (const platform of ["body--linux", "body--windows", "body--mac", "body--android", "body--ios", "body--harmony"]) {
        document.body.classList.add(platform);
        check.equal(getComputedStyle(panViewport).cursor, "grabbing",
            `${platform} hand-tool dragging uses the platform cursor`);
        document.body.classList.remove(platform);
    }
    panNode.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, pointerId: 81, clientX: 140, clientY: 125}));
    check.equal(getComputedStyle(panViewport).cursor, "grab");
    check.equal(single.offsetX, panBefore.x + 40, "hand tool pans from a node instead of moving it");
    check.equal(single.offsetY, panBefore.y + 25);
    check.equal(host.querySelector(".mindmap-view__ghost"), null);
    panButton.click();
    check.equal(panButton.getAttribute("aria-pressed"), "false");
    check.equal(panButton.hidden, true);
    check.equal(getComputedStyle(panViewport).cursor, "default");
    check.ok(getComputedStyle(panNode).pointerEvents !== "none");
    single.zoomAt(2.5);
    check.equal(single.scale, 2.5, "manual zoom can still enlarge a small map");
    host.querySelector<HTMLButtonElement>('[aria-label="listMindmapFit"]').click();
    check.deepEqual([single.scale, single.offsetX, single.offsetY], initialTransform,
        "fit restores the initial position and scale after panning and zooming");
    const fitViewport = host.querySelector<HTMLElement>(".mindmap-view__viewport").getBoundingClientRect();
    const fitNode = host.querySelector<HTMLElement>(".mindmap-view__node").getBoundingClientRect();
    check.ok(Math.abs((fitNode.left + fitNode.right) / 2 - (fitViewport.left + fitViewport.right) / 2) < 1,
        "fit centers visible content instead of layout padding");
    const fitInspector = host.querySelector<HTMLElement>(".mindmap-view__inspector");
    fitInspector.hidden = false;
    single.fit();
    check.deepEqual(host.querySelector<HTMLElement>(".mindmap-view__node").getBoundingClientRect().toJSON(),
        fitNode.toJSON(), "opening the inspector preserves fit position and scale");
    check.ok(host.querySelector<HTMLElement>(".mindmap-view__node").getBoundingClientRect().bottom <=
        fitInspector.getBoundingClientRect().top, "fit keeps content above the visible inspector");
    fitInspector.hidden = true;

    // 阅读时保留文档滚动，激活后平移受裁切的画布，边界处也维持滚动归属。
    {
        let markdown = "* Root\n";
        for (let depth = 1; depth <= 7; depth++) {
            markdown += `${"  ".repeat(depth)}* Branch ${depth}\n`;
        }
        for (let index = 0; index < 12; index++) {
            markdown += `${"  ".repeat(8)}* Leaf ${index}\n`;
        }
        const panModel = api.readListMindmap(reset(markdown));
        const scrollHost = document.createElement("div");
        scrollHost.className = "protyle-content";
        scrollHost.style.cssText = "height: 340px; overflow-y: auto;";
        const panHost = document.createElement("div");
        panHost.style.cssText = "width: 400px; height: 300px;";
        const followingContent = document.createElement("div");
        followingContent.style.height = "3000px";
        scrollHost.append(panHost, followingContent);
        document.body.append(scrollHost);
        const panView = new api.ListMindmapView({...options, host: panHost, model: panModel});
        await settle();
        panView.zoomAt(1);
        const rootPosition = panView.positions.get(panModel.root.id);
        panView.offsetX = 16 - rootPosition.x;
        panView.offsetY = 120 - rootPosition.y;
        panView.draw();
        const viewport = panHost.querySelector<HTMLElement>(".mindmap-view__viewport");
        const sourceHTML = panModel.list.outerHTML;
        const readingTransform = [panView.scale, panView.offsetX, panView.offsetY];
        for (const pointerType of ["mouse", "touch"]) {
            let draws = 0;
            const draw = panView.draw.bind(panView);
            panView.draw = () => { draws++; draw(); };
            const start = [panView.offsetX, panView.offsetY];
            panView.pointer = {pointerId: 900, pan: true, x: start[0], y: start[1],
                startX: 100, startY: 100, moved: true};
            for (let step = 1; step <= 60; step++) {
                panView.pointerMove({pointerId: 900, pointerType, clientX: 100 + step / 10,
                    clientY: 100 + step / 10, preventDefault: () => {}});
            }
            check.equal(draws, 0, "rapid pan input is coalesced before paint");
            check.ok(Math.abs(panView.offsetX - start[0] - 6) < 1e-9 &&
                Math.abs(panView.offsetY - start[1] - 6) < 1e-9);
            panView.cancelPointer();
            await settle();
            check.equal(draws, 1, "release before paint still draws the final position once");
            const world = panHost.querySelector<HTMLElement>(".mindmap-view__world");
            const matrix = new DOMMatrix(getComputedStyle(world).transform);
            check.ok(Math.abs(matrix.e - panView.offsetX) < .001 && Math.abs(matrix.f - panView.offsetY) < .001,
                "rendered nodes reach the final pointer position");
            panView.draw = draw;
        }
        panView.offsetX = readingTransform[1];
        panView.offsetY = readingTransform[2];
        panView.draw();
        check.equal(panView.interactionActive, false);
        check.equal(getComputedStyle(viewport).touchAction, "pan-y");
        const readingWheel = new WheelEvent("wheel", {deltaY: 120, bubbles: true, cancelable: true});
        viewport.dispatchEvent(readingWheel);
        check.equal(readingWheel.defaultPrevented, false);
        check.deepEqual([panView.scale, panView.offsetX, panView.offsetY], readingTransform);
        const touch = {pointerId: 601, pointerType: "touch", isPrimary: true, button: 0,
            clientX: 100, clientY: 100, bubbles: true, cancelable: true};
        const readingTouch = new PointerEvent("pointerdown", touch);
        viewport.dispatchEvent(readingTouch);
        check.equal(readingTouch.defaultPrevented, false);
        check.equal(panView.pointer, undefined);
        check.equal(panView.interactionActive, false);
        scrollHost.scrollIntoView({block: "start"});
        await settle();
        const readingBounds = viewport.getBoundingClientRect();
        const readingPoint = {x: Math.round(readingBounds.left + 100), y: Math.round(readingBounds.top + 220)};
        check.equal(document.elementFromPoint(readingPoint.x, readingPoint.y)?.closest(".mindmap-view"), panHost,
            JSON.stringify({readingPoint, readingBounds: readingBounds.toJSON(), height: window.innerHeight}));
        await nativeInput([
            {type: "mouseMove", ...readingPoint},
            {type: "mouseWheel", ...readingPoint, deltaX: 0, deltaY: -100, canScroll: true},
        ]);
        await new Promise(resolve => setTimeout(resolve, 100));
        check.ok(scrollHost.scrollTop > 0, "native reading wheel scrolls the document over a clipped map");
        scrollHost.scrollTop = 0;
        const nativeTouch = (events: Record<string, unknown>[]) =>
            require("electron").ipcRenderer.invoke("mindmap-view-native-touch", events);
        const fingerAt = (id: number, dx = 0, dy = 0) => ({id, x: readingPoint.x + dx, y: readingPoint.y + dy});
        await nativeTouch([
            {type: "touchStart", touchPoints: [fingerAt(1)]},
            ...[-20, -40, -60, -80, -100].map(dy => ({type: "touchMove", touchPoints: [fingerAt(1, 0, dy)]})),
            {type: "touchEnd", touchPoints: []},
        ]);
        await new Promise(resolve => setTimeout(resolve, 200));
        check.ok(scrollHost.scrollTop > 0, "native one-finger reading swipe scrolls the document");
        check.deepEqual([panView.scale, panView.offsetX, panView.offsetY], readingTransform);
        check.equal(panView.interactionActive, false);
        scrollHost.scrollTop = 0;
        const externalEditor = document.createElement("div");
        externalEditor.contentEditable = "true";
        externalEditor.textContent = "Outside editor";
        externalEditor.style.cssText = "position:fixed;top:0;left:0;z-index:1000;background:white";
        document.body.append(externalEditor);
        externalEditor.focus({preventScroll: true});
        getSelection().collapse(externalEditor.firstChild, 2);
        await nativeTouch([
            {type: "touchStart", touchPoints: [fingerAt(1), fingerAt(2, 100)]},
            {type: "touchMove", touchPoints: [fingerAt(1, 30, -20), fingerAt(2, 130, -20)]},
            {type: "touchMove", touchPoints: [fingerAt(1, 10, -20), fingerAt(2, 150, -20)]},
            {type: "touchEnd", touchPoints: []},
        ]);
        await settle();
        check.ok(panView.scale > readingTransform[0], "native two-finger input zooms the reading canvas");
        check.notEqual(panView.offsetX, readingTransform[1], "native two-finger input pans the reading canvas");
        check.equal(panView.interactionActive, false);
        check.equal(scrollHost.scrollTop, 0, "explicit two-finger input does not scroll the document");
        check.equal(document.activeElement, panHost, "a native pinch leaves focus on the non-editable canvas");
        check.equal(panHost.isContentEditable, false);
        check.equal(getSelection().anchorNode, externalEditor.firstChild, "focus transfer retains the document caret");
        const externalPoint = centerPoint(externalEditor);
        await nativeTouch([
            {type: "touchStart", touchPoints: [{id: 3, ...externalPoint}]},
            {type: "touchEnd", touchPoints: []},
        ]);
        check.equal(document.activeElement, externalEditor, "tapping text after a pinch restores normal editing focus");
        externalEditor.remove();
        panView.scale = readingTransform[0];
        panView.offsetX = readingTransform[1];
        panView.offsetY = readingTransform[2];
        panView.draw();
        scrollHost.contentEditable = "true";
        // 模拟主题允许选择预览文字，验证拖动画布仍不会启动浏览器文字划选。
        viewport.style.userSelect = "text";
        getSelection().removeAllRanges();
        const blankStart = {x: Math.round(readingBounds.left + 100), y: Math.round(readingBounds.top + 220)};
        const blankEnd = centerPoint(panHost.querySelector<HTMLElement>(`[data-mindmap-id="${panModel.root.id}"]`));
        await nativeInput([
            {type: "mouseMove", ...blankStart},
            {type: "mouseDown", ...blankStart, button: "left", clickCount: 1},
            {type: "mouseMove", ...blankEnd, button: "left"},
            {type: "mouseUp", ...blankEnd, button: "left", clickCount: 1},
        ]);
        check.equal(getSelection().toString(), "", "native canvas dragging does not select preview text in an editable document");
        check.deepEqual([panView.scale, panView.offsetX, panView.offsetY], readingTransform,
            "ordinary left dragging on blank canvas does not pan");
        panHost.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        viewport.style.removeProperty("user-select");
        scrollHost.contentEditable = "false";
        // 覆盖平台光标、真实右键按下及空闲后重新启动，保留激活、焦点和指针捕获阶段。
        for (const [platform, idle] of [
            ["body--windows", 0], ["body--windows", 3000], ["body--mac", 0],
            ["body--linux", 0], ["body--linux", 3000],
        ] as const) {
            document.body.classList.add(platform);
            await new Promise(resolve => setTimeout(resolve, idle));
            panView.selectNode(panModel.root.id);
            panView.inspector.hidden = true;
            const rootNode = panHost.querySelector<HTMLElement>(`[data-mindmap-id="${panModel.root.id}"]`);
            const add = rootNode.querySelector<HTMLElement>(".mindmap-view__add-child");
            check.equal(visiblyRendered(add), true, "the selected node exposes its controls before dragging");
            const point = centerPoint(rootNode);
            const end = {x: point.x + 24, y: point.y + 16};
            const before = [panView.offsetX, panView.offsetY];
            await nativeInput([
                {type: "mouseMove", ...point},
                {type: "mouseDown", ...point, button: "right", clickCount: 1},
                {type: "mouseMove", ...end, button: "right"},
            ]);
            await settle();
            check.deepEqual([panView.offsetX, panView.offsetY], [before[0] + 24, before[1] + 16],
                "native right dragging starts on the first move, including after idle");
            check.equal(getComputedStyle(viewport).cursor, "grabbing",
                `${platform} native right dragging uses the platform cursor, including after idle`);
            check.ok(Array.from(panHost.querySelectorAll<HTMLElement>(".mindmap-view__node"))
                .every(element => getComputedStyle(element).cursor === "default"),
            "panning leaves every node cursor unchanged");
            check.equal(getComputedStyle(add).visibility, "hidden", "selected node controls stay hidden while panning");
            const world = panHost.querySelector<HTMLElement>(".mindmap-view__world");
            const matrix = new DOMMatrix(getComputedStyle(world).transform);
            check.ok(Math.abs(matrix.e - panView.offsetX) < .001 && Math.abs(matrix.f - panView.offsetY) < .001);
            if (idle) {
                viewport.dispatchEvent(new PointerEvent("pointercancel", {bubbles: true,
                    pointerId: panView.pointer.pointerId, pointerType: "mouse"}));
                check.equal(panView.pointer, undefined);
                check.equal(getComputedStyle(add).visibility, "visible", "canceling restores selected node controls");
            }
            await nativeInput([{type: "mouseUp", ...end, button: "right", clickCount: 1}]);
            await settle();
            check.equal(panView.pointer, undefined);
            check.equal(getComputedStyle(add).visibility, "visible", "releasing the pointer restores selected node controls");
            check.equal(getComputedStyle(viewport).cursor, "default", "ending a drag restores the reading cursor");
            document.body.classList.remove(platform);
        }
        panView.offsetX = readingTransform[1];
        panView.offsetY = readingTransform[2];
        panView.draw();
        panView.setInteractionActive(false);
        const reader = document.createElement("input");
        reader.value = "Document reading selection";
        reader.style.cssText = "position:fixed;top:0;left:0";
        document.body.append(reader);
        for (const modifier of ["control", "meta", "middle"]) {
            const button = modifier === "middle" ? "middle" : "right";
            const modifiers = modifier === "middle" ? [] : [modifier];
            panView.setReadOnly(modifier === "meta");
            panView.selectNode(panModel.root.id);
            panView.inspector.hidden = true;
            reader.focus({preventScroll: true});
            reader.setSelectionRange(2, 8);
            await settle();
            const node = panHost.querySelector<HTMLElement>(`[data-mindmap-id="${panModel.root.id}"]`);
            const point = centerPoint(node);
            const end = {x: point.x + 30, y: point.y + 20};
            const before = [panView.offsetX, panView.offsetY];
            let auxiliaryClick: MouseEvent;
            if (button === "middle") {
                viewport.addEventListener("auxclick", event => auxiliaryClick = event, {once: true});
            }
            await nativeInput([
                {type: "mouseMove", ...point},
                {type: "mouseDown", ...point, button, clickCount: 1, modifiers},
                {type: "mouseMove", ...end, button, modifiers},
                {type: "mouseUp", ...end, button, clickCount: 1, modifiers},
            ]);
            check.deepEqual([panView.offsetX, panView.offsetY], [before[0] + 30, before[1] + 20]);
            check.equal(panView.interactionActive, false, "temporary dragging preserves reading mode");
            check.equal(document.activeElement, reader, "temporary dragging does not steal document focus");
            check.deepEqual([reader.selectionStart, reader.selectionEnd], [2, 8]);
            check.equal(panView.getSelectedId(), panModel.root.id);
            if (button === "middle") {
                check.equal(auxiliaryClick?.defaultPrevented, true, "middle release cancels the browser auxiliary action");
                await nativeInput([
                    {type: "mouseDown", ...end, button, clickCount: 1},
                    {type: "mouseUp", ...end, button, clickCount: 1},
                ]);
                check.equal(panView.getSelectedId(), panModel.root.id, "a middle click preserves the selected node");
                check.equal(document.activeElement, reader, "a middle click preserves document focus");
                await nativeInput([{type: "mouseDown", ...end, button, clickCount: 1}]);
                check.ok(panView.pointer?.pan);
                viewport.dispatchEvent(new PointerEvent("pointercancel", {
                    pointerId: panView.pointer.pointerId, pointerType: "mouse"}));
                check.equal(panView.pointer, undefined, "canceling a middle drag releases its state");
                await nativeInput([{type: "mouseUp", ...end, button, clickCount: 1}]);
            }
            let receivedWheel: WheelEvent;
            let scrollingFinished = false;
            viewport.addEventListener("wheel", event => receivedWheel = event, {once: true});
            scrollHost.addEventListener("scrollend", () => scrollingFinished = true, {once: true});
            await nativeInput([
                {type: "keyUp", keyCode: modifier === "control" ? "Control" : "Meta"},
                {type: "mouseMove", ...end, modifiers: []},
                {type: "mouseWheel", ...end, deltaX: 0, deltaY: -80, canScroll: true, modifiers: []},
            ]);
            const deadline = performance.now() + 1000;
            while ((!scrollHost.scrollTop || !scrollingFinished) && performance.now() < deadline) {
                await frame();
            }
            check.ok(scrollHost.scrollTop > 0, "ordinary wheel input still scrolls the document after temporary panning: " +
                JSON.stringify({modifier, point: end, target: document.elementFromPoint(end.x, end.y)?.className,
                    wheel: receivedWheel && {ctrlKey: receivedWheel.ctrlKey, metaKey: receivedWheel.metaKey,
                        defaultPrevented: receivedWheel.defaultPrevented}}));
            scrollHost.scrollTop = 0;
            await settle();
            panView.offsetX = readingTransform[1];
            panView.offsetY = readingTransform[2];
            panView.draw();
        }
        reader.remove();
        panView.setReadOnly(false);
        check.ok(Array.from(panHost.querySelectorAll(".mindmap-view__toolbar use"))
            .every(icon => icon.getAttribute("xlink:href") !== "#iconEdit"), "canvas activation has no separate pencil button");
        const hand = panHost.querySelector<HTMLButtonElement>('[aria-label="cursorHand"]');
        enableHand(panHost);
        check.equal(panView.interactionActive, true);
        check.equal(getComputedStyle(viewport).touchAction, "none");
        check.equal(hand.getAttribute("aria-pressed"), "true", "hand tool activates one-finger canvas panning");
        const fixedX = panView.offsetX;
        const checkVisibleNode = () => {
            const bounds = viewport.getBoundingClientRect();
            check.ok(Array.from(panHost.querySelectorAll<HTMLElement>(".mindmap-view__node")).some(element => {
                const rect = element.getBoundingClientRect();
                return !element.hidden && rect.left < bounds.right && rect.right > bounds.left &&
                    rect.top < bounds.bottom && rect.bottom > bounds.top;
            }), "at least one actual node remains visible after panning the cropped map");
            check.equal(panView.offsetX, fixedX, "vertical movement does not shift the horizontal position");
        };
        for (const deltaY of [100000, -100000]) {
            const event = new WheelEvent("wheel", {deltaY, bubbles: true, cancelable: true});
            viewport.dispatchEvent(event);
            check.equal(event.defaultPrevented, true);
            checkVisibleNode();
            const next = new WheelEvent("wheel", {deltaY, bubbles: true, cancelable: true});
            viewport.dispatchEvent(next);
            check.equal(next.defaultPrevented, true, "active canvas keeps wheel input at the pan boundary");
        }
        panView.offsetY = 120 - rootPosition.y;
        panView.draw();
        viewport.dispatchEvent(new PointerEvent("pointerdown", touch));
        viewport.dispatchEvent(new PointerEvent("pointermove", {...touch, clientY: -1900}));
        checkVisibleNode();
        check.equal(scrollHost.scrollTop, 0, "active canvas does not hand touch overflow to the document");
        viewport.dispatchEvent(new PointerEvent("pointerup", {...touch, clientY: -1900}));
        panHost.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        check.equal(panView.interactionActive, false);
        check.equal(getComputedStyle(viewport).touchAction, "pan-y");
        check.equal(hand.getAttribute("aria-pressed"), "false");
        sendPointer(viewport, "pointerdown", 100, 100);
        sendPointer(viewport, "pointerup", 100, 100);
        check.equal(panView.interactionActive, true, "desktop pointer input activates the canvas");
        document.body.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        check.equal(panView.interactionActive, false, "outside pointer input returns to reading");
        enableHand(panHost);
        panHost.dispatchEvent(new FocusEvent("focusout", {relatedTarget: followingContent}));
        check.equal(panView.interactionActive, false, "moving focus outside returns to reading");
        panView.offsetX = 16 - rootPosition.x * panView.scale;
        panView.offsetY = 120 - rootPosition.y * panView.scale;
        panView.draw();
        await settle();
        const rootNode = panHost.querySelector<HTMLElement>(`[data-mindmap-id="${panModel.root.id}"]`);
        const rootBounds = rootNode.getBoundingClientRect();
        const rootFinger = {id: 1, x: rootBounds.left + rootBounds.width / 2, y: rootBounds.top + rootBounds.height / 2};
        const beforeTouchEdit = edits.length;
        await nativeTouch([
            {type: "touchStart", touchPoints: [rootFinger]},
            {type: "touchEnd", touchPoints: []},
            {type: "touchStart", touchPoints: [rootFinger]},
            {type: "touchEnd", touchPoints: []},
        ]);
        check.equal(edits.length, beforeTouchEdit + 1, "native double-tap starts node editing directly from reading");
        check.equal(panView.editingId, panModel.root.id);
        check.equal(panView.interactionActive, true);
        panView.setEditing(undefined);
        panView.setInteractionActive(false);
        await settle();
        const tapNode = panHost.querySelector<HTMLElement>(`[data-mindmap-id="${panModel.root.id}"]`);
        const tapBounds = tapNode.getBoundingClientRect();
        for (const point of [fingerAt(1), {id: 1, x: tapBounds.left + tapBounds.width / 2,
            y: tapBounds.top + tapBounds.height / 2}]) {
            const beforeTapEdit = edits.length;
            let readingOnContact = false;
            viewport.addEventListener("pointerdown", () => readingOnContact = !panView.interactionActive, {once: true});
            await nativeTouch([
                {type: "touchStart", touchPoints: [point]},
                {type: "touchEnd", touchPoints: []},
            ]);
            check.equal(readingOnContact, true, "touch contact leaves document scrolling available");
            check.equal(panView.interactionActive, true, "native single tap activates blank canvas and nodes");
            check.equal(getComputedStyle(viewport).touchAction, "none");
            check.equal(edits.length, beforeTapEdit, "single tap does not start node editing");
            check.deepEqual([panView.scale, panView.offsetX, panView.offsetY], readingTransform);
            panView.setInteractionActive(false);
        }
        panView.setReadOnly(true);
        await nativeTouch([
            {type: "touchStart", touchPoints: [fingerAt(1)]},
            {type: "touchEnd", touchPoints: []},
        ]);
        check.equal(panView.interactionActive, true, "single tap also activates a read-only canvas");
        panView.setReadOnly(false);
        panView.setLocked(true);
        await nativeTouch([
            {type: "touchStart", touchPoints: [fingerAt(1)]},
            {type: "touchEnd", touchPoints: []},
        ]);
        check.equal(panView.interactionActive, false, "single tap preserves the saved view lock");
        panView.setLocked(false);
        await nativeTouch([
            {type: "touchStart", touchPoints: [fingerAt(1)]},
            {type: "touchCancel", touchPoints: []},
        ]);
        check.equal(panView.interactionActive, false, "cancelled touches do not activate the canvas");
        check.equal(panModel.list.outerHTML, sourceHTML, "interaction activation and panning do not change saved data");
        panView.destroy();
        scrollHost.remove();
    }

    // 密集节点上的快速触屏拖动平移画布，长按确认后才移动节点。
    {
        const touchSource = document.createElement("div");
        touchSource.innerHTML = lute.Md2BlockDOM("* Root\n  * First\n  * Second\n  * Third\n");
        const touchModel = api.readListMindmap(touchSource.firstElementChild as HTMLElement);
        const touchHost = document.createElement("div");
        touchHost.style.cssText = "position:fixed;left:0;top:0;width:600px;height:400px;z-index:100";
        document.body.append(touchHost);
        const touchMoves: unknown[][] = [];
        const touchView = new api.ListMindmapView({...options, host: touchHost, model: touchModel,
            onMove: (...args: unknown[]) => touchMoves.push(args)});
        await settle();
        const originalHTML = touchModel.list.outerHTML;
        const firstId = touchModel.root.children[0].id;
        const lastId = touchModel.root.children[2].id;
        const touchNode = () => touchHost.querySelector<HTMLElement>(`[data-mindmap-id="${firstId}"]`);
        const point = (id: string) => {
            const rect = touchHost.querySelector<HTMLElement>(`[data-mindmap-id="${id}"]`).getBoundingClientRect();
            return {id: 1, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2)};
        };
        const nativeTouch = (events: Record<string, unknown>[]) =>
            require("electron").ipcRenderer.invoke("mindmap-view-native-touch", events);
        touchView.setInteractionActive(true);
        const initialSelection = touchView.getSelectedId();
        const from = point(firstId);
        const beforePan = [touchView.offsetX, touchView.offsetY];
        await nativeTouch([
            {type: "touchStart", touchPoints: [from]},
            {type: "touchMove", touchPoints: [{...from, x: from.x + 40, y: from.y + 20}]},
            {type: "wait", delay: 520},
            {type: "touchEnd", touchPoints: []},
        ]);
        check.notDeepEqual([touchView.offsetX, touchView.offsetY], beforePan, "native swipes pan even when starting on a node");
        check.equal(touchMoves.length, 0);
        check.equal(touchView.getSelectedId(), initialSelection, "swiping a dense map does not select incidental nodes");
        check.equal(touchModel.list.outerHTML, originalHTML);
        touchView.fit();
        await settle();
        const heldFrom = point(firstId);
        const destination = point(lastId);
        await nativeTouch([
            {type: "touchStart", touchPoints: [heldFrom]},
            {type: "wait", delay: 520},
            {type: "touchMove", touchPoints: [destination]},
            {type: "touchEnd", touchPoints: []},
        ]);
        check.equal(touchMoves.length, 1, "a completed native long press allows one node move on release");
        check.equal(touchMoves[0][0], firstId);
        check.equal(touchMoves[0][1], lastId);
        check.equal(touchNode().classList.contains("mindmap-view__node--drag-ready"), false);
        const sendTouch = (type: string) => touchNode().dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 71, pointerType: "touch", isPrimary: true,
            button: 0, clientX: heldFrom.x, clientY: heldFrom.y,
        }));
        sendTouch("pointerdown");
        await new Promise(resolve => setTimeout(resolve, 500));
        check.equal(touchNode().classList.contains("mindmap-view__node--drag-ready"), true, "holding provides visible drag feedback");
        sendTouch("pointercancel");
        check.equal(touchNode().classList.contains("mindmap-view__node--drag-ready"), false);
        check.equal(touchMoves.length, 1, "cancellation does not submit the armed drag");
        sendTouch("pointerdown");
        sendTouch("pointerup");
        await new Promise(resolve => setTimeout(resolve, 500));
        check.equal(touchNode().classList.contains("mindmap-view__node--drag-ready"), false, "a short tap leaves no delayed drag");
        check.equal(touchView.getSelectedId(), firstId, "short taps still select a node");
        touchView.setReadOnly(true);
        sendTouch("pointerdown");
        await new Promise(resolve => setTimeout(resolve, 500));
        check.equal(touchView.pointer?.touchNode, undefined, "read-only maps never arm a node move");
        sendTouch("pointerup");
        touchView.destroy();
        touchHost.remove();
        const fallbackHost = document.createElement("div");
        const fallback = new api.ListMindmapView({...options, host: fallbackHost, onSettingsMenu: undefined, readOnly: true});
        check.equal(fallbackHost.querySelector<HTMLButtonElement>('[aria-label="cursorHand"]').hidden, false,
            "standalone export retains a usable fallback when no application menu is available");
        fallback.destroy();
    }

    lute.SetTabs(true);
    const tabsContainer = document.createElement("div");
    tabsContainer.innerHTML = lute.Md2BlockDOM("::: tabs\n@tab First\n\nOne\n@tab Second\n\nTwo\n:::\n");
    const sourceTabs = tabsContainer.firstElementChild as HTMLElement;
    const sourceItems = sourceTabs.querySelectorAll<HTMLElement>(":scope > .tab-item");
    sourceTabs.setAttribute("tabs-active-id", sourceItems[1].dataset.nodeId);
    const sourceTabsHTML = sourceTabs.outerHTML;
    const tabsModel = api.readListMindmap(singleList);
    tabsModel.root.contentBlocks = [sourceTabs];
    single.update(tabsModel);
    const previewTabs = host.querySelector<HTMLElement>(".tabs");
    const previewItems = previewTabs.querySelectorAll<HTMLElement>(":scope > .tab-item");
    check.ok(previewItems[0].id && previewItems[1].id && previewItems[0].id !== previewItems[1].id);
    check.equal(previewTabs.getAttribute("tabs-active-id"), previewItems[1].id);
    check.equal(previewTabs.querySelector("[data-node-id]"), null);
    check.equal(sourceTabs.outerHTML, sourceTabsHTML);
    const emptyModel = api.readListMindmap(singleList);
    const emptyBlock = document.createElement("div");
    emptyBlock.innerHTML = "<div><br></div>";
    emptyModel.root.contentBlocks = [emptyBlock];
    single.update(emptyModel);
    const emptyContent = host.querySelector<HTMLElement>(".mindmap-view__content");
    check.equal(emptyContent.classList.contains("mindmap-view__content--empty"), true);
    check.equal(emptyContent.dataset.placeholder, "listMindmapPlaceholder");
    check.equal(emptyContent.textContent, "", "placeholder is not node content");
    emptyBlock.innerHTML = '<div spellcheck="false">First\n\n\nLast</div>';
    single.update(emptyModel);
    await settle();
    const textPreview = emptyContent.querySelector<HTMLElement>(".mindmap-view__text");
    const lineHeight = parseFloat(getComputedStyle(textPreview).lineHeight);
    check.ok(textPreview.offsetHeight >= lineHeight * 4, "consecutive soft breaks retain blank lines");
    emptyBlock.innerHTML = '<div spellcheck="false">\n\n</div>';
    single.update(emptyModel);
    await settle();
    check.equal(emptyContent.classList.contains("mindmap-view__content--empty"), false);
    check.ok(emptyContent.offsetHeight >= lineHeight * 3, "blank-only and trailing lines remain visible");
    emptyBlock.innerHTML = '<div spellcheck="false"></div>';
    emptyModel.root.contentBlocks = [emptyBlock, emptyBlock.cloneNode(true), emptyBlock.cloneNode(true)];
    single.update(emptyModel);
    await settle();
    check.ok(emptyContent.offsetHeight >= lineHeight * 3, "empty paragraphs retain individual line height");
    emptyModel.root.contentBlocks = [emptyBlock];
    emptyBlock.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
    single.update(emptyModel);
    check.equal(emptyContent.classList.contains("mindmap-view__content--empty"), false);
    single.update(api.readListMindmap(singleList));
    pressDelete();
    check.deepEqual(deletions, [beta], "the last root node cannot be deleted");
    await settle();
    HTMLElement.prototype.setPointerCapture = originalCapture;
    HTMLElement.prototype.hasPointerCapture = originalHasCapture;
    HTMLElement.prototype.releasePointerCapture = originalReleaseCapture;
    const nativeRect = host.querySelector<HTMLElement>("[data-mindmap-id]").getBoundingClientRect();
    const nativePoint = {x: Math.round(nativeRect.left + nativeRect.width / 2), y: Math.round(nativeRect.top + nativeRect.height / 2)};
    const beforeNativeEdits = edits.length;
    await require("electron").ipcRenderer.invoke("mindmap-view-native-input", [
        {type: "mouseMove", ...nativePoint},
        {type: "mouseDown", ...nativePoint, button: "left", clickCount: 1},
        {type: "mouseUp", ...nativePoint, button: "left", clickCount: 1},
        {type: "mouseDown", ...nativePoint, button: "left", clickCount: 2},
        {type: "mouseUp", ...nativePoint, button: "left", clickCount: 2},
    ]);
    await settle();
    check.equal(edits.length, beforeNativeEdits + 1, "native double click must edit despite pointer capture");
    single.destroy();

    // 使用真实鼠标及两种删除按键修改源列表，覆盖 macOS Delete 键发送 Backspace 的情况。
    const deleteList = reset("* Root\n  * First\n  * Second\n");
    const deleteModel = api.readListMindmap(deleteList);
    const deleteFirst = deleteModel.root.children[0].id;
    const deleteSecond = deleteModel.root.children[1].id;
    const deleting = new api.ListMindmapView({...options, model: deleteModel, onDelete: (id: string) => {
        check.equal(api.deleteListMindmapNode(deleteList, id), true);
        deleting.update(api.readListMindmap(deleteList));
    }});
    const nativeKey = async (keyCode: string) => {
        await nativeInput([{type: "keyDown", keyCode}, {type: "keyUp", keyCode}]);
        await settle();
    };
    await settle();
    await clickMouse(nodeElement(deleteFirst));
    check.equal(document.activeElement, host.querySelector(".mindmap-view__selection-input"));
    await nativeKey("Backspace");
    check.equal(deleteList.querySelector(`[data-node-id="${deleteFirst}"]`), null);
    check.equal(nodeElement(deleteFirst), null);
    check.ok(deleteList.querySelector(`[data-node-id="${deleteSecond}"]`));
    check.equal(nodeElement(deleteSecond).getAttribute("aria-selected"), "true");
    check.equal(document.activeElement, host.querySelector(".mindmap-view__selection-input"));
    await clickMouse(nodeElement(deleteSecond));
    const beforeProtectedDelete = deleteList.outerHTML;
    deleting.setEditing(deleteSecond);
    for (const key of ["Backspace", "Delete"]) {
        pressDelete(deleting.getContentHost(deleteSecond), {key});
    }
    deleting.setEditing();
    deleting.setReadOnly(true);
    await nativeKey("Backspace");
    await nativeKey("Delete");
    check.equal(deleteList.outerHTML, beforeProtectedDelete);
    deleting.setReadOnly(false);
    await clickMouse(nodeElement(deleteSecond));
    await nativeKey("Delete");
    check.equal(deleteList.querySelector(`[data-node-id="${deleteSecond}"]`), null);
    check.equal(nodeElement(deleteSecond), null);
    check.ok(nodeElement(deleteModel.root.id));
    check.equal(nodeElement(deleteModel.root.id).getAttribute("aria-selected"), "true");
    check.equal(document.activeElement, host.querySelector(".mindmap-view__selection-input"));
    await clickMouse(nodeElement(deleteModel.root.id));
    await nativeKey("Backspace");
    check.ok(nodeElement(deleteModel.root.id), "the last root is preserved for the macOS Delete key");
    deleting.destroy();
    const locateList = reset("* Root\n  * Child\n");
    const locateHost = document.createElement("div");
    locateList.append(locateHost);
    hostParent.append(locateList);
    const locateModel = api.readListMindmap(locateList);
    const locateView = new api.ListMindmapView({host: locateHost, model: locateModel, onExit: () => {}});
    locateList.dataset.mindmapViewRendered = "true";
    const unregisterLocate = api.registerListMindmapView(locateList, locateView, locateHost);
    await settle();
    const locateChild = locateModel.root.children[0];
    const locateParagraph = locateChild.contentBlocks[0];
    const located = api.resolveVisibleListMindmapBlock(locateParagraph);
    check.equal(located.carrier.dataset.mindmapSourceId, locateParagraph.dataset.nodeId);
    check.equal(located.carrier.hasAttribute("data-node-id"), false);
    check.equal(located.scrollElement, locateHost);
    check.equal(api.resolveVisibleListMindmapBlock(locateList).carrier, locateHost);
    located.reveal();
    located.focus();
    check.equal(document.activeElement, locateHost.querySelector(".mindmap-view__selection-input"),
        "locating a node prepares its keyboard input target");
    check.equal(locateHost.querySelector(`[data-mindmap-id="${locateChild.id}"]`).getAttribute("aria-selected"), "true");
    const missingBlock = document.createElement("div");
    missingBlock.dataset.nodeId = "missing-block";
    locateChild.element.append(missingBlock);
    check.equal(api.resolveVisibleListMindmapBlock(missingBlock), null);
    missingBlock.remove();
    const locateNode = locateHost.querySelector<HTMLElement>(`[data-mindmap-id="${locateChild.id}"]`);
    locateNode.hidden = true;
    check.equal(api.resolveVisibleListMindmapBlock(locateParagraph), null);
    locateNode.hidden = false;
    unregisterLocate();
    check.equal(api.resolveVisibleListMindmapBlock(locateParagraph), null);
    locateView.destroy();
    locateList.remove();
    // 公式在副本上异步渲染；链接单击跳转，双击和拖拽不跳转。
    const richList = reset("* $x^2$ [example](https://example.com) ![image](assets/example.png)\n  * child\n");
    const richHost = document.createElement("div");
    hostParent.append(richHost);
    const opened: string[] = [];
    const previewed: string[] = [];
    let richEdits = 0;
    const richView = new api.ListMindmapView({host: richHost, model: api.readListMindmap(richList),
        onExit: () => {}, onOpenLink: (href: string) => opened.push(href), onEdit: () => richEdits++,
        onPreviewImage: (src: string) => previewed.push(src)});
    await settle();
    const doubleClickImage = () => richHost.querySelector("img").dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true, cancelable: true,
    }));
    doubleClickImage();
    check.deepEqual(previewed, ["assets/example.png"]);
    check.equal(richEdits, 0, "image previews do not open a node editor");
    richView.setReadOnly(true);
    doubleClickImage();
    check.equal(previewed.length, 2, "read-only nodes support image previews");
    richView.setReadOnly(false);
    richView.setLocked(true);
    doubleClickImage();
    check.equal(previewed.length, 3, "locked nodes support image previews without editing");
    richView.setLocked(false);
    for (const mode of ["relationFrom", "panning", "pinching"]) {
        richView[mode] = true;
        doubleClickImage();
        check.equal(previewed.length, 3, "active canvas interactions do not open image previews");
        richView[mode] = undefined;
    }
    richHost.querySelector("img").classList.add("emoji");
    doubleClickImage();
    check.equal(previewed.length, 3, "emoji images keep the node editing interaction");
    richHost.querySelector("img").classList.remove("emoji");
    richView.setEditing();
    richEdits = 0;
    await settle();
    check.ok(richHost.querySelector('[data-subtype="math"] .katex'));
    check.equal(richList.querySelector(".katex"), null, "preview rendering does not mutate the source");
    const link = richHost.querySelector<HTMLElement>('[data-type="a"]');
    const clickLink = (detail = 1) => link.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, detail}));
    clickLink();
    await new Promise(resolve => setTimeout(resolve, 220));
    check.deepEqual(opened, ["https://example.com"]);
    const geometry = () => Array.from(richHost.querySelectorAll(".mindmap-view__node")).map(element => {
        const rect = element.getBoundingClientRect();
        return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
    });
    const beforeEditing = geometry();
    clickLink();
    clickLink(2);
    link.dispatchEvent(new MouseEvent("dblclick", {bubbles: true, cancelable: true, detail: 2}));
    await new Promise(resolve => setTimeout(resolve, 220));
    check.equal(richEdits, 1);
    check.equal(opened.length, 1);
    check.deepEqual(geometry(), beforeEditing, "entering edit mode does not reposition the canvas or other nodes");
    richView.setEditing();
    await settle();
    check.deepEqual(geometry(), beforeEditing, "leaving edit mode does not reposition the canvas or other nodes");
    const point = centerPoint(link);
    sendPointer(link, "pointerdown", point.x, point.y);
    sendPointer(richHost.querySelector(".mindmap-view__viewport"), "pointermove", point.x + 30, point.y);
    sendPointer(richHost.querySelector(".mindmap-view__viewport"), "pointerup", point.x + 30, point.y);
    clickLink();
    await new Promise(resolve => setTimeout(resolve, 220));
    check.equal(opened.length, 1);
    const ref = document.createElement("span");
    ref.dataset.type = "block-ref";
    ref.dataset.id = "20260917000000-abcdefg";
    link.after(ref);
    sendPointer(ref, "pointerdown", point.x, point.y);
    sendPointer(richHost.querySelector(".mindmap-view__viewport"), "pointerup", point.x, point.y);
    ref.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, detail: 1}));
    await new Promise(resolve => setTimeout(resolve, 220));
    check.equal(opened[1], "siyuan://blocks/20260917000000-abcdefg");
    richView.destroy();
    const exportView = new api.ListMindmapView({host: richHost, model: api.readListMindmap(richList),
        readOnly: true, onExit: () => {}});
    const anchor = document.createElement("a");
    anchor.href = "#export-target";
    richHost.querySelector(".mindmap-view__content").append(anchor);
    let exportClick = false;
    richHost.parentElement.addEventListener("click", event => {
        if (event.target === anchor) {
            exportClick = true;
            event.preventDefault();
        }
    });
    anchor.click();
    check.equal(exportClick, true, "export anchor clicks reach the existing navigation handler");
    exportView.destroy();

    // 复杂块保留在源列表中；预览不携带块身份，媒体控件也不触发节点拖拽或编辑。
    const specialList = reset("- Root\n  - First\n  - Second\n");
    const specialRoot = specialList.querySelector<HTMLElement>(".li");
    const specials = document.createElement("div");
    ["NodeTable", "NodeAttributeView", "NodeBlockQueryEmbed", "NodeCustomBlock", "NodeHTMLBlock", "NodeCallout",
        "NodeSuperBlock", "NodeVideo", "NodeAudio", "NodeIFrame", "NodeWidget"].forEach(type => {
        const element = document.createElement("div");
        element.dataset.nodeId = Lute.NewNodeID();
        element.dataset.type = type;
        element.dataset.content = "Source content";
        element.setAttribute("custom-preserved", "value");
        if (type === "NodeTable") {
            element.innerHTML = '<table><tbody><tr><td>Cell</td></tr></tbody></table><div class="protyle-action__table"></div>';
        } else {
            element.textContent = type;
        }
        const tag = ({NodeVideo: "video", NodeAudio: "audio", NodeIFrame: "iframe"} as Record<string, string>)[type];
        if (tag) {
            const media = document.createElement(tag);
            media.setAttribute("controls", "");
            element.append(media);
        }
        specials.append(element);
    });
    specialRoot.querySelector(".p").after(...Array.from(specials.children));
    const sourceChart = document.createElement("div");
    sourceChart.dataset.type = "NodeCodeBlock";
    sourceChart.dataset.nodeId = Lute.NewNodeID();
    sourceChart.setAttribute("_echarts_instance_", "source-instance");
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 4;
    sourceCanvas.height = 4;
    sourceCanvas.getContext("2d").fillStyle = "#123456";
    sourceCanvas.getContext("2d").fillRect(0, 0, 4, 4);
    sourceChart.append(sourceCanvas);
    specialRoot.querySelector(".p").after(sourceChart);
    const sourceContent = api.readListMindmap(specialList).root.contentBlocks.map((block: HTMLElement) => block.outerHTML);
    let specialEdits = 0;
    const specialView = new api.ListMindmapView({host: richHost, model: api.readListMindmap(specialList),
        onExit: () => {}, onEdit: () => specialEdits++, onMove: () => check.fail("Media started a node move")});
    check.equal(richHost.querySelector("[data-node-id]"), null);
    check.equal(richHost.querySelector(".protyle-action__table"), null);
    check.equal(richHost.querySelector("[_echarts_instance_]"), null);
    check.deepEqual(Array.from(richHost.querySelector<HTMLCanvasElement>(".mindmap-view__content canvas")
        .getContext("2d").getImageData(0, 0, 1, 1).data), [18, 52, 86, 255]);
    for (const tag of ["audio", "video", "iframe"]) {
        const media = richHost.querySelector(tag);
        const pointer = new PointerEvent("pointerdown", {bubbles: true, cancelable: true, pointerId: 9, button: 0});
        media.dispatchEvent(pointer);
        check.equal(pointer.defaultPrevented, false, tag);
        check.equal(specialView.pointer, undefined, tag);
        const keyboard = new KeyboardEvent("keydown", {key: " ", bubbles: true, cancelable: true});
        media.dispatchEvent(keyboard);
        check.equal(keyboard.defaultPrevented, false, tag);
        media.dispatchEvent(new MouseEvent("dblclick", {bubbles: true, cancelable: true}));
        check.equal(specialEdits, 0, tag);
    }
    const specialChildren = api.readListMindmap(specialList).root.children;
    check.equal(api.moveListMindmapNode(specialList, specialChildren[1].id, specialChildren[0].id, "before"), true);
    specialView.update(api.readListMindmap(specialList));
    check.deepEqual(api.readListMindmap(specialList).root.contentBlocks.map((block: HTMLElement) => block.outerHTML), sourceContent);
    specialView.destroy();
    check.deepEqual(api.readListMindmap(specialList).root.contentBlocks.map((block: HTMLElement) => block.outerHTML), sourceContent);

    // 真实列表与脑图逐项比较图标、删除线和颜色，覆盖导出及脱离编辑器容器的全屏布局。
    const taskStyle = document.createElement("style");
    taskStyle.textContent = taskCSS;
    document.head.append(taskStyle);

    const foldedMindmapRoot = document.createElement("div");
    foldedMindmapRoot.className = "protyle-wysiwyg";
    const foldedMindmapList = reset("* Java\n  * Spring\n* Go\n  * gofmt\n  * Wide\n* Node.js\n  * child one\n  * child two\n");
    foldedMindmapList.querySelectorAll(":scope > [data-type=\"NodeListItem\"]")[2].setAttribute("fold", "1");
    foldedMindmapRoot.append(foldedMindmapList);
    document.body.append(foldedMindmapRoot);
    api.retagMindmapBranch(foldedMindmapList, true);
    const foldedMindmapHost = document.createElement("div");
    foldedMindmapHost.className = "mindmap-view";
    foldedMindmapList.append(foldedMindmapHost);
    const foldedMindmapView = new api.ListMindmapView({host: foldedMindmapHost,
        model: api.readListMindmap(foldedMindmapList)});
    foldedMindmapList.dataset.mindmapViewRendered = "true";
    const foldedMindmapItems = foldedMindmapList.querySelectorAll<HTMLElement>(":scope > [data-type=\"NodeMindmapItem\"]");
    check.equal(foldedMindmapItems.length, 3);
    foldedMindmapItems.forEach(item => check.equal(getComputedStyle(item).display, "none"));
    check.equal(foldedMindmapRoot.children.length, 1);
    check.equal(api.readListMindmap(foldedMindmapList).root.children[2].collapsed, true);
    foldedMindmapView.destroy();
    foldedMindmapRoot.remove();

    // 引用和行内格式在两种主题、窄屏、大字号及脱离编辑器的全屏布局中保持一致。
    const inlineParent = document.createElement("div");
    inlineParent.className = "protyle-wysiwyg";
    const inlineList = reset("* Reference\n");
    const inlineText = inlineList.querySelector<HTMLElement>("[contenteditable]");
    const inlineTypes = ["block-ref", "virtual-block-ref", "file-annotation-ref", "a", "tag", "code", "strong", "em",
        "s", "u", "mark", "kbd", "inline-memo"];
    inlineText.innerHTML = inlineTypes.map(type => `<span data-type="${type}">Text</span>`).join(" ");
    const inlineHost = document.createElement("div");
    inlineParent.append(inlineList);
    document.body.append(inlineParent);
    inlineList.append(inlineHost);
    const inlineView = new api.ListMindmapView({host: inlineHost, model: api.readListMindmap(inlineList), onExit: () => {}});
    const rootStyle = document.documentElement.style.cssText;
    const themeMode = document.documentElement.getAttribute("data-theme-mode");
    const styleProperties = ["color", "background-image", "background-color", "border-bottom-style", "border-bottom-width",
        "font-style", "font-weight", "text-decoration-line"];
    const inlineStyle = (root: HTMLElement, type: string, properties: string[]) => {
        const style = getComputedStyle(root.querySelector(`[data-type="${type}"]`));
        return properties.map(property => style.getPropertyValue(property));
    };
    document.documentElement.style.setProperty("--b3-font-size-editor", "40px");
    document.documentElement.style.setProperty("--b3-font-family-protyle", "monospace");
    for (const mode of ["0", "1"]) {
        document.documentElement.setAttribute("data-theme-mode", mode);
        for (const name of ["blockref", "fileref", "link", "tag", "strong", "em", "s", "u", "mark"]) {
            document.documentElement.style.setProperty(`--b3-protyle-inline-${name}-color`, mode === "0" ? "#334455" : "#ddeeff");
        }
        for (const width of [360, 760]) {
            inlineParent.style.width = `${width}px`;
            await settle();
            const beforeFullscreen = inlineTypes.map(type => inlineStyle(inlineHost, type, [...styleProperties, "font-size", "font-family"]));
            check.notEqual(inlineStyle(inlineHost, "block-ref", ["background-image"])[0], "none");
            inlineTypes.forEach(type => check.deepEqual(inlineStyle(inlineHost, type, styleProperties),
                inlineStyle(inlineText, type, styleProperties), type));
            inlineHost.querySelector<HTMLButtonElement>('[aria-label="fullscreen"]').click();
            await settle();
            check.equal(inlineHost.parentElement, document.body);
            inlineTypes.forEach((type, index) => check.deepEqual(inlineStyle(inlineHost, type,
                [...styleProperties, "font-size", "font-family"]), beforeFullscreen[index], `${mode}/${width}/${type}`));
            inlineHost.querySelector<HTMLButtonElement>('[aria-label="exitFullscreen"]').click();
            await settle();
        }
    }
    inlineView.destroy();
    inlineParent.remove();
    document.documentElement.style.cssText = rootStyle;
    if (themeMode === null) {
        document.documentElement.removeAttribute("data-theme-mode");
    } else {
        document.documentElement.setAttribute("data-theme-mode", themeMode);
    }

    lute.SetArbitraryTaskListItemMarker(true);
    lute.SetDataTask(true);
    const taskParent = document.createElement("div");
    taskParent.className = "protyle-wysiwyg";
    taskParent.style.setProperty("--b3-theme-on-surface-light", "#8899aa");
    taskParent.style.setProperty("--b3-theme-on-background", "#223344");
    taskParent.innerHTML = lute.Md2BlockDOM("* [ ] Task\n\n  Second paragraph\n\n  * [/] Child\n* Ordinary\n");
    document.body.append(taskParent);
    const taskList = taskParent.firstElementChild as HTMLElement;
    const ordinaryItem = taskParent.querySelector<HTMLElement>('.li[data-subtype="u"]');
    taskList.insertBefore(ordinaryItem, taskList.lastElementChild);
    const taskItem = taskList.querySelector<HTMLElement>(".li");
    const taskId = taskItem.dataset.nodeId;
    const taskHost = document.createElement("div");
    taskHost.style.width = "700px";
    taskParent.append(taskHost);
    const operations: {id: string, before: string, after: string}[] = [];
    const taskAPI = new Function("readListMindmap", "canEdit", "Constants", "dayjs", "updateTransaction", "showMessage",
        "getListMindmapTabItem", "getTabTask", "cleanListMindmapHTML", "getListMindmapSiblingIDs", "normalizeListMindmapSummaryMetadata",
        taskSource + "; return {setTaskListItemMarker, nextTaskListMarker, nextTaskListStatus, TaskController};")(
        api.readListMindmap, (owner: any) => !owner.disabled && !owner.history && !owner.embedded,
        {CB_GET_HISTORY: "history", ATTRIBUTE_EDITING: "data-editing"},
        () => ({format: () => "20260920000000"}),
        (_owner: unknown, element: HTMLElement, before: string) => operations.push({id: element.dataset.nodeId,
            before, after: api.cleanListMindmapHTML(element.outerHTML)}), () => check.fail("Task update failed"),
        api.getListMindmapTabItem, api.getTabTask, api.cleanListMindmapHTML,
        api.getListMindmapSiblingIDs, api.normalizeListMindmapSummaryMetadata);
    const owner = {disabled: false, history: false, embedded: false, options: {action: [] as string[]}};
    let finishTask: boolean | Promise<boolean> = true;
    let menus = 0;
    let taskEdits = 0;
    const taskView = new api.ListMindmapView({host: taskHost, model: api.readListMindmap(taskList),
        labels: new Proxy({}, {get: (_target, key) => String(key)}), onExit: () => {},
        onEdit: () => taskEdits++, onMove: () => check.fail("Task control started a drag"),
        onRelationAdd: () => check.fail("Task control created a relation"),
        finishEdit: () => finishTask, onTaskMenu: () => menus++,
        isTaskCycle: (event: KeyboardEvent) => event.ctrlKey && event.key === "l",
        isTaskCompletionToggle: (event: KeyboardEvent) => event.ctrlKey && event.key === "k",
        onTaskToggle: (id: string, cycle: boolean) => controller.setTask(id,
            cycle ? taskAPI.nextTaskListStatus : taskAPI.nextTaskListMarker)});
    const controller = Object.assign(new taskAPI.TaskController(), {owner, list: taskList, view: taskView, disposed: false,
        taskChanges: Promise.resolve(), refresh: () => taskView.update(api.readListMindmap(taskList))});
    const taskNode = () => taskHost.querySelector<HTMLElement>(`[data-mindmap-id="${taskId}"]`);
    const taskButton = () => taskNode().querySelector<HTMLButtonElement>(".mindmap-view__task");
    const compare = () => {
        const sourceAction = taskItem.querySelector(".protyle-action--task");
        const button = taskButton();
        check.equal(button.querySelector("use").getAttribute("xlink:href"),
            sourceAction.querySelector("use").getAttribute("xlink:href"));
        for (const property of ["content", "fontSize", "transform"] as const) {
            check.equal(getComputedStyle(button, "::before")[property],
                getComputedStyle(sourceAction, "::before")[property]);
        }
        for (const property of ["maskImage", "height"] as const) {
            check.equal(getComputedStyle(button.querySelector("svg"))[property],
                getComputedStyle(sourceAction.querySelector("svg"))[property]);
        }
        const originals = taskItem.querySelectorAll(":scope > .p");
        const previews = taskNode().querySelectorAll(":scope > .mindmap-view__content > .p");
        check.equal(previews.length, originals.length);
        originals.forEach((original, index) => {
            for (const property of ["color", "textDecorationLine"] as const) {
                check.equal(getComputedStyle(previews[index])[property], getComputedStyle(original)[property]);
            }
        });
    };
    taskParent.style.fontSize = "16px";
    taskParent.style.color = "#223344";
    for (const marker of [" ", "/", "X", "x", "-", "?", "A", "\"", "&", "<", "\\"]) {
        taskAPI.setTaskListItemMarker(owner, taskItem, marker);
        controller.refresh();
        await settle();
        compare();
        check.equal(taskNode().querySelector("[data-node-id]"), null);
        check.equal(taskHost.querySelectorAll(".mindmap-view__task").length, 2);
        check.equal(taskView.model.root.taskMarker, undefined, "virtual roots are not tasks");
        const child = taskView.model.nodes.get(taskId).children[0];
        check.equal(taskView.model.nodes.get(child.id).taskMarker, "/");
        const childNode = taskHost.querySelector(`[data-mindmap-id="${child.id}"] .p`);
        check.equal(getComputedStyle(childNode).textDecorationLine, "none", "parent state never styles child tasks");
    }
    taskHost.scrollIntoView({block: "center"});
    await settle();
    const taskTextBounds = taskView.getContentHost(taskId).firstElementChild.getBoundingClientRect();
    const taskTextPoint = {x: Math.round(taskTextBounds.left + taskTextBounds.width / 2),
        y: Math.round(taskTextBounds.top + taskTextBounds.height / 2)};
    await require("electron").ipcRenderer.invoke("mindmap-view-native-input", [
        {type: "mouseMove", ...taskTextPoint},
        {type: "mouseDown", ...taskTextPoint, button: "left", clickCount: 1},
        {type: "mouseUp", ...taskTextPoint, button: "left", clickCount: 1},
        {type: "mouseDown", ...taskTextPoint, button: "left", clickCount: 2},
        {type: "mouseUp", ...taskTextPoint, button: "left", clickCount: 2},
    ]);
    await settle();
    check.equal(taskEdits, 1, "native double click opens the task node editor");
    taskEdits = 0;
    taskView.setEditing(undefined);
    const taskSourceHTML = taskList.outerHTML;
    taskView.setReadOnly(true);
    taskButton().click();
    taskButton().dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
    await settle();
    check.equal(taskList.outerHTML, taskSourceHTML);
    check.equal(menus, 0);
    check.equal(taskButton().disabled, true);
    taskView.setReadOnly(false);
    check.equal(taskButton().disabled, false);
    taskButton().dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
    check.equal(menus, 1);
    taskAPI.setTaskListItemMarker(owner, taskItem, " ");
    controller.refresh();
    operations.length = 0;
    taskButton().click();
    taskButton().click();
    await controller.taskChanges;
    check.equal(taskItem.dataset.task, " ");
    check.equal(operations.length, 2);
    check.ok(operations.every(operation => operation.id === taskId && !operation.after.includes("mindmap-view__")));
    const operation = operations[0];
    const replay = document.createElement("div");
    for (const [html, marker] of [[operation.after, "X"], [operation.before, " "]] as const) {
        replay.innerHTML = lute.SpinBlockDOM(html);
        check.equal(replay.querySelector(".li").getAttribute("data-task"), marker, "transaction snapshots preserve redo and undo states");
    }
    taskButton().dispatchEvent(new KeyboardEvent("keydown", {key: "l", ctrlKey: true, bubbles: true, cancelable: true}));
    await controller.taskChanges;
    check.equal(taskItem.dataset.task, "/");
    for (const [marker, expected] of [[" ", "X"], ["/", "X"], ["X", " "], ["-", " "], ["?", " "]]) {
        taskAPI.setTaskListItemMarker(owner, taskItem, marker);
        controller.refresh();
        const event = new KeyboardEvent("keydown", {key: "k", ctrlKey: true, bubbles: true, cancelable: true});
        taskButton().dispatchEvent(event);
        await controller.taskChanges;
        check.equal(event.defaultPrevented, true);
        check.equal(taskItem.dataset.task, expected);
    }
    const completedOperations = operations.length;
    for (const readonly of [false, true]) {
        taskView.setReadOnly(readonly);
        taskButton().dispatchEvent(new KeyboardEvent("keydown", {
            key: "k", ctrlKey: true, repeat: !readonly, bubbles: true, cancelable: true,
        }));
        await controller.taskChanges;
        check.equal(operations.length, completedOperations);
    }
    taskView.setReadOnly(false);
    taskAPI.setTaskListItemMarker(owner, taskItem, "/");
    controller.refresh();
    taskButton().dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    check.equal(taskEdits, 0);
    finishTask = false;
    taskButton().click();
    await controller.taskChanges;
    check.equal(taskItem.dataset.task, "/", "failed content saves prevent task changes");
    finishTask = true;
    for (const mode of ["disabled", "history", "embedded"] as const) {
        owner[mode] = true;
        await controller.setTask(taskId, () => "X");
        check.equal(taskItem.dataset.task, "/");
        owner[mode] = false;
    }
    let release: (result: boolean) => void;
    controller.activeEditor = {finish: () => new Promise<boolean>(resolve => release = resolve)};
    const pendingChange = controller.setTask(taskId, () => "X");
    await Promise.resolve();
    owner.disabled = true;
    release(true);
    await pendingChange;
    check.equal(taskItem.dataset.task, "/", "permission is rechecked after content saves");
    owner.disabled = false;
    controller.activeEditor = undefined;
    taskView.enterFullscreen();
    check.equal(getComputedStyle(taskButton().querySelector("svg")).maskImage.includes("task-in-progress.svg"), true);
    taskView.exitFullscreen();
    // 导出 DOM 的标记可以位于任务图标上；真实任务根节点仍显示复选框。
    const exportedTaskList = taskList.cloneNode(true) as HTMLElement;
    exportedTaskList.querySelectorAll<HTMLElement>('.li[data-subtype="t"]').forEach(item => {
        item.querySelector(".protyle-action--task").setAttribute("data-task", item.dataset.task);
        item.removeAttribute("data-task");
    });
    check.equal(api.readListMindmap(exportedTaskList).nodes.get(taskId).taskMarker, "/");
    exportedTaskList.querySelector(':scope > .li[data-subtype="u"]').remove();
    const rootModel = api.readListMindmap(exportedTaskList);
    check.equal(rootModel.root.virtual, false);
    check.equal(rootModel.root.taskMarker, "/");
    taskView.setReadOnly(true);
    taskView.update(rootModel);
    check.ok(taskButton());
    taskView.destroy();
    // 页签预览将任务操作交给所属脑图保存，外层页签渲染器不能接管派生控件。
    taskParent.innerHTML = lute.Md2BlockDOM("- Container\n");
    const tabList = taskParent.firstElementChild as HTMLElement;
    const tabNode = tabList.querySelector<HTMLElement>(".li");
    const tabNodeID = tabNode.dataset.nodeId;
    const tabContent = document.createElement("div");
    tabContent.innerHTML = lute.Md2BlockDOM("::: tabs\n@tab First\n\nOne\n@tab Second\n\nTwo\n:::\n{: tabs-task=\"true\"}\n");
    tabNode.querySelector(".p").replaceWith(tabContent.firstElementChild);
    const tabSource = tabNode.querySelector<HTMLElement>(".tabs");
    tabSource.querySelector(".tab-item-title").textContent = "";
    const nestedSource = document.createElement("div");
    nestedSource.innerHTML = lute.Md2BlockDOM("- Nested parent\n  - Nested child\n");
    const nestedList = nestedSource.firstElementChild as HTMLElement;
    api.retagMindmapBranch(nestedList, true);
    tabSource.querySelectorAll(".tab-item-content")[1].append(nestedList);
    const sourceActiveTab = tabSource.getAttribute("tabs-active-id");
    const tabItemIDs = Array.from(tabSource.querySelectorAll<HTMLElement>(":scope > .tab-item"))
        .map(item => item.dataset.nodeId);
    const tabHost = document.createElement("div");
    tabList.append(tabHost);
    const tabController = Object.assign(new taskAPI.TaskController(), {owner, list: tabList, disposed: false,
        taskChanges: Promise.resolve(), refresh: () => tabView.update(api.readListMindmap(tabList))});
    let tabMenus = 0;
    const tabView = new api.ListMindmapView({host: tabHost, model: api.readListMindmap(tabList), onExit: () => {},
        labels: {tabItem: "页签项块"},
        onTabTaskToggle: (id: string, itemID: string) => tabController.setTabTask(id, itemID, taskAPI.nextTaskListMarker),
        onTabTaskMenu: (id: string, itemID: string, anchor: HTMLElement) => {
            check.equal(id, tabNodeID);
            check.equal(itemID, tabItemIDs[1]);
            check.ok(anchor.classList.contains("tabs-task"));
            tabMenus++;
        }});
    tabController.view = tabView;
    check.equal(tabHost.querySelector(".tabs-tab-label").textContent, "页签项块");
    const tabButton = tabHost.querySelector<HTMLElement>(".tabs-tab");
    tabButton.dispatchEvent(new MouseEvent("pointerover", {bubbles: true}));
    check.equal(tabHost.querySelector<HTMLElement>('[role="tooltip"]').hidden, true,
        "tab buttons do not trigger the mindmap toolbar tooltip");
    tabButton.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
    check.equal(tabHost.querySelector<HTMLElement>('[role="tooltip"]').hidden, true);
    const fragmentHost = document.createElement("div");
    fragmentHost.className = "mindmap-view";
    const fragmentRoot = document.createElement("div");
    fragmentRoot.className = "protyle-wysiwyg";
    fragmentRoot.innerHTML = api.cleanListMindmapHTML(nestedList.outerHTML);
    fragmentHost.append(fragmentRoot);
    document.body.append(fragmentHost);
    const fragmentList = fragmentRoot.firstElementChild as HTMLElement;
    const localLists = api.getListMindmapElements(fragmentRoot);
    check.equal(localLists.length, 1);
    check.equal(localLists[0], fragmentList);
    const previewHost = document.createElement("div");
    previewHost.className = "mindmap-view";
    previewHost.append(fragmentList.cloneNode(true));
    fragmentList.append(previewHost);
    check.equal(api.getListMindmapElements(fragmentRoot).length, 1, "preview copies are never editable source maps");
    let restored = "";
    const unregisterFragment = api.registerListMindmapRoot(fragmentRoot, () => {}, (id: string) => restored = id);
    check.equal(api.restoreListMindmapFocus(fragmentRoot, fragmentList.firstElementChild), true);
    check.equal(restored, fragmentList.dataset.nodeId);
    fragmentHost.classList.add("mindmap-view__node--editing");
    previewHost.replaceChildren();
    let nestedEdited = "";
    const editableNestedView = new api.ListMindmapView({host: previewHost, model: api.readListMindmap(fragmentList),
        onExit: () => {}, onEdit: (id: string) => nestedEdited = id});
    const nestedNode = previewHost.querySelector<HTMLElement>(".mindmap-view__node");
    nestedNode.querySelector(".mindmap-view__content").dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    check.equal(nestedEdited, nestedNode.dataset.mindmapId, "an outer editing node must not disable inner double-clicks");
    nestedEdited = "";
    editableNestedView.setEditing(undefined);
    editableNestedView.focusNode(nestedNode.dataset.mindmapId);
    nestedNode.dispatchEvent(new KeyboardEvent("keydown", {key: "x", bubbles: true}));
    check.equal(nestedEdited, nestedNode.dataset.mindmapId, "inner keyboard editing remains available");
    editableNestedView.destroy();
    unregisterFragment();
    fragmentHost.remove();
    const outerOptions = {readonly: () => false, task: () => check.fail("Outer editor claimed a preview task")};
    api.tabsRender(taskParent, outerOptions);
    const tabSnapshot = api.cleanListMindmapHTML(tabList.outerHTML);
    api.destroyTabsRender(taskParent);
    api.tabsRender(taskParent, outerOptions);
    check.equal(api.cleanListMindmapHTML(tabList.outerHTML), tabSnapshot,
        "recreating tab navigation must not change the mindmap content snapshot");
    const savedTabs = document.createElement("div");
    savedTabs.innerHTML = tabSnapshot;
    check.equal(savedTabs.querySelector(".tabs-header, .tabs-divider, [data-tabs-hidden]"), null);
    check.equal(savedTabs.querySelectorAll(".tab-item").length, 2, "hidden tab content is retained");
    check.equal(savedTabs.querySelector(".tabs").getAttribute("tabs-task"), "true");
    check.equal(lute.BlockDOM2StdMd(savedTabs.querySelector(".tabs").outerHTML), lute.BlockDOM2StdMd(tabSource.outerHTML));
    const previewTask = (index = 1) => tabHost.querySelectorAll<HTMLElement>(".tabs-task")[index];
    const previewTab = (index = 1) => tabHost.querySelectorAll<HTMLElement>(".tabs-tab")[index];
    previewTab().click();
    const nestedPreview = () => tabHost.querySelector<HTMLElement>(".mindmap-view--nested");
    check.ok(nestedPreview());
    check.equal(nestedPreview().querySelectorAll(".mindmap-view__node").length, 2);
    check.equal(nestedPreview().getAttribute("role"), "img");
    check.ok(nestedPreview().getAttribute("aria-label").includes("Nested child"));
    check.ok(Array.from(nestedPreview().children).every((child: HTMLElement) => child.inert),
        "nested previews leave editing to their owner node");
    check.ok(nestedPreview().textContent.includes("Nested child"));
    const previousNestedView = (tabView as any).nestedViews.get(tabNodeID)[0];
    operations.length = 0;
    previewTask().click();
    await tabController.taskChanges;
    check.equal(operations.length, 1);
    check.equal(operations[0].id, tabList.dataset.nodeId);
    check.equal(api.getTabTask(api.getListMindmapTabItem(tabList, tabNodeID, tabItemIDs[1])), "X");
    check.equal(previewTask().getAttribute("data-task"), "X");
    check.equal(previousNestedView.destroyed, true, "refresh disposes the nested view and its observers");
    check.ok(nestedPreview());
    check.equal(previewTab().getAttribute("aria-selected"), "true", "saving a task preserves the visible preview tab");
    check.equal(tabHost.querySelector(".tabs-control"), null, "preview only exposes supported writes");
    check.equal(tabHost.querySelector("[data-node-id]"), null);
    check.equal(tabSource.getAttribute("tabs-active-id"), sourceActiveTab, "preview navigation does not change source navigation");
    for (const [html, marker] of [[operations[0].after, "X"], [operations[0].before, " "]] as const) {
        replay.innerHTML = lute.SpinBlockDOM(html);
        check.equal(api.getTabTask(replay.querySelectorAll(".tab-item")[1]), marker);
        check.ok(!html.includes("mindmap-view__"));
    }
    api.tabsRender(taskParent, outerOptions);
    previewTask().dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
    check.equal(tabMenus, 1);
    previewTask().click();
    previewTask().click();
    await tabController.taskChanges;
    check.equal(previewTask().getAttribute("data-task"), "X", "queued clicks read the latest source state");
    previewTask().dispatchEvent(new KeyboardEvent("keydown", {key: " ", bubbles: true, cancelable: true}));
    await tabController.taskChanges;
    check.equal(previewTask().getAttribute("data-task"), " ");
    const savedCount = operations.length;
    tabView.setReadOnly(true);
    check.equal(previewTask().getAttribute("aria-disabled"), "true");
    previewTask().click();
    await tabController.taskChanges;
    check.equal(operations.length, savedCount);
    previewTab(0).click();
    check.equal(previewTab(0).getAttribute("aria-selected"), "true", "readonly previews still navigate");
    tabView.setReadOnly(false);
    for (const mode of ["disabled", "history", "embedded"] as const) {
        owner[mode] = true;
        await tabController.setTabTask(tabNodeID, tabItemIDs[1], () => "X");
        check.equal(operations.length, savedCount);
        owner[mode] = false;
    }
    tabController.activeEditor = {finish: async () => false};
    previewTask().click();
    await tabController.taskChanges;
    check.equal(operations.length, savedCount, "failed content saves prevent tab task changes");
    tabController.activeEditor = undefined;
    const removedTab = api.getListMindmapTabItem(tabList, tabNodeID, tabItemIDs[1]);
    removedTab.remove();
    await tabController.setTabTask(tabNodeID, tabItemIDs[1], () => "X");
    check.equal(operations.length, savedCount, "removed tab IDs never produce an update");
    const lastNestedView = (tabView as any).nestedViews.get(tabNodeID)[0];
    tabView.setEditing(tabNodeID);
    check.equal(lastNestedView.destroyed, true, "entering the fragment editor disposes its nested previews");
    tabView.setEditing(undefined);
    tabSource.append(removedTab);
    tabView.update(api.readListMindmap(tabList));
    const finalNestedViews = Array.from((tabView as any).nestedViews.values()).flat();
    check.equal(finalNestedViews.length, 1);
    tabView.destroy();
    check.ok(finalNestedViews.every((view: any) => view.destroyed));
    api.destroyTabsRender(taskParent);
    taskParent.remove();

    // 使用编辑器的实际划选监听器，验证从两侧进入脑图、跨块移动及松手清理。
    const dragParent = document.createElement("div");
    dragParent.style.cssText = "position:fixed;inset:0;background:white;z-index:9999;overflow:auto";
    const dragEditor = document.createElement("div");
    dragEditor.className = "protyle-wysiwyg";
    dragEditor.style.cssText = "padding:20px 64px;box-sizing:border-box";
    dragEditor.innerHTML = lute.Md2BlockDOM("Before\n\n- Alpha\n- Beta\n\nAfter\n");
    const dragList = dragEditor.querySelector<HTMLElement>(".list");
    dragList.setAttribute("custom-sy-list-mindmap", "1");
    dragList.dataset.mindmapViewRendered = "true";
    const dragHost = document.createElement("div");
    dragHost.className = "mindmap-view";
    dragHost.style.height = "260px";
    dragList.append(dragHost);
    const dragView = new api.ListMindmapView({host: dragHost, model: api.readListMindmap(dragList)});
    const dragOverlay = document.createElement("div");
    dragOverlay.className = "fn__none";
    dragOverlay.style.position = "absolute";
    const dragStyle = document.createElement("style");
    dragStyle.textContent = ".fn__none {display:none} .drag-selection {position:absolute;pointer-events:none}";
    dragOverlay.classList.add("drag-selection");
    dragParent.append(dragEditor, dragOverlay, dragStyle);
    document.body.append(dragParent);
    const noop = () => {};
    const absent = () => false;
    const selectedCounts: string[][] = [];
    const services = {
        Constants: {ZWSP: "\u200b"},
        getAVTemplateInteractiveElement: absent, getAVSelectionRoot: absent, isAVDragSelectSupported: absent,
        isTableLikeView: absent, isMobile: absent, isPhablet: absent, shouldFoldEmbeddedListByAlt: absent,
        shouldOpenListItemAttr: absent, isHiddenTabContent: absent,
        isOnlyMeta: (event: MouseEvent) => (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey,
        repairHiddenTabSelection: noop, clearSelect: noop, hideAllElements: noop, globalClickHideMenu: noop,
        dragOverScroll: noop, stopScrollAnimation: noop, countBlockWord: (ids: string[]) => selectedCounts.push(ids),
    };
    const dragOwner = {
        element: dragParent, contentElement: dragParent, selectElement: dragOverlay,
        wysiwyg: {element: dragEditor}, options: {render: {breadcrumb: false}},
        toolbar: {isMultiSelectMode: absent},
        hint: {deactivateEmojiPanel: noop, element: document.createElement("div")},
    };
    new Function("protyle", "services", `const {${Object.keys(services).join(",")}} = services;\n` + dragSource)
        .call(Object.assign(dragOwner.wysiwyg, {host: dragHost, owner: dragOwner}), dragOwner, services);
    const dragErrors: string[] = [];
    const collectDragError = (event: ErrorEvent) => dragErrors.push(event.message);
    window.addEventListener("error", collectDragError);
    await settle();
    const selectedIDs = () => Array.from(dragEditor.querySelectorAll<HTMLElement>(".protyle-wysiwyg--select"))
        .map(item => item.dataset.nodeId);
    for (const side of ["left", "right"]) {
        for (const direction of [1, -1]) {
            dragEditor.querySelectorAll(".protyle-wysiwyg--select").forEach(item =>
                item.classList.remove("protyle-wysiwyg--select"));
            const rect = dragHost.getBoundingClientRect();
            const start = {x: Math.round(side === "left" ? rect.left - 32 : rect.right + 32),
                y: Math.round(rect.top + rect.height / 2)};
            const inside = {x: Math.round(side === "left" ? rect.left + 24 : rect.right - 24),
                y: start.y + 30 * direction};
            check.ok(dragHost.contains(document.elementFromPoint(inside.x, inside.y)));
            await nativeInput([
                {type: "mouseMove", ...start},
                {type: "mouseDown", ...start, button: "left", clickCount: 1},
                {type: "mouseMove", ...inside, button: "left"},
            ]);
            check.deepEqual(dragErrors, []);
            check.deepEqual(selectedIDs(), [dragList.dataset.nodeId], `${side} ${direction}: selects the whole mind map`);
            const adjacent = direction === 1 ? dragList.nextElementSibling : dragList.previousElementSibling;
            const outside = {x: inside.x, y: Math.round(adjacent.getBoundingClientRect().top + 10)};
            await nativeInput([{type: "mouseMove", ...outside, button: "left"}]);
            check.deepEqual(new Set(selectedIDs()), new Set([dragList.dataset.nodeId, adjacent.getAttribute("data-node-id")]));
            await nativeInput([{type: "mouseMove", ...inside, button: "left"}]);
            check.deepEqual(selectedIDs(), [dragList.dataset.nodeId], "returning into the mind map shrinks the selection");
            await nativeInput([{type: "mouseUp", ...inside, button: "left", clickCount: 1}]);
            check.deepEqual(dragErrors, []);
            check.equal(dragEditor.classList.contains("fn__pointer-none"), false);
            check.ok(dragOverlay.classList.contains("fn__none"));
            await nativeInput([{type: "mouseMove", ...outside}]);
            check.deepEqual(selectedIDs(), [dragList.dataset.nodeId], "moving after release does not extend the selection");
            check.ok(dragOverlay.classList.contains("fn__none"));

            // 点击空白画布或节点均退出块选中状态，并清理多块选区、端点标记和状态栏计数。
            adjacent.classList.add("protyle-wysiwyg--select");
            dragList.classList.add("protyle-wysiwyg--select-mode");
            dragList.setAttribute("select-start", "true");
            dragList.setAttribute("select-end", "true");
            selectedCounts.length = 0;
            const clickPoint = side === "left" ? inside : centerPoint(dragHost.querySelector(".mindmap-view__node"));
            await nativeInput([
                {type: "mouseMove", ...clickPoint},
                {type: "mouseDown", ...clickPoint, button: "left", clickCount: 1},
                {type: "mouseUp", ...clickPoint, button: "left", clickCount: 1},
            ]);
            check.deepEqual(dragErrors, []);
            check.deepEqual(selectedIDs(), [], "clicking the mind map clears the outer block selection");
            check.equal(dragList.classList.contains("protyle-wysiwyg--select-mode"), false);
            check.equal(dragList.hasAttribute("select-start"), false);
            check.equal(dragList.hasAttribute("select-end"), false);
            check.deepEqual(selectedCounts, [[]]);
        }
    }
    // 右键和多选工具栏操作保留选区，内嵌编辑器的工具栏同样不能取消其操作对象。
    dragList.classList.add("protyle-wysiwyg--select");
    const selectionPointerDown = (element: Element, button = 0) =>
        element.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, button}));
    selectionPointerDown(dragHost, 2);
    check.deepEqual(selectedIDs(), [dragList.dataset.nodeId]);
    dragOwner.toolbar.isMultiSelectMode = () => true;
    selectionPointerDown(dragHost);
    check.deepEqual(selectedIDs(), [dragList.dataset.nodeId]);
    dragOwner.toolbar.isMultiSelectMode = absent;
    const selectionToolbar = document.createElement("div");
    selectionToolbar.className = "protyle-toolbar";
    dragHost.append(selectionToolbar);
    selectionPointerDown(selectionToolbar);
    check.deepEqual(selectedIDs(), [dragList.dataset.nodeId]);
    check.deepEqual(dragErrors, []);
    window.removeEventListener("error", collectDragError);
    dragView.destroy();
    dragParent.remove();
    taskStyle.remove();
    hostParent.remove();

    // 结构撤销在布局完成后恢复操作前取景，保留小数偏移和缩放。
    const historyList = reset("- Root\n  - First\n  - Second\n");
    const historyHost = document.createElement("div");
    historyHost.style.width = "700px";
    document.body.append(historyHost);
    const historyView = new api.ListMindmapView({host: historyHost, model: api.readListMindmap(historyList)});
    await settle();
    Object.assign(historyView, {scale: 1.25, offsetX: -80.5, offsetY: 45.25});
    historyView.draw();
    const historyViewport = historyView.captureHistoryViewport();
    const historySource = historyList.outerHTML;
    const historyModel = api.readListMindmap(historyList);
    const insertedHistoryItem = (() => {
        const holder = document.createElement("div");
        holder.innerHTML = lute.Md2BlockDOM("- Inserted\n");
        return holder.firstElementChild.firstElementChild as HTMLElement;
    })();
    check.ok(api.addListMindmapNode(historyList, historyModel.root.children[0].id, "before", insertedHistoryItem));
    historyView.update(api.readListMindmap(historyList));
    historyView.focusNode(insertedHistoryItem.dataset.nodeId);
    await settle();
    const restoredHistory = document.createElement("div");
    restoredHistory.innerHTML = historySource;
    historyView.update(api.readListMindmap(restoredHistory.firstElementChild));
    historyView.restoreHistoryViewport(historyViewport);
    await settle();
    check.equal(historyView.captureHistoryViewport(), historyViewport, "undo restores exact pan and zoom after reflow");
    for (const invalid of ["{", "null", JSON.stringify({scale: 0, x: 1, y: 2}), JSON.stringify({scale: 1, x: "1", y: 2})]) {
        historyView.restoreHistoryViewport(invalid);
        await settle();
        check.equal(historyView.captureHistoryViewport(), historyViewport, "invalid context preserves the current viewport");
    }
    historyView.destroy();
    historyHost.remove();

    // 概要的触屏点选、编辑、复制及列表往返使用真实 DOM 和 Lute。
    const summaryList = reset("- Root\n  - First\n    - Descendant\n  - Second\n  - Third\n");
    const summaryModel = api.readListMindmap(summaryList);
    summaryModel.metadata.appearance = {version: 1, palette: ["#2563eb", "#15803d"], rootColor: "#1e293b"};
    api.writeListMindmapMetadata(summaryList, summaryModel.metadata);
    const summaryIds = summaryModel.root.children.map((node: ListMindmapNode) => node.id);
    const summaryHost = document.createElement("div");
    summaryHost.style.width = "700px";
    document.body.append(summaryHost);
    let summaryView: any;
    summaryView = new api.ListMindmapView({host: summaryHost, model: summaryModel, onExit: () => {},
        labels: new Proxy({}, {get: (_target, key) => String(key)}),
        colors: () => Array.from({length: 13}, (_, i) => ({label: `Summary color ${i}`, value: `rgb(${i}, 0, 0)`})),
        onManageLineColors: () => {},
        onSummaryBatchAdd: async (ranges: any[], expected: string) => {
            const model = api.readListMindmap(summaryList);
            check.equal(api.getListMindmapSummarySnapshot(model), expected);
            const added = api.addListMindmapSummaryRanges(model, ranges, () => "summary", "Summary");
            check.deepEqual(added, ["summary"]);
            api.writeListMindmapMetadata(summaryList, model.metadata);
            summaryView.update(api.readListMindmap(summaryList));
            return added;
        },
        onSummaryChange: (id: string, patch: object, expected: string) => {
            const model = api.readListMindmap(summaryList);
            const summary = model.metadata.summaries.find((item: {id: string}) => item.id === id);
            check.equal(JSON.stringify(summary), expected);
            Object.assign(summary, patch);
            api.writeListMindmapMetadata(summaryList, model.metadata);
            summaryView.update(api.readListMindmap(summaryList));
        }});
    await settle();
    summaryView.focusNode(summaryIds[0]);
    const summaryButton = summaryHost.querySelector<HTMLButtonElement>('.mindmap-view__inspector [aria-label="listMindmapSummary"]');
    for (const id of [summaryModel.root.id, summaryIds[0], summaryIds[1]]) {
        summaryView.focusNode(id);
        check.equal(summaryButton.hidden, false, "the node menu keeps the summary action in a stable position");
        check.equal(summaryButton.disabled, false, "a single real node can create a summary");
        check.equal(api.readListMindmap(summaryList).metadata.summaries?.length || 0, 0,
            "selecting a single node does not create a summary automatically");
        const fallbackSizing = id === summaryIds[1];
        const originalSupports = CSS.supports;
        if (fallbackSizing) {
            CSS.supports = (property: string, value?: string) => property === "field-sizing" ? false :
                value === undefined ? originalSupports(property) : originalSupports(property, value);
        }
        try {
            if (id === summaryIds[0]) {
                await require("electron").ipcRenderer.invoke("mindmap-view-native-touch", [
                    {type: "touchStart", touchPoints: [{id: 1, ...centerPoint(summaryButton)}]},
                    {type: "touchEnd", touchPoints: []},
                ]);
                await settle();
            } else {
                await clickMouse(summaryButton);
            }
        } finally {
            CSS.supports = originalSupports;
        }
        check.deepEqual(api.readListMindmap(summaryList).metadata.summaries[0].nodeIds, [id]);
        const editor = summaryHost.querySelector<HTMLInputElement>(".mindmap-view__summary-editor");
        check.ok(editor, "single-node creation opens summary text editing");
        check.equal(document.activeElement, editor);
        if (fallbackSizing) {
            editor.style.setProperty("field-sizing", "fixed");
        }
        editor.value = "概要";
        editor.dispatchEvent(new Event("input", {bubbles: true}));
        check.ok(editor.offsetWidth >= 44 && editor.offsetWidth <= 46,
            "two Chinese characters use two em plus shared input padding with native and fallback sizing");
        const shortWidth = editor.offsetWidth;
        editor.value = "Long summary text ".repeat(10);
        editor.dispatchEvent(new Event("input", {bubbles: true}));
        await settle();
        check.ok(editor.offsetWidth > shortWidth && editor.offsetWidth <= 240,
            "native and fallback inputs grow up to the maximum width");
        editor.value = "";
        editor.dispatchEvent(new Event("input", {bubbles: true}));
        check.equal(editor.offsetWidth, 44, "clearing text shrinks the input to its minimum width");
        editor.value = "输入法组合文字";
        editor.dispatchEvent(new Event("input", {bubbles: true}));
        editor.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", isComposing: true, bubbles: true}));
        check.equal(document.activeElement, editor, "composition Enter keeps the summary editor open");
        editor.value = "概要";
        editor.dispatchEvent(new CompositionEvent("compositionend", {data: editor.value, bubbles: true}));
        check.ok(editor.offsetWidth >= 44 && editor.offsetWidth <= 46, "composition completion also updates width");
        editor.value = "Single node summary";
        editor.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await settle();
        check.equal(api.readListMindmap(summaryList).metadata.summaries[0].label, "Single node summary");
        if (id === summaryModel.root.id) {
            check.equal(summaryHost.querySelector<HTMLElement>(".mindmap-view__summary").style.backgroundColor,
                summaryView.nodeElements.get(id).style.backgroundColor, "root summaries inherit the root background");
        }
        summaryView.focusNode(id);
        check.equal(summaryButton.disabled, true, "an identical single-node summary cannot be created twice");
        summaryButton.click();
        check.equal(api.readListMindmap(summaryList).metadata.summaries.length, 1);
        const resetSingleSummary = api.readListMindmap(summaryList);
        resetSingleSummary.metadata.summaries = [];
        api.writeListMindmapMetadata(summaryList, resetSingleSummary.metadata);
        summaryView.update(api.readListMindmap(summaryList));
    }
    const unthemedSummary = api.readListMindmap(summaryList);
    delete unthemedSummary.metadata.appearance;
    api.writeListMindmapMetadata(summaryList, unthemedSummary.metadata);
    summaryView.update(api.readListMindmap(summaryList));
    const virtualSummaryList = reset("- First\n- Second\n");
    const virtualSummaryModel = api.readListMindmap(virtualSummaryList);
    const virtualSummaryHost = document.createElement("div");
    document.body.append(virtualSummaryHost);
    const virtualSummaryView = new api.ListMindmapView({host: virtualSummaryHost, model: virtualSummaryModel,
        labels: new Proxy({}, {get: (_target, key) => String(key)}), onExit: () => {},
        onSummaryBatchAdd: async (): Promise<string[]> => { check.fail("virtual centers cannot create summaries"); return []; }});
    await settle();
    virtualSummaryView.focusNode(virtualSummaryModel.root.id);
    const virtualSummaryButton = virtualSummaryHost.querySelector<HTMLButtonElement>('.mindmap-view__inspector [aria-label="listMindmapSummary"]');
    check.equal(virtualSummaryButton.disabled, true, "virtual centers retain their existing restriction");
    virtualSummaryButton.click();
    virtualSummaryView.destroy();
    virtualSummaryHost.remove();
    summaryView.focusNode(summaryIds[0]);
    summaryView.draw();
    const singleSelectionCanvas = summaryHost.querySelector<HTMLCanvasElement>("canvas").toDataURL();
    for (const id of summaryIds.slice(1)) {
        summaryView.selectNode(id, true);
    }
    await settle();
    check.equal(summaryButton.hidden, false);
    check.equal(summaryButton.disabled, false);
    const summaryCanvas = summaryHost.querySelector<HTMLCanvasElement>("canvas");
    check.equal(summaryCanvas.toDataURL(), singleSelectionCanvas, "multi-selection does not draw summary brackets");
    check.equal(summaryHost.querySelector(".mindmap-view__summary-action"), null, "selection has no graph creation control");
    check.equal(summaryHost.querySelector(".mindmap-view__summary"), null, "selection alone does not create a summary");
    const outsideSummary = document.createElement("button");
    document.body.append(outsideSummary);
    for (const leave of [
        () => window.dispatchEvent(new Event("blur")),
        () => summaryHost.dispatchEvent(new FocusEvent("focusout", {relatedTarget: outsideSummary})),
    ]) {
        const preview = summaryCanvas.toDataURL();
        const selected = summaryView.getSelectedIds();
        leave();
        check.equal(summaryButton.closest<HTMLElement>(".mindmap-view__inspector").hidden, true, "leaving the mindmap hides the node menu");
        check.deepEqual(summaryView.getSelectedIds(), selected, "focus changes preserve the node selection");
        const inactive = summaryCanvas.toDataURL();
        check.equal(inactive, preview, "ordinary selection does not add summary graphics that need blur cleanup");
        summaryView.draw();
        check.equal(summaryCanvas.toDataURL(), inactive, "no stale preview remains until a later redraw");
        summaryView.focusNode(summaryIds[0]);
        for (const id of summaryIds.slice(1)) {
            summaryView.selectNode(id, true);
        }
        check.equal(summaryButton.closest<HTMLElement>(".mindmap-view__inspector").hidden, false, "multi-selection restores the node menu");
    }
    outsideSummary.remove();
    await settle();
    await moveMouse(summaryButton);
    check.equal(summaryHost.querySelector('.mindmap-view__inspector [aria-label="listMindmapSummary"]'), summaryButton,
        "the node menu retains the summary button across selection and focus changes");
    const summaryActionBounds = summaryButton.getBoundingClientRect();
    check.equal(document.elementFromPoint(summaryActionBounds.left + summaryActionBounds.width / 2,
        summaryActionBounds.top + summaryActionBounds.height / 2)?.closest("button"), summaryButton,
    "the bottom summary button is reachable at its rendered position");
    await clickMouse(summaryButton);
    const summaryInput = summaryHost.querySelector<HTMLInputElement>(".mindmap-view__summary-editor");
    check.ok(summaryInput, "new summaries enter text editing after the menu action");
    check.equal(document.activeElement, summaryInput, "creation focuses the new summary text");
    summaryInput.value = "<script>plain text</script> " + "Long summary ".repeat(25);
    summaryInput.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    await settle();
    const summaryLabel = summaryHost.querySelector<HTMLElement>(".mindmap-view__summary");
    check.ok(summaryLabel.textContent.startsWith("<script>"));
    check.equal(summaryLabel.querySelector("script"), null);
    check.equal(summaryLabel.tagName, "DIV");
    check.ok(summaryLabel.classList.contains("mindmap-view__node--summary"));
    check.ok(summaryLabel.classList.contains("mindmap-view__node--selected"));
    check.equal(summaryLabel.classList.contains("b3-button"), false);
    const ordinaryNode = summaryHost.querySelector<HTMLElement>(".mindmap-view__node[data-mindmap-id]");
    for (const property of ["padding", "border-radius", "font-size", "line-height"]) {
        check.equal(getComputedStyle(summaryLabel).getPropertyValue(property), getComputedStyle(ordinaryNode).getPropertyValue(property));
    }
    const summaryViewport = summaryHost.querySelector<HTMLElement>(".mindmap-view__viewport");
    const summaryPosition = summaryView.summaryPositions.get("summary");
    const summaryBounds = summaryLabel.getBoundingClientRect();
    const bracketCenter = summaryViewport.getBoundingClientRect().top + summaryView.offsetY +
        (summaryPosition.top + summaryPosition.bottom) / 2 * summaryView.scale;
    check.ok(Math.abs((summaryBounds.top + summaryBounds.bottom) / 2 - bracketCenter) < 1);
    const memberBounds = [...summaryView.positions.values()].filter((position: {id: string}) => position.id !== summaryModel.root.id)
        .map((position: {id: string}) => summaryHost.querySelector(`[data-mindmap-id="${position.id}"]`).getBoundingClientRect());
    const summaryOriginY = summaryViewport.getBoundingClientRect().top + summaryView.offsetY;
    check.ok(summaryOriginY + summaryPosition.top * summaryView.scale < Math.min(...memberBounds.map(rect => rect.top)));
    check.ok(summaryOriginY + summaryPosition.bottom * summaryView.scale > Math.max(...memberBounds.map(rect => rect.bottom)),
        "summary brackets enclose all visible descendants");
    summaryView.clearSelection();
    summaryLabel.focus();
    check.equal(document.activeElement, summaryLabel);
    // 离屏窗口未获得系统焦点时，显式派发聚焦事件以覆盖节点选择行为。
    summaryLabel.dispatchEvent(new FocusEvent("focus"));
    check.equal(summaryView.selectedSummary, "summary", "focusing the summary selects it");
    for (const key of [" ", "Enter"]) {
        summaryView.clearSelection();
        const event = new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true});
        summaryLabel.dispatchEvent(event);
        check.equal(event.defaultPrevented, true);
        check.equal(summaryView.selectedSummary, "summary", `keyboard activation with ${key}`);
    }
    summaryView.clearSelection();
    summaryLabel.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "touch", pointerId: 91,
        isPrimary: true, button: 0}));
    check.equal(summaryView.pointer, undefined, "selecting a summary does not start canvas or node dragging");
    summaryLabel.click();
    check.equal(summaryView.selectedSummary, "summary", "touching the summary selects it");
    const summaryInspector = summaryHost.querySelector<HTMLElement>(".mindmap-view__inspector");
    check.equal(summaryInspector.querySelector('[aria-label="edit"]'), null, "summary editing uses the same double-click gesture as nodes");
    for (const width of [240, 320, 700]) {
        summaryHost.style.width = `${width}px`;
        summaryView.renderInspector();
        await settle();
        const summaryPalette = summaryInspector.querySelector<HTMLElement>(".mindmap-view__palette");
        const fixed = ["delete", "listMindmapManageLineColors"]
            .map(key => summaryInspector.querySelector<HTMLElement>(`[aria-label="${key}"]`));
        check.ok(summaryPalette.children[5].getBoundingClientRect().right <= summaryPalette.getBoundingClientRect().right + 1,
            "removing the edit control leaves room for default and five summary colors");
        check.ok(summaryPalette.children[6].getBoundingClientRect().left >= summaryPalette.getBoundingClientRect().right - 1);
        const positions = fixed.map(control => control.getBoundingClientRect().left);
        summaryPalette.scrollLeft = summaryPalette.scrollWidth;
        check.deepEqual(fixed.map(control => control.getBoundingClientRect().left), positions,
            "summary delete and color settings stay fixed while colors scroll");
        const bounds = summaryInspector.getBoundingClientRect();
        fixed.forEach(control => check.ok(control.getBoundingClientRect().right <= bounds.right));
        check.equal(summaryPalette.children.length, 14, "all existing summary colors remain accessible");
    }
    summaryHost.style.width = "700px";
    summaryLabel.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    const reopenedSummary = summaryHost.querySelector<HTMLInputElement>(".mindmap-view__summary-editor");
    check.ok(reopenedSummary, "double-clicking still opens summary text editing without the toolbar edit button");
    reopenedSummary.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    const savedSummary = api.readListMindmap(summaryList).metadata.summaries[0];
    const summaryContext = summaryHost.querySelector("canvas").getContext("2d");
    const setSummaryTheme = (property: string, value: string) =>
        summaryHost.style.setProperty(`--b3-mindmap-summary-${property}`, value);
    const checkSummaryStyle = (color: string, width: number) => {
        summaryView.draw();
        check.equal(summaryContext.strokeStyle, color);
        check.equal(summaryContext.lineWidth, width);
    };
    summaryHost.style.setProperty("--b3-border-color", "#123456");
    summaryHost.style.setProperty("--b3-theme-primary", "#abcdef");
    summaryView.selectedSummary = undefined;
    checkSummaryStyle("#123456", 1.5);
    summaryView.selectedSummary = "summary";
    checkSummaryStyle("#123456", 2.5);
    setSummaryTheme("color", "var(--b3-theme-primary)");
    setSummaryTheme("width", "3px");
    summaryView.selectedSummary = undefined;
    checkSummaryStyle("#abcdef", 3);
    summaryView.model.metadata.summaries[0].color = "#445566";
    checkSummaryStyle("#445566", 3);
    summaryView.selectedSummary = "summary";
    checkSummaryStyle("#445566", 4);
    setSummaryTheme("selected-color", "#778899");
    setSummaryTheme("selected-width", "6");
    checkSummaryStyle("#445566", 6);
    summaryView.options.printLayout = true;
    checkSummaryStyle("#445566", 3);
    summaryView.options.printLayout = false;
    summaryView.printTransform = {scale: 1, offsetX: 0, offsetY: 0};
    checkSummaryStyle("#445566", 3);
    summaryView.printTransform = undefined;
    setSummaryTheme("selected-color", "invalid-color");
    for (const width of ["auto", "0", "-2", "Infinity", "2em", "3px-invalid"]) {
        setSummaryTheme("selected-width", width);
        checkSummaryStyle("#445566", 4);
    }
    delete summaryView.model.metadata.summaries[0].color;
    summaryView.selectedSummary = undefined;
    setSummaryTheme("color", "invalid-color");
    setSummaryTheme("width", "-1");
    checkSummaryStyle("#123456", 1.5);
    setSummaryTheme("color", "#112233");
    setSummaryTheme("width", "2");
    setSummaryTheme("hover-color", "#556677");
    setSummaryTheme("hover-width", "4px");
    setSummaryTheme("selected-color", "#778899");
    setSummaryTheme("selected-width", "6");
    summaryView.setHoveredLine("summary:summary");
    checkSummaryStyle("#556677", 4);
    summaryView.selectedSummary = "summary";
    checkSummaryStyle("#778899", 6);
    for (const value of ["initial", "unset", "invalid-color"]) {
        setSummaryTheme("selected-color", value);
        checkSummaryStyle("#112233", 6);
    }
    summaryView.model.metadata.summaries[0].color = "#445566";
    setSummaryTheme("selected-color", "#778899");
    checkSummaryStyle("#445566", 6);
    summaryView.selectedSummary = undefined;
    checkSummaryStyle("#445566", 4);
    summaryView.options.printLayout = true;
    checkSummaryStyle("#445566", 2);
    summaryView.options.printLayout = false;
    summaryView.printTransform = {scale: 1, offsetX: 0, offsetY: 0};
    checkSummaryStyle("#445566", 2);
    summaryView.printTransform = undefined;
    delete summaryView.model.metadata.summaries[0].color;
    setSummaryTheme("hover-color", "initial");
    setSummaryTheme("hover-width", "auto");
    const summaryScale = summaryView.scale;
    summaryView.scale = 0.5;
    checkSummaryStyle("#112233", 5);
    summaryView.scale = summaryScale;
    summaryView.setHoveredLine();
    sendPointer(summaryLabel, "pointermove", summaryBounds.left + 1, summaryBounds.top + 1);
    check.equal(summaryView.hoveredLine, "summary:summary");
    summaryViewport.dispatchEvent(new PointerEvent("pointerleave"));
    check.equal(summaryView.hoveredLine, undefined);
    ["color", "width", "hover-color", "hover-width", "selected-color", "selected-width"].forEach(property =>
        summaryHost.style.removeProperty(`--b3-mindmap-summary-${property}`));
    summaryHost.style.removeProperty("--b3-border-color");
    summaryHost.style.removeProperty("--b3-theme-primary");
    summaryView.draw();
    const originalIDs = ids(summaryList);
    api.retagMindmapBranch(summaryList, true);
    const plain = api.convertListMindmapToList(summaryList, "UL2OL", lute);
    const converted = document.createElement("div");
    converted.innerHTML = plain;
    check.equal(converted.firstElementChild.getAttribute("data-type"), "NodeList");
    check.deepEqual(api.readListMindmap(converted.firstElementChild).metadata.summaries, [savedSummary]);
    api.retagMindmapBranch(converted.firstElementChild, true);
    check.deepEqual(ids(converted.firstElementChild as HTMLElement), originalIDs);
    check.deepEqual(api.readListMindmap(converted.firstElementChild).metadata.summaries, [savedSummary]);
    const copied = summaryList.cloneNode(true) as HTMLElement;
    const copiedIDs = new Map<string, string>();
    [copied, ...Array.from(copied.querySelectorAll<HTMLElement>("[data-node-id]"))].forEach(element => {
        const id = Lute.NewNodeID();
        copiedIDs.set(element.dataset.nodeId, id);
        element.dataset.nodeId = id;
    });
    api.remapListMindmapIDs(copied, copiedIDs);
    const copiedSummary = api.readListMindmap(copied).metadata.summaries[0];
    check.equal(copiedSummary.parentId, copiedIDs.get(savedSummary.parentId));
    check.deepEqual(copiedSummary.nodeIds, savedSummary.nodeIds.map((id: string) => copiedIDs.get(id)));
    const crossingModel = api.readListMindmap(summaryList);
    crossingModel.metadata.summaries = [{...savedSummary, nodeIds: summaryIds.slice(0, 2)}];
    api.writeListMindmapMetadata(summaryList, crossingModel.metadata);
    summaryView.update(api.readListMindmap(summaryList));
    summaryView.focusNode(summaryIds[1]);
    summaryView.selectNode(summaryIds[2], true);
    check.equal(summaryButton.disabled, true, "crossing ranges disable direct creation");
    check.equal(summaryButton.getAttribute("aria-description"), "listMindmapSummaryConflict");
    await settle();
    check.equal(summaryButton.hidden, false, "conflicting selections retain the disabled menu action");
    summaryButton.click();
    check.deepEqual(api.readListMindmap(summaryList).metadata.summaries[0].nodeIds, summaryIds.slice(0, 2));
    summaryView.clearSelection();
    const keyboardModel = api.readListMindmap(summaryList);
    keyboardModel.metadata.summaries = [];
    api.writeListMindmapMetadata(summaryList, keyboardModel.metadata);
    summaryView.update(api.readListMindmap(summaryList));
    summaryView.focusNode(summaryIds[0]);
    for (const id of summaryIds.slice(1)) {
        summaryView.selectNode(id, true);
    }
    summaryButton.focus();
    const summaryKey = new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true});
    summaryButton.dispatchEvent(summaryKey);
    check.equal(summaryKey.defaultPrevented, false, "summary buttons retain native keyboard activation");
    summaryButton.click();
    await settle();
    const keyboardInput = summaryHost.querySelector<HTMLInputElement>(".mindmap-view__summary-editor");
    check.ok(keyboardInput, "keyboard activation creates an editable summary from selected nodes");
    keyboardInput.value = savedSummary.label;
    keyboardInput.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    await settle();
    summaryView.destroy();
    summaryHost.style.width = "280px";
    summaryView = new api.ListMindmapView({host: summaryHost, model: api.readListMindmap(summaryList),
        readOnly: true, printLayout: true, onExit: () => {}});
    await settle();
    await settle();
    const printedLabel = summaryHost.querySelector<HTMLElement>(".mindmap-view__summary");
    const printedBounds = printedLabel.getBoundingClientRect();
    const printViewport = summaryHost.querySelector(".mindmap-view__viewport").getBoundingClientRect();
    check.ok(printedBounds.right <= printViewport.right + 1, "narrow PDF previews include the full summary width");
    check.ok(printedBounds.bottom <= printViewport.bottom + 1, "PDF previews include tall summary labels");
    printedLabel.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    check.equal(summaryHost.querySelector(".mindmap-view__summary-editor"), null);
    check.equal(summaryHost.querySelector('.mindmap-view__inspector [aria-label="listMindmapSummary"]'), null);
    summaryView.destroy();
    summaryHost.remove();
    api.deleteListMindmapNode(summaryList, summaryIds[0]);
    api.deleteListMindmapNode(summaryList, summaryIds[1]);
    check.deepEqual(api.readListMindmap(summaryList).metadata.summaries[0].nodeIds, [summaryIds[2]]);
    api.deleteListMindmapNode(summaryList, summaryIds[2]);
    check.deepEqual(api.readListMindmap(summaryList).metadata.summaries, []);

    // 多层概要在折叠、复制、列表往返和窄幅打印中保留成员与内外层边界。
    {
        const nestedList = reset("- Root\n  - First\n    - A\n    - B\n  - Second\n  - Third\n");
        const nestedModel = api.readListMindmap(nestedList);
        const nestedFirst = nestedModel.root.children[0];
        const nestedRanges = [
            {parentId: nestedList.dataset.nodeId, nodeIds: [nestedModel.root.id]},
            {parentId: nestedModel.root.id, nodeIds: nestedModel.root.children.slice(0, 2).map((node: ListMindmapNode) => node.id)},
            {parentId: nestedModel.root.id, nodeIds: [nestedFirst.id]},
            {parentId: nestedFirst.id, nodeIds: nestedFirst.children.map((node: ListMindmapNode) => node.id)},
        ];
        let nestedID = 0;
        check.deepEqual(api.addListMindmapSummaryRanges(nestedModel, nestedRanges, () => `nested-${++nestedID}`,
            "Nested summary ".repeat(20)), ["nested-1", "nested-2", "nested-3", "nested-4"]);
        check.equal(nestedModel.metadata.version, 2);
        api.writeListMindmapMetadata(nestedList, nestedModel.metadata);
        const nestedHost = document.createElement("div");
        nestedHost.style.width = "900px";
        nestedHost.style.fontSize = "32px";
        document.body.append(nestedHost);
        let nestedView = new api.ListMindmapView({host: nestedHost, model: api.readListMindmap(nestedList), onExit: () => {}});
        await settle();
        const checkNestedBounds = () => {
            ["nested-1", "nested-2", "nested-3"].forEach((id, index) => {
                const outer = nestedView.summaryPositions.get(id);
                const inner = nestedView.summaryPositions.get(`nested-${index + 2}`);
                check.ok(outer.x > inner.labelX + inner.width, `${id} encloses the inner label horizontally`);
                check.ok(outer.top < inner.top && outer.top < inner.labelY);
                check.ok(outer.bottom > inner.bottom && outer.bottom > inner.labelY + inner.height);
            });
            const inner = nestedView.summaryPositions.get("nested-3");
            const next = nestedView.positions.get(nestedModel.root.children[1].id);
            check.ok(inner.labelY + inner.height < next.y, "tall inner labels do not overlap the next sibling branch");
        };
        checkNestedBounds();
        const expandedOuterX = nestedView.summaryPositions.get("nested-2").x;
        nestedFirst.children.forEach((node: ListMindmapNode) => check.ok(nestedView.positions.has(node.id)));
        nestedModel.nodes.get(nestedFirst.id).element.setAttribute("fold", "1");
        nestedView.update(api.readListMindmap(nestedList));
        await settle();
        check.equal(nestedView.summaryPositions.has("nested-4"), false);
        check.ok(nestedView.summaryPositions.get("nested-2").x < expandedOuterX);
        nestedModel.nodes.get(nestedFirst.id).element.removeAttribute("fold");
        nestedView.update(api.readListMindmap(nestedList));
        await settle();
        checkNestedBounds();
        const nestedCopy = nestedList.cloneNode(true) as HTMLElement;
        const nestedCopiedIDs = new Map<string, string>();
        [nestedCopy, ...Array.from(nestedCopy.querySelectorAll<HTMLElement>("[data-node-id]"))].forEach(element => {
            const id = Lute.NewNodeID();
            nestedCopiedIDs.set(element.dataset.nodeId, id);
            element.dataset.nodeId = id;
        });
        api.remapListMindmapIDs(nestedCopy, nestedCopiedIDs);
        check.deepEqual(api.readListMindmap(nestedCopy).metadata.summaries.map((entry: {nodeIds: string[]}) => entry.nodeIds),
            nestedRanges.map(range => range.nodeIds.map((id: string) => nestedCopiedIDs.get(id))));
        api.retagMindmapBranch(nestedList, true);
        const nestedConverted = document.createElement("div");
        nestedConverted.innerHTML = api.convertListMindmapToList(nestedList, "UL2OL", lute);
        check.deepEqual(api.readListMindmap(nestedConverted.firstElementChild).metadata.summaries, nestedModel.metadata.summaries);
        nestedView.destroy();
        nestedHost.style.width = "280px";
        nestedView = new api.ListMindmapView({host: nestedHost, model: api.readListMindmap(nestedList),
            readOnly: true, printLayout: true, onExit: () => {}});
        await settle();
        const nestedPrintBounds = nestedHost.querySelector(".mindmap-view__viewport").getBoundingClientRect();
        nestedHost.querySelectorAll(".mindmap-view__summary").forEach(label => {
            const rect = label.getBoundingClientRect();
            check.ok(rect.left >= nestedPrintBounds.left - 1 && rect.right <= nestedPrintBounds.right + 1);
            check.ok(rect.top >= nestedPrintBounds.top - 1 && rect.bottom <= nestedPrintBounds.bottom + 1);
        });
        check.equal(api.readListMindmap(nestedList).metadata.version, 2);
        nestedView.destroy();
        nestedHost.remove();
    }

    const batchList = reset("- Root\n  - First\n    - A\n    - B\n  - Second\n    - C\n    - D\n");
    const batchHost = document.createElement("div");
    batchHost.style.width = "700px";
    document.body.append(batchHost);
    const batchHistory: {before: string, after: string}[] = [];
    let batchID = 0;
    const batchLabels: Record<string, string> = {
        listMindmapSummaryBatch: "创建 ${count} 个概要", confirm: "确定", cancel: "取消",
    };
    const batchView = new api.ListMindmapView({host: batchHost, model: api.readListMindmap(batchList), onExit: () => {},
        labels: new Proxy(batchLabels, {get: (target, key) => target[String(key)] || String(key)}),
        onSummaryBatchAdd: async (ranges: any[], expected: string) => {
            const model = api.readListMindmap(batchList);
            check.equal(api.getListMindmapSummarySnapshot(model), expected);
            const before = batchList.outerHTML;
            const added = api.addListMindmapSummaryRanges(model, ranges, () => `batch-${++batchID}`, "Summary");
            check.ok(added);
            api.writeListMindmapMetadata(batchList, model.metadata);
            batchHistory.push({before, after: batchList.outerHTML});
            batchView.update(api.readListMindmap(batchList));
            return added;
        }});
    await settle();
    const batchViewport = batchHost.querySelector<HTMLElement>(".mindmap-view__viewport");
    const multiSelect = batchHost.querySelector<HTMLButtonElement>('.mindmap-view__toolbar [aria-label="multiSelect"]');
    check.ok(multiSelect, "multi-select is available before choosing a node");
    multiSelect.click();
    check.equal(multiSelect.getAttribute("aria-pressed"), "true");
    const batchModel = api.readListMindmap(batchList);
    const leafIDs = batchModel.root.children.flatMap((node: ListMindmapNode) => node.children.map(child => child.id));
    for (const id of leafIDs) {
        batchHost.querySelector(`[data-mindmap-id="${id}"]`).dispatchEvent(new PointerEvent("pointerdown", {
            bubbles: true, pointerId: 81, pointerType: "touch", isPrimary: true, button: 0,
        }));
    }
    check.equal(batchView.getSelectedIds().length, 4, "touch multi-select uses the ordinary selection");
    check.equal(batchView.pointer, undefined, "multi-select taps cannot arm node dragging");
    check.equal(batchHistory.length, 0);
    const batchInspector = batchHost.querySelector<HTMLElement>(".mindmap-view__inspector");
    check.equal(batchInspector.hidden, false);
    check.equal(batchInspector.querySelector('[aria-label="multiSelect"]'), null);
    const batchButton = batchInspector.querySelector<HTMLButtonElement>('[aria-label="listMindmapSummary"]');
    check.equal(batchHost.querySelector(".mindmap-view__summary-action"), null);
    await settle();
    check.equal(batchButton.hidden, false);
    check.equal(batchButton.querySelector("use").getAttribute("xlink:href"), "#iconGroups");
    check.equal(batchButton.disabled, false);
    check.equal(batchButton.dataset.tooltip, batchLabels.listMindmapSummaryBatch.replace("${count}", "2"));
    check.equal(batchInspector.querySelector<HTMLButtonElement>('[aria-label="connect"]').disabled, true);
    await moveMouse();
    for (const [background, primary] of [["#ffffff", "#2563eb"], ["#1e1e1e", "#93c5fd"]]) {
        batchHost.style.setProperty("--b3-theme-background", background);
        batchHost.style.setProperty("--b3-theme-primary", primary);
        const sibling = batchInspector.querySelector('[aria-label="delete"]');
        for (const property of ["color", "background-color", "border-radius", "padding"]) {
            check.equal(getComputedStyle(batchButton).getPropertyValue(property), getComputedStyle(sibling).getPropertyValue(property),
                "summary actions use the shared node controls in light and dark themes");
        }
    }
    batchHost.style.removeProperty("--b3-theme-background");
    batchHost.style.removeProperty("--b3-theme-primary");
    for (const width of [240, 320, 700]) {
        batchHost.style.width = `${width}px`;
        batchHost.style.fontSize = "32px";
        await settle();
        const bounds = batchInspector.getBoundingClientRect();
        check.ok(bounds.width <= batchHost.offsetWidth - 16);
        for (const control of [batchButton, multiSelect]) {
            const rect = control.getBoundingClientRect();
            const hostBounds = batchHost.getBoundingClientRect();
            check.ok(rect.left >= hostBounds.left && rect.right <= hostBounds.right);
        }
    }
    batchHost.style.fontSize = "";
    const selectedBeforeAction = [...batchView.getSelectedIds()];
    const actionBounds = batchButton.getBoundingClientRect();
    batchButton.dispatchEvent(new PointerEvent("pointerdown", {pointerId: 85, pointerType: "touch", isPrimary: true,
        button: 0, bubbles: true, clientX: actionBounds.left + 1, clientY: actionBounds.top + 1}));
    check.deepEqual(batchView.getSelectedIds(), selectedBeforeAction, "touching the menu action preserves the selection");
    batchButton.click();
    await settle();
    check.equal(batchHistory.length, 1, "clicking summary submits all groups once without a confirmation step");
    check.equal(api.readListMindmap(batchList).metadata.summaries.length, 2);
    const firstBatchSummary = batchHost.querySelector<HTMLInputElement>(".mindmap-view__summary-editor");
    check.ok(firstBatchSummary, "batch creation immediately opens the first new summary for editing");
    check.equal(document.activeElement, firstBatchSummary);
    check.equal(batchView.selectedSummary, api.readListMindmap(batchList).metadata.summaries[0].id);
    firstBatchSummary.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    check.equal(batchButton.disabled, true, "identical groups cannot be created twice");
    const restoreBatch = (html: string) => {
        const restored = document.createElement("div");
        restored.innerHTML = html;
        return restored.firstElementChild;
    };
    check.equal(api.readListMindmap(restoreBatch(batchHistory[0].before)).metadata.summaries, undefined);
    check.equal(api.readListMindmap(restoreBatch(batchHistory[0].after)).metadata.summaries.length, 2);
    multiSelect.click();
    batchView.clearSelection();
    const leafRects = leafIDs.map((id: string) => batchHost.querySelector(`[data-mindmap-id="${id}"]`).getBoundingClientRect());
    const left = Math.min(...leafRects.map((rect: DOMRect) => rect.left)) - 1;
    const top = Math.min(...leafRects.map((rect: DOMRect) => rect.top)) - 1;
    const right = Math.max(...leafRects.map((rect: DOMRect) => rect.right)) + 1;
    const bottom = Math.max(...leafRects.map((rect: DOMRect) => rect.bottom)) + 1;
    sendPointer(batchViewport, "pointerdown", left, top);
    sendPointer(batchViewport, "pointermove", right, bottom);
    sendPointer(batchViewport, "pointerup", right, bottom);
    check.equal(batchView.getSelectedIds().length, 4);
    check.equal(batchInspector.hidden, false, "ordinary marquee selection opens the node menu");
    check.equal(batchButton.disabled, true, "existing groups are not duplicated after marquee selection");
    batchView.update(api.readListMindmap(batchList));
    check.equal(batchButton.disabled, true, "external updates recalculate action availability");
    multiSelect.click();
    batchHost.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    check.equal(batchView.multiSelect, false);
    check.equal(multiSelect.getAttribute("aria-pressed"), "false");
    check.equal(batchHistory.length, 1, "leaving selection mode does not create another batch");
    batchView.destroy();
    batchHost.remove();
    style.remove();
    return "List mindmap DOM cases passed";
};

test("list mindmap mutations preserve block data in the real DOM and Lute", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 90000,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-mindmap-view-test-"));
    const script = path.join(temporary, "run.cjs");
    const typescript = require("typescript") as typeof import("typescript");
    const compile = (file: string) => typescript.transpileModule(
        readFileSync(file, "utf8").replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
            compilerOptions: {target: typescript.ScriptTarget.ES2021},
        }).outputText;
    const inputModules = ["../../../util/escape.ts", "../../util/normalizeText.ts", "../../runtimeCapabilities.ts",
        "../../../util/keymapBindings.ts", "../../util/hotKey.ts",
        "../../util/longTextWrap.ts", "../../util/inlineElementBoundary.ts", "../../util/inlineElementMarker.ts",
        "../../util/hasClosest.ts", "../../wysiwyg/getBlock.ts", "../../util/selection.ts",
        "../../wysiwyg/taskListMarker.ts", "../../wysiwyg/turnIntoList.ts", "../../wysiwyg/input.ts"];
    let inputSource = inputModules.map(file => {
        // 选区计算与编辑器选区操作共用模块作用域，保留拆分函数之间的调用关系。
        const files = file === "../../util/selection.ts" ? ["../../util/selectionOffsets.ts", file] : [file];
        const names = files.flatMap(file => {
            const module = typescript.createSourceFile(file, readFileSync(path.join(__dirname, file), "utf8"),
                typescript.ScriptTarget.ES2021, true);
            return module.statements.filter(typescript.isVariableStatement).filter(statement =>
                statement.modifiers?.some(modifier => modifier.kind === typescript.SyntaxKind.ExportKeyword))
                .flatMap(statement => statement.declarationList.declarations.map(declaration => declaration.name.getText(module)));
        });
        const code = files.map(file => compile(path.join(__dirname, file))).join("\n");
        return `const {${names.join(", ")}} = (() => {${code}\nreturn {${names.join(", ")}};})();\n`;
    }).join("\n");
    const editorSource = typescript.createSourceFile("editor.ts", readFileSync(path.join(__dirname, "editor.ts"), "utf8"),
        typescript.ScriptTarget.ES2021, true);
    const listItemCapabilities: import("typescript").PropertyAssignment[] = [];
    const findListItemCapability = (node: import("typescript").Node) => {
        if (typescript.isPropertyAssignment(node) && node.name.getText(editorSource) === "listItemFragment") {
            listItemCapabilities.push(node);
        }
        typescript.forEachChild(node, findListItemCapability);
    };
    findListItemCapability(editorSource);
    assert.equal(listItemCapabilities.length, 1);
    inputSource += `\nconst configureListItemInput = (protyle) => {
        registerProtyleRuntimeCapabilities(protyle, {${listItemCapabilities.map(item => item.getText(editorSource)).join(",\n")}});
    };`;
    const keydownSource = typescript.createSourceFile("keydown.ts", readFileSync(path.join(__dirname, "../../wysiwyg/keydown.ts"), "utf8"),
        typescript.ScriptTarget.ES2021, true);
    const shortcutStatements: import("typescript").Node[] = [];
    const findShortcut = (node: import("typescript").Node) => {
        if ((typescript.isVariableStatement(node) && node.declarationList.declarations.some(item =>
            ["isMatchList", "isMatchOList", "isMatchCheck", "isMatchQuote"].includes(item.name.getText(keydownSource)))) ||
            (typescript.isIfStatement(node) && ["isProtyleListItemFragment(", "isMatchList", "isMatchOList", "isMatchCheck"]
                .every(name => node.expression.getText(keydownSource).includes(name)))) {
            shortcutStatements.push(node);
        }
        typescript.forEachChild(node, findShortcut);
    };
    findShortcut(keydownSource);
    assert.equal(shortcutStatements.length, 5);
    const hintSource = typescript.createSourceFile("hint.ts", readFileSync(path.join(__dirname, "../../hint/index.ts"), "utf8"),
        typescript.ScriptTarget.ES2021, true);
    const hint = hintSource.statements.filter(typescript.isClassDeclaration).find(item => item.name?.text === "Hint");
    const fill = hint.members.find(item => item.name?.getText(hintSource) === "fill");
    inputSource += typescript.transpileModule(`\nconst listShortcut = (protyle, nodeElement, event) => {
        ${shortcutStatements.map(item => item.getText(keydownSource)).join("\n")}
    };
    class ListHint {${fill.getText(hintSource)}}`, {compilerOptions: {target: typescript.ScriptTarget.ES2021}}).outputText;
    const tabsSource = "const {tabsRender, destroyTabsRender, getTabTask, getTabTitle, getTabTitleBlock, revealTabsForTarget} = (() => {" +
        ["../../../util/escape.ts", "../tabsState.ts", "../tabsDrag.ts", "../tabsAttributes.ts", "../tabsVisibility.ts", "../tabsRender.ts"]
            .map(file => compile(path.join(__dirname, file))).join("\n") +
        "return {tabsRender, destroyTabsRender, getTabTask, getTabTitle, getTabTitleBlock, revealTabsForTarget};})();\n";
    const source = tabsSource + compile(path.join(__dirname, "../../wysiwyg/tabsList.ts")) +
        compile(path.join(__dirname, "../av/richTextValue.ts")) + compile(path.join(__dirname, "../../wysiwyg/listContext.ts")) +
        compile(path.join(__dirname, "summary.ts")) + compile(path.join(__dirname, "connectors.ts")) +
        compile(path.join(__dirname, "appearance.ts")) + compile(path.join(__dirname, "model.ts")) +
        compile(path.join(__dirname, "preferences.ts")) + compile(path.join(__dirname, "fold.ts")) +
        compile(path.join(__dirname, "routing.ts")) + compile(path.join(__dirname, "pan.ts")) +
        compile(path.join(__dirname, "clipboard.ts")) + compile(path.join(__dirname, "view.ts")) +
        compile(path.join(__dirname, "legacy.ts")) + compile(path.join(__dirname, "migrate.ts")) +
        compile(path.join(__dirname, "create.ts")) + compile(path.join(__dirname, "render.ts"));
    const css = require("sass").compile(path.resolve(__dirname, "../../../assets/scss/business/_block.scss")).css +
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss/component/_svg.scss")).css +
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss/component/_slider.scss")).css +
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss/component/_text-field.scss")).css +
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss/component/_button.scss")).css +
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss/component/_select.scss")).css +
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss/business/_color.scss")).css +
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss/component/_tooltips.scss")).css +
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss/protyle/_mindmap-view.scss")).css;
    const taskCSS = require("sass").compile(path.resolve(__dirname, "../../../assets/scss/protyle/_wysiwyg.scss")).css +
        require("sass").compile(path.resolve(__dirname, "../../../assets/scss/component/_typography.scss")).css;
    const indexSource = typescript.createSourceFile("index.ts", readFileSync(path.join(__dirname, "index.ts"), "utf8"),
        typescript.ScriptTarget.Latest, true);
    const transactionSource = typescript.createSourceFile("transaction.ts",
        readFileSync(path.join(__dirname, "../../wysiwyg/transaction.ts"), "utf8"), typescript.ScriptTarget.Latest, true);
    const updateTransaction = transactionSource.statements.find(statement => typescript.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(transactionSource) === "updateTransaction"));
    const controllerSource = compile(path.join(__dirname, "viewport.ts")) + compile(path.join(__dirname, "foldMenu.ts")) +
        compile(path.join(__dirname, "../../util/hasClosest.ts")) +
        compile(path.join(__dirname, "../../wysiwyg/getBlock.ts")) + compile(path.join(__dirname, "index.ts")) +
        typescript.transpileModule(updateTransaction.getText(transactionSource).replace(/^export /, ""), {
            compilerOptions: {target: typescript.ScriptTarget.ES2021},
        }).outputText;
    const controller = indexSource.statements.find(typescript.isClassDeclaration);
    const taskMethods = controller.members.filter(member => ["setTask", "setTabTask", "queueTask", "change"]
        .includes(member.name?.getText(indexSource)));
    const listSource = typescript.createSourceFile("list.ts", readFileSync(path.join(__dirname, "../../wysiwyg/list.ts"), "utf8"),
        typescript.ScriptTarget.Latest, true);
    const setter = listSource.statements.filter(typescript.isVariableStatement).find(statement =>
        statement.declarationList.declarations.some(item => item.name.getText(listSource) === "setTaskListItemMarker"));
    const taskSource = compile(path.join(__dirname, "../../wysiwyg/taskListMarker.ts")) +
        typescript.transpileModule(setter.getText(listSource).replace(/^export /, "") +
            `\nclass TaskController {${taskMethods.map(member => member.getText(indexSource)).join("\n")}}`, {
                compilerOptions: {target: typescript.ScriptTarget.ES2021},
            }).outputText;
    const wysiwygSource = typescript.createSourceFile("index.ts",
        readFileSync(path.join(__dirname, "../../wysiwyg/index.ts"), "utf8"), typescript.ScriptTarget.Latest, true);
    let mouseDownBinding: import("typescript").CallExpression;
    const findMouseDown = (node: import("typescript").Node) => {
        if (typescript.isCallExpression(node) && node.expression.getText(wysiwygSource) === "this.element.addEventListener" &&
            node.arguments[0]?.getText(wysiwygSource) === '"mousedown"') {
            mouseDownBinding = node;
        }
        typescript.forEachChild(node, findMouseDown);
    };
    findMouseDown(wysiwygSource);
    assert.ok(mouseDownBinding);
    const constructor = controller.members.find(typescript.isConstructorDeclaration);
    const pointerDownBinding = constructor.body.statements.find(statement =>
        typescript.isExpressionStatement(statement) && typescript.isCallExpression(statement.expression) &&
        statement.expression.expression.getText(indexSource) === "this.host.addEventListener" &&
        statement.expression.arguments[0]?.getText(indexSource) === '"pointerdown"');
    assert.ok(pointerDownBinding);
    const dragSource = compile(path.join(__dirname, "../../util/hasClosest.ts")) +
        compile(path.join(__dirname, "../../wysiwyg/getBlock.ts")) +
        compile(path.join(__dirname, "../../wysiwyg/blockDragSelect.ts")) +
        "const {BLOCK_SELECTION_CLASS, getBlockSelectionModeElement, clearBlockSelectionMode} = (() => {" +
        compile(path.join(__dirname, "../../wysiwyg/blockSelection.ts")) +
        "return {BLOCK_SELECTION_CLASS, getBlockSelectionModeElement, clearBlockSelectionMode};})();\n" +
        compile(path.join(__dirname, "../../gutter/restore.ts")) +
        "const {hideElements} = (() => {" + compile(path.join(__dirname, "../../ui/hideElements.ts")) +
        "return {hideElements};})();\n" +
        typescript.transpileModule(mouseDownBinding.getText(wysiwygSource) + ";\n" + pointerDownBinding.getText(indexSource), {
            compilerOptions: {target: typescript.ScriptTarget.ES2021},
        }).outputText;
    const lutePath = path.resolve(__dirname, "../../../../stage/protyle/js/lute/lute.min.js");
    // 展开测试函数，避免断言失败时 Node 从压缩后的源码提取表达式而掩盖实际错误。
    const browserSource = typescript.transpileModule(`(${browserCases.toString()})`, {
        compilerOptions: {target: typescript.ScriptTarget.ES2021},
    }).outputText.trim().replace(/^"use strict";\s*/, "").replace(/;$/, "");
    const code = `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    win.webContents.debugger.attach("1.3");
    ipcMain.handle("mindmap-view-ime", async (_event, text) => {
        await win.webContents.debugger.sendCommand("Input.imeSetComposition", {
            text, selectionStart: text.length, selectionEnd: text.length,
        });
    });
    ipcMain.handle("mindmap-view-insert-text", async (_event, text) => {
        await win.webContents.debugger.sendCommand("Input.insertText", {text});
    });
    ipcMain.handle("mindmap-view-print-media", async (_event, media) => {
        await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {media});
    });
    ipcMain.handle("mindmap-view-native-input", async (_event, events) => {
        win.webContents.focus();
        for (const event of events) {
            if (event.type === "mouseWheel") {
                // 隐藏窗口通过调试协议注入滚轮，直接交给渲染器的输入路由。
                await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
                    type: "mouseWheel", x: event.x, y: event.y, buttons: 0,
                    deltaX: -event.deltaX, deltaY: -event.deltaY,
                });
            } else {
                // 拖拽移动明确携带按下的按钮状态，避免切换触摸模拟后丢失原生指针捕获。
                if (event.type === "mouseMove" && event.button) {
                    event.modifiers = [...(event.modifiers || []), event.button + "buttondown"];
                }
                win.webContents.sendInputEvent(event);
            }
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    });
    ipcMain.handle("mindmap-view-native-touch", async (_event, events) => {
        win.webContents.focus();
        await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: true, maxTouchPoints: 2});
        try {
            for (const event of events) {
                if (event.type === "wait") {
                    await new Promise(resolve => setTimeout(resolve, event.delay));
                    continue;
                }
                await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", event);
                await new Promise(resolve => setTimeout(resolve, 30));
            }
        } finally {
            await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: false});
        }
    });
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(require("node:fs").readFileSync(${JSON.stringify(lutePath)}, "utf8"));
        const result = await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserSource})(${JSON.stringify(source)}, ${JSON.stringify(css)}, ${JSON.stringify(taskSource)}, ${JSON.stringify(taskCSS)}, ${JSON.stringify(dragSource)}, ${JSON.stringify(inputSource)}, ${JSON.stringify(controllerSource)})`)});
        console.log(result);
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`;
    writeFileSync(script, code, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const executable = require("electron") as unknown as string;
        const result = await promisify(execFile)(executable, [script], {env, timeout: 80000, windowsHide: true});
        assert.match(result.stdout, /List mindmap DOM cases passed/);
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
