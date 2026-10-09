package api

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractExportTaskMarkers(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_EXPORT_TASK_MARKERS") != "1" {
		// 导出使用进程级数据库和缓存，通过独立测试进程隔离夹具。
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractExportTaskMarkers$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_EXPORT_TASK_MARKERS=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("task marker export subprocess failed: %v\n%s", err, output)
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
	boxID, docID := ast.NewNodeID(), ast.NewNodeID()
	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "Tasks", false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Tasks", "Tasks")
	tree.Root = parse.Parse("", []byte("- [/] progress\n- [-] canceled\n- [X] done\n"), util.NewLute().ParseOptions).Root
	tree.Root.ID = docID
	tree.Root.SetIALAttr("id", docID)
	tree.Root.SetIALAttr("title", "Tasks")
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	path := filepath.Join(util.DataDir, boxID, docID+".sy")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, extra := range []string{"", `,"preserveTaskMarkers":null`, `,"preserveTaskMarkers":false`, `,"preserveTaskMarkers":true`} {
		code, message, raw := exportContractRequest(t, "exportMdContent", exportMdContent,
			`{"id":"`+docID+`","refMode":3,"embedMode":1,"addTitle":false,"yfm":false`+extra+`}`)
		var data apicontract.ExportMarkdownContentData
		if err := json.Unmarshal(raw, &data); err != nil || code != 0 {
			t.Fatalf("export failed: %d %s %s %v", code, message, raw, err)
		}
		for _, task := range []struct{ marker, text string }{{"/", "progress"}, {"-", "canceled"}, {"X", "done"}} {
			marker := "X"
			if strings.Contains(extra, "true") {
				marker = task.marker
			}
			if !strings.Contains(data.Content, "["+marker+"] "+task.text) {
				t.Fatalf("unexpected copied/exported task marker: %s", data.Content)
			}
		}
	}
	code, _, _ := exportContractRequest(t, "exportMdContent", exportMdContent,
		`{"id":"`+docID+`","preserveTaskMarkers":"true"}`)
	if code != -1 {
		t.Fatalf("invalid task marker option accepted: %d", code)
	}
	after, err := os.ReadFile(path)
	if err != nil || string(before) != string(after) {
		t.Fatalf("copy/export modified the source document: %v", err)
	}
}
