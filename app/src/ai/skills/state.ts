import type {AISkillFileEntry} from "../../types/api";

export const isSkillEntryPoint = (entry: AISkillFileEntry) =>
    !entry.isDir && /^[^/]+\/SKILL\.md$/i.test(entry.path);

export const getSkillDirectory = (entry?: AISkillFileEntry) => entry ?
    (entry.isDir ? entry.path : entry.path.substring(0, entry.path.lastIndexOf("/"))) : "";

export const canChangeSkillEntry = (entry?: AISkillFileEntry) =>
    !!entry && (entry.isDir || (entry.editable && !isSkillEntryPoint(entry)));

export class SkillSourceState {
    public path = "";
    public revision = "";
    public text = "";
    private saved = "";
    private original = "";
    private newline = "\n";

    public load(path: string, content: string, revision: string) {
        this.path = path;
        this.original = content;
        this.revision = revision;
        const endings = content.match(/\r\n|\r|\n/g);
        this.newline = endings?.length && endings.every(ending => ending === endings[0]) ? endings[0] : "\n";
        this.text = content.replace(/\r\n?/g, "\n");
        this.saved = this.text;
    }

    public get dirty() {
        return this.text !== this.saved;
    }

    public get content() {
        if (!this.dirty) {
            return this.original;
        }
        return this.text.replace(/\n/g, this.newline);
    }

    public acceptSave(revision: string) {
        this.original = this.content;
        this.revision = revision;
        this.saved = this.text;
    }

    public discard() {
        this.text = this.saved;
    }
}
