import {getRandom, isMobile} from "../util/functions";
import {fetchPost} from "../util/fetch";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {Constants} from "../constants";
import {Files} from "../layout/dock/Files";
/// #if !MOBILE
import {getDockByType} from "../layout/tabUtil";
import {getAllModels} from "../layout/getAll";
/// #endif
import {setNoteBook} from "../util/pathName";
import {Dialog} from "../dialog";
import {setPosition} from "../util/setPosition";

export const getRandomEmoji = () => {
    const emojis = window.siyuan.emojis[getRandom(0, window.siyuan.emojis.length - 1)];
    if (typeof emojis.items[getRandom(0, emojis.items.length - 1)] === "undefined") {
        return "1f600";
    }
    return emojis.items[getRandom(0, emojis.items.length - 1)].unicode;
};

export const unicode2Emoji = (unicode: string, className = "", needSpan = false, lazy = false) => {
    if (!unicode) {
        return "";
    }
    let emoji = "";
    if (unicode.indexOf(".") > -1) {
        emoji = `<img class="${className}" ${lazy ? "data-" : ""}src="/emojis/${unicode}"/>`;
    } else {
        try {
            unicode.split("-").forEach(item => {
                if (item.length < 5) {
                    emoji += String.fromCodePoint(parseInt("0" + item, 16));
                } else {
                    emoji += String.fromCodePoint(parseInt(item, 16));
                }
            });
            if (needSpan) {
                emoji = `<span class="${className}">${emoji}</span>`;
            }
        } catch (e) {
            // 自定义表情搜索报错 https://github.com/siyuan-note/siyuan/issues/5883
            // 这里忽略错误不做处理
        }
    }
    return emoji;
};

export const lazyLoadEmoji = (element: HTMLElement) => {
    const emojiIntersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entrie: IntersectionObserverEntry & { target: HTMLImageElement }) => {
            const index = entrie.target.getAttribute("data-index");
            if ((typeof entrie.isIntersecting === "undefined" ? entrie.intersectionRatio !== 0 : entrie.isIntersecting) && index) {
                let html = "";
                window.siyuan.emojis[parseInt(index)].items.forEach(emoji => {
                    html += `<button data-unicode="${emoji.unicode}" class="emojis__item ariaLabel" aria-label="${getEmojiDesc(emoji)}">
${unicode2Emoji(emoji.unicode)}</button>`;
                });
                entrie.target.innerHTML = html;
                entrie.target.removeAttribute("data-index");
            }
        });
    });
    element.querySelectorAll(".emojis__content").forEach((panelElement) => {
        emojiIntersectionObserver.observe(panelElement);
    });
};

export const lazyLoadEmojiImg = (element: Element) => {
    const emojiIntersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entrie: IntersectionObserverEntry & { target: HTMLImageElement }) => {
            const src = entrie.target.getAttribute("data-src");
            if ((typeof entrie.isIntersecting === "undefined" ? entrie.intersectionRatio !== 0 : entrie.isIntersecting) && src) {
                entrie.target.src = src;
                entrie.target.removeAttribute("data-src");
            }
        });
    });
    element.querySelectorAll("img").forEach((panelElement) => {
        emojiIntersectionObserver.observe(panelElement);
    });
};

