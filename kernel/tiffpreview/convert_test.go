// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tiffpreview

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/png"
	"path/filepath"
	"sort"
	"testing"

	"golang.org/x/image/tiff"
)

func TestIsPathPreservesFilesystemCharacters(t *testing.T) {
	for _, path := range []string{
		"image.tif", "image.TIFF", filepath.Join("notes#1", "assets", "image.tif"),
		filepath.Join("notes?1", "assets", "image.tiff"), filepath.Join("assets", "image#1.tif"),
	} {
		if !IsPath(path) {
			t.Fatalf("TIFF filesystem path was not recognized: %s", path)
		}
	}
	for _, path := range []string{"image.png", "image.tif.txt", "image.tif?style=thumb", "image.tif#preview"} {
		if IsPath(path) {
			t.Fatalf("non-TIFF filesystem path was accepted: %s", path)
		}
	}
}

func encodeTIFF(t *testing.T, img image.Image, compression tiff.CompressionType) []byte {
	t.Helper()
	var buffer bytes.Buffer
	if err := tiff.Encode(&buffer, img, &tiff.Options{Compression: compression}); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

// withMetadata 保留像素和偏移，追加测试所需的首个 IFD 及可选后续页。
func withMetadata(data []byte, description string, orientation uint16, multiPage bool) []byte {
	data = bytes.Clone(data)
	order := binary.LittleEndian
	offset := int(order.Uint32(data[4:8]))
	count := int(order.Uint16(data[offset:]))
	entries := make([][]byte, 0, count+2)
	for i := 0; i < count; i++ {
		entries = append(entries, bytes.Clone(data[offset+2+i*12:offset+2+(i+1)*12]))
	}
	addEntry := func(tag, kind uint16, count, value uint32) {
		entry := make([]byte, 12)
		order.PutUint16(entry, tag)
		order.PutUint16(entry[2:], kind)
		order.PutUint32(entry[4:], count)
		order.PutUint32(entry[8:], value)
		entries = append(entries, entry)
	}
	if description != "" {
		start := len(data)
		data = append(data, []byte(description+"\x00")...)
		addEntry(270, 2, uint32(len(description)+1), uint32(start))
	}
	if orientation != 0 {
		addEntry(274, 3, 1, uint32(orientation))
	}
	sort.Slice(entries, func(i, j int) bool { return order.Uint16(entries[i]) < order.Uint16(entries[j]) })
	if len(data)%2 != 0 {
		data = append(data, 0)
	}
	first := len(data)
	order.PutUint32(data[4:], uint32(first))
	ifd := make([]byte, 2+len(entries)*12+4)
	order.PutUint16(ifd, uint16(len(entries)))
	for i, entry := range entries {
		copy(ifd[2+i*12:], entry)
	}
	if multiPage {
		order.PutUint32(ifd[len(ifd)-4:], uint32(first+len(ifd)))
	}
	data = append(data, ifd...)
	if multiPage {
		second := bytes.Clone(ifd)
		// 后续页故意不可解码，用来验证首帧预览不读取下一页。
		order.PutUint32(second[len(second)-4:], 0)
		for i, entry := range entries {
			if order.Uint16(entry) == 259 {
				order.PutUint32(second[2+i*12+8:], 65535)
			}
		}
		data = append(data, second...)
	}
	return data
}

func decodePreview(t *testing.T, source []byte, thumb bool) image.Image {
	t.Helper()
	data, err := Convert(context.Background(), source, thumb)
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	return img
}

func TestConvertGrayDisplay(t *testing.T) {
	gray := image.NewGray16(image.Rect(0, 0, 3, 1))
	for x, value := range []uint16{120, 1960, 3800} {
		gray.SetGray16(x, 0, color.Gray16{Y: value})
	}
	for _, test := range []struct {
		name, description string
		multiPage         bool
		want              []uint8
	}{
		{"actual range", "", false, []uint8{0, 128, 255}},
		{"multi IFD first frame", "", true, []uint8{0, 128, 255}},
		{"ImageJ single IFD stack", "ImageJ=1.11a\nimages=12\nframes=12\nmin=0\nmax=4095\n", false, []uint8{7, 122, 237}},
		{"invalid ImageJ range", "ImageJ=1.54\nmin=invalid\nmax=4095\n", false, []uint8{0, 128, 255}},
		{"infinite ImageJ range", "ImageJ=1.54\nmin=0\nmax=Inf\n", false, []uint8{0, 128, 255}},
		{"non ImageJ description", "min=0\nmax=4095\n", false, []uint8{0, 128, 255}},
		{"clamped display range", "ImageJ=1.54\nmin=500\nmax=2000\n", false, []uint8{0, 248, 255}},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := withMetadata(encodeTIFF(t, gray, tiff.Deflate), test.description, 0, test.multiPage)
			before := bytes.Clone(source)
			img := decodePreview(t, source, false)
			for x, want := range test.want {
				got := color.GrayModel.Convert(img.At(x, 0)).(color.Gray).Y
				if got != want {
					t.Fatalf("pixel %d = %d, want %d", x, got, want)
				}
			}
			if !bytes.Equal(source, before) {
				t.Fatal("preview modified the original TIFF")
			}
		})
	}
	flat := image.NewGray16(image.Rect(0, 0, 1, 1))
	flat.SetGray16(0, 0, color.Gray16{Y: 32768})
	img := decodePreview(t, encodeTIFF(t, flat, tiff.Uncompressed), false)
	if got := color.GrayModel.Convert(img.At(0, 0)).(color.Gray).Y; got != 128 {
		t.Fatalf("uniform image = %d, want 128", got)
	}
	inverted := withMetadata(encodeTIFF(t, gray, tiff.Uncompressed), "ImageJ=1.54\nmin=0\nmax=4095\n", 0, false)
	offset := int(binary.LittleEndian.Uint32(inverted[4:]))
	for i := 0; i < int(binary.LittleEndian.Uint16(inverted[offset:])); i++ {
		entry := inverted[offset+2+i*12:]
		if binary.LittleEndian.Uint16(entry) == 262 {
			binary.LittleEndian.PutUint16(entry[8:], 0)
		}
	}
	img = decodePreview(t, inverted, false)
	for x, want := range []uint8{248, 133, 18} {
		if got := color.GrayModel.Convert(img.At(x, 0)).(color.Gray).Y; got != want {
			t.Fatalf("white-is-zero pixel %d = %d, want %d", x, got, want)
		}
	}
}

