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

package multimodal

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"strings"

	"github.com/disintegration/imaging"
	"github.com/gabriel-vasile/mimetype"
	_ "golang.org/x/image/webp"
)

const maxGeneratedImageBytes = 50 * 1024 * 1024

const maxGeneratedImagePixels = 100 * 1000 * 1000

func PrepareForVision(data []byte, maxBytes, maxPixels, maxEdge int) (PreparedImage, error) {
	if len(data) == 0 {
		return PreparedImage{}, errors.New("image data is empty")
	}
	if maxBytes > 0 && len(data) > maxBytes {
		return PreparedImage{}, fmt.Errorf("image exceeds size limit: %d bytes", maxBytes)
	}
	mimeType := mimetype.Detect(data).String()
	if strings.Contains(mimeType, "svg") || bytes.Contains(bytes.ToLower(data[:min(len(data), 512)]), []byte("<svg")) {
		return PreparedImage{}, errors.New("SVG images are not accepted by vision models")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return PreparedImage{}, errors.New("unsupported or invalid image: " + err.Error())
	}
	if config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > int64(maxPixels) {
		return PreparedImage{}, fmt.Errorf("image exceeds pixel limit: %d", maxPixels)
	}

	decoded, err := imaging.Decode(bytes.NewReader(data), imaging.AutoOrientation(true))
	if err != nil {
		return PreparedImage{}, errors.New("decode image failed: " + err.Error())
	}
	if maxEdge > 0 && (decoded.Bounds().Dx() > maxEdge || decoded.Bounds().Dy() > maxEdge) {
		decoded = imaging.Fit(decoded, maxEdge, maxEdge, imaging.Lanczos)
	}
	var output bytes.Buffer
	if err = jpeg.Encode(&output, decoded, &jpeg.Options{Quality: 88}); err != nil {
		return PreparedImage{}, errors.New("encode image failed: " + err.Error())
	}
	if maxBytes > 0 && output.Len() > maxBytes {
		return PreparedImage{}, fmt.Errorf("prepared image exceeds size limit: %d bytes", maxBytes)
	}
	bounds := decoded.Bounds()
	return PreparedImage{
		Data:       output.Bytes(),
		MIMEType:   "image/jpeg",
		Width:      bounds.Dx(),
		Height:     bounds.Dy(),
		SourceSize: len(data),
	}, nil
}

func ValidateGeneratedImage(data []byte) (mimeType, extension string, err error) {
	if len(data) == 0 {
		return "", "", errors.New("generated image is empty")
	}
	if len(data) > maxGeneratedImageBytes {
		return "", "", errors.New("generated image exceeds size limit")
	}
	mimeType = mimetype.Detect(data).String()
	switch mimeType {
	case "image/png":
		extension = ".png"
	case "image/jpeg":
		extension = ".jpg"
	case "image/webp":
		extension = ".webp"
	default:
		return "", "", fmt.Errorf("unsupported generated image type: %s", mimeType)
	}
	config, _, decodeErr := image.DecodeConfig(bytes.NewReader(data))
	if decodeErr != nil || config.Width < 1 || config.Height < 1 || config.Width > 16384 || config.Height > 16384 ||
		int64(config.Width)*int64(config.Height) > maxGeneratedImagePixels {
		return "", "", errors.New("generated image is invalid")
	}
	return mimeType, extension, nil
}
