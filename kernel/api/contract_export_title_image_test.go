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

func TestAPIContractExportTitleImage(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_EXPORT_TITLE_IMAGE") != "1" {
		// 导出使用进程级数据库和缓存，通过独立测试进程隔离夹具。
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractExportTitleImage$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_EXPORT_TITLE_IMAGE=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("title image export subprocess failed: %v\n%s", err, output)
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
	boxID, docID := ast.NewNodeID(), ast.NewNodeID()
	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "Title images", false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	const cover = "https://example.com/cover.png"
	const bodyImage = "https://example.com/body.png"
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Title images", "Title images")
	tree.Root = parse.Parse("", []byte("![same image]("+cover+")\n\n![body]("+bodyImage+")\n"), util.NewLute().ParseOptions).Root
	tree.Root.ID = docID
	tree.Root.SetIALAttr("id", docID)
	tree.Root.SetIALAttr("title", "Title images")
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n.IsBlock() && n.Type != ast.NodeDocument {
			n.ID = ast.NewNodeID()
			n.SetIALAttr("id", n.ID)
		}
		return ast.WalkContinue
	})
	for _, hasCover := range []bool{true, false} {
		if hasCover {
			tree.Root.SetIALAttr("title-img", `background-image:url("`+cover+`")`)
		} else {
			tree.Root.RemoveIALAttr("title-img")
		}
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		path := filepath.Join(util.DataDir, boxID, docID+".sy")
		before, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		for _, addTitle := range []bool{true, false} {
			for _, entry := range []struct {
				extra   string
				exclude bool
			}{
				{`,"image":true`, false},
				{`,"image":true,"excludeTitleImage":null`, false},
				{`,"image":true,"excludeTitleImage":false`, false},
				{`,"image":true,"excludeTitleImage":true`, true},
				{`,"image":false,"excludeTitleImage":true`, false},
				{`,"excludeTitleImage":true`, false},
				{`,"pdf":true`, false},
				{`,"pdf":true,"excludeTitleImage":null`, false},
				{`,"pdf":true,"excludeTitleImage":false`, false},
				{`,"pdf":true,"excludeTitleImage":true`, true},
				{`,"pdf":false,"excludeTitleImage":true`, false},
				{`,"pdf":null,"excludeTitleImage":true`, false},
			} {
				code, message, raw := exportContractRequest(t, "exportPreviewHTML", exportPreviewHTML,
					fmt.Sprintf(`{"id":%q,"addTitle":%t,"customTitle":"CUSTOM-TITLE"%s}`, docID, addTitle, entry.extra))
				var data apicontract.ExportPreviewHTMLData
				if err := json.Unmarshal(raw, &data); err != nil || code != 0 {
					t.Fatalf("preview failed: %d %s %s %v", code, message, raw, err)
				}
				wantCover := 1
				if hasCover && !entry.exclude {
					wantCover++
				}
				if strings.Count(data.Content, `<img src="`+cover+`"`) != wantCover ||
					strings.Count(data.Content, `<img src="`+bodyImage+`"`) != 1 ||
					strings.Contains(data.Content, "CUSTOM-TITLE") != addTitle {
					t.Fatalf("unexpected preview (cover=%v, title=%v, %s): %s", hasCover, addTitle, entry.extra, data.Content)
				}
			}
		}
		after, err := os.ReadFile(path)
		if err != nil || string(before) != string(after) {
			t.Fatalf("preview modified source: %v", err)
		}
	}
}
