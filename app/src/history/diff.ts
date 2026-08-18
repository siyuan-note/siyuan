import {fetchPost} from "../util/fetch";
import {Dialog} from "../dialog";
import {Protyle} from "../protyle";
import {Constants} from "../constants";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {escapeAttr, escapeHtml} from "../util/escape";
import * as dayjs from "dayjs";
import {isMobile} from "../util/functions";
import type {App} from "../index";
import {pathPosix} from "../util/pathName";
import {renderAssetsPreview} from "../asset/renderAssets";
import {resizeSide} from "./resizeSide";
import {confirmDialog} from "../dialog/confirmDialog";
import {showDocVersionDiff} from "./docDiff";
import {pairSnapshotFilesByPath} from "./snapshotDiffCore";

type SnapshotDiffAggregate = "all" | "data" | "extension" | "other";
type SnapshotFileKind = "document" | "database" | "asset" | "plugin" | "widget" | "template" | "snippet" | "bazaar" | "workspaceData" | "other";
type SnapshotOperation = "update" | "add" | "remove";

interface SnapshotFile {
    title: string;
    fileID: string;
    path: string;
    hSize: string;
    updated: number;
}

interface SnapshotDiffItem {
    file: SnapshotFile;
    compareFile?: SnapshotFile;
    kind: SnapshotFileKind;
}

interface SnapshotDiffResult {
    updates: SnapshotDiffItem[];
    adds: SnapshotDiffItem[];
    removes: SnapshotDiffItem[];
}

interface SnapshotDiffFilterState {
    aggregate: SnapshotDiffAggregate;
    kind: SnapshotFileKind | "all";
    expanded: Set<SnapshotOperation>;
    result?: SnapshotDiffResult;
}

const snapshotFileKinds: SnapshotFileKind[] = [
    "document",
    "database",
    "asset",
    "workspaceData",
    "plugin",
    "widget",
    "template",
    "snippet",
    "bazaar",
    "other",
];

const getSnapshotFileKind = (filePath: string): SnapshotFileKind => {
    const normalizedPath = filePath.replaceAll("\\", "/").replace(/^\/+/, "");
    if (normalizedPath.endsWith(".sy")) {
        return "document";
    }

    const pathParts = normalizedPath.split("/").filter((item) => item);
    const boxOffset = /^\d{14}-[a-z0-9]{7}$/.test(pathParts[0]) ? 1 : 0;
    const scopedPath = pathParts.slice(boxOffset).join("/");
    if (scopedPath.startsWith("storage/av/")) {
        return "database";
    }
    if (scopedPath.startsWith("plugins/") || scopedPath.startsWith("storage/petal/")) {
        return "plugin";
    }
    if (scopedPath.startsWith("widgets/")) {
        return "widget";
    }
    if (scopedPath === "storage/bazaar.json") {
        return "bazaar";
    }
    if (scopedPath.startsWith("templates/")) {
        return "template";
    }
    if (scopedPath.startsWith("snippets/")) {
        return "snippet";
    }
    if (scopedPath.startsWith("assets/") || scopedPath.includes("/assets/")) {
        return "asset";
    }
    if (["emojis/", "public/", "storage/riff/", "storage/ai/"].some((prefix) => scopedPath.startsWith(prefix)) ||
        boxOffset === 1) {
        return "workspaceData";
    }
    return "other";
};

const getSnapshotAggregate = (kind: SnapshotFileKind): Exclude<SnapshotDiffAggregate, "all"> => {
    if (["document", "database", "asset", "workspaceData"].includes(kind)) {
        return "data";
    }
    if (["plugin", "widget", "template", "snippet", "bazaar"].includes(kind)) {
        return "extension";
    }
    return "other";
};

