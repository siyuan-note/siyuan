import {Constants} from "../constants";
import {pathPosix} from "../util/pathName";

export const renderAssetsPreview = (pathString: string) => {
    const type = pathPosix().extname(pathString).toLowerCase();
    if (Constants.SIYUAN_ASSETS_IMAGE.includes(type)) {
        return `<img style="max-height: 100%" src="${pathString}">`;
    } else if (Constants.SIYUAN_ASSETS_AUDIO.includes(type)) {
        return `<audio style="max-width: 100%" controls="controls" src="${pathString}"></audio>`;
    } else if (Constants.SIYUAN_ASSETS_VIDEO.includes(type)) {
        return `<video style="max-width: 100%" controls="controls" src="${pathString}"></video>`;
    } else {
        return "";
    }
};
