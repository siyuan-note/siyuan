import {isMobile} from "../util/functions";
import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
import {setPosition} from "../util/setPosition";
import { get } from "http";
import { access } from "fs";

type PublishAccessLevel = "public" | "protected" | "hidden" | "private" | "forbidden";
export const getPublishAccessOptionByLevel = (level: PublishAccessLevel) => {
    if (level == "protected") {
        return {
            iconHTML: `🔒`,
            comment: window.siyuan.languages.publishAccessProtectedComment, 
            visible: true,
            hasPassword: true,
            disable: false,
        }
    } else if (level == "hidden") {
        return {
            iconHTML: `👻`,
            comment: window.siyuan.languages.publishAccessHiddenComment,
            visible: false,
            hasPassword: false,
            disable: false,
        }
    } else if (level == "private") {
        return {
            iconHTML: `🤫`,
            comment: window.siyuan.languages.publishAccessPrivateComment,
            visible: false,
            hasPassword: true,
            disable: false,
        }
    } else if (level == "forbidden") {
        return {
            iconHTML: `🚫`,
            comment: window.siyuan.languages.publishAccessForbiddenComment,
            visible: false,
            hasPassword: false,
            disable: true,
        }
    } else {
        return {
            iconHTML: `🌐`,
            comment: window.siyuan.languages.publishAccessPublicComment,
            visible: true,
            hasPassword: false,
            disable: false,
        }
    }
}

export const getPublishAccessLevel = (visible: boolean, password: string, disable: boolean): PublishAccessLevel => {
    if (disable) {
        return "forbidden";
    }
    if (visible) {
        if (password) {
            return "protected";
        } else {
            return "public";
        }
    } else {
        if (password) {
            return "private";
        } else {
            return "hidden";
        }
    }
}

export const getPublishAccessOption = (visible: boolean, password: string, disable: boolean) => {
    return getPublishAccessOptionByLevel(getPublishAccessLevel(visible, password, disable));
}

export const openPublishAccessDialog = (id: string, position: IPosition, callback?: (access: { id: string, visible: boolean, password: string, disable: boolean, iconHTML: string }) => void) => {
    const dialog = new Dialog({
        disableAnimation: true,
        transparent: true,
        hideCloseIcon: true,
        width: isMobile() ? "80vw" : "230px",
        height: "auto",
        content: `<div class="publish-access-dialog">
    <div class="publish-access-dialog__selector" style="display: flex;">
        <button class="publish-access-dialog__selector-item emojis__item ariaLabel" data-position="north" data-level="public" aria-label="${window.siyuan.languages.publishAccessPublic}">${getPublishAccessOptionByLevel("public").iconHTML}</button>
        <button class="publish-access-dialog__selector-item emojis__item ariaLabel" data-position="north" data-level="protected" aria-label="${window.siyuan.languages.publishAccessProtected}"">${getPublishAccessOptionByLevel("protected").iconHTML}</button>
        <button class="publish-access-dialog__selector-item emojis__item ariaLabel" data-position="north" data-level="hidden" aria-label="${window.siyuan.languages.publishAccessHidden}">${getPublishAccessOptionByLevel("hidden").iconHTML}</button>
        <button class="publish-access-dialog__selector-item emojis__item ariaLabel" data-position="north" data-level="private" aria-label="${window.siyuan.languages.publishAccessPrivate}">${getPublishAccessOptionByLevel("private").iconHTML}</button>
        <button class="publish-access-dialog__selector-item emojis__item ariaLabel" data-position="north" data-level="forbidden" aria-label="${window.siyuan.languages.publishAccessForbidden}">${getPublishAccessOptionByLevel("forbidden").iconHTML}</button>
        <span class="fn__flex-1"></span>
        <button class="publish-access-dialog__confirm b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
    </div>
    <div class="fn__hr"></div>
    <div>
        <div class="publish-access-dialog__comment" style="text-align:center; margin-left:8px; margin-right:8px; word-wrap:break-word;">公开可见</div>
        <div class="fn__hr"></div>
    </div>
    <div class="publish-access-dialog__password">
        <label class="b3-form__icon fn__flex-1" style="overflow:initial; display:block; justify-content:center; margin-left: 8px; margin-right: 8px;">
            <svg class="b3-form__icon-icon" style="align-self:center"><use xlink:href="#iconKey"></use></svg>
            <input class="b3-form__icon-input b3-text-field fn__block" placeholder="${window.siyuan.languages.password}">
        </label>
        <div class="fn__hr"></div>
    </div>
</div>`
    });
    dialog.element.querySelector(".b3-dialog__container").setAttribute("data-menu", "true");
    const dialogElement = dialog.element.querySelector(".b3-dialog") as HTMLElement;
    dialogElement.style.justifyContent = "inherit";
    dialogElement.style.alignItems = "flex-start";
    setPosition(dialog.element.querySelector(".b3-dialog__container"), position.x, position.y, position.h, position.w);
    
    fetchPost("/api/filetree/getPublishAccess", {
        ids: [id],
    }, (response) => {
        response.data.publishAccess.forEach((item: { id: string, visible: boolean, password: string, disable: boolean }) => { 
            if (id == item.id) {
                setPublishAccessInDialog(dialog.element, {
                    visible: item.visible,
                    password: item.password,
                    disable: item.disable,
                })
            }
        });
    });

    dialog.element.querySelectorAll(".publish-access-dialog__selector-item").forEach((element: HTMLElement) => {
        element.addEventListener("click", () => {
            setPublishAccessLevelInDialog(dialog.element, (element.getAttribute("data-level") as PublishAccessLevel));
        });
    })
    dialog.element.querySelector(".publish-access-dialog__confirm").addEventListener("click", () => { 
        const element = dialog.element.querySelector(".publish-access-dialog__selector-item.emojis__item--current");
        if (!element) {
            return;
        }
        const password = (dialog.element.querySelector(".publish-access-dialog__password input") as HTMLInputElement).value.trim();
        let accessOption = getPublishAccessOptionByLevel(element.getAttribute("data-level") as PublishAccessLevel);
        accessOption = getPublishAccessOption(accessOption.visible, accessOption.hasPassword ? password : "", accessOption.disable)
        callback({
            id,
            visible: accessOption.visible,
            password: accessOption.hasPassword ? password : "",
            disable: accessOption.disable,
            iconHTML: accessOption.iconHTML
        });
        dialog.destroy();
    });
};

const setPublishAccessLevelInDialog = (dialogElement: HTMLElement, accessLevel: PublishAccessLevel) => {
    const accessOption = getPublishAccessOptionByLevel(accessLevel);
    dialogElement.querySelectorAll(".publish-access-dialog__selector-item").forEach((element: HTMLElement) => {
        element.classList.toggle("emojis__item--current", element.getAttribute("data-level") == accessLevel);
    });
    dialogElement.querySelector(".publish-access-dialog__comment").innerHTML = accessOption.comment;
    dialogElement.querySelector(".publish-access-dialog__password").classList.toggle("fn__none", !accessOption.hasPassword);
};

const setPublishAccessInDialog = (dialogElement: HTMLElement, access: { visible: boolean, password: string, disable: boolean }) => {
    const accessLevel = getPublishAccessLevel(access.visible, access.password, access.disable);
    setPublishAccessLevelInDialog(dialogElement, accessLevel);
    (dialogElement.querySelector(".publish-access-dialog__password input") as HTMLInputElement).value = access.password;
};