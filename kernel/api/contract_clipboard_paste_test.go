package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractPasteAssets(t *testing.T) {
	const helper = "SIYUAN_TEST_CLIPBOARD_PASTE_ASSETS"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractPasteAssets$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("paste assets subprocess failed: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir, util.TempDir = filepath.Join(root, "data"), filepath.Join(root, "temp")
	util.ConfDir, util.HistoryDir = filepath.Join(root, "conf"), filepath.Join(root, "history")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath, util.HistoryDBPath = filepath.Join(util.TempDir, "siyuan.db"), filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(util.TempDir, "asset_content.db"), filepath.Join(util.TempDir, "blocktree.db")
	for _, dir := range []string{util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir, filepath.Join(util.DataDir, "assets")} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	model.Conf = model.NewAppConf()
	model.Conf.NotebookCrypto, model.Conf.FileTree = conf.NewNotebookCrypto(), conf.NewFileTree()
	model.Conf.Sync, model.Conf.System = conf.NewSync(), conf.NewSystem()
	model.Conf.Editor, model.Conf.Search, model.Conf.Export = conf.NewEditor(), conf.NewSearch(), conf.NewExport()
	model.Conf.Api = &conf.API{Token: "paste-assets-test"}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	const password = "clipboard fixture password"
	if err := model.EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := model.CreateEncryptedBox("Clipboard", password)
	if err != nil {
		t.Fatal(err)
	}
	defer model.LockBox(boxID)
	const source = "assets/example.txt"
	if err = os.WriteFile(filepath.Join(util.DataDir, filepath.FromSlash(source)), []byte("clipboard source"), 0600); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(boxLeaseMiddleware)
	engine.POST("/api/clipboard/preparePasteAssets", model.CheckAuth, model.CheckAdminRole, model.CheckReadonly, preparePasteAssets)
	post := func(body string, success bool) map[string]string {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, "/api/clipboard/preparePasteAssets", strings.NewReader(body))
		request.Header.Set("Authorization", "Token paste-assets-test")
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		requireAPIContract(t, http.MethodPost, request.URL.Path, recorder)
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || (response.Code == 0) != success {
			t.Fatalf("unexpected paste response: %s, %v", recorder.Body.String(), err)
		}
		var assets map[string]string
		if success {
			if err := json.Unmarshal(response.Data, &assets); err != nil || assets == nil {
				t.Fatalf("invalid asset mapping: %s", response.Data)
			}
		}
		return assets
	}
	body := `{"notebook":"` + boxID + `","assets":["` + source + `"]}`
	result := post(body, true)
	if !strings.Contains(result[source], "?box="+boxID) {
		t.Fatalf("missing target notebook: %#v", result)
	}
	content, err := model.ReadAssetBytesInBox(boxID, result[source])
	if err != nil || string(content) != "clipboard source" {
		t.Fatalf("copied attachment is unreadable: %q, %v", content, err)
	}
	for _, invalid := range []string{`{}`, `{"notebook":null,"assets":[]}`, `{"notebook":"` + boxID + `","assets":[null]}`,
		`{"notebook":"` + boxID + `","assets":[42]}`, `{"notebook":"invalid","assets":[]}`} {
		post(invalid, false)
	}
	util.ReadOnly = true
	post(body, false)
	util.ReadOnly = false
	model.LockBox(boxID)
	post(body, false)
}
