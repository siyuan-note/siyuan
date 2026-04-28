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
import {closePanel} from "../../mobile/util/closePanel";
import md5 from "blueimp-md5";
import type {SettingTabBuilder} from "../setting/builder";
import {patchSyncConfig, refreshSyncCloudSpaceGroup, syncTabElement} from "./syncRuntime";
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
        group.switch("account.displayTitle", {
            title: window.siyuan.languages.accountDisplayTitle,
            save: (value) => patchSyncConfig("account.displayTitle", value),
        });
        group.switch("account.displayVIP", {
            title: window.siyuan.languages.accountDisplayVIP,
            save: (value) => patchSyncConfig("account.displayVIP", value),
        });
    }
};

const genAccountMainHTML = () => {
    if (!window.siyuan.user) {
        return debugGetLoginHTML();
    }

    const isIOS = debugIsSimulateIOS();
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

    return `<div id="configAccountMain" class="fn__flex b3-label config-item config-wrap">
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

const getLoginHTML = () => `<div id="configAccountMain" class="b3-label config-item fn__flex-column config-account--login">${genAccountAuthHTML("login")}</div>`;

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
    const isIOS = debugIsSimulateIOS();
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
        debugFocusTwoFactorIfNeeded(accountMainEl as HTMLElement);
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

    const isIOS = debugIsSimulateIOS();
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
                debugClearLoginFormPhase();
                renderAccount(accountSettingsRoot!);
                onSetaccount();
                refreshSyncCloudSpaceGroup(accountSettingsRoot!);
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
    if (!window.siyuan.user || window.siyuan.user.userSiYuanSubscriptionStatus === -1) {
        toolbarVIPEl.innerHTML = window.siyuan.config.account.displayVIP ? genToolbarItemHTML(window.siyuan.languages.freeSub, genVIPIconHTML("ft__error")) : "";
        return;
    }
    const parts: string[] = [];
    if (window.siyuan.config.account.displayVIP) {
        if (window.siyuan.user.userSiYuanProExpireTime === -1) {
            parts.push(genToolbarItemHTML(window.siyuan.languages.account12, Constants.SIYUAN_IMAGE_VIP));
        } else if (window.siyuan.user.userSiYuanProExpireTime > 0) {
            if (window.siyuan.user.userSiYuanSubscriptionPlan === 2) {
                parts.push(genToolbarItemHTML(window.siyuan.languages.account3, genVIPIconHTML()));
            } else {
                parts.push(genToolbarItemHTML(window.siyuan.languages.account10, genVIPIconHTML("ft__secondary")));
            }
        } else if (window.siyuan.user.userSiYuanSubscriptionStatus === 2) {
            parts.push(genToolbarItemHTML(window.siyuan.languages.accountSubscriptionExpired, genVIPIconHTML("ft__error")));
        }
        if (window.siyuan.user.userSiYuanOneTimePayStatus === 1) {
            parts.push(genToolbarItemHTML(window.siyuan.languages.onepay, genVIPIconHTML("ft__success")));
        }
    }
    if (window.siyuan.config.account.displayTitle) {
        window.siyuan.user.userTitles.forEach(item => {
            parts.push(genToolbarItemHTML(`${item.name}：${item.desc}`, item.icon));
        });
    }
    toolbarVIPEl.innerHTML = parts.join("");
    /// #endif
};













// TODO ==================== 临时调试（账号分组） ====================

/** 临时调试：桌面端在账号分组内按 iOS 逻辑渲染付费按钮区（仅 buildAccountMainHTML 读取） */
let debugSimulateIOS = false;
/** 临时调试：未登录预览时的登录表单步骤（`null` 为默认 form1） */
let debugLoginFormPhase: null | "out" | "2fa" = null;
/** 临时调试：切到「未登录」时缓存的 user，用于切回「已登录」或拉取云端后对齐 */
let debugSavedUser: NonNullable<typeof window.siyuan.user> | null = null;
/** 临时调试：勾选「有 userNickname」时写回的昵称（来自当前 user、备份或取消勾选前的值） */
let debugNicknameRestore = "";

// ---------- 调试状态读取 / 写入 ----------

const debugIsSimulateIOS = () => debugSimulateIOS || isInIOS();

const debugClearLoginFormPhase = () => {
    debugLoginFormPhase = null;
};

const debugFocusTwoFactorIfNeeded = (accountMainEl: HTMLElement) => {
    if (debugLoginFormPhase === "2fa") {
        (accountMainEl.querySelector("#twofactorAuthCode") as HTMLInputElement | null)?.focus();
    }
};

// ---------- 调试对账号 HTML 的影响 ----------

/** 未登录登录区 HTML；调试「两步验证码」时直接渲染 form2 可见 */
const debugGetLoginHTML = () => {
    let html = getLoginHTML();
    if (debugLoginFormPhase === "2fa") {
        html = html
            .replace('class="b3-form__space--small" id="form1"', 'class="b3-form__space--small fn__none" id="form1"')
            .replace('class="b3-form__space--small fn__none" id="form2"', 'class="b3-form__space--small" id="form2"');
    }
    return html;
};

// ---------- 调试浮动面板 ----------

/** 临时：全局浮动面板，篡改 window.siyuan.user 等以预览账号分组 UI，用完请删 */
export function debugMountPanel() {
    if (document.getElementById("siyuanDebugPanel")) {
        return;
    }
    const wrap = document.createElement("div");
    wrap.id = "siyuanDebugPanel";
    wrap.setAttribute("data-temp-debug", "panel");
    wrap.style.cssText = "position:fixed;right:6px;bottom:6px;z-index:2147483646;max-width:min(360px,calc(100vw - 12px));font-size:12px;box-shadow:var(--b3-dialog-shadow);border-radius:var(--b3-border-radius);background:var(--b3-theme-background);border:1px solid var(--b3-border-color);";
    wrap.innerHTML = `<div class="fn__flex" style="padding:8px 10px;cursor:pointer;user-select:none;border-bottom:1px solid var(--b3-border-color);" id="siyuanDebugHead">
    <span class="fn__flex-1 ft__on-surface">账号分组调试（临时）</span>
    <span class="ft__secondary" id="siyuanDebugToggle">▲</span>
</div>
<div id="siyuanDebugBody" style="padding:10px;display:block;">
    <div class="ft__smaller ft__secondary" style="margin-bottom:6px;">登录状态</div>
    <select class="b3-select fn__block" id="siyuanDebugLogin" style="margin-bottom:8px;">
        <option value="in">已登录</option>
        <option value="out">未登录</option>
        <option value="2fa">两步验证码</option>
    </select>
    <label class="fn__flex" style="margin-bottom:8px;align-items:center;gap:8px;">
        <span class="fn__flex-1">模拟 iOS 付费区</span>
        <input type="checkbox" id="siyuanDebugIos"/>
    </label>
    <label class="fn__flex" style="margin-bottom:8px;align-items:center;gap:8px;">
        <span class="fn__flex-1">有 userNickname</span>
        <input type="checkbox" id="siyuanDebugNickname"/>
    </label>
    <div class="ft__smaller ft__secondary" style="margin-bottom:6px;">会员场景（需已登录）</div>
    <select class="b3-select fn__block" id="siyuanDebugPreset" style="margin-bottom:8px;">
        <option value="">— 选择预设 —</option>
        <option value="free">未订阅、未买断</option>
        <option value="onetimeOnly">仅买断（无订阅）</option>
        <option value="yearSub">年费订阅中</option>
        <option value="subAndOnetime">同时买断和订阅</option>
        <option value="trialSub">试用订阅中</option>
        <option value="lifetime">终身会员</option>
        <option value="expired">年付订阅已过期</option>
        <option value="trialExpired">试用订阅已过期</option>
    </select>
    <div class="ft__smaller ft__secondary" style="margin-bottom:6px;">头衔</div>
    <select class="b3-select fn__block" id="siyuanDebugTitles" style="margin-bottom:8px;">
        <option value="keep">保持当前</option>
        <option value="none">无头衔</option>
        <option value="one">单个示例头衔</option>
        <option value="two">两个示例头衔</option>
    </select>
    <div class="fn__flex" style="gap:6px;">
        <button type="button" class="b3-button b3-button--outline fn__flex-1 fn__flex-center" id="siyuanDebugReloadUI">刷新界面</button>
        <button type="button" class="b3-button b3-button--text fn__flex-1 fn__flex-center" id="siyuanDebugCloud">重置数据</button>
    </div>
</div>`;
    document.body.appendChild(wrap);
    const body = wrap.querySelector("#siyuanDebugBody") as HTMLElement;
    const head = wrap.querySelector("#siyuanDebugHead") as HTMLElement;
    const toggleMark = wrap.querySelector("#siyuanDebugToggle") as HTMLElement;
    head.addEventListener("click", () => {
        const open = body.style.display !== "none";
        body.style.display = open ? "none" : "block";
        toggleMark.textContent = open ? "▼" : "▲";
    });
    const loginSelect = wrap.querySelector("#siyuanDebugLogin") as HTMLSelectElement;
    const iosInput = wrap.querySelector("#siyuanDebugIos") as HTMLInputElement;
    const nicknameInput = wrap.querySelector("#siyuanDebugNickname") as HTMLInputElement;
    const presetSelect = wrap.querySelector("#siyuanDebugPreset") as HTMLSelectElement;
    const titlesSelect = wrap.querySelector("#siyuanDebugTitles") as HTMLSelectElement;
    if (window.siyuan.user) {
        debugSavedUser = structuredClone(window.siyuan.user);
    }
    debugNicknameRestore = window.siyuan.user?.userNickname?.trim() ?? "";
    loginSelect.value = window.siyuan.user ? "in" : "out";
    iosInput.checked = debugSimulateIOS;
    nicknameInput.checked = !!window.siyuan.user?.userNickname;
    const debugApplyTitles = (mode: string) => {
        const u = window.siyuan.user;
        if (!u || mode === "keep") {
            return;
        }
        if (mode === "none") {
            u.userTitles = [];
        } else if (mode === "one") {
            u.userTitles = [{name: "调试头衔", icon: "🏅", desc: "临时"}];
        } else if (mode === "two") {
            u.userTitles = [
                {name: "头衔 A", icon: "⭐", desc: ""},
                {name: "头衔 B", icon: "🎖️", desc: ""},
            ];
        }
    };
    const debugApplyPreset = (key: string) => {
        const u = window.siyuan.user;
        if (!u || !key) {
            return;
        }
        const now = Date.now();
        const d30 = now + 30 * 86400000;
        switch (key) {
            case "lifetime":
                u.userSiYuanProExpireTime = -1;
                u.userSiYuanSubscriptionStatus = 0;
                u.userSiYuanOneTimePayStatus = 0;
                u.userSiYuanSubscriptionPlan = 0;
                break;
            case "yearSub":
                u.userSiYuanProExpireTime = d30;
                u.userSiYuanSubscriptionPlan = 0;
                u.userSiYuanSubscriptionStatus = 0;
                u.userSiYuanOneTimePayStatus = 0;
                break;
            case "subAndOnetime":
                u.userSiYuanProExpireTime = d30;
                u.userSiYuanSubscriptionPlan = 0;
                u.userSiYuanSubscriptionStatus = 0;
                u.userSiYuanOneTimePayStatus = 1;
                break;
            case "trialSub":
                u.userSiYuanProExpireTime = d30;
                u.userSiYuanSubscriptionPlan = 2;
                u.userSiYuanSubscriptionStatus = 0;
                u.userSiYuanOneTimePayStatus = 0;
                break;
            case "expired":
                u.userSiYuanProExpireTime = 0;
                u.userSiYuanSubscriptionStatus = 2;
                u.userSiYuanOneTimePayStatus = 0;
                u.userSiYuanSubscriptionPlan = 0;
                break;
            case "trialExpired":
                u.userSiYuanProExpireTime = 0;
                u.userSiYuanSubscriptionStatus = 2;
                u.userSiYuanOneTimePayStatus = 0;
                u.userSiYuanSubscriptionPlan = null;
                break;
            case "free":
                u.userSiYuanProExpireTime = 0;
                u.userSiYuanSubscriptionStatus = -1;
                u.userSiYuanOneTimePayStatus = 0;
                break;
            case "onetimeOnly":
                u.userSiYuanProExpireTime = 0;
                u.userSiYuanSubscriptionStatus = -1;
                u.userSiYuanOneTimePayStatus = 1;
                break;
            default:
                break;
        }
    };
    const debugRefreshGroup = () => {
        const accountSettingsRoot = syncTabElement;
        if (!accountSettingsRoot) {
            return;
        }
        renderAccount(accountSettingsRoot);
        onSetaccount();
    };
    const debugApplyLoginFormPhase = () => {
        const accountSettingsRoot = syncTabElement;
        if (!accountSettingsRoot || window.siyuan.user) {
            return;
        }
        const accountMainEl = accountSettingsRoot.querySelector("#configAccountMain.config-account--login");
        if (!accountMainEl) {
            return;
        }
        const form1 = accountMainEl.querySelector("#form1");
        const form2 = accountMainEl.querySelector("#form2");
        if (!form1 || !form2) {
            return;
        }
        if (loginSelect.value === "2fa") {
            form1.classList.add("fn__none");
            form2.classList.remove("fn__none");
        } else {
            form2.classList.add("fn__none");
            form1.classList.remove("fn__none");
        }
    };
    const debugApplyControlsAndRefresh = () => {
        debugSimulateIOS = iosInput.checked;
        const preset = presetSelect.value;
        const titlesMode = titlesSelect.value;
        if (window.siyuan.user) {
            debugApplyPreset(preset);
            debugApplyTitles(titlesMode);
            if (nicknameInput.checked) {
                const nick = debugNicknameRestore
                    || debugSavedUser?.userNickname?.trim()
                    || window.siyuan.user.userNickname?.trim()
                    || "";
                window.siyuan.user.userNickname = nick;
                if (nick) {
                    debugNicknameRestore = nick;
                }
            } else {
                const cur = window.siyuan.user.userNickname?.trim();
                if (cur) {
                    debugNicknameRestore = cur;
                }
                window.siyuan.user.userNickname = "";
            }
            nicknameInput.checked = !!window.siyuan.user.userNickname?.trim();
        } else if (preset || titlesMode !== "keep" || nicknameInput.checked) {
            showMessage("请先登录后再试会员 / 头衔预设", 4000);
        }
        if (!window.siyuan.user) {
            debugLoginFormPhase = loginSelect.value === "2fa" ? "2fa" : "out";
        }
        debugRefreshGroup();
        debugApplyLoginFormPhase();
    };
    const debugFinishLoggedInRefresh = () => {
        debugLoginFormPhase = null;
        loginSelect.value = "in";
        nicknameInput.checked = !!window.siyuan.user?.userNickname;
        if (window.siyuan.user) {
            debugNicknameRestore = window.siyuan.user.userNickname?.trim() ?? "";
        }
        debugRefreshGroup();
        processSync();
        const accountSettingsRoot = syncTabElement;
        if (accountSettingsRoot) {
            refreshSyncCloudSpaceGroup(accountSettingsRoot);
        }
    };
    /** 从已登录切到未登录 / 两步验证码：清空 user 并重绘登录区 */
    const debugApplyLoggedOutPreview = (phase: "out" | "2fa") => {
        if (window.siyuan.user) {
            debugSavedUser = structuredClone(window.siyuan.user);
            window.siyuan.user = null;
        }
        debugLoginFormPhase = phase;
        loginSelect.value = phase;
        debugRefreshGroup();
        processSync();
        const accountSettingsRoot = syncTabElement;
        if (accountSettingsRoot) {
            refreshSyncCloudSpaceGroup(accountSettingsRoot);
        }
        debugApplyLoginFormPhase();
    };
    loginSelect.addEventListener("change", () => {
        const v = loginSelect.value;
        if (v === "in") {
            if (debugSavedUser) {
                window.siyuan.user = structuredClone(debugSavedUser);
                debugFinishLoggedInRefresh();
            } else {
                fetchPost("/api/setting/getCloudUser", {
                    token: "",
                }, (response) => {
                    window.siyuan.user = response.data;
                    if (window.siyuan.user) {
                        debugSavedUser = structuredClone(window.siyuan.user);
                    } else {
                        showMessage("当前无云端登录态，请先正常登录", 4000);
                        loginSelect.value = "out";
                        debugLoginFormPhase = "out";
                    }
                    if (window.siyuan.user) {
                        debugFinishLoggedInRefresh();
                    } else {
                        debugApplyLoggedOutPreview("out");
                    }
                });
            }
        } else if (v === "2fa") {
            debugApplyLoggedOutPreview("2fa");
        } else {
            debugApplyLoggedOutPreview("out");
        }
    });
    iosInput.addEventListener("change", debugApplyControlsAndRefresh);
    nicknameInput.addEventListener("change", debugApplyControlsAndRefresh);
    presetSelect.addEventListener("change", debugApplyControlsAndRefresh);
    titlesSelect.addEventListener("change", debugApplyControlsAndRefresh);
    wrap.querySelector("#siyuanDebugReloadUI")?.addEventListener("click", () => {
        fetchPost("/api/ui/reloadUI", {});
    });
    wrap.querySelector("#siyuanDebugCloud")?.addEventListener("click", () => {
        fetchPost("/api/setting/getCloudUser", {
            token: window.siyuan.user?.userToken || debugSavedUser?.userToken || "",
        }, (response) => {
            window.siyuan.user = response.data;
            debugSimulateIOS = false;
            debugLoginFormPhase = null;
            iosInput.checked = false;
            presetSelect.value = "";
            titlesSelect.value = "keep";
            debugSavedUser = window.siyuan.user ? structuredClone(window.siyuan.user) : null;
            loginSelect.value = window.siyuan.user ? "in" : "out";
            nicknameInput.checked = !!window.siyuan.user?.userNickname;
            debugNicknameRestore = window.siyuan.user?.userNickname?.trim() ?? "";
            debugRefreshGroup();
            processSync();
            const accountSettingsRoot = syncTabElement;
            if (accountSettingsRoot) {
                refreshSyncCloudSpaceGroup(accountSettingsRoot);
            }
            debugApplyLoginFormPhase();
            showMessage(window.siyuan.languages.refreshUser, 3000);
        });
    });
}