export const filterEmoji = (key = "", max?: number) => {
    let html = "";
    const recentEmojis: IEmojiItem[] = [];
    if (key) {
        html = `<div class="emojis__title">${window.siyuan.languages.emoji}</div><div class="emojis__content">`;
    }
    let maxCount = 0;
    let keyHTML = "";
    const customStore: IEmojiItem[] = [];
    window.siyuan.emojis.forEach((category, index) => {
        if (!key) {
            html += `<div class="emojis__title" data-type="${index + 1}">${getEmojiTitle(index)}</div><div style="min-height:${index === 0 ? "28px" : "336px"}" class="emojis__content"${index > 1 ? ' data-index="' + index + '"' : ""}>`;
        }
        if (category.items.length === 0 && index === 0 && !key) {
            html += `<div style="margin-left: 4px">${window.siyuan.languages.setEmojiTip}</div>`;
        }

        category.items.forEach(emoji => {
            if (key) {
                if (window.siyuan.config.editor.emoji.includes(emoji.unicode) &&
                    (unicode2Emoji(emoji.unicode) === key ||
                        emoji.keywords.toLowerCase().indexOf(key.toLowerCase()) > -1 ||
                        emoji.description.toLowerCase().indexOf(key.toLowerCase()) > -1 ||
                        emoji.description_zh_cn.toLowerCase().indexOf(key.toLowerCase()) > -1 ||
                        emoji.description_ja_jp.toLowerCase().indexOf(key.toLowerCase()) > -1)
                ) {
                    recentEmojis.push(emoji);
                }
                if (max && maxCount > max) {
                    return;
                }
                if (unicode2Emoji(emoji.unicode) === key ||
                    emoji.keywords.toLowerCase().indexOf(key.toLowerCase()) > -1 ||
                    emoji.description.toLowerCase().indexOf(key.toLowerCase()) > -1 ||
                    emoji.description_zh_cn.toLowerCase().indexOf(key.toLowerCase()) > -1 ||
                    emoji.description_ja_jp.toLowerCase().indexOf(key.toLowerCase()) > -1) {
                    if (category.id === "custom") {
                        customStore.push(emoji);
                    } else {
                        keyHTML += `<button data-unicode="${emoji.unicode}" class="emojis__item ariaLabel" aria-label="${getEmojiDesc(emoji)}">
${unicode2Emoji(emoji.unicode, undefined, false, true)}</button>`;
                    }
                    maxCount++;
                }
            } else {
                if (window.siyuan.config.editor.emoji.includes(emoji.unicode)) {
                    recentEmojis.push(emoji);
                }
                if (index < 2) {
                    html += `<button data-unicode="${emoji.unicode}" class="emojis__item ariaLabel" aria-label="${getEmojiDesc(emoji)}">
${unicode2Emoji(emoji.unicode, undefined, false, true)}</button>`;
                }
            }
        });
        if (!key) {
            html += "</div>";
        }
    });
    if (key) {
        customStore.sort((a, b) => {
            const aKeywords = a.keywords.split("/");
            const bKeywords = b.keywords.split("/");
            if (aKeywords[aKeywords.length - 1].toLowerCase().indexOf(key.toLowerCase()) < bKeywords[bKeywords.length - 1].toLowerCase().indexOf(key.toLowerCase())) {
                return -1;
            }
            return 0;
        }).sort((a, b) => {
            const aKeywords = a.keywords.split("/");
            const bKeywords = b.keywords.split("/");
            if (aKeywords[aKeywords.length - 1].toLowerCase().indexOf(key.toLowerCase()) === bKeywords[bKeywords.length - 1].toLowerCase().indexOf(key.toLowerCase()) && aKeywords[aKeywords.length - 1].length < bKeywords[bKeywords.length - 1].length) {
                return -1;
            }
            return 0;
        }).forEach(item => {
            html += `<button data-unicode="${item.unicode}" class="emojis__item ariaLabel" aria-label="${getEmojiDesc(item)}">
${unicode2Emoji(item.unicode, undefined, false, true)}</button>`;
        });
        html = html + keyHTML + "</div>";
    }
    let recentHTML = "";
    if (recentEmojis.length > 0) {
        recentHTML = `<div class="emojis__title" data-type="0">${window.siyuan.languages.recentEmoji}</div><div class="emojis__content">`;
        window.siyuan.config.editor.emoji.forEach(emojiUnicode => {
            const emoji = recentEmojis.filter((item) => item.unicode === emojiUnicode);
            if (emoji[0]) {
                recentHTML += `<button data-unicode="${emoji[0].unicode}" class="emojis__item ariaLabel" aria-label="${getEmojiDesc(emoji[0])}">
${unicode2Emoji(emoji[0].unicode, undefined, false, true)}
</button>`;
            }
        });
        recentHTML += "</div>";
    }

    if (recentHTML + html === "") {
        return `<div class="emojis__title">${window.siyuan.languages.emptyContent}</div>`;
    }
    return recentHTML + html;
};

export const addEmoji = (unicode: string) => {
    window.siyuan.config.editor.emoji.unshift(unicode);
    if (window.siyuan.config.editor.emoji.length > Constants.SIZE_UNDO) {
        window.siyuan.config.editor.emoji.pop();
    }
    window.siyuan.config.editor.emoji = Array.from(new Set(window.siyuan.config.editor.emoji));

    fetchPost("/api/setting/setEmoji", {emoji: window.siyuan.config.editor.emoji});
};

