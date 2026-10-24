import {fetchSyncPost} from "./fetch";
import {documentParentID} from "./documentCreate";
import {DocumentCreationAttempt} from "./documentCreationPlan";
import {showMessage} from "../dialog/message";
import {escapeHtml} from "./escape";
import {confirmDialog} from "../dialog/confirmDialog";
import type {Dialog} from "../dialog";
import type {DocumentCreatePlan, PlanDocCreateRequestInput} from "../types/api";

const attempts = new Map<string, {notebooks: string[]; attempt: DocumentCreationAttempt}>();
const maximumAttempts = 32;
const activeInputs = new Set<string>();
let lifecycleRevision = 0;
const recoveryDialogs = new Map<Dialog, string[]>();

export const clearDocumentCreationPlans = (notebook: string) => {
    lifecycleRevision++;
    for (const [dialog, notebooks] of recoveryDialogs) {
        if (notebooks.includes(notebook)) {
            recoveryDialogs.delete(dialog);
            dialog.destroy();
        }
    }
    for (const [key, value] of attempts) {
        if (value.notebooks.includes(notebook)) {
            // 关闭或锁定后不能继续保留标题和已求值模板。
            value.attempt.plan.steps.length = 0;
            value.attempt.plan.title = "";
            attempts.delete(key);
        }
    }
};

export const previewConfiguredDocument = (notebook: string, currentPath: string, purpose: "document" | "reference",
                                          title?: string, placement: "configured" | "child" = "configured", reuse = false,
                                          id = Lute.NewNodeID()) => {
    return fetchSyncPost("/api/filetree/planDocCreate", {
        notebook, contextID: documentParentID(currentPath || "/"), purpose, title, placement, reuse, id,
    });
};

export const createConfiguredDocument = async (input: Omit<PlanDocCreateRequestInput, "id"> & {id?: string}, options: {
    isValid?: () => boolean;
    onCreated: (id: string, title: string) => void;
    sortTargetID?: string;
    sortPosition?: "before" | "after";
    listDocTree?: boolean;
    plan?: DocumentCreatePlan;
}) => {
    const key = JSON.stringify(input);
    if (activeInputs.has(key)) {
        return;
    }
    activeInputs.add(key);
    const revision = lifecycleRevision;
    const isValid = () => lifecycleRevision === revision && (!options.isValid || options.isValid());
    let retained = attempts.get(key);
    try {
        if (!isValid()) {
            return;
        }
        if (!retained) {
            if (attempts.size + activeInputs.size > maximumAttempts) {
                showMessage(window.siyuan.languages.documentCreationLimit, 0, "error");
                return;
            }
            let plan = options.plan;
            if (!plan) {
                const response = await fetchSyncPost("/api/filetree/planDocCreate", {...input, id: input.id || Lute.NewNodeID()});
                if (response.code !== 0 || !response.data || !isValid()) {
                    return;
                }
                plan = response.data;
            }
            const last = plan.steps[plan.steps.length - 1];
            if (last) {
                last.sortTargetID = options.sortTargetID;
                last.sortPosition = options.sortPosition;
                last.listDocTree = options.listDocTree;
            }
            retained = {notebooks: [input.notebook, plan.notebook], attempt: new DocumentCreationAttempt(plan)};
            attempts.set(key, retained);
        }
        const attempt = retained.attempt;
        const id = await attempt.execute(request => fetchSyncPost("/api/filetree/createDocByParent", request), isValid);
        if (id && attempts.get(key) === retained) {
            attempts.delete(key);
            if (isValid()) {
                options.onCreated(id, attempt.plan.title);
            }
        }
    } catch (error) {
        if (lifecycleRevision !== revision) {
            return;
        }
        const attempt = retained?.attempt;
        // 只展示身份链接；保留原计划，未知结果和已提交副作用不自动继续。
        const ids = [...attempt?.completed || [], ...attempt?.uncertainID ? [attempt.uncertainID] : []];
        const message = `${escapeHtml((error as Error).message)}${ids.map(id =>
            ` <a href="siyuan://blocks/${id}">${id}</a>`).join("")}`;
        if (!attempt || !attempt.completed.length && !attempt.requiresReview) {
            attempts.delete(key);
            showMessage(message, 0, "error");
            return;
        }
        const dialog = confirmDialog(window.siyuan.languages.newFile,
            `${message}<br><br>${escapeHtml(window.siyuan.languages.documentCreationRecovery)}`, () => {
                recoveryDialogs.delete(dialog);
                void (async () => {
                    if (attempts.get(key) !== retained || options.isValid && !options.isValid()) {
                        return;
                    }
                    if (attempt.requiresReview) {
                        const step = attempt.plan.steps[attempt.next];
                        const response = await fetchSyncPost("/api/filetree/getDocPaths", {notebook: step.notebook, ids: [step.id]});
                        if (response.code !== 0 || !response.data || !("documents" in response.data)) {
                            return;
                        }
                        if (attempts.get(key) !== retained) {
                            return;
                        }
                        const document = response.data.documents.find(value => value.id === step.id);
                        if (!document && !response.data.missingIDs.includes(step.id)) {
                            throw new Error(window.siyuan.languages.documentCreationRecovery);
                        }
                        attempt.review(document);
                    }
                    await createConfiguredDocument(input, options);
                })().catch(error => {
                    if (attempts.get(key) === retained) {
                        showMessage(escapeHtml(error.message), 0, "error");
                    }
                });
            }, () => {
                recoveryDialogs.delete(dialog);
                if (lifecycleRevision === revision) {
                    showMessage(message, 0, "error");
                }
            });
        recoveryDialogs.set(dialog, retained.notebooks);
    } finally {
        activeInputs.delete(key);
    }
};
