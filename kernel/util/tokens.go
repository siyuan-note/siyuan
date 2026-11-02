// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"strings"
	"sync"

	"github.com/pkoukk/tiktoken-go"
	loader "github.com/pkoukk/tiktoken-go-loader"
)

var tokenEncodingLoader sync.Once
var tokenEncodings sync.Map

// GetTokenEncoding 共享离线分词器；未知模型使用 cl100k_base 估算，不下载词表。
func GetTokenEncoding(modelName string) (*tiktoken.Tiktoken, error) {
	tokenEncodingLoader.Do(func() { tiktoken.SetBpeLoader(loader.NewOfflineLoader()) })
	key := strings.ToLower(strings.TrimSpace(modelName))
	if cached, ok := tokenEncodings.Load(key); ok {
		return cached.(*tiktoken.Tiktoken), nil
	}
	encoding, err := tiktoken.EncodingForModel(modelName)
	if err != nil {
		encoding, err = tiktoken.GetEncoding("cl100k_base")
	}
	if err != nil {
		return nil, err
	}
	actual, _ := tokenEncodings.LoadOrStore(key, encoding)
	return actual.(*tiktoken.Tiktoken), nil
}
