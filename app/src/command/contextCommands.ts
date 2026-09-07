import type {App} from "../index";
import type {ICommandContextSnapshot, ICommandDefinition, TCommandKeymapPath} from "./types";
import {getCommandRegistry} from "./service";
import {getEnglishCommandLabel} from "./english";
import {getCommandBlocks, getCommandDocument, hasCommandEditorTarget} from "./contextTargets";
import {isInEmbedBlock} from "../protyle/util/hasClosest";
import {focusByRange, getEditorRange} from "../protyle/util/selection";
import {getNextBlockSibling} from "../protyle/wysiwyg/getBlock";
import {turnsIntoGroupsTransaction, turnsIntoTransaction, turnsOneInto} from "../protyle/wysiwyg/transaction";
import {turnParagraphIntoCode} from "../protyle/wysiwyg/turnIntoCode";
import {getListConversionType, type TListSubtype} from "../protyle/wysiwyg/listContext";
import {removeBlockPreservingSelectionMode} from "../protyle/wysiwyg/remove";
import {foldBlocksRecursively, foldHeadingGroup, getFoldBlock, setFold} from "../protyle/util/blockFold";
import {pasteAsPlainText, pasteEscaped} from "../protyle/util/paste";
import {insertColumn, insertRow, insertRowAbove} from "../protyle/util/table";
import {tableMenu} from "../menus/protyle";
import {deleteFile} from "../editor/deleteFile";
import {newFileInTree} from "../util/newFile";
import {newNotebook} from "../util/mount";
import {pathPosix} from "../util/pathName";
import {isCustomFileTreeList} from "../util/fileTreeSort";
/// #if !MOBILE
import {Tab} from "../layout/Tab";
/// #endif

const initialized = new WeakSet<object>();
const editable = (context: ICommandContextSnapshot) => !window.siyuan.config.readonly &&
    !context.protyle?.disabled && hasCommandEditorTarget(context) &&
    getCommandBlocks(context).every(block => !isInEmbedBlock(block.element));
const documentWritable = (context: ICommandContextSnapshot) => {
    const doc = getCommandDocument(context);
    return Boolean(doc?.notebookId && doc.path?.endsWith(".sy") && !window.siyuan.config.readonly &&
        (context.focus === "fileTree" || !context.protyle.disabled));
};
const blocks = (context: ICommandContextSnapshot) => getCommandBlocks(context).map(block => block.element);
const label = (keys: string[], english = false) => keys.map(key =>
    (english ? getEnglishCommandLabel(key) : window.siyuan.languages[key]) || key).join(" - ");

const getTableMenus = (context: ICommandContextSnapshot) => {
    if (!editable(context) || context.selectedBlocks.length || !context.tableCell ||
        context.block?.element.getAttribute("data-type") !== "NodeTable") {
        return [];
    }
    const cell = context.tableCell.element;
    if (!cell.isConnected || !context.block.element.contains(cell) ||
        !cell.contains(context.range.startContainer) || !cell.contains(context.range.endContainer)) {
        return [];
    }
    return tableMenu(context.protyle, context.block.element, cell, context.range).menus;
};

const getFoldTargets = (context: ICommandContextSnapshot) => {
    let elements: Element[] = [];
    if (editable(context) && context.selectedBlocks.length <= 1) {
        getFoldBlock(context.protyle, context.block?.element || blocks(context)[0], targets => elements = targets);
    }
    return elements;
};

