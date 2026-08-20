import {isInEmbedBlock} from "../../protyle/util/hasClosest";
import {getTopAloneElement} from "../../protyle/wysiwyg/getBlock";

export const getMobileBlockSelectionElement = (blockElement: HTMLElement) => {
    const embedBlockElement = isInEmbedBlock(blockElement);
    return getTopAloneElement((embedBlockElement || blockElement) as HTMLElement) as HTMLElement;
};
