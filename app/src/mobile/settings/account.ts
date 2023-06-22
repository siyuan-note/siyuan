import {openModel} from "../menu/model";
import {getEventName} from "../../protyle/util/compatibility";
import {fetchPost} from "../../util/fetch";
import {closePanel} from "../util/closePanel";
import {processSync} from "../../dialog/processSystem";
import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import md5 from "blueimp-md5";
import {getCloudURL} from "../../config/util/about";

export const showAccountInfo = () => {
    let userTitlesHTML = "";
    if (window.siyuan.user.userTitles.length > 0) {
        userTitlesHTML = '<div class="b3-chips" style="position: absolute">';
        window.siyuan.user.userTitles.forEach((item) => {
            userTitlesHTML += `<div class="b3-chip b3-chip--middle">${item.icon} ${item.name}</div>`;
        });
        userTitlesHTML += "</div>";
    }
    openModel({
        title: window.siyuan.languages.accountManage,
        icon: "iconAccount",
        html: `<div class="fn__flex-column">
<div class="config-account__bg">
    <div class="config-account__cover" style="background-image: url(${window.siyuan.user.userHomeBImgURL})"></div>
    <a href="${getCloudURL("settings/avatar")}" class="config-account__avatar" style="background-image: url(${window.siyuan.user.userAvatarURL})" target="_blank"></a>
    <h1 class="config-account__name">
        <a target="_blank" class="fn__a" href="${getCloudURL("member/" + window.siyuan.user.userName)}">${window.siyuan.user.userName}</a>
        <span class="ft__on-surface ft__smaller">${0 === window.siyuan.config.cloudRegion ? "ld246.com":"liuyun.io"}</span>
    </h1>
    ${userTitlesHTML}
</div>
<div class="config-account__info">
    <div class="fn__flex">
        <a class="b3-button b3-button--text" href="${getCloudURL("settings")}" target="_blank">${window.siyuan.languages.accountManage}</a>
        <span class="fn__space"></span>
        <button class="b3-button b3-button--cancel" id="logout">
            ${window.siyuan.languages.logout}
        </button>
        <span class="fn__space"></span>
        <button class="b3-button b3-button--cancel" id="deactivateUser">
            ${window.siyuan.languages.deactivateUser}
        </button>
        <span class="fn__flex-1"></span>
        <button class="b3-button b3-button--cancel" id="refresh">
            <svg><use xlink:href="#iconRefresh"></use></svg>
        </button>
    </div>
</div></div>`,
        bindEvent(modelMainElement: HTMLElement) {
            modelMainElement.querySelector("#logout").addEventListener(getEventName(), () => {
                fetchPost("/api/setting/logoutCloudUser", {}, () => {
                    window.siyuan.user = null;
                    closePanel();
                    document.getElementById("menuAccount").innerHTML = `<svg class="b3-menu__icon"><use xlink:href="#iconAccount"></use></svg><span class="b3-menu__label">${window.siyuan.languages.login}</span>`;
                    processSync();
                });
            });
            modelMainElement.querySelector("#deactivateUser").addEventListener(getEventName(), () => {
                confirmDialog("⚠️ " + window.siyuan.languages.deactivateUser, window.siyuan.languages.deactivateUserTip, () => {
                    fetchPost("/api/account/deactivate", {}, () => {
                        window.siyuan.user = null;
                        closePanel();
                        document.getElementById("menuAccount").innerHTML = `<svg class="b3-menu__icon"><use xlink:href="#iconAccount"></use></svg><span class="b3-menu__label">${window.siyuan.languages.login}</span>`;
                        processSync();
                    });
                });
            });
            const refreshElement = modelMainElement.querySelector("#refresh");
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
                    showMessage(window.siyuan.languages.refreshUser, 3000);
                    showAccountInfo();
                    const menuAccountElement = document.getElementById("menuAccount");
                    if (window.siyuan.user) {
                        menuAccountElement.innerHTML = `<img class="b3-menu__icon" src="${window.siyuan.user.userAvatarURL}"/><span class="b3-menu__label">${window.siyuan.user.userName}</span>`;
                    } else {
                        menuAccountElement.innerHTML = `<svg class="b3-menu__icon"><use xlink:href="#iconAccount"></use></svg><span class="b3-menu__label">${window.siyuan.languages.login}</span>`;
                    }
                    processSync();
                });
            });
        }
    });
};

