package conf

// OCR 配置保存在设备配置中，模型文件和识别结果独立于提供商选择。
type OCR struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Auto     bool   `json:"auto"`
}

func NewOCR(mobile bool) *OCR {
	model := "small"
	if mobile {
		model = "tiny"
	}
	return &OCR{Provider: "tesseract", Model: model, Auto: true}
}
