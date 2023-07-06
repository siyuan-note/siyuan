import * as md5 from "blueimp-md5";
import {hideMessage, showMessage} from "../dialog/message";
import {Constants} from "../constants";
import {fetchPost} from "../util/fetch";
import {repos} from "./repos";
import {confirmDialog} from "../dialog/confirmDialog";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {getEventName} from "../protyle/util/compatibility";
import {processSync} from "../dialog/processSystem";
import {needSubscribe} from "../util/needSubscribe";
import {syncGuide} from "../sync/syncGuide";
import {hideElements} from "../protyle/ui/hideElements";
import {getCloudURL} from "./util/about";

export const account = {
    element: undefined as Element,
    genHTML: (onlyPayHTML = false) => {
        const payHTML = `<div>${window.siyuan.languages.account2}</div>
<div class="fn__hr--b"></div>
<a class="b3-button b3-button--big" href="${getCloudURL("subscribe/siyuan")}" target="_blank">
    <svg><use xlink:href="#iconVIP"></use></svg>${window.siyuan.languages.account1}
</a>
<div class="fn__hr--b"></div>
<span class="b3-chip b3-chip--primary b3-chip--hover${(window.siyuan.user && window.siyuan.user.userSiYuanSubscriptionStatus === 2) ? " fn__none" : ""}" id="trialSub">
    <svg class="ft__secondary"><use xlink:href="#iconVIP"></use></svg>
    ${window.siyuan.languages.freeSub}
</span>
<div class="fn__hr${(window.siyuan.user && window.siyuan.user.userSiYuanSubscriptionStatus === 2) ? " fn__none" : ""}"></div>
<a href="${getCloudURL("sponsor")}" target="_blank" class="b3-chip b3-chip--pink b3-chip--hover">
    <svg version='1.1' xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><path fill='#ffe43c' d='M6.4 0h19.2c4.268 0 6.4 2.132 6.4 6.4v19.2c0 4.268-2.132 6.4-6.4 6.4h-19.2c-4.268 0-6.4-2.132-6.4-6.4v-19.2c0-4.268 2.135-6.4 6.4-6.4z'></path> <path fill='#00f5d4' d='M25.6 0h-8.903c-7.762 1.894-14.043 7.579-16.697 15.113v10.487c0 3.533 2.867 6.4 6.4 6.4h19.2c3.533 0 6.4-2.867 6.4-6.4v-19.2c0-3.537-2.863-6.4-6.4-6.4z'></path> <path fill='#01beff' d='M25.6 0h-0.119c-12.739 2.754-20.833 15.316-18.079 28.054 0.293 1.35 0.702 2.667 1.224 3.946h16.974c3.533 0 6.4-2.867 6.4-6.4v-19.2c0-3.537-2.863-6.4-6.4-6.4z'></path> <path fill='#9a5ce5' d='M31.005 2.966c-0.457-0.722-1.060-1.353-1.784-1.849-8.342 3.865-13.683 12.223-13.679 21.416-0.003 3.256 0.67 6.481 1.978 9.463h8.081c0.602 0 1.185-0.084 1.736-0.238-2.1-3.189-3.401-7.624-3.401-12.526 0-7.337 2.921-13.628 7.070-16.266z'></path> <path fill='#f15bb5' d='M32 25.6v-19.2c0-1.234-0.354-2.419-0.998-3.43-4.149 2.638-7.067 8.928-7.067 16.266 0 4.902 1.301 9.334 3.401 12.526 2.693-0.757 4.664-3.231 4.664-6.162z'></path> <path fill='#fff' opacity='0.2' d='M26.972 22.415c-2.889 0.815-4.297 2.21-6.281 3.182 1.552 0.348 3.105 0.461 4.902 0.461 2.644 0 5.363-1.449 6.406-2.519v-1.085c-1.598-0.399-2.664-0.705-5.028-0.039zM4.773 21.612c-0.003 0-0.006-0.003-0.006-0.003-1.726-0.863-3.382-1.205-4.767-1.301v2.487c0.779-0.341 2.396-0.921 4.773-1.182zM17.158 26.599c1.472-0.158 2.57-0.531 3.533-1.002-1.063-0.238-2.126-0.583-3.269-1.079-2.767-1.205-5.63-3.092-10.491-3.034-0.779 0.010-1.495 0.058-2.158 0.132 4.503 2.248 7.882 5.463 12.384 4.983z'></path> <path fill='#fff' opacity='0.2' d='M20.691 25.594c-0.963 0.47-2.061 0.844-3.533 1.002-4.503 0.483-7.882-2.731-12.381-4.983-2.38 0.261-3.994 0.841-4.773 1.179v2.809c0 4.268 2.132 6.4 6.4 6.4h19.197c4.268 0 6.4-2.132 6.4-6.4v-2.065c-1.044 1.069-3.762 2.519-6.406 2.519-1.797 0-3.35-0.113-4.902-0.461z'></path> <path fill='#fff' opacity='0.5' d='M3.479 19.123c0 0.334 0.271 0.606 0.606 0.606s0.606-0.271 0.606-0.606v0c0-0.334-0.271-0.606-0.606-0.606s-0.606 0.271-0.606 0.606v0z'></path> <path fill='#fff' opacity='0.5' d='M29.027 14.266c0 0.334 0.271 0.606 0.606 0.606s0.606-0.271 0.606-0.606v0c0-0.334-0.271-0.606-0.606-0.606s-0.606 0.271-0.606 0.606v0z'></path> <path fill='#fff' d='M9.904 1.688c0 0.167 0.136 0.303 0.303 0.303s0.303-0.136 0.303-0.303v0c0-0.167-0.136-0.303-0.303-0.303s-0.303 0.136-0.303 0.303v0z'></path> <path fill='#fff' d='M2.673 10.468c0 0.167 0.136 0.303 0.303 0.303s0.303-0.136 0.303-0.303v0c0-0.167-0.136-0.303-0.303-0.303s-0.303 0.136-0.303 0.303v0z'></path> <path fill='#fff' opacity='0.6' d='M30.702 9.376c0 0.167 0.136 0.303 0.303 0.303s0.303-0.136 0.303-0.303v0c0-0.167-0.136-0.303-0.303-0.303s-0.303 0.136-0.303 0.303v0z'></path> <path fill='#fff' opacity='0.8' d='M29.236 20.881c0 0.276 0.224 0.499 0.499 0.499s0.499-0.224 0.499-0.499v0c0-0.276-0.224-0.499-0.499-0.499s-0.499 0.224-0.499 0.499v0z'></path> <path fill='#fff' opacity='0.8' d='M15.38 1.591c0.047 0.016 0.101 0.026 0.158 0.026 0.276 0 0.499-0.224 0.499-0.499 0-0.219-0.141-0.406-0.338-0.473l-0.004-0.001c-0.047-0.016-0.101-0.026-0.158-0.026-0.276 0-0.499 0.224-0.499 0.499 0 0.219 0.141 0.406 0.338 0.473l0.004 0.001z'></path> <path fill='#ffdeeb' d='M25.732 8.268c-2.393-2.371-6.249-2.371-8.642 0l-1.089 1.085-1.079-1.089c-2.38-2.39-6.249-2.393-8.639-0.013s-2.393 6.249-0.013 8.639l2.158 2.158 6.474 6.464c0.596 0.593 1.562 0.593 2.158 0l6.474-6.464 2.193-2.158c2.384-2.383 2.384-6.242 0.003-8.622z'></path> <path fill='#fff' d='M17.081 8.268l-1.079 1.085-1.079-1.089c-2.38-2.39-6.249-2.393-8.639-0.013s-2.393 6.249-0.013 8.639l2.158 2.158 2.548 2.487c4.097-1.044 7.627-3.646 9.837-7.254 1.424-2.271 2.284-4.848 2.503-7.518-2.193-0.715-4.606-0.132-6.236 1.504z'></path> </svg>
    ${window.siyuan.languages.sponsor}
</a>`;
        if (onlyPayHTML) {
            return `<div class="ft__center">${payHTML}</div>`;
        }
        if (window.siyuan.user) {
            let userTitlesHTML = "";
            if (window.siyuan.user.userTitles.length > 0) {
                userTitlesHTML = '<div class="b3-chips" style="position: absolute">';
                window.siyuan.user.userTitles.forEach((item) => {
                    userTitlesHTML += `<div class="b3-chip b3-chip--middle">${item.icon} ${item.name}</div>`;
                });
                userTitlesHTML += "</div>";
            }
            let subscriptionHTML = payHTML;
            let activeSubscriptionHTML = `<div class="b3-form__icon fn__block">
   <svg class="ft__secondary b3-form__icon-icon"><use xlink:href="#iconVIP"></use></svg>
   <input class="b3-text-field fn__block b3-form__icon-input" style="padding-right: 44px;" placeholder="${window.siyuan.languages.activationCodePlaceholder}">
   <button id="activationCode" class="b3-button b3-button--text" style="position: absolute;right: 0;top: 0;">${window.siyuan.languages.confirm}</button>
</div>`;
            if (window.siyuan.user.userSiYuanProExpireTime === -1) {
                activeSubscriptionHTML = "";
                subscriptionHTML = `<div class="b3-chip b3-chip--secondary">${Constants.SIYUAN_IMAGE_VIP}${window.siyuan.languages.account12}</div>`;
            } else if (window.siyuan.user.userSiYuanProExpireTime > 0) {
                const renewHTML = `<div class="fn__hr--b"></div>
<div class="ft__on-surface ft__smaller">
    ${window.siyuan.languages.account6} 
    ${Math.max(0, Math.floor((window.siyuan.user.userSiYuanProExpireTime - new Date().getTime()) / 1000 / 60 / 60 / 24))} 
    ${window.siyuan.languages.day} 
    <a href="${getCloudURL("subscribe/siyuan")}" target="_blank">${window.siyuan.languages.clickMeToRenew}</a>
</div>`;
                if (window.siyuan.user.userSiYuanSubscriptionPlan === 2) {
                    subscriptionHTML = `<div class="b3-chip b3-chip--primary"><svg><use xlink:href="#iconVIP"></use></svg>${window.siyuan.languages.account3}</div>
${renewHTML}
<div class="fn__hr--b"></div>
`;
                } else {
                    subscriptionHTML = `<div class="b3-chip b3-chip--primary"><svg class="ft__secondary"><use xlink:href="#iconVIP"></use></svg>${window.siyuan.languages.account10}</div>${renewHTML}`;
                }
            }
            return `<div class="fn__flex config-account">
<div class="config-account__center">
    <div class="config-account__bg">
        <div class="config-account__cover" style="background-image: url(${window.siyuan.user.userHomeBImgURL})"></div>
        <a href="${getCloudURL("settings/avatar")}" class="config-account__avatar" style="background-image: url(${window.siyuan.user.userAvatarURL})" target="_blank"></a>
        <h1 class="config-account__name">
            <a target="_blank" class="fn__a" href="${getCloudURL("member/" + window.siyuan.user.userName)}">${window.siyuan.user.userName}</a>
            <span class="ft__on-surface ft__smaller">${0 === window.siyuan.config.cloudRegion ? "ld246.com" : "liuyun.io"}</span>
        </h1>
        ${userTitlesHTML}
    </div>
    <div class="config-account__info">
        <div class="fn__flex">
            <a class="b3-button b3-button--text" href="${getCloudURL("settings")}" target="_blank">${window.siyuan.languages.manage}</a>
            <span class="fn__space"></span>
            <button class="b3-button b3-button--cancel" id="logout">
                ${window.siyuan.languages.logout}
            </button>
            <span class="fn__space"></span>
            <button class="b3-button b3-button--cancel${window.siyuan.config.system.container === "ios" ? "" : " fn__none"}" id="deactivateUser">
                ${window.siyuan.languages.deactivateUser}
            </button>
            <span class="fn__flex-1"></span>
            <button class="b3-button b3-button--cancel b3-tooltips b3-tooltips__n" id="refresh" aria-label="${window.siyuan.languages.refresh}">
                <svg><use xlink:href="#iconRefresh"></use></svg>
            </button>
        </div>
        <div class="fn__hr--b"></div>
        <div class="fn__flex">
            <label>
                ${window.siyuan.languages.accountDisplayTitle}
                <input class="b3-switch fn__flex-center" id="displayTitle" type="checkbox"${window.siyuan.config.account.displayTitle ? " checked" : ""}/>
            </label>
            <div class="fn__flex-1"></div>
            <label>
                ${window.siyuan.languages.accountDisplayVIP}
                <input class="b3-switch fn__flex-center" id="displayVIP" type="checkbox"${window.siyuan.config.account.displayVIP ? " checked" : ""}/>
            </label>
        </div>
    </div>
</div>
<div class="config-account__center config-account__center--text${window.siyuan.config.system.container === "ios" ? " fn__none" : ""}">
    <div class="fn__flex-1 fn__hr"></div>
    <div class="ft__center">${subscriptionHTML}</div>
    <div class="fn__flex-1 fn__hr"></div>
    ${activeSubscriptionHTML}
</div></div>`;
        }
        return `<div class="fn__flex config-account">
<div class="b3-form__space config-account__center">
    <div class="config-account__form" id="form1">
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
        <div class="b3-form__icon">
            <svg class="b3-form__icon-icon"><use xlink:href="#iconFocus"></use></svg>
            <select class="b3-select b3-form__icon-input fn__block" id="cloudRegion">
                <option value="0"${window.siyuan.config.cloudRegion === 0 ? " selected" : ""}>${window.siyuan.languages.cloudRegionChina}</option>
                <option value="1"${window.siyuan.config.cloudRegion === 1 ? " selected" : ""}>${window.siyuan.languages.cloudRegionNorthAmerica}</option>
            </select>
        </div>
        <div class="b3-form__img fn__none">
            <div class="fn__hr--b"></div>
            <img id="captchaImg" class="fn__pointer" style="top: 17px">
            <input id="captcha" class="b3-text-field fn__block" placeholder="${window.siyuan.languages.captcha}">
        </div>
        <div class="fn__hr--b"></div>
        <label class="ft__smaller ft__on-surface fn__flex">
            <span class="fn__space"></span>
            <input type="checkbox" class="b3-switch fn__flex-center" id="agreeLogin">
            <span class="fn__space"></span>
            <span>${window.siyuan.languages.accountTip}</span>
        </label>
        <div class="fn__hr--b"></div>
        <button id="login" disabled class="b3-button fn__block">${window.siyuan.languages.login}</button>
        <div class="fn__hr--b"></div>
        <div class="ft__center">
            <a href="${getCloudURL("forget-pwd")}" class="b3-button b3-button--cancel" target="_blank">${window.siyuan.languages.forgetPassword}</a>
            <span class="fn__space${window.siyuan.config.system.container === "ios" ? " fn__none" : ""}"></span>
            <a href="${getCloudURL("register")}" class="b3-button b3-button--cancel${window.siyuan.config.system.container === "ios" ? " fn__none" : ""}" target="_blank">${window.siyuan.languages.register}</a>
        </div>
    </div>
    <div class="fn__none config-account__form" id="form2">
        <div class="b3-form__icon">
            <svg class="b3-form__icon-icon"><use xlink:href="#iconLock"></use></svg>
            <input id="twofactorAuthCode" class="b3-text-field fn__block b3-form__icon-input" placeholder="${window.siyuan.languages.twoFactorCaptcha}">
        </div>
        <div class="fn__hr--b"></div>
        <button id="login2" class="b3-button fn__block">${window.siyuan.languages.login}</button>
    </div>
</div>
<div class="config-account__center config-account__center--text${window.siyuan.config.system.container === "ios" ? " fn__none" : ""}">
    <div class="ft__center">
        ${payHTML}
    </div>
</div>
</div>`;
    },
    bindEvent: (element: Element) => {
        const trialSubElement = element.querySelector("#trialSub");
        if (trialSubElement) {
            trialSubElement.addEventListener("click", () => {
                fetchPost("/api/account/startFreeTrial", {}, () => {
                    element.querySelector("#refresh").dispatchEvent(new Event("click"));
                });
            });
        }
        const agreeLoginElement = element.querySelector("#agreeLogin") as HTMLInputElement;
        const userNameElement = element.querySelector("#userName") as HTMLInputElement;
        if (!userNameElement) {
            const refreshElement = element.querySelector("#refresh");
            refreshElement.addEventListener("click", () => {
                const svgElement = refreshElement.firstElementChild;
                if (svgElement.classList.contains("fn__rotate")) {
                    return;
                }
                svgElement.classList.add("fn__rotate");
                fetchPost("/api/setting/getCloudUser", {
                    token: window.siyuan.user.userToken,
                }, response => {
                    window.siyuan.user = response.data;
                    element.innerHTML = account.genHTML();
                    account.bindEvent(element);
                    showMessage(window.siyuan.languages.refreshUser, 3000);
                    account.onSetaccount();
                    processSync();
                });
            });
            element.querySelector("#logout").addEventListener("click", () => {
                fetchPost("/api/setting/logoutCloudUser", {}, () => {
                    fetchPost("/api/setting/getCloudUser", {}, response => {
                        window.siyuan.user = response.data;
                        element.innerHTML = account.genHTML();
                        account.bindEvent(element);
                        account.onSetaccount();
                        processSync();
                    });
                });
            });
            element.querySelector("#deactivateUser").addEventListener(getEventName(), () => {
                confirmDialog("⚠️ " + window.siyuan.languages.deactivateUser, window.siyuan.languages.deactivateUserTip, () => {
                    fetchPost("/api/account/deactivate", {}, () => {
                        window.siyuan.user = null;
                        element.innerHTML = account.genHTML();
                        account.bindEvent(element);
                        account.onSetaccount();
                        processSync();
                    });
                });
            });
            element.querySelectorAll("input[type='checkbox']").forEach(item => {
                item.addEventListener("change", () => {
                    fetchPost("/api/setting/setAccount", {
                        displayTitle: (element.querySelector("#displayTitle") as HTMLInputElement).checked,
                        displayVIP: (element.querySelector("#displayVIP") as HTMLInputElement).checked,
                    }, (response) => {
                        window.siyuan.config.account.displayTitle = response.data.displayTitle;
                        window.siyuan.config.account.displayVIP = response.data.displayVIP;
                        account.onSetaccount();
                    });
                });
            });
            const activationCodeElement = element.querySelector("#activationCode");
            activationCodeElement.addEventListener("click", () => {
                const activationCodeInput = (activationCodeElement.previousElementSibling as HTMLInputElement);
                fetchPost("/api/account/checkActivationcode", {data: activationCodeInput.value}, (response) => {
                    if (0 !== response.code) {
                        activationCodeInput.value = "";
                    }
                    confirmDialog(window.siyuan.languages.activationCode, response.msg, () => {
                        if (response.code === 0) {
                            fetchPost("/api/account/useActivationcode", {data: (activationCodeElement.previousElementSibling as HTMLInputElement).value}, () => {
                                refreshElement.dispatchEvent(new CustomEvent("click"));
                            });
                        }
                    });
                });
            });
            return;
        }

        const userPasswordElement = element.querySelector("#userPassword") as HTMLInputElement;
        const captchaImgElement = element.querySelector("#captchaImg") as HTMLInputElement;
        const captchaElement = element.querySelector("#captcha") as HTMLInputElement;
        const twofactorAuthCodeElement = element.querySelector("#twofactorAuthCode") as HTMLInputElement;
        const loginBtnElement = element.querySelector("#login") as HTMLButtonElement;
        const login2BtnElement = element.querySelector("#login2") as HTMLButtonElement;
        agreeLoginElement.addEventListener("click", () => {
            if (agreeLoginElement.checked) {
                loginBtnElement.removeAttribute("disabled");
            } else {
                loginBtnElement.setAttribute("disabled", "disabled");
            }
        });
        userNameElement.focus();
        userNameElement.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                event.preventDefault();
                return;
            }
            if (event.key === "Enter") {
                loginBtnElement.click();
                event.preventDefault();
            }
        });

        twofactorAuthCodeElement.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                event.preventDefault();
                return;
            }
            if (event.key === "Enter") {
                login2BtnElement.click();
                event.preventDefault();
            }
        });

        captchaElement.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                event.preventDefault();
                return;
            }
            if (event.key === "Enter") {
                loginBtnElement.click();
                event.preventDefault();
            }
        });
        userPasswordElement.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                event.preventDefault();
                return;
            }
            if (event.key === "Enter") {
                loginBtnElement.click();
                event.preventDefault();
            }
        });
        let token: string;
        let needCaptcha: string;
        captchaImgElement.addEventListener("click", () => {
            captchaImgElement.setAttribute("src", `https://ld246.com/captcha/login?needCaptcha=${needCaptcha}&t=${new Date().getTime()}`);
        });

        const cloudRegionElement = element.querySelector("#cloudRegion") as HTMLSelectElement;
        cloudRegionElement.addEventListener("change", () => {
            window.siyuan.config.cloudRegion = parseInt(cloudRegionElement.value);
            element.querySelector(".config-account__center--text").innerHTML = account.genHTML(true);
            element.querySelector("#form1").lastElementChild.innerHTML = `<a href="${getCloudURL("forget-pwd")}" class="b3-button b3-button--cancel" target="_blank">${window.siyuan.languages.forgetPassword}</a>
<span class="fn__space${window.siyuan.config.system.container === "ios" ? " fn__none" : ""}"></span>
<a href="${getCloudURL("register")}" class="b3-button b3-button--cancel${window.siyuan.config.system.container === "ios" ? " fn__none" : ""}" target="_blank">${window.siyuan.languages.register}</a>`;
        });
        loginBtnElement.addEventListener("click", () => {
            fetchPost("/api/account/login", {
                userName: userNameElement.value.replace(/(^\s*)|(\s*$)/g, ""),
                userPassword: md5(userPasswordElement.value),
                captcha: captchaElement.value.replace(/(^\s*)|(\s*$)/g, ""),
                cloudRegion: window.siyuan.config.cloudRegion,
            }, (data) => {
                let messageId;
                if (data.code === 1) {
                    messageId = showMessage(data.msg);
                    if (data.data.needCaptcha) {
                        // 验证码
                        needCaptcha = data.data.needCaptcha;
                        captchaElement.parentElement.classList.remove("fn__none");
                        captchaElement.previousElementSibling.setAttribute("src",
                            `https://ld246.com/captcha/login?needCaptcha=${data.data.needCaptcha}`);
                        captchaElement.value = "";
                        return;
                    }
                    return;
                }
                if (data.code === 10) {
                    // 两步验证
                    element.querySelector("#form1").classList.add("fn__none");
                    element.querySelector("#form2").classList.remove("fn__none");
                    twofactorAuthCodeElement.focus();
                    token = data.data.token;
                    return;
                }
                hideMessage(messageId);
                fetchPost("/api/setting/getCloudUser", {
                    token: data.data.token,
                }, response => {
                    account._afterLogin(response, element);
                });
            });
        });

        login2BtnElement.addEventListener("click", () => {
            fetchPost("/api/setting/login2faCloudUser", {
                code: twofactorAuthCodeElement.value,
                token,
            }, response => {
                fetchPost("/api/setting/getCloudUser", {
                    token: response.data.token,
                }, userResponse => {
                    account._afterLogin(userResponse, element);
                });
            });
        });
    },
    _afterLogin(userResponse: IWebSocketData, element: Element) {
        window.siyuan.user = userResponse.data;
        processSync();
        element.innerHTML = account.genHTML();
        account.bindEvent(element);
        account.onSetaccount();
        if (element.getAttribute("data-action") === "go-repos") {
            if (needSubscribe()) {
                const dialogElement = hasClosestByClassName(element, "b3-dialog--open");
                if (dialogElement) {
                    dialogElement.querySelector('.b3-tab-bar [data-name="repos"]').dispatchEvent(new CustomEvent("click"));
                    element.removeAttribute("data-action");
                }
            } else {
                hideElements(["dialog"]);
                syncGuide();
            }
        }
    },
    onSetaccount() {
        if (repos.element) {
            repos.element.innerHTML = "";
        }
        if (window.siyuan.config.system.container === "ios") {
            return;
        }
        let html = "";
        if (window.siyuan.config.account.displayVIP && window.siyuan.user) {
            if (window.siyuan.user.userSiYuanProExpireTime === -1) {
                html = `<div class="toolbar__item b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.account12}">${Constants.SIYUAN_IMAGE_VIP}</div>`;
            } else if (window.siyuan.user.userSiYuanProExpireTime > 0) {
                if (window.siyuan.user.userSiYuanSubscriptionPlan === 2) {
                    html = `<div class="toolbar__item b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.account3}"><svg><use xlink:href="#iconVIP"></use></svg></div>`;
                } else {
                    html = `<div class="toolbar__item b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.account10}"><svg class="ft__secondary"><use xlink:href="#iconVIP"></use></svg></div>`;
                }
            }
        }
        if (!window.siyuan.user || (window.siyuan.user && window.siyuan.user.userSiYuanSubscriptionStatus === -1)) {
            html = `<div class="toolbar__item b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.freeSub}"><svg class="ft__error"><use xlink:href="#iconVIP"></use></svg></div>`;
        }
        if (window.siyuan.config.account.displayTitle && window.siyuan.user) {
            window.siyuan.user.userTitles.forEach(item => {
                html += `<div class="toolbar__item b3-tooltips b3-tooltips__sw" aria-label="${item.name}：${item.desc}">${item.icon}</div>`;
            });
        }
        document.getElementById("toolbarVIP").innerHTML = html;
    }
};