export const login = () => {
    openModel({
        title: window.siyuan.languages.login,
        icon: "iconAccount",
        html: `<div class="b3-form__space" id="form1">
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
<div class="b3-form__space fn__none" id="form2">
    <div class="b3-form__icon">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconLock"></use></svg>
        <input id="twofactorAuthCode" class="b3-text-field fn__block b3-form__icon-input" placeholder="${window.siyuan.languages.twoFactorCaptcha}">
    </div>
    <div class="fn__hr--b"></div>
    <button id="login2" class="b3-button fn__block">${window.siyuan.languages.login}</button>
</div>`,
        bindEvent(modelMainElement: HTMLElement) {
            const agreeLoginElement = modelMainElement.querySelector("#agreeLogin") as HTMLInputElement;
            const userNameElement = modelMainElement.querySelector("#userName") as HTMLInputElement;
            const userPasswordElement = modelMainElement.querySelector("#userPassword") as HTMLInputElement;
            const captchaImgElement = modelMainElement.querySelector("#captchaImg") as HTMLInputElement;
            const captchaElement = modelMainElement.querySelector("#captcha") as HTMLInputElement;
            const twofactorAuthCodeElement = modelMainElement.querySelector("#twofactorAuthCode") as HTMLInputElement;
            const loginBtnElement = modelMainElement.querySelector("#login") as HTMLButtonElement;
            const login2BtnElement = modelMainElement.querySelector("#login2") as HTMLButtonElement;
            userNameElement.focus();
            let token: string;
            let needCaptcha: string;
            agreeLoginElement.addEventListener("click", () => {
                if (agreeLoginElement.checked) {
                    loginBtnElement.removeAttribute("disabled");
                } else {
                    loginBtnElement.setAttribute("disabled", "disabled");
                }
            });
            captchaImgElement.addEventListener("click", () => {
                captchaImgElement.setAttribute("src", `https://ld246.com/captcha/login?needCaptcha=${needCaptcha}&t=${new Date().getTime()}`);
            });
            const cloudRegionElement = modelMainElement.querySelector("#cloudRegion") as HTMLSelectElement;
            cloudRegionElement.addEventListener("change", () => {
                window.siyuan.config.cloudRegion = parseInt(cloudRegionElement.value);
                modelMainElement.querySelector("#form1").lastElementChild.innerHTML = `<a href="${getCloudURL("forget-pwd")}" class="b3-button b3-button--cancel" target="_blank">${window.siyuan.languages.forgetPassword}</a>
        <span class="fn__space${window.siyuan.config.system.container === "ios" ? " fn__none" : ""}"></span>
        <a href="${getCloudURL("register")}" class="b3-button b3-button--cancel${window.siyuan.config.system.container === "ios" ? " fn__none" : ""}" target="_blank">${window.siyuan.languages.register}</a>`;
            });
            loginBtnElement.addEventListener("click", () => {
                fetchPost("/api/account/login", {
                    userName: userNameElement.value.replace(/(^\s*)|(\s*$)/g, ""),
                    userPassword: md5(userPasswordElement.value),
                    captcha: captchaElement.value.replace(/(^\s*)|(\s*$)/g, ""),
                    cloudRegion: window.siyuan.config.cloudRegion
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
                        modelMainElement.querySelector("#form1").classList.add("fn__none");
                        modelMainElement.querySelector("#form2").classList.remove("fn__none");
                        twofactorAuthCodeElement.focus();
                        token = data.data.token;
                        return;
                    }
                    fetchPost("/api/setting/getCloudUser", {
                        token: data.data.token,
                    }, response => {
                        window.siyuan.user = response.data;
                        closePanel();
                        document.getElementById("menuAccount").innerHTML = `<img class="b3-menu__icon" src="${window.siyuan.user.userAvatarURL}"/>
<span class="b3-menu__label">${window.siyuan.user.userName}</span>`;
                        processSync();
                    });
                });
            });

            login2BtnElement.addEventListener("click", () => {
                fetchPost("/api/setting/login2faCloudUser", {
                    code: twofactorAuthCodeElement.value,
                    token,
                }, faResponse => {
                    fetchPost("/api/setting/getCloudUser", {
                        token: faResponse.data.token,
                    }, response => {
                        window.siyuan.user = response.data;
                        closePanel();
                        document.getElementById("menuAccount").innerHTML = `<img class="b3-menu__icon" src="${window.siyuan.user.userAvatarURL}"/>
<span class="b3-menu__label">${window.siyuan.user.userName}</span>`;
                        processSync();
                    });
                });
            });
        }
    });
};
