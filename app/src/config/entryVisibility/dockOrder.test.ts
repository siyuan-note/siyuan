import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";
import {
    applyDockEntryOrderSnapshot,
    createDockEntryOrderSnapshot,
    DOCK_ORDER_SCOPE_BY_POSITION,
    DOCK_ORDER_SCOPES,
    getCurrentDockEntryOrderSnapshot,
    getDockEntryOrderSnapshot,
    getDockOrderContainer,
    isDockOrderScope,
    mergeCurrentDockEntryOrders,
    mergeDockEntryOrderSnapshot,
    moveDockEntryOrderSnapshot,
    type TDockEntryMover,
    type IDockOrderLayout,
    type TDockOrderSnapshot,
} from "./dockOrder";

class FakeDockItem {
    public dataset: {entryId?: string; type?: string};
    public parent?: FakeDockContainer;
    public classList: {contains: (name: string) => boolean};

    constructor(type: string, options: {entryId?: string; hidden?: boolean} = {}) {
        this.dataset = {type, entryId: options.entryId};
        const classes = new Set(["dock__item", ...(options.hidden ? ["fn__none"] : [])]);
        this.classList = {contains: (name) => classes.has(name)};
    }

    public getAttribute(name: string) {
        if (name === "data-entry-id") {
            return this.dataset.entryId || null;
        }
        if (name === "data-type") {
            return this.dataset.type || null;
        }
        return null;
    }

    public before(item: FakeDockItem) {
        this.parent?.insertBefore(item, this);
    }

    public after(item: FakeDockItem) {
        this.parent?.insertBefore(item, this.parent.children[this.parent.children.indexOf(this) + 1]);
    }

    public get parentElement() {
        return this.parent;
    }
}

class FakeDockContainer {
    public children: FakeDockItem[] = [];

    constructor(items: FakeDockItem[] = []) {
        items.forEach((item) => this.append(item));
    }

    public append(item: FakeDockItem) {
        this.insertBefore(item);
    }

    public insertBefore(item: FakeDockItem, reference?: FakeDockItem) {
        let index = reference ? this.children.indexOf(reference) : this.children.length;
        if (item.parent) {
            const oldIndex = item.parent.children.indexOf(item);
            if (oldIndex > -1) {
                item.parent.children.splice(oldIndex, 1);
                if (item.parent === this && oldIndex < index) {
                    index--;
                }
            }
        }
        this.children.splice(index < 0 ? this.children.length : index, 0, item);
        item.parent = this;
    }
}

const asElement = (item: FakeDockItem) => item as unknown as HTMLElement;
const asContainer = (container: FakeDockContainer) => container as unknown as HTMLElement;

const layoutWith = (containers: FakeDockContainer[]): IDockOrderLayout => ({
    leftDock: {elements: containers.slice(0, 2).map(asContainer)},
    rightDock: {elements: containers.slice(2, 4).map(asContainer)},
    bottomDock: {elements: containers.slice(4, 6).map(asContainer)},
});

const emptySnapshot = () => createDockEntryOrderSnapshot({});

test("dock order scopes map to all six runtime containers", () => {
    const containers = Array.from({length: 6}, () => new FakeDockContainer());
    const layout = layoutWith(containers);
    assert.equal(DOCK_ORDER_SCOPES.length, 6);
    assert.equal(getDockOrderContainer(DOCK_ORDER_SCOPE_BY_POSITION.LeftTop, layout), asContainer(containers[0]));
    assert.equal(getDockOrderContainer(DOCK_ORDER_SCOPE_BY_POSITION.LeftBottom, layout), asContainer(containers[1]));
    assert.equal(getDockOrderContainer(DOCK_ORDER_SCOPE_BY_POSITION.RightTop, layout), asContainer(containers[2]));
    assert.equal(getDockOrderContainer(DOCK_ORDER_SCOPE_BY_POSITION.RightBottom, layout), asContainer(containers[3]));
    assert.equal(getDockOrderContainer(DOCK_ORDER_SCOPE_BY_POSITION.BottomLeft, layout), asContainer(containers[4]));
    assert.equal(getDockOrderContainer(DOCK_ORDER_SCOPE_BY_POSITION.BottomRight, layout), asContainer(containers[5]));
    assert.equal(isDockOrderScope("dock.order.LeftTop"), true);
    assert.equal(isDockOrderScope("dock.order.Unknown"), false);
});

