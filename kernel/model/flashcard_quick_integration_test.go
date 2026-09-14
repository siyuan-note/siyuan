package model

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestEmptyQuickFlashcardParagraphIntegration(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_EMPTY_QUICK_FLASHCARD") != "1" {
		// 文档缓存和闪卡存储具有进程级状态，测试在独立进程中运行。
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestEmptyQuickFlashcardParagraphIntegration$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_EMPTY_QUICK_FLASHCARD=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("quick flashcard subprocess failed: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.DataDir, util.TempDir, util.ConfDir = filepath.Join(root, "data"), root, root
	util.QueueDir = filepath.Join(root, "queue")
	util.DBPath, util.HistoryDBPath = filepath.Join(root, "siyuan.db"), filepath.Join(root, "history.db")
	util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(root, "asset_content.db"), filepath.Join(root, "blocktree.db")
	Conf = NewAppConf()
	Conf.Lang = "en"
	Conf.System, Conf.Flashcard = conf.NewSystem(), conf.NewFlashcard()
	Conf.System.ID = "quick-test-device"
	Conf.FileTree, Conf.Sync = conf.NewFileTree(), conf.NewSync()
	Conf.Search, Conf.Editor, Conf.Export = conf.NewSearch(), conf.NewEditor(), conf.NewExport()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	const boxID, docID = "20260914000000-quickbx", "20260914000001-quickdc"
	box := &Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "Quick cards", false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	defer closeFlashcardV2Store()
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Quick cards", "Quick cards")
	blank := tree.Root.FirstChild
	text := &ast.Node{Type: ast.NodeParagraph, ID: ast.NewNodeID()}
	text.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("question")})
	tree.Root.AppendChild(text)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	ctx := context.Background()
	preview, err := PreviewLegacyFlashcardMigration(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ActivateLegacyFlashcardMigration(ctx, preview.MigrationID, preview.RecordDigest); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	request := flashcardv2.QuickSourceRequest{OperationID: "only-blank", BlockIDs: []string{blank.ID}, CreatedAt: now, Toggle: true}
	for range 2 {
		result, createErr := CreateFlashcardV2QuickSources(ctx, request)
		if createErr != nil || len(result.CardIDs) != 0 || result.CardIDs == nil || result.SourceIDs == nil {
			t.Fatalf("empty selection should succeed without cards: %+v, %v", result, createErr)
		}
	}
	request.OperationID, request.BlockIDs = "mixed", []string{blank.ID, text.ID}
	result, err := CreateFlashcardV2QuickSources(ctx, request)
	if err != nil || len(result.CardIDs) != 1 || result.CardIDs[0] != flashcardv2.LegacyQuickCardID(text.ID) {
		t.Fatalf("mixed selection: %+v, %v", result, err)
	}
	request.OperationID, request.CreatedAt = "cancel-mixed", now+1
	result, err = CreateFlashcardV2QuickSources(ctx, request)
	if err != nil || result.Action != flashcardv2.QuickSourceActionRemoved || len(result.CardIDs) != 1 {
		t.Fatalf("blank candidate interfered with cancellation: %+v, %v", result, err)
	}
	if _, found, findErr := GetFlashcardV2Entity(ctx, flashcardv2.EntityCardSource, flashcardv2.LegacyQuickSourceID(blank.ID)); findErr != nil || found {
		t.Fatalf("empty paragraph source was persisted: %v, %v", found, findErr)
	}
}
