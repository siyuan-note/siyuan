import {isInEmbedBlock} from "../util/hasClosest";
import {BLOCK_SELECTION_CLASS} from "./blockSelection";

export const getBlockInsertionContext = (editorElement: Element, nodeElement: Element,
                                        position: "beforebegin" | "afterend", selectionModeElement?: Element) => {
    const selectedElements = editorElement.querySelectorAll(`.${BLOCK_SELECTION_CLASS}`);
    const target = selectedElements.length > 0 ?
        selectedElements[position === "beforebegin" ? 0 : selectedElements.length - 1] : selectionModeElement;
    // 以实际插入目标检查嵌入边界，未选块时保留光标位置的插入规则。
    return {target, allowed: !isInEmbedBlock(target || nodeElement)};
};