test("dock order snapshot removes duplicates and appends missing catalog entries to their default slots", () => {
    const snapshot = createDockEntryOrderSnapshot({
        LeftTop: ["file", "file", "plugin:one:dock"],
        LeftBottom: ["bookmark"],
        RightTop: ["file", "graph"],
        BottomRight: ["bottom-right"],
    }, [
        {key: "file", position: "LeftTop"},
        {key: "outline", position: "LeftTop"},
        {key: "bookmark", position: "LeftBottom"},
        {key: "tag", position: "LeftBottom"},
        {key: "agentChat", position: "RightTop"},
        {key: "backlink", position: "RightBottom"},
        {key: "bottom-left", position: "BottomLeft"},
        {key: "bottom-right", position: "BottomRight"},
    ]);

    assert.deepEqual(snapshot[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop], ["file", "plugin:one:dock", "outline"]);
    assert.deepEqual(snapshot[DOCK_ORDER_SCOPE_BY_POSITION.LeftBottom], ["bookmark", "tag"]);
    assert.deepEqual(snapshot[DOCK_ORDER_SCOPE_BY_POSITION.RightTop], ["graph", "agentChat"]);
    assert.deepEqual(snapshot[DOCK_ORDER_SCOPE_BY_POSITION.RightBottom], ["backlink"]);
    assert.deepEqual(snapshot[DOCK_ORDER_SCOPE_BY_POSITION.BottomLeft], ["bottom-left"]);
    assert.deepEqual(snapshot[DOCK_ORDER_SCOPE_BY_POSITION.BottomRight], ["bottom-right"]);
    assert.equal(DOCK_ORDER_SCOPES.flatMap((scope) => snapshot[scope]).filter((key) => key === "file").length, 1);
});

test("runtime dock snapshot reads direct items, keeps hidden items, and uses stable plugin entry IDs", () => {
    const hiddenOutline = new FakeDockItem("outline", {hidden: true});
    const plugin = new FakeDockItem("plugin-runtime-type", {entryId: "plugin:sample:dock"});
    const fileOnRight = new FakeDockItem("file");
    const containers = [
        new FakeDockContainer([hiddenOutline, plugin]),
        new FakeDockContainer(),
        new FakeDockContainer(),
        new FakeDockContainer([fileOnRight]),
        new FakeDockContainer(),
        new FakeDockContainer(),
    ];
    const snapshot = getDockEntryOrderSnapshot(layoutWith(containers));

    assert.deepEqual(snapshot[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop].slice(0, 2),
        ["outline", "plugin:sample:dock"]);
    assert.equal(snapshot[DOCK_ORDER_SCOPE_BY_POSITION.RightBottom].includes("file"), true);
    assert.equal(snapshot[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop].includes("file"), false);
    assert.equal(hiddenOutline.classList.contains("fn__none"), true);
});

test("current dock snapshot contains only DOM entries without catalog defaults", () => {
    const plugin = new FakeDockItem("plugin-runtime-type", {entryId: "plugin:sample:dock"});
    const outline = new FakeDockItem("outline");
    const containers = [
        new FakeDockContainer([outline, plugin]),
        ...Array.from({length: 5}, () => new FakeDockContainer()),
    ];

    const current = getCurrentDockEntryOrderSnapshot(layoutWith(containers));

    assert.deepEqual(current[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop], ["outline", "plugin:sample:dock"]);
    assert.deepEqual(DOCK_ORDER_SCOPES.flatMap((scope) => current[scope]), ["outline", "plugin:sample:dock"]);
    assert.equal(getDockEntryOrderSnapshot(layoutWith(containers))[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop]
        .includes("file"), true);
});

test("merging a dock snapshot preserves an unavailable plugin key at its saved slot", () => {
    const defaults = emptySnapshot();
    defaults[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop] = ["file", "outline"];
    const merged = mergeDockEntryOrderSnapshot(defaults, {
        [DOCK_ORDER_SCOPE_BY_POSITION.LeftTop]: ["outline", "plugin:disabled:dock", "file"],
    });

    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop],
        ["outline", "plugin:disabled:dock", "file"]);
});

