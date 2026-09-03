import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";
import {
    applyDockEntryOrderSnapshot,
    createDockEntryOrderSnapshot,
    DOCK_ORDER_SCOPE_BY_POSITION,
    DOCK_ORDER_SCOPES,
    getDockEntryOrderSnapshot,
    getDockOrderContainer,
    isDockOrderScope,
    mergeCurrentDockEntryOrders,
    mergeDockEntryOrderSnapshot,
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
}

class FakeDockContainer {
    public children: FakeDockItem[] = [];

    constructor(items: FakeDockItem[] = []) {
        items.forEach((item) => this.append(item));
    }

    public append(item: FakeDockItem) {
        if (item.parent) {
            const oldIndex = item.parent.children.indexOf(item);
            if (oldIndex > -1) {
                item.parent.children.splice(oldIndex, 1);
            }
        }
        this.children.push(item);
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

test("profiles without dock orders preserve the current six-slot layout", () => {
    const current = emptySnapshot();
    current[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop] = ["outline", "file"];
    current[DOCK_ORDER_SCOPE_BY_POSITION.BottomRight] = ["plugin:sample:dock"];

    assert.deepEqual(mergeDockEntryOrderSnapshot(current), current);
});

test("merging a dock snapshot removes a loaded entry from its stale previous slot", () => {
    const current = emptySnapshot();
    current[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop] = ["outline"];
    current[DOCK_ORDER_SCOPE_BY_POSITION.RightTop] = ["file", "graph"];
    const merged = mergeDockEntryOrderSnapshot(current, {
        [DOCK_ORDER_SCOPE_BY_POSITION.LeftTop]: ["file", "outline", "plugin:disabled:dock"],
        [DOCK_ORDER_SCOPE_BY_POSITION.RightTop]: ["graph", "file"],
    });

    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.LeftTop], ["outline", "plugin:disabled:dock"]);
    assert.deepEqual(merged[DOCK_ORDER_SCOPE_BY_POSITION.RightTop], ["graph", "file"]);
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

test("dock ordering is applied at runtime and synchronized after direct dock moves", () => {
    const runtimeSource = readFileSync(resolve(process.cwd(), "src/config/entryVisibility/runtime.ts"), "utf8");
    const dockSource = readFileSync(resolve(process.cwd(), "src/layout/dock/index.ts"), "utf8");

    assert.match(runtimeSource, /applyDockEntryOrderSnapshot\(mergeDockEntryOrderSnapshot\(/);
    assert.match(runtimeSource, /const key = getDockEntryKey\(item\);/);
    assert.match(dockSource, /syncDockEntryOrders\(\);/);
});
