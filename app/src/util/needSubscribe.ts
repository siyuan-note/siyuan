import {showMessage} from "../dialog/message";

export const needSubscribe = (tip = window.siyuan.languages._kernel[29]) => {
    if (window.siyuan.user && (window.siyuan.user.userSiYuanProExpireTime === -1 || window.siyuan.user.userSiYuanProExpireTime > 0)) {
        return false;
    }
    if (tip) {
        if (tip === window.siyuan.languages._kernel[29] && window.siyuan.config.system.container === "ios") {
            showMessage(window.siyuan.languages._kernel[122]);
        } else {
            showMessage(tip);
        }
    }
    return true;
};
