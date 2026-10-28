// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tiffpreview

import (
	"bytes"
	"context"
	"image"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/image/tiff"
)

func TestCacheSeparatesContentAndThumbnail(t *testing.T) {
	root := t.TempDir()
	source := encodeTIFF(t, image.NewGray(image.Rect(0, 0, 1040, 520)), tiff.Deflate)
	first, err := GetOrCreate(context.Background(), source, root, false, false)
	if err != nil || first.Path == "" || first.ETag == "" {
		t.Fatalf("create cache = %+v, %v", first, err)
	}
	again, err := GetOrCreate(context.Background(), source, root, false, false)
	if err != nil || again.Path != first.Path || again.ETag != first.ETag {
		t.Fatalf("repeat cache = %+v, %v", again, err)
	}
	thumb, err := GetOrCreate(context.Background(), source, root, true, false)
	if err != nil || thumb.Path == first.Path || thumb.ETag == first.ETag {
		t.Fatalf("thumbnail cache = %+v, %v", thumb, err)
	}
	changed := bytes.Clone(source)
	changed = append(changed, 0)
	updated, err := GetOrCreate(context.Background(), changed, root, false, false)
	if err != nil || updated.Path == first.Path || updated.ETag == first.ETag {
		t.Fatalf("updated content cache = %+v, %v", updated, err)
	}
}

func TestEncryptedPreviewNeverReadsOrWritesDiskCache(t *testing.T) {
	root := t.TempDir()
	source := encodeTIFF(t, image.NewGray(image.Rect(0, 0, 3, 2)), tiff.Deflate)
	ordinary, err := GetOrCreate(context.Background(), source, root, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(ordinary.Path, []byte("poisoned disk cache"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, directory := range []string{root, filepath.Join(root, "encrypted-only")} {
		result, err := GetOrCreate(context.Background(), source, directory, false, true)
		if err != nil || result.Path != "" || result.ETag != "" || !bytes.HasPrefix(result.Data, []byte("\x89PNG")) {
			t.Fatalf("encrypted preview = %+v, %v", result, err)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "encrypted-only")); !os.IsNotExist(err) {
		t.Fatal("encrypted preview created a disk cache")
	}
}

func TestCacheWriteFailureStillReturnsPreview(t *testing.T) {
	path := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(path, []byte("file"), 0600); err != nil {
		t.Fatal(err)
	}
	source := encodeTIFF(t, image.NewGray(image.Rect(0, 0, 1, 1)), tiff.Uncompressed)
	result, err := GetOrCreate(context.Background(), source, path, false, false)
	if err != nil || len(result.Data) == 0 || result.Path != "" {
		t.Fatalf("uncacheable preview = %+v, %v", result, err)
	}
}
