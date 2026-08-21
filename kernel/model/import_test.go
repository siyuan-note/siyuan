// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/image/bmp"
)

func TestIsSYNotebookExport(t *testing.T) {
	tests := []struct {
		name          string
		hasBoxConf    bool
		hasBoxDocMeta bool
		want          bool
	}{
		{name: "document export", want: false},
		{name: "notebook export with conf", hasBoxConf: true, want: true},
		{name: "notebook export with document metadata", hasBoxDocMeta: true, want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isSYNotebookExport(test.hasBoxConf, test.hasBoxDocMeta); got != test.want {
				t.Fatalf("isSYNotebookExport() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestImportFromLocalPathRejectsClosedNotebookBeforeWriting(t *testing.T) {
	fixture := setupFileOperationTest(t)
	boxConf := fixture.box.GetConf()
	boxConf.Closed = true
	if err := fixture.box.SaveConf(boxConf); err != nil {
		t.Fatalf("close test notebook failed: %v", err)
	}

	markdownPath := filepath.Join(t.TempDir(), "document.md")
	if err := os.WriteFile(markdownPath, []byte("# Document"), 0644); err != nil {
		t.Fatalf("write Markdown fixture failed: %v", err)
	}
	pattern := filepath.Join(util.DataDir, fixture.box.ID, "*.sy")
	before, err := filepath.Glob(pattern)
	if err != nil {
		t.Fatalf("list documents before import failed: %v", err)
	}

	err = ImportFromLocalPath(fixture.box.ID, markdownPath, "/")
	if !errors.Is(err, ErrBoxClosed) {
		t.Fatalf("expected closed notebook import to return ErrBoxClosed, got [%v]", err)
	}
	after, err := filepath.Glob(pattern)
	if err != nil {
		t.Fatalf("list documents after import failed: %v", err)
	}
	if len(after) != len(before) {
		t.Fatalf("closed notebook import wrote documents: before=%d, after=%d", len(before), len(after))
	}
}

func TestGetImportAssetsDir(t *testing.T) {
	originalDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = originalDataDir
	})

	normalBoxID := "20260812000000-normal0"
	normalBoxDir := filepath.Join(util.DataDir, normalBoxID)
	globalAssetsDir := filepath.Join(util.DataDir, "assets")
	if got := GetImportAssetsDir(normalBoxID, normalBoxDir); got != globalAssetsDir {
		t.Fatalf("ordinary notebook without local assets dir = %q, want %q", got, globalAssetsDir)
	}
	if _, err := os.Stat(filepath.Join(normalBoxDir, "assets")); !os.IsNotExist(err) {
		t.Fatalf("selecting ordinary notebook assets unexpectedly created the directory: %v", err)
	}

	boxAssetsDir := filepath.Join(normalBoxDir, "assets")
	if err := os.MkdirAll(boxAssetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if got := GetImportAssetsDir(normalBoxID, normalBoxDir); got != boxAssetsDir {
		t.Fatalf("ordinary notebook assets dir = %q, want %q", got, boxAssetsDir)
	}

	docDir := filepath.Join(normalBoxDir, "20260812000001-docdir")
	docAssetsDir := filepath.Join(docDir, "assets")
	if err := os.MkdirAll(docAssetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if got := GetImportAssetsDir(normalBoxID, docDir); got != docAssetsDir {
		t.Fatalf("ordinary document assets dir = %q, want %q", got, docAssetsDir)
	}

	encryptedBoxID := "20260812000002-encrypt"
	markRuntimeEncryptedBox(encryptedBoxID)
	t.Cleanup(func() {
		forgetRuntimeEncryptedBox(encryptedBoxID)
	})
	encryptedBoxAssetsDir := filepath.Join(util.DataDir, encryptedBoxID, "assets")
	if got := GetImportAssetsDir(encryptedBoxID, docDir); got != encryptedBoxAssetsDir {
		t.Fatalf("encrypted notebook assets dir = %q, want %q", got, encryptedBoxAssetsDir)
	}
}

func TestHTML2TreeUsesExistingNotebookAssets(t *testing.T) {
	originalDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = originalDataDir
	})

	boxID := "20260812000003-htmlimg"
	boxAssetsDir := filepath.Join(util.DataDir, boxID, "assets")
	if err := os.MkdirAll(boxAssetsDir, 0755); err != nil {
		t.Fatal(err)
	}

	tree, _ := HTML2Tree(`<img alt="diagram" src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">`, util.NewLute(), boxID)
	entries, err := os.ReadDir(boxAssetsDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("notebook assets count = %d, want 1", len(entries))
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "assets")); !os.IsNotExist(err) {
		t.Fatalf("HTML conversion unexpectedly created global assets: %v", err)
	}

	assets := getAssetsLinkDests(tree.Root, false)
	if len(assets) != 1 {
		t.Fatalf("converted asset references = %v, want one reference", assets)
	}
	if strings.Contains(assets[0], "?box=") {
		t.Fatalf("ordinary notebook asset reference contains box query: %q", assets[0])
	}
}

func TestHTML2TreeUsesBase64ImageContentType(t *testing.T) {
	originalDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = originalDataDir
	})

	assetsDir := filepath.Join(util.DataDir, "assets")
	if err := os.MkdirAll(assetsDir, 0755); nil != err {
		t.Fatal(err)
	}
	source := image.NewRGBA(image.Rect(0, 0, 2, 2))
	var jpegData bytes.Buffer
	if err := jpeg.Encode(&jpegData, source, &jpeg.Options{Quality: 90}); nil != err {
		t.Fatal(err)
	}
	dataURL := "data:image/PNG;charset=binary;base64," + base64.StdEncoding.EncodeToString(jpegData.Bytes())
	tree, _ := HTML2Tree(`<img alt="diagram" src="`+dataURL+`">`, util.NewLute(), "")

	entries, err := os.ReadDir(assetsDir)
	if nil != err {
		t.Fatal(err)
	}
	if 1 != len(entries) {
		t.Fatalf("asset count = %d, want 1", len(entries))
	}
	if ".jpg" != filepath.Ext(entries[0].Name()) {
		t.Fatalf("asset extension = %q, want .jpg", filepath.Ext(entries[0].Name()))
	}
	stored, err := os.ReadFile(filepath.Join(assetsDir, entries[0].Name()))
	if nil != err {
		t.Fatal(err)
	}
	if _, format, decodeErr := image.Decode(bytes.NewReader(stored)); nil != decodeErr {
		t.Fatal(decodeErr)
	} else if "jpeg" != format {
		t.Fatalf("stored format = %q, want jpeg", format)
	}
	assets := getAssetsLinkDests(tree.Root, false)
	if 1 != len(assets) || !strings.HasSuffix(assets[0], ".jpg") {
		t.Fatalf("converted asset references = %v, want one JPEG reference", assets)
	}
}

