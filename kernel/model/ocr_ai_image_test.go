// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/png"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/ocr"
	"golang.org/x/image/bmp"
)

func TestAIOCRImageLimitsArePermanent(t *testing.T) {
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareAIOCRImage(context.Background(), encoded.Bytes()); err != nil {
		t.Fatal(err)
	}
	oversized := encoded.Bytes()
	binary.BigEndian.PutUint32(oversized[16:20], 8000)
	binary.BigEndian.PutUint32(oversized[20:24], 6000)
	binary.BigEndian.PutUint32(oversized[29:33], crc32.ChecksumIEEE(oversized[12:29]))
	var bitmap bytes.Buffer
	if err := bmp.Encode(&bitmap, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	oversizedBitmap := bitmap.Bytes()
	binary.LittleEndian.PutUint32(oversizedBitmap[18:22], 8000)
	binary.LittleEndian.PutUint32(oversizedBitmap[22:26], 6000)
	for _, data := range [][]byte{oversized, oversizedBitmap, make([]byte, documentImageMaxBytes+1)} {
		if _, err := prepareAIOCRImage(context.Background(), data); !errors.Is(err, ocr.ErrPermanent) || errors.Is(err, ocr.ErrUnsupportedImage) {
			t.Fatalf("incorrect AI image limit classification: %v", err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := prepareAIOCRImage(ctx, oversized); !errors.Is(err, context.Canceled) || errors.Is(err, ocr.ErrPermanent) {
		t.Fatalf("cancellation became a permanent image error: %v", err)
	}
}
