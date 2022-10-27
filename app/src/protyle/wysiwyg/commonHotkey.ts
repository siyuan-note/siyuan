import {matchHotKey} from "../util/hotKey";
import {fetchPost} from "../../util/fetch";
import {writeText} from "../util/compatibility";
import {focusByOffset, getSelectionOffset, setFirstNodeRange, setLastNodeRange} from "../util/selection";
import {fullscreen, netImg2LocalAssets} from "../breadcrumb/action";
import {setPadding} from "../ui/initUI";
/// #if !MOBILE
import {openBacklink, openGraph, openOutline} from "../../layout/dock/util";
/// #endif
import {reloadProtyle} from "../util/reload";
import {getContenteditableElement} from "./getBlock";
import {hasClosestByMatchTag} from "../util/hasClosest";
import {hideElements} from "../ui/hideElements";
import {countBlockWord} from "../../layout/status";

export const commonHotkey = (protyle: IProtyle, event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (matchHotKey(window.siyuan.config.keymap.editor.general.copyHPath.custom, event)) {
        fetchPost("/api/filetree/getHPathByID", {
            id: protyle.block.rootID
        }, (response) => {
            writeText(response.data);
        });
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.refresh.custom, event)) {
        reloadProtyle(protyle);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.fullscreen.custom, event)) {
        fullscreen(protyle.element);
        setPadding(protyle);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    if (matchHotKey(window.siyuan.config.keymap.editor.general.netImg2LocalAsset.custom, event)) {
        netImg2LocalAssets(protyle);
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    /// #if !MOBILE
    if (protyle.model) {
        if (matchHotKey(window.siyuan.config.keymap.editor.general.backlinks.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            openBacklink(protyle);
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.graphView.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            openGraph(protyle);
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.outline.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            const offset = getSelectionOffset(target);
            openOutline(protyle);
            // switchWnd 后，range会被清空，需要重新设置
            focusByOffset(target, offset.start, offset.end);
            return true;
        }
    }
    /// #endif
};

export const upSelect = (options: {
    protyle: IProtyle,
    event: KeyboardEvent,
    nodeElement: HTMLElement,
    editorElement: HTMLElement,
    range: Range,
    cb: (selectElements: NodeListOf<Element>) => void
}) => {
    const selectElements = options.protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
    if (selectElements.length > 0) {
        options.event.stopPropagation();
        options.event.preventDefault();
    } else {
        const start = getSelectionOffset(options.nodeElement, options.editorElement, options.range).start;
        if (start !== 0) {
            const editElement = getContenteditableElement(options.nodeElement);
            if (editElement.tagName === "TABLE") {
                const cellElement = hasClosestByMatchTag(options.range.startContainer, "TH") || hasClosestByMatchTag(options.range.startContainer, "TD") || editElement.querySelector("th, td");
                if (getSelectionOffset(cellElement, cellElement, options.range).start !== 0) {
                    setFirstNodeRange(cellElement, options.range);
                    options.event.stopPropagation();
                    options.event.preventDefault();
                    return;
                }
            } else {
                const firstIndex = editElement.textContent.indexOf("\n");
                if (firstIndex === -1 || start <= firstIndex || start === editElement.textContent.replace("\n", " ").indexOf("\n")) {
                    setFirstNodeRange(editElement, options.range);
                    options.event.stopPropagation();
                    options.event.preventDefault();
                    return;
                } else {
                    return;
                }
            }
        }
    }
    options.range.collapse(true);
    hideElements(["toolbar"], options.protyle);
    if (selectElements.length === 0) {
        options.nodeElement.classList.add("protyle-wysiwyg--select");
    } else {
        options.cb(selectElements);
    }
    const ids: string[] = [];
    options.protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
        ids.push(item.getAttribute("data-node-id"));
    });
    countBlockWord(ids, options.protyle.block.rootID);
    options.event.stopPropagation();
    options.event.preventDefault();
};

export const downSelect = (options: {
    protyle: IProtyle,
    event: KeyboardEvent,
    nodeElement: HTMLElement,
    editorElement: HTMLElement,
    range: Range,
    cb: (selectElement: NodeListOf<Element>) => void
}) => {
    const selectElements = options.protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
    if (selectElements.length > 0) {
        options.event.stopPropagation();
        options.event.preventDefault();
    } else {
        const editElement = getContenteditableElement(options.nodeElement);
        const end = getSelectionOffset(options.nodeElement, options.editorElement, options.range).end;
        if (end < editElement.textContent.length) {
            if (end > editElement.textContent.lastIndexOf("\n")) {
                setLastNodeRange(editElement, options.range, false);
                options.event.stopPropagation();
                options.event.preventDefault();
                return;
            } else {
                return;
            }
        }
    }
    options.range.collapse(false);
    hideElements(["toolbar"], options.protyle);
    if (selectElements.length === 0) {
        options.nodeElement.classList.add("protyle-wysiwyg--select");
    } else {
        options.cb(selectElements);
    }
    const ids: string[] = [];
    options.protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
        ids.push(item.getAttribute("data-node-id"));
    });
    countBlockWord(ids, options.protyle.block.rootID);
    options.event.stopPropagation();
    options.event.preventDefault();
};

export const getStartEndElement = (selectElements: NodeListOf<Element>) => {
    let startElement;
    let endElement;
    selectElements.forEach(item => {
        if (item.getAttribute("select-start")) {
            startElement = item;
        }
        if (item.getAttribute("select-end")) {
            endElement = item;
        }
    });
    if (!startElement) {
        startElement = selectElements[0];
        startElement.setAttribute("select-start", "true");
    }
    if (!endElement) {
        endElement = selectElements[selectElements.length - 1];
        endElement.setAttribute("select-end", "true");
    }
    return {
        startElement,
        endElement
    };
};
