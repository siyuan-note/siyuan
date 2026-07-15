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
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
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
		Models: []*conf.Model{{ID: modelID, Enabled: true, Name: "vision-model", Capabilities: []string{"image-input"}}},
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
		Models: []*conf.Model{{ID: modelID, Enabled: true, Name: "image-model", Capabilities: []string{"image-output"}}},
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
