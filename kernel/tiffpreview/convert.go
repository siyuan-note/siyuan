// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tiffpreview

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/disintegration/imaging"
	"golang.org/x/image/tiff"
)

const MaxInputBytes = 64 * 1024 * 1024

var (
	ErrInputTooLarge = errors.New("TIFF image exceeds the input size limit")
	ErrImageTooLarge = errors.New("TIFF image exceeds the dimension limit")
)

// IsPath 按文件系统路径识别 TIFF；URL 查询参数由调用方解析，不截断合法路径中的井号。
func IsPath(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".tif" || ext == ".tiff"
}

func ReadFileLimited(path string, limit int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err == nil && int64(len(data)) > limit {
		clear(data)
		return nil, ErrInputTooLarge
	}
	return data, err
}

type contextReader struct {
	*bytes.Reader
	ctx context.Context
}

func (r contextReader) ReadAt(p []byte, offset int64) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.Reader.ReadAt(p, offset)
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.Reader.Read(p)
}

type contextWriter struct {
	*bytes.Buffer
	ctx context.Context
}

func (w contextWriter) Write(p []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	return w.Buffer.Write(p)
}

// Convert 仅解码首个 IFD，生成浏览器可显示的 PNG；原件及后续帧保持不变。
// 16 位灰度优先采用 ImageJ 显示范围，否则按首帧的实际灰度范围拉伸。
func Convert(ctx context.Context, source []byte, thumbnail bool) (output []byte, err error) {
	if len(source) > MaxInputBytes {
		return nil, ErrInputTooLarge
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			output = nil
			err = fmt.Errorf("decode TIFF preview: %v", recovered)
		}
	}()
	reader := contextReader{bytes.NewReader(source), ctx}
	config, err := tiff.DecodeConfig(reader)
	if err != nil {
		return nil, err
	}
	maxPixels := 50_000_000
	if runtime.GOOS == "android" || runtime.GOOS == "ios" {
		maxPixels = 12_500_000
	}
	if config.Width < 1 || config.Height < 1 || config.Width > 65535 || config.Height > 65535 ||
		config.Width > maxPixels/config.Height {
		return nil, ErrImageTooLarge
	}
	reader.Seek(0, io.SeekStart)
	img, err := tiff.Decode(reader)
	if err != nil {
		return nil, err
	}
	defer clearPixels(img)
	metadata := readMetadata(source)
	if gray, ok := img.(*image.Gray16); ok {
		img, err = displayGray(ctx, gray, metadata)
		if err != nil {
			return nil, err
		}
		defer clearPixels(img)
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	switch metadata.orientation {
	case 2:
		img = imaging.FlipH(img)
	case 3:
		img = imaging.Rotate180(img)
	case 4:
		img = imaging.FlipV(img)
	case 5:
		img = imaging.Transpose(img)
	case 6:
		img = imaging.Rotate270(img)
	case 7:
		img = imaging.Transverse(img)
	case 8:
		img = imaging.Rotate90(img)
	}
	defer clearPixels(img)
	if thumbnail && img.Bounds().Dx() > 520 {
		img = imaging.Resize(img, 520, 0, imaging.Lanczos)
		defer clearPixels(img)
	}
	var buffer bytes.Buffer
	if err = png.Encode(contextWriter{&buffer, ctx}, img); err != nil {
		clear(buffer.Bytes())
		return nil, err
	}
	return buffer.Bytes(), nil
}

func clearPixels(img image.Image) {
	switch value := img.(type) {
	case *image.Gray:
		clear(value.Pix)
	case *image.Gray16:
		clear(value.Pix)
	case *image.RGBA:
		clear(value.Pix)
	case *image.RGBA64:
		clear(value.Pix)
	case *image.NRGBA:
		clear(value.Pix)
	case *image.NRGBA64:
		clear(value.Pix)
	case *image.Paletted:
		clear(value.Pix)
	}
}

type metadata struct {
	orientation int
	min, max    float64
	hasRange    bool
}

// readMetadata 只读取首个经典 TIFF IFD 中有界的方向和 ImageJ 显示范围，不遍历图像栈。
func readMetadata(source []byte) (result metadata) {
	if len(source) < 8 {
		return
	}
	var order binary.ByteOrder = binary.LittleEndian
	if string(source[:2]) == "MM" {
		order = binary.BigEndian
	}
	offset := uint64(order.Uint32(source[4:8]))
	if offset+2 > uint64(len(source)) {
		return
	}
	count := uint64(order.Uint16(source[offset : offset+2]))
	whiteIsZero := false
	for i := uint64(0); i < count; i++ {
		position := offset + 2 + 12*i
		if position+12 > uint64(len(source)) {
			return
		}
		entry := source[position : position+12]
		tag, kind, size := order.Uint16(entry), order.Uint16(entry[2:]), uint64(order.Uint32(entry[4:]))
		if tag == 262 && kind == 3 && size == 1 {
			whiteIsZero = order.Uint16(entry[8:]) == 0
		}
		if tag == 274 && kind == 3 && size == 1 {
			result.orientation = int(order.Uint16(entry[8:]))
		}
		if tag != 270 || kind != 2 || size < 5 || size > 64*1024 {
			continue
		}
		start := uint64(order.Uint32(entry[8:]))
		if start+size > uint64(len(source)) {
			continue
		}
		description := strings.TrimRight(string(source[start:start+size]), "\x00")
		if !strings.HasPrefix(description, "ImageJ=") {
			continue
		}
		low, high := math.NaN(), math.NaN()
		for _, line := range strings.Split(description, "\n") {
			key, value, found := strings.Cut(strings.TrimSpace(line), "=")
			if !found {
				continue
			}
			switch key {
			case "min":
				if number, err := strconv.ParseFloat(value, 64); err == nil {
					low = number
				}
			case "max":
				if number, err := strconv.ParseFloat(value, 64); err == nil {
					high = number
				}
			}
		}
		if !math.IsNaN(low) && !math.IsNaN(high) && low >= 0 && high <= 65535 && high > low {
			result.min, result.max, result.hasRange = low, high, true
		}
	}
	if result.hasRange && whiteIsZero {
		result.min, result.max = 65535-result.max, 65535-result.min
	}
	return
}

func displayGray(ctx context.Context, source *image.Gray16, info metadata) (*image.Gray, error) {
	low, high := info.min, info.max
	if !info.hasRange {
		low, high = 65535, 0
		for y := source.Rect.Min.Y; y < source.Rect.Max.Y; y++ {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			for x := source.Rect.Min.X; x < source.Rect.Max.X; x++ {
				value := float64(source.Gray16At(x, y).Y)
				low, high = min(low, value), max(high, value)
			}
		}
	}
	if high <= low {
		low, high = 0, 65535
	}
	result := image.NewGray(source.Rect)
	for y := source.Rect.Min.Y; y < source.Rect.Max.Y; y++ {
		if err := ctx.Err(); err != nil {
			clear(result.Pix)
			return nil, err
		}
		for x := source.Rect.Min.X; x < source.Rect.Max.X; x++ {
			value := (float64(source.Gray16At(x, y).Y) - low) * 255 / (high - low)
			result.Pix[result.PixOffset(x, y)] = uint8(min(255, max(0, math.Round(value))))
		}
	}
	return result, nil
}
