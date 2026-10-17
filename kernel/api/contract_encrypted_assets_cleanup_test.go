package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractEncryptedAssetCleanupAdmission(t *testing.T) {
	_, boxID := setupArchiveWorkspace(t)
	previous := model.Conf
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf = previous })
	engine := gin.New()
	engine.Use(boxLeaseMiddleware)
	engine.POST("/api/asset/getUnusedEncryptedBoxAssets", getUnusedEncryptedBoxAssets)
	engine.POST("/api/asset/removeUnusedEncryptedBoxAssets", removeUnusedEncryptedBoxAssets)
	for _, endpoint := range []string{"getUnusedEncryptedBoxAssets", "removeUnusedEncryptedBoxAssets"} {
		url := "/api/asset/" + endpoint
		for _, notebook := range []string{boxID, "", "../assets"} {
			body := `{"notebook":"` + notebook + `","paths":[]}`
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", url, strings.NewReader(body)))
			requireAPIContract(t, "POST", url, recorder)
			var response struct {
				Code int             `json:"code"`
				Msg  string          `json:"msg"`
				Data json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || string(response.Data) != "null" {
				t.Fatalf("invalid cleanup admission: %s, %v", recorder.Body.String(), err)
			}
			if notebook == boxID && response.Msg != model.Conf.Language(314) {
				t.Fatalf("locked notebook message changed: %s", response.Msg)
			}
		}
	}
}

func TestAPIContractEncryptedAssetCleanupRoundTrip(t *testing.T) {
	const child = "SIYUAN_TEST_ENCRYPTED_ASSET_CLEANUP"
	if os.Getenv(child) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractEncryptedAssetCleanupRoundTrip$", "-test.timeout=55s", "-test.v")
		cmd.Env = append(os.Environ(), child+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated encrypted asset API test: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir = filepath.Join(root, "data"), filepath.Join(root, "temp"), filepath.Join(root, "conf"), filepath.Join(root, "history")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath, util.HistoryDBPath = filepath.Join(util.TempDir, util.DBName), filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(util.TempDir, "asset_content.db"), filepath.Join(util.TempDir, "blocktree.db")
	for _, dir := range []string{util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	model.Conf = model.NewAppConf()
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Export.Store(conf.NewExport())
	model.Conf.Search.Store(conf.NewSearch())
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	if err := model.EnableEncryptedNotebook("cleanup-test-password"); err != nil {
		t.Fatal(err)
	}
	boxID, err := model.CreateEncryptedBox("Cleanup", "cleanup-test-password")
	if err != nil {
		t.Fatal(err)
	}
	defer model.LockBox(boxID)
	dek, err := model.GetDEKIfUnlocked(boxID)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(dek)
	ciphertext, err := model.EncryptAsset(boxID, "unused.png", "private-name.png", dek, []byte("private-content"))
	if err != nil {
		t.Fatal(err)
	}
	asset := filepath.Join(util.DataDir, boxID, "assets", "unused.png")
	if err = os.MkdirAll(filepath.Dir(asset), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(asset, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.Use(boxLeaseMiddleware)
	engine.Use(func(c *gin.Context) {
		c.Next()
		// 外层响应尚未退出，独立清理必须被当前请求保留的租约拒绝。
		if _, err := model.UnusedEncryptedBoxAssets(context.Background(), boxID); err == nil {
			t.Error("cleanup response released its notebook lease before middleware completion")
		}
	})
	engine.POST("/api/asset/getUnusedEncryptedBoxAssets", getUnusedEncryptedBoxAssets)
	engine.POST("/api/asset/removeUnusedEncryptedBoxAssets", removeUnusedEncryptedBoxAssets)
	call := func(endpoint, body string) []byte {
		t.Helper()
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", endpoint, strings.NewReader(body)))
		requireAPIContract(t, "POST", endpoint, recorder)
		return recorder.Body.Bytes()
	}
	func() {
		if err := model.AcquireEncryptedBoxOperation(boxID); err != nil {
			t.Fatal(err)
		}
		defer model.ReleaseEncryptedBoxOperation(boxID)
		for _, endpoint := range []string{"getUnusedEncryptedBoxAssets", "removeUnusedEncryptedBoxAssets"} {
			data := call("/api/asset/"+endpoint, `{"notebook":"`+boxID+`","paths":["assets/unused.png"]}`)
			var response struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(data, &response); err != nil || response.Code != -1 {
				t.Fatalf("cleanup accepted another active request: %s, %v", data, err)
			}
		}
	}()
	var listed struct {
		Code int                            `json:"code"`
		Data []*apicontract.AssetUnusedItem `json:"data"`
	}
	data := call("/api/asset/getUnusedEncryptedBoxAssets", `{"notebook":"`+boxID+`"}`)
	if err = json.Unmarshal(data, &listed); err != nil || listed.Code != 0 || len(listed.Data) != 1 || listed.Data[0].Name != "private-name.png" {
		t.Fatalf("scoped scan response: %s, %v", data, err)
	}
	var removed struct {
		Code int                        `json:"code"`
		Data apicontract.AssetPathsData `json:"data"`
	}
	data = call("/api/asset/removeUnusedEncryptedBoxAssets", `{"notebook":"`+boxID+`","paths":["assets/unused.png"]}`)
	if err = json.Unmarshal(data, &removed); err != nil || removed.Code != 0 || len(removed.Data.Paths) != 1 {
		t.Fatalf("scoped cleanup response: %s, %v", data, err)
	}
	if _, err = os.Stat(asset); !os.IsNotExist(err) {
		t.Fatal("cleanup did not remove the confirmed resource")
	}
	history, _ := filepath.Glob(filepath.Join(util.HistoryDir, "*-clean", boxID, "assets", "unused.png"))
	if len(history) != 1 {
		t.Fatalf("missing history: %v", history)
	}
	stored, err := os.ReadFile(history[0])
	if err != nil || !bytes.Equal(stored, ciphertext) {
		t.Fatal("cleanup history did not preserve ciphertext")
	}
	sql.FlushHistoryQueue()
	rows, err := sql.QueryHistory("SELECT title, content, path FROM histories_fts_case_insensitive")
	if err != nil || len(rows) != 1 || rows[0]["title"] != "unused.png" || rows[0]["content"] != "" ||
		!strings.Contains(rows[0]["path"].(string), "/"+boxID+"/assets/unused.png") {
		t.Fatalf("unexpected global history metadata: %v, %v", rows, err)
	}
	model.LockBox(boxID)
	rows, err = sql.QueryHistory("SELECT title, content FROM histories_fts_case_insensitive")
	if err != nil || len(rows) != 1 || rows[0]["title"] != "unused.png" || rows[0]["content"] != "" {
		t.Fatalf("locking changed metadata retention: %v, %v", rows, err)
	}
}
