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
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"os"
	"runtime"

	"github.com/disintegration/imaging"
	goheic "github.com/siyuan-note/siyuan/kernel/heif/internal/h265heic"
)

const (
	thumbnailWidth   = 520
	previewQuality   = 90
	thumbnailQuality = 85
	MaxInputBytes    = 32 * 1024 * 1024
	maxDimension     = 65535
	desktopMaxPixels = 50_000_000
	mobileMaxPixels  = 12_500_000
	// 解码层仅接受至多 10-bit 4:2:0、无透明通道的单 slice 图像；这里按解码面、CTU 表、
	// NRGBA 和一次合并变换预留每像素 16 字节，再单独预留源文件、RBSP 副本与 JPEG 输出。
	workingBytesPerPixel = 16
	desktopWorkingBudget = 960 * 1024 * 1024
	mobileWorkingBudget  = 320 * 1024 * 1024
	desktopOutputReserve = 96 * 1024 * 1024
	mobileOutputReserve  = 32 * 1024 * 1024
)

var (
	ErrInputTooLarge = errors.New("HEIF image exceeds the input size limit")
	ErrImageTooLarge = errors.New("HEIF image exceeds the dimension limit")
	ErrInvalidMode   = errors.New("invalid HEIF conversion mode")

	conversionSlots = make(chan struct{}, 1)
	maxPixels       = platformMaxPixels()
)

func platformMaxPixels() int {
	if runtime.GOOS == "android" || runtime.GOOS == "ios" {
		return pixelsWithinBudget(mobileWorkingBudget, mobileOutputReserve, mobileMaxPixels)
	}
	return pixelsWithinBudget(desktopWorkingBudget, desktopOutputReserve, desktopMaxPixels)
}

func ReadFileLimited(path string, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 {
		return nil, ErrInputTooLarge
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		return nil, ErrInputTooLarge
	}
	return data, nil
}

func pixelsWithinBudget(workingBudget, outputReserve, hardLimit int) int {
	available := workingBudget - 2*MaxInputBytes - outputReserve
	if available <= 0 {
		return 0
	}
	return min(available/workingBytesPerPixel, hardLimit)
}

type Mode string

const (
	ModePreview   Mode = "preview"
	ModeThumbnail Mode = "thumb"
)

func convert(ctx context.Context, source []byte, mode Mode) ([]byte, error) {
	if len(source) == 0 {
		return nil, errors.New("empty HEIF image")
	}
	if len(source) > MaxInputBytes {
		return nil, ErrInputTooLarge
	}
	if mode != ModePreview && mode != ModeThumbnail {
		return nil, ErrInvalidMode
	}

	select {
	case conversionSlots <- struct{}{}:
		defer func() {
			<-conversionSlots
		}()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	conversionContext, cancel := context.WithTimeout(ctx, conversionTimeout)
	defer cancel()

	img, err := decodeImage(source)
	if err != nil {
		return nil, err
	}
	if !validDimensions(img.Bounds().Dx(), img.Bounds().Dy()) {
		return nil, ErrImageTooLarge
	}
	if err = conversionContext.Err(); err != nil {
		return nil, err
	}
	if mode == ModeThumbnail && img.Bounds().Dx() > thumbnailWidth {
		img = imaging.Resize(img, thumbnailWidth, 0, imaging.Lanczos)
	}
	if err = conversionContext.Err(); err != nil {
		return nil, err
	}

	quality := previewQuality
	if mode == ModeThumbnail {
		quality = thumbnailQuality
	}
	output := bytes.NewBuffer(make([]byte, 0, estimatedJPEGSize(img)))
	if err = jpeg.Encode(output, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, fmt.Errorf("encode HEIF preview: %w", err)
	}
	if err = conversionContext.Err(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func ImageSize(source []byte) (width, height int, err error) {
	if len(source) == 0 {
		return 0, 0, errors.New("empty HEIF image")
	}
	if len(source) > MaxInputBytes {
		return 0, 0, ErrInputTooLarge
	}
	conversionSlots <- struct{}{}
	defer func() {
		<-conversionSlots
	}()
	img, err := decodeImage(source)
	if err != nil {
		return 0, 0, err
	}
	width, height = img.Bounds().Dx(), img.Bounds().Dy()
	if !validDimensions(width, height) {
		return 0, 0, ErrImageTooLarge
	}
	return width, height, nil
}

func decodeImage(source []byte) (img image.Image, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			img = nil
			err = fmt.Errorf("decode HEIF image: %v", recovered)
		}
	}()

	config, err := goheic.DecodeConfigBytes(source)
	if err != nil {
		return nil, fmt.Errorf("read HEIF image dimensions: %w", err)
	}
	if !validDimensions(config.Width, config.Height) {
		return nil, ErrImageTooLarge
	}

	img, err = goheic.DecodeBytes(source, goheic.Options{
		AutoRotate:     true,
		FrameSizeLimit: maxPixels,
		Threads:        1,
	})
	if err != nil {
		return nil, fmt.Errorf("decode HEIF image: %w", err)
	}
	return img, nil
}

func validDimensions(width, height int) bool {
	return width > 0 && height > 0 && width <= maxDimension && height <= maxDimension &&
		uint64(width)*uint64(height) <= uint64(maxPixels)
}

func estimatedJPEGSize(img image.Image) int {
	pixels := int64(img.Bounds().Dx()) * int64(img.Bounds().Dy())
	estimate := pixels / 2
	if estimate < 64*1024 {
		estimate = 64 * 1024
	}
	if estimate > 32*1024*1024 {
		estimate = 32 * 1024 * 1024
	}
	return int(estimate)
}
