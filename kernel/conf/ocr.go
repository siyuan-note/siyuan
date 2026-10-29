// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

// OCR 配置保存在设备配置中，模型文件和识别结果独立于提供商选择。
type OCR struct {
	Provider        string        `json:"provider"`
	Model           string        `json:"model"`
	AIModelID       string        `json:"aiModelId"`
	ReasoningEffort string        `json:"reasoningEffort"`
	Auto            bool          `json:"auto"`
	ShowText        *bool         `json:"showText"`
	ShowEmpty       bool          `json:"showEmpty"`
	ShowError       bool          `json:"showError"`
	Thresholds      OCRThresholds `json:"thresholds"`
}

// OCRThresholds 中的空值沿用模型检测参数和 0.5 的识别阈值。
type OCRThresholds struct {
	Detection   *float64 `json:"detection"`
	Box         *float64 `json:"box"`
	Recognition *float64 `json:"recognition"`
}

func NewOCR() *OCR {
	return &OCR{Provider: "paddleocr", Model: "tiny", Auto: false, ShowText: new(true)}
}
