import {getAllModels} from "../../layout/getAll";
import {getLiteFragmentHost} from "./liteFragment";
import {hasClosestBlock} from "./hasClosest";

/**
 * 解析元素所属的文档块。片段编辑器（表格单元格、数据库单元格等）内的块由前端生成临时块 ID，
 * 不对应任何文档块，需越过片段宿主向上解析，否则大纲等按块 ID 工作的功能会取到无效 ID。
 */
export const resolveDocumentBlockElement = (element: HTMLElement) => {
    if (!element) {
        return undefined;
    }
    const blockElement = hasClosestBlock(element);
    if (blockElement) {
        return blockElement as HTMLElement;
    }
    const fragmentElement = getLiteFragmentHost(element);
    const ownerElement = fragmentElement && hasClosestBlock(fragmentElement);
    return ownerElement ? ownerElement as HTMLElement : undefined;
};

/**
 * 光标进入表格单元格等内容后同步大纲高亮。片段编辑器自行接管焦点，不会触发编辑区的块级点击处理，
 * 需显式按所属文档块更新大纲，参数应传片段宿主或单元格等片段外元素。
 */
export const updateOutlineCurrentBlock = (protyle: IProtyle, element: HTMLElement) => {
    const blockElement = resolveDocumentBlockElement(element);
    if (!blockElement || !protyle.model) {
        return;
    }
    getAllModels().outline.forEach(item => {
        if (item.blockId === protyle.block.rootID) {
            item.setCurrent(blockElement);
        }
    });
};
