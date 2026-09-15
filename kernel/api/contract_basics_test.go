package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractBasicRequests(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, entry := range []struct {
		path, body string
		handler    gin.HandlerFunc
		code       int
	}{
		{"/api/block/foldBlock", `{"id":"invalid"}`, foldBlock, -1},
		{"/api/block/unfoldBlock", `{"id":"invalid"}`, unfoldBlock, -1},
		{"/api/block/moveBlock", `{"id":"invalid"}`, moveBlock, -1},
		{"/api/block/getHeadingDeleteTransaction", `{"id":null}`, getHeadingDeleteTransaction, -1},
		{"/api/block/getHeadingInsertTransaction", `{"id":null}`, getHeadingInsertTransaction, -1},
		{"/api/block/getHeadingFoldTransaction", `{"id":"id","scope":null}`, getHeadingFoldTransaction, -1},
		{"/api/block/transferBlockRef", `{"fromID":"invalid","toID":"invalid"}`, transferBlockRef, -1},
		{"/api/block/swapBlockRef", `{"refID":"id","defID":"id","includeChildren":null}`, swapBlockRef, -1},
		{"/api/block/swapBlockRef", `{"refID":"id","defID":"id","includeChildren":false,"originalToEmbed":"true"}`, swapBlockRef, -1},
		{"/api/block/setBlockReminder", `{"id":"id","timed":null}`, setBlockReminder, -1},
		{"/api/block/getDocInfo", `{"id":null}`, getDocInfo, -1},
		{"/api/block/getDocsInfo", `{"ids":[],"refCount":null,"av":false}`, getDocsInfo, -1},
		{"/api/block/getTreeStat", `{"id":"invalid","includeEmbed":null}`, getTreeStat, -1},
		{"/api/block/getBlockTreeInfos", `{"ids":[null]}`, getBlockTreeInfos, -1},
		{"/api/block/getBlockBreadcrumb", `{"id":"id","excludeTypes":[1]}`, getBlockBreadcrumb, -1},
		{"/api/block/getBlockBreadcrumbChildren", `{"id":"invalid"}`, getBlockBreadcrumbChildren, -1},
		{"/api/block/getRefText", `{"id":"invalid"}`, getRefText, -1},
		{"/api/block/getRefIDs", `{"id":123}`, getRefIDs, -1},
		{"/api/block/getRefIDsByFileAnnotationID", `{"id":null}`, getRefIDsByFileAnnotationID, -1},
		{"/api/block/getBlockDefIDsByRefText", `{"anchor":null}`, getBlockDefIDsByRefText, -1},
		{"/api/block/getChildBlocks", `{"id":"invalid"}`, getChildBlocks, -1},
		{"/api/block/getTailChildBlocks", `{"id":"20260101000000-abcdefg","n":"1"}`, getTailChildBlocks, -1},
		{"/api/block/checkBlocksExist", `{"ids":null}`, checkBlocksExist, -1},
		{"/api/block/getBlocksWordCount", `{"ids":[null]}`, getBlocksWordCount, -1},
		{"/api/block/getOrderedListContinueStart", `{"id":" "}`, getOrderedListContinueStart, -1},
		{"/api/block/getBlockDOM", `{"id":null}`, getBlockDOM, -1},
		{"/api/block/getBlockDOMWithEmbed", `{"id":null}`, getBlockDOMWithEmbed, -1},
		{"/api/block/getBlockDOMs", `{"ids":[null]}`, getBlockDOMs, -1},
		{"/api/block/getBlockDOMsWithEmbed", `{"ids":[null]}`, getBlockDOMsWithEmbed, -1},
		{"/api/block/getBlockKramdown", `{"id":"20260101000000-abcdefg","mode":"invalid"}`, getBlockKramdown, -1},
		{"/api/block/getBlockKramdowns", `{"ids":[],"mode":"invalid"}`, getBlockKramdowns, -1},
		{"/api/notebook/setNotebookConf", `{"notebook":"invalid","conf":null}`, setNotebookConf, -1},
		{"/api/notebook/reorder", `{}`, reorderNotebooks, -1},
		{"/api/notebook/openNotebook", `{"notebook":"invalid"}`, openNotebook, -1},
		{"/api/notebook/getNotebookConf", `{"notebook":" 20260101000000-abcdefg "}`, getNotebookConf, -1},
		{"/api/notebook/enableEncryptedNotebooks", `{"password":" "}`, enableEncryptedNotebooks, -1},
		{"/api/notebook/createEncryptedNotebook", `{"name":"name","password":null}`, createEncryptedNotebook, -1},
		{"/api/notebook/unlockNotebook", `{"notebook":"invalid","password":"password"}`, unlockNotebook, -1},
		{"/api/notebook/unlockAndOpenNotebook", `{"notebook":"invalid","password":"password"}`, unlockAndOpenNotebook, -1},
		{"/api/notebook/lockNotebook", `{"notebook":"invalid"}`, lockNotebook, -1},
		{"/api/notebook/setNotebookCryptoAutoLock", `{"autoLockMinutes":"1"}`, setNotebookCryptoAutoLock, -1},
		{"/api/notebook/changeMasterPassword", `{"oldPassword":"old","newPassword":" "}`, changeMasterPassword, -1},
		{"/api/notebook/createNotebook", `{}`, createNotebook, -1},
		{"/api/notebook/setNotebookIcon", `{"notebook":"../escape","icon":""}`, setNotebookIcon, -1},
		{"/api/notebook/renameNotebook", `{"notebook":"invalid","name":"name"}`, renameNotebook, -1},
		{"/api/notebook/removeNotebook", `{"notebook":"invalid"}`, removeNotebook, -1},
		{"/api/notebook/closeNotebook", `{"notebook":" 20260101000000-abcdefg "}`, closeNotebook, -1},
		{"/api/notebook/changeSortNotebook", `{"notebooks":[null]}`, changeSortNotebook, -1},
		{"/api/system/currentTime", "", currentTime, 0},
		{"/api/system/bootProgress", "", bootProgress, 0},
		{"/api/system/getWorkspaceInfo", "", getWorkspaceInfo, 0},
		{"/api/block/getDOMText", `{"dom":null}`, getDOMText, -1},
		{"/api/system/setAutoLaunch", `{"autoLaunch":"1"}`, setAutoLaunch, -1},
		{"/api/system/setFollowSystemLockScreen", `{}`, setFollowSystemLockScreen, -1},
		{"/api/system/setNetworkServe", `{"networkServe":null}`, setNetworkServe, -1},
		{"/api/system/setNetworkServeTLS", `{"networkServeTLS":1}`, setNetworkServeTLS, -1},
		{"/api/system/setNetworkProxy", `{"scheme":"http","host":"host"}`, setNetworkProxy, -1},
		{"/api/system/setDownloadInstallPkg", `{"downloadInstallPkg":"true"}`, setDownloadInstallPkg, -1},
		{"/api/system/setUpdateChannel", `{"updateChannel":null}`, setUpdateChannel, -1},
		{"/api/setting/setEditorReadOnly", `{"readonly":1}`, setEditorReadOnly, -1},
		{"/api/setting/addVirtualBlockRefInclude", `{"keywords":[null]}`, addVirtualBlockRefInclude, -1},
		{"/api/setting/addVirtualBlockRefExclude", `{"keywords":1}`, addVirtualBlockRefExclude, -1},
		{"/api/attr/batchGetBlockAttrs", `{"ids":[null]}`, batchGetBlockAttrs, -1},
		{"/api/attr/batchSetBlockAttrs", `{"blockAttrs":[{}]}`, batchSetBlockAttrs, -1},
		{"/api/bookmark/removeBookmark", `{}`, removeBookmark, -1},
		{"/api/bookmark/renameBookmark", `{"oldBookmark":"a"}`, renameBookmark, -1},
		{"/api/tag/getTag", `{"sort":"1"}`, getTag, -1},
		{"/api/tag/removeTag", `{"label":null}`, removeTag, -1},
		{"/api/tag/renameTag", `{"oldLabel":"a","newLabel":" "}`, renameTag, -1},
	} {
		t.Run(entry.path, func(t *testing.T) {
			engine := gin.New()
			engine.POST(entry.path, entry.handler)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", entry.path, strings.NewReader(entry.body)))
			requireAPIContract(t, "POST", entry.path, recorder)
			var response struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code {
				t.Fatalf("unexpected response: %s, %v", recorder.Body.String(), err)
			}
		})
	}
}

func TestAPIContractTagConversion(t *testing.T) {
	for _, tags := range []model.Tags{nil, {}, {nil}, {&model.Tag{Name: "root", Label: "Root", Type: "tag", Depth: 1, Count: 2, Children: model.Tags{&model.Tag{Name: "child", Children: model.Tags{}}}}}} {
		before, err := json.Marshal(tags)
		if err != nil {
			t.Fatal(err)
		}
		after, err := json.Marshal(tagContracts(tags))
		if err != nil || string(before) != string(after) {
			t.Fatalf("tag JSON changed: %s != %s, %v", before, after, err)
		}
	}
}
