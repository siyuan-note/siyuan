// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package server

import (
	"mime"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// requestAcceptsHEIF 只接受客户端显式声明且质量值大于 0 的 HEIC/HEIF 媒体类型。
func requestAcceptsHEIF(request *http.Request) bool {
	for _, accept := range request.Header.Values("Accept") {
		values, valid := splitAcceptHeader(accept)
		if !valid {
			continue
		}
		for _, value := range values {
			mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(value))
			if err != nil || (mediaType != "image/heic" && mediaType != "image/heif") {
				continue
			}
			if !acceptQualityPositive(value) {
				continue
			}
			return true
		}
	}
	return false
}

// splitAcceptHeader 仅在引号外拆分 Accept 条目，避免把媒体类型参数中的逗号当成分隔符。
func splitAcceptHeader(value string) ([]string, bool) {
	return splitHeaderValue(value, ',')
}

func splitHeaderValue(value string, separator rune) ([]string, bool) {
	var ret []string
	start := 0
	quoted := false
	escaped := false
	for index, char := range value {
		if escaped {
			escaped = false
			continue
		}
		if quoted && char == '\\' {
			escaped = true
			continue
		}
		if char == '"' {
			quoted = !quoted
			continue
		}
		if char == separator && !quoted {
			ret = append(ret, value[start:index])
			start = index + 1
		}
	}
	if quoted {
		return nil, false
	}
	return append(ret, value[start:]), true
}

// acceptQualityPositive 拒绝扩展、重复或非正数的 q 参数，未声明 q 时使用默认质量值 1。
func acceptQualityPositive(value string) bool {
	parameters, valid := splitHeaderValue(value, ';')
	if !valid {
		return false
	}
	foundQuality := false
	for _, parameter := range parameters[1:] {
		name, quality, found := strings.Cut(parameter, "=")
		if !found {
			continue
		}
		name = strings.ToLower(strings.TrimSpace(name))
		if strings.HasPrefix(name, "q*") || (name == "q" && foundQuality) {
			return false
		}
		if name != "q" {
			continue
		}
		foundQuality = true
		if !positiveQValue(strings.TrimSpace(quality)) {
			return false
		}
	}
	return true
}

// positiveQValue 按 HTTP qvalue 语法接受最多三位小数，且只返回大于 0 的质量值。
func positiveQValue(value string) bool {
	if value == "1" {
		return true
	}
	if strings.HasPrefix(value, "1.") {
		digits := value[2:]
		if 3 < len(digits) {
			return false
		}
		for _, digit := range digits {
			if digit != '0' {
				return false
			}
		}
		return true
	}
	if !strings.HasPrefix(value, "0.") {
		return false
	}
	digits := value[2:]
	if 3 < len(digits) {
		return false
	}
	positive := false
	for _, digit := range digits {
		if digit < '0' || '9' < digit {
			return false
		}
		positive = positive || digit != '0'
	}
	return positive
}

// shouldTranscodeHEIF 保持下载原件和 JPEG 缩略图语义，全图按客户端能力协商。
func shouldTranscodeHEIF(context *gin.Context) bool {
	if strings.EqualFold(context.Query("download"), "true") {
		return false
	}
	if context.Query("style") == "thumb" {
		return true
	}
	return !requestAcceptsHEIF(context.Request)
}

// addHEIFVaryAccept 标记全图响应会随 Accept 请求头变化，并保留其他缓存协商字段。
func addHEIFVaryAccept(context *gin.Context) {
	if strings.EqualFold(context.Query("download"), "true") || context.Query("style") == "thumb" {
		return
	}
	for _, vary := range context.Writer.Header().Values("Vary") {
		for _, value := range strings.Split(vary, ",") {
			if strings.EqualFold(strings.TrimSpace(value), "Accept") || strings.TrimSpace(value) == "*" {
				return
			}
		}
	}
	context.Writer.Header().Add("Vary", "Accept")
}
