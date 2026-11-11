// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"encoding/json"
	"fmt"
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

func TestAPIContractExportReferenceMode(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_EXPORT_REFERENCE_MODE") != "1" {
		// 导出使用进程级数据库和缓存，通过独立测试进程隔离夹具。
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractExportReferenceMode$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_EXPORT_REFERENCE_MODE=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("reference export subprocess failed: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.DataDir, util.TempDir, util.ConfDir = filepath.Join(root, "data"), root, root
	util.QueueDir = filepath.Join(root, "queue")
	util.DBPath, util.HistoryDBPath = filepath.Join(root, "siyuan.db"), filepath.Join(root, "history.db")
	util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(root, "asset_content.db"), filepath.Join(root, "blocktree.db")
	model.Conf = model.NewAppConf()
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.Search.Store(conf.NewSearch())
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Export.Store(conf.NewExport())
	model.Conf.Appearance.Store(conf.NewAppearance())
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.Export.Load().BlockRefMode = 4
	boxID, docID, targetID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "References", false
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	write := func(id, markdown string) {
		t.Helper()
		tree := treenode.NewTree(boxID, "/"+id+".sy", "/"+id, id)
		tree.Root = parse.Parse("", []byte(markdown), util.NewLute().ParseOptions).Root
		tree.Root.ID = id
		tree.Root.SetIALAttr("id", id)
		tree.Root.SetIALAttr("title", id)
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && n.IsBlock() && n.Type != ast.NodeDocument {
				n.ID = ast.NewNodeID()
				n.SetIALAttr("id", n.ID)
			}
			return ast.WalkContinue
		})
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
	}
	write(targetID, "TARGET_SECRET_BODY")
	write(docID, "SOURCE_BODY (("+targetID+" 'Reference label'))")
	before, err := os.ReadFile(filepath.Join(util.DataDir, boxID, docID+".sy"))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		extra string
		mode  int
	}{
		{`,"pdf":true`, 4},
		{`,"pdf":true,"blockRefMode":null`, 4},
		{`,"pdf":true,"blockRefMode":3`, 3},
		{`,"pdf":true,"blockRefMode":2`, 2},
		{`,"pdf":true,"blockRefMode":4`, 4},
		{`,"image":true,"blockRefMode":3`, 4},
		{`,"pdf":false,"blockRefMode":3`, 4},
	} {
		code, msg, raw := exportContractRequest(t, "exportPreviewHTML", exportPreviewHTML,
			fmt.Sprintf(`{"id":%q,"addTitle":false%s}`, docID, entry.extra))
		var data apicontract.ExportPreviewHTMLData
		if err := json.Unmarshal(raw, &data); err != nil || code != 0 {
			t.Fatalf("preview: %d %s %v", code, msg, err)
		}
		if !strings.Contains(data.Content, "SOURCE_BODY") || !strings.Contains(data.Content, "Reference label") ||
			strings.Contains(data.Content, "TARGET_SECRET_BODY") != (entry.mode == 4) ||
			strings.Contains(data.Content, "siyuan://blocks/"+targetID) != (entry.mode == 2) {
			t.Fatalf("unexpected mode %d (%s): %s", entry.mode, entry.extra, data.Content)
		}
		if model.Conf.Export.Load().BlockRefMode != 4 {
			t.Fatal("preview changed global settings")
		}
	}
	for _, value := range []string{`0`, `1`, `5`, `-1`, `3.5`, `"3"`, `true`} {
		code, _, _ := exportContractRequest(t, "exportPreviewHTML", exportPreviewHTML,
			fmt.Sprintf(`{"id":%q,"pdf":true,"blockRefMode":%s}`, docID, value))
		if code == 0 {
			t.Fatalf("accepted invalid mode %s", value)
		}
	}
	after, err := os.ReadFile(filepath.Join(util.DataDir, boxID, docID+".sy"))
	if err != nil || string(before) != string(after) {
		t.Fatalf("preview changed source: %v", err)
	}
}
