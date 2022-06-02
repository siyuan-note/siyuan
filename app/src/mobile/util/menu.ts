import {fetchPost} from "../../util/fetch";
import {getEventName, writeText} from "../../protyle/util/compatibility";
import {popSearch} from "./search";
import {initAppearance} from "../settings/appearance";
import {closePanel} from "./closePanel";
import {Constants} from "../../constants";
import {setAccessAuthCode} from "../../config/util";
import {mountHelp, newDailyNote, newNotebook} from "../../util/mount";
import {needSubscribe} from "../../util/needSubscribe";
import {repos} from "../../config/repos";
import * as md5 from "blueimp-md5";
import {showMessage} from "../../dialog/message";
import {exitSiYuan} from "../../dialog/processSystem";
import {confirmDialog} from "../../dialog/confirmDialog";

const showAccountInfo = (modelElement: HTMLElement, modelMainElement: Element) => {
    closePanel();
    let userTitlesHTML = "";
    if (window.siyuan.user.userTitles.length > 0) {
        userTitlesHTML = '<div class="fn__hr--b"></div><div class="fn__flex" style="position: absolute"><span class="fn__space"></span>';
        window.siyuan.user.userTitles.forEach((item) => {
            userTitlesHTML += `<div class="b3-chip">${item.icon} ${item.name}</div><span class="fn__space"></span>`;
        });
        userTitlesHTML += "</div>";
    }
    modelElement.style.top = "0";
    modelElement.querySelector(".toolbar__icon").innerHTML = '<use xlink:href="#iconAccount"></use>';
    modelElement.querySelector(".toolbar__text").textContent = window.siyuan.languages.accountManage;
    modelMainElement.innerHTML = `<div class="fn__flex-column">
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
        <button class="b3-button b3-button--cancel" id="refresh">
            <svg><use xlink:href="#iconRefresh"></use></svg>
        </button>
    </div>
</div></div>`;

    modelMainElement.querySelector("#logout").addEventListener(getEventName(), () => {
        fetchPost("/api/setting/logoutCloudUser", {}, () => {
            window.siyuan.user = null;
            closePanel();
            document.getElementById("menuAccount").innerHTML = `<svg class="b3-list-item__graphic"><use xlink:href="#iconAccount"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.login}</span>`;
        });
    });
    modelMainElement.querySelector("#deactivateUser").addEventListener(getEventName(), () => {
        confirmDialog("⚠️ " + window.siyuan.languages.deactivateUser, window.siyuan.languages.deactivateUserTip, () => {
            fetchPost("/api/account/deactivate", {}, () => {
                window.siyuan.user = null;
                closePanel();
                document.getElementById("menuAccount").innerHTML = `<svg class="b3-list-item__graphic"><use xlink:href="#iconAccount"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.login}</span>`;
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
            showAccountInfo(modelElement, modelMainElement);
            const menuAccountElement = document.getElementById("menuAccount");
            if (window.siyuan.user) {
                menuAccountElement.innerHTML = `<img class="b3-list-item__graphic" src="${window.siyuan.user.userAvatarURL}"/><span class="b3-list-item__text">${window.siyuan.user.userName}</span>`;
            } else {
                menuAccountElement.innerHTML = `<svg class="b3-list-item__graphic"><use xlink:href="#iconAccount"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.login}</span>`;
            }
        });
    });
};

export const popMenu = () => {
    const modelElement = document.getElementById("model");
    const modelMainElement = document.getElementById("modelMain");
    const scrimElement = document.querySelector(".scrim");
    const menuElement = document.getElementById("menu");
    if (menuElement.innerHTML !== "") {
        menuElement.style.right = "0";
        scrimElement.classList.remove("fn__none");
        return;
    }

    fetchPost("/api/setting/getCloudUser", {}, userResponse => {
        window.siyuan.user = userResponse.data;
        let accountHTML = "";
        if (window.siyuan.user) {
            accountHTML = `<div class="b3-list-item b3-list-item--big" id="menuAccount">
    <img class="b3-list-item__graphic" src="${window.siyuan.user.userAvatarURL}"/>
    <span class="b3-list-item__text">${window.siyuan.user.userName}</span>
</div>`;
        } else {
            accountHTML = `<div class="b3-list-item b3-list-item--big" id="menuAccount">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconAccount"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.login}</span>
</div>`;
        }
        menuElement.innerHTML = `<div id="menuSearch" class="b3-list-item b3-list-item--big">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconSearch"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.search}</span>
</div>
<div id="menuNewDaily" class="b3-list-item b3-list-item--big">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconCalendar"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.dailyNote}</span>
</div>
<div class="b3-list-item b3-list-item--big" id="menuNewNotebook">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconFilesRoot"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.newNotebook}</span>
</div>
<div class="b3-list-item b3-list-item--big" id="menuSyncNow">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconRefresh"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.syncNow}</span>
</div>
<div slot="border-bottom: 1px solid var(--b3-border-color);"></div>
<div class="b3-list-item b3-list-item--big" id="menuAppearance">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconTheme"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.appearance}</span>
</div>
<div class="b3-list-item b3-list-item--big" id="menuLock">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconLock"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.lockScreen}</span>
</div>
${accountHTML}
<div id="menuSync" class="b3-list-item b3-list-item--big">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconCloud"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.cloud}</span>
</div>
<div class="b3-list-item b3-list-item--big" id="menuHelp">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconHelp"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.help}</span>
</div>
<div class="b3-list-item b3-list-item--big" id="menuAbout">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconInfo"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.about}</span>
</div>
<div class="b3-list-item b3-list-item--big" id="menuSafeQuit">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconQuit"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.safeQuit}</span>
</div>`;

        document.getElementById("menuSearch").addEventListener(getEventName(), () => {
            popSearch(modelElement, modelMainElement);
        });

        document.getElementById("menuAppearance").addEventListener(getEventName(), () => {
            initAppearance(modelElement, modelMainElement);
        });

        document.getElementById("menuSafeQuit").addEventListener(getEventName(), () => {
            exitSiYuan();
        });

        document.getElementById("menuAbout").addEventListener(getEventName(), (event) => {
            event.stopPropagation();
            event.preventDefault();
            closePanel();
            if (!window.siyuan.config.localIPs || window.siyuan.config.localIPs.length === 0 ||
                (window.siyuan.config.localIPs.length === 1 && window.siyuan.config.localIPs[0] === "")) {
                window.siyuan.config.localIPs = ["127.0.0.1"];
            }
            modelElement.style.top = "0";
            modelElement.querySelector(".toolbar__icon").innerHTML = '<use xlink:href="#iconInfo"></use>';
            modelElement.querySelector(".toolbar__text").textContent = window.siyuan.languages.about;
            modelMainElement.innerHTML = `<div class="b3-label fn__flex">
    <div class="fn__flex-1">
        ${window.siyuan.languages.about11}
        <div class="b3-label__text">${window.siyuan.languages.about12}</div>
    </div>
    <div class="fn__space"></div>
    <input class="b3-switch fn__flex-center" id="networkServe" type="checkbox"${window.siyuan.config.system.networkServe ? " checked" : ""}>
</div>
<div class="b3-label">
       ${window.siyuan.languages.about2}
       <div class="fn__hr"></div>
       <input class="b3-text-field fn__block" readonly value="http://${window.siyuan.config.system.networkServe ? window.siyuan.config.localIPs[0] : "127.0.0.1"}:6806">
       <div class="b3-label__text b3-typography">${window.siyuan.languages.about3}</div>
       <div class="fn__hr"></div>
       <span class="b3-label__text b3-typography"><code>${window.siyuan.config.localIPs.join("</code> <code>")}</code></span>
</div>
<div class="b3-label">
    ${window.siyuan.languages.about5}
    <div class="fn__hr"></div>
    <button class="b3-button b3-button--outline fn__block" id="authCode">
        <svg><use xlink:href="#iconLock"></use></svg>${window.siyuan.languages.config}
    </button>
    <div class="b3-label__text b3-typography">${window.siyuan.languages.about6}</div>
</div>
<div class="b3-label">
    ${window.siyuan.languages.about13}
    <span class="b3-label__text">${window.siyuan.config.api.token}</span>
    <div class="fn__hr"></div>
    <button class="b3-button b3-button--outline fn__block" id="token">
        <svg><use xlink:href="#iconCopy"></use></svg>${window.siyuan.languages.copy}
    </button>
    <div class="b3-label__text b3-typography">${window.siyuan.languages.about14}</div>
</div>
<div class="b3-label">
    <div class="fn__flex">
        ${window.siyuan.languages.export}
    </div>
    <div class="fn__hr"></div>
    <button class="b3-button b3-button--outline fn__block" id="exportData">
       <svg><use xlink:href="#iconUpload"></use></svg> ${window.siyuan.languages.export} Data
    </button>
    <div class="fn__hr"></div>
    <div class="b3-label__text b3-typography">${window.siyuan.languages.exportDataTip}</div>
</div>
<div class="b3-label">
    <div class="fn__flex">
        ${window.siyuan.languages.import}
    </div>
    <div class="fn__hr"></div>
    <button class="b3-button b3-button--outline fn__block" style="position: relative">
        <input id="importData" class="b3-form__upload" type="file">
        <svg><use xlink:href="#iconDownload"></use></svg> ${window.siyuan.languages.import} Data
    </button>
    <div class="fn__hr"></div>
    <div class="b3-label__text b3-typography">${window.siyuan.languages.importDataTip}</div>
</div>
<div class="b3-label">
    <div class="config-about__logo">
        <img src="/stage/icon.png">
        <span class="fn__space"></span>
        <div>
            <span>${window.siyuan.languages.siyuanNote}</span>
            <span class="fn__space"></span>
            <span class="ft__on-surface">v${Constants.SIYUAN_VERSION}</span>
            <br>
            <span class="ft__on-surface">${window.siyuan.languages.slogan}</span>
        </div>
        <span class="fn__flex-1"></span>
        <a class="fn__flex" href="${"zh_CN" === window.siyuan.config.lang ? "https://ld246.com/article/1649901726096" : "https://github.com/siyuan-note/siyuan/issues"}" target="_blank">
            <svg class="fn__flex-center svg"><use xlink:href="#iconHeart"></use></svg>
            <span class="fn__space"></span>
            ${window.siyuan.languages.feedback}
        </a>
    </div>
    <div style="color:var(--b3-theme-surface);font-family: cursive;">会泽百家&nbsp;至公天下</div>
    ${window.siyuan.languages.about1}
</div>`;
            const authCodeElement = modelMainElement.querySelector("#authCode") as HTMLInputElement;
            authCodeElement.addEventListener("click", () => {
                setAccessAuthCode();
            });
            modelMainElement.querySelector("#token").addEventListener("click", () => {
                writeText(window.siyuan.config.api.token);
            });
            modelMainElement.querySelector("#exportData").addEventListener("click", () => {
                fetchPost("/api/export/exportData", {}, response => {
                    if (window.JSAndroid) {
                        window.JSAndroid.openExternal(response.data.zip);
                        return;
                    }
                    window.location.href = response.data.zip;
                });
            });
            modelMainElement.querySelector("#importData").addEventListener("change", (event: InputEvent & { target: HTMLInputElement }) => {
                const formData = new FormData();
                formData.append("file", event.target.files[0]);
                fetchPost("/api/import/importData", formData);
            });
            const networkServeElement = modelMainElement.querySelector("#networkServe") as HTMLInputElement;
            networkServeElement.addEventListener("change", () => {
                fetchPost("/api/system/setNetworkServe", {networkServe: networkServeElement.checked}, () => {
                    exitSiYuan();
                });
            });
        });
        document.getElementById("menuNewDaily").addEventListener(getEventName(), () => {
            newDailyNote();
        });
        document.getElementById("menuNewNotebook").addEventListener(getEventName(), () => {
            newNotebook();
        });
        document.getElementById("menuHelp").addEventListener(getEventName(), () => {
            mountHelp();
        });
        document.getElementById("menuLock").addEventListener(getEventName(), () => {
            fetchPost("/api/system/logoutAuth", {}, () => {
                window.location.href = "/";
            });
        });
        document.getElementById("menuSync").addEventListener(getEventName(), (event) => {
            event.stopPropagation();
            event.preventDefault();
            if (!needSubscribe()) {
                closePanel();
                modelElement.style.top = "0";
                modelElement.querySelector(".toolbar__icon").innerHTML = '<use xlink:href="#iconCloud"></use>';
                modelElement.querySelector(".toolbar__text").textContent = window.siyuan.languages.cloud;
                modelMainElement.innerHTML = repos.genHTML();
                repos.element = modelMainElement;
                repos.bindEvent();
            }
        });
        document.getElementById("menuSyncNow").addEventListener(getEventName(), (event) => {
            event.stopPropagation();
            event.preventDefault();
            if (needSubscribe()) {
                return;
            }
            if (!window.siyuan.config.sync.enabled) {
                showMessage(window.siyuan.languages._kernel[124]);
                return;
            }
            fetchPost("/api/sync/performSync", {});
        });
        document.getElementById("menuAccount").addEventListener(getEventName(), (event) => {
            event.stopPropagation();
            event.preventDefault();
            closePanel();
            if (document.querySelector("#menuAccount img")) {
                showAccountInfo(modelElement, modelMainElement);
                return;
            }
            modelElement.style.top = "0";
            modelElement.querySelector(".toolbar__icon").innerHTML = '<use xlink:href="#iconAccount"></use>';
            modelElement.querySelector(".toolbar__text").textContent = window.siyuan.languages.login;
            modelMainElement.innerHTML = `<div class="b3-form__space" id="form1">
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
<div class="b3-form__space fn__none" id="form2">
    <div class="b3-form__icon">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconLock"></use></svg>
        <input id="twofactorAuthCode" class="b3-text-field fn__block b3-form__icon-input" placeholder="${window.siyuan.languages.twoFactorCaptcha}">
    </div>
    <div class="fn__hr--b"></div>
    <button id="login2" class="b3-button fn__block">${window.siyuan.languages.login}</button>
</div>`;
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
                        document.getElementById("menuAccount").innerHTML = `<img class="b3-list-item__graphic" src="${window.siyuan.user.userAvatarURL}"/>
<span class="b3-list-item__text">${window.siyuan.user.userName}</span>`;
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
                        document.getElementById("menuAccount").innerHTML = `<img class="b3-list-item__graphic" src="${window.siyuan.user.userAvatarURL}"/>
<span class="b3-list-item__text">${window.siyuan.user.userName}</span>`;
                    });
                });
            });
        });

        menuElement.style.right = "0";
        scrimElement.classList.remove("fn__none");
    });
};
