import {Constants} from "../../constants";

/** 计算编辑器内容区域的水平边距。 */
export const getEditorHorizontalPadding = (width: number, fullWidth: boolean) => {
    let left = 24;
    let right = 16;
    let padding = (width - Constants.SIZE_EDITOR_WIDTH) / 2;
    if (!fullWidth && padding > 96) {
        if (padding > Constants.SIZE_EDITOR_WIDTH) {
            padding = width * .382 / 1.382;
        }
        padding = Math.ceil(padding);
        left = padding;
        right = padding;
    } else if (width > Constants.SIZE_EDITOR_WIDTH) {
        left = 96;
        right = 96;
    }
    return {left, right};
};
