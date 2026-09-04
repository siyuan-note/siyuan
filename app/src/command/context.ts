import type {App} from "../index";
import {getFrontend} from "../util/functions";
import {hasClosestBlock, hasClosestByClassName, hasClosestByTag} from "../protyle/util/hasClosest";
import {
    cloneCommandRange,
    collectCommandFileTreeMetadata,
    createCommandContextSnapshot,
    isBottomBacklinkEditorContext,
    resolveCommandFocus,
} from "./contextCore";
import type {
    ICommandBlockContext,
    ICommandContextSnapshot,
    ICommandDockContext,
    ICommandFileTreeContext,
    ICommandTabContext,
    TCommandSource,
} from "./types";
/// #if MOBILE
import {getCurrentEditor} from "../mobile/editor";
/// #else
import {Editor} from "../editor";
import {Custom} from "../layout/dock/Custom";
import {Files} from "../layout/dock/Files";
import {getAllModels} from "../layout/getAll";
import {getActiveTab, getDockByType} from "../layout/tabUtil";
import {Search} from "../search";
/// #endif

interface ICaptureCommandContextOptions {
    app: App;
    source: TCommandSource;
    range?: Range;
    protyle?: IProtyle;
    fileLiElements?: Element[];
    dockElement?: HTMLElement;
}

const findDialogProtyle = (range?: Range) => {
    if (!range) {
        return undefined;
    }
    let protyle: IProtyle | undefined;
    window.siyuan.dialogs.find(item => {
        if (!item.editors) {
            return false;
        }
        return Object.keys(item.editors).some(key => {
            if (item.editors[key].protyle.element.contains(range.startContainer)) {
                protyle = item.editors[key].protyle;
                return true;
            }
            return false;
        });
    });
    return protyle;
};

/// #if !MOBILE
const findActiveTabProtyle = (activeTab: ReturnType<typeof getActiveTab>, range?: Range) => {
    if (!activeTab) {
        return undefined;
    }
    if (activeTab.model instanceof Editor) {
        return activeTab.model.getCurrentProtyle(range);
    }
    if (activeTab.model instanceof Search) {
        const unRefPanel = activeTab.model.element.querySelector("#searchUnRefPanel");
        return !unRefPanel || unRefPanel.classList.contains("fn__none") ?
            activeTab.model.editors.edit.protyle : activeTab.model.editors.unRefEdit.protyle;
    }
    if (activeTab.model instanceof Custom && activeTab.model.editors?.length > 0 && range) {
        return activeTab.model.editors.find(item => item.protyle.element.contains(range.startContainer))?.protyle;
    }
    return undefined;
};

const findFallbackProtyle = (range?: Range) => {
    let protyle: IProtyle | undefined;
    if (range) {
        window.siyuan.blockPanels.find(item => item.editors.some(editorItem => {
            if (editorItem.protyle.element.contains(range.startContainer)) {
                protyle = editorItem.protyle;
                return true;
            }
            return false;
        }));
    }
    if (protyle) {
        return protyle;
    }
    const models = getAllModels();
    models.backlink.find(item => {
        if (!item.element.classList.contains("layout__tab--active")) {
            return false;
        }
        if (range) {
            protyle = item.editors.find(editor => editor.protyle.element.contains(range.startContainer))?.protyle;
        }
        protyle ||= item.editors[0]?.protyle;
        return true;
    });
    if (protyle) {
        return protyle;
    }
    models.editor.find(item => {
        if (item.parent.headElement.classList.contains("item--focus")) {
            protyle = item.editor.protyle;
            return true;
        }
        return false;
    });
    return protyle;
};
/// #endif

const getDockElement = (activeElement?: Element) => {
    const bottomBacklink = activeElement && hasClosestByClassName(activeElement, "sy__backlink--bottom", true);
    if (bottomBacklink) {
        const closestProtyle = hasClosestByClassName(activeElement, "protyle", true);
        if (isBottomBacklinkEditorContext(bottomBacklink, closestProtyle)) {
            return undefined;
        }
        return {element: bottomBacklink, type: "backlink-bottom"} as ICommandDockContext;
    }
    let element = activeElement?.closest<HTMLElement>(".layout__tab--active");
    if (!element && (!activeElement || activeElement === document.body)) {
        element = document.querySelector<HTMLElement>(".layout__tab--active");
    }
    if (!element && (!activeElement || activeElement === document.body)) {
        element = Array.from(document.querySelectorAll<HTMLElement>(
            ".layout__wnd--active .layout-tab-container > div",
        )).find(item => !item.classList.contains("fn__none") && item.className.includes("sy__"));
    }
    if (!element || !element.className.includes("sy__") || element.classList.contains("sy__file")) {
        return undefined;
    }
    const type = Array.from(element.classList).find(item => item.startsWith("sy__"))?.substring(4);
    return {element, type} as ICommandDockContext;
};

