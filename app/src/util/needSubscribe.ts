import {showMessage} from "../dialog/message";
import {getCloudURL} from "../config/util/about";

export const needLogin = (tip = window.siyuan.languages.needLogin) => {
    if (window.siyuan.user) {
        return false;
    }
    if (tip) {
        showMessage(tip);
    }
    return true;
};

export const needSubscribe = (tip = window.siyuan.languages._kernel[29]) => {
    if (window.siyuan.user && (window.siyuan.user.userSiYuanProExpireTime === -1 || window.siyuan.user.userSiYuanProExpireTime > 0)) {
        return false;
    }
    if (tip) {
        if (tip === window.siyuan.languages._kernel[29] && window.siyuan.config.system.container === "ios") {
            showMessage(window.siyuan.languages._kernel[122]);
        } else {
            if (tip === window.siyuan.languages._kernel[29]) {
                tip = window.siyuan.languages._kernel[29].replace("${url}", getCloudURL("subscribe/siyuan"));
            }
            showMessage(tip);
        }
    }
    return true;
};
