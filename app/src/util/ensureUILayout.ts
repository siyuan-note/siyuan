import {Constants} from "../constants";

export const ensureUILayout = () => {
    if (!window.siyuan.config.uiLayout?.left) {
        window.siyuan.config.uiLayout = JSON.parse(JSON.stringify(Constants.SIYUAN_EMPTY_LAYOUT));
    }
};