test("synchronizing a dock snapshot keeps the current loaded order and preserves unavailable plugins", () => {
    const current = emptySnapshot();
    current[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop] = ["outline", "file"];
    const merged = mergeCurrentDockEntryOrders(current, {
        [DOCK_ORDER_SCOPE_BY_POSITION.LeftTop]: ["file", "plugin:disabled:dock", "outline"],
    });

    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop],
        ["outline", "plugin:disabled:dock", "file"]);
});

test("synchronizing uses current placement while preserving globally unique unavailable plugins", () => {
    const current = emptySnapshot();
    current[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop] = ["outline"];
    current[DOCK_ORDER_SCOPE_BY_POSITION.RightBottom] = ["file"];
    const merged = mergeCurrentDockEntryOrders(current, {
        [DOCK_ORDER_SCOPE_BY_POSITION.LeftTop]: ["file", "plugin:disabled:dock", "outline"],
        [DOCK_ORDER_SCOPE_BY_POSITION.RightBottom]: ["plugin:disabled:dock", "file"],
    });

    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop], ["plugin:disabled:dock", "outline"]);
    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.RightBottom], ["file"]);
    assert.equal(DOCK_ORDER_SCOPES.flatMap((scope) => merged[scope])
        .filter((key) => key === "plugin:disabled:dock").length, 1);
    assert.equal(DOCK_ORDER_SCOPES.flatMap((scope) => merged[scope])
        .filter((key) => key === "file").length, 1);
});

test("synchronizing filters stale loaded placements before preserving unknown slots", () => {
    const current = emptySnapshot();
    current[DOCK_ORDER_SCOPE_BY_POSITION.RightTop] = ["loaded"];
    const merged = mergeCurrentDockEntryOrders(current, {
        [DOCK_ORDER_SCOPE_BY_POSITION.LeftTop]: ["loaded"],
        [DOCK_ORDER_SCOPE_BY_POSITION.RightTop]: ["unknown-before", "loaded", "unknown-after"],
    });

    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop], []);
    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.RightTop],
        ["unknown-before", "loaded", "unknown-after"]);
});

test("profiles without dock orders preserve the current six-slot layout", () => {
    const current = emptySnapshot();
    current[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop] = ["outline", "file"];
    current[DOCK_ORDER_SCOPE_BY_POSITION.BottomRight] = ["plugin:sample:dock"];

    assert.deepEqual(mergeDockEntryOrderSnapshot(current), current);
});

test("merging a dock snapshot applies saved placement and the first saved scope owns duplicate keys", () => {
    const current = emptySnapshot();
    current[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop] = ["file", "outline"];
    current[DOCK_ORDER_SCOPE_BY_POSITION.RightTop] = ["file", "graph"];
    const merged = mergeDockEntryOrderSnapshot(current, {
        [DOCK_ORDER_SCOPE_BY_POSITION.LeftBottom]: ["file", "plugin:disabled:dock"],
        [DOCK_ORDER_SCOPE_BY_POSITION.RightTop]: ["graph", "file", "plugin:disabled:dock"],
    });

    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop], ["outline"]);
    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.LeftBottom], ["file", "plugin:disabled:dock"]);
    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.RightTop], ["graph"]);
    assert.equal(DOCK_ORDER_SCOPES.flatMap((scope) => merged[scope]).filter((key) => key === "file").length, 1);
    assert.equal(DOCK_ORDER_SCOPES.flatMap((scope) => merged[scope])
        .filter((key) => key === "plugin:disabled:dock").length, 1);
});

test("merging a partial saved snapshot moves declared entries and keeps undeclared current entries", () => {
    const current = emptySnapshot();
    current[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop] = ["file", "outline"];
    current[DOCK_ORDER_SCOPE_BY_POSITION.RightTop] = ["graph"];

    const merged = mergeDockEntryOrderSnapshot(current, {
        [DOCK_ORDER_SCOPE_BY_POSITION.RightTop]: ["file", "graph"],
    });

    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop], ["outline"]);
    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.RightTop], ["file", "graph"]);
});

test("merging keeps the saved order of loaded entries moved from another scope", () => {
    const current = emptySnapshot();
    current[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop] = ["new-entry", "file", "outline"];
    current[DOCK_ORDER_SCOPE_BY_POSITION.RightTop] = ["graph"];

    const merged = mergeDockEntryOrderSnapshot(current, {
        [DOCK_ORDER_SCOPE_BY_POSITION.LeftTop]: ["file", "graph", "outline"],
    });

    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop],
        ["new-entry", "file", "graph", "outline"]);
    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.RightTop], []);
});