/// #if !MOBILE
const getFileTree = (elements?: Element[]) => {
    const dockFile = getDockByType("file");
    const model = dockFile?.data.file;
    if (!(model instanceof Files)) {
        return undefined;
    }
    const selectedElements = elements ? [...elements] :
        Array.from(model.element.querySelectorAll(".b3-list-item--focus"));
    const metadata = collectCommandFileTreeMetadata(selectedElements);
    return {
        model,
        elements: selectedElements,
        ...metadata,
    } as ICommandFileTreeContext;
};
/// #endif

const getBlockContext = (element: HTMLElement | false): ICommandBlockContext | undefined => {
    if (!element) {
        return undefined;
    }
    const id = element.getAttribute("data-node-id");
    return id ? {id, element} : undefined;
};

export const captureCommandContext = (options: ICaptureCommandContextOptions): ICommandContextSnapshot => {
    const explicitProtyle = Boolean(options.protyle);
    const explicitFileTree = Boolean(options.fileLiElements);
    const activeElement = document.activeElement || undefined;
    const selection = document.getSelection();
    let range = cloneCommandRange(options.range || (selection?.rangeCount ? selection.getRangeAt(0) : undefined));
    let protyle = options.protyle;
    /// #if MOBILE
    if (!protyle) {
        protyle = getCurrentEditor()?.protyle;
    }
    if (!options.range) {
        range = cloneCommandRange(protyle?.toolbar?.range) || range;
    }
    /// #endif
    const dialogProtyle = protyle || explicitFileTree ? undefined : findDialogProtyle(range);
    protyle ||= dialogProtyle;
    let fileTreeFocused = false;
    const dock = options.dockElement ? {
        element: options.dockElement,
        type: Array.from(options.dockElement.classList)
            .find(item => item.startsWith("sy__"))?.substring(4),
    } : getDockElement(activeElement);
    /// #if !MOBILE
    const activePanelElement = document.querySelector<HTMLElement>(".layout__tab--active");
    fileTreeFocused = !protyle && (explicitFileTree || activePanelElement?.classList.contains("sy__file"));
    const activeTab = getActiveTab(false);
    if (!protyle && !fileTreeFocused) {
        protyle = findActiveTabProtyle(activeTab, range) || findFallbackProtyle(range);
    }
    /// #endif
    const fileTree: ICommandFileTreeContext | undefined =
        /// #if !MOBILE
        fileTreeFocused ? getFileTree(options.fileLiElements) :
        /// #endif
            undefined;
    if (!range) {
        range = cloneCommandRange(protyle?.toolbar?.range);
    }
    const blockElement = range ? hasClosestBlock(range.startContainer) : false;
    const block = getBlockContext(blockElement);
    const selectedBlocks = protyle?.wysiwyg?.element ?
        Array.from(protyle.wysiwyg.element.querySelectorAll<HTMLElement>(".protyle-wysiwyg--select"))
            .map(element => getBlockContext(element)).filter((item): item is ICommandBlockContext => Boolean(item)) : [];
    const tableCellElement = range && (hasClosestByTag(range.startContainer, "TD") ||
        hasClosestByTag(range.startContainer, "TH"));
    const focus = resolveCommandFocus({
        explicitEditor: explicitProtyle,
        explicitFileTree,
        dialogEditor: Boolean(dialogProtyle),
        fileTree: fileTreeFocused,
        dock: Boolean(dock),
        editor: Boolean(protyle),
    });
    let tab: ICommandTabContext | undefined;
    /// #if !MOBILE
    if (activeTab) {
        tab = {
            id: activeTab.id,
            model: activeTab.model,
            element: activeTab.panelElement,
        };
    }
    /// #endif
    return createCommandContextSnapshot({
        app: options.app,
        source: options.source,
        environment: getFrontend(),
        focus,
        range,
        activeElement,
        protyle,
        document: protyle ? {
            id: protyle.block?.id,
            rootId: protyle.block?.rootID,
            notebookId: protyle.notebookId,
            path: protyle.path,
        } : undefined,
        block,
        selectedBlocks,
        tableCell: tableCellElement ? {
            element: tableCellElement as HTMLTableCellElement,
            row: (tableCellElement.parentElement as HTMLTableRowElement)?.rowIndex ?? -1,
            column: (tableCellElement as HTMLTableCellElement).cellIndex,
        } : undefined,
        fileTree,
        activeTab: tab,
        dock,
    });
};
