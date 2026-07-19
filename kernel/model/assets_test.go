// SiYuan - Refactor your thinking
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
	"context"
	"encoding/base64"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAnalyzeImageDoesNotRequireDocument(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"an image"}}]}`))
	}))
	defer server.Close()

	originalConf := Conf
	t.Cleanup(func() { Conf = originalConf })
	ai := conf.NewAI()
	modelID := "20260715130000-abcdefg"
	ai.Providers = []*conf.Provider{{
		ID: "provider", Enabled: true, APIKey: "test", BaseURL: server.URL + "/v1", Protocol: "openai", RequestTimeout: 5,
		Models: []*conf.Model{{ID: modelID, Enabled: true, Name: "vision-model"}},
	}}
	ai.Vision.ModelID = modelID
	Conf = NewAppConf()
	Conf.AI = ai

	var source bytes.Buffer
	if err := png.Encode(&source, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	result, err := AnalyzeImage(context.Background(), source.Bytes(), "describe", "low")
	if err != nil {
		t.Fatal(err)
	}
	if result.Analysis != "an image" || result.Width != 2 || result.Height != 2 {
		t.Fatalf("unexpected image analysis result: %#v", result)
	}
}

func TestGenerateImageDoesNotRequireDocument(t *testing.T) {
	var source bytes.Buffer
	if err := png.Encode(&source, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"` + base64.StdEncoding.EncodeToString(source.Bytes()) + `","revised_prompt":"refined"}]}`))
	}))
	defer server.Close()

	originalConf := Conf
	t.Cleanup(func() { Conf = originalConf })
	ai := conf.NewAI()
	modelID := "20260715130000-hijklmn"
	ai.Providers = []*conf.Provider{{
		ID: "provider", Enabled: true, APIKey: "test", BaseURL: server.URL + "/v1", Protocol: "openai", RequestTimeout: 5,
		Models: []*conf.Model{{ID: modelID, Enabled: true, Name: "image-model"}},
	}}
	ai.ImageGeneration.ModelID = modelID
	Conf = NewAppConf()
	Conf.AI = ai

	result, err := GenerateImage(context.Background(), GenerateImageRequest{Prompt: "draw", OutputFormat: "png"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(result.Data, source.Bytes()) || result.MIMEType != "image/png" || result.Extension != ".png" || result.RevisedPrompt != "refined" {
		t.Fatalf("unexpected generated image result: %#v", result)
	}
}

func TestMultimodalProviderErrorsPreventAutomaticRetry(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "provider failed", http.StatusBadGateway)
	}))
	defer server.Close()

	originalConf := Conf
	t.Cleanup(func() { Conf = originalConf })
	ai := conf.NewAI()
	visionModelID := "20260715130000-provider"
	generationModelID := "20260715130001-provider"
	ai.Providers = []*conf.Provider{{
		ID: "provider", Enabled: true, APIKey: "test", BaseURL: server.URL + "/v1", Protocol: "openai", RequestTimeout: 5,
		Models: []*conf.Model{
			{ID: visionModelID, Enabled: true, Name: "vision-model"},
			{ID: generationModelID, Enabled: true, Name: "image-model"},
		},
	}}
	ai.Vision.ModelID = visionModelID
	ai.ImageGeneration.ModelID = generationModelID
	Conf = NewAppConf()
	Conf.AI = ai

	var source bytes.Buffer
	if err := png.Encode(&source, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	if _, err := AnalyzeImage(context.Background(), source.Bytes(), "describe", "low"); !IsImageExecutionUnknown(err) {
		t.Fatalf("vision provider error should prevent automatic retry: %v", err)
	}
	if _, err := GenerateImage(context.Background(), GenerateImageRequest{Prompt: "draw", OutputFormat: "png"}); !IsImageExecutionUnknown(err) {
		t.Fatalf("image provider error should prevent automatic retry: %v", err)
	}
}