export const openEmojiPanel = (id: string, type: "doc" | "notebook" | "av", position: IPosition, avCB?: (emoji: string) => void) => {
    if (type !== "av") {
        window.siyuan.menus.menu.remove();
    } else {
        window.siyuan.menus.menu.removeScrollEvent();
    }

    const dialog = new Dialog({
        disableAnimation: true,
        transparent: true,
        hideCloseIcon: true,
        width: isMobile() ? "80vw" : "360px",
        height: "50vh",
        content: `<div class="emojis">
    <div class="fn__flex">
        <span class="fn__space"></span>
        <label class="b3-form__icon fn__flex-1" style="overflow:initial;">
            <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
            <input class="b3-form__icon-input b3-text-field fn__block" placeholder="${window.siyuan.languages.search}">
        </label>
        <span class="fn__space"></span>
        <span class="block__icon block__icon--show fn__flex-center b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.random}"><svg><use xlink:href="#iconRefresh"></use></svg></span>
        <span class="fn__space"></span>
        <span class="block__icon block__icon--show fn__flex-center b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.remove}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>
        <span class="fn__space"></span>
    </div>
    <div class="emojis__panel">${filterEmoji()}</div>
    <div class="fn__flex">
        ${[
            ["2b50", window.siyuan.languages.recentEmoji],
            ["1f527", getEmojiTitle(0)],
            ["1f60d", getEmojiTitle(1)],
            ["1f433", getEmojiTitle(2)],
            ["1f96a", getEmojiTitle(3)],
            ["1f3a8", getEmojiTitle(4)],
            ["1f3dd-fe0f", getEmojiTitle(5)],
            ["1f52e", getEmojiTitle(6)],
            ["267e-fe0f", getEmojiTitle(7)],
            ["1f6a9", getEmojiTitle(8)],
        ].map(([unicode, title], index) =>
            `<div data-type="${index}" class="emojis__type ariaLabel" aria-label="${title}">${unicode2Emoji(unicode)}</div>`
        ).join("")}
    </div>
</div>`
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_EMOJIS);
    dialog.element.querySelector(".b3-dialog__container").setAttribute("data-menu", "true");
    const dialogElement = dialog.element.querySelector(".b3-dialog") as HTMLElement;
    dialogElement.style.justifyContent = "inherit";
    dialogElement.style.alignItems = "inherit";
    setPosition(dialog.element.querySelector(".b3-dialog__container"), position.x, position.y, position.h, position.w);
    dialog.element.querySelector(".emojis__item").classList.add("emojis__item--current");
    const inputElement = dialog.element.querySelector(".b3-text-field") as HTMLInputElement;
    const emojisContentElement = dialog.element.querySelector(".emojis__panel");
    inputElement.addEventListener("compositionend", () => {
        emojisContentElement.innerHTML = filterEmoji(inputElement.value);
        if (inputElement.value) {
            emojisContentElement.nextElementSibling.classList.add("fn__none");
        } else {
            emojisContentElement.nextElementSibling.classList.remove("fn__none");
        }
        emojisContentElement.scrollTop = 0;
        dialog.element.querySelector(".emojis__item")?.classList.add("emojis__item--current");
        if (inputElement.value === "") {
            lazyLoadEmoji(dialog.element);
        }
        lazyLoadEmojiImg(dialog.element);
    });
    inputElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        emojisContentElement.innerHTML = filterEmoji(inputElement.value);
        if (inputElement.value) {
            emojisContentElement.nextElementSibling.classList.add("fn__none");
        } else {
            emojisContentElement.nextElementSibling.classList.remove("fn__none");
        }
        emojisContentElement.scrollTop = 0;
        dialog.element.querySelector(".emojis__item")?.classList.add("emojis__item--current");
        if (inputElement.value === "") {
            lazyLoadEmoji(dialog.element);
        }
        lazyLoadEmojiImg(dialog.element);
    });
    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        if (event.key.indexOf("Arrow") === -1 && event.key !== "Enter") {
            return;
        }
        const currentElement: HTMLElement = dialog.element.querySelector(".emojis__item--current");
        if (!currentElement) {
            return;
        }
        if (event.key === "Enter") {
            const unicode = currentElement.getAttribute("data-unicode");
            if (type === "notebook") {
                fetchPost("/api/notebook/setNotebookIcon", {
                    notebook: id,
                    icon: unicode
                }, () => {
                    dialog.destroy();
                    addEmoji(unicode);
                    updateFileTreeEmoji(unicode, id, "iconFilesRoot");
                });
            } else if (type === "doc") {
                fetchPost("/api/attr/setBlockAttrs", {
                    id,
                    attrs: {"icon": unicode}
                }, () => {
                    dialog.destroy();
                    addEmoji(unicode);
                    updateFileTreeEmoji(unicode, id);
                    updateOutlineEmoji(unicode, id);
                });
            } else {
                avCB(unicode);
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        let newCurrentElement: HTMLElement;
        if (event.key === "ArrowLeft") {
            if (currentElement.previousElementSibling) {
                currentElement.classList.remove("emojis__item--current");
                newCurrentElement = currentElement.previousElementSibling as HTMLElement;
                event.preventDefault();
                event.stopPropagation();
            } else if (currentElement.parentElement.previousElementSibling?.previousElementSibling) {
                currentElement.classList.remove("emojis__item--current");
                newCurrentElement = currentElement.parentElement.previousElementSibling.previousElementSibling.lastElementChild as HTMLElement;
                event.preventDefault();
                event.stopPropagation();
            }
        } else if (event.key === "ArrowRight") {
            if (currentElement.nextElementSibling) {
                currentElement.classList.remove("emojis__item--current");
                newCurrentElement = currentElement.nextElementSibling as HTMLElement;
                event.preventDefault();
                event.stopPropagation();
            } else if (currentElement.parentElement.nextElementSibling?.nextElementSibling) {
                currentElement.classList.remove("emojis__item--current");
                newCurrentElement = currentElement.parentElement.nextElementSibling.nextElementSibling.firstElementChild as HTMLElement;
                event.preventDefault();
                event.stopPropagation();
            }
        } else if (event.key === "ArrowDown") {
            if (!currentElement.nextElementSibling) {
                const nextContentElement = currentElement.parentElement.nextElementSibling?.nextElementSibling;
                if (nextContentElement) {
                    newCurrentElement = nextContentElement.firstElementChild as HTMLElement;
                    currentElement.classList.remove("emojis__item--current");
                }
            } else {
                currentElement.classList.remove("emojis__item--current");
                let counter = Math.floor(currentElement.parentElement.clientWidth / (currentElement.clientWidth + 2));
                newCurrentElement = currentElement;
                while (newCurrentElement.nextElementSibling && counter > 0) {
                    newCurrentElement = newCurrentElement.nextElementSibling as HTMLElement;
                    counter--;
                }
            }
            event.preventDefault();
            event.stopPropagation();
        } else if (event.key === "ArrowUp") {
            if (!currentElement.previousElementSibling) {
                const prevContentElement = currentElement.parentElement.previousElementSibling?.previousElementSibling;
                if (prevContentElement) {
                    newCurrentElement = prevContentElement.lastElementChild as HTMLElement;
                    currentElement.classList.remove("emojis__item--current");
                }
            } else {
                currentElement.classList.remove("emojis__item--current");
                let counter = Math.floor(currentElement.parentElement.clientWidth / (currentElement.clientWidth + 2));
                newCurrentElement = currentElement;
                while (newCurrentElement.previousElementSibling && counter > 0) {
                    newCurrentElement = newCurrentElement.previousElementSibling as HTMLElement;
                    counter--;
                }
            }
            event.preventDefault();
            event.stopPropagation();
        }
        if (newCurrentElement) {
            newCurrentElement.classList.add("emojis__item--current");
            const inputHeight = inputElement.clientHeight + 6;
            if (newCurrentElement.offsetTop - inputHeight < emojisContentElement.scrollTop) {
                emojisContentElement.scrollTop = newCurrentElement.offsetTop - inputHeight - 6;
            } else if (newCurrentElement.offsetTop - inputHeight - emojisContentElement.clientHeight + newCurrentElement.clientHeight > emojisContentElement.scrollTop) {
                emojisContentElement.scrollTop = newCurrentElement.offsetTop - inputHeight - emojisContentElement.clientHeight + newCurrentElement.clientHeight;
            }
        }
    });
    if (!isMobile()) {
        inputElement.focus();
    }
    lazyLoadEmoji(dialog.element);
    lazyLoadEmojiImg(dialog.element);
    // 不能使用 getEventName 否则 https://github.com/siyuan-note/siyuan/issues/5472
    dialog.element.addEventListener("click", (event) => {
        const eventTarget = event.target as HTMLElement;
        const typeElement = hasClosestByClassName(eventTarget, "emojis__type");
        if (typeElement) {
            const titleElement = emojisContentElement.querySelector(`[data-type="${typeElement.getAttribute("data-type")}"]`) as HTMLElement;
            if (titleElement) {
                const index = titleElement.nextElementSibling.getAttribute("data-index");
                if (index) {
                    let html = "";
                    window.siyuan.emojis[parseInt(index)].items.forEach(emoji => {
                        html += `<button data-unicode="${emoji.unicode}" class="emojis__item ariaLabel" aria-label="${getEmojiDesc(emoji)}">
${unicode2Emoji(emoji.unicode)}</button>`;
                    });
                    titleElement.nextElementSibling.innerHTML = html;
                    titleElement.nextElementSibling.removeAttribute("data-index");
                }

                emojisContentElement.scrollTo({
                    top: titleElement.offsetTop - 34,
                    // behavior: "smooth"  不能使用，否则无法定位
                });
            }
            return;
        }
        const iconElement = hasClosestByClassName(eventTarget, "block__icon");
        if (iconElement && iconElement.getAttribute("aria-label") === window.siyuan.languages.remove) {
            if (type === "notebook") {
                fetchPost("/api/notebook/setNotebookIcon", {
                    notebook: id,
                    icon: ""
                }, () => {
                    dialog.destroy();
                    updateFileTreeEmoji("", id, "iconFilesRoot");
                });
            } else if (type === "doc") {
                fetchPost("/api/attr/setBlockAttrs", {
                    id: id,
                    attrs: {"icon": ""}
                }, () => {
                    dialog.destroy();
                    updateFileTreeEmoji("", id);
                    updateOutlineEmoji("", id);
                });
            } else {
                avCB("");
            }
            return;
        }
        const emojiElement = hasClosestByClassName(eventTarget, "emojis__item");
        if (emojiElement || iconElement) {
            let unicode = "";
            if (emojiElement) {
                unicode = emojiElement.getAttribute("data-unicode");
                if (type !== "av") {
                    dialog.destroy();
                }
            } else {
                // 随机
                unicode = getRandomEmoji();
            }
            if (type === "notebook") {
                fetchPost("/api/notebook/setNotebookIcon", {
                    notebook: id,
                    icon: unicode
                }, () => {
                    addEmoji(unicode);
                    updateFileTreeEmoji(unicode, id, "iconFilesRoot");
                });
            } else if (type === "doc") {
                fetchPost("/api/attr/setBlockAttrs", {
                    id,
                    attrs: {"icon": unicode}
                }, () => {
                    addEmoji(unicode);
                    updateFileTreeEmoji(unicode, id);
                    updateOutlineEmoji(unicode, id);
                });
            } else {
                avCB(unicode);
            }
            return;
        }
    });
};

