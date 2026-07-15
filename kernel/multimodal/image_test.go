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
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestPrepareForVisionReencodesAndLimitsImage(t *testing.T) {
	var source bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 4, 2))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	if err := png.Encode(&source, img); err != nil {
		t.Fatal(err)
	}
	prepared, err := PrepareForVision(source.Bytes(), 1024*1024, 8, 2)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.MIMEType != "image/jpeg" || prepared.Width != 2 || prepared.Height != 1 {
		t.Fatalf("unexpected prepared image: %#v", prepared)
	}
	if _, err = PrepareForVision(source.Bytes(), 1024*1024, 7, 2); err == nil {
		t.Fatal("pixel limit was not enforced before decoding")
	}
	if _, err = PrepareForVision([]byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`), 1024, 100, 100); err == nil {
		t.Fatal("SVG input must be rejected")
	}
}
