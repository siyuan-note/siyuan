import {createAVLocationReplacement} from "./locationValue";
import {createAVCellUpdateOperation, genEmptyAVCellValue} from "./cellValue";

interface IAVCellValueTarget {
    id: string;
    keyID: string;
    blockID: string;
}

export const rebindAVCellValue = (source: IAVCellValue, target: IAVCellValueTarget) => {
    const value = JSON.parse(JSON.stringify(source,
        (key, item) => key === "renderedContent" ? undefined : item)) as IAVCellValue & {
        createdAt?: number;
        updatedAt?: number;
    };
    value.id = target.id;
    value.keyID = target.keyID;
    value.blockID = target.blockID;
    if (value.type === "location") {
        value.location = createAVLocationReplacement(value.location);
    }
    delete value.createdAt;
    delete value.updatedAt;
    return value;
};

export const genAVDragFillValue = (source: IAVCellValue, target: IAVCellValueTarget) =>
    rebindAVCellValue({...genEmptyAVCellValue(source.type), ...source}, target);

export const createAVDragFillOperation = (options: Parameters<typeof createAVCellUpdateOperation>[0]) => {
    const value = options.data;
    const block = value.type === "block" ? value.block : undefined;
    // 填充和撤销都会替换主键内容，纯文本值需要显式清除富文本源。
    const data = block && block.rich === undefined && block.richBlockDOM == null ?
        {...value, block: {...block, rich: null}} : value;
    return createAVCellUpdateOperation({...options, data});
};
