package api

import (
	archivezip "archive/zip"
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractExportHeadingNumbers(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_EXPORT_HEADING_NUMBERS") != "1" {
		// 导出使用进程级数据库和缓存，通过独立测试进程隔离夹具。
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractExportHeadingNumbers$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_EXPORT_HEADING_NUMBERS=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("heading number export subprocess failed: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.DataDir, util.TempDir, util.ConfDir = filepath.Join(root, "data"), root, root
	util.QueueDir = filepath.Join(root, "queue")
	util.DBPath, util.HistoryDBPath = filepath.Join(root, "siyuan.db"), filepath.Join(root, "history.db")
	util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(root, "asset_content.db"), filepath.Join(root, "blocktree.db")
	model.Conf = model.NewAppConf()
	model.Conf.FileTree, model.Conf.Sync = conf.NewFileTree(), conf.NewSync()
	model.Conf.Search, model.Conf.Editor, model.Conf.Export = conf.NewSearch(), conf.NewEditor(), conf.NewExport()
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.Appearance = conf.NewAppearance()
	model.Conf.Export.AddTitle = false
	boxID, docID := ast.NewNodeID(), ast.NewNodeID()
	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "Headings", false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Headings", "Headings")
	tree.Root = parse.Parse("", []byte("# **First**\n\n## Child\n\n> ## Quoted\n\n## Last\n\n# Second\n"), util.NewLute().ParseOptions).Root
	tree.Root.ID = docID
	tree.Root.SetIALAttr("id", docID)
	tree.Root.SetIALAttr("title", "Headings")
	var lastID string
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n.IsBlock() && ast.NodeDocument != n.Type {
			n.ID = ast.NewNodeID()
			n.SetIALAttr("id", n.ID)
			if ast.NodeHeading == n.Type && "Last" == n.Text() {
				lastID = n.ID
			}
		}
		return ast.WalkContinue
	})
	if lastID == "" {
		t.Fatal("missing partial export fixture")
	}
	for _, test := range []struct {
		name, documentSetting, format, wantFirst, wantLast string
		defaultEnabled                                     bool
	}{
		{"inherit enabled", "", "decimal-hierarchical", "1 **First**", "1.2 Last", true},
		{"force enabled", "true", "decimal-hierarchical", "1 **First**", "1.2 Last", false},
		{"force disabled", "false", "decimal-hierarchical", "**First**", "Last", true},
		{"inherit disabled", "", "decimal-hierarchical", "**First**", "Last", false},
		{"full width punctuation", "true", "chinese-document", "一、**First**", "（二）Last", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			model.Conf.Editor.HeadingNumber = test.defaultEnabled
			model.Conf.Editor.HeadingNumberFormat = test.format
			tree.Root.SetIALAttr("custom-sy-heading-number", test.documentSetting)
			if _, err := filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			path := filepath.Join(util.DataDir, boxID, docID+".sy")
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			for _, id := range []string{docID, lastID} {
				code, message, raw := exportContractRequest(t, "exportMdContent", exportMdContent,
					`{"id":"`+id+`","refMode":3,"embedMode":1,"addTitle":true,"yfm":false}`)
				var data apicontract.ExportMarkdownContentData
				if err := json.Unmarshal(raw, &data); err != nil || code != 0 {
					t.Fatalf("export failed: %d %s %s %v", code, message, raw, err)
				}
				if !strings.Contains(data.Content, "# Headings\n") || !strings.Contains(data.Content, "## "+test.wantLast+"\n") {
					t.Fatalf("unexpected title/partial numbering: %s", data.Content)
				}
				if id == docID && (!strings.Contains(data.Content, "# "+test.wantFirst+"\n") || !strings.Contains(data.Content, "## Quoted\n")) {
					t.Fatalf("unexpected full-document numbering: %s", data.Content)
				}
				engine := gin.New()
				engine.Use(boxLeaseMiddleware)
				engine.POST("/api/lute/copyStdMarkdown", copyStdMarkdown)
				recorder := httptest.NewRecorder()
				engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/lute/copyStdMarkdown", strings.NewReader(
					`{"id":"`+id+`","assetsDestSpace2Underscore":true,"fillCSSVar":true,"adjustHeadingLevel":true}`)))
				requireAPIContract(t, "POST", "/api/lute/copyStdMarkdown", recorder)
				var copied struct {
					Code int    `json:"code"`
					Data string `json:"data"`
				}
				wantCopiedLast := "## " + test.wantLast + "\n"
				if id == lastID {
					wantCopiedLast = "# " + test.wantLast + "\n"
				}
				if err := json.Unmarshal(recorder.Body.Bytes(), &copied); err != nil || copied.Code != 0 ||
					!strings.Contains(copied.Data, wantCopiedLast) {
					t.Fatalf("unexpected Yuque Markdown: %s %v", recorder.Body.String(), err)
				}
			}
			code, message, raw := exportContractRequest(t, "exportMd", exportMd,
				`{"id":"`+docID+`","addTitle":false,"includeSubDocs":false,"includeRelatedDocs":false}`)
			var archive apicontract.ExportNamedZipData
			if err := json.Unmarshal(raw, &archive); err != nil || code != 0 {
				t.Fatalf("zip export failed: %d %s %s %v", code, message, raw, err)
			}
			zipPath, err := url.PathUnescape(archive.Zip)
			if err != nil {
				t.Fatal(err)
			}
			reader, err := archivezip.OpenReader(filepath.Join(util.TempDir, filepath.FromSlash(strings.TrimPrefix(zipPath, "/"))))
			if err != nil {
				t.Fatal(err)
			}
			defer reader.Close()
			found := false
			for _, file := range reader.File {
				if !strings.HasSuffix(file.Name, ".md") {
					continue
				}
				stream, err := file.Open()
				if err != nil {
					t.Fatal(err)
				}
				content, err := io.ReadAll(stream)
				stream.Close()
				if err != nil || !strings.Contains(string(content), "# "+test.wantFirst+"\n") ||
					!strings.Contains(string(content), "## "+test.wantLast+"\n") {
					t.Fatalf("unexpected zipped numbering: %s %v", content, err)
				}
				found = true
			}
			if !found {
				t.Fatal("missing Markdown file in archive")
			}
			after, err := os.ReadFile(path)
			if err != nil || string(before) != string(after) {
				t.Fatalf("copy/export modified the source document: %v", err)
			}
		})
	}
}
