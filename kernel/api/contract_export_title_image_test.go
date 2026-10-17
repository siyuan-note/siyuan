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
	pdfapi "github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	pdfmodel "github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
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
	previousHome := util.HomeDir
	util.HomeDir = t.TempDir()
	defer func() { util.HomeDir = previousHome }()
	for _, embed := range []bool{false, true} {
		output := t.TempDir()
		pdfPath := filepath.Join(output, "document.pdf")
		ctx, err := pdfapi.ReadContextFile("../testdata/parsertest.pdf")
		if err != nil {
			t.Fatal(err)
		}
		if err = pdfapi.WriteContextFile(ctx, pdfPath); err != nil {
			t.Fatal(err)
		}
		code, msg, data := exportContractRequest(t, "processPDF", processPDF,
			fmt.Sprintf(`{"id":%q,"path":%q,"removeAssets":%t,"watermark":false,"exportAssets":true}`, docID, pdfPath, embed))
		if code != 0 || string(data) != "null" {
			t.Fatalf("PDF resource export failed: %d %s %s", code, msg, data)
		}
		if _, err = os.Stat(filepath.Join(output, "assets")); !os.IsNotExist(err) {
			t.Fatalf("PDF without asset links created a sidecar: %v", err)
		}
	}
	assetDir := filepath.Join(util.DataDir, boxID, "assets")
	if err := os.MkdirAll(assetDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assetDir, "linked.bin"), []byte("linked"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, embed := range []bool{false, true} {
		output := t.TempDir()
		pdfPath := filepath.Join(output, "failed.pdf")
		ctx, err := pdfapi.ReadContextFile("../testdata/parsertest.pdf")
		if err != nil {
			t.Fatal(err)
		}
		annotations := []pdfmodel.AnnotationRenderer{}
		for i, name := range []string{"linked.bin", "missing.bin"} {
			annotations = append(annotations, pdfmodel.NewLinkAnnotation(*types.NewRectangle(20, 20, 100, 40), "",
				fmt.Sprintf("linked-%d", i), "", 0, nil, nil, "http://127.0.0.1:6806/assets/"+name, nil, false, 0, pdfmodel.BSSolid))
		}
		if _, err = pdfcpu.AddAnnotationsMap(ctx, map[int][]pdfmodel.AnnotationRenderer{1: annotations}, false); err != nil {
			t.Fatal(err)
		}
		if err = pdfapi.WriteContextFile(ctx, pdfPath); err != nil {
			t.Fatal(err)
		}
		beforePDF, err := os.ReadFile(pdfPath)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.Mkdir(filepath.Join(output, "assets"), 0755); err != nil {
			t.Fatal(err)
		}
		prior := filepath.Join(output, "assets", "existing.txt")
		if err = os.WriteFile(prior, []byte("keep"), 0644); err != nil {
			t.Fatal(err)
		}
		code, _, _ := exportContractRequest(t, "processPDF", processPDF,
			fmt.Sprintf(`{"id":%q,"path":%q,"removeAssets":%t,"watermark":false,"exportAssets":true}`, docID, pdfPath, embed))
		if code != -1 {
			t.Fatalf("failed asset export reported success: %d", code)
		}
		afterPDF, err := os.ReadFile(pdfPath)
		if err != nil || string(beforePDF) != string(afterPDF) {
			t.Fatalf("failed export modified PDF: %v", err)
		}
		files, err := os.ReadDir(filepath.Join(output, "assets"))
		if err != nil || len(files) != 1 || files[0].Name() != "existing.txt" {
			t.Fatalf("rollback changed unrelated assets: %v %v", files, err)
		}
		priorData, err := os.ReadFile(prior)
		if err != nil || string(priorData) != "keep" {
			t.Fatalf("existing output modified: %q %v", priorData, err)
		}
	}
}
