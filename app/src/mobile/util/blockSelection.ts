import {isInEmbedBlock} from "../../protyle/util/hasClosest";
import {getTopAloneElement} from "../../protyle/wysiwyg/getBlock";

export const getMobileBlockSelectionElement = (blockElement: HTMLElement, exact = false) => {
    const embedBlockElement = isInEmbedBlock(blockElement);
    if (exact && !embedBlockElement) {
        return blockElement;
    }
    return getTopAloneElement((embedBlockElement || blockElement) as HTMLElement) as HTMLElement;
};
