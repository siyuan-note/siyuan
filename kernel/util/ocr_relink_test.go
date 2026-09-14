package util

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestAssetRelinkOCRPreservesConflictsAndCorruption(t *testing.T) {
	previousData, previousTexts := DataDir, assetsTexts
	previousChanged := assetsTextsChanged.Load()
	DataDir = t.TempDir()
	assetsTexts = map[string]string{}
	t.Cleanup(func() { DataDir, assetsTexts = previousData, previousTexts; assetsTextsChanged.Store(previousChanged) })
	dir := filepath.Join(DataDir, "assets")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	abs := filepath.Join(dir, "ocr-texts.json")
	for _, original := range []string{`{"assets/a.png":"source","assets/b.webp":"different"}`, `{"broken":`} {
		if err := os.WriteFile(abs, []byte(original), 0644); err != nil {
			t.Fatal(err)
		}
		if _, err := CopyAssetTextForRelink("assets/a.png", "assets/b.webp", t.TempDir(), false); err == nil {
			t.Fatal("invalid OCR relink accepted")
		}
		data, _ := os.ReadFile(abs)
		if !bytes.Equal(data, []byte(original)) {
			t.Fatal("OCR source changed")
		}
	}
	if err := os.WriteFile(abs, []byte(`{"assets/a%23b.png":"source"}`), 0644); err != nil {
		t.Fatal(err)
	}
	if found, err := CopyAssetTextForRelink("assets/a#b.png", "assets/c#d.webp", t.TempDir(), false); err != nil || !found {
		t.Fatalf("encoded OCR key: %v %v", found, err)
	}
	if GetAssetText("assets/c%23d.webp") != "source" || GetAssetText("assets/a%23b.png") != "source" {
		t.Fatal("encoded OCR result or source was lost")
	}
}
