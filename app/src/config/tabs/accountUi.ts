import {showMessage} from "../../dialog/message";
import {Constants} from "../../constants";
import {fetchPost} from "../../util/fetch";
import {confirmDialog} from "../../dialog/confirmDialog";
import {Dialog} from "../../dialog";
import {isInIOS} from "../../protyle/util/compatibility";
import {isMobile} from "../../util/functions";
import {processSync} from "../../dialog/processSystem";
import {getCloudURL, getIndexURL} from "../util/about";
import {iOSPurchase} from "../../util/iOSPurchase";
import {hideElements} from "../../protyle/ui/hideElements";
/// #if MOBILE
import {closePanel} from "../../mobile/util/closePanel";
/// #endif
import md5 from "blueimp-md5";
import type {SettingTabBuilder} from "../setting/builder";
import {patchSyncConfig, refreshSyncCloudSpaceGroup} from "./syncRuntime";
import {escapeAttr, escapeHtml} from "../../util/escape";

/** 账号节：由 syncTab 注册 */
export const registerAccountGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("account", window.siyuan.languages.configGroupAccount);

    group.slot({
        key: "accountMain",
        keywords: [
            window.siyuan.languages.account,
            window.siyuan.languages.accountName,
            window.siyuan.languages.password,
            window.siyuan.languages.cloudRegionChina,
            window.siyuan.languages.cloudRegionNorthAmerica,
            window.siyuan.languages.captcha,
            window.siyuan.languages.accountTip,
            window.siyuan.languages.login,
            window.siyuan.languages.forgetPassword,
            window.siyuan.languages.register,
            window.siyuan.languages.twoFactorCaptcha,
            window.siyuan.languages.refresh,
            window.siyuan.languages.manage,
            window.siyuan.languages.logout,
            window.siyuan.languages.deactivateUser,
        ],
        html: genAccountMainHTML,
        afterMount: bindAccountMainEvent,
    });
    group.slot({
        key: "accountPayment",
        keywords: [
            window.siyuan.languages.paymentStatus,
            window.siyuan.languages.account1,
            window.siyuan.languages.account3,
            window.siyuan.languages.account4,
            window.siyuan.languages.account6,
            window.siyuan.languages.account7,
            window.siyuan.languages.account8,
            window.siyuan.languages.account10,
            window.siyuan.languages.account12,
            window.siyuan.languages.accountUnpaid,
            window.siyuan.languages.accountSubscriptionExpired,
            window.siyuan.languages.onepay,
            window.siyuan.languages.freeSub,
            window.siyuan.languages.clickMeToRenew,
            window.siyuan.languages.activationCode,
            window.siyuan.languages.activationCodePlaceholder,
        ],
        html: genAccountPaymentHTML,
        afterMount: bindAccountPaymentEvent,
    });
    if (!isMobile()) {
        group.switch("account.displayVIP", {
            title: window.siyuan.languages.accountDisplayVIP,
            save: (value) => patchSyncConfig("account.displayVIP", value),
        });
        group.switch("account.displayTitle", {
            title: window.siyuan.languages.accountDisplayTitle,
            save: (value) => patchSyncConfig("account.displayTitle", value),
        });
    }
};