const getSnapshotKindLabel = (kind: SnapshotFileKind) => {
    switch (kind) {
        case "document":
            return window.siyuan.languages.doc;
        case "database":
            return window.siyuan.languages.database;
        case "asset":
            return window.siyuan.languages.assets;
        case "plugin":
            return window.siyuan.languages.plugin;
        case "widget":
            return window.siyuan.languages.widget;
        case "template":
            return window.siyuan.languages.template;
        case "snippet":
            return window.siyuan.languages.codeSnippet;
        case "bazaar":
            return window.siyuan.languages.bazaar;
        case "workspaceData":
            return window.siyuan.languages.workspaceData;
        default:
            return window.siyuan.languages.configGroupOthers;
    }
};

const getSnapshotItems = (result: SnapshotDiffResult) => {
    return [...result.updates, ...result.adds, ...result.removes];
};

const buildSnapshotDiffResult = (data: {
    updatesLeft: SnapshotFile[];
    updatesRight: SnapshotFile[];
    addsLeft: SnapshotFile[];
    removesRight: SnapshotFile[];
}): SnapshotDiffResult => {
    return {
        updates: pairSnapshotFilesByPath(data.updatesLeft || [], data.updatesRight || []).map((item) => ({
            ...item,
            kind: getSnapshotFileKind(item.file.path),
        })),
        adds: (data.addsLeft || []).map((file) => ({
            file,
            kind: getSnapshotFileKind(file.path),
        })),
        removes: (data.removesRight || []).map((file) => ({
            file,
            kind: getSnapshotFileKind(file.path),
        })),
    };
};

const filterSnapshotItems = (items: SnapshotDiffItem[], state: SnapshotDiffFilterState) => {
    return items.filter((item) => {
        if (state.aggregate !== "all" && getSnapshotAggregate(item.kind) !== state.aggregate) {
            return false;
        }
        return state.kind === "all" || item.kind === state.kind;
    });
};

const genSnapshotFilter = (type: "snapshotAggregate" | "snapshotKind", value: string, label: string,
                           count: number, current: boolean) => {
    return `<button type="button" class="b3-chip b3-chip--middle b3-chip--pointer history__diff-filter${current ? " b3-chip--current" : ""}" data-type="${type}" data-value="${value}" aria-pressed="${current}">${escapeHtml(label)} ${count}</button>`;
};

const genSnapshotFilters = (state: SnapshotDiffFilterState) => {
    const items = getSnapshotItems(state.result);
    const aggregateCounts: Record<Exclude<SnapshotDiffAggregate, "all">, number> = {
        data: 0,
        extension: 0,
        other: 0,
    };
    const kindCounts = new Map<SnapshotFileKind, number>();
    items.forEach((item) => {
        const aggregate = getSnapshotAggregate(item.kind);
        aggregateCounts[aggregate]++;
        kindCounts.set(item.kind, (kindCounts.get(item.kind) || 0) + 1);
    });

    const aggregateFilters = [
        genSnapshotFilter("snapshotAggregate", "all", window.siyuan.languages.all, items.length, state.aggregate === "all"),
        genSnapshotFilter("snapshotAggregate", "data", window.siyuan.languages.snapshotData,
            aggregateCounts.data, state.aggregate === "data"),
        genSnapshotFilter("snapshotAggregate", "extension", window.siyuan.languages.extensions,
            aggregateCounts.extension, state.aggregate === "extension"),
    ];
    if (aggregateCounts.other > 0) {
        aggregateFilters.push(genSnapshotFilter("snapshotAggregate", "other", window.siyuan.languages.configGroupOthers,
            aggregateCounts.other, state.aggregate === "other"));
    }

    const availableKinds = state.aggregate === "all" ? [] : snapshotFileKinds.filter((kind) => {
        return (kindCounts.get(kind) || 0) > 0 && getSnapshotAggregate(kind) === state.aggregate;
    });
    const kindFilters = availableKinds.map((kind) => {
        return genSnapshotFilter("snapshotKind", kind, getSnapshotKindLabel(kind), kindCounts.get(kind),
            state.kind === kind);
    }).join("");
    return `<div class="history__diff-filters">
    <div class="history__diff-filter-row">${aggregateFilters.join("")}</div>
    ${availableKinds.length > 1 ? `<div class="history__diff-filter-row history__diff-filter-row--kind">${kindFilters}</div>` : ""}
</div>`;
};

