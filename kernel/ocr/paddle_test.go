package ocr

import (
	"context"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

func TestCTCBlankAndRepeatedCharacters(t *testing.T) {
	data := []float32{0, .9, 0, 0, .8, 0, .9, 0, 0, 0, .7, 0, 0, 0, .8}
	text, confidence, err := decodeCTC(tensor{data, []int64{1, 5, 3}}, []string{"", "字", " "})
	if err != nil || text != "字字 " || confidence < .79 || confidence > .81 {
		t.Fatalf("text=%q confidence=%f err=%v", text, confidence, err)
	}
	if _, _, err = decodeCTC(tensor{data, []int64{1, 5, 3}}, []string{"", "字"}); err == nil {
		t.Fatal("mismatched dictionary was accepted")
	}
}

func TestDetectorRejectsUnexpectedShape(t *testing.T) {
	if _, err := detectBoxes(tensor{make([]float32, 16), []int64{1, 2, 2, 4}}, 40, 40, modelConfig{}); err == nil {
		t.Fatal("unexpected detector channels were accepted")
	}
}

// TestNativePaddleOCR 在配置模型、原生库和样例图后执行，整个过程不启动界面或内核服务器。
func TestNativePaddleOCR(t *testing.T) {
	assets, library, fixture := os.Getenv("SIYUAN_OCR_TEST_ASSETS"), os.Getenv("SIYUAN_OCR_TEST_LIBRARY"), os.Getenv("SIYUAN_OCR_TEST_IMAGE")
	if assets == "" || library == "" {
		t.Skip("native OCR resources are not configured")
	}
	expected := os.Getenv("SIYUAN_OCR_TEST_EXPECT")
	if fixture == "" {
		fixture = filepath.Join(t.TempDir(), "ocr.png")
		typeface, err := opentype.Parse(goregular.TTF)
		if err != nil {
			t.Fatal(err)
		}
		face, err := opentype.NewFace(typeface, &opentype.FaceOptions{Size: 40, DPI: 72, Hinting: font.HintingFull})
		if err != nil {
			t.Fatal(err)
		}
		defer face.Close()
		img := image.NewRGBA(image.Rect(0, 0, 500, 100))
		draw.Draw(img, img.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
		drawer := font.Drawer{Dst: img, Src: image.NewUniform(color.Black), Face: face, Dot: fixed.P(20, 65)}
		drawer.DrawString("SiYuan OCR 123")
		file, err := os.Create(fixture)
		if err != nil {
			t.Fatal(err)
		}
		if err = png.Encode(file, img); err != nil {
			file.Close()
			t.Fatal(err)
		}
		if err = file.Close(); err != nil {
			t.Fatal(err)
		}
		expected = "SiYuan OCR 123"
	}
	for _, size := range []string{"tiny", "small"} {
		t.Run(size, func(t *testing.T) {
			provider := &PaddleProvider{Config: func() PaddleConfig { return PaddleConfig{Library: library, Directory: filepath.Join(assets, size)} }}
			defer provider.Close()
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			rows, err := provider.Recognize(ctx, fixture)
			if err != nil {
				t.Fatal(err)
			}
			var text strings.Builder
			for _, row := range rows {
				text.WriteString(row["text"])
				t.Log(row["text"])
			}
			if text.Len() == 0 {
				t.Fatal("native OCR returned no text")
			}
			if expected != "" && !strings.Contains(text.String(), expected) {
				t.Fatalf("missing expected text %q in %q", expected, text.String())
			}
		})
	}
}