const genAccountMainHTML = () => {
    if (!window.siyuan.user) {
        return `<div id="configAccountMain" class="b3-label b3-label--noborder config-item fn__flex-column config-account--login">${genAccountAuthHTML("login")}</div>`;
    }

    const isIOS = isInIOS();
    const memberUrl = getCloudURL("member/" + window.siyuan.user.userName);
    const displayName = window.siyuan.user.userNickname
        ? `<div class="fn__flex config-account__profile-name"><b>${window.siyuan.user.userNickname}</b><span class="fn__space"></span>
<a target="_blank" class="fn__a ft__smaller" href="${memberUrl}">${window.siyuan.user.userName}</a></div>`
        : `<div class="fn__flex config-account__profile-name"><a target="_blank" class="fn__a" href="${memberUrl}"><b>${window.siyuan.user.userName}</b></a></div>`;
    const region = ({0: "ld246.com", 1: "liuyun.io"} as Record<number, string>)[window.siyuan.config.cloudRegion] ?? "unknown region";
    const titlesHTML = window.siyuan.user.userTitles.length > 0
        ? `<div class="b3-chips config-account__profile-titles">${window.siyuan.user.userTitles.map(item => {
            const label = item.desc ? `${item.name}：${item.desc}` : item.name;
            return `<span class="b3-chip b3-chip--middle ariaLabel" aria-label="${escapeAttr(label)}">${item.icon}${escapeHtml(item.name)}</span>`;
        }).join("")}</div>`
        : "";

    return `<div id="configAccountMain" class="b3-label--noborder fn__flex b3-label config-item config-wrap">
    <div class="fn__flex fn__flex-1 config-account__profile">
    <a href="${getCloudURL("settings/avatar")}" class="config-account__profile-avatar" style="background-image: url(${window.siyuan.user.userAvatarURL})" target="_blank"></a>
    <span class="fn__space"></span>
    <div class="config-account__profile-info">
        <div class="fn__flex config-account__profile-main">
            <div class="config-account__profile-meta">
                ${displayName}
                <div class="b3-label__text config-account__profile-region">${region}</div>
            </div>
            ${titlesHTML}
        </div>
    </div>
    </div>
    <span class="fn__space"></span>
    <div class="fn__flex config-account__row-actions">
        <button class="b3-button b3-button--text" id="refresh">
            <svg><use xlink:href="#iconRefresh"></use></svg>${window.siyuan.languages.refresh}
        </button>
        <button type="button" class="b3-button b3-button--cancel${isIOS ? "" : " fn__none"}" id="deactivateUser">${window.siyuan.languages.deactivateUser}</button>
        <a class="b3-button b3-button--cancel${isIOS ? " fn__none" : ""}" href="${getCloudURL("settings")}" target="_blank">${window.siyuan.languages.manage}</a>
        <button class="b3-button b3-button--cancel" id="logout">${window.siyuan.languages.logout}</button>
    </div>
</div>`;
};

const genAccountAuthHTML = (mode: "login" | "deactivate") => {
    return `<div class="b3-form__space--small" id="form1">
    <div class="b3-form__icon">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconAccount"></use></svg>
        <input id="userName" class="b3-text-field fn__block b3-form__icon-input" placeholder="${window.siyuan.languages.accountName}">
    </div>
    <div class="fn__hr--b"></div>
    <div class="b3-form__icon">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconLock"></use></svg>
        <input type="password" id="userPassword" class="b3-text-field b3-form__icon-input fn__block" placeholder="${window.siyuan.languages.password}">
    </div>
    <div class="fn__hr--b"></div>
    ${mode === "login" ? `<div class="b3-form__icon">
            <svg class="b3-form__icon-icon"><use xlink:href="#iconFocus"></use></svg>
            <select class="b3-select b3-form__icon-input fn__block" id="cloudRegion">
                <option value="0"${window.siyuan.config.cloudRegion === 0 ? " selected" : ""}>${window.siyuan.languages.cloudRegionChina}</option>
                <option value="1"${window.siyuan.config.cloudRegion === 1 ? " selected" : ""}>${window.siyuan.languages.cloudRegionNorthAmerica}</option>
            </select>
        </div>` : ""
    }
    <div id="captchaRow" class="fn__none">
        <div class="fn__hr--b"></div>
        <div class="b3-form__img fn__flex">
            <img id="captchaImg" class="b3-form__img-captcha fn__pointer" alt="">
            <input id="captcha" class="b3-text-field fn__flex-1" placeholder="${window.siyuan.languages.captcha}">
        </div>
    </div>
    ${mode === "login" ? `<div class="fn__hr--b"></div>
        <label class="ft__smaller ft__on-surface fn__flex">
            <input type="checkbox" id="agreeLogin">
            <span class="fn__space"></span>
            <span>${window.siyuan.languages.accountTip}</span>
        </label>
        <div class="fn__hr--b"></div>
        <button id="login" disabled class="b3-button fn__block">${window.siyuan.languages.login}</button>
        <div class="fn__hr--b"></div>
        <div class="ft__center">${genAccountAuthFooterLinksHTML()}</div>` : ""
    }
    ${mode === "deactivate" ? `<div class="fn__hr--b"></div>
        <button id="login" class="b3-button fn__block">${window.siyuan.languages.deactivateUser}</button>` : ""
    }
</div>
<div class="b3-form__space--small fn__none" id="form2">
    <div class="b3-form__icon">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconLock"></use></svg>
        <input id="twofactorAuthCode" class="b3-text-field fn__block b3-form__icon-input" placeholder="${window.siyuan.languages.twoFactorCaptcha}">
    </div>
    <div class="fn__hr--b"></div>
    <button id="login2" class="b3-button fn__block">${mode === "login" ? window.siyuan.languages.login : window.siyuan.languages.deactivateUser}</button>
</div>`;
    };

