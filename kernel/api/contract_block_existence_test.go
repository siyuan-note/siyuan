//go:build (sqlcipher || libsqlcipher) && cgo

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractCheckBlocksExist(t *testing.T) {
	const helper = "SIYUAN_TEST_BLOCK_EXISTENCE"
	if os.Getenv(helper) != "1" {
		// 使用独立进程隔离数据库、密钥及异步索引。
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractCheckBlocksExist$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("block existence subprocess failed: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir = filepath.Join(root, "data"), filepath.Join(root, "temp"), filepath.Join(root, "conf"), filepath.Join(root, "history")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath, util.HistoryDBPath, util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(util.TempDir, util.DBName), filepath.Join(util.TempDir, "history.db"), filepath.Join(util.TempDir, "asset_content.db"), filepath.Join(util.TempDir, "blocktree.db")
	for _, dir := range []string{util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	model.Conf = model.NewAppConf()
	model.Conf.NotebookCrypto, model.Conf.Sync, model.Conf.FileTree = conf.NewNotebookCrypto(), conf.NewSync(), conf.NewFileTree()
	model.Conf.Editor, model.Conf.Export, model.Conf.Search = conf.NewEditor(), conf.NewExport(), conf.NewSearch()
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	if err := model.EnableEncryptedNotebook("existence-password"); err != nil {
		t.Fatal(err)
	}
	var boxes []string
	for range 2 {
		boxID, err := model.CreateEncryptedBox("Block existence", "existence-password")
		if err != nil {
			t.Fatal(err)
		}
		boxes = append(boxes, boxID)
		defer model.LockBox(boxID)
	}
	normalBox, normalID, encryptedID, cutID, missingID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	index := func(boxID, id string) {
		t.Helper()
		treenode.UpsertBlockTree(&parse.Tree{ID: id, Box: boxID, Path: "/" + id + ".sy", Root: &ast.Node{ID: id, Type: ast.NodeDocument}})
	}
	index(normalBox, normalID)
	index(boxes[0], encryptedID)
	index(boxes[0], cutID)
	index(boxes[1], boxes[1])
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(boxLeaseMiddleware)
	role := model.RoleAdministrator
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
	engine.POST("/api/block/checkBlocksExist", checkBlocksExist)
	post := func(t *testing.T, ids any, notebook string, wantCode int, want map[string]bool) {
		t.Helper()
		args := map[string]any{"ids": ids}
		if notebook != "" {
			args["notebook"] = notebook
		}
		body, err := json.Marshal(args)
		if err != nil {
			t.Fatal(err)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/block/checkBlocksExist", strings.NewReader(string(body))))
		requireAPIContract(t, http.MethodPost, "/api/block/checkBlocksExist", recorder)
		var response struct {
			Code int             `json:"code"`
			Data map[string]bool `json:"data"`
		}
		if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != wantCode || !reflect.DeepEqual(response.Data, want) {
			t.Fatalf("existence query %s: %s, want code %d data %v, %v", body, recorder.Body.String(), wantCode, want, err)
		}
	}
	t.Run("copy and mixed notebook batch", func(t *testing.T) {
		post(t, []string{normalID, encryptedID, boxes[1], missingID, encryptedID}, "", 0,
			map[string]bool{normalID: true, encryptedID: true, boxes[1]: true, missingID: false})
	})
	t.Run("explicit encrypted notebook", func(t *testing.T) {
		post(t, []string{normalID, encryptedID, boxes[1], missingID}, boxes[0], 0,
			map[string]bool{normalID: false, encryptedID: true, boxes[1]: false, missingID: false})
	})
	t.Run("ordinary notebook parameter compatibility", func(t *testing.T) {
		post(t, []string{normalID, encryptedID}, normalBox, 0, map[string]bool{normalID: true, encryptedID: true})
	})
	t.Run("empty batch", func(t *testing.T) {
		post(t, []string{}, "", 0, map[string]bool{})
	})
	t.Run("ignored values", func(t *testing.T) {
		post(t, []any{nil, 42, true, "invalid", encryptedID}, "", 0, map[string]bool{encryptedID: true})
	})
	t.Run("cut block", func(t *testing.T) {
		post(t, []string{cutID}, "", 0, map[string]bool{cutID: true})
		treenode.RemoveBlockTree(boxes[0], cutID)
		post(t, []string{cutID}, "", 0, map[string]bool{cutID: false})
	})
	t.Run("publish reader", func(t *testing.T) {
		role = model.RoleReader
		defer func() { role = model.RoleAdministrator }()
		post(t, []string{normalID, encryptedID, boxes[1]}, "", 0, map[string]bool{normalID: true})
		post(t, []string{encryptedID}, boxes[0], 0, map[string]bool{})
	})
	t.Run("locked notebook", func(t *testing.T) {
		model.LockBox(boxes[0])
		post(t, []string{normalID, encryptedID, boxes[1]}, "", 0, map[string]bool{normalID: true, encryptedID: false, boxes[1]: true})
		post(t, []string{encryptedID}, boxes[0], -1, nil)
	})
}
