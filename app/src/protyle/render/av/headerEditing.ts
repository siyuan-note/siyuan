export const getAVHeaderEditingState = (editable: boolean, includeEditingControls = true) => ({
    contenteditable: editable.toString(),
    newItemHTML: includeEditingControls ? `<div class="av__new fn__flex">
        <button data-type="av-add-more" class="b3-button">${window.siyuan.languages.new}</button>
        <button data-type="av-add-template" class="b3-button ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.template}"><svg><use xlink:href="#iconDown"></use></svg></button>
    </div>` : "",
    selectionHTML: includeEditingControls ? `<button data-type="av-selection-edit" class="block__icon block__icon--show ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.editFields}">
        <svg><use xlink:href="#iconAttr"></use></svg>
    </button>
    <button data-type="av-selection-delete" class="block__icon block__icon--show ariaLabel" data-position="8south" aria-label="${window.siyuan.languages.delete}">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </button>` : "",
});