const genAccountAuthFooterLinksHTML = () => {
    const isIOS = isInIOS();
    return `<a href="${getCloudURL("forget-pwd")}" class="b3-button b3-button--cancel" target="_blank">${window.siyuan.languages.forgetPassword}</a>
<span class="fn__space${isIOS ? " fn__none" : ""}"></span>
<a href="${getCloudURL("register")}" class="b3-button b3-button--cancel${isIOS ? " fn__none" : ""}" target="_blank">${window.siyuan.languages.register}</a>`;
};

const bindAccountMainEvent = (accountSettingsRoot: Element) => {
    const accountMainEl = accountSettingsRoot.querySelector("#configAccountMain");
    if (!accountMainEl) {
        return;
    }
    const refreshBtn = accountMainEl.querySelector("#refresh") as HTMLButtonElement;
    refreshBtn?.addEventListener("click", () => {
        const refreshIcon = refreshBtn.firstElementChild as SVGElement;
        if (refreshIcon?.classList.contains("fn__rotate")) {
            return;
        }
        refreshIcon?.classList.add("fn__rotate");
        fetchPost("/api/setting/getCloudUser", {
            token: window.siyuan.user?.userToken || "",
        }, response => {
            window.siyuan.user = response.data;
            renderAccount(accountSettingsRoot);
            showMessage(window.siyuan.languages.refreshUser, 3000);
            onSetaccount();
            processSync();
            refreshSyncCloudSpaceGroup(accountSettingsRoot);
        });
    });
    if (accountMainEl.classList.contains("config-account--login")) {
        bindAccountAuthForm(accountMainEl as HTMLElement, "login", accountSettingsRoot);
    }
    if (!window.siyuan.user) {
        return;
    }
    accountMainEl.querySelector("#logout")?.addEventListener("click", () => {
        fetchPost("/api/setting/logoutCloudUser", {}, () => {
            fetchPost("/api/setting/getCloudUser", {}, response => {
                window.siyuan.user = response.data;
                renderAccount(accountSettingsRoot);
                onSetaccount();
                processSync();
                refreshSyncCloudSpaceGroup(accountSettingsRoot);
            });
        });
    });
    accountMainEl.querySelector("#deactivateUser")?.addEventListener("click", (event) => {
        const dialog = new Dialog({
            title: "⚠️ " + window.siyuan.languages.deactivateUser,
            width: isMobile() ? "92vw" : "520px",
            content: `<div class="config-account--auth">${genAccountAuthHTML("deactivate")}</div>`,
        });
        const deactivateDialogBody = dialog.element.querySelector(".b3-dialog__body") as HTMLElement;
        bindAccountAuthForm(deactivateDialogBody, "deactivate");
        dialog.element.setAttribute("data-key", Constants.DIALOG_DEACTIVATEUSER);
        event.preventDefault();
        event.stopPropagation();
    });
};

