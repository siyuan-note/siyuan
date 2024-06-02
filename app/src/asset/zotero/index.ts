import { getInitAnnotations,getSelectedAnnotations,SaveAnnotations } from "./anno";

const {addScriptSync} = require('../../protyle/util/addScript')
const {Constants} = require('../../constants')
// addScriptSync(`${Constants.PROTYLE_CDN}/js/reader.js`, 'ZoteroScript')
export async function webViewerLoad(file:string, element:HTMLElement, pdfPage:number, annoId:string|number){
    let iframeElement = document.createElement("iframe");
    iframeElement.src = `${Constants.PROTYLE_CDN}/js/zotero/reader.html`;
    iframeElement.classList.add('pdf__outer')
    element.appendChild(iframeElement);
    await waitUntilIframeLoads(iframeElement);
    let iframeWindow = iframeElement.contentWindow;
    let createReader = (iframeWindow as any).createReader;
    if (createReader === undefined){
        console.error("undefine reader!")
        return
    }
	let annotations = await getInitAnnotations(file);
    let option = await createOption({
        filePath:file,
        annotations,
        state:{
            sidebarState: 9,
			pageIndex:pdfPage != undefined ? pdfPage-1 : 0
        }
    })
    let reader = createReader({
		onOpenContextMenu: (params:any) => {
            // console.log(params);
			// console.log(getSelectedAnnotations(reader))
			reader.openContextMenu(params);
		},
		onSaveAnnotations:async function (annotations:any) {
			console.log('Save annotations', annotations);
			SaveAnnotations(reader);
		},
		onDeleteAnnotations: function (ids:any) {
			console.log('Delete annotations', JSON.stringify(ids));
			SaveAnnotations(reader);
		},
		sidebarOpen:false,
        ...option
	});
    await waitUntilIframeLoads(reader._primaryView._iframe);
	(window as any).reader = reader
	return reader
}

export function webViewerPageNumberChanged(evt:{value:number, readerInstance:any,id?: string}){
	let mouseEvent = new MouseEvent('click', {
		bubbles: true, // 事件是否冒泡
		cancelable: true, // 事件是否可以取消
		view: window // 事件的视图（通常是窗口）
	});
	if (evt.id){
		evt.readerInstance.setSelectedAnnotations([evt.id],false,mouseEvent)
	}
	else{
		evt.readerInstance.navigate({
			"pageNumber": evt.value
		})
	}
}

async function waitUntilIframeLoads(iframeElement:HTMLIFrameElement) {
    return new Promise((resolve, reject) => {
        // 添加load事件监听器
        iframeElement.addEventListener('load', resolve);

        // 添加error事件监听器，以便在加载失败时拒绝Promise
        iframeElement.addEventListener('error', reject);
    });
}

