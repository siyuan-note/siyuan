import {Constants} from "../../constants";
import {getBlockRefAnchorText} from "../../util/newFile";
import {isRangeInEditor, isSameRange} from "../../util/newFileSelection";
import {getUndoFocusContext, restoreFocusContext} from "../util/selection";
import {focusByRange} from "../util/selectionOffsets";
import {stripSemanticMarkersFromRangeText} from "../util/inlineElementMarker";

const getInputText = (range: Range) => stripSemanticMarkersFromRangeText(range).split(Constants.ZWSP).join("");

export const captureDailyNoteSelection = (protyle: IProtyle, range: Range) => ({
    range: range.cloneRange(),
    text: getInputText(range),
    context: getUndoFocusContext(protyle.wysiwyg.element, range, true),
    rootID: protyle.block.rootID,
    notebookID: protyle.notebookId,
});

// 按原文档和逻辑位置插入，光标移动不取消插入；重绘后恢复原选区并核对输入。
export const insertDailyNoteReference = (protyle: IProtyle, target: ReturnType<typeof captureDailyNoteSelection>,
                                        id: string, title: string, staticRef: boolean,
                                        undoContext?: Record<string, string>) => {
    if (!protyle.wysiwyg.element.isConnected || protyle.block.rootID !== target.rootID || protyle.notebookId !== target.notebookID) {
        return;
    }
    const selection = document.getSelection();
    const currentRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
    const currentContext = getUndoFocusContext(protyle.wysiwyg.element, currentRange, true);
    const restoreCurrent = () => {
        if (currentRange && isRangeInEditor(protyle.wysiwyg.element, currentRange)) {
            protyle.toolbar.range = currentRange;
            focusByRange(currentRange);
        } else if (currentContext && restoreFocusContext(protyle, currentContext)) {
            protyle.toolbar.range = document.getSelection().getRangeAt(0);
        }
    };
    let range = target.range;
    if (!isRangeInEditor(protyle.wysiwyg.element, range) || getInputText(range) !== target.text) {
        if (!target.context || !restoreFocusContext(protyle, target.context)) {
            return;
        }
        range = document.getSelection().getRangeAt(0).cloneRange();
    }
    if (getInputText(range) !== target.text) {
        restoreCurrent();
        return;
    }
    const moved = currentRange && !isSameRange(currentRange, range);
    protyle.toolbar.range = range;
    const refs = protyle.toolbar.setInlineMark(protyle, "block-ref", "range", {
        type: "id", color: `${id}${Constants.ZWSP}${staticRef ? "s" : "d"}${Constants.ZWSP}${getBlockRefAnchorText(title)}`,
    }, false, undoContext);
    if (moved) {
        restoreCurrent();
    } else if (refs?.[0]) {
        protyle.toolbar.range.selectNodeContents(refs[0]);
        protyle.toolbar.range.collapse(false);
        focusByRange(protyle.toolbar.range);
    }
};