const bindAccountPaymentEvent = (accountSettingsRoot: Element) => {
    const accountPaymentEl = accountSettingsRoot.querySelector("#configAccountPayment");
    if (!accountPaymentEl || !window.siyuan.user) {
        return;
    }
    accountPaymentEl.querySelectorAll('[data-action="iOSPay"]').forEach(iOSPayBtn => {
        iOSPayBtn.addEventListener("click", () => {
            iOSPurchase(iOSPayBtn.getAttribute("data-type"));
        });
    });
    accountPaymentEl.querySelector("#trialSub")?.addEventListener("click", () => {
        fetchPost("/api/account/startFreeTrial", {}, () => {
            accountSettingsRoot.querySelector("#refresh")?.dispatchEvent(new Event("click"));
        });
    });
    const activationCodeBtn = accountPaymentEl.querySelector("#activationCode");
    activationCodeBtn?.addEventListener("click", () => {
        const activationCodeInput = activationCodeBtn.previousElementSibling as HTMLInputElement;
        fetchPost("/api/account/checkActivationcode", {data: activationCodeInput.value}, (response) => {
            if (0 !== response.code) {
                activationCodeInput.value = "";
            }
            confirmDialog(window.siyuan.languages.activationCode, response.msg, () => {
                if (response.code === 0) {
                    fetchPost("/api/account/useActivationcode", {data: activationCodeInput.value}, () => {
                        accountSettingsRoot.querySelector("#refresh")?.dispatchEvent(new CustomEvent("click"));
                    });
                }
            });
        });
    });
};