export const ensureContextCommands = (app: App) => {
    if (initialized.has(app)) {
        return;
    }
    const commands: ICommandDefinition[] = [];
    const add = (id: string, keys: string[], when: ICommandDefinition["when"],
                 execute: ICommandDefinition["execute"], keymapPath?: TCommandKeymapPath) => {
        commands.push({
            id: `core.context.${id}`,
            category: "core",
            label: () => label(keys),
            englishLabel: () => label(keys, true),
            keywords: () => [id, ...keys],
            surfaces: ["commandPanel"],
            order: 1000 + commands.length,
            keymapPath,
            hotkey: keymapPath ? () => keymapPath[0] === "editor" ?
                window.siyuan.config.keymap.editor[keymapPath[1] as keyof Config.IKeymapEditor]?.[keymapPath[2]]?.custom || "" : "" : undefined,
            when,
            execute: context => {
                if (!when(context)) {
                    return;
                }
                if (hasCommandEditorTarget(context)) {
                    focusByRange(context.range);
                }
                return execute(context);
            },
        });
    };

    /// #if !MOBILE
    const getTab = (context: ICommandContextSnapshot) => {
        const tab = (context.activeTab?.model as {parent?: Tab})?.parent;
        return tab instanceof Tab && tab.id === context.activeTab.id && tab.headElement.isConnected ? tab : undefined;
    };
    ["pin", "unpin"].forEach(key => add(`tab.${key}`, ["mobileTabs", key], context => {
        const tab = getTab(context);
        return Boolean(tab && tab.headElement.classList.contains("item--pin") === (key === "unpin"));
    }, context => key === "pin" ? getTab(context).pin() : getTab(context).unpin()));
    /// #endif

    add("notebook.new", ["newNotebook"], () => !window.siyuan.config.readonly, () => newNotebook());
    ["newDocAbove", "newDocBelow"].forEach(key => add(`document.${key}`, ["doc", key], context => {
        if (!documentWritable(context)) {
            return false;
        }
        const doc = getCommandDocument(context);
        const element = context.fileTree?.elements[0] || document.querySelector(
            `.sy__file li[data-node-id="${doc.id}"]`);
        return Boolean(element && isCustomFileTreeList(element.parentElement));
    }, context => {
        const doc = getCommandDocument(context);
        newFileInTree(app, doc.notebookId, pathPosix().dirname(doc.path), {
            targetID: doc.id,
            position: key === "newDocAbove" ? "before" : "after",
        });
    }));
    add("document.delete", ["doc", "delete"], documentWritable, context => {
        const doc = getCommandDocument(context);
        return deleteFile(doc.notebookId, doc.path);
    });

    const convertible = (context: ICommandContextSnapshot) => editable(context) &&
        blocks(context).every(element => ["NodeParagraph", "NodeHeading"].includes(element.dataset.type));
    const selectedList = (context: ICommandContextSnapshot) => {
        const targets = blocks(context);
        if (targets.length !== 1) {
            return undefined;
        }
        if (targets[0].dataset.type === "NodeList") {
            return targets[0];
        }
        return undefined;
    };
    const groupedTypes: Array<[string, Exclude<TTurnIntoOne, "BlocksMergeSuperBlock">]> = [
        ["list", "Blocks2ULs"], ["ordered-list", "Blocks2OLs"], ["check", "Blocks2TLs"], ["quote", "Blocks2Blockquote"],
    ];
    groupedTypes.forEach(([key, type]) => add(`block.${key}`, ["turnInto", key], context => {
        if (!editable(context)) {
            return false;
        }
        const list = selectedList(context);
        if (list && key !== "quote") {
            const subtype = key === "list" ? "u" : key === "ordered-list" ? "o" : "t";
            return Boolean(getListConversionType(list.dataset.subtype as TListSubtype, subtype));
        }
        return convertible(context) || Boolean(list);
    }, context => {
        const list = selectedList(context);
        if (list && key !== "quote") {
            const subtype = key === "list" ? "u" : key === "ordered-list" ? "o" : "t";
            if (subtype !== list.dataset.subtype) {
                return turnsOneInto({protyle: context.protyle, nodeElement: list, id: list.dataset.nodeId,
                    type: getListConversionType(list.dataset.subtype as TListSubtype, subtype)});
            }
            return;
        }
        const groups: Element[][] = [];
        blocks(context).forEach(element => {
            const group = groups[groups.length - 1];
            if (group && getNextBlockSibling(group[group.length - 1]) === element &&
                group[0].parentElement === element.parentElement) {
                group.push(element);
            } else {
                groups.push([element]);
            }
        });
        return turnsIntoGroupsTransaction({protyle: context.protyle, selectsElementGroups: groups, type});
    }, ["editor", "insert", key]));
    ["paragraph", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6"].forEach(key =>
        add(`block.${key}`, ["turnInto", key], context => convertible(context) || key === "paragraph" &&
            editable(context) && (Boolean(selectedList(context)) || blocks(context).length === 1 &&
                blocks(context)[0].dataset.type === "NodeBlockquote"), context => {
        const list = key === "paragraph" && selectedList(context);
        if (list) {
            return turnsOneInto({protyle: context.protyle, nodeElement: list, id: list.dataset.nodeId, type: "CancelList"});
        }
        const blockquote = blocks(context)[0];
        if (key === "paragraph" && blockquote.dataset.type === "NodeBlockquote") {
            return turnsOneInto({protyle: context.protyle, nodeElement: blockquote,
                id: blockquote.dataset.nodeId, type: "CancelBlockquote"});
        }
        return turnsIntoTransaction({
            protyle: context.protyle,
            selectsElement: blocks(context),
            type: key === "paragraph" ? "Blocks2Ps" : "Blocks2Hs",
            level: key.startsWith("heading") ? Number(key.slice(-1)) : undefined,
        });
    }, ["editor", "heading", key]));
    add("block.code", ["turnInto", "code"], context => editable(context) && blocks(context).length === 1 &&
        blocks(context)[0].dataset.type === "NodeParagraph", context => turnParagraphIntoCode(context.protyle, blocks(context)[0]),
    ["editor", "insert", "code"]);

    const remove = async (context: ICommandContextSnapshot, targets: HTMLElement[]) => {
        const added = targets.filter(element => !element.classList.contains("protyle-wysiwyg--select"));
        added.forEach(element => element.classList.add("protyle-wysiwyg--select"));
        try {
            return await removeBlockPreservingSelectionMode(context.protyle, targets[0], getEditorRange(targets[0]), "Backspace");
        } finally {
            added.forEach(element => element.classList.remove("protyle-wysiwyg--select"));
        }
    };
    add("block.delete", ["blockCount", "delete"], editable, context => remove(context, blocks(context)));

    ["fold", "foldChildHeadings", "foldSiblingHeadings", "foldRecursive"].forEach(key =>
        add(`block.${key}`, ["blockCount", key], context => {
            const targets = getFoldTargets(context);
            if (!targets.length) {
                return false;
            }
            if (key === "foldChildHeadings" || key === "foldSiblingHeadings") {
                return targets[0].getAttribute("data-type") === "NodeHeading";
            }
            return targets[0].getAttribute("data-type") !== "NodeThematicBreak";
        }, context => {
            const targets = getFoldTargets(context);
            if (key === "foldRecursive") {
                return foldBlocksRecursively(context.protyle, targets);
            }
            if (key === "foldChildHeadings" || key === "foldSiblingHeadings") {
                return foldHeadingGroup(context.protyle, targets[0], key === "foldChildHeadings" ? "children" : "siblings");
            }
            return setFold(context.protyle, targets[0]).ready;
        }, key === "fold" ? undefined : ["editor", "general", key]));

    const tableKeys = ["insertRowAbove", "insertRowBelow", "insertColumnLeft", "insertColumnRight",
        "moveToUp", "moveToDown", "moveToLeft", "moveToRight", "delete-row", "delete-column"];
    tableKeys.forEach(key => {
        const menuId = key === "delete-row" ? "deleteRow" : key === "delete-column" ? "deleteColumn" : key;
        const keys = ["table"];
        if (key.startsWith("moveTo")) {
            keys.push(key === "moveToUp" || key === "moveToDown" ? "row" : "column");
        }
        keys.push(key);
        add(`table.${key}`, keys, context => {
            if (!getTableMenus(context).some(item => item.id === menuId)) {
                return false;
            }
            const cell = context.tableCell.element;
            const table = cell.closest("table");
            const row = cell.parentElement as HTMLTableRowElement;
            if (key === "moveToUp") {
                return row.rowIndex > 0;
            }
            if (key === "moveToDown") {
                return row.rowIndex < table.rows.length - 1;
            }
            if (key === "moveToLeft") {
                return cell.cellIndex > 0;
            }
            if (key === "moveToRight") {
                return cell.cellIndex < row.cells.length - 1;
            }
            return true;
        }, context => {
            const protyle = context.protyle;
            const range = context.range;
            const cell = context.tableCell.element;
            const node = context.block.element;
            if (key === "insertRowAbove") {
                return insertRowAbove(protyle, range, cell, node);
            }
            if (key === "insertRowBelow") {
                return insertRow(protyle, range, cell, node);
            }
            if (key === "insertColumnLeft" || key === "insertColumnRight") {
                return insertColumn(protyle, node, cell, key === "insertColumnLeft" ? "beforebegin" : "afterend", range);
            }
            getTableMenus(context).find(item => item.id === menuId)?.click?.(undefined, undefined);
        }, ["editor", "table", key]);
    });
    ["pasteAsPlainText", "pasteEscaped"].forEach(key => add(`editor.${key}`, [key], context =>
        editable(context) && !context.selectedBlocks.length, context => {
        const prepareInsertion = () => {
            if (!editable(context)) {
                return false;
            }
            focusByRange(context.range);
            return true;
        };
        return key === "pasteAsPlainText" ? pasteAsPlainText(context.protyle, prepareInsertion) :
            pasteEscaped(context.protyle, context.block.element, prepareInsertion);
    }));

    const registry = getCommandRegistry(app);
    const disposers: Array<() => boolean> = [];
    try {
        commands.forEach(command => disposers.push(registry.register(command, app)));
        initialized.add(app);
    } catch (error) {
        disposers.reverse().forEach(dispose => dispose());
        throw error;
    }
};
