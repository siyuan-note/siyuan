interface IDocTreeMenuFrom {
    notebook: string;
    notebooks: string;
    doc: string;
    docs: string;
    items: string;
}

export const getDocTreeEntryScope = (from: string | undefined, menuFrom: IDocTreeMenuFrom) => {
    if (from === menuFrom.notebook) {
        return "docTree.notebook";
    }
    if (from === menuFrom.doc) {
        return "docTree.document";
    }
    if (from === menuFrom.docs || from === menuFrom.items) {
        return "docTree.multi";
    }
    if (from === menuFrom.notebooks) {
        return "docTree.notebooks";
    }
    return "";
};
