import {hasClosestBlock, hasClosestByAttribute} from "./hasClosest";
import {isNotEditBlock} from "../wysiwyg/getBlock";

export const isBlockRefDropTargetDisabled = (targets: Array<Node | null | undefined>) => targets.some(target => {
    if (!target) {
        return false;
    }
    if (hasClosestByAttribute(target, "data-type", "inline-math")) {
        return true;
    }
    if (hasClosestByAttribute(target, "data-type", "NodeBlockQueryEmbed")) {
        return true;
    }
    const blockElement = hasClosestBlock(target);
    return Boolean(blockElement && isNotEditBlock(blockElement));
});
