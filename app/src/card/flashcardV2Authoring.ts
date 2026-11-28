import {genEmptyElement} from "../block/util";
import {Constants} from "../constants";
import {confirmDialog} from "../dialog/confirmDialog";
import {focusBlock} from "../protyle/util/selection";
import {getContenteditableElement} from "../protyle/wysiwyg/getBlock";
import {transaction} from "../protyle/wysiwyg/transaction";
import {isEncryptedBox} from "../util/pathName";
import type {TFlashcardAuthoringMode} from "./flashcardV2AuthoringTypes";

const hasContent = (fragment: DocumentFragment) =>
    Boolean(fragment.textContent.replaceAll(Constants.ZWSP, "").trim() ||
        fragment.querySelector("img, audio, video, iframe, [data-type~=inline-math], [data-type~=block-ref]"));

const childListParagraphs = (block: HTMLElement) => {
    const item = block.parentElement;
    if (item?.dataset.type !== "NodeListItem" || item.querySelector(':scope > [data-type="NodeParagraph"]') !== block) {
        return [];
    }
    return Array.from(item.querySelectorAll<HTMLElement>(
        ':scope > [data-type="NodeList"] > [data-type="NodeListItem"] > [data-type="NodeParagraph"]'));
};

export const runFlashcardSlashCommand = (protyle: IProtyle, block: HTMLElement, range: Range,
    mode: Exclude<TFlashcardAuthoringMode, "cloze">) => {
    if (protyle.disabled || protyle.lite || window.siyuan.config.readonly || window.siyuan.isPublish ||
        !protyle.block.rootID || isEncryptedBox(protyle.notebookId) || block.dataset.type !== "NodeParagraph" ||
        block.closest('[data-type="NodeBlockQueryEmbed"]')) {
        return;
    }
    const editable = getContenteditableElement(block, range.startContainer);
    if (!editable?.contains(range.startContainer) || !editable.contains(range.endContainer)) {
        return;
    }
    const rootID = protyle.block.rootID;
    const beforeHTML = block.outerHTML;
    const leftRange = document.createRange();
    leftRange.selectNodeContents(editable);
    leftRange.setEnd(range.startContainer, range.startOffset);
    const rightRange = document.createRange();
    rightRange.selectNodeContents(editable);
    rightRange.setStart(range.endContainer, range.endOffset);
    const front = leftRange.cloneContents();
    const back = rightRange.cloneContents();
    const count = mode === "choiceSingle" || mode === "choiceMultiple" ? 2 : 1;
    const existing = childListParagraphs(block).filter((child, index, siblings) =>
        siblings.findIndex(item => item.parentElement === child.parentElement) === index);
    const bindExisting = existing.length >= count;
    const blank = !hasContent(front) && !hasContent(back);
    const apply = () => {
        if (!block.isConnected || !protyle.wysiwyg.element.contains(block) ||
            protyle.block.rootID !== rootID || block.outerHTML !== beforeHTML) {
            return;
        }
        const id = block.dataset.nodeId;
        const updated = block.cloneNode(true) as HTMLElement;
        const content = getContenteditableElement(updated);
        const lang = window.siyuan.languages;
        const append: HTMLElement[] = [];
        if (bindExisting) {
            content.replaceChildren(front, back);
        } else {
            content.replaceChildren(hasContent(front) ? front : document.createTextNode(lang.flashcardChoiceQuestion));
            for (let index = 0; index < count; index++) {
                const paragraph = genEmptyElement(false, false);
                const body = getContenteditableElement(paragraph);
                body.replaceChildren(index === 0 && hasContent(back) ? back :
                    document.createTextNode(index === 0 ? lang.flashcardCorrectAnswer : lang.flashcardAlternativeAnswer));
                append.push(paragraph);
            }
        }
        const doOperations: IOperation[] = [{action: "update", id, data: updated.outerHTML}];
        for (const [index, paragraph] of append.entries()) {
            doOperations.push({action: "insert", id: paragraph.dataset.nodeId,
                previousID: append[index - 1]?.dataset.nodeId || id, data: paragraph.outerHTML});
        }
        const undoOperations: IOperation[] = append.map(({dataset}) => ({action: "delete", id: dataset.nodeId}));
        undoOperations.push({action: "update", id, data: beforeHTML});
        const ids = [id, ...(bindExisting ? existing : append).map(element => element.dataset.nodeId)];
        const firstAnswerID = ids[1];
        void Promise.resolve(transaction(protyle, doOperations, undoOperations, {
            awaitResponse: true,
            callback: () => {
                if (protyle.block.rootID !== rootID) { return; }
                const answer = protyle.wysiwyg.element.querySelector(`[data-node-id="${CSS.escape(firstAnswerID)}"]`);
                if (answer) { focusBlock(answer); }
                void import("./flashcardV2").then(({openFlashcardV2SourceMode}) => {
                    if (protyle.block.rootID === rootID && protyle.element.isConnected) {
                        openFlashcardV2SourceMode(ids, mode);
                    }
                });
            },
        })).catch(error => console.error("Flashcard source preparation failed", error));
    };
    if (blank || bindExisting) {
        apply();
    } else {
        confirmDialog({title: window.siyuan.languages.flashcardQA,
            text: window.siyuan.languages.flashcardSplitParagraphTip, confirm: apply});
    }
};