const genAccountPaymentHTML = () => {
    if (!window.siyuan.user) {
        return '<div id="configAccountPayment" class="fn__none"></div>';
    }

    const isIOS = isInIOS();
    const expireTime = window.siyuan.user.userSiYuanProExpireTime;
    const isOnetimePaid = window.siyuan.user.userSiYuanOneTimePayStatus === 1;
    let statusHTML = "";
    let actionsHTML = "";
    if (expireTime === -1) {
        // 终身会员
        statusHTML = `${Constants.SIYUAN_IMAGE_VIP}${window.siyuan.languages.account12}`;
    } else if (expireTime > 0) {
        // 订阅会员
        if (window.siyuan.user.userSiYuanSubscriptionPlan === 2) {
            // 试用订阅
            statusHTML = window.siyuan.languages.account3;
        } else {
            // 付费订阅
            statusHTML = window.siyuan.languages.account8;
        }
        if (isOnetimePaid) {
            // 功能特性
            statusHTML += " · " + window.siyuan.languages.account7;
        }

        const actionsHtmlParts: string[] = [];
        const daysLeft = Math.max(0, Math.floor((expireTime - Date.now()) / (24 * 60 * 60 * 1000)));
        // 剩余天数
        actionsHtmlParts.push(`<div class="ft__on-surface">${window.siyuan.languages.account6} ${daysLeft} ${window.siyuan.languages.day}</div><span class="fn__space"></span>`);
        // 续费订阅
        actionsHtmlParts.push(isIOS
            ? `<button type="button" class="b3-button b3-button--text" data-action="iOSPay" data-type="subscribe">${window.siyuan.languages.clickMeToRenew}</button>`
            : `<a class="b3-button b3-button--text" href="${getCloudURL("subscribe/siyuan")}" target="_blank">${window.siyuan.languages.clickMeToRenew}</a>`
        );
        if (!isOnetimePaid) {
            // 购买功能特性
            actionsHtmlParts.push(isIOS
                ? `<button type="button" class="b3-button b3-button--text" data-action="iOSPay" data-type="function">${window.siyuan.languages.onepay}</button>`
                : `<a class="b3-button b3-button--text" href="${getIndexURL("pricing.html")}" target="_blank">${window.siyuan.languages.onepay}</a>`
            );
        }
        actionsHTML = actionsHtmlParts.join("");
    } else if (window.siyuan.user.userSiYuanSubscriptionStatus === 2) {
        // 订阅过期
        statusHTML = isOnetimePaid ? window.siyuan.languages.account7 : window.siyuan.languages.accountSubscriptionExpired;

        const actionsHtmlParts: string[] = [];
        actionsHtmlParts.push(isIOS
            ? `<button type="button" class="b3-button b3-button--text" data-action="iOSPay" data-type="subscribe">${window.siyuan.languages.clickMeToRenew}</button>`
            : `<a class="b3-button b3-button--text" href="${getCloudURL("subscribe/siyuan")}" target="_blank">${window.siyuan.languages.clickMeToRenew}</a>`
        );
        if (!isOnetimePaid) {
            const onepayAction = isIOS
                ? `<button type="button" class="b3-button b3-button--text" data-action="iOSPay" data-type="function">${window.siyuan.languages.onepay}</button>`
                : `<a class="b3-button b3-button--text" href="${getIndexURL("pricing.html")}" target="_blank">${window.siyuan.languages.onepay}</a>`;
            actionsHtmlParts.push(`<span class="fn__space"></span>${onepayAction}`);
        }
        actionsHTML = actionsHtmlParts.join("");
    } else {
        // 没有订阅过
        statusHTML = isOnetimePaid ? window.siyuan.languages.account7 : window.siyuan.languages.accountUnpaid;

        const actionsHtmlParts: string[] = [];
        const iconVIP = '<svg><use xlink:href="#iconVIP"></use></svg>';
        if (isIOS) {
            actionsHtmlParts.push(isOnetimePaid
                ? `<button class="b3-button" data-action="iOSPay" data-type="subscribe">${iconVIP}${window.siyuan.languages.account4}</button>`
                : `<button class="b3-button b3-button--success" data-action="iOSPay" data-type="function">${iconVIP}${window.siyuan.languages.onepay}</button>
<span class="fn__space"></span><button class="b3-button" data-action="iOSPay" data-type="subscribe">${iconVIP}${window.siyuan.languages.account10}</button>`
            );
        } else {
            actionsHtmlParts.push(`<a class="b3-button" href="${getIndexURL("pricing.html")}" target="_blank">
${iconVIP}${isOnetimePaid ? window.siyuan.languages.account4 : window.siyuan.languages.account1}</a>`);
        }
        if (window.siyuan.user.userSiYuanSubscriptionStatus === -1) {
            // 试用订阅按钮
            actionsHtmlParts.push(`<span class="fn__space"></span>
<button type="button" class="b3-button" id="trialSub"><svg class="ft__secondary"><use xlink:href="#iconVIP"></use></svg>${window.siyuan.languages.freeSub}</button>`);
        }
        actionsHTML = actionsHtmlParts.join("");
    }

    // 激活码包含首年订阅和终生订阅两种，在非终生订阅状态时显示输入框
    const activationHTML = !isIOS && expireTime !== -1 ? `<div class="fn__hr"></div>
<div class="b3-form__icon fn__block">
    <input class="b3-text-field fn__block" style="padding-right: 52px;" placeholder="${window.siyuan.languages.activationCodePlaceholder}">
    <button type="button" id="activationCode" class="b3-button b3-button--text" style="position: absolute; right: 0; top: 0;">${window.siyuan.languages.confirm}</button>
</div>` : "";

    return `<div id="configAccountPayment" class="b3-label config-item">
    <div class="fn__flex config-wrap">
        <span class="config-name">${window.siyuan.languages.paymentStatus}</span>
        <span class="fn__space"></span><span class="ft__on-surface">${statusHTML}</span>
        <div class="fn__flex-1"></div>
        ${actionsHTML}
    </div>
    ${activationHTML}
</div>`;
};