test("merging saved placement is idempotent and keeps new current entries", () => {
    const current = emptySnapshot();
    current[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop] = ["outline", "new-left"];
    current[DOCK_ORDER_SCOPE_BY_POSITION.RightTop] = ["file", "graph"];
    const saved = {
        [DOCK_ORDER_SCOPE_BY_POSITION.LeftTop]: ["file", "plugin:disabled:dock", "outline"],
        [DOCK_ORDER_SCOPE_BY_POSITION.RightTop]: ["graph", "file"],
    };

    const merged = mergeDockEntryOrderSnapshot(current, saved);

    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop],
        ["file", "plugin:disabled:dock", "outline", "new-left"]);
    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.RightTop], ["graph"]);
    assert.deepEqual(mergeDockEntryOrderSnapshot(merged, saved), merged);
});

test("moving a dock entry snapshot is atomic across scopes and supports empty targets", () => {
    const snapshot = emptySnapshot();
    snapshot[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop] = ["file", "outline"];
    snapshot[DOCK_ORDER_SCOPE_BY_POSITION.RightBottom] = ["backlink"];

    const crossed = moveDockEntryOrderSnapshot(
        snapshot,
        "file",
        DOCK_ORDER_SCOPE_BY_POSITION.RightBottom,
        "backlink",
    );
    assert.deepEqual(crossed?.[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop], ["outline"]);
    assert.deepEqual(crossed?.[DOCK_ORDER_SCOPE_BY_POSITION.RightBottom], ["file", "backlink"]);
    assert.equal(DOCK_ORDER_SCOPES.flatMap((scope) => crossed?.[scope] || [])
        .filter((key) => key === "file").length, 1);

    const emptied = moveDockEntryOrderSnapshot(
        crossed,
        "file",
        DOCK_ORDER_SCOPE_BY_POSITION.BottomLeft,
    );
    assert.deepEqual(emptied?.[DOCK_ORDER_SCOPE_BY_POSITION.RightBottom], ["backlink"]);
    assert.deepEqual(emptied?.[DOCK_ORDER_SCOPE_BY_POSITION.BottomLeft], ["file"]);
});

test("moving within one dock scope detects invalid and no-op drops", () => {
    const snapshot = emptySnapshot();
    snapshot[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop] = ["file", "outline", "inbox"];

    assert.deepEqual(moveDockEntryOrderSnapshot(
        snapshot,
        "inbox",
        DOCK_ORDER_SCOPE_BY_POSITION.LeftTop,
        "file",
    )?.[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop], ["inbox", "file", "outline"]);
    assert.equal(moveDockEntryOrderSnapshot(
        snapshot,
        "file",
        DOCK_ORDER_SCOPE_BY_POSITION.LeftTop,
        "outline",
    ), undefined);
    assert.equal(moveDockEntryOrderSnapshot(
        snapshot,
        "file",
        DOCK_ORDER_SCOPE_BY_POSITION.LeftTop,
        "file",
    ), undefined);
    assert.equal(moveDockEntryOrderSnapshot(
        snapshot,
        "missing",
        DOCK_ORDER_SCOPE_BY_POSITION.LeftTop,
    ), undefined);
});

test("applying dock order sorts hidden items and keeps an unknown plugin in its current slot", () => {
    const file = new FakeDockItem("file");
    const unknownPlugin = new FakeDockItem("plugin-runtime", {entryId: "plugin:unknown:dock"});
    const outline = new FakeDockItem("outline", {hidden: true});
    const leftTop = new FakeDockContainer([file, unknownPlugin, outline]);
    const containers = [leftTop, ...Array.from({length: 5}, () => new FakeDockContainer())];
    const snapshot: TDockOrderSnapshot = emptySnapshot();
    snapshot[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop] = ["outline", "file"];

    assert.equal(applyDockEntryOrderSnapshot(snapshot, layoutWith(containers)), true);
    assert.deepEqual(leftTop.children, [outline, unknownPlugin, file]);
    assert.equal(outline.classList.contains("fn__none"), true);
    assert.equal(applyDockEntryOrderSnapshot(snapshot, layoutWith(containers)), false);
    assert.equal(leftTop.children.includes(file), true);
    assert.equal(file.parent, leftTop);
    assert.equal(asElement(file).dataset.type, "file");
});

