import {dragOverScroll, stopScrollAnimation} from "../../boot/globalEvent/dragover";
import {countBlockWord} from "../../layout/status";
import {updateMultiSelectToolbar} from "../../mobile/util/multiSelectToolbar";
import {isMobile} from "../../util/functions";
import {hideElements} from "../ui/hideElements";
import {hasClosestBlock, isInEmbedBlock} from "../util/hasClosest";
import {focusBlock, getBlockRangeSelectElements} from "../util/selection";
import {getBlockDragSelectBlock} from "./blockDragSelect";
import {bindBlockDragSelectionGesture} from "./blockDragSelectionGesture";
import {BLOCK_SELECTION_CLASS, clearBlockSelectionMode, setBlockSelectionModeElement} from "./blockSelection";
import {isContainerBlock} from "./getBlock";
import {restoreGutterBySelection} from "../gutter/restore";

export const bindBoundedBlockDragSelect = (protyle: IProtyle, element: HTMLElement) => {
    let selected: HTMLElement[] = [];
    let activeBlock: HTMLElement;
    let selecting = false;
    const getBlock = (target: Element) => {
        if (!target || target.closest(".protyle-wysiwyg") !== element) {
            return undefined;
        }
        const block = getBlockDragSelectBlock(target, element, hasClosestBlock, isContainerBlock,
            item => item.getAttribute("data-type") === "NodeListItem");
        return block ? (isInEmbedBlock(block) || block) as HTMLElement : undefined;
    };
    return bindBlockDragSelectionGesture(element, protyle.contentElement, {
        canStart: source => !!protyle.gutter && !protyle.disabled &&
            !window.siyuan.touchDragActive && !element.closest(".sy__backlink--bottom") &&
            !element.classList.contains("fn__pointer-none") &&
            // iPad 保留可跨块编辑的正文宿主，鼠标继续使用其原生文字选区。
            (source === "touch" || element.getAttribute("contenteditable") === "false"),
        isMultiSelectMode: () => protyle.toolbar.isMultiSelectMode(),
        getStartBlock: (target, source) => {
            if (target.closest("input, textarea, select, button, a, audio, video, iframe, protyle-html, " +
                ".protyle-action, .protyle-attr, .protyle-action__drag, .sb__resize, .protyle-custom, " +
                ".av, .table, .protyle-wysiwyg__embed, [data-type='NodeBlockQueryEmbed'], [data-prevent-swipe]")) {
                return undefined;
            }
            if (source === "mouse" || !protyle.toolbar.isMultiSelectMode()) {
                const editable = target.closest('[contenteditable="true"]');
                if (!editable || !element.contains(editable) ||
                    target.closest("[contenteditable]")?.getAttribute("contenteditable") !== "true") {
                    return undefined;
                }
            }
            return getBlock(target);
        },
        getBlockAtPoint: point => {
            const rect = protyle.contentElement.getBoundingClientRect();
            if (point.clientX < rect.left || point.clientX > rect.right) {
                return undefined;
            }
            return getBlock(element.ownerDocument.elementFromPoint(point.clientX,
                Math.max(rect.top + 1, Math.min(point.clientY, rect.bottom - 1))));
        },
        select: (start, end) => {
            if (!selecting) {
                selecting = true;
                clearBlockSelectionMode(element, true);
                hideElements(["toolbar", "gutter", "hint"], protyle);
                element.classList.add("protyle-wysiwyg--hiderange");
            }
            element.ownerDocument.getSelection()?.removeAllRanges();
            selected = getBlockRangeSelectElements(start, end).selectElements;
            const next = new Set(selected);
            element.querySelectorAll(`.${BLOCK_SELECTION_CLASS}`).forEach(item => {
                if (!next.has(item as HTMLElement)) {
                    item.classList.remove(BLOCK_SELECTION_CLASS);
                }
                item.removeAttribute("select-start");
                item.removeAttribute("select-end");
            });
            selected.forEach(item => item.classList.add(BLOCK_SELECTION_CLASS));
            activeBlock = selected.find(item => item === end || item.contains(end)) || selected[selected.length - 1];
            if (protyle.toolbar.isMultiSelectMode()) {
                updateMultiSelectToolbar(protyle.toolbar.subElement, selected.length);
            }
        },
        scroll: point => {
            const rect = protyle.contentElement.getBoundingClientRect();
            if (point && point.clientX >= rect.left && point.clientX <= rect.right) {
                dragOverScroll(point, rect, protyle.contentElement);
            } else {
                stopScrollAnimation();
            }
        },
        finish: (_source, cancelled) => {
            selecting = false;
            element.classList.remove("protyle-wysiwyg--hiderange");
            if (!activeBlock || !element.contains(activeBlock)) {
                return;
            }
            if (!cancelled) {
                if (isMobile()) {
                    if (!protyle.toolbar.isMultiSelectMode()) {
                        protyle.toolbar.showMultiSelectMode(protyle, activeBlock);
                    }
                } else {
                    // 保留单块内的折叠光标，让复制、剪切和删除复用已有块选区处理。
                    focusBlock(activeBlock);
                    setBlockSelectionModeElement(element, activeBlock);
                    requestAnimationFrame(() => restoreGutterBySelection(protyle));
                }
            }
            countBlockWord(selected.map(item => item.getAttribute("data-node-id")), protyle);
        },
    });
};