const bindAccountAuthForm = (
    authFormRoot: HTMLElement,
    mode: "login" | "deactivate",
    accountSettingsRoot?: Element,
) => {
    const userNameInput = authFormRoot.querySelector("#userName") as HTMLInputElement;
    userNameInput.focus();
    const userPasswordInput = authFormRoot.querySelector("#userPassword") as HTMLInputElement;
    const captchaImg = authFormRoot.querySelector("#captchaImg") as HTMLImageElement;
    const captchaInput = authFormRoot.querySelector("#captcha") as HTMLInputElement;
    const twofactorAuthCodeInput = authFormRoot.querySelector("#twofactorAuthCode") as HTMLInputElement;
    const loginBtn = authFormRoot.querySelector("#login") as HTMLButtonElement;
    const login2Btn = authFormRoot.querySelector("#login2") as HTMLButtonElement;
    let token = "";
    let needCaptcha = "";

    if (mode === "login") {
        const agreeLoginCheckbox = authFormRoot.querySelector("#agreeLogin") as HTMLInputElement;
        agreeLoginCheckbox.addEventListener("click", () => {
            loginBtn.disabled = !agreeLoginCheckbox.checked;
        });
        const cloudRegionSelect = authFormRoot.querySelector("#cloudRegion") as HTMLSelectElement;
        cloudRegionSelect.addEventListener("change", () => {
            window.siyuan.config.cloudRegion = parseInt(cloudRegionSelect.value);
            authFormRoot.querySelector("#form1")!.lastElementChild!.innerHTML = genAccountAuthFooterLinksHTML();
        });
    }
    const refreshCaptchaImg = () => {
        captchaImg.setAttribute("src", getCloudURL("captcha") + `/login?needCaptcha=${needCaptcha}&t=${Date.now()}`);
    };
    captchaImg.addEventListener("click", () => {
        refreshCaptchaImg();
    });

    const completeLogin = (response: IWebSocketData) => {
        if (mode === "login") {
            fetchPost("/api/setting/getCloudUser", {
                token: response.data.token,
            }, (userResponse) => {
                window.siyuan.user = userResponse.data;
                processSync();
                renderAccount(accountSettingsRoot!);
                onSetaccount();
                refreshSyncCloudSpaceGroup(accountSettingsRoot!);
                window.dispatchEvent(new CustomEvent("siyuan-login-success"));
            });
        } else if (mode === "deactivate") {
            confirmDeactivateAccount();
        }
    };

    loginBtn.addEventListener("click", () => {
        fetchPost("/api/account/login", {
            userName: userNameInput.value.trim(),
            userPassword: md5(userPasswordInput.value),
            captcha: captchaInput.value.trim(),
            cloudRegion: window.siyuan.config.cloudRegion,
        }, (loginResponse) => {
            if (loginResponse.code === 1) {
                showMessage(loginResponse.msg);
                needCaptcha = loginResponse.data.needCaptcha;
                if (needCaptcha) {
                    // 验证码
                    captchaInput.value = "";
                    refreshCaptchaImg();
                    authFormRoot.querySelector("#captchaRow")?.classList.remove("fn__none");
                }
                return;
            }
            if (loginResponse.code === 10) {
                // 两步验证
                authFormRoot.querySelector("#form1")?.classList.add("fn__none");
                authFormRoot.querySelector("#form2")?.classList.remove("fn__none");
                twofactorAuthCodeInput.focus();
                token = loginResponse.data.token;
                return;
            }
            completeLogin(loginResponse);
        });
    });
    login2Btn.addEventListener("click", () => {
        fetchPost("/api/setting/login2faCloudUser", {
            code: twofactorAuthCodeInput.value,
            token,
        }, (faResponse) => {
            completeLogin(faResponse);
        });
    });
};

const confirmDeactivateAccount = () => {
    hideElements(["dialog"]);
    confirmDialog("⚠️ " + window.siyuan.languages.deactivateUser, window.siyuan.languages.deactivateUserTip, () => {
        fetchPost("/api/account/deactivate", {}, () => {
            window.siyuan.user = null;
            /// #if MOBILE
            closePanel();
            /// #endif
            processSync();
        });
    });
};

