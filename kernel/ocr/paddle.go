package ocr

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
	"gopkg.in/yaml.v3"
)

// PaddleConfig 指定一组检测和识别模型，Linux 使用原生辅助进程以兼容静态内核。
type PaddleConfig struct {
	Library   string `json:"library"`
	Worker    string `json:"worker"`
	Directory string `json:"directory"`
}

type modelConfig struct {
	Global struct {
		ModelName string `yaml:"model_name"`
	} `yaml:"Global"`
	PostProcess struct {
		Name         string   `yaml:"name"`
		Characters   []string `yaml:"character_dict"`
		Threshold    float64  `yaml:"thresh"`
		BoxThreshold float64  `yaml:"box_thresh"`
		Unclip       float64  `yaml:"unclip_ratio"`
	} `yaml:"PostProcess"`
}

type PaddleProvider struct {
	Config               func() PaddleConfig
	mu                   sync.Mutex
	loaded               PaddleConfig
	detector, recognizer *session
	detection            modelConfig
	characters           []string
}

func (p *PaddleProvider) Available() bool {
	cfg := p.Config()
	if cfg.Worker != "" {
		if _, err := os.Stat(cfg.Worker); err != nil {
			return false
		}
		if _, err := os.Stat(cfg.Library); err != nil {
			return false
		}
	} else if err := initRuntime(cfg.Library); err != nil {
		return false
	}
	for _, path := range []string{"det/inference.onnx", "det/inference.yml", "rec/inference.onnx", "rec/inference.yml"} {
		if _, err := os.Stat(filepath.Join(cfg.Directory, path)); err != nil {
			return false
		}
	}
	return true
}

func readModelConfig(directory, kind string) (modelConfig, error) {
	var config modelConfig
	path := filepath.Join(directory, kind, "inference.yml")
	info, err := os.Stat(path)
	if err != nil {
		return config, err
	}
	if info.Size() > 1024*1024 {
		return config, errors.New("OCR model configuration is too large")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return config, err
	}
	err = yaml.Unmarshal(data, &config)
	if err != nil {
		return config, err
	}
	if !strings.HasPrefix(config.Global.ModelName, "PP-OCRv6_") || !strings.HasSuffix(config.Global.ModelName, "_"+kind) {
		return config, errors.New("only compatible PP-OCRv6 models are supported")
	}
	if kind == "det" && (config.PostProcess.Name != "DBPostProcess" || config.PostProcess.Threshold <= 0 || config.PostProcess.Threshold >= 1 || config.PostProcess.BoxThreshold <= 0 || config.PostProcess.BoxThreshold >= 1 || config.PostProcess.Unclip <= 0 || config.PostProcess.Unclip > 3) {
		return config, errors.New("unsupported OCR detector configuration")
	}
	if kind == "rec" && (config.PostProcess.Name != "CTCLabelDecode" || len(config.PostProcess.Characters) == 0 || len(config.PostProcess.Characters) > 30000) {
		return config, errors.New("unsupported OCR recognizer configuration")
	}
	return config, nil
}

// ValidateModels 在导入和加载时校验配套配置，不接受自定义算子或外部权重。
func ValidateModels(directory string) error {
	det, err := readModelConfig(directory, "det")
	if err != nil {
		return err
	}
	rec, err := readModelConfig(directory, "rec")
	if err != nil {
		return err
	}
	if strings.TrimSuffix(det.Global.ModelName, "_det") != strings.TrimSuffix(rec.Global.ModelName, "_rec") {
		return errors.New("OCR detector and recognizer must use the same model family")
	}
	for _, kind := range []string{"det", "rec"} {
		if _, err := readModelConfig(directory, kind); err != nil {
			return err
		}
		info, err := os.Stat(filepath.Join(directory, kind, "inference.onnx"))
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > 256*1024*1024 {
			return errors.New("invalid OCR model file")
		}
	}
	return nil
}

