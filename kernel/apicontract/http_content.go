package apicontract

import (
	"fmt"
	"mime"
	"strings"
)

// HTTPContentVariant 声明原始响应的状态和媒体类型组合。
type HTTPContentVariant struct {
	Status      int    `json:"status"`
	ContentType string `json:"contentType"`
}

// HTTPContentOptions 用于具有固定响应格式的页面或文件入口，保留统一 JSON 错误信封。
func HTTPContentOptions(variants ...HTTPContentVariant) ResponseOptions {
	if len(variants) == 0 {
		panic("HTTP content requires explicit response variants")
	}
	return ResponseOptions{Output: BinaryOutput, ErrorStatus: 200, ContentVariants: variants}
}

func SuccessHTTPContent(status int, contentType string, data []byte) Response[BinaryContent] {
	return Response[BinaryContent]{binary: &BinaryContent{Status: status, ContentType: contentType, Bytes: data}}
}

func validateContentVariants(definition Definition) error {
	if len(definition.ContentVariants) == 0 {
		return nil
	}
	if definition.Output != BinaryOutput {
		return fmt.Errorf("content variants require binary output: %s", definition.Name)
	}
	seen := map[HTTPContentVariant]bool{}
	for _, variant := range definition.ContentVariants {
		media, parameters, err := mime.ParseMediaType(variant.ContentType)
		if err != nil || !strings.Contains(media, "/") || media != variant.ContentType || len(parameters) != 0 || variant.Status < 200 || variant.Status > 599 || variant.Status == 204 || variant.Status == 304 {
			return fmt.Errorf("invalid HTTP content variant: %s", definition.Name)
		}
		if seen[variant] {
			return fmt.Errorf("duplicate HTTP content variant: %s", definition.Name)
		}
		seen[variant] = true
	}
	return nil
}

func matchesContentVariant(variants []HTTPContentVariant, status int, media string) bool {
	for _, variant := range variants {
		if variant.Status == status && variant.ContentType == media {
			return true
		}
	}
	return false
}
