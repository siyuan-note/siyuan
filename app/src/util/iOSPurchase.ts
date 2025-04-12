import {showMessage} from "../dialog/message";
import {fetchPost} from "./fetch";
import {genUUID} from "./genID";
import {progressLoading} from "../dialog/processSystem";

export const processIOSPurchaseResponse = (code: number) => {
    progressLoading({
        code: 2,
        msg: ""
    });
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
        // -9：Unknown product 未知的商品
        // -10：用户取消交易
        // -11：购买交易被挂起
        // -12：其他情况
        let message = "";
        switch (code) {
            case -1:
                message = "Invalid cloud region.";
                break;
            case -2:
                message = "Server communication failed, need to retry.";
                break;
            case -3:
                message = "Non-iOS device.";
                break;
            case -4:
                message = "Account not logged in.";
                break;
            case -5:
                message = "Account status abnormal.";
                break;
            case -6:
                message = "Parameter error.";
                break;
            case -7:
                message = "AccountToken verification failed.";
                break;
            case -8:
                message = "Transaction verification failed.";
                break;
            case -9:
                message = "Unknown product.";
                break;
            case -10:
                message = "User canceled the transaction.";
                break;
            case -11:
                message = "Purchase transaction was suspended.";
                break;
            case -12:
                message = "Purchase failed.";
                break;
        }
        showMessage(message, 0, "error");
    }
};

export const iOSPurchase = (productType: string) => {
    if (window.siyuan.user) {
        fetchPost("/api/setting/getCloudUser", {
            token: window.siyuan.user.userToken,
        }, response => {
            if (window.siyuan.user.userSiYuanOneTimePayStatus !== response.data.userSiYuanOneTimePayStatus ||
                window.siyuan.user.userSiYuanProExpireTime !== response.data.userSiYuanProExpireTime ||
                window.siyuan.user.userSiYuanSubscriptionPlan !== response.data.userSiYuanSubscriptionPlan ||
                window.siyuan.user.userSiYuanSubscriptionType !== response.data.userSiYuanSubscriptionType ||
                window.siyuan.user.userSiYuanSubscriptionStatus !== response.data.userSiYuanSubscriptionStatus) {
                showMessage(window.siyuan.languages["_kernel"][19]);
                return;
            }
            window.siyuan.user = response.data;
            let productID;
            if (window.siyuan.config.cloudRegion === 0) {
                productID = productType === "function" ? "china00" : "china02";
            } else {
                productID = productType === "function" ? "00" : "02";
            }
            window.webkit.messageHandlers.purchase.postMessage(`${productID} ${genUUID().substring(0, 19)}${window.siyuan.config.cloudRegion}00${window.siyuan.user.userId.substring(0, 1)}-${window.siyuan.user.userId.substring(1)}`);
            progressLoading({
                code: 1,
                msg: ""
            });
        });
    } else {
        showMessage(window.siyuan.languages.needLogin);
    }
};