func (p *PaddleProvider) load(cfg PaddleConfig) error {
	if cfg == p.loaded && p.detector != nil && p.recognizer != nil {
		return nil
	}
	p.close()
	if err := ValidateModels(cfg.Directory); err != nil {
		return err
	}
	det, err := readModelConfig(cfg.Directory, "det")
	if err != nil {
		return err
	}
	rec, err := readModelConfig(cfg.Directory, "rec")
	if err != nil {
		return err
	}
	if err = initRuntime(cfg.Library); err != nil {
		return err
	}
	p.detector, err = newSession(filepath.Join(cfg.Directory, "det", "inference.onnx"))
	if err != nil {
		return err
	}
	p.recognizer, err = newSession(filepath.Join(cfg.Directory, "rec", "inference.onnx"))
	if err != nil {
		p.close()
		return err
	}
	p.detection = det
	p.characters = append(append([]string{""}, rec.PostProcess.Characters...), " ")
	p.loaded = cfg
	return nil
}

func (p *PaddleProvider) close() {
	if p.detector != nil {
		p.detector.close()
		p.detector = nil
	}
	if p.recognizer != nil {
		p.recognizer.close()
		p.recognizer = nil
	}
}

// Close 释放模型会话，正在进行的识别完成后才会执行。
func (p *PaddleProvider) Close() { p.mu.Lock(); defer p.mu.Unlock(); p.close() }

type WorkerRequest struct {
	Config PaddleConfig `json:"config"`
	Image  string       `json:"image"`
}

// Validate 加载两个原生会话，导入时拒绝无法执行的 ONNX 文件。
func (p *PaddleProvider) Validate(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	cfg := p.Config()
	if cfg.Worker != "" {
		_, err := runWorker(ctx, cfg, "")
		return err
	}
	if err := p.load(cfg); err != nil {
		return err
	}
	detected, err := p.detector.run(ctx, make([]float32, 3*32*32), []int64{1, 3, 32, 32})
	if err != nil {
		return err
	}
	if _, err = detectBoxes(detected, 32, 32, p.detection); err != nil {
		return err
	}
	recognized, err := p.recognizer.run(ctx, make([]float32, 3*48*320), []int64{1, 3, 48, 320})
	if err != nil {
		return err
	}
	_, _, err = decodeCTC(recognized, p.characters)
	return err
}