func TestNormalizeBase64RasterImage(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 2, 2))
	source.Set(0, 0, color.RGBA{R: 255, A: 255})
	source.Set(1, 0, color.RGBA{G: 255, A: 255})
	source.Set(0, 1, color.RGBA{B: 255, A: 255})
	source.Set(1, 1, color.RGBA{R: 255, G: 255, B: 255, A: 255})

	tests := []struct {
		name       string
		encode     func(*bytes.Buffer) error
		wantExt    string
		wantFormat string
	}{
		{name: "PNG", encode: func(buf *bytes.Buffer) error { return png.Encode(buf, source) }, wantExt: ".png", wantFormat: "png"},
		{name: "JPEG", encode: func(buf *bytes.Buffer) error {
			return jpeg.Encode(buf, source, &jpeg.Options{Quality: 90})
		}, wantExt: ".jpg", wantFormat: "jpeg"},
		{name: "GIF", encode: func(buf *bytes.Buffer) error { return gif.Encode(buf, source, nil) }, wantExt: ".png", wantFormat: "png"},
		{name: "BMP", encode: func(buf *bytes.Buffer) error { return bmp.Encode(buf, source) }, wantExt: ".png", wantFormat: "png"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var sourceData bytes.Buffer
			if err := test.encode(&sourceData); nil != err {
				t.Fatal(err)
			}
			normalized, ext, err := normalizeBase64RasterImage(sourceData.Bytes())
			if nil != err {
				t.Fatal(err)
			}
			if ext != test.wantExt {
				t.Fatalf("normalized extension = %q, want %q", ext, test.wantExt)
			}
			if _, format, decodeErr := image.Decode(bytes.NewReader(normalized)); nil != decodeErr {
				t.Fatal(decodeErr)
			} else if format != test.wantFormat {
				t.Fatalf("normalized format = %q, want %q", format, test.wantFormat)
			}
		})
	}

	if _, _, err := normalizeBase64RasterImage([]byte("not an image")); nil == err {
		t.Fatal("invalid raster image was accepted")
	}
}

