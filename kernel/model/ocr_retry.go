// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/ocr"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type automaticOCRRetryEntry struct {
	Updated    int64                    `json:"updated"`
	Version    automaticOCRAssetVersion `json:"version"`
	RetryAfter time.Time                `json:"-"`
}

type automaticOCRAssetVersion struct {
	Modified int64 `json:"modified"`
	Size     int64 `json:"size"`
}

type automaticOCRRetryCache struct {
	sync.Mutex
	filename           string
	config             string
	generation         uint64
	entries            map[string]automaticOCRRetryEntry
	dirty              bool
	providerConfig     string
	providerRetryAfter time.Time
	providerNotified   bool
}

func automaticOCRProviderConfig(value conf.OCR) string {
	if value.Provider != "ai" {
		return ""
	}
	provider, model := getOCRAIModel(value)
	data, _ := json.Marshal([]any{provider, model})
	return fmt.Sprintf("%x", sha256.Sum256(data))
}

func automaticOCRProviderFailure(err error) bool {
	var apiErr *openai.APIError
	var requestErr *openai.RequestError
	status := 0
	if errors.As(err, &apiErr) {
		status = apiErr.HTTPStatusCode
	} else if errors.As(err, &requestErr) {
		status = requestErr.HTTPStatusCode
	}
	switch status {
	case http.StatusUnauthorized, http.StatusPaymentRequired, http.StatusForbidden, http.StatusNotFound:
		return true
	}
	return false
}

type automaticOCRRetryFile struct {
	Config string                            `json:"config"`
	Assets map[string]automaticOCRRetryEntry `json:"assets"`
}

func automaticOCRRetryConfig(value conf.OCR) string {
	// 显示选项不影响识别；版本和本机大小限制变化后允许重新检查图片。
	value.ShowText, value.ShowEmpty, value.ShowError = nil, false, false
	var tesseractMaxSize uint64
	if value.Provider == string(ocr.Tesseract) {
		tesseractMaxSize = util.TesseractMaxSize
	}
	data, _ := json.Marshal(struct {
		Version          string
		OCR              conf.OCR
		TesseractMaxSize uint64
	}{util.Ver, value, tesseractMaxSize})
	return string(data)
}

func (c *automaticOCRRetryCache) loadLocked() {
	filename := filepath.Join(util.TempDir, "ocr-retry.json")
	if c.filename == filename {
		return
	}
	c.filename, c.config = filename, ""
	c.entries = map[string]automaticOCRRetryEntry{}
	c.providerConfig, c.providerRetryAfter, c.providerNotified = "", time.Time{}, false
	c.generation++
	c.dirty = false
	data, err := os.ReadFile(filename)
	if os.IsNotExist(err) {
		return
	}
	var saved automaticOCRRetryFile
	if err == nil {
		err = json.Unmarshal(data, &saved)
	}
	if err != nil {
		logging.LogWarnf("load automatic OCR retry cache failed: %s", err)
		return
	}
	c.config = saved.Config
	for path, entry := range saved.Assets {
		c.entries[path] = entry
	}
}

func (c *automaticOCRRetryCache) saveLocked() {
	if !c.dirty {
		return
	}
	// 失败缓存仅保存在本机，不写入 OCR 文本或同步数据；临时错误无需跨重启保留冷却。
	saved := automaticOCRRetryFile{Config: c.config, Assets: map[string]automaticOCRRetryEntry{}}
	for path, entry := range c.entries {
		if entry.RetryAfter.IsZero() {
			saved.Assets[path] = entry
		}
	}
	data, err := json.Marshal(saved)
	if err == nil {
		err = gulu.File.WriteFileSafer(c.filename, data, 0600)
	}
	if err != nil {
		logging.LogWarnf("save automatic OCR retry cache failed: %s", err)
		return
	}
	c.dirty = false
}

func (c *automaticOCRRetryCache) reset() {
	c.Lock()
	defer c.Unlock()
	c.loadLocked()
	c.entries = map[string]automaticOCRRetryEntry{}
	c.config = ""
	c.providerConfig, c.providerRetryAfter, c.providerNotified = "", time.Time{}, false
	c.generation++
	c.dirty = true
	c.saveLocked()
}

func (c *automaticOCRRetryCache) prepare(value conf.OCR, assets map[string]*cache.Asset) uint64 {
	c.Lock()
	defer c.Unlock()
	c.loadLocked()
	config := automaticOCRRetryConfig(value)
	providerConfig := automaticOCRProviderConfig(value)
	if c.config != config || c.providerConfig != providerConfig {
		c.providerConfig, c.providerRetryAfter, c.providerNotified = providerConfig, time.Time{}, false
		c.generation++
	}
	if c.config != config {
		c.config = config
		c.entries = map[string]automaticOCRRetryEntry{}
		c.generation++
		c.dirty = true
	}
	for path, entry := range c.entries {
		asset := assets[path]
		if asset == nil || asset.Updated != entry.Updated || util.ExistsAssetText(path) {
			delete(c.entries, path)
			c.dirty = c.dirty || entry.RetryAfter.IsZero()
		}
	}
	c.saveLocked()
	return c.generation
}

func (c *automaticOCRRetryCache) ready(generation uint64, asset *cache.Asset, version automaticOCRAssetVersion, now time.Time) bool {
	c.Lock()
	defer c.Unlock()
	if c.generation != generation || now.Before(c.providerRetryAfter) {
		return false
	}
	entry, exists := c.entries[asset.Path]
	return !exists || entry.Updated != asset.Updated || entry.Version != version || !entry.RetryAfter.IsZero() && !now.Before(entry.RetryAfter)
}

func (c *automaticOCRRetryCache) record(generation uint64, asset *cache.Asset, version automaticOCRAssetVersion, err error, now time.Time) bool {
	c.Lock()
	defer c.Unlock()
	// 设置变化使在途批次失效，旧请求不能恢复已经清空的失败记录。
	if c.generation != generation || errors.Is(err, context.Canceled) {
		return false
	}
	previous, exists := c.entries[asset.Path]
	if c.providerConfig != "" && automaticOCRProviderFailure(err) {
		// 账户及模型配置错误共用冷却，避免轮换图片继续请求；充值后仍可自动探测恢复。
		c.providerRetryAfter = now.Add(10 * time.Minute)
		notify := !c.providerNotified
		c.providerNotified = true
		return notify
	}
	if err == nil {
		c.providerRetryAfter, c.providerNotified = time.Time{}, false
		delete(c.entries, asset.Path)
	} else {
		entry := automaticOCRRetryEntry{Updated: asset.Updated, Version: version}
		if !errors.Is(err, ocr.ErrPermanent) && !errors.Is(err, ocr.ErrUnsupportedImage) {
			entry.RetryAfter = now.Add(10 * time.Minute)
		}
		c.entries[asset.Path] = entry
		c.dirty = c.dirty || entry.RetryAfter.IsZero()
	}
	c.dirty = c.dirty || exists && previous.RetryAfter.IsZero()
	c.saveLocked()
	return true
}