func TestClearWorkspaceTempRemovesImageOperations(t *testing.T) {
	originalDataDir, originalTempDir, originalWorkspaceDir := util.DataDir, util.TempDir, util.WorkspaceDir
	t.Cleanup(func() {
		util.DataDir, util.TempDir, util.WorkspaceDir = originalDataDir, originalTempDir, originalWorkspaceDir
	})
	root := t.TempDir()
	util.DataDir = filepath.Join(root, "data")
	util.TempDir = filepath.Join(root, "temp")
	util.WorkspaceDir = root
	operationDir := filepath.Join(util.DataDir, "storage", "ai", "agent", "operations", "image")
	if err := os.MkdirAll(operationDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(operationDir, "operation.json"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}

	clearWorkspaceTemp(false)
	if _, err := os.Stat(operationDir); !os.IsNotExist(err) {
		t.Fatalf("image operation directory was not removed: %v", err)
	}
}

func TestClearWorkspaceTempPreservesInstallPackages(t *testing.T) {
	originalDataDir, originalTempDir, originalWorkspaceDir := util.DataDir, util.TempDir, util.WorkspaceDir
	t.Cleanup(func() {
		util.DataDir, util.TempDir, util.WorkspaceDir = originalDataDir, originalTempDir, originalWorkspaceDir
	})
	root := t.TempDir()
	util.DataDir = filepath.Join(root, "data")
	util.TempDir = filepath.Join(root, "temp")
	util.WorkspaceDir = root
	installPkgPath := filepath.Join(util.TempDir, "install", "siyuan-test-win.exe")
	if err := os.MkdirAll(filepath.Dir(installPkgPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(installPkgPath, []byte("test"), 0644); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-8 * 24 * time.Hour)
	if err := os.Chtimes(installPkgPath, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}

	clearWorkspaceTemp(true)
	if _, err := os.Stat(installPkgPath); err != nil {
		t.Fatalf("install package should be preserved during update: %v", err)
	}
	clearWorkspaceTemp(false)
	if _, err := os.Stat(installPkgPath); !os.IsNotExist(err) {
		t.Fatalf("old install package should be removed during normal exit: %v", err)
	}
}

func TestAnalyzeDocumentImageRejectsNetworkImage(t *testing.T) {
	_, err := AnalyzeDocumentImage(context.Background(), AnalyzeDocumentImageRequest{
		DocumentID: "20260715130000-abcdefg", AssetPath: "https://example.com/image.png",
	})
	if err == nil || err.Error() != "only local assets/... images are supported" {
		t.Fatalf("unexpected network image error: %v", err)
	}
}

func TestNormalizeMissingAssetLinkDest(t *testing.T) {
	tests := []struct {
		name string
		dest string
		want string
	}{
		{name: "asset", dest: "assets/image.png", want: "assets/image.png"},
		{name: "query", dest: "assets/document.pdf?page=2", want: "assets/document.pdf"},
		{name: "folder", dest: "assets/images/", want: ""},
		{name: "rtfd", dest: "assets/document.rtfd", want: ""},
		{name: "pdf annotation", dest: "assets/document.pdf/20200101000000-abcdefg", want: ""},
		{name: "external", dest: "https://example.com/image.png", want: ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := normalizeMissingAssetLinkDest(test.dest); got != test.want {
				t.Fatalf("normalize missing asset link destination: got %q, want %q", got, test.want)
			}
		})
	}
}

func TestGetAssetAbsPathWithSymlinkedWorkspaceAncestor(t *testing.T) {
	originalDataDir, originalWorkspaceDir := util.DataDir, util.WorkspaceDir
	t.Cleanup(func() {
		util.DataDir, util.WorkspaceDir = originalDataDir, originalWorkspaceDir
	})

	realWorkspaceDir := t.TempDir()
	aliasBaseDir := t.TempDir()
	aliasWorkspaceDir := filepath.Join(aliasBaseDir, "workspace")
	if err := os.Symlink(realWorkspaceDir, aliasWorkspaceDir); err != nil {
		t.Skipf("create workspace symlink failed: %s", err)
	}
	util.WorkspaceDir = aliasWorkspaceDir
	util.DataDir = filepath.Join(aliasWorkspaceDir, "data")

	assetPath := filepath.Join(util.DataDir, "assets", "image.png")
	if err := os.MkdirAll(filepath.Dir(assetPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(assetPath, []byte("image"), 0644); err != nil {
		t.Fatal(err)
	}

	got, err := GetAssetAbsPath("assets/image.png")
	if err != nil {
		t.Fatal(err)
	}
	if got != assetPath {
		t.Fatalf("get global asset path: got %q, want %q", got, assetPath)
	}

	outsideDir := t.TempDir()
	outsidePath := filepath.Join(outsideDir, "outside.png")
	if err = os.WriteFile(outsidePath, []byte("outside"), 0644); err != nil {
		t.Fatal(err)
	}
	linkedAssetPath := filepath.Join(util.DataDir, "assets", "outside.png")
	if err = os.Symlink(outsidePath, linkedAssetPath); err != nil {
		t.Skipf("create asset symlink failed: %s", err)
	}
	if _, err = GetAssetAbsPath("assets/outside.png"); err == nil {
		t.Fatal("asset symlink outside data/assets should be rejected")
	}
}

func TestGetAssetLinkDestsByNode(t *testing.T) {
	const blockID = "20200101000000-abcdefg"
	root := &ast.Node{Type: ast.NodeDocument}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: blockID}
	paragraph.SetIALAttr("custom-data-assets", "assets/custom.png")
	linkDest := &ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("assets/image.png")}
	root.AppendChild(paragraph)
	paragraph.AppendChild(linkDest)

	want := []string{"assets/custom.png", "assets/image.png"}
	if got := getAssetsLinkDests(root, false); !reflect.DeepEqual(got, want) {
		t.Fatalf("get asset link destinations: got %v, want %v", got, want)
	}
	if got := getAssetLinkDestsByNode(paragraph, false); !reflect.DeepEqual(got, []string{"assets/custom.png"}) {
		t.Fatalf("get block asset link destinations: got %v, want %v", got, []string{"assets/custom.png"})
	}
	if got := getAssetLinkDestsByNode(linkDest, false); !reflect.DeepEqual(got, []string{"assets/image.png"}) {
		t.Fatalf("get inline asset link destinations: got %v, want %v", got, []string{"assets/image.png"})
	}
	if got := assetLinkDestBlockID(linkDest); got != blockID {
		t.Fatalf("get asset link destination block ID: got %q, want %q", got, blockID)
	}
}
