import {showMessage} from "../dialog/message";

export const IOSPurchase = (code: number) => {
    if (code === 0) {
        /// #if MOBILE
        document.querySelector("#modelMain").dispatchEvent(new CustomEvent("click", {
            detail: document.querySelector("#modelMain #refresh")
        }));
        /// #else
        document.querySelector('.config__tab-container[data-name="account"] #refresh').dispatchEvent(new Event("click"));
        /// #endif
    } else {
        // -1：Invalid cloud region 云端区域无效
        // -2：Server communication failed, need to retry 服务器通讯失败，需要重试
        // -3：Non-iOS device 非 iOS 设备
        // -4：Account not logged in 账号未登录
        // -5：Account status abnormal 账号状态异常
        // -6：Parameter error 参数错误
        // -7：AccountToken verification failed 校验 accountToken 失败
        // -8：Transaction verification failed 校验 transaction 失败
        let message = "";
        switch (code) {
            case -1:
                message = "Invalid cloud region";
                break;
            case -2:
                message = "Server communication failed, need to retry";
                break;
            case -3:
                message = "Non-iOS device";
                break;
            case -4:
                message = "Account not logged in";
                break;
            case -5:
                message = "Account status abnormal";
                break;
            case -6:
                message = "Parameter error";
                break;
            case -7:
                message = "AccountToken verification failed";
                break;
            case -8:
                message = "Transaction verification failed";
                break;
        }
        showMessage(message, 0, "error");
    }
};
