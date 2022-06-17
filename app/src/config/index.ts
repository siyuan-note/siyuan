import {editor} from "./editor";
import {about} from "./about";
import {appearance} from "./appearance";
import {image} from "./image";
import {initConfigSearch} from "./search";
import {fileTree} from "./fileTree";
import {exportConfig} from "./exportConfig";
import {account} from "./account";
import {repos} from "./repos";
import {keymap} from "./keymap";
import {bazaar} from "./bazaar";
import {query} from "./query";
import {Dialog} from "../dialog";

export const openSetting = () => {
    const exitDialog = window.siyuan.dialogs.find((item) => {
        if (item.element.querySelector(".b3-tab-container")) {
            item.destroy();
            return true;
        }
    });
    if (exitDialog) {
        return exitDialog;
    }
    const height = Math.min(window.innerHeight * .9, Math.max(window.innerHeight * .7, 52 * 11));
    const dialog = new Dialog({
        content: `<div class="fn__flex-column" style="border-radius: 4px;overflow: hidden;position: relative">
<div class="b3-form__icon search__header"><svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg><input class="b3-text-field b3-text-field--text fn__block b3-form__icon-input"></div>
<div class="fn__flex-1 fn__flex">
  <ul class="b3-tab-bar b3-list b3-list--background" style="user-select:none;width: 180px;height:${height}px;overflow: auto">
    <li data-name="editor" class="b3-list-item--focus b3-list-item b3-list-item--big"><svg class="b3-list-item__graphic"><use xlink:href="#iconEdit"></use></svg>${window.siyuan.languages.editor}</li>
    <li data-name="filetree" class="b3-list-item b3-list-item--big"><svg class="b3-list-item__graphic"><use xlink:href="#iconFiles"></use></svg>${window.siyuan.languages.fileTree}</li>
    <li data-name="image" class="b3-list-item b3-list-item--big"><svg class="b3-list-item__graphic"><use xlink:href="#iconImage"></use></svg>${window.siyuan.languages.assets}</li>
    <li data-name="export" class="b3-list-item b3-list-item--big"><svg class="b3-list-item__graphic"><use xlink:href="#iconUpload"></use></svg>${window.siyuan.languages.export}</li>
    <li data-name="appearance" class="b3-list-item b3-list-item--big"><svg class="b3-list-item__graphic"><use xlink:href="#iconTheme"></use></svg>${window.siyuan.languages.appearance}</li>
    <li data-name="bazaar" class="b3-list-item b3-list-item--big"><svg class="b3-list-item__graphic"><use xlink:href="#iconBazaar"></use></svg>${window.siyuan.languages.bazaar}</li>
    <li data-name="search" class="b3-list-item b3-list-item--big"><svg class="b3-list-item__graphic"><use xlink:href="#iconSearch"></use></svg>${window.siyuan.languages.search}</li>
    <li data-name="keymap" class="b3-list-item b3-list-item--big"><svg class="b3-list-item__graphic"><use xlink:href="#iconKeymap"></use></svg>${window.siyuan.languages.keymap}</li>
    <li data-name="account" class="b3-list-item b3-list-item--big"><svg class="b3-list-item__graphic"><use xlink:href="#iconAccount"></use></svg>${window.siyuan.languages.account}</li>
    <li data-name="repos" class="b3-list-item b3-list-item--big"><svg class="b3-list-item__graphic"><use xlink:href="#iconCloud"></use></svg>${window.siyuan.languages.cloud}</li>
    <li data-name="about" class="b3-list-item b3-list-item--big"><svg class="b3-list-item__graphic"><use xlink:href="#iconInfo"></use></svg>${window.siyuan.languages.about}</li>
  </ul>
  <div class="b3-tab-container" style="height:${height}px" data-name="editor">${editor.genHTML()}</div>
  <div class="b3-tab-container fn__none" style="height:${height}px" data-name="filetree"></div>
  <div class="b3-tab-container fn__none" style="height:${height}px" data-name="image"></div>
  <div class="b3-tab-container fn__none" style="height:${height}px" data-name="export"></div>
  <div class="b3-tab-container fn__none" style="height:${height}px" data-name="appearance"></div>
  <div class="b3-tab-container fn__none" style="height:${height}px" data-name="bazaar"></div>
  <div class="b3-tab-container fn__none" style="height:${height}px" data-name="search"></div>
  <div class="b3-tab-container fn__none" style="height:${height}px" data-name="keymap"></div>
  <div class="b3-tab-container fn__none" style="height:${height}px" data-name="account"></div>
  <div class="b3-tab-container fn__none" style="height:${height}px" data-name="repos"></div>
  <div class="b3-tab-container fn__none" style="height:${height}px" data-name="about"></div>
</div>
</div>`,
        width: "80vw",
    });

    initConfigSearch(dialog.element);

    dialog.element.querySelectorAll(".b3-tab-bar .b3-list-item").forEach(item => {
        item.addEventListener("click", () => {
            const type = item.getAttribute("data-name");
            const containerElement = dialog.element.querySelector(`.b3-tab-container[data-name="${type}"]`);
            dialog.element.querySelectorAll(".b3-tab-container").forEach((container) => {
                container.classList.add("fn__none");
            });
            dialog.element.querySelector(".b3-tab-bar .b3-list-item.b3-list-item--focus").classList.remove("b3-list-item--focus");
            item.classList.add("b3-list-item--focus");
            containerElement.classList.remove("fn__none");
            if (containerElement.innerHTML === "" || type === "repos") {
                switch (type) {
                    case "filetree":
                        containerElement.innerHTML = fileTree.genHTML();
                        fileTree.element = dialog.element.querySelector('.b3-tab-container[data-name="filetree"]');
                        fileTree.bindEvent();
                        break;
                    case "image":
                        containerElement.innerHTML = image.genHTML();
                        image.element = dialog.element.querySelector('.b3-tab-container[data-name="image"]');
                        image.bindEvent();
                        break;
                    case "export":
                        containerElement.innerHTML = exportConfig.genHTML();
                        exportConfig.element = dialog.element.querySelector('.b3-tab-container[data-name="export"]');
                        exportConfig.bindEvent();
                        break;
                    case "appearance":
                        containerElement.innerHTML = appearance.genHTML();
                        appearance.element = dialog.element.querySelector('.b3-tab-container[data-name="appearance"]');
                        appearance.bindEvent();
                        break;
                    case "keymap":
                        containerElement.innerHTML = keymap.genHTML();
                        keymap.element = dialog.element.querySelector('.b3-tab-container[data-name="keymap"]');
                        keymap.bindEvent();
                        break;
                    case "bazaar":
                        bazaar.element = dialog.element.querySelector('.b3-tab-container[data-name="bazaar"]');
                        containerElement.innerHTML = bazaar.genHTML();
                        bazaar.bindEvent();
                        break;
                    case "account":
                        containerElement.innerHTML = account.genHTML();
                        account.element = dialog.element.querySelector('.b3-tab-container[data-name="account"]');
                        account.bindEvent();
                        break;
                    case "repos":
                        containerElement.innerHTML = repos.genHTML();
                        repos.element = dialog.element.querySelector('.b3-tab-container[data-name="repos"]');
                        repos.bindEvent();
                        break;
                    case "about":
                        containerElement.innerHTML = about.genHTML();
                        about.element = dialog.element.querySelector('.b3-tab-container[data-name="about"]');
                        about.bindEvent();
                        break;
                    case "search":
                        containerElement.innerHTML = query.genHTML();
                        query.element = dialog.element.querySelector('.b3-tab-container[data-name="search"]');
                        query.bindEvent();
                        break;
                    default:
                        break;
                }
            }
        });
    });
    editor.element = dialog.element.querySelector('.b3-tab-container[data-name="editor"]');
    editor.bindEvent();
    return dialog;
};
