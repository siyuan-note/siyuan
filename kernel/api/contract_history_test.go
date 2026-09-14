package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractNotebookHistory(t *testing.T) {
	previousHistory, previousWorkspace := util.HistoryDir, util.WorkspaceDir
	util.WorkspaceDir = t.TempDir()
	util.HistoryDir = filepath.Join(util.WorkspaceDir, "history")
	t.Cleanup(func() { util.HistoryDir, util.WorkspaceDir = previousHistory, previousWorkspace })
	engine := gin.New()
	engine.POST("/api/history/getNotebookHistory", getNotebookHistory)
	call := func() []*apicontract.History {
		t.Helper()
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/history/getNotebookHistory", strings.NewReader("ignored invalid JSON")))
		requireAPIContract(t, "POST", "/api/history/getNotebookHistory", recorder)
		var response struct {
			Code int                             `json:"code"`
			Data apicontract.NotebookHistoryData `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
			t.Fatalf("notebook history failed: %s, %v", recorder.Body.String(), err)
		}
		return response.Data.Histories
	}
	if histories := call(); histories == nil || len(histories) != 0 {
		t.Fatalf("empty history must return an array: %+v", histories)
	}
	for _, date := range []string{"2026-01-01-010203", "2026-01-02-030405"} {
		folder := filepath.Join(util.HistoryDir, date+"-delete", "box", ".siyuan")
		if err := os.MkdirAll(folder, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(folder, "conf.json"), []byte(`{"name":"archived notebook"}`), 0600); err != nil {
			t.Fatal(err)
		}
	}
	histories := call()
	if len(histories) != 2 || histories[0].HCreated != "2026-01-02 03:04:05" || len(histories[0].Items) != 1 || histories[0].Items[0].Title != "archived notebook" || histories[0].Items[0].Path != "/history/2026-01-02-030405-delete/box" {
		t.Fatalf("notebook history sorting or metadata changed: %+v", histories)
	}
}

func TestAPIContractDocHistoryLockedNotebook(t *testing.T) {
	_, boxID := setupArchiveWorkspace(t)
	previous := model.Conf
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf = previous })
	engine := gin.New()
	engine.POST("/api/history/getDocHistoryContent", getDocHistoryContent)
	engine.POST("/api/history/rollbackDocHistory", rollbackDocHistory)
	engine.POST("/api/history/rollbackAssetsHistory", rollbackAssetsHistory)
	engine.POST("/api/history/rollbackAttributeViewHistory", rollbackAttributeViewHistory)
	path := "history/2026-01-01-010203-update/" + boxID + "/20260101000000-abcdefg.sy"
	for _, route := range []string{"getDocHistoryContent", "rollbackDocHistory", "rollbackAssetsHistory", "rollbackAttributeViewHistory"} {
		endpoint := "/api/history/" + route
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", endpoint, strings.NewReader(`{"historyPath":" `+path+` ","highlight":false}`)))
		requireAPIContract(t, "POST", endpoint, recorder)
		var response struct {
			Code int             `json:"code"`
			Msg  string          `json:"msg"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || response.Msg != model.Conf.Language(314) || string(response.Data) != "null" {
			t.Fatalf("locked history response changed: %s, %v", recorder.Body.String(), err)
		}
	}
}

func TestAPIContractHistoryCreationValidation(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/history/createDocHistory", createDocHistory)
	engine.POST("/api/history/createAssetHistory", createAssetHistory)
	for _, path := range []string{"/api/history/createDocHistory", "/api/history/createAssetHistory"} {
		for _, body := range []string{`{`, `{}`, `{"id":" ","path":" "}`, `{"id":false,"path":false}`} {
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
			requireAPIContract(t, "POST", path, recorder)
			var response struct {
				Code int             `json:"code"`
				Data json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || string(response.Data) != "null" {
				t.Fatalf("history validation changed: %s, %v", recorder.Body.String(), err)
			}
		}
	}
}

func TestAPIContractDocVersionDiffConversion(t *testing.T) {
	for _, diff := range []*model.DocVersionDiffResult{nil, {}, {
		Left:        &model.DocVersionDiffContent{ID: "left", RootID: "root", Title: "title", Content: "content"},
		Right:       &model.DocVersionDiffContent{ID: "right"},
		Differences: []*model.DocVersionDifference{nil, {ID: "block", Statuses: []string{"modified", "moved"}}},
		Large:       true, Fallback: true, Message: "message", TitleModified: true,
	}} {
		expected, err := json.Marshal(diff)
		if err != nil {
			t.Fatal(err)
		}
		converted := docVersionDiffContract(diff)
		actual, err := json.Marshal(converted)
		if err != nil || string(expected) != string(actual) {
			t.Fatalf("document diff changed: %s != %s, %v", expected, actual, err)
		}
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.JSON(200, apicontract.Success(converted))
		requireAPIContract(t, "POST", "/api/history/diffDocVersions", recorder)
	}
}

func TestAPIContractDocVersionDiffValidation(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/history/diffDocVersions", diffDocVersions)
	for _, entry := range []struct{ body, message string }{
		{`{}`, "left document version is required"},
		{`{"left":{},"right":false}`, "right document version is required"},
		{`{"left":{},"right":{}}`, "Field [type] is required"},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/history/diffDocVersions", strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", "/api/history/diffDocVersions", recorder)
		var response struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || response.Msg != entry.message {
			t.Fatalf("diff validation changed: %s, %v", recorder.Body.String(), err)
		}
	}
}