let strings = {
	'zotero.appName': 'Zotero',
	'general.etAl': 'et al.',
	'general.back': 'Back',
	'general.thanksForHelpingImprove': 'Thanks for helping to improve %S!',
	'general.tryAgain': 'Try Again',
	'general.updateAvailable': 'Update Available',
	'general.copyToClipboard': 'Copy to Clipboard',
	'general.finished': 'Finished',
	'general.checkForUpdates': 'Check for Updates',
	'general.keys.cmdShift': 'Cmd+Shift+',
	'general.clear': 'Clear',
	'general.failed': 'Failed',
	'general.restartLater': 'Restart later',
	'general.unknownErrorOccurred': 'An unknown error occurred.',
	'general.dontShowAgainFor': 'Don’t show again today;Don’t show again for %1$S days',
	'general.permissionDenied': 'Permission Denied',
	'general.checkForUpdate': 'Check for Update',
	'general.moreInformation': 'More Information',
	'general.quitApp': 'Quit %S',
	'general.errorHasOccurred': 'An error has occurred.',
	'general.and': 'and',
	'general.isUpToDate': '%S is up to date.',
	'general.seeForMoreInformation': 'See %S for more information.',
	'general.success': 'Success',
	'general.submitted': 'Submitted',
	'general.character.plural': 'characters',
	'general.locate': 'Locate…',
	'general.restartNow': 'Restart now',
	'general.pleaseRestart': 'Please restart %S.',
	'general.quit': 'Quit',
	'general.hide': 'Hide',
	'general.browserIsOffline': '%S is currently in offline mode.',
	'general.error': 'Error',
	'general.import': 'Import',
	'general.warning': 'Warning',
	'general.yes': 'Yes',
	'general.useDefault': 'Use Default',
	'general.fix': 'Fix…',
	'general.restartRequiredForChanges': '%S must be restarted for the changes to take effect.',
	'general.accessDenied': 'Access Denied',
	'general.continue': 'Continue',
	'general.dontShowAgain': 'Don’t Show Again',
	'general.copy': 'Copy',
	'general.keys.ctrlShift': 'Ctrl+Shift+',
	'general.create': 'Create',
	'general.export': 'Export',
	'general.noUpdatesFound': 'No Updates Found',
	'general.restartRequired': 'Restart Required',
	'general.actionCannotBeUndone': 'This action cannot be undone.',
	'general.pdf': 'PDF',
	'general.remove': 'Remove',
	'general.cancel': 'Cancel',
	'general.tryLater': 'Try Later',
	'general.operationInProgress.waitUntilFinishedAndTryAgain': 'Please wait until it has finished and try again.',
	'general.processing': 'Processing',
	'general.disable': 'Disable',
	'general.restartApp': 'Restart %S',
	'general.enable': 'Enable',
	'general.showDirectory': 'Show Directory',
	'general.passed': 'Passed',
	'general.invalidResponseServer': 'Invalid response from server.',
	'general.reset': 'Reset',
	'general.nMegabytes': '%S MB',
	'general.numMore': '%S more…',
	'general.serverError': 'The server returned an error. Please try again.',
	'general.upgrade': 'Upgrade',
	'general.open': 'Open %S',
	'general.openPreferences': 'Open Preferences',
	'general.describeProblem': 'Briefly describe the problem:',
	'general.pleaseRestartAndTryAgain': 'Please restart %S and try again.',
	'general.operationInProgress.waitUntilFinished': 'Please wait until it has finished.',
	'general.dontShowWarningAgain': 'Don\'t show this warning again.',
	'general.notNow': 'Not Now',
	'general.item': 'Item',
	'general.restartRequiredForChange': '%S must be restarted for the change to take effect.',
	'general.character.singular': 'character',
	'general.operationInProgress': 'A Zotero operation is currently in progress.',
	'general.no': 'No',
	'general.delete': 'Delete',
	'general.openDocumentation': 'Open Documentation',
	'general.tryAgainLater': 'Please try again in a few minutes.',
	'general.install': 'Install',
	'general.yellow': 'Yellow',
	'general.red': 'Red',
	'general.green': 'Green',
	'general.blue': 'Blue',
	'general.purple': 'Purple',
	'general.magenta': 'Magenta',
	'general.orange': 'Orange',
	'general.gray': 'Gray',
	'general.black': 'Black',
	'general.showInLibrary': 'Show in Library',
	'general.clearSelection': 'Clear Selection',
	'general.update': 'Update',
	'general.print': 'Print',
	'pdfReader.annotations': 'Annotations',
	'pdfReader.showAnnotations': 'Show Annotations',
	'pdfReader.searchAnnotations': 'Search Annotations',
	'pdfReader.noAnnotations': 'Create an annotation to see it in the sidebar',
	'pdfReader.noExtractedText': 'No extracted text',
	'pdfReader.addComment': 'Add comment',
	'pdfReader.addTags': 'Add tags…',
	'pdfReader.highlightText': 'Highlight Text',
	'pdfReader.underlineText': 'Underline Text',
	'pdfReader.addNote': 'Add Note',
	'pdfReader.selectArea': 'Select Area',
	'pdfReader.addText': 'Add Text',
	'pdfReader.draw': 'Draw',
	'pdfReader.eraser': 'Eraser',
	'pdfReader.pickColor': 'Pick a Color',
	'pdfReader.addToNote': 'Add to Note',
	'pdfReader.zoomIn': 'Zoom In',
	'pdfReader.zoomOut': 'Zoom Out',
	'pdfReader.zoomReset': 'Reset Zoom',
	'pdfReader.zoomAuto': 'Automatically Resize',
	'pdfReader.zoomPageWidth': 'Zoom to Page Width',
	'pdfReader.zoomPageHeight': 'Zoom to Page Height',
	'pdfReader.splitVertically': 'Split Vertically',
	'pdfReader.splitHorizontally': 'Split Horizontally',
	'pdfReader.nextPage': 'Next Page',
	'pdfReader.previousPage': 'Previous Page',
	'pdfReader.page': 'Page',
	'pdfReader.location': 'Location',
	'pdfReader.readOnly': 'Read-only',
	'pdfReader.promptTransferFromPDF.title': 'Import Annotations',
	'pdfReader.promptTransferFromPDF.text': 'Annotations stored in the PDF file will be moved to %1$S.',
	'pdfReader.promptTransferToPDF.title': 'Store Annotations in File',
	'pdfReader.promptTransferToPDF.text': 'Annotations will be transferred to the PDF file and will no longer be editable in %S.',
	'pdfReader.promptPasswordProtected': 'The operation is not supported for password-protected PDF files.',
	'pdfReader.rotateLeft': 'Rotate Left',
	'pdfReader.rotateRight': 'Rotate Right',
	'pdfReader.editPageNumber': 'Edit Page Number…',
	'pdfReader.editAnnotationText': 'Edit Annotation Text',
	'pdfReader.copyImage': 'Copy Image',
	'pdfReader.saveImageAs': 'Save Image As…',
	'pdfReader.pageNumberPopupHeader': 'Change page number for:',
	'pdfReader.thisAnnotation': 'This annotation',
	'pdfReader.selectedAnnotations': 'Selected annotations',
	'pdfReader.thisPage': 'This page',
	'pdfReader.thisPageAndLaterPages': 'This page and later pages',
	'pdfReader.allPages': 'All pages',
	'pdfReader.autoDetect': 'Auto-Detect',
	'pdfReader.deleteAnnotation.singular': 'Are you sure you want to delete the selected annotation?',
	'pdfReader.deleteAnnotation.plural': 'Are you sure you want to delete the selected annotations?',
	'pdfReader.enterPassword': 'Enter the password to open this PDF file.',
	'pdfReader.includeAnnotations': 'Include annotations',
	'pdfReader.preparingDocumentForPrinting': 'Preparing document for printing…',
	'pdfReader.phraseNotFound': 'Phrase not found',
	'pdfReader.selectedPages': '{count, plural, one {# page} other {# pages}} selected',
	'pdfReader.pageOptions': 'Page Options',
	'pdfReader.epubEncrypted': 'This ebook appears to be encrypted and cannot be opened.'
};