func TestStoreAssetForBoxAvoidsGlobalNameCollision(t *testing.T) {
	assetsDir := t.TempDir()
	existingName := "image-20260812000002-abcdefg.png"
	existingData := []byte("existing")
	if err := os.WriteFile(filepath.Join(assetsDir, existingName), existingData, 0644); err != nil {
		t.Fatal(err)
	}
	reusedName, err := storeAssetForBox("", assetsDir, existingName, existingData)
	if err != nil {
		t.Fatal(err)
	}
	if reusedName != existingName {
		t.Fatalf("identical global asset name = %q, want %q", reusedName, existingName)
	}

	newData := []byte("new")
	storedName, err := storeAssetForBox("", assetsDir, existingName, newData)
	if err != nil {
		t.Fatal(err)
	}
	if storedName == existingName {
		t.Fatalf("conflicting global asset reused existing name %q", storedName)
	}
	if data, readErr := os.ReadFile(filepath.Join(assetsDir, existingName)); readErr != nil {
		t.Fatal(readErr)
	} else if string(data) != string(existingData) {
		t.Fatalf("existing global asset was overwritten: %q", data)
	}
	if data, readErr := os.ReadFile(filepath.Join(assetsDir, storedName)); readErr != nil {
		t.Fatal(readErr)
	} else if string(data) != string(newData) {
		t.Fatalf("new global asset content = %q, want %q", data, newData)
	}
}

func TestRewriteImportedAssetReference(t *testing.T) {
	const targetBoxID = "20260731190414-j45dgmm"
	options := assetReferenceRewriteOptions{
		pathMap:         map[string]string{"assets/document.pdf": "assets/encrypted.pdf"},
		targetBoxID:     targetBoxID,
		bindTargetBox:   true,
		rewriteUnmapped: false,
	}
	tests := []struct {
		reference string
		want      string
	}{
		{
			reference: "assets/document.pdf",
			want:      "assets/encrypted.pdf?box=" + targetBoxID,
		},
		{
			reference: "assets/document.pdf?page=2",
			want:      "assets/encrypted.pdf?box=" + targetBoxID + "&page=2",
		},
		{
			reference: "assets/document.pdf?box=20260701000000-source0&page=2",
			want:      "assets/encrypted.pdf?box=" + targetBoxID + "&page=2",
		},
		{
			reference: "assets/document.pdf/20260731190415-annotat?box=20260701000000-source0",
			want:      "assets/encrypted.pdf/20260731190415-annotat?box=" + targetBoxID,
		},
		{
			reference: "assets/not-in-package.pdf?box=20260701000000-source0",
			want:      "assets/not-in-package.pdf?box=20260701000000-source0",
		},
	}

	for _, test := range tests {
		if got := rewriteAssetReference(test.reference, options); got != test.want {
			t.Fatalf("rewriteAssetReference(%q) = %q, want %q", test.reference, got, test.want)
		}
	}
}

func TestRewriteImportedAssetReferenceForNormalNotebook(t *testing.T) {
	options := assetReferenceRewriteOptions{
		pathMap: map[string]string{"assets/image.png": "assets/image.png"},
	}
	got := rewriteAssetReference("assets/image.png?box=20260701000000-source0&style=thumb", options)
	want := "assets/image.png?style=thumb"
	if got != want {
		t.Fatalf("rewrite normal notebook asset reference = %q, want %q", got, want)
	}
}

