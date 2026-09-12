import * as assert from "node:assert/strict";
import test from "node:test";
import {
    buildEntryVisibilityMenuItems,
    buildEntryVisibilityToggleItem,
    IEntryVisibilityMenuRuntime,
} from "./menuItems";
import {getEntryCatalogChildren, TOP_BAR_ROOT_PATH} from "./catalog";

const withWindow = (callback: () => void) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {siyuan: {languages: {syncNow: "Sync", dailyNote: "Daily note"}}},
    });
    try {
        callback();
    } finally {
        if (descriptor) {
            Object.defineProperty(globalThis, "window", descriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
};

const createRuntime = (options: {
    readonly?: boolean;
    hidden?: string[];
    reverseOrder?: boolean;
    icons?: Record<string, Pick<IMenu, "icon" | "iconHTML">>;
} = {}) => {
    const hidden = new Set(options.hidden || []);
    const calls: Array<{path: string; visible: boolean}> = [];
    const runtime: IEntryVisibilityMenuRuntime = {
        getEntryOrder: (parentPath) => {
            const keys = (getEntryCatalogChildren(parentPath) || []).map((item) => item.key);
            return options.reverseOrder ? [...keys].reverse() : keys;
        },
        isEntryVisible: (path) => !hidden.has(path),
        setEntryVisibilityValue: (path, visible) => {
            calls.push({path, visible});
        },
        getEntryIcon: (path) => options.icons?.[path] || {iconHTML: ""},
        readonly: options.readonly || false,
        languages: {entryHide: "Hide ${name}", entryShow: "Show ${name}"},
    };
    return {runtime, calls};
};

test("blank menu lists configurable entries in runtime order", () => {
    withWindow(() => {
        const {runtime} = createRuntime({reverseOrder: true});
        const items = buildEntryVisibilityMenuItems(TOP_BAR_ROOT_PATH, runtime);
        const ids = items.map((item) => item.id);
        assert.equal(ids[0], "topBar.barExit");
        assert.ok(ids.includes("topBar.barSync"));
        assert.ok(ids.includes("topBar.toolbarVIP"));
        assert.ok(ids.includes("topBar.toolbarTitle"));
        assert.ok(!ids.includes("topBar.drag"));
        items.forEach((item) => assert.equal(item.iconHTML, ""));
    });
});

test("blank menu check marks follow entry visibility", () => {
    withWindow(() => {
        const {runtime} = createRuntime({hidden: ["topBar.barSync"]});
        const items = buildEntryVisibilityMenuItems(TOP_BAR_ROOT_PATH, runtime);
        assert.equal(items.find((item) => item.id === "topBar.barSync")!.checked, false);
        assert.equal(items.find((item) => item.id === "topBar.barDailyNote")!.checked, true);
    });
});

test("dock blank menu lists configurable dock entries only", () => {
    withWindow(() => {
        const {runtime} = createRuntime();
        const items = buildEntryVisibilityMenuItems("dock", runtime);
        const ids = items.map((item) => item.id);
        assert.ok(ids.includes("dock.file"));
        assert.ok(ids.includes("dock.inbox"));
        assert.ok(!ids.some((id) => id.includes("separator")));
    });
});

test("blank menu keeps only entries accepted by the filter", () => {
    withWindow(() => {
        const {runtime} = createRuntime();
        const items = buildEntryVisibilityMenuItems("dock", runtime, (key) => key === "file" || key === "outline");
        assert.deepEqual(items.map((item) => item.id), ["dock.file", "dock.outline"]);
    });
});

test("blank menu applies entry icons", () => {
    withWindow(() => {
        const {runtime} = createRuntime({icons: {"dock.file": {icon: "iconFile"}}});
        const items = buildEntryVisibilityMenuItems("dock", runtime);
        assert.equal(items.find((item) => item.id === "dock.file")!.icon, "iconFile");
        assert.equal(items.find((item) => item.id === "dock.outline")!.iconHTML, "");
    });
});

test("menu item click toggles the entry visibility", () => {
    withWindow(() => {
        const {runtime, calls} = createRuntime({hidden: ["topBar.barSync"]});
        const items = buildEntryVisibilityMenuItems(TOP_BAR_ROOT_PATH, runtime);
        items.find((item) => item.id === "topBar.barSync")!.click!(undefined as never, undefined as never);
        items.find((item) => item.id === "topBar.barDailyNote")!.click!(undefined as never, undefined as never);
        assert.deepEqual(calls, [
            {path: "topBar.barSync", visible: true},
            {path: "topBar.barDailyNote", visible: false},
        ]);
    });
});

test("toggle item hides visible entries and shows hidden ones", () => {
    withWindow(() => {
        const {runtime, calls} = createRuntime({hidden: ["topBar.barDailyNote"]});
        const visible = buildEntryVisibilityToggleItem("topBar.barSync", runtime)!;
        assert.equal(visible.label, "Hide Sync");
        assert.notEqual(visible.id, "topBar.barSync");
        assert.equal(visible.icon, "iconEyeoff");
        visible.click!(undefined as never, undefined as never);
        const hidden = buildEntryVisibilityToggleItem("topBar.barDailyNote", runtime)!;
        assert.equal(hidden.label, "Show Daily note");
        assert.equal(hidden.icon, "iconEye");
        hidden.click!(undefined as never, undefined as never);
        assert.equal(buildEntryVisibilityToggleItem("topBar.drag", runtime), undefined);
        assert.equal(buildEntryVisibilityToggleItem("topBar.missing", runtime), undefined);
        assert.deepEqual(calls, [
            {path: "topBar.barSync", visible: false},
            {path: "topBar.barDailyNote", visible: true},
        ]);
    });
});

test("readonly disables entry visibility menu items", () => {
    withWindow(() => {
        const {runtime} = createRuntime({readonly: true});
        const items = buildEntryVisibilityMenuItems(TOP_BAR_ROOT_PATH, runtime);
        assert.ok(items.length > 0);
        items.forEach((item) => assert.equal(item.disabled, true));
        assert.equal(buildEntryVisibilityToggleItem("topBar.barSync", runtime)!.disabled, true);
    });
});

test("status bar menu restores hidden entries and excludes the fixed spacer", () => {
    withWindow(() => {
        const {runtime, calls} = createRuntime({hidden: ["statusBar.backgroundTask", "statusBar.counter"]});
        const items = buildEntryVisibilityMenuItems("statusBar", runtime);
        assert.deepEqual(items.map((item) => item.id), [
            "statusBar.barDock", "statusBar.message", "statusBar.backgroundTask", "statusBar.counter", "statusBar.statusHelp",
        ]);
        const task = items.find((item) => item.id === "statusBar.backgroundTask")!;
        assert.equal(task.checked, false);
        task.click!(undefined as never, undefined as never);
        assert.deepEqual(calls, [{path: "statusBar.backgroundTask", visible: true}]);
        assert.equal(buildEntryVisibilityToggleItem("statusBar.spacer", runtime), undefined);
    });
});
