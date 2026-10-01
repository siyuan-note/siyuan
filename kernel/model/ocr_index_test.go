//go:build fts5

package model

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	path   string
}

func (*ocrFixtureProvider) Available() bool { return true }
func (p *ocrFixtureProvider) Recognize(_ context.Context, path string) ([]map[string]string, error) {
	p.called = true
	p.path = path
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
	testOCRNotebookIsolation(t, provider, fixture.box.ID)
}

func testOCRNotebookIsolation(t *testing.T, provider *ocrFixtureProvider, firstBox string) {
	t.Helper()
	const secondBox = "20261001020300-abcdefg"
	box := &Box{ID: secondBox}
	if err := box.SaveConf(conf.NewBoxConf()); err != nil {
		t.Fatal(err)
	}
	const path = "assets/ocr-notebook-isolation.png"
	first, second := path+"?box="+firstBox, path+"?box="+secondBox
	for _, boxID := range []string{"", firstBox, secondBox} {
		filename := filepath.Join(util.DataDir, boxID, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filename, []byte("fixture "+boxID), 0644); err != nil {
			t.Fatal(err)
		}
	}
	util.SetAssetText(path, "globalocrkeyword")
	for _, reference := range []string{path, first, second} {
		defer util.RemoveAssetText(reference)
	}
	documents := []struct {
		box, reference, want string
	}{
		{firstBox, path, "globalocrkeyword"},
		{firstBox, path + "?width=100&box=" + firstBox + "#preview", "firstocrkeyword"},
		{secondBox, second, "secondocrkeyword"},
		{secondBox, first + "&width=200", "firstocrkeyword"},
	}
	for i, document := range documents {
		rootID := fmt.Sprintf("2026100102010%d-abcdefg", i)
		paragraphID := fmt.Sprintf("2026100102020%d-abcdefg", i)
		tree := treenode.NewTree(document.box, "/"+rootID+".sy", "/Scoped OCR", "Scoped OCR")
		paragraph := treenode.NewParagraph(paragraphID)
		parsed := parse.Parse("ocr", []byte("![fixture]("+document.reference+")"), util.NewLute().ParseOptions)
		image := parsed.Root.FirstChild.FirstChild
		image.Unlink()
		paragraph.AppendChild(image)
		tree.Root.AppendChild(paragraph)
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		sql.IndexTreeQueue(tree)
	}
	sql.FlushQueue()
	Conf.OCR.Provider = "paddleocr"
	for _, test := range []struct{ reference, box, text string }{
		{"  " + first + "&width=100#preview", firstBox, "firstocrkeyword"},
		{second, secondBox, "secondocrkeyword"},
	} {
		provider.rows = []map[string]string{{"text": test.text, "conf": "99"}}
		if _, err := OCRAsset(context.Background(), test.reference); err != nil {
			t.Fatal(err)
		}
		if provider.path != filepath.Join(util.DataDir, test.box, filepath.FromSlash(path)) {
			t.Fatalf("OCR recognized the wrong notebook asset: %s", provider.path)
		}
	}
	sql.FlushQueue()
	check := func() {
		t.Helper()
		for i, document := range documents {
			paragraphID := fmt.Sprintf("2026100102020%d-abcdefg", i)
			block := sql.GetBlock(paragraphID)
			if block == nil || !strings.Contains(block.Content, document.want) {
				t.Fatalf("scoped OCR was not indexed for %s: %+v", document.reference, block)
			}
			for _, unwanted := range []string{"globalocrkeyword", "firstocrkeyword", "secondocrkeyword", "changedocrkeyword"} {
				if unwanted != document.want && strings.Contains(block.Content, unwanted) {
					t.Fatalf("OCR leaked between notebook resources: %+v", block)
				}
			}
		}
	}
	check()
	SetOCRAssetText(first+"#edited", "changedocrkeyword")
	documents[1].want, documents[3].want = "changedocrkeyword", "changedocrkeyword"
	sql.FlushQueue()
	check()
	for keyword, count := range map[string]int{"firstocrkeyword": 0, "changedocrkeyword": 2, "secondocrkeyword": 1} {
		matches, err := sql.QueryNoLimitArgs("SELECT id FROM blocks_fts WHERE blocks_fts MATCH ?", keyword)
		if err != nil || len(matches) != count {
			t.Fatalf("unexpected scoped OCR full-text results for %s: %v, %v", keyword, matches, err)
		}
	}
	provider.err = errors.New("scoped recognition failed")
	if _, err := OCRAsset(context.Background(), first); err == nil {
		t.Fatal("failed notebook recognition returned success")
	}
	provider.err = nil
	util.SaveAssetsTexts()
	for _, reference := range []string{path, first, second} {
		util.RemoveAssetText(reference)
	}
	util.LoadAssetsTexts()
	secondText := util.GetOcrJsonText([]map[string]string{{"text": "secondocrkeyword", "conf": "99"}})
	for reference, want := range map[string]string{path: "globalocrkeyword", first: "changedocrkeyword", second: secondText} {
		if got := util.GetAssetText(reference); got != want {
			t.Fatalf("scoped OCR result did not survive reload for %s: %q", reference, got)
		}
	}
}