func TestImportSYAssets(t *testing.T) {
	assetData := []byte("PDF data")
	annotationData := []byte(`{"annotations":[]}`)

	t.Run("normal notebook", func(t *testing.T) {
		originalDataDir := util.DataDir
		util.DataDir = filepath.Join(t.TempDir(), "data")
		t.Cleanup(func() {
			util.DataDir = originalDataDir
		})

		unzipRootPath, sourceAssetPath := writeImportSYAssetFixture(t, assetData, annotationData)
		assetPathMap, err := importSYAssets(unzipRootPath, "")
		if err != nil {
			t.Fatal(err)
		}
		if got := assetPathMap[sourceAssetPath]; got != sourceAssetPath {
			t.Fatalf("normal asset mapping = %q, want %q", got, sourceAssetPath)
		}
		assertFileContent(t, filepath.Join(util.DataDir, filepath.FromSlash(sourceAssetPath)), assetData)
		assertFileContent(t, filepath.Join(util.DataDir, filepath.FromSlash(sourceAssetPath+".sya")), annotationData)
	})

	t.Run("encrypted notebook", func(t *testing.T) {
		const boxID = "20260812000005-encrypt"
		originalDataDir := util.DataDir
		originalWorkspaceDir := util.WorkspaceDir
		util.WorkspaceDir = t.TempDir()
		util.DataDir = filepath.Join(util.WorkspaceDir, "data")
		markRuntimeEncryptedBox(boxID)
		dek, err := util.GenerateDEK()
		if err != nil {
			t.Fatal(err)
		}
		setDEKForTest(boxID, dek)
		t.Cleanup(func() {
			cachedDEKsLock.Lock()
			if cachedDEK := cachedDEKs[boxID]; cachedDEK != nil {
				zeroAndClear(cachedDEK)
			}
			delete(cachedDEKs, boxID)
			cachedDEKsLock.Unlock()
			forgetRuntimeEncryptedBox(boxID)
			util.DataDir = originalDataDir
			util.WorkspaceDir = originalWorkspaceDir
		})

		unzipRootPath, sourceAssetPath := writeImportSYAssetFixture(t, assetData, annotationData)
		assetPathMap, err := importSYAssets(unzipRootPath, boxID)
		if err != nil {
			t.Fatal(err)
		}
		targetAssetPath := assetPathMap[sourceAssetPath]
		if targetAssetPath == "" || targetAssetPath == sourceAssetPath {
			t.Fatalf("encrypted asset mapping = %q", targetAssetPath)
		}
		if !strings.HasPrefix(targetAssetPath, "assets/") {
			t.Fatalf("encrypted asset path = %q", targetAssetPath)
		}
		if got, readErr := ReadAssetBytesInBox(boxID, targetAssetPath); readErr != nil {
			t.Fatal(readErr)
		} else if !bytes.Equal(got, assetData) {
			t.Fatalf("encrypted asset plaintext = %q, want %q", got, assetData)
		}
		if got, readErr := ReadAssetBytesInBox(boxID, targetAssetPath+".sya"); readErr != nil {
			t.Fatal(readErr)
		} else if !bytes.Equal(got, annotationData) {
			t.Fatalf("encrypted annotation plaintext = %q, want %q", got, annotationData)
		}
	})
}

func writeImportSYAssetFixture(t *testing.T, assetData, annotationData []byte) (unzipRootPath, assetPath string) {
	t.Helper()
	unzipRootPath = t.TempDir()
	assetPath = "assets/nested/document.pdf"
	absoluteAssetPath := filepath.Join(unzipRootPath, filepath.FromSlash(assetPath))
	if err := os.MkdirAll(filepath.Dir(absoluteAssetPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(absoluteAssetPath, assetData, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(absoluteAssetPath+".sya", annotationData, 0644); err != nil {
		t.Fatal(err)
	}
	return
}

func assertFileContent(t *testing.T, path string, want []byte) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("file [%s] content = %q, want %q", path, got, want)
	}
}
