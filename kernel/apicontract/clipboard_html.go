package apicontract

import (
	"bytes"
	"encoding/json"
	"io"
)

type HTMLClipboardRequest struct {
	DOM                  string `json:"dom"`
	Notebook             string `json:"notebook" api:"optional,nullable,ignoretype"`
	Text                 string `json:"text" api:"optional,nullable,ignoretype"`
	MathML               string `json:"mathML" api:"optional,nullable,ignoretype"`
	Office               string `json:"office" api:"optional,nullable,ignoretype"`
	OfficeMathHTML       string `json:"officeMathHTML" api:"optional,nullable,ignoretype"`
	WPS                  string `json:"wps" api:"optional,nullable,ignoretype"`
	SkipLocalAssets      bool   `json:"skipLocalAssets" api:"optional,nullable"`
	SkipBase64Assets     bool   `json:"skipBase64Assets" api:"optional,nullable"`
	SkipInlineSVGAssets  bool   `json:"skipInlineSVGAssets" api:"optional,nullable"`
	Preflight            bool   `json:"preflight" api:"optional,nullable"`
	PreparedHTML         bool   `json:"preparedHTML" api:"optional,nullable"`
	PreserveSourceFormat bool   `json:"preserveSourceFormat" api:"optional,nullable"`
}

type HTMLClipboardPreflight struct {
	Converted      bool    `json:"converted"`
	DOM            *string `json:"dom,omitempty"`
	NormalizedHTML *string `json:"normalizedHTML,omitempty"`
	UseHTML        bool    `json:"useHTML"`
}

// HTMLClipboardData 区分直接转换文本与预处理结果。
type HTMLClipboardData struct {
	text      string
	preflight *HTMLClipboardPreflight
}

func HTMLClipboardText(text string) HTMLClipboardData {
	return HTMLClipboardData{text: text}
}

func HTMLClipboardPrepared(value HTMLClipboardPreflight) HTMLClipboardData {
	return HTMLClipboardData{preflight: &value}
}

func (value HTMLClipboardData) MarshalJSON() ([]byte, error) {
	if value.preflight != nil {
		return json.Marshal(value.preflight)
	}
	return json.Marshal(value.text)
}

func init() {
	plain := HTML2BlockDOM
	HTML2BlockDOM.decodeRequest = func(reader io.Reader) (request HTMLClipboardRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/lute/html2BlockDOM")
		if err != nil {
			return request, err
		}
		for _, key := range []string{"skipLocalAssets", "skipBase64Assets", "skipInlineSVGAssets", "preflight", "preparedHTML", "preserveSourceFormat"} {
			if raw, exists := fields[key]; exists {
				var value bool
				if json.Unmarshal(raw, &value) != nil {
					delete(fields, key)
				}
			}
		}
		data, err := json.Marshal(fields)
		if err != nil {
			return request, err
		}
		return plain.Decode(bytes.NewReader(data))
	}
}
