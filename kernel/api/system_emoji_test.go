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

package api

import (
	"bytes"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestNormalizeCustomEmojiPath(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		ext      string
		expected string
		valid    bool
	}{
		{name: "plain", input: "icon", ext: ".png", expected: "icon.png", valid: true},
		{name: "nested", input: "folder/sub/icon.jpg", ext: ".webp", expected: "folder/sub/icon.webp", valid: true},
		{name: "backslash", input: `folder\icon`, ext: ".gif", expected: "folder/icon.gif", valid: true},
		{name: "parent", input: "folder/../icon", ext: ".png"},
		{name: "empty segment", input: "folder//icon", ext: ".png"},
		{name: "empty", input: "", ext: ".png"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			actual, err := normalizeCustomEmojiPath(test.input, test.ext)
			if test.valid {
				if err != nil {
					t.Fatalf("normalize custom emoji path failed: %s", err)
				}
				if actual != test.expected {
					t.Fatalf("expected [%s], got [%s]", test.expected, actual)
				}
			} else if err == nil {
				t.Fatalf("expected invalid path, got [%s]", actual)
			}
		})
	}
}

func TestNormalizeCustomEmojiData(t *testing.T) {
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatalf("encode png failed: %s", err)
	}

	data, ext, err := normalizeCustomEmojiData(pngData.Bytes())
	if err != nil {
		t.Fatalf("normalize png failed: %s", err)
	}
	if ext != ".png" || !bytes.Equal(data, pngData.Bytes()) {
		t.Fatalf("unexpected normalized png")
	}

	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle cx="1" cy="1" r="1"/></svg>`)
	data, ext, err = normalizeCustomEmojiData(svg)
	if err != nil {
		t.Fatalf("normalize svg failed: %s", err)
	}
	if ext != ".svg" || bytes.Contains(data, []byte("<script")) {
		t.Fatalf("unsafe svg was not sanitized")
	}

	if _, _, err = normalizeCustomEmojiData([]byte("not an image")); err == nil {
		t.Fatalf("expected invalid image data")
	}
}

func TestDownloadCustomEmojiData(t *testing.T) {
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatalf("encode png failed: %s", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/icon" {
			http.NotFound(writer, request)
			return
		}
		writer.Header().Set("Content-Type", "image/png")
		_, _ = writer.Write(pngData.Bytes())
	}))
	t.Cleanup(server.Close)

	data, err := downloadCustomEmojiData(server.URL + "/icon")
	if err != nil {
		t.Fatalf("download custom emoji failed: %s", err)
	}
	if !bytes.Equal(data, pngData.Bytes()) {
		t.Fatal("downloaded custom emoji differs from response")
	}
	if _, err = downloadCustomEmojiData(server.URL + "/missing"); err == nil {
		t.Fatal("expected HTTP error")
	}
	if _, err = downloadCustomEmojiData("file:///tmp/icon.png"); err == nil {
		t.Fatal("expected invalid URL error")
	}
}

func TestReadCustomEmojisRecursively(t *testing.T) {
	model.ClearCustomEmojis()
	t.Cleanup(model.ClearCustomEmojis)
	root := t.TempDir()
	nestedDir := filepath.Join(root, "folder", "sub")
	if err := os.MkdirAll(nestedDir, 0755); err != nil {
		t.Fatalf("create nested custom emoji directory failed: %s", err)
	}
	if err := os.WriteFile(filepath.Join(nestedDir, "icon.png"), []byte("test"), 0644); err != nil {
		t.Fatalf("write custom emoji failed: %s", err)
	}

	items := []map[string]any{}
	readCustomEmojis(root, "", &items)
	if len(items) != 1 {
		t.Fatalf("expected one custom emoji, got %d", len(items))
	}
	if actual := items[0]["unicode"]; actual != "folder/sub/icon.png" {
		t.Fatalf("unexpected custom emoji path [%v]", actual)
	}
}
