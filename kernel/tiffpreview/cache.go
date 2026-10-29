// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tiffpreview

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type Result struct {
	Data []byte
	Path string
	ETag string
}

var cacheLock sync.Mutex

// GetOrCreate 用内容摘要隔离预览及缩略图缓存；加密资源只返回请求内存中的 PNG。
func GetOrCreate(ctx context.Context, source []byte, directory string, thumbnail, encrypted bool) (Result, error) {
	if encrypted {
		data, err := Convert(ctx, source, thumbnail)
		return Result{Data: data}, err
	}
	if len(source) > MaxInputBytes {
		return Result{}, ErrInputTooLarge
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	hash := sha256.New()
	hash.Write([]byte("tiff-first-frame-png-v1"))
	if thumbnail {
		hash.Write([]byte{1})
	}
	hash.Write(source)
	digest := hex.EncodeToString(hash.Sum(nil))
	result := Result{ETag: `"tiff-` + digest + `"`}
	cachePath := filepath.Join(directory, digest+".png")
	cacheLock.Lock()
	defer cacheLock.Unlock()
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	if info, err := os.Stat(cachePath); err == nil && info.Mode().IsRegular() && info.Size() > 0 {
		_ = os.Chtimes(cachePath, time.Now(), time.Now())
		result.Path = cachePath
		return result, nil
	}
	data, err := Convert(ctx, source, thumbnail)
	if err != nil {
		return Result{}, err
	}
	result.Data = data
	if err = os.MkdirAll(directory, 0700); err != nil {
		return result, nil
	}
	file, err := os.CreateTemp(directory, ".tiff-*.tmp")
	if err != nil {
		return result, nil
	}
	defer os.Remove(file.Name())
	_, writeErr := file.Write(data)
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil || ctx.Err() != nil {
		return result, ctx.Err()
	}
	if err = os.Rename(file.Name(), cachePath); err != nil {
		return result, nil
	}
	pruneCache(directory, cachePath)
	result.Data, result.Path = nil, cachePath
	return result, nil
}

func pruneCache(directory, keep string) {
	const maxBytes = 512 * 1024 * 1024
	type entry struct {
		path string
		info fs.FileInfo
	}
	var entries []entry
	var total int64
	files, _ := os.ReadDir(directory)
	for _, file := range files {
		if filepath.Ext(file.Name()) != ".png" {
			continue
		}
		info, err := file.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		total += info.Size()
		entries = append(entries, entry{filepath.Join(directory, file.Name()), info})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].info.ModTime().Before(entries[j].info.ModTime()) })
	for _, file := range entries {
		if total <= maxBytes {
			break
		}
		if file.path != keep && os.Remove(file.path) == nil {
			total -= file.info.Size()
		}
	}
}