async function createOption(fileInfo:{filePath:string,annotations:Array<any>,state:any}) {
	if ((globalThis as any)._reader) {
		throw new Error('Reader is already initialized');
	}
	let queryString = window.location.search;
	let urlParams = new URLSearchParams(queryString);
	let type = 'pdf';
	let demo = fileInfo;
	let res = await fetch(demo.filePath);
	let option = {
		type,
		localizedStrings: strings,
		readOnly: false,
		data: {
			buf: new Uint8Array(await res.arrayBuffer()),
			url: new URL('/',( window.location.toString())).toString(),
			filePath:fileInfo.filePath
		},
		// rtl: true,
		annotations: demo.annotations,
		primaryViewState: demo.state,
		sidebarWidth: 240,
		bottomPlaceholderHeight: null as any,
		toolbarPlaceholderWidth: 0,
		authorName: 'John',
		showAnnotations: true,
        useDarkModeForContent:false,
		// platform: 'web',
		// password: 'test',
		onAddToNote() {
			alert('Add annotations to the current note');
		},
		onChangeViewState: function (state:any, primary:any) {
			console.log('Set state', state, primary);
		},
		onOpenTagsPopup(annotationID:any, left:any, top:any) {
			alert(`Opening Zotero tagbox popup for id: ${annotationID}, left: ${left}, top: ${top}`);
		},
		onClosePopup(data:any) {
			console.log('onClosePopup', data);
		},
		onOpenLink(url:any) {
			alert('Navigating to an external link: ' + url);
		},
		onToggleSidebar: (open:any) => {
			console.log('Sidebar toggled', open);
		},
		onChangeSidebarWidth(width:any) {
			console.log('Sidebar width changed', width);
		},
		onSetDataTransferAnnotations(dataTransfer:any, annotations:any, fromText:any) {
			console.log('Set formatted dataTransfer annotations', dataTransfer, annotations, fromText);
		},
		onConfirm(title:any, text:any, confirmationButtonTitle:any) {
			return window.confirm(text);
		},
		onRotatePages(pageIndexes:any, degrees:any) {
			console.log('Rotating pages', pageIndexes, degrees);
		},
		onDeletePages(pageIndexes:any, degrees:any) {
			console.log('Deleting pages', pageIndexes, degrees);
		},
		onToggleContextPane() {
			console.log('Toggle context pane');
		}
	}
    return option
}