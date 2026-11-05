// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package ocr

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"hash/crc32"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestPaddleImageFormatClassification(t *testing.T) {
	// 两帧、每帧 2×2 像素的无损 WebP 动画及同尺寸的静态 WebP。
	animated, err := hex.DecodeString("524946468400000057454250565038580a00000002000000010000010000414e494d06000000000000000000414e4d4628000000000000000000010000010000640000025650384c0f0000002f014000000710fd8ffe0722a2ff0100414e4d4628000000000000000000010000010000640000005650384c0f0000002f014000000710d1fffe0722a2ff0100")
	if err != nil {
		t.Fatal(err)
	}
	static, err := hex.DecodeString("524946461c000000574542505650384c0f0000002f014000000710fd8ffe0722a2ff0100")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = image.Decode(bytes.NewReader(animated)); err == nil {
		t.Fatal("animated fixture must exercise the unsupported WebP decoder")
	}
	for _, test := range []struct {
		name        string
		data        []byte
		unsupported bool
		wantError   bool
	}{
		{"animated.webp", animated, true, true},
		{"static.webp", static, false, false},
		{"unsupported.png", []byte("<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), true, true},
		{"corrupt.webp", static[:25], false, true},
		{"truncated.webp", animated[:29], false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), test.name)
			if err := os.WriteFile(path, test.data, 0600); err != nil {
				t.Fatal(err)
			}
			img, err := decodeImage(path)
			if (err != nil) != test.wantError || errors.Is(err, ErrUnsupportedImage) != test.unsupported {
				t.Fatalf("decodeImage returned %v, unsupported=%v", err, test.unsupported)
			}
			if err == nil && img.Bounds() != image.Rect(0, 0, 2, 2) {
				t.Fatalf("unexpected image bounds: %v", img.Bounds())
			}
			if test.unsupported {
				provider := &PaddleProvider{Config: func() PaddleConfig {
					return PaddleConfig{Worker: filepath.Join(t.TempDir(), "missing-worker")}
				}}
				if _, err := provider.Recognize(context.Background(), path); !errors.Is(err, ErrUnsupportedImage) {
					t.Fatalf("worker path lost unsupported image classification: %v", err)
				}
			}
			data, readErr := os.ReadFile(path)
			if readErr != nil || !bytes.Equal(data, test.data) {
				t.Fatalf("recognition modified source image: %v", readErr)
			}
		})
	}
}

func TestPaddleImageLimitsArePermanent(t *testing.T) {
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	oversized := pngData.Bytes()
	binary.BigEndian.PutUint32(oversized[16:20], 8000)
	binary.BigEndian.PutUint32(oversized[20:24], 6000)
	binary.BigEndian.PutUint32(oversized[29:33], crc32.ChecksumIEEE(oversized[12:29]))
	for _, limit := range []string{"pixels", "bytes"} {
		t.Run(limit, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "image.png")
			if err := os.WriteFile(path, oversized, 0600); err != nil {
				t.Fatal(err)
			}
			if limit == "bytes" {
				if err := os.Truncate(path, 32*1024*1024+1); err != nil {
					t.Fatal(err)
				}
			}
			for _, worker := range []bool{false, true} {
				var err error
				if worker {
					_, err = runWorker(context.Background(), PaddleConfig{Worker: filepath.Join(t.TempDir(), "missing-worker")}, path)
				} else {
					_, err = decodeImage(path)
				}
				if !errors.Is(err, ErrPermanent) || errors.Is(err, ErrUnsupportedImage) {
					t.Fatalf("worker=%v, incorrect image limit classification: %v", worker, err)
				}
			}
		})
	}
}
