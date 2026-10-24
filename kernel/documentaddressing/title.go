package documentaddressing

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/88250/lute/html"
)

var (
	ErrModeConflict          = errors.New("document title requires structured addressing")
	ErrInvalidTitle          = errors.New("invalid document title source")
	ErrLegacyPathUnsupported = errors.New("legacy document paths are unsupported; use structured document addressing")
)

// CheckLegacyTitle 检查已经解码的兼容模式标题，不清洗内容，也不将冲突视为已确认的模式启用。
// 保留全角斜杆、百分号编码、HTML 实体和 Markdown 字面文本。
func CheckLegacyTitle(title string) error {
	if strings.Contains(title, "/") {
		return ErrModeConflict
	}
	return nil
}

// CheckLegacyTitleProperties 在属性解码和修复前检查每个标题值，重复字段不能遮盖冲突源。
func CheckLegacyTitleProperties(data []byte) error {
	return CheckTitleProperties(data, 1)
}

// CheckTitleProperties 保留原始字符；模式只决定是否允许新字符，不能清洗冲突源。
func CheckTitleProperties(data []byte, mode int) error {
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return nil
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return ErrInvalidTitle
	}
	var titleErr error
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return ErrInvalidTitle
		}
		var value json.RawMessage
		if decoder.Decode(&value) != nil {
			return ErrInvalidTitle
		}
		if token != "title" {
			continue
		}
		var title string
		if json.Unmarshal(value, &title) != nil {
			if titleErr == nil {
				titleErr = ErrInvalidTitle
			}
		} else if err = CheckLegacyTitle(html.UnescapeAttrVal(title)); mode < 2 && err != nil {
			titleErr = err
		}
	}
	if token, err = decoder.Token(); err != nil || token != json.Delim('}') {
		return ErrInvalidTitle
	}
	if _, err = decoder.Token(); err != io.EOF {
		return ErrInvalidTitle
	}
	return titleErr
}
