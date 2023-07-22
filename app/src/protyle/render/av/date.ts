export const getDateHTML = (data: IAVTable, cellElements: HTMLElement[]) => {
    const colId = cellElements[0].dataset["colId"];
    const colData = data.columns.find(item => {
        if (item.id === colId) {
            return item;
        }
    });
    let hasEndDate = true
    let hasMatch = false
    cellElements.forEach((cellElement) => {
        data.rows.find(row => {
            if (cellElement.parentElement.dataset.id === row.id) {
                row.cells.find(cell => {
                    if (cell.id === cellElement.dataset.id) {
                        if (!cell.value || !cell.value.date || !cell.value.date.content2) {
                            hasEndDate = false
                            hasMatch = true
                        }
                        return true;
                    }
                });
                return true;
            }
        });
    });
    if (!hasMatch) {
        hasEndDate = false
    }
    return `<div>
    <input type="date" class="b3-text-field fn__block">
    <input type="date" class="b3-text-field fn__block${hasEndDate ? "" : " fn__none"}">
    <button class="b3-menu__separator"></button>
    <button class="b3-menu__item">
        <span>${window.siyuan.languages.endDate}</span>
        <span class="fn__space fn__flex-1"></span>
        <input type="checkbox" class="b3-switch fn__flex-center"${hasEndDate ? " checked" : ""}>
    </button>
</div>`
}

export const bindDateEvent = (options: { protyle: IProtyle, data: IAV, menuElement: HTMLElement }) => {

}
