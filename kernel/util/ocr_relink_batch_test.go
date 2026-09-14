package util

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestAssetRelinkBatchOCR(t *testing.T) {
	previousData, previousTexts, previousChanged := DataDir, assetsTexts, assetsTextsChanged.Load()
	DataDir, assetsTexts = t.TempDir(), map[string]string{}
	t.Cleanup(func() { DataDir, assetsTexts = previousData, previousTexts; assetsTextsChanged.Store(previousChanged) })
	dir := filepath.Join(DataDir, "assets")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	abs := filepath.Join(dir, "ocr-texts.json")
	original := []byte(`{"assets/a.png":"A","assets/b.png":"B","assets/a%23b.png":"encoded"}`)
	if err := os.WriteFile(abs, original, 0644); err != nil {
		t.Fatal(err)
	}
	mappings := []AssetTextRelinkMapping{{"assets/a.png", "assets/a.webp"}, {"assets/b.png", "assets/b.webp"}, {"assets/a#b.png", "assets/encoded.webp"}}
	plan, err := PrepareAssetTextRelinks(mappings)
	if err != nil {
		t.Fatal(err)
	}
	history := t.TempDir()
	changed, err := plan.Save(history, []int{0, 1, 2})
	if err != nil || len(changed) != 3 {
		t.Fatalf("batch OCR save: %v %v", changed, err)
	}
	data, _ := os.ReadFile(abs)
	texts := map[string]string{}
	if err = json.Unmarshal(data, &texts); err != nil || texts["assets/a.webp"] != "A" || texts["assets/b.webp"] != "B" || texts["assets/encoded.webp"] != "encoded" {
		t.Fatalf("results: %s %v", data, err)
	}
	backup, _ := os.ReadFile(filepath.Join(history, "assets", "ocr-texts.json"))
	if bytes.Contains(backup, []byte(".webp")) {
		t.Fatal("history includes an intermediate write")
	}
	plan, err = PrepareAssetTextRelinks(mappings)
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range plan.Results {
		if result.Changed {
			t.Fatal("idempotent retry marked changed")
		}
	}
	unusedHistory := filepath.Join(t.TempDir(), "unused")
	changed, err = plan.Save(unusedHistory, []int{0, 1, 2})
	if err != nil || len(changed) != 0 {
		t.Fatalf("retry: %v %v", changed, err)
	}
	if _, err = os.Stat(unusedHistory); !os.IsNotExist(err) {
		t.Fatal("retry created history")
	}
	conflict, err := PrepareAssetTextRelinks([]AssetTextRelinkMapping{{"assets/a.png", "assets/shared.webp"}, {"assets/b.png", "assets/shared.webp"}})
	if err != nil || conflict.Results[0].Reason == "" || conflict.Results[1].Reason == "" {
		t.Fatalf("shared target conflict: %+v %v", conflict, err)
	}
	stale, _ := PrepareAssetTextRelinks([]AssetTextRelinkMapping{{"assets/a.png", "assets/new.webp"}})
	SetAssetText("assets/unrelated.png", "concurrent OCR")
	if _, err = stale.Save(t.TempDir(), []int{0}); err == nil {
		t.Fatal("concurrent OCR update overwritten")
	}
	if GetAssetText("assets/unrelated.png") != "concurrent OCR" {
		t.Fatal("concurrent OCR data lost")
	}
}
