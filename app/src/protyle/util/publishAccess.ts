import {Dialog} from "../../dialog";
import {isMobile} from "../../util/functions";
import {setPosition} from "../../util/setPosition";
import {fetchPost} from "../../util/fetch";

export const getPublishAccessOptionByLevel = (level: TPublishAccessLevel) => {
    if (level == "protected") {
        return {
            iconHTML: "🔒",
            comment: window.siyuan.languages.publishAccessProtectedComment,
            visible: true,
            hasPassword: true,
            disable: false,
        };
    } else if (level == "hidden") {
        return {
            iconHTML: "👻",
            comment: window.siyuan.languages.publishAccessHiddenComment,
            visible: false,
            hasPassword: false,
            disable: false,
        };
    } else if (level == "private") {
        return {
            iconHTML: "🤫",
            comment: window.siyuan.languages.publishAccessPrivateComment,
            visible: false,
            hasPassword: true,
            disable: false,
        };
    } else if (level == "forbidden") {
        return {
            iconHTML: "🚫",
            comment: window.siyuan.languages.publishAccessForbiddenComment,
            visible: false,
            hasPassword: false,
            disable: true,
        };
    } else {
        return {
            iconHTML: "🌐",
            comment: window.siyuan.languages.publishAccessPublicComment,
            visible: true,
            hasPassword: false,
            disable: false,
        };
    }
};

export const getPublishAccessLevel = (visible: boolean, password: string, disable: boolean): TPublishAccessLevel => {
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
};

export const openPublishAccessDialog = (id: string, position: IPosition, callback: (access: IPublishAccessItem) => void) => {
    const dialog = new Dialog({
        disableAnimation: true,
        transparent: true,
        hideCloseIcon: true,
        width: isMobile() ? "80vw" : "230px",
        height: "auto",
        content: `<div class="block__icons">
    <button class="block__icon block__icon--show ariaLabel" data-position="north" data-level="public" aria-label="${window.siyuan.languages.publishAccessPublic}">${getPublishAccessOptionByLevel("public").iconHTML}</button>
    <span class="fn__space"></span>
    <button class="block__icon block__icon--show ariaLabel" data-position="north" data-level="protected" aria-label="${window.siyuan.languages.publishAccessProtected}">${getPublishAccessOptionByLevel("protected").iconHTML}</button>
    <span class="fn__space"></span>
    <button class="block__icon block__icon--show ariaLabel" data-position="north" data-level="hidden" aria-label="${window.siyuan.languages.publishAccessHidden}">${getPublishAccessOptionByLevel("hidden").iconHTML}</button>
    <span class="fn__space"></span>
    <button class="block__icon block__icon--show ariaLabel" data-position="north" data-level="private" aria-label="${window.siyuan.languages.publishAccessPrivate}">${getPublishAccessOptionByLevel("private").iconHTML}</button>
    <span class="fn__space"></span>
    <button class="block__icon block__icon--show ariaLabel" data-position="north" data-level="forbidden" aria-label="${window.siyuan.languages.publishAccessForbidden}">${getPublishAccessOptionByLevel("forbidden").iconHTML}</button>
    <span class="fn__flex-1"></span>
    <button class="b3-button b3-button--text ariaLabel" data-position="north" aria-label="${window.siyuan.languages.confirm}"><svg><use xlink:href="#iconSelect"></use></svg></button>
</div>
<div style="padding: 0 8px 8px 8px;text-align: center;">
    <div class="publish-access-dialog__comment">${window.siyuan.languages.publishAccessPublicComment}</div>
    <div class="fn__hr"></div>
    <div class="b3-form__icon fn__none">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconKey"></use></svg>
        <input class="b3-form__icon-input b3-text-field fn__block" placeholder="${window.siyuan.languages.password}">
    </div>
</div>`
    });
    const containerElement = dialog.element.querySelector(".b3-dialog__container") as HTMLElement;
    containerElement.style.position = "fixed";
    setPosition(containerElement, position.x, position.y, position.h, position.w);
    fetchPost("/api/filetree/getPublishAccess", {
        ids: [id],
    }, (response) => {
        response.data.publishAccess.find((item: IPublishAccessItem) => {
            if (id == item.id) {
                setPublishAccessLevelInDialog(dialog.element, getPublishAccessLevel(item.visible, item.password, item.disable));
                (dialog.element.querySelector(".b3-text-field") as HTMLInputElement).value = item.password;
                return true;
            }
        });
    });

    dialog.element.querySelectorAll(".block__icon").forEach((element: HTMLElement) => {
        element.addEventListener("click", () => {
            setPublishAccessLevelInDialog(dialog.element, (element.getAttribute("data-level") as TPublishAccessLevel));
        });
    });
    dialog.element.querySelector(".b3-button").addEventListener("click", () => {
        const element = dialog.element.querySelector(".block__icon.block__icon--active");
        const password = (dialog.element.querySelector("input.b3-text-field") as HTMLInputElement).value.trim();
        let accessOption = getPublishAccessOptionByLevel(element.getAttribute("data-level") as TPublishAccessLevel);
        accessOption = getPublishAccessOptionByLevel(getPublishAccessLevel(accessOption.visible, accessOption.hasPassword ? password : "", accessOption.disable));
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

const setPublishAccessLevelInDialog = (dialogElement: HTMLElement, accessLevel: TPublishAccessLevel) => {
    const accessOption = getPublishAccessOptionByLevel(accessLevel);
    dialogElement.querySelectorAll(".block__icon").forEach((element: HTMLElement) => {
        element.classList.toggle("block__icon--active", element.getAttribute("data-level") == accessLevel);
    });
    dialogElement.querySelector(".publish-access-dialog__comment").innerHTML = accessOption.comment;
    dialogElement.querySelector(".b3-form__icon").classList.toggle("fn__none", !accessOption.hasPassword);
};
