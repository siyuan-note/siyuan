interface IDatabaseRowRefreshRegistration {
    getAVID: () => string;
    refresh: () => void;
    timeout?: ReturnType<typeof setTimeout>;
}

const refreshRegistrations = new Map<string, IDatabaseRowRefreshRegistration>();

export const registerDatabaseRowRefresh = (protyleID: string, options: {
    getAVID: () => string;
    refresh: () => void;
}) => {
    const previous = refreshRegistrations.get(protyleID);
    if (typeof previous?.timeout !== "undefined") {
        clearTimeout(previous.timeout);
    }
    const registration: IDatabaseRowRefreshRegistration = options;
    refreshRegistrations.set(protyleID, registration);
    return () => {
        if (refreshRegistrations.get(protyleID) !== registration) {
            return;
        }
        if (typeof registration.timeout !== "undefined") {
            clearTimeout(registration.timeout);
        }
        refreshRegistrations.delete(protyleID);
    };
};

export const queueDatabaseRowRefresh = (protyleID: string, avID: string) => {
    const registration = refreshRegistrations.get(protyleID);
    if (!registration || registration.getAVID() !== avID) {
        return;
    }
    if (typeof registration.timeout !== "undefined") {
        clearTimeout(registration.timeout);
    }
    registration.timeout = setTimeout(() => {
        registration.timeout = undefined;
        if (refreshRegistrations.get(protyleID) === registration && registration.getAVID() === avID) {
            registration.refresh();
        }
    }, 100);
};

export const queueDatabaseRowRefreshForOperations = (protyleID: string, operations: IOperation[]) => {
    const avIDs = new Set<string>();
    operations.forEach((operation) => {
        const avID = operation.action === "setAttrViewName" ? operation.id : operation.avID;
        if (avID) {
            avIDs.add(avID);
        }
    });
    avIDs.forEach((avID) => queueDatabaseRowRefresh(protyleID, avID));
};
