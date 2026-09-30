//go:build fts5

package model

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/ocr"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type ocrFixtureProvider struct {
	rows   []map[string]string
	err    error
	called bool
}

func (*ocrFixtureProvider) Available() bool { return true }
func (p *ocrFixtureProvider) Recognize(context.Context, string) ([]map[string]string, error) {
	p.called = true
	return p.rows, p.err
}

func TestOCRResultReindexesWithoutTesseract(t *testing.T) {
	const child = "SIYUAN_TEST_OCR_INDEX"
	if os.Getenv(child) != "1" {
		command := exec.Command(os.Args[0], "-test.run=^TestOCRResultReindexesWithoutTesseract$", "-test.timeout=45s", "-test.v")
		command.Env = append(os.Environ(), child+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("OCR index subprocess: %v\n%s", err, output)
		}
		return
	}
	fixture := setupFileOperationTest(t)
	Conf.Search, Conf.Editor, Conf.Export = conf.NewSearch(), conf.NewEditor(), conf.NewExport()
	Conf.OCR = &conf.OCR{Provider: "paddleocr", Model: "tiny", Auto: true}
	util.WorkspaceDir = filepath.Dir(util.DataDir)
	util.TempDir, util.HistoryDir = t.TempDir(), t.TempDir()
	util.ConfDir = t.TempDir()
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, "siyuan.db")
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	util.TesseractEnabled = false
	path := "assets/image-20261001000000-abcdefg.png"
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(util.DataDir, filepath.FromSlash(path)), []byte("image fixture"), 0644); err != nil {
		t.Fatal(err)
	}
	tree := treenode.NewTree(fixture.box.ID, "/20261001000001-abcdefg.sy", "/OCR", "OCR")
	paragraph := treenode.NewParagraph("20261001000002-abcdefg")
	parsed := parse.Parse("ocr", []byte("![fixture]("+path+")"), util.NewLute().ParseOptions)
	image := parsed.Root.FirstChild.FirstChild
	image.Unlink()
	paragraph.AppendChild(image)
	tree.Root.AppendChild(paragraph)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sql.IndexTreeQueue(tree)
	sql.FlushQueue()
	provider := &ocrFixtureProvider{rows: []map[string]string{{"text": "nativeocrkeyword", "conf": "99"}}}
	ocrRegistry = ocr.NewRegistry()
	if err := ocrRegistry.Register(ocr.PaddleOCR, provider); err != nil {
		t.Fatal(err)
	}
	ocrInit.Do(func() {})
	if _, err := OCRAsset(context.Background(), path+"#fragment"); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	block := sql.GetBlock(paragraph.ID)
	if block == nil || !strings.Contains(block.Content, "nativeocrkeyword") {
		t.Fatalf("OCR was not indexed: %+v", block)
	}
	matches, err := sql.QueryNoLimit("SELECT id FROM blocks_fts WHERE blocks_fts MATCH 'nativeocrkeyword'")
	if err != nil || len(matches) == 0 {
		t.Fatalf("OCR did not reach full-text search: %v, %v", matches, err)
	}
	SetOCRAssetText(path+"#fragment", "editedocrkeyword")
	sql.FlushQueue()
	stored, queryErr := sql.QueryNoLimitArgs("SELECT content FROM blocks WHERE id = ?", paragraph.ID)
	if queryErr != nil || len(stored) != 1 || !strings.Contains(stored[0]["content"].(string), "editedocrkeyword") || strings.Contains(stored[0]["content"].(string), "nativeocrkeyword") {
		t.Fatalf("edited OCR was not indexed: %v, %v", stored, queryErr)
	}
	matches, err = sql.QueryNoLimit("SELECT id FROM blocks_fts WHERE blocks_fts MATCH 'nativeocrkeyword'")
	if err != nil || len(matches) != 0 {
		t.Fatalf("obsolete OCR remained in full-text search: %v, %v", matches, err)
	}
	provider.err = errors.New("inference failed")
	if _, err := OCRAsset(context.Background(), path); err == nil {
		t.Fatal("failed provider returned success")
	}
	if util.GetAssetText(path) != "editedocrkeyword" {
		t.Fatal("failed recognition changed saved text")
	}
	provider.called = false
	const notebookPath = "assets/notebook-image.png"
	notebookImage := filepath.Join(util.DataDir, fixture.box.ID, filepath.FromSlash(notebookPath))
	if err := os.MkdirAll(filepath.Dir(notebookImage), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(notebookImage, []byte("notebook image"), 0644); err != nil {
		t.Fatal(err)
	}
	SetOCRAssetText(notebookPath, "notebook result")
	cache.LoadAssets()
	if !cache.ExistAsset(path) {
		t.Fatal("automatic OCR fixture was not cached")
	}
	autoOCRAssets()
	if provider.called {
		t.Fatal("automatic OCR reran an existing result")
	}
	if util.GetAssetText(notebookPath) != "notebook result" {
		t.Fatal("automatic cleanup deleted a notebook asset result")
	}
	util.RemoveAssetText(path)
	provider.err = nil
	Conf.OCR.Auto = false
	autoOCRAssets()
	if provider.called {
		t.Fatal("disabled automatic OCR reached provider")
	}
	Conf.OCR.Auto = true
	autoOCRAssets()
	if !provider.called || !strings.Contains(util.GetAssetText(path), "nativeocrkeyword") {
		t.Fatalf("headless automatic OCR did not save text: called=%v text=%q", provider.called, util.GetAssetText(path))
	}
	const encryptedBox = "20261001000003-abcdefg"
	key := bytes.Repeat([]byte{5}, 32)
	ciphertext, err := EncryptAsset(encryptedBox, "encrypted.png", "encrypted.png", key, []byte("private image"))
	if err != nil {
		t.Fatal(err)
	}
	boxConfig := conf.NewBoxConf()
	boxConfig.Encrypted = true
	configBytes, _ := json.Marshal(boxConfig)
	for name, value := range map[string][]byte{".siyuan/conf.json": configBytes, "assets/encrypted.png": ciphertext} {
		filename := filepath.Join(util.DataDir, encryptedBox, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filename, value, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := ocrRegistry.Register(ocr.Tesseract, provider); err != nil {
		t.Fatal(err)
	}
	for _, unlocked := range []bool{false, true} {
		if unlocked {
			setDEKForTest(encryptedBox, key)
			repairEncryptedBoxStateFromDEK(encryptedBox)
		}
		for _, selected := range []string{"paddleocr", "tesseract"} {
			Conf.OCR.Provider = selected
			for _, path := range []string{"assets/encrypted.png?box=" + encryptedBox, "assets/encrypted.png?box=" + encryptedBox + "#fragment", "assets/missing.png?box=" + encryptedBox + "#fragment"} {
				provider.called = false
				if _, err := OCRAsset(context.Background(), path); err == nil || provider.called {
					t.Fatalf("encrypted OCR reached %s (unlocked=%v): %v", selected, unlocked, err)
				}
				SetOCRAssetText(path, "private text")
				if util.ExistsAssetText(path) {
					t.Fatal("encrypted OCR leaked into global text cache")
				}
			}
			if util.ExistsAssetText("assets/encrypted.png") {
				t.Fatal("encrypted OCR leaked into global text cache")
			}
		}
	}
	after, err := os.ReadFile(filepath.Join(util.DataDir, encryptedBox, "assets", "encrypted.png"))
	if err != nil || !bytes.Equal(after, ciphertext) {
		t.Fatal("encrypted OCR changed source ciphertext")
	}
}