const genItem = (items: SnapshotDiffItem[], hasUndo = true) => {
    if (!items || items.length === 0) {
        return `<li style="padding-left: 40px;" class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
    }
    let html = "";
    items.forEach((item) => {
        const compareID = item.compareFile ? ` data-id2="${item.compareFile.fileID}"` : "";
        html += `<li class="b3-list-item b3-list-item--hide-action history__diff-item"${compareID} data-created="${item.file.updated}" data-id="${item.file.fileID}" data-kind="${item.kind}" data-title="${escapeAttr(item.file.title)}">
    <span class="history__diff-file">
        <span class="history__diff-title">${escapeHtml(item.file.title)}</span>
        <span class="history__diff-path" title="${escapeAttr(item.file.path)} ${item.file.hSize}">${escapeHtml(item.file.path)}</span>
    </span>
    <span class="fn__space"></span>
    <span class="b3-list-item__action ariaLabel${hasUndo ? "" : " fn__none"}" data-type="rollback" data-position="6south" aria-label="${window.siyuan.languages.rollback}">
        <svg><use xlink:href="#iconUndo"></use></svg>
    </span>
</li>`;
    });
    return html;
};

const genSnapshotOperation = (operation: SnapshotOperation, label: string, items: SnapshotDiffItem[],
                              state: SnapshotDiffFilterState) => {
    const expanded = state.expanded.has(operation);
    const isAdd = operation === "add";
    return `<ul class="b3-list b3-list--background">
    <li class="b3-list-item" data-operation="${operation}">
        <span class="b3-list-item__toggle b3-list-item__toggle--hl">
            <svg class="b3-list-item__arrow${expanded ? " b3-list-item__arrow--open" : ""}"><use xlink:href="#iconRight"></use></svg>
        </span>
        <span style="padding-left: 4px" class="b3-list-item__text">${label}</span>
        <span class="counter${items.length === 0 ? " fn__none" : ""}">${items.length}</span>
    </li>
    <ul class="${expanded ? "" : "fn__none"}"${isAdd ? ' data-type="update"' : ""}>${genItem(items, !isAdd)}</ul>
</ul>`;
};

const genSnapshotSide = (state: SnapshotDiffFilterState) => {
    const updates = filterSnapshotItems(state.result.updates, state);
    const adds = filterSnapshotItems(state.result.adds, state);
    const removes = filterSnapshotItems(state.result.removes, state);
    return `${genSnapshotFilters(state)}
<div class="history__diff-list">
    ${genSnapshotOperation("update", window.siyuan.languages.update, updates, state)}
    ${genSnapshotOperation("add", window.siyuan.languages.addAttr, adds, state)}
    ${genSnapshotOperation("remove", window.siyuan.languages.remove, removes, state)}
</div>`;
};

const resetSnapshotPreview = (dialog: Dialog) => {
    dialog.element.querySelectorAll('[data-type="editors"] > div').forEach((item) => item.classList.add("fn__none"));
};

const renderSnapshotSide = (dialog: Dialog, state: SnapshotDiffFilterState) => {
    const sideElement = dialog.element.querySelector(".history__side");
    if (!sideElement || !state.result) {
        return;
    }
    sideElement.innerHTML = genSnapshotSide(state);
    resetSnapshotPreview(dialog);
};

let leftEditor: Protyle;
let rightEditor: Protyle;
const renderCompare = (app: App, element: HTMLElement) => {
    const listElement = hasClosestByClassName(element, "history__side");
    if (!listElement) {
        return;
    }
    const dialogContainerElement = hasClosestByClassName(element, "b3-dialog__container");
    if (!dialogContainerElement) {
        return;
    }
    const id2 = element.getAttribute("data-id2");
    if (element.dataset.kind === "document" && id2) {
        const snapshots = Array.from(dialogContainerElement.querySelectorAll<HTMLElement>(".b3-dialog__header [data-snapshot]"));
        if (snapshots.length === 2) {
            const leftCreated = parseInt(snapshots[0].dataset.created);
            const rightCreated = parseInt(snapshots[1].dataset.created);
            showDocVersionDiff(app, {
                type: "snapshot",
                id: element.dataset.id,
                snapshot: snapshots[0].dataset.snapshot,
                label: `${window.siyuan.languages.dataSnapshot} ${snapshots[0].dataset.snapshot.substring(0, 7)} ${dayjs(leftCreated).format("YYYY-MM-DD HH:mm:ss")}`,
                created: leftCreated,
            }, {
                type: "snapshot",
                id: id2,
                snapshot: snapshots[1].dataset.snapshot,
                label: `${window.siyuan.languages.dataSnapshot} ${snapshots[1].dataset.snapshot.substring(0, 7)} ${dayjs(rightCreated).format("YYYY-MM-DD HH:mm:ss")}`,
                created: rightCreated,
            });
            return;
        }
    }
    const editorsElement = dialogContainerElement.querySelector('[data-type="editors"]');
    const leftElement = editorsElement.firstElementChild;
    const rightElement = editorsElement.lastElementChild;
    if (!leftEditor) {
        leftEditor = new Protyle(app, leftElement.lastElementChild as HTMLElement, {
            blockId: "",
            history: {
                snapshot: ""
            },
            action: [Constants.CB_GET_HISTORY],
            render: {
                background: false,
                gutter: false,
                breadcrumb: false,
                breadcrumbDocName: false,
            },
            typewriterMode: false
        });
        disabledProtyle(leftEditor.protyle);
        rightEditor = new Protyle(app, rightElement.lastElementChild as HTMLElement, {
            blockId: "",
            action: [Constants.CB_GET_HISTORY],
            history: {
                snapshot: ""
            },
            render: {
                background: false,
                gutter: false,
                breadcrumb: false,
                breadcrumbDocName: false,
            },
            typewriterMode: false
        });
        disabledProtyle(rightEditor.protyle);
    }

    fetchPost("/api/repo/openRepoSnapshotFile", {id: element.getAttribute("data-id")}, (response) => {
        leftElement.classList.remove("fn__none");
        const textElement = leftElement.querySelector("textarea");
        const type = pathPosix().extname(response.data.content).toLowerCase();
        const titleElement = leftElement.querySelector(".protyle-title__input");
        if (Constants.SIYUAN_ASSETS_IMAGE.concat(Constants.SIYUAN_ASSETS_AUDIO).concat(Constants.SIYUAN_ASSETS_VIDEO).includes(type)) {
            textElement.previousElementSibling.innerHTML = renderAssetsPreview(response.data.content);
            textElement.previousElementSibling.classList.remove("fn__none");
            textElement.classList.add("fn__none");
            leftElement.lastElementChild.classList.add("fn__none");
        } else if (response.data.displayInText) {
            textElement.value = response.data.content;
            textElement.classList.remove("fn__none");
            leftElement.lastElementChild.classList.add("fn__none");
            textElement.previousElementSibling.classList.add("fn__none");
        } else {
            textElement.classList.add("fn__none");
            leftElement.lastElementChild.classList.remove("fn__none");
            textElement.previousElementSibling.classList.add("fn__none");
            leftEditor.protyle.options.history.snapshot = dialogContainerElement.querySelectorAll(".b3-dialog__header code")[element.parentElement.getAttribute("data-type") === "update" ? 1 : 0].getAttribute("data-snapshot");
            onGet({
                data: response,
                protyle: leftEditor.protyle,
                action: [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML],
            });
        }
        titleElement.textContent = response.data.title;
        leftElement.querySelector(".history__date").textContent = dayjs(response.data.updated).format("YYYY-MM-DD HH:mm");
    });
    if (id2) {
        rightElement.classList.remove("fn__none");
        fetchPost("/api/repo/openRepoSnapshotFile", {id: id2}, (response) => {
            const textElement = rightElement.querySelector("textarea");
            const type = pathPosix().extname(response.data.content).toLowerCase();
            const titleElement = rightElement.querySelector(".protyle-title__input");
            if (Constants.SIYUAN_ASSETS_IMAGE.concat(Constants.SIYUAN_ASSETS_AUDIO).concat(Constants.SIYUAN_ASSETS_VIDEO).includes(type)) {
                textElement.previousElementSibling.innerHTML = renderAssetsPreview(response.data.content);
                textElement.previousElementSibling.classList.remove("fn__none");
                textElement.classList.add("fn__none");
                rightElement.lastElementChild.classList.add("fn__none");
            } else if (response.data.displayInText) {
                textElement.value = response.data.content;
                textElement.classList.remove("fn__none");
                rightElement.lastElementChild.classList.add("fn__none");
                textElement.previousElementSibling.classList.add("fn__none");
            } else {
                textElement.classList.add("fn__none");
                rightElement.lastElementChild.classList.remove("fn__none");
                textElement.previousElementSibling.classList.add("fn__none");
                rightEditor.protyle.options.history.snapshot = dialogContainerElement.querySelectorAll(".b3-dialog__header code")[1].getAttribute("data-snapshot");
                onGet({
                    data: response,
                    protyle: rightEditor.protyle,
                    action: [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML],
                });
            }
            titleElement.textContent = response.data.title;
            rightElement.querySelector(".history__date").textContent = dayjs(response.data.updated).format("YYYY-MM-DD HH:mm");
        });
    } else {
        rightElement.classList.add("fn__none");
    }
};

export const showDiff = (app: App, data: { id: string, time: string }[]) => {
    if (data.length !== 2) {
        return;
    }
    let left: string;
    let right: string;
    if (data[0].time > data[1].time) {
        left = data[1].id;
        right = data[0].id;
    } else {
        left = data[0].id;
        right = data[1].id;
    }
    const filterState: SnapshotDiffFilterState = {
        aggregate: "all",
        kind: "all",
        expanded: new Set(),
    };

    const dialog = new Dialog({
        title: window.siyuan.languages.compare,
        content: "",
        width: isMobile() ? "92vw" : "90vw",
        height: "80vh",
        containerClassName: "b3-dialog__container--theme",
        destroyCallback() {
            leftEditor = undefined;
            rightEditor = undefined;
        }
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_HISTORYCOMPARE);
    dialog.element.addEventListener("click", (event) => {
        if (typeof event.detail === "string") {
            renderCompare(app, dialog.element.querySelector(".history__side .b3-list-item--focus"));
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        let target = event.target as HTMLElement;
        while (target && target !== dialog.element) {
            if (target.dataset.type === "snapshotAggregate") {
                filterState.aggregate = target.dataset.value as SnapshotDiffAggregate;
                filterState.kind = "all";
                renderSnapshotSide(dialog, filterState);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.dataset.type === "snapshotKind") {
                const kind = target.dataset.value as SnapshotFileKind;
                filterState.kind = filterState.kind === kind ? "all" : kind;
                renderSnapshotSide(dialog, filterState);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.classList.contains("b3-list-item") && !target.dataset.id) {
                const hidden = target.nextElementSibling.classList.toggle("fn__none");
                target.querySelector("svg").classList.toggle("b3-list-item__arrow--open");
                const operation = target.dataset.operation as SnapshotOperation;
                if (hidden) {
                    filterState.expanded.delete(operation);
                } else {
                    filterState.expanded.add(operation);
                }
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.classList.contains("b3-list-item") && target.dataset.id) {
                if (target.classList.contains("b3-list-item--focus") &&
                    !(target.dataset.kind === "document" && target.dataset.id2)) {
                    return;
                }
                dialog.element.querySelector(".history__side .b3-list-item--focus")?.classList.remove("b3-list-item--focus");
                target.classList.add("b3-list-item--focus");
                renderCompare(app, target);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.classList.contains("block__icon")) {
                if (target.getAttribute("data-direct") === "left") {
                    target.setAttribute("data-direct", "right");
                    genHTML(right, left, dialog, "right", filterState);
                } else {
                    target.setAttribute("data-direct", "left");
                    genHTML(left, right, dialog, "left", filterState);
                }
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.getAttribute("data-type") == "rollback") {
                confirmDialog("⚠️ " + window.siyuan.languages.rollback,
                    window.siyuan.languages.rollbackConfirm.replace("${name}", target.parentElement.dataset.title).replace("${time}", dayjs(parseInt(target.parentElement.dataset.created)).format("YYYY-MM-DD HH:mm:ss")),
                    () => {
                        fetchPost("/api/repo/rollbackRepoSnapshotFile", {id: target.parentElement.dataset.id});
                    });
                event.preventDefault();
                event.stopPropagation();
                break;
            }
            target = target.parentElement;
        }
    });
    genHTML(left, right, dialog, "left", filterState);
    (document.activeElement as HTMLElement)?.blur();
};

const genHTML = (left: string, right: string, dialog: Dialog, direct: string, filterState: SnapshotDiffFilterState) => {
    leftEditor = undefined;
    rightEditor = undefined;
    const isPhone = isMobile();
    fetchPost("/api/repo/diffRepoSnapshots", {left, right}, (response) => {
        filterState.result = buildSnapshotDiffResult(response.data);
        if (filterState.kind !== "all" &&
            !getSnapshotItems(filterState.result).some((item) => item.kind === filterState.kind)) {
            filterState.kind = "all";
        }
        const headElement = dialog.element.querySelector(".b3-dialog__header");
        headElement.innerHTML = `<div style="padding: 0;min-height: auto;" class="block__icons">
    <span class="fn__flex-1"></span>
    <code class="fn__code${isPhone ? " fn__none" : ""}" data-snapshot="${left}" data-created="${response.data.left.created}">${left.substring(0, 7)}</code>
    ${isPhone ? "" : '<span class="fn__space"></span>'}
    ${dayjs(response.data.left.created).format("YYYY-MM-DD HH:mm")}
    <span class="fn__space"></span>
    <span class="block__icon block__icon--show b3-tooltips b3-tooltips__s" aria-label="${window.siyuan.languages.switchDirect}" data-direct="${direct}"><svg><use xlink:href="#iconScrollHoriz"></use></svg></span>
    <span class="fn__space"></span>
    <code class="fn__code${isPhone ? " fn__none" : ""}" data-snapshot="${right}" data-created="${response.data.right.created}">${right.substring(0, 7)}</code>
    ${isPhone ? "" : '<span class="fn__space"></span>'}
    ${dayjs(response.data.right.created).format("YYYY-MM-DD HH:mm")}
    <span class="fn__flex-1"></span>
</div>`;
        headElement.nextElementSibling.innerHTML = `<div class="fn__flex history__panel" style="height: 100%">
    <div class="history__side history__side--diff" ${isMobile() ? "" : `style="width: ${window.siyuan.storage[Constants.LOCAL_HISTORY].sideDiffWidth}"`}>${genSnapshotSide(filterState)}</div>
    <div class="history__resize"></div>
    <div class="fn__flex-1 fn__flex" data-type="editors">
        <div class="fn__none fn__flex-1 fn__flex-column">
            <div class="history__date">${dayjs(response.data.left.created).format("YYYY-MM-DD HH:mm")}</div>
            <div class="protyle-title__input ft__center ft__breakword">${response.data.left.title}</div>
            <div class="ft__center"></div>
            <textarea class="history__text fn__none fn__flex-1" readonly></textarea>
            <div class="fn__flex-1"></div>
        </div>
        <div class="fn__none fn__flex-1 fn__flex-column" style="border-left: 1px solid var(--b3-border-color);">
            <div class="history__date">${response.data.right.title} ${dayjs(response.data.right.created).format("YYYY-MM-DD HH:mm")}</div>
            <div class="protyle-title__input ft__center ft__breakword">${response.data.right.title}</div>
            <div class="ft__center"></div>
            <textarea class="history__text fn__none fn__flex-1" readonly></textarea>
            <div class="fn__flex-1"></div>
        </div>
    </div>
</div>`;
        resizeSide(dialog.element.querySelector(".history__resize"), dialog.element.querySelector(".history__side"), "sideDiffWidth");
    });
};
