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
import {ai} from "./ai";
import {flashcard} from "./flashcard";

export const openSetting = () => {
    const exitDialog = window.siyuan.dialogs.find((item) => {
        if (item.element.querySelector(".config__tab-container")) {
            item.destroy();
            return true;
        }
    });
    if (exitDialog) {
        return exitDialog;
    }
    const height = Math.min(window.innerHeight * .9 - 42, window.innerHeight * .7);
    const dialog = new Dialog({
        content: `<div class="fn__flex-1 fn__flex config__panel">
  <ul class="b3-tab-bar b3-list b3-list--background">
    <div class="b3-form__icon"><svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg><input class="b3-text-field fn__block b3-form__icon-input"></div>
    <li data-name="editor" class="b3-list-item--focus b3-list-item"><svg class="b3-list-item__graphic"><use xlink:href="#iconEdit"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.editor}</span></li>
    <li data-name="filetree" class="b3-list-item"><svg class="b3-list-item__graphic"><use xlink:href="#iconFiles"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.fileTree}</span></li>
    <li data-name="card" class="b3-list-item"><svg class="b3-list-item__graphic"><use xlink:href="#iconRiffCard"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.riffCard}</span></li>
    <li data-name="AI" class="b3-list-item"><svg class="b3-list-item__graphic"><use xlink:href="#iconSparkles"></use></svg><span class="b3-list-item__text">AI</span></li>
    <li data-name="image" class="b3-list-item"><svg class="b3-list-item__graphic"><use xlink:href="#iconImage"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.assets}</span></li>
    <li data-name="export" class="b3-list-item"><svg class="b3-list-item__graphic"><use xlink:href="#iconUpload"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.export}</span></li>
    <li data-name="appearance" class="b3-list-item"><svg class="b3-list-item__graphic"><use xlink:href="#iconTheme"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.appearance}</span></li>
    <li data-name="bazaar" class="b3-list-item"><svg class="b3-list-item__graphic"><use xlink:href="#iconBazaar"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.bazaar}</span></li>
    <li data-name="search" class="b3-list-item"><svg class="b3-list-item__graphic"><use xlink:href="#iconSearch"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.search}</span></li>
    <li data-name="keymap" class="b3-list-item"><svg class="b3-list-item__graphic"><use xlink:href="#iconKeymap"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.keymap}</span></li>
    <li data-name="account" class="b3-list-item"><svg class="b3-list-item__graphic"><use xlink:href="#iconAccount"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.account}</span></li>
    <li data-name="repos" class="b3-list-item"><svg class="b3-list-item__graphic"><use xlink:href="#iconCloud"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.cloud}</span></li>
    <li data-name="about" class="b3-list-item"><svg class="b3-list-item__graphic"><use xlink:href="#iconInfo"></use></svg><span class="b3-list-item__text">${window.siyuan.languages.about}</span></li>
  </ul>
  <div class="config__tab-container" data-name="editor">${editor.genHTML()}</div>
  <div class="config__tab-container fn__none" data-name="filetree"></div>
  <div class="config__tab-container fn__none" data-name="card"></div>
  <div class="config__tab-container fn__none" data-name="AI"></div>
  <div class="config__tab-container fn__none" data-name="image"></div>
  <div class="config__tab-container fn__none" data-name="export"></div>
  <div class="config__tab-container fn__none" data-name="appearance"></div>
  <div class="config__tab-container fn__none" data-name="bazaar"></div>
  <div class="config__tab-container fn__none" data-name="search"></div>
  <div class="config__tab-container fn__none" style="overflow: scroll" data-name="keymap"></div>
  <div class="config__tab-container fn__none" data-name="account"></div>
  <div class="config__tab-container fn__none" data-name="repos"></div>
  <div class="config__tab-container fn__none" data-name="about"></div>
</div>`,
        width: "90vw",
    });

    initConfigSearch(dialog.element);
    (dialog.element.querySelector(".b3-dialog__container") as HTMLElement).style.maxWidth = "1280px";
    dialog.element.querySelectorAll(".b3-tab-bar .b3-list-item").forEach(item => {
        item.addEventListener("click", () => {
            const type = item.getAttribute("data-name");
            const containerElement = dialog.element.querySelector(`.config__tab-container[data-name="${type}"]`);
            dialog.element.querySelectorAll(".config__tab-container").forEach((container) => {
                container.classList.add("fn__none");
            });
            dialog.element.querySelector(".b3-tab-bar .b3-list-item.b3-list-item--focus").classList.remove("b3-list-item--focus");
            item.classList.add("b3-list-item--focus");
            containerElement.classList.remove("fn__none");
            if (containerElement.innerHTML === "" || type === "repos" || type === "bazaar") {
                switch (type) {
                    case "filetree":
                        containerElement.innerHTML = fileTree.genHTML();
                        fileTree.element = dialog.element.querySelector('.config__tab-container[data-name="filetree"]');
                        fileTree.bindEvent();
                        break;
                    case "AI":
                        containerElement.innerHTML = ai.genHTML();
                        ai.element = dialog.element.querySelector('.config__tab-container[data-name="AI"]');
                        ai.bindEvent();
                        break;
                    case "card":
                        containerElement.innerHTML = flashcard.genHTML();
                        flashcard.element = dialog.element.querySelector('.config__tab-container[data-name="card"]');
                        flashcard.bindEvent();
                        break;
                    case "image":
                        containerElement.innerHTML = image.genHTML();
                        image.element = dialog.element.querySelector('.config__tab-container[data-name="image"]');
                        image.bindEvent();
                        break;
                    case "export":
                        containerElement.innerHTML = exportConfig.genHTML();
                        exportConfig.element = dialog.element.querySelector('.config__tab-container[data-name="export"]');
                        exportConfig.bindEvent();
                        break;
                    case "appearance":
                        containerElement.innerHTML = appearance.genHTML();
                        appearance.element = dialog.element.querySelector('.config__tab-container[data-name="appearance"]');
                        appearance.bindEvent();
                        break;
                    case "keymap":
                        containerElement.innerHTML = keymap.genHTML();
                        keymap.element = dialog.element.querySelector('.config__tab-container[data-name="keymap"]');
                        keymap.bindEvent();
                        break;
                    case "bazaar":
                        bazaar.element = dialog.element.querySelector('.config__tab-container[data-name="bazaar"]');
                        containerElement.innerHTML = bazaar.genHTML();
                        bazaar.bindEvent();
                        break;
                    case "account":
                        containerElement.innerHTML = account.genHTML();
                        account.element = dialog.element.querySelector('.config__tab-container[data-name="account"]');
                        account.bindEvent(account.element);
                        break;
                    case "repos":
                        containerElement.innerHTML = repos.genHTML();
                        repos.element = dialog.element.querySelector('.config__tab-container[data-name="repos"]');
                        repos.bindEvent();
                        break;
                    case "about":
                        containerElement.innerHTML = about.genHTML();
                        about.element = dialog.element.querySelector('.config__tab-container[data-name="about"]');
                        about.bindEvent();
                        break;
                    case "search":
                        containerElement.innerHTML = query.genHTML();
                        query.element = dialog.element.querySelector('.config__tab-container[data-name="search"]');
                        query.bindEvent();
                        break;
                    default:
                        break;
                }
            }
        });
    });
    editor.element = dialog.element.querySelector('.config__tab-container[data-name="editor"]');
    editor.bindEvent();
    return dialog;
};