func TestConvertPreserves8BitAndAlpha(t *testing.T) {
	gray := image.NewGray(image.Rect(0, 0, 2, 1))
	gray.Pix = []byte{7, 253}
	img := decodePreview(t, encodeTIFF(t, gray, tiff.Deflate), false)
	for x, want := range gray.Pix {
		if got := color.GrayModel.Convert(img.At(x, 0)).(color.Gray).Y; got != want {
			t.Fatalf("8-bit pixel %d = %d, want %d", x, got, want)
		}
	}
	rgba := image.NewNRGBA(image.Rect(0, 0, 1, 1))
	rgba.SetNRGBA(0, 0, color.NRGBA{R: 200, G: 50, B: 20, A: 128})
	img = decodePreview(t, encodeTIFF(t, rgba, tiff.Deflate), false)
	if got := color.NRGBAModel.Convert(img.At(0, 0)).(color.NRGBA); got != rgba.NRGBAAt(0, 0) {
		t.Fatalf("RGBA = %v, want %v", got, rgba.NRGBAAt(0, 0))
	}
}

func TestConvertOrientationAndThumbnail(t *testing.T) {
	gray := image.NewGray(image.Rect(0, 0, 2, 1))
	gray.Pix = []byte{7, 253}
	for orientation := uint16(1); orientation <= 8; orientation++ {
		img := decodePreview(t, withMetadata(encodeTIFF(t, gray, tiff.Uncompressed), "", orientation, false), false)
		want := image.Rect(0, 0, 2, 1)
		if orientation >= 5 {
			want = image.Rect(0, 0, 1, 2)
		}
		if img.Bounds() != want {
			t.Fatalf("orientation %d bounds = %v, want %v", orientation, img.Bounds(), want)
		}
		first := uint8(7)
		if orientation == 2 || orientation == 3 || orientation == 7 || orientation == 8 {
			first = 253
		}
		if got := color.GrayModel.Convert(img.At(0, 0)).(color.Gray).Y; got != first {
			t.Fatalf("orientation %d first pixel = %d, want %d", orientation, got, first)
		}
	}
	large := image.NewGray(image.Rect(0, 0, 1040, 520))
	source := encodeTIFF(t, large, tiff.Deflate)
	if got := decodePreview(t, source, true).Bounds(); got != image.Rect(0, 0, 520, 260) {
		t.Fatalf("thumbnail bounds = %v", got)
	}
	if got := decodePreview(t, source, false).Bounds(); got != large.Bounds() {
		t.Fatalf("full preview bounds = %v", got)
	}
}

func TestConvertRejectsInvalidAndOversizedInputs(t *testing.T) {
	for _, source := range [][]byte{nil, []byte("not a TIFF"), {'I', 'I', 43, 0, 8, 0, 0, 0}} {
		if _, err := Convert(context.Background(), source, false); err == nil {
			t.Fatal("invalid or unsupported TIFF was accepted")
		}
	}
	source := encodeTIFF(t, image.NewGray(image.Rect(0, 0, 1, 1)), tiff.Uncompressed)
	order := binary.LittleEndian
	offset := int(order.Uint32(source[4:]))
	for i := 0; i < int(order.Uint16(source[offset:])); i++ {
		entry := source[offset+2+i*12:]
		if order.Uint16(entry) == 256 {
			order.PutUint16(entry[2:], 4)
			order.PutUint32(entry[8:], 65536)
		}
	}
	if _, err := Convert(context.Background(), source, false); !errors.Is(err, ErrImageTooLarge) {
		t.Fatalf("oversized dimensions = %v", err)
	}
	if _, err := Convert(context.Background(), make([]byte, MaxInputBytes+1), false); !errors.Is(err, ErrInputTooLarge) {
		t.Fatalf("oversized input = %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Convert(ctx, source, false); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled conversion = %v", err)
	}
}
