package util

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOCRTextReferenceVariants(t *testing.T) {
	path := "assets/ocr-reference-test.png"
	defer RemoveAssetText(path)
	SetAssetText(path+"?page=1#fragment", "shared OCR")
	for _, reference := range []string{path, path + "?page=2", path + "#fragment"} {
		if !ExistsAssetText(reference) || GetAssetText(reference) != "shared OCR" {
			t.Fatalf("OCR text was not shared with %s", reference)
		}
	}
}

func TestOCRCleanupRetainsNotebookAssets(t *testing.T) {
	previous := DataDir
	DataDir = t.TempDir()
	defer func() { DataDir = previous }()
	const path = "assets/notebook-image.png"
	const missing = "assets/deleted-image.png"
	SetAssetText(path, "notebook text")
	SetAssetText(missing, "deleted text")
	defer RemoveAssetText(path)
	defer RemoveAssetText(missing)
	CleanNotExistAssetsTexts(func(asset string) bool { return asset == path })
	if !ExistsAssetText(path) || ExistsAssetText(missing) {
		t.Fatal("OCR cleanup ignored notebook asset resolution")
	}
}

func TestOCRCorruptCachePreservesSourceAndMemory(t *testing.T) {
	previous := DataDir
	DataDir = t.TempDir()
	defer func() { DataDir = previous }()
	assets := filepath.Join(DataDir, "assets")
	if err := os.MkdirAll(assets, 0755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(assets, "ocr-texts.json")
	corrupt := []byte(`{"assets/file.png":`)
	if err := os.WriteFile(file, corrupt, 0644); err != nil {
		t.Fatal(err)
	}
	SetAssetText("assets/file.png", "previous result")
	defer RemoveAssetText("assets/file.png")
	LoadAssetsTexts()
	if GetAssetText("assets/file.png") != "previous result" {
		t.Fatal("invalid cache changed existing text")
	}
	data, err := os.ReadFile(file)
	if err != nil || string(data) != string(corrupt) {
		t.Fatalf("invalid cache was modified: %s %v", data, err)
	}
}
