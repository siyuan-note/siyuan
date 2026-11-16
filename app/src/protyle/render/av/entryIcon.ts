export const getAVCellShowIcon = (view: IAVView | undefined, type: TAVCol) =>
    (type === "relation" || type === "rollup" ? view?.showRelationIcon ?? view?.showIcon : view?.showIcon) ?? true;

export const updateAVViewShowIcon = (view: IAVView, showIcon: boolean, relation = false) => {
    if (relation) {
        view.showRelationIcon = showIcon;
    } else {
        view.showRelationIcon ??= view.showIcon ?? true;
        view.showIcon = showIcon;
    }
    view.groups?.forEach(group => updateAVViewShowIcon(group, showIcon, relation));
};
