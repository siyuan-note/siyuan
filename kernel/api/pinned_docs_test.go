package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractPinnedDocs(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/filetree/getPinnedDocs", getPinnedDocs)
	engine.POST("/api/filetree/updatePinnedDocs", updatePinnedDocs)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/filetree/getPinnedDocs", nil))
	requireAPIContract(t, http.MethodPost, "/api/filetree/getPinnedDocs", response)
	if !strings.Contains(response.Body.String(), `"data":[]`) {
		t.Fatal(response.Body.String())
	}
	for _, body := range []string{`{}`, `{"ids":[],"action":"pin"}`, `{"ids":[null],"action":"pin"}`, `{"ids":["invalid"],"action":"pin"}`} {
		response = httptest.NewRecorder()
		engine.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/filetree/updatePinnedDocs", strings.NewReader(body)))
		requireAPIContract(t, http.MethodPost, "/api/filetree/updatePinnedDocs", response)
		if !strings.Contains(response.Body.String(), `"code":-1`) {
			t.Fatal(response.Body.String())
		}
	}
}

func TestAPIContractPinnedDocsMetadata(t *testing.T) {
	previousConf, previousData, previousBlockTree := model.Conf, util.DataDir, util.BlockTreeDBPath
	root := t.TempDir()
	util.DataDir, util.BlockTreeDBPath = filepath.Join(root, "data"), filepath.Join(root, "blocktree.db")
	model.Conf = model.NewAppConf()
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.Lang = "pinned-api-test"
	previousTimeLang, hadTimeLang := util.TimeLangs[model.Conf.Lang]
	util.TimeLangs[model.Conf.Lang] = map[string]any{}
	for _, key := range []string{"albl", "blbl", "now", "1s", "xs", "1m", "xm", "1h", "xh", "1d", "xd", "1w", "xw", "1M", "xM", "1y", "2y", "xy", "max"} {
		util.TimeLangs[model.Conf.Lang][key] = "time"
	}
	t.Cleanup(func() {
		treenode.CloseDatabase()
		if hadTimeLang {
			util.TimeLangs[model.Conf.Lang] = previousTimeLang
		} else {
			delete(util.TimeLangs, model.Conf.Lang)
		}
		model.Conf, util.DataDir, util.BlockTreeDBPath = previousConf, previousData, previousBlockTree
		if previousBlockTree != "" {
			treenode.InitBlockTree(false)
		}
	})
	treenode.InitBlockTree(true)
	box := &model.Box{ID: "20261017000000-pinapi1"}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "Pinned", false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	tree := treenode.NewTree(box.ID, "/20261017000001-pinapi1.sy", "/Pinned", "Pinned")
	attrs := map[string]string{"name": "Named", "alias": "Alias", "memo": "Memo <text>", "bookmark": "Bookmark"}
	for key, value := range attrs {
		tree.Root.SetIALAttr(key, value)
	}
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	t.Cleanup(func() { cache.RemoveTreeData(tree.ID); cache.RemoveDocIAL(tree.Path) })
	if err := model.UpdatePinnedDocs([]string{tree.ID}, "pin", "", false); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/filetree/getPinnedDocs", getPinnedDocs)
	for _, closed := range []bool{false, true} {
		boxConf.Closed = closed
		if err := box.SaveConf(boxConf); err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		engine.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/filetree/getPinnedDocs", nil))
		requireAPIContract(t, http.MethodPost, "/api/filetree/getPinnedDocs", response)
		var body struct {
			Code int                     `json:"code"`
			Data []apicontract.PinnedDoc `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.Code != 0 || len(body.Data) != 1 {
			t.Fatalf("unexpected response: %s, %v", response.Body.String(), err)
		}
		doc := body.Data[0]
		if doc.Unavailable != closed {
			t.Fatalf("incorrect availability: %+v", doc)
		}
		for _, detail := range []string{doc.HSize, doc.HMtime, doc.HCtime, doc.Name1, doc.Alias, doc.Memo, doc.Bookmark} {
			if (detail == "") != closed {
				t.Fatalf("incorrect detail for closed=%v: %+v", closed, doc)
			}
		}
		if !closed && (doc.Name1 != attrs["name"] || doc.Alias != attrs["alias"] || doc.Memo != attrs["memo"] || doc.Bookmark != attrs["bookmark"]) {
			t.Fatalf("metadata was lost in response: %+v", doc)
		}
	}
}
