import * as md5 from "blueimp-md5";
import {hideMessage, showMessage} from "../dialog/message";
import {Constants} from "../constants";
import {fetchPost} from "../util/fetch";
import {repos} from "./repos";
import {confirmDialog} from "../dialog/confirmDialog";

export const account = {
    element: undefined as Element,
    genHTML: () => {
        const payHTML = `<a href="https://ld246.com/sponsor" target="_blank" class="b3-chip b3-chip--secondary">
    <svg version='1.1' xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><path fill='#ffe43c' d='M6.4 0h19.2c4.268 0 6.4 2.132 6.4 6.4v19.2c0 4.268-2.132 6.4-6.4 6.4h-19.2c-4.268 0-6.4-2.132-6.4-6.4v-19.2c0-4.268 2.135-6.4 6.4-6.4z'></path> <path fill='#00f5d4' d='M25.6 0h-8.903c-7.762 1.894-14.043 7.579-16.697 15.113v10.487c0 3.533 2.867 6.4 6.4 6.4h19.2c3.533 0 6.4-2.867 6.4-6.4v-19.2c0-3.537-2.863-6.4-6.4-6.4z'></path> <path fill='#01beff' d='M25.6 0h-0.119c-12.739 2.754-20.833 15.316-18.079 28.054 0.293 1.35 0.702 2.667 1.224 3.946h16.974c3.533 0 6.4-2.867 6.4-6.4v-19.2c0-3.537-2.863-6.4-6.4-6.4z'></path> <path fill='#9a5ce5' d='M31.005 2.966c-0.457-0.722-1.060-1.353-1.784-1.849-8.342 3.865-13.683 12.223-13.679 21.416-0.003 3.256 0.67 6.481 1.978 9.463h8.081c0.602 0 1.185-0.084 1.736-0.238-2.1-3.189-3.401-7.624-3.401-12.526 0-7.337 2.921-13.628 7.070-16.266z'></path> <path fill='#f15bb5' d='M32 25.6v-19.2c0-1.234-0.354-2.419-0.998-3.43-4.149 2.638-7.067 8.928-7.067 16.266 0 4.902 1.301 9.334 3.401 12.526 2.693-0.757 4.664-3.231 4.664-6.162z'></path> <path fill='#fff' opacity='0.2' d='M26.972 22.415c-2.889 0.815-4.297 2.21-6.281 3.182 1.552 0.348 3.105 0.461 4.902 0.461 2.644 0 5.363-1.449 6.406-2.519v-1.085c-1.598-0.399-2.664-0.705-5.028-0.039zM4.773 21.612c-0.003 0-0.006-0.003-0.006-0.003-1.726-0.863-3.382-1.205-4.767-1.301v2.487c0.779-0.341 2.396-0.921 4.773-1.182zM17.158 26.599c1.472-0.158 2.57-0.531 3.533-1.002-1.063-0.238-2.126-0.583-3.269-1.079-2.767-1.205-5.63-3.092-10.491-3.034-0.779 0.010-1.495 0.058-2.158 0.132 4.503 2.248 7.882 5.463 12.384 4.983z'></path> <path fill='#fff' opacity='0.2' d='M20.691 25.594c-0.963 0.47-2.061 0.844-3.533 1.002-4.503 0.483-7.882-2.731-12.381-4.983-2.38 0.261-3.994 0.841-4.773 1.179v2.809c0 4.268 2.132 6.4 6.4 6.4h19.197c4.268 0 6.4-2.132 6.4-6.4v-2.065c-1.044 1.069-3.762 2.519-6.406 2.519-1.797 0-3.35-0.113-4.902-0.461z'></path> <path fill='#fff' opacity='0.5' d='M3.479 19.123c0 0.334 0.271 0.606 0.606 0.606s0.606-0.271 0.606-0.606v0c0-0.334-0.271-0.606-0.606-0.606s-0.606 0.271-0.606 0.606v0z'></path> <path fill='#fff' opacity='0.5' d='M29.027 14.266c0 0.334 0.271 0.606 0.606 0.606s0.606-0.271 0.606-0.606v0c0-0.334-0.271-0.606-0.606-0.606s-0.606 0.271-0.606 0.606v0z'></path> <path fill='#fff' d='M9.904 1.688c0 0.167 0.136 0.303 0.303 0.303s0.303-0.136 0.303-0.303v0c0-0.167-0.136-0.303-0.303-0.303s-0.303 0.136-0.303 0.303v0z'></path> <path fill='#fff' d='M2.673 10.468c0 0.167 0.136 0.303 0.303 0.303s0.303-0.136 0.303-0.303v0c0-0.167-0.136-0.303-0.303-0.303s-0.303 0.136-0.303 0.303v0z'></path> <path fill='#fff' opacity='0.6' d='M30.702 9.376c0 0.167 0.136 0.303 0.303 0.303s0.303-0.136 0.303-0.303v0c0-0.167-0.136-0.303-0.303-0.303s-0.303 0.136-0.303 0.303v0z'></path> <path fill='#fff' opacity='0.8' d='M29.236 20.881c0 0.276 0.224 0.499 0.499 0.499s0.499-0.224 0.499-0.499v0c0-0.276-0.224-0.499-0.499-0.499s-0.499 0.224-0.499 0.499v0z'></path> <path fill='#fff' opacity='0.8' d='M15.38 1.591c0.047 0.016 0.101 0.026 0.158 0.026 0.276 0 0.499-0.224 0.499-0.499 0-0.219-0.141-0.406-0.338-0.473l-0.004-0.001c-0.047-0.016-0.101-0.026-0.158-0.026-0.276 0-0.499 0.224-0.499 0.499 0 0.219 0.141 0.406 0.338 0.473l0.004 0.001z'></path> <path fill='#ffdeeb' d='M25.732 8.268c-2.393-2.371-6.249-2.371-8.642 0l-1.089 1.085-1.079-1.089c-2.38-2.39-6.249-2.393-8.639-0.013s-2.393 6.249-0.013 8.639l2.158 2.158 6.474 6.464c0.596 0.593 1.562 0.593 2.158 0l6.474-6.464 2.193-2.158c2.384-2.383 2.384-6.242 0.003-8.622z'></path> <path fill='#fff' d='M17.081 8.268l-1.079 1.085-1.079-1.089c-2.38-2.39-6.249-2.393-8.639-0.013s-2.393 6.249-0.013 8.639l2.158 2.158 2.548 2.487c4.097-1.044 7.627-3.646 9.837-7.254 1.424-2.271 2.284-4.848 2.503-7.518-2.193-0.715-4.606-0.132-6.236 1.504z'></path> </svg>
    ${window.siyuan.languages.sponsor}
</a>
<div class="fn__hr--b"></div>
<a class="b3-button b3-button--outline" style="min-width: 214px" href="https://ld246.com/subscribe/siyuan" target="_blank">
    <span>
        <div class="fn__hr"></div>
        <span class="ft__smaller">${window.siyuan.languages.account4}</span>
        <div class="fn__hr--small"></div>
        <big class="ft__secondary">${window.siyuan.languages.priceAnnual}</big>
        <span class="ft__on-background">/${window.siyuan.languages.year}</span>
        <div class="fn__hr--small"></div>
        <span class="ft__smaller ft__on-surface">${window.siyuan.languages.account1}</span>
        <div class="fn__hr"></div>
    </span>
</a>
<div class="fn__hr--b"></div>
${window.siyuan.languages.account2}
<div><a href="https://b3log.org/siyuan/pricing.html" target="_blank">${window.siyuan.languages.account7}</a></div>
<div class="fn__hr--b"></div>
<span class="b3-chip b3-chip--primary fn__pointer" id="trialSub">
    <svg class="ft__secondary"><use xlink:href="#iconVIP"></use></svg>
    ${window.siyuan.languages.freeSub}
</>
<div class="fn__hr--b"></div>`;
        if (window.siyuan.user) {
            let userTitlesHTML = "";
            if (window.siyuan.user.userTitles.length > 0) {
                userTitlesHTML = '<div class="fn__hr--b"></div><div class="fn__flex" style="position: absolute"><span class="fn__space"></span>';
                window.siyuan.user.userTitles.forEach((item) => {
                    userTitlesHTML += `<div class="b3-chip">${item.icon} ${item.name}</div><span class="fn__space"></span>`;
                });
                userTitlesHTML += "</div>";
            }
            let subscriptionHTML = payHTML;
            let activeSubscriptionHTML = `<div class="fn__hr"></div>
<div class="b3-form__icon fn__block">
   <svg class="ft__secondary b3-form__icon-icon"><use xlink:href="#iconVIP"></use></svg>
   <input class="b3-text-field fn__block b3-form__icon-input" style="padding-right: 44px;" placeholder="${window.siyuan.languages.activationCodePlaceholder}">
   <button id="activationCode" class="b3-button b3-button--cancel" style="position: absolute;right: 0;top: 1px;">${window.siyuan.languages.confirm}</button>
</div>`;
            if (window.siyuan.user.userSiYuanProExpireTime === -1) {
                activeSubscriptionHTML = "";
                subscriptionHTML = `<div class="b3-chip b3-chip--secondary">${Constants.SIYUAN_IMAGE_VIP}${window.siyuan.languages.account12}</div>`;
            } else if (window.siyuan.user.userSiYuanProExpireTime > 0) {
                subscriptionHTML = `<div class="b3-chip b3-chip--primary"><svg class="ft__secondary"><use xlink:href="#iconVIP"></use></svg>${window.siyuan.languages.account10}</div><div class="fn__hr"></div>
<div class="ft__on-surface ft__smaller">${window.siyuan.languages.account6} ${Math.floor((window.siyuan.user.userSiYuanProExpireTime - new Date().getTime()) / 1000 / 60 / 60 / 24)} ${window.siyuan.languages.day} ${window.siyuan.languages.clickMeToRenew}</div>`;
            }
            return `<div class="fn__flex config-account">
<div class="config-account__center">
    <div class="config-account__bg">
        <div class="config-account__cover" style="background-image: url(${window.siyuan.user.userHomeBImgURL})"></div>
        <a href="https://ld246.com/settings/avatar" class="config-account__avatar" style="background-image: url(${window.siyuan.user.userAvatarURL})" target="_blank"></a>
        <h1 class="config-account__name">
            <a target="_blank" class="fn__a" href="https://ld246.com/member/${window.siyuan.user.userName}">${window.siyuan.user.userName}</a>
        </h1>
        ${userTitlesHTML}
    </div>
    <div class="config-account__info">
        <div class="fn__flex">
            <a class="b3-button b3-button--text" href="https://ld246.com/settings" target="_blank">${window.siyuan.languages.accountManage}</a>
            <span class="fn__space"></span>
            <button class="b3-button b3-button--cancel" id="logout">
                ${window.siyuan.languages.logout}
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
    <div class="fn__flex fn__block" style="line-height: 1.625">
        <div class="fn__flex-1"></div>
        <span class="ft__on-surface">${window.siyuan.languages.payment}</span>
        <span class="fn__space"></span>
        <span>${window.siyuan.user.userPaymentSum} RMB</span>
    </div>
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
            <a href="https://ld246.com/forget-pwd" class="b3-button b3-button--cancel" target="_blank">${window.siyuan.languages.forgetPassword}</a>
            <span class="fn__space${window.siyuan.config.system.container === "ios" ? " fn__none" : ""}"></span>
            <a href="https://ld246.com/register" class="b3-button b3-button--cancel${window.siyuan.config.system.container === "ios" ? " fn__none" : ""}" target="_blank">${window.siyuan.languages.register}</a>
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
        <div class="fn__hr--b"></div><div class="fn__hr--b"></div>
    </div>
</div>
</div>`;
    },
    bindEvent: () => {
        const trialSubElement = account.element.querySelector("#trialSub");
        if (trialSubElement) {
            trialSubElement.addEventListener("click", () => {
                fetchPost("/api/account/startFreeTrial", {}, () => {
                    account.element.querySelector("#refresh").dispatchEvent(new Event("click"));
                });
            });
        }
        const agreeLoginElement = account.element.querySelector("#agreeLogin") as HTMLInputElement;
        const userNameElement = account.element.querySelector("#userName") as HTMLInputElement;
        if (!userNameElement) {
            const refreshElement = account.element.querySelector("#refresh");
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
                    account.element.innerHTML = account.genHTML();
                    account.bindEvent();
                    showMessage(window.siyuan.languages.refreshUser, 3000);
                    account.onSetaccount();
                });
            });
            account.element.querySelector("#logout").addEventListener("click", () => {
                fetchPost("/api/setting/logoutCloudUser", {}, () => {
                    fetchPost("/api/setting/getCloudUser", {}, response => {
                        window.siyuan.user = response.data;
                        account.element.innerHTML = account.genHTML();
                        account.bindEvent();
                        account.onSetaccount();
                    });
                });
            });
            account.element.querySelectorAll("input[type='checkbox']").forEach(item => {
                item.addEventListener("change", () => {
                    fetchPost("/api/setting/setAccount", {
                        displayTitle: (account.element.querySelector("#displayTitle") as HTMLInputElement).checked,
                        displayVIP: (account.element.querySelector("#displayVIP") as HTMLInputElement).checked,
                    }, (response) => {
                        window.siyuan.config.account.displayTitle = response.data.displayTitle;
                        window.siyuan.config.account.displayVIP = response.data.displayVIP;
                        account.onSetaccount();
                    });
                });
            });
            const activationCodeElement = account.element.querySelector("#activationCode");
            activationCodeElement.addEventListener("click", () => {
                fetchPost("/api/account/checkActivationcode", {data: (activationCodeElement.previousElementSibling as HTMLInputElement).value}, (response) => {
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

        const userPasswordElement = account.element.querySelector("#userPassword") as HTMLInputElement;
        const captchaImgElement = account.element.querySelector("#captchaImg") as HTMLInputElement;
        const captchaElement = account.element.querySelector("#captcha") as HTMLInputElement;
        const twofactorAuthCodeElement = account.element.querySelector("#twofactorAuthCode") as HTMLInputElement;
        const loginBtnElement = account.element.querySelector("#login") as HTMLButtonElement;
        const login2BtnElement = account.element.querySelector("#login2") as HTMLButtonElement;
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
        loginBtnElement.addEventListener("click", () => {
            fetchPost("/api/account/login", {
                userName: userNameElement.value.replace(/(^\s*)|(\s*$)/g, ""),
                userPassword: md5(userPasswordElement.value),
                captcha: captchaElement.value.replace(/(^\s*)|(\s*$)/g, ""),
            }, (data) => {
                if (data.code === 1) {
                    showMessage(data.msg);
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
                    account.element.querySelector("#form1").classList.add("fn__none");
                    account.element.querySelector("#form2").classList.remove("fn__none");
                    twofactorAuthCodeElement.focus();
                    token = data.data.token;
                    return;
                }
                hideMessage();
                fetchPost("/api/setting/getCloudUser", {
                    token: data.data.token,
                }, response => {
                    window.siyuan.user = response.data;
                    account.element.innerHTML = account.genHTML();
                    account.bindEvent();
                    account.onSetaccount();
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
                    window.siyuan.user = userResponse.data;
                    account.element.innerHTML = account.genHTML();
                    account.bindEvent();
                    account.onSetaccount();
                });
            });
        });
    },
    onSetaccount() {
        let html = "";
        if (window.siyuan.config.account.displayVIP && window.siyuan.user) {
            if (window.siyuan.user.userSiYuanProExpireTime === -1) {
                html = `<div class="toolbar__item b3-tooltips b3-tooltips__se" aria-label="${window.siyuan.languages.account12}">${Constants.SIYUAN_IMAGE_VIP}</div>`;
            } else if (window.siyuan.user.userSiYuanProExpireTime > 0) {
                html = `<div class="toolbar__item b3-tooltips b3-tooltips__se" aria-label="${window.siyuan.languages.account10}"><svg class="ft__secondary"><use xlink:href="#iconVIP"></use></svg></div>`;
            }
        }
        if (window.siyuan.config.account.displayTitle && window.siyuan.user) {
            window.siyuan.user.userTitles.forEach(item => {
                html += `<div class="toolbar__item fn__a b3-tooltips b3-tooltips__se" aria-label="${item.name}：${item.desc}">${item.icon}</div>`;
            });
        }
        document.getElementById("toolbarVIP").innerHTML = html;
        if (repos.element) {
            repos.element.innerHTML = "";
        }
    }
};
