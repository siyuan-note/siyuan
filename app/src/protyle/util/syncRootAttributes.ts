interface IAttributeTarget {
    removeAttribute: (name: string) => void;
    setAttribute: (name: string, value: string) => void;
}

export const syncRootAttributes = (
    element: IAttributeTarget,
    managedCustomAttributes: Set<string>,
    ial: Record<string, string>,
    rootID = ""
) => {
    managedCustomAttributes.forEach(attribute => element.removeAttribute(attribute));
    managedCustomAttributes.clear();

    Object.keys(ial).forEach(attribute => {
        if (attribute.startsWith("custom-") && ial[attribute]) {
            element.setAttribute(attribute, ial[attribute]);
            managedCustomAttributes.add(attribute);
        }
    });

    const nodeID = ial.id || rootID;
    if (nodeID) {
        element.setAttribute("data-node-id", nodeID);
    } else {
        element.removeAttribute("data-node-id");
    }
};
