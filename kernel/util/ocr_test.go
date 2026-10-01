package util

import (
	"encoding/json"
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

func TestOCRAssetKeyPreservesResourceIdentity(t *testing.T) {
	const path = "assets/ocr-identity-test.png"
	const box = "20261001020000-abcdefg"
	for _, test := range []struct{ reference, key string }{
		{path + "?page=1#fragment", path},
		{path + "?page=1&box=" + box + "#fragment", path + "?box=" + box},
		{path + "?box=%20" + box + "%20&width=100", path + "?box=" + box},
		{path + "?box=first&box=second", path + "?box=first"},
		{path + "?box=%invalid#fragment", path + "?box=%invalid"},
		{"https://example.com/image?id=first#fragment", "https://example.com/image?id=first"},
		{"https://example.com/image?id=second", "https://example.com/image?id=second"},
	} {
		if got := OCRAssetKey(test.reference); got != test.key {
			t.Errorf("OCRAssetKey(%q) = %q, want %q", test.reference, got, test.key)
		}
	}
}

func TestOCRTextNotebookIsolation(t *testing.T) {
	const path = "assets/ocr-notebook-isolation-test.png"
	first := path + "?box=20261001020001-abcdefg"
	second := path + "?box=20261001020002-abcdefg"
	for _, reference := range []string{path, first, second} {
		defer RemoveAssetText(reference)
	}
	SetAssetText(path, "global result")
	if ExistsAssetText(first) || GetAssetText(first) != "" {
		t.Fatal("notebook reference inherited a global OCR result")
	}
	SetAssetText(first+"&width=100#fragment", "first notebook")
	SetAssetText(second, "second notebook")
	for reference, want := range map[string]string{path: "global result", first: "first notebook", second: "second notebook"} {
		if !ExistsAssetText(reference) || GetAssetText(reference) != want {
			t.Fatalf("OCR result for %s is not isolated: %q", reference, GetAssetText(reference))
		}
	}
	RemoveAssetText(first + "&width=200")
	if ExistsAssetText(first) || GetAssetText(second) != "second notebook" || GetAssetText(path) != "global result" {
		t.Fatal("removing one notebook result changed another resource")
	}
}

func TestOCRTextPreservesLegacyScopedEntries(t *testing.T) {
	const reference = "assets/ocr-legacy-scoped-test.png?width=100&box=20261001020003-abcdefg"
	assetsTextsLock.Lock()
	previousTexts, previousAliases := assetsTexts, assetsTextAliases
	assetsTextsLock.Unlock()
	previousDir, previousChanged := DataDir, assetsTextsChanged.Load()
	defer func() {
		assetsTextsLock.Lock()
		assetsTexts, assetsTextAliases = previousTexts, previousAliases
		assetsTextsLock.Unlock()
		DataDir = previousDir
		assetsTextsChanged.Store(previousChanged)
	}()
	DataDir = t.TempDir()
	global := "assets/ocr-legacy-scoped-test.png"
	other := global + "?box=20261001020006-abcdefg"
	loaded := map[string]string{reference: "legacy notebook result", global: "global result", other: "other notebook result"}
	data, err := json.Marshal(loaded)
	if err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(DataDir, "assets", "ocr-texts.json")
	if err = os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filename, data, 0644); err != nil {
		t.Fatal(err)
	}
	LoadAssetsTexts()
	if !ExistsAssetText(reference) || GetAssetText(reference) != "legacy notebook result" {
		t.Fatal("legacy exact-key OCR result is no longer readable")
	}
	SetAssetText(reference, "updated notebook result")
	if GetAssetText(reference) != "updated notebook result" {
		t.Fatal("canonical notebook result did not supersede its legacy alias")
	}
	RemoveAssetText(OCRAssetKey(reference))
	SaveAssetsTexts()
	LoadAssetsTexts()
	if ExistsAssetText(reference) || GetAssetText(reference) != "" {
		t.Fatal("deleted notebook OCR result reappeared through a legacy alias")
	}
	if GetAssetText(global) != "global result" || GetAssetText(other) != "other notebook result" {
		t.Fatal("deleting a legacy alias changed another resource")
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

func TestOCRCleanupUsesNotebookIdentity(t *testing.T) {
	previous := DataDir
	DataDir = t.TempDir()
	defer func() { DataDir = previous }()
	const path = "assets/ocr-cleanup-scoped-test.png"
	first := path + "?box=20261001020004-abcdefg"
	second := path + "?box=20261001020005-abcdefg"
	filename := filepath.Join(DataDir, filepath.FromSlash(path))
	if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filename, []byte("global image"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, reference := range []string{path, first, second} {
		SetAssetText(reference, "result")
		defer RemoveAssetText(reference)
	}
	CleanNotExistAssetsTexts(func(reference string) bool { return reference == first })
	if !ExistsAssetText(path) || !ExistsAssetText(first) || ExistsAssetText(second) {
		t.Fatal("OCR cleanup confused scoped resources with a same-named global asset")
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