export const updateOutlineEmoji = (unicode: string, id: string) => {
    /// #if !MOBILE
    getAllModels().outline.forEach(model => {
        if (model.blockId === id) {
            model.headerElement.nextElementSibling.firstElementChild.outerHTML = unicode2Emoji(unicode || Constants.SIYUAN_IMAGE_FILE, "b3-list-item__graphic", true);
        }
    });
    /// #endif
};

export const updateFileTreeEmoji = (unicode: string, id: string, icon = "iconFile") => {
    let emojiElement;
    /// #if MOBILE
    emojiElement = document.querySelector(`#sidebar [data-type="sidebar-file"] [data-node-id="${id}"] .b3-list-item__icon`);
    /// #else
    const dockFile = getDockByType("file");
    if (dockFile) {
        const files = dockFile.data.file as Files;
        if (icon === "iconFile") {
            emojiElement = files.element.querySelector(`[data-node-id="${id}"] .b3-list-item__icon`);
        } else {
            emojiElement = files.element.querySelector(`[data-node-id="${id}"] .b3-list-item__icon`) || files.element.querySelector(`[data-url="${id}"] .b3-list-item__icon`) || files.closeElement.querySelector(`[data-url="${id}"] .b3-list-item__icon`);
        }
    }
    /// #endif
    if (emojiElement) {
        emojiElement.innerHTML = unicode2Emoji(unicode || (icon === "iconFile" ? (emojiElement.previousElementSibling.classList.contains("fn__hidden") ? Constants.SIYUAN_IMAGE_FILE : Constants.SIYUAN_IMAGE_FOLDER) : Constants.SIYUAN_IMAGE_NOTE));
    }
    if (icon !== "iconFile") {
        setNoteBook();
    }
};

export const getEmojiDesc = (emoji: IEmojiItem) => {
    if (window.siyuan.config.lang === "zh_CN") {
        return emoji.description_zh_cn;
    }
    if (window.siyuan.config.lang === "ja_JP") {
        return emoji.description_ja_jp;
    }
    return emoji.description;
};


export const getEmojiTitle = (index: number) => {
    if (window.siyuan.config.lang === "zh_CN") {
        return window.siyuan.emojis[index].title_zh_cn;
    }
    if (window.siyuan.config.lang === "ja_JP") {
        return window.siyuan.emojis[index].title_ja_jp;
    }
    return window.siyuan.emojis[index].title;
};
