package conf

// OCR 配置保存在设备配置中，模型文件和识别结果独立于提供商选择。
type OCR struct {
	Provider   string        `json:"provider"`
	Model      string        `json:"model"`
	Auto       bool          `json:"auto"`
	Thresholds OCRThresholds `json:"thresholds"`
}

// OCRThresholds 中的空值沿用模型检测参数和 0.5 的识别阈值。
type OCRThresholds struct {
	Detection   *float64 `json:"detection"`
	Box         *float64 `json:"box"`
	Recognition *float64 `json:"recognition"`
}

func NewOCR(mobile bool) *OCR {
	model := "small"
	if mobile {
		model = "tiny"
	}
	return &OCR{Provider: "paddleocr", Model: model, Auto: false}
}
