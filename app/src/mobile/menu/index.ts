import {popSearch} from "./search";
import {initAppearance} from "../settings/appearance";
import {closePanel} from "../util/closePanel";
import {mountHelp, newDailyNote, newNotebook} from "../../util/mount";
import {repos} from "../../config/repos";
import {exitSiYuan, lockScreen, processSync} from "../../dialog/processSystem";
import {openHistory} from "../../history/history";
import {syncGuide} from "../../sync/syncGuide";
import {openCard} from "../../card/openCard";
import {activeBlur, hideKeyboardToolbar} from "../util/keyboardToolbar";
import {initAI} from "../settings/ai";
import {initRiffCard} from "../settings/riffCard";
import {login, showAccountInfo} from "../settings/account";
import {openModel} from "./model";
import {initAbout} from "../settings/about";
import {getRecentDocs} from "./getRecentDocs";
import {initEditor} from "../settings/editor";
import {App} from "../../index";
import {isHuawei, isInAndroid, isInIOS} from "../../protyle/util/compatibility";

export const popMenu = () => {
    activeBlur();
    hideKeyboardToolbar();
    document.getElementById("menu").style.transform = "translateX(0px)";
};

export const initRightMenu = (app: App) => {
    const menuElement = document.getElementById("menu");
    let accountHTML = "";
    if (window.siyuan.user && !window.siyuan.config.readonly) {
        accountHTML = `<div class="b3-menu__item" id="menuAccount">
    <img class="b3-menu__icon" src="${window.siyuan.user.userAvatarURL}"/>
    <span class="b3-menu__label">${window.siyuan.user.userName}</span>
</div>`;
    } else if (!window.siyuan.config.readonly) {
        accountHTML = `<div class="b3-menu__item" id="menuAccount">
    <svg class="b3-menu__icon"><use xlink:href="#iconAccount"></use></svg><span class="b3-menu__label">${window.siyuan.languages.login}</span>
</div>`;
    }

    let aiHTML = `<div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuAI">
        <svg class="b3-menu__icon"><use xlink:href="#iconSparkles"></use></svg><span class="b3-menu__label">AI</span>
    </div>`;
    if (isHuawei()) {
        // Access to the OpenAI API is no longer supported on Huawei devices https://github.com/siyuan-note/siyuan/issues/8192
        aiHTML = "";
    }

    menuElement.innerHTML = `<div class="b3-menu__title">
    <svg class="b3-menu__icon"><use xlink:href="#iconLeft"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.back}</span>
</div>
<div class="b3-menu__items">
    ${accountHTML}
    <div id="menuRecent" class="b3-menu__item">
        <svg class="b3-menu__icon"><use xlink:href="#iconList"></use></svg><span class="b3-menu__label">${window.siyuan.languages.recentDocs}</span>
    </div>
    <div id="menuSearch" class="b3-menu__item">
        <svg class="b3-menu__icon"><use xlink:href="#iconSearch"></use></svg><span class="b3-menu__label">${window.siyuan.languages.search}</span>
    </div>
    <div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuSyncNow">
        <svg class="b3-menu__icon"><use xlink:href="#iconCloudSucc"></use></svg><span class="b3-menu__label">${window.siyuan.languages.syncNow}</span>
    </div>
    <div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuNewNotebook">
        <svg class="b3-menu__icon"><use xlink:href="#iconFilesRoot"></use></svg><span class="b3-menu__label">${window.siyuan.languages.newNotebook}</span>
    </div>
    <div class="b3-menu__separator"></div>
    <div id="menuNewDaily" class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}">
        <svg class="b3-menu__icon"><use xlink:href="#iconCalendar"></use></svg><span class="b3-menu__label">${window.siyuan.languages.dailyNote}</span>
    </div>
    <div id="menuCard" class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}">
        <svg class="b3-menu__icon" style="color: var(--b3-theme-secondary)"><use xlink:href="#iconRiffCard"></use></svg><span class="b3-menu__label">${window.siyuan.languages.spaceRepetition}</span>
    </div>
    <div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuLock">
        <svg class="b3-menu__icon"><use xlink:href="#iconLock"></use></svg><span class="b3-menu__label">${window.siyuan.languages.lockScreen}</span>
    </div>
    <div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuHistory">
        <svg class="b3-menu__icon"><use xlink:href="#iconHistory"></use></svg><span class="b3-menu__label">${window.siyuan.languages.dataHistory}</span>
    </div>
    <div class="b3-menu__item${(isInAndroid() || isInIOS()) ? "" : " fn__none"}" id="menuSafeQuit">
        <svg class="b3-menu__icon"><use xlink:href="#iconQuit"></use></svg><span class="b3-menu__label">${window.siyuan.languages.safeQuit}</span>
    </div>
    <div class="b3-menu__separator"></div>
    <div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuEditor">
        <svg class="b3-menu__icon"><use xlink:href="#iconEdit"></use></svg><span class="b3-menu__label">${window.siyuan.languages.editor}</span>
    </div>
    <div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuRiffCard">
        <svg class="b3-menu__icon"><use xlink:href="#iconRiffCard"></use></svg><span class="b3-menu__label">${window.siyuan.languages.riffCard}</span>
    </div>
    ${aiHTML}
    <div class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}" id="menuAppearance">
        <svg class="b3-menu__icon"><use xlink:href="#iconTheme"></use></svg><span class="b3-menu__label">${window.siyuan.languages.appearance}</span>
    </div>
    <div id="menuSync" class="b3-menu__item${window.siyuan.config.readonly ? " fn__none" : ""}">
        <svg class="b3-menu__icon"><use xlink:href="#iconCloud"></use></svg><span class="b3-menu__label">${window.siyuan.languages.cloud}</span>
    </div>
    <div class="b3-menu__item" id="menuAbout">
        <svg class="b3-menu__icon"><use xlink:href="#iconInfo"></use></svg><span class="b3-menu__label">${window.siyuan.languages.about}</span>
    </div>
    <div class="b3-menu__separator"></div>
    <div class="b3-menu__item" id="menuHelp">
        <svg class="b3-menu__icon"><use xlink:href="#iconHelp"></use></svg><span class="b3-menu__label">${window.siyuan.languages.help}</span>
    </div>
    <a class="b3-menu__item" href="${"zh_CN" === window.siyuan.config.lang || "zh_CHT" === window.siyuan.config.lang ? "https://ld246.com/article/1649901726096" : "https://liuyun.io/article/1686530886208"}" target="_blank">
        <svg class="b3-menu__icon"><use xlink:href="#iconFeedback"></use></svg>
        <span class="b3-menu__label">${window.siyuan.languages.feedback}</span>
    </a>
</div>`;
    processSync();
    // 只能用 click，否则无法上下滚动 https://github.com/siyuan-note/siyuan/issues/6628
    menuElement.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(menuElement)) {
            if (target.classList.contains("b3-menu__title")) {
                closePanel();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuSearch") {
                popSearch(app);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuRecent") {
                getRecentDocs(app);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuAppearance") {
                initAppearance();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuAI") {
                initAI();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuRiffCard") {
                initRiffCard();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuEditor") {
                initEditor();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuSafeQuit") {
                exitSiYuan();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuAbout") {
                initAbout();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuNewDaily") {
                newDailyNote();
                closePanel();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuCard") {
                openCard(app);
                closePanel();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuNewNotebook") {
                newNotebook();
                closePanel();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuHelp") {
                mountHelp();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuLock") {
                lockScreen();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuSync") {
                openModel({
                    title: window.siyuan.languages.cloud,
                    icon: "iconCloud",
                    html: repos.genHTML(),
                    bindEvent(modelMainElement: HTMLElement) {
                        repos.element = modelMainElement;
                        repos.bindEvent();
                    }
                });
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuSyncNow") {
                syncGuide();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuHistory") {
                openHistory(app);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.id === "menuAccount") {
                event.preventDefault();
                event.stopPropagation();
                if (document.querySelector("#menuAccount img")) {
                    showAccountInfo();
                    return;
                }
                login();
                break;
            }
            target = target.parentElement;
        }
    });
};
