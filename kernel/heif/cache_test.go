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

package heif

import (
	"bytes"
	"context"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIsPath(t *testing.T) {
	tests := map[string]bool{
		"assets/photo.heic":                  true,
		"assets/photo.HEIF?box=test#preview": true,
		"assets/photo.jpeg":                  false,
		"assets/photo.heic.txt":              false,
	}
	for path, want := range tests {
		if got := IsPath(path); got != want {
			t.Fatalf("IsPath(%q) = %v, want %v", path, got, want)
		}
	}
}

func TestMemoryCacheCopiesAndClearsByBox(t *testing.T) {
	ClearMemoryCache("")
	t.Cleanup(func() {
		ClearMemoryCache("")
	})

	source := []byte{1, 2, 3}
	putMemoryCache("box-a:key", "box-a", source)
	source[0] = 9
	first := getMemoryCache("box-a:key")
	if !bytes.Equal(first, []byte{1, 2, 3}) {
		t.Fatalf("cache retained caller-owned bytes: %v", first)
	}
	first[1] = 9
	second := getMemoryCache("box-a:key")
	if !bytes.Equal(second, []byte{1, 2, 3}) {
		t.Fatalf("cache returned mutable storage: %v", second)
	}

	ClearMemoryCache("box-b")
	if got := getMemoryCache("box-a:key"); got == nil {
		t.Fatal("clearing another notebook removed the cache entry")
	}
	ClearMemoryCache("box-a")
	if got := getMemoryCache("box-a:key"); got != nil {
		t.Fatalf("cache entry was not cleared: %v", got)
	}
	if !bytes.Equal(second, []byte{1, 2, 3}) {
		t.Fatalf("clearing the cache modified an in-use copy: %v", second)
	}
}

func TestCacheDigestSeparatesModes(t *testing.T) {
	source := []byte("image")
	preview := cacheDigest(source, ModePreview)
	if preview != cacheDigest(source, ModePreview) {
		t.Fatal("preview cache digest is not stable")
	}
	if preview == cacheDigest(source, ModeThumbnail) {
		t.Fatal("preview and thumbnail cache digests are equal")
	}
}

func TestGetOrCreateValidatesOptionsBeforeDecode(t *testing.T) {
	if _, err := GetOrCreate(context.Background(), []byte("image"), Options{}); err != ErrInvalidMode {
		t.Fatalf("unexpected invalid mode error: %v", err)
	}
	if _, err := GetOrCreate(context.Background(), []byte("image"), Options{
		Mode:      ModePreview,
		Encrypted: true,
	}); err == nil {
		t.Fatal("encrypted cache accepted an empty notebook ID")
	}
}

func TestValidDimensions(t *testing.T) {
	if !validDimensions(8064, 6048) {
		t.Fatal("a 48 megapixel image was rejected")
	}
	if validDimensions(0, 1) || validDimensions(maxDimension+1, 1) || validDimensions(10_001, 10_001) {
		t.Fatal("an invalid or oversized image was accepted")
	}
}

func TestReadFileLimited(t *testing.T) {
	path := t.TempDir() + "/image.heic"
	if err := os.WriteFile(path, []byte{1, 2, 3, 4}, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadFileLimited(path, 3); err != ErrInputTooLarge {
		t.Fatalf("unexpected oversized read error: %v", err)
	}
	data, err := ReadFileLimited(path, 4)
	if err != nil || !bytes.Equal(data, []byte{1, 2, 3, 4}) {
		t.Fatalf("unexpected bounded read: %v, %v", data, err)
	}
}

func TestConvertStillImages(t *testing.T) {
	tests := []string{"basic.heic"}
	for _, name := range tests {
		t.Run(name, func(t *testing.T) {
			source, err := os.ReadFile("testdata/" + name)
			if err != nil {
				t.Fatal(err)
			}
			preview, err := convert(context.Background(), source, ModePreview)
			if err != nil {
				t.Fatal(err)
			}
			config, err := jpeg.DecodeConfig(bytes.NewReader(preview))
			if err != nil {
				t.Fatalf("preview is not a JPEG: %v", err)
			}
			if !validDimensions(config.Width, config.Height) {
				t.Fatalf("invalid preview dimensions: %dx%d", config.Width, config.Height)
			}
		})
	}
}

func TestGetOrCreateFallsBackToMemoryWhenDiskCacheFails(t *testing.T) {
	source, err := os.ReadFile("testdata/basic.heic")
	if err != nil {
		t.Fatal(err)
	}
	blocked := filepath.Join(t.TempDir(), "blocked")
	if err = os.WriteFile(blocked, []byte("file"), 0600); err != nil {
		t.Fatal(err)
	}
	previousTempDir := util.TempDir
	util.TempDir = blocked
	defer func() {
		util.TempDir = previousTempDir
	}()

	result, err := GetOrCreate(context.Background(), source, Options{Mode: ModePreview})
	if err != nil {
		t.Fatal(err)
	}
	if result.Path != "" || len(result.Data) == 0 {
		t.Fatalf("unexpected cache fallback result: path=%q data=%d", result.Path, len(result.Data))
	}
}