export const updateAccountSwitchesVisibility = (accountSettingsRoot: Element) => {
    const user = window.siyuan.user;
    accountSettingsRoot.querySelector(`#${CSS.escape("account.displayTitle")}`)?.closest(".config-item")?.classList.toggle("fn__none", !user || user.userTitles.length === 0);
    accountSettingsRoot.querySelector(`#${CSS.escape("account.displayVIP")}`)?.closest(".config-item")?.classList.toggle("fn__none", !user);
    accountSettingsRoot.querySelector("#configAccountPayment")?.classList.toggle("fn__none", !user);
};

const renderAccount = (accountSettingsRoot: Element) => {
    const accountMainEl = accountSettingsRoot.querySelector("#configAccountMain");
    const accountPaymentEl = accountSettingsRoot.querySelector("#configAccountPayment");
    if (accountMainEl) {
        accountMainEl.outerHTML = genAccountMainHTML();
    }
    if (accountPaymentEl) {
        accountPaymentEl.outerHTML = genAccountPaymentHTML();
    }
    updateAccountSwitchesVisibility(accountSettingsRoot);
    bindAccountMainEvent(accountSettingsRoot);
    bindAccountPaymentEvent(accountSettingsRoot);
};

const genVIPIconHTML = (className = "") =>
    `<svg${className ? ` class="${className}"` : ""}><use xlink:href="#iconVIP"></use></svg>`;

const genToolbarItemHTML = (ariaLabel: string, svg: string) =>
    `<div class="toolbar__item ariaLabel" aria-label="${ariaLabel}">${svg}</div>`;

export const onSetaccount = () => {
    /// #if !MOBILE
    const toolbarVIPEl = document.getElementById("toolbarVIP");
    if (!toolbarVIPEl) {
        return;
    }
    const parts: string[] = [];
    if (window.siyuan.config.account.displayVIP) {
        if (!window.siyuan.user) {
            // 未登录
            parts.push(genToolbarItemHTML(window.siyuan.languages.freeSub, genVIPIconHTML("ft__error")));
        } else {
            const isOneTimePay = window.siyuan.user.userSiYuanOneTimePayStatus === 1;
            if (window.siyuan.user.userSiYuanProExpireTime === -1) {
                // 终身会员
                parts.push(genToolbarItemHTML(window.siyuan.languages.account12, Constants.SIYUAN_IMAGE_VIP));
            } else if (window.siyuan.user.userSiYuanProExpireTime > 0) {
                // 订阅有效（未过期）
                if (window.siyuan.user.userSiYuanSubscriptionPlan === 2) {
                    // 试用订阅
                    parts.push(genToolbarItemHTML(window.siyuan.languages.account3, genVIPIconHTML()));
                } else {
                    // 付费订阅
                    parts.push(genToolbarItemHTML(window.siyuan.languages.account10, genVIPIconHTML("ft__secondary")));
                }
            } else if (window.siyuan.user.userSiYuanSubscriptionStatus === 2 && !isOneTimePay) {
                // 订阅过期
                parts.push(genToolbarItemHTML(window.siyuan.languages.accountSubscriptionExpired, genVIPIconHTML("ft__error")));
            } else if (window.siyuan.user.userSiYuanSubscriptionStatus === -1 && !isOneTimePay) {
                // 未订阅过
                parts.push(genToolbarItemHTML(window.siyuan.languages.freeSub, genVIPIconHTML("ft__error")));
            }
            if (isOneTimePay) {
                // 功能特性已付费
                parts.push(genToolbarItemHTML(window.siyuan.languages.onepay, genVIPIconHTML("ft__success")));
            }
        }
    }

    if (window.siyuan.config.account.displayTitle && window.siyuan.user) {
        window.siyuan.user.userTitles.forEach(item => {
            parts.push(genToolbarItemHTML(`${item.name}：${item.desc}`, item.icon));
        });
    }

    toolbarVIPEl.innerHTML = parts.join("");
    /// #endif
};
