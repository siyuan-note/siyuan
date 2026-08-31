import type {ICommandDefinition} from "./types";

export const normalizeCommandSearchText = (value: string) => value
    .normalize("NFKC")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[._:/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const getSearchFields = (command: ICommandDefinition) => {
    const normalizedFields = [
        command.label(),
        command.englishLabel?.() || "",
        command.id,
        ...(command.keywords?.() || []),
    ].map(normalizeCommandSearchText).filter(Boolean);
    return [...new Set(normalizedFields.flatMap(field => [field, field.replace(/ /g, "")]))];
};

const getScore = (fields: string[], query: string, tokens: string[]) => {
    if (!query) {
        return 0;
    }
    if (!tokens.every(token => fields.some(field => field.includes(token)))) {
        return -1;
    }
    if (fields.some(field => field === query)) {
        return 300;
    }
    if (fields.some(field => field.startsWith(query))) {
        return 200;
    }
    return 100;
};

export const searchCommands = (commands: ICommandDefinition[], value: string) => {
    const query = normalizeCommandSearchText(value);
    const tokens = query.split(" ").filter(Boolean);
    return commands
        .map((command, index) => ({command, index, score: getScore(getSearchFields(command), query, tokens)}))
        .filter(item => item.score >= 0)
        .sort((first, second) => second.score - first.score || first.index - second.index)
        .map(item => item.command);
};