func runWorker(ctx context.Context, cfg PaddleConfig, path string) ([]map[string]string, error) {
	worker := cfg.Worker
	cfg.Worker = ""
	request, err := json.Marshal(WorkerRequest{cfg, path})
	if err != nil {
		return nil, err
	}
	command := exec.CommandContext(ctx, worker)
	command.Stdin = bytes.NewReader(request)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	output, err := command.Output()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		return nil, fmt.Errorf("native OCR worker: %w: %s", err, stderr.String())
	}
	var rows []map[string]string
	if err = json.Unmarshal(output, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (p *PaddleProvider) Recognize(ctx context.Context, path string) ([]map[string]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	cfg := p.Config()
	if cfg.Worker != "" {
		return runWorker(ctx, cfg, path)
	}
	if err := p.load(cfg); err != nil {
		return nil, err
	}
	input, err := decodeImage(path)
	if err != nil {
		return nil, err
	}
	background := image.NewRGBA(image.Rect(0, 0, input.Bounds().Dx(), input.Bounds().Dy()))
	draw.Draw(background, background.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(background, background.Bounds(), input, input.Bounds().Min, draw.Over)
	input = imaging.Clone(background)
	bounds := input.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	scale := math.Min(1, 960/float64(max(w, h)))
	dw, dh := max(32, int(math.Round(float64(w)*scale/32))*32), max(32, int(math.Round(float64(h)*scale/32))*32)
	detected, err := p.detector.run(ctx, imageTensor(input, dw, dh, true), []int64{1, 3, int64(dh), int64(dw)})
	if err != nil {
		return nil, err
	}
	boxes, err := detectBoxes(detected, w, h, p.detection)
	if err != nil {
		return nil, err
	}
	rows := make([]map[string]string, 0, len(boxes))
	for _, box := range boxes {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		crop := cropBox(input, box)
		rw := max(320, min(3200, int(math.Ceil(float64(crop.Bounds().Dx())*48/float64(crop.Bounds().Dy())))))
		inputData := recognitionTensor(crop, rw)
		result, runErr := p.recognizer.run(ctx, inputData, []int64{1, 3, 48, int64(rw)})
		if runErr != nil {
			return nil, runErr
		}
		text, confidence, decodeErr := decodeCTC(result, p.characters)
		if decodeErr != nil {
			return nil, decodeErr
		}
		if strings.TrimSpace(text) == "" || confidence < 0.5 {
			continue
		}
		left, top, right, bottom := box.bounds()
		rows = append(rows, map[string]string{"level": "5", "page_num": "1", "block_num": "1", "par_num": "1", "line_num": strconv.Itoa(len(rows) + 1), "word_num": "1", "left": strconv.Itoa(int(math.Max(0, left))), "top": strconv.Itoa(int(math.Max(0, top))), "width": strconv.Itoa(int(math.Min(float64(w), right) - math.Max(0, left))), "height": strconv.Itoa(int(math.Min(float64(h), bottom) - math.Max(0, top))), "conf": strconv.FormatFloat(confidence*100, 'f', 2, 64), "text": text})
	}
	return rows, nil
}

func decodeImage(path string) (image.Image, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() > 32*1024*1024 {
		return nil, errors.New("OCR image exceeds 32 MiB")
	}
	cfg, _, err := image.DecodeConfig(file)
	if err != nil {
		return nil, err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > 24000000 {
		return nil, errors.New("OCR image exceeds 24 million pixels")
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	img, _, err := image.Decode(file)
	return img, err
}

func imageTensor(img image.Image, w, h int, detector bool) []float32 {
	resized := imaging.Resize(img, w, h, imaging.Linear)
	data := make([]float32, 3*w*h)
	mean, std := [3]float32{.485, .456, .406}, [3]float32{.229, .224, .225}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			pixel := resized.NRGBAAt(x, y)
			channels := [3]uint8{pixel.B, pixel.G, pixel.R}
			for c, value := range channels {
				v := float32(value) / 255
				if detector {
					v = (v - mean[c]) / std[c]
				} else {
					v = (v - .5) / .5
				}
				data[c*w*h+y*w+x] = v
			}
		}
	}
	return data
}

func recognitionTensor(img image.Image, width int) []float32 {
	w := min(width, max(1, int(math.Ceil(float64(img.Bounds().Dx())*48/float64(img.Bounds().Dy())))))
	resized := imageTensor(img, w, 48, false)
	result := make([]float32, 3*48*width)
	for c := 0; c < 3; c++ {
		for y := 0; y < 48; y++ {
			copy(result[c*48*width+y*width:c*48*width+y*width+w], resized[c*48*w+y*w:c*48*w+(y+1)*w])
		}
	}
	return result
}

func decodeCTC(result tensor, characters []string) (string, float64, error) {
	if len(result.shape) != 3 || result.shape[0] != 1 || result.shape[2] != int64(len(characters)) || result.shape[1] <= 0 || result.shape[1]*result.shape[2] != int64(len(result.data)) {
		return "", 0, errors.New("OCR output does not match character dictionary")
	}
	var text strings.Builder
	last, count, confidence := -1, 0, float64(0)
	classes := len(characters)
	for offset := 0; offset < len(result.data); offset += classes {
		best := 0
		for index := 1; index < classes; index++ {
			if result.data[offset+index] > result.data[offset+best] {
				best = index
			}
		}
		if best != 0 && best != last {
			text.WriteString(characters[best])
			confidence += float64(result.data[offset+best])
			count++
		}
		last = best
	}
	if count == 0 {
		return "", 0, nil
	}
	return text.String(), confidence / float64(count), nil
}
