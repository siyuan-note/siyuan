package ocr

import (
	"errors"
	"math"
	"strings"
)

// Thresholds 仅覆盖本次识别的后处理参数，空值保留模型检测配置和既有识别阈值。
type Thresholds struct {
	Detection   *float64 `json:"detection"`
	Box         *float64 `json:"box"`
	Recognition *float64 `json:"recognition"`
}

func (t Thresholds) Validate() error {
	for _, value := range []*float64{t.Detection, t.Box} {
		if value != nil && (math.IsNaN(*value) || math.IsInf(*value, 0) || *value <= 0 || *value >= 1) {
			return errors.New("OCR detection and box thresholds must be greater than 0 and less than 1")
		}
	}
	if value := t.Recognition; value != nil && (math.IsNaN(*value) || math.IsInf(*value, 0) || *value < 0 || *value > 1) {
		return errors.New("OCR recognition threshold must be between 0 and 1")
	}
	return nil
}

func (t Thresholds) detectionConfig(config modelConfig) modelConfig {
	if t.Detection != nil {
		config.PostProcess.Threshold = *t.Detection
	}
	if t.Box != nil {
		config.PostProcess.BoxThreshold = *t.Box
	}
	return config
}

func (t Thresholds) accepts(text string, confidence float64) bool {
	threshold := 0.5
	if t.Recognition != nil {
		threshold = *t.Recognition
	}
	return strings.TrimSpace(text) != "" && confidence >= threshold
}
