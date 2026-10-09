//go:build fts5 && (sqlcipher || libsqlcipher)

package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractMarkdownFootnotes(t *testing.T) {
	const helper = "SIYUAN_TEST_MARKDOWN_FOOTNOTES"
	if os.Getenv(helper) != "1" {
		// 独立进程隔离导入事务、数据库及加密笔记本状态。
		ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractMarkdownFootnotes$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("footnote import subprocess failed: %v\n%s", err, output)
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
	util.WorkingDir = filepath.Join(root, "working")
	for _, dir := range []string{util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	model.Conf = model.NewAppConf()
	model.Conf.Lang = "footnotes-test"
	util.TimeLangs[model.Conf.Lang] = map[string]any{
		"albl": "ago", "blbl": "from now", "now": "now", "1s": "1 second %s", "xs": "%d seconds %s",
		"1m": "1 minute %s", "xm": "%d minutes %s", "1h": "1 hour %s", "xh": "%d hours %s", "1d": "1 day %s",
		"xd": "%d days %s", "1w": "1 week %s", "xw": "%d weeks %s", "1M": "1 month %s", "xM": "%d months %s",
		"1y": "1 year %s", "2y": "2 years %s", "xy": "%d years %s", "max": "a long while %s",
	}
	model.Conf.NotebookCrypto, model.Conf.FileTree = conf.NewNotebookCrypto(), conf.NewFileTree()
	model.Conf.Sync, model.Conf.System = conf.NewSync(), conf.NewSystem()
	model.Conf.Editor, model.Conf.Search, model.Conf.Export = conf.NewEditor(), conf.NewSearch(), conf.NewExport()
	model.Conf.Api = &conf.API{Token: "footnotes-test"}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	treenode.InitBlockTree(true)
	defer treenode.CloseDatabase()
	const markdown = "First[^note_key].\n\nSecond[^note_key].\n\nThird[^list_note].\n\nFourth[^list_note].\n\n[^note_key]: Confidential footnote\n\n    Second paragraph\n\n[^list_note]: - Nested first\n    - Nested second\n"
	source := filepath.Join(testutil.PublicDataDir(t), "footnotes.md")
	if err := os.WriteFile(source, []byte(markdown), 0600); err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(filepath.Dir(source), "directory")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "nested.md"), []byte(markdown), 0600); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.Use(boxLeaseMiddleware)
	engine.POST("/api/filetree/createDocWithMd", model.CheckAuth, model.CheckAdminRole, model.CheckReadonly, createDocWithMd)
	engine.POST("/api/import/importStdMd", model.CheckAuth, model.CheckAdminRole, model.CheckReadonly, importStdMd)
	post := func(route string, payload map[string]string, success bool) json.RawMessage {
		t.Helper()
		body, _ := json.Marshal(payload)
		request := httptest.NewRequest(http.MethodPost, route, bytes.NewReader(body))
		request.Header.Set("Authorization", "Token footnotes-test")
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		requireAPIContract(t, http.MethodPost, route, recorder)
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || (response.Code == 0) != success {
			t.Fatalf("%s: %s, %v", route, recorder.Body.String(), err)
		}
		return response.Data
	}
	for _, encrypted := range []bool{false, true} {
		var boxID string
		var err error
		if encrypted {
			const password = "footnotes-test-password"
			if err = model.EnableEncryptedNotebook(password); err != nil {
				t.Fatal(err)
			}
			boxID, err = model.CreateEncryptedBox("Encrypted footnotes", password)
		} else {
			boxID, err = model.CreateBox("Footnotes")
		}
		if err != nil {
			t.Fatal(err)
		}
		if _, err = model.Mount(boxID); err != nil {
			t.Fatal(err)
		}
		create := map[string]string{"notebook": boxID, "path": "/API footnotes", "markdown": markdown}
		var id string
		if err = json.Unmarshal(post("/api/filetree/createDocWithMd", create, true), &id); err != nil || id == "" {
			t.Fatalf("invalid document ID: %q, %v", id, err)
		}
		importRequest := map[string]string{"notebook": boxID, "localPath": source, "toPath": "/"}
		if data := post("/api/import/importStdMd", importRequest, true); string(data) != "null" {
			t.Fatalf("unexpected import result: %s", data)
		}
		post("/api/import/importStdMd", map[string]string{"notebook": boxID, "localPath": directory, "toPath": "/"}, true)
		model.FlushTxQueue()
		sql.FlushQueue()
		for _, hpath := range []string{"/API footnotes", "/footnotes", "/directory/nested"} {
			block := treenode.GetBlockTreeRootByHPath(boxID, hpath)
			if block == nil {
				t.Fatalf("missing imported document %s", hpath)
			}
			tree, err := filesys.LoadTree(boxID, block.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			count := 0
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && treenode.IsBlockRef(n) {
					count++
					def := treenode.GetNodeInTree(tree, n.TextMarkBlockRefID)
					if def == nil || def.Type != ast.NodeListItem || !n.IsTextMarkType("sup") {
						t.Errorf("lost footnote target or content in %s", hpath)
						return ast.WalkContinue
					}
					if n.TextMarkTextContent == "[list_note]" {
						if def.FirstChild == nil || def.FirstChild.Type != ast.NodeParagraph || def.FirstChild.ID == "" ||
							def.FirstChild.Text() != "" || def.Text() != "Nested firstNested second" {
							t.Errorf("lost nested footnote structure in %s", hpath)
						}
					} else if def.Text() != "Confidential footnoteSecond paragraph" {
						t.Errorf("lost multi-paragraph footnote in %s", hpath)
					}
					if refs := sql.QueryRefsByDefIDInBox(n.TextMarkBlockRefID, false, boxID); len(refs) != 2 {
						t.Errorf("expected two backlinks in %s, got %d", hpath, len(refs))
					}
				}
				return ast.WalkContinue
			})
			if count != 4 {
				t.Fatalf("expected four references in %s, got %d", hpath, count)
			}
			if text := tree.Root.FirstChild.Text(); text != "First[note_key]." {
				t.Fatalf("footnote label altered paragraph in %s: %q", hpath, text)
			}
			data, err := os.ReadFile(filepath.Join(util.DataDir, boxID, block.Path))
			if err != nil || util.IsCiphertext(data) != encrypted {
				t.Fatalf("document encryption changed: %v", err)
			}
		}
		if encrypted {
			model.LockBox(boxID)
			post("/api/filetree/createDocWithMd", create, false)
			post("/api/import/importStdMd", importRequest, false)
		}
	}
}
