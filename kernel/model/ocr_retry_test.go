// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/ocr"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAutomaticOCRRetryCache(t *testing.T) {
	previousTempDir := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = previousTempDir })
	value := *conf.NewOCR()
	value.Auto = true
	asset := &cache.Asset{Path: "assets/ocr-retry-test.png", Updated: 1}
	assets := map[string]*cache.Asset{asset.Path: asset}
	version := automaticOCRAssetVersion{Modified: 1000000001, Size: 42}
	now := time.Now()
	var retries automaticOCRRetryCache
	generation := retries.prepare(value, assets)
	if !retries.ready(generation, asset, version, now) {
		t.Fatal("new image was not eligible")
	}
	for _, err := range []error{ocr.ErrPermanent, ocr.ErrUnsupportedImage} {
		retries.record(generation, asset, version, err, now)
		if retries.ready(generation, asset, version, now.Add(24*time.Hour)) {
			t.Fatal("permanent failure expired")
		}
		var reloaded automaticOCRRetryCache
		loadedGeneration := reloaded.prepare(value, assets)
		if reloaded.ready(loadedGeneration, asset, version, now.Add(24*time.Hour)) {
			t.Fatal("permanent failure was not persisted")
		}
		retries.record(generation, asset, version, nil, now)
		if !retries.ready(generation, asset, version, now) {
			t.Fatal("success retained permanent failure")
		}
	}
	retries.record(generation, asset, version, errors.New("temporary inference failure"), now)
	if retries.ready(generation, asset, version, now.Add(9*time.Minute)) || !retries.ready(generation, asset, version, now.Add(10*time.Minute)) {
		t.Fatal("temporary failure did not keep a ten-minute cooldown")
	}
	data, err := os.ReadFile(filepath.Join(util.TempDir, "ocr-retry.json"))
	if err != nil || strings.Contains(string(data), asset.Path) {
		t.Fatalf("temporary failure was persisted: %s, %v", data, err)
	}
	asset.Updated++
	if !retries.ready(generation, asset, version, now) {
		t.Fatal("modified asset inherited a cooldown")
	}
	retries.record(generation, asset, version, ocr.ErrPermanent, now)
	asset.Updated++
	generation = retries.prepare(value, assets)
	if !retries.ready(generation, asset, version, now) {
		t.Fatal("modified asset inherited a permanent failure")
	}
	if retries.record(generation, asset, version, context.Canceled, now) || !retries.ready(generation, asset, version, now) {
		t.Fatal("cancellation retained a retry entry")
	}
	for _, changed := range []automaticOCRAssetVersion{
		{Modified: version.Modified + 1, Size: version.Size},
		{Modified: version.Modified, Size: version.Size + 1},
	} {
		retries.record(generation, asset, version, ocr.ErrPermanent, now)
		var reloaded automaticOCRRetryCache
		loadedGeneration := reloaded.prepare(value, assets)
		if !reloaded.ready(loadedGeneration, asset, changed, now) {
			t.Fatal("same-second or timestamp-preserving replacement inherited a permanent failure")
		}
	}
	retries.record(generation, asset, version, ocr.ErrPermanent, now)
	oldGeneration := generation
	retries.reset()
	generation = retries.prepare(value, assets)
	if retries.record(oldGeneration, asset, version, ocr.ErrPermanent, now) || !retries.ready(generation, asset, version, now) {
		t.Fatal("in-flight failure survived settings reset")
	}
	retries.record(generation, asset, version, ocr.ErrPermanent, now)
	value.Provider = "tesseract"
	generation = retries.prepare(value, assets)
	if !retries.ready(generation, asset, version, now) {
		t.Fatal("changed provider inherited a failure")
	}
	retries.record(generation, asset, version, ocr.ErrPermanent, now)
	value.Auto = false
	retries.prepare(value, assets)
	value.Auto = true
	generation = retries.prepare(value, assets)
	if !retries.ready(generation, asset, version, now) {
		t.Fatal("toggling automatic recognition retained a failure")
	}
	retries.record(generation, asset, version, ocr.ErrPermanent, now)
	util.SetAssetText(asset.Path, "manual result")
	t.Cleanup(func() { util.RemoveAssetText(asset.Path) })
	retries.prepare(value, assets)
	if len(retries.entries) != 0 {
		t.Fatal("saved OCR text retained retry state")
	}
	util.RemoveAssetText(asset.Path)
	retries.record(generation, asset, version, ocr.ErrPermanent, now)
	retries.prepare(value, nil)
	if len(retries.entries) != 0 {
		t.Fatal("removed image retained retry state")
	}
}

func TestAutomaticOCRRetryConfig(t *testing.T) {
	value := *conf.NewOCR()
	baseline := automaticOCRRetryConfig(value)
	value.ShowText, value.ShowEmpty, value.ShowError = new(false), true, true
	if automaticOCRRetryConfig(value) != baseline {
		t.Fatal("display options invalidated retry state")
	}
	for _, change := range []func(*conf.OCR){
		func(v *conf.OCR) { v.Provider = "ai" },
		func(v *conf.OCR) { v.Model = "other" },
		func(v *conf.OCR) { v.AIModelID = "vision" },
		func(v *conf.OCR) { v.ReasoningEffort = "high" },
		func(v *conf.OCR) { v.Auto = !v.Auto },
		func(v *conf.OCR) { v.Thresholds.Recognition = new(0.7) },
	} {
		changed := value
		change(&changed)
		if automaticOCRRetryConfig(changed) == baseline {
			t.Fatal("recognition configuration did not invalidate retry state")
		}
	}
	previousLimit := util.TesseractMaxSize
	t.Cleanup(func() { util.TesseractMaxSize = previousLimit })
	util.TesseractMaxSize++
	if automaticOCRRetryConfig(value) != baseline {
		t.Fatal("Tesseract initialization invalidated another provider's persisted failures")
	}
	value.Provider = string(ocr.Tesseract)
	baseline = automaticOCRRetryConfig(value)
	util.TesseractMaxSize++
	if automaticOCRRetryConfig(value) == baseline {
		t.Fatal("changed Tesseract size limit retained its persisted failures")
	}
}