test("applying dock order moves entries across containers and is idempotent", () => {
    const file = new FakeDockItem("file");
    const outline = new FakeDockItem("outline", {hidden: true});
    const graph = new FakeDockItem("graph");
    const leftTop = new FakeDockContainer([file, outline]);
    const rightTop = new FakeDockContainer([graph]);
    const containers = [
        leftTop,
        new FakeDockContainer(),
        rightTop,
        ...Array.from({length: 3}, () => new FakeDockContainer()),
    ];
    const layout = layoutWith(containers);
    const snapshot = emptySnapshot();
    snapshot[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop] = ["outline"];
    snapshot[DOCK_ORDER_SCOPE_BY_POSITION.RightTop] = ["graph", "file"];

    assert.equal(applyDockEntryOrderSnapshot(snapshot, layout), true);
    assert.deepEqual(leftTop.children, [outline]);
    assert.deepEqual(rightTop.children, [graph, file]);
    assert.equal(file.parent, rightTop);
    assert.equal(outline.classList.contains("fn__none"), true);
    assert.equal(applyDockEntryOrderSnapshot(snapshot, layout), false);
});

test("applying dock order invokes the mover for cross-scope and same-scope changes", () => {
    const first = new FakeDockItem("first");
    const second = new FakeDockItem("second");
    const third = new FakeDockItem("third");
    const fourth = new FakeDockItem("fourth");
    const leftTop = new FakeDockContainer([first, second]);
    const rightTop = new FakeDockContainer([third, fourth]);
    const containers = [
        leftTop,
        new FakeDockContainer(),
        rightTop,
        ...Array.from({length: 3}, () => new FakeDockContainer()),
    ];
    const layout = layoutWith(containers);
    const snapshot = emptySnapshot();
    snapshot[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop] = [
        "fourth",
        "plugin:disabled:dock",
        "second",
        "first",
        "third",
    ];
    const calls: Array<{scope: string; type?: string; previousType?: string}> = [];
    const mover: TDockEntryMover = (scope, item, previousItem) => {
        calls.push({
            scope,
            type: item.dataset.type,
            previousType: previousItem?.dataset.type,
        });
        const target = getDockOrderContainer(scope, layout) as unknown as FakeDockContainer;
        if (previousItem) {
            (previousItem as unknown as FakeDockItem).after(item as unknown as FakeDockItem);
        } else {
            target.insertBefore(item as unknown as FakeDockItem, target.children[0]);
        }
    };

    applyDockEntryOrderSnapshot(snapshot, layout, mover);

    assert.deepEqual(calls, [{
        scope: DOCK_ORDER_SCOPE_BY_POSITION.LeftTop,
        type: "fourth",
        previousType: undefined,
    }, {
        scope: DOCK_ORDER_SCOPE_BY_POSITION.LeftTop,
        type: "third",
        previousType: "first",
    }, {
        scope: DOCK_ORDER_SCOPE_BY_POSITION.LeftTop,
        type: "second",
        previousType: "fourth",
    }]);
    assert.deepEqual(leftTop.children, [fourth, second, first, third]);
    assert.deepEqual(rightTop.children, []);
    calls.length = 0;
    assert.equal(applyDockEntryOrderSnapshot(snapshot, layout, mover), false);
    assert.deepEqual(calls, []);
});

test("dock ordering is applied at runtime and synchronized after direct dock moves", () => {
    const runtimeSource = readFileSync(resolve(process.cwd(), "src/config/entryVisibility/runtime.ts"), "utf8");
    const dockSource = readFileSync(resolve(process.cwd(), "src/layout/dock/index.ts"), "utf8");
    const uiSource = readFileSync(resolve(process.cwd(), "src/config/entryVisibility/ui.ts"), "utf8");

    assert.match(runtimeSource, /applyDockEntryOrderSnapshot\(mergeDockEntryOrderSnapshot\(/);
    assert.match(runtimeSource, /const currentOrders = getCurrentDockEntryOrderSnapshot\(\);/);
    assert.match(runtimeSource, /\{syncEntryOrders: false\}/);
    assert.match(runtimeSource, /const key = getDockEntryKey\(item\);/);
    assert.match(dockSource, /options\.syncEntryOrders !== false/);
    assert.match(uiSource, /data-entry-drop-scope/);
    assert.match(uiSource, /moveDockEntryOrderSnapshot\(/);
});
