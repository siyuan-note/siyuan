const {createRequire} = require("node:module");
const path = require("node:path");

module.exports = async ({annotations = false} = {}) => {
    const requireBuild = createRequire(require.resolve("esbuild-loader"));
    const mocks = {
        "../anno": `export const getHighlight = element => { element.dataset.highlightRestored = "true"; };
            export const initAnno = () => {}; export const destroyAnno = () => {};
            export const getPdfInstance = () => null; export const hlPDFRect = () => {};`,
        "../annoRuntime": "export const registerPdfInstance = () => {};",
        "../../constants": "export const Constants = {PROTYLE_CDN: '/stage/protyle', SIZE_UNDO: 100, LOCAL_PDFTHEME: 'pdf'};",
        "../../protyle/util/compatibility": "export const setStorageVal = async () => {}; export const updateHotkeyTip = x => x;",
        "../../protyle/util/hasClosest": "export const hasClosestByClassName = (el, name) => el.closest?.('.' + name);",
    };
    if (annotations) {
        delete mocks["../anno"];
        delete mocks["../annoRuntime"];
    }
    const annotationMocks = {
        "../util/fetch": `export const fetchPost = (url, data, callback) => {
            if (url.endsWith('/setFileAnnotation')) window.pdfSavedAnnotations = JSON.parse(data.data);
            callback?.({code: 0, data: {data: JSON.stringify(window.pdfSavedAnnotations || {})}});
        };`,
        "../layout/getAll": "export const getAllModels = () => ({asset: []});",
        "../protyle/util/compatibility": "export const setStorageVal = () => {}; export const readText = async () => ''; export const writeText = text => {window.pdfCopiedText = text;};",
        "../constants": mocks["../../constants"],
        "../dialog": "export class Dialog {}",
        "../dialog/message": "export const showMessage = () => {};",
        "../dialog/confirmDialog": "export const confirmDialog = () => {};",
        "../util/functions": "export const isMobile = () => window.pdfTestMobile === true;",
        "../protyle/upload": "export const uploadStandaloneAssetFiles = async () => ({code: 0, data: {succMap: {}}});",
    };
    const result = await requireBuild("esbuild").build({
        stdin: {
            contents: `export {StructTreeLayerBuilder} from './struct_tree_layer_builder.js';
                export {webViewerLoad} from './viewer.js';
                export {getPdfViewerHTML} from './viewerTemplate.ts';
                export {getPdfSelectionText} from '../pdfSelectionText.ts';
                export {TextLayerBuilder} from './text_layer_builder.js';
                export {PDFViewer} from './pdf_viewer.js';
                export {PDFThumbnailViewer} from './pdf_thumbnail_viewer.js';`,
            resolveDir: path.resolve(__dirname, "../src/asset/pdf"),
        },
        bundle: true, write: false, format: "esm", platform: "browser",
        plugins: [{name: "siyuan-test-boundaries", setup(build) {
            build.onResolve({filter: /.*/}, args => annotations && args.importer.endsWith("/asset/anno.ts") && Object.hasOwn(annotationMocks, args.path)
                ? {path: args.path, namespace: "siyuan-annotation-mock"} : undefined);
            build.onLoad({filter: /.*/, namespace: "siyuan-annotation-mock"}, args => ({contents: annotationMocks[args.path], loader: "js"}));
            build.onResolve({filter: /.*/}, args => Object.hasOwn(mocks, args.path)
                ? {path: args.path, namespace: "siyuan-mock"} : undefined);
            build.onLoad({filter: /.*/, namespace: "siyuan-mock"}, args => ({contents: mocks[args.path], loader: "js"}));
        }}],
    });
    return result.outputFiles[0].text;
};
