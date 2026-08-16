// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package heif

import (
	"bytes"
	"container/list"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sync/singleflight"
)

const (
	cacheVersion        = "h265-safe-still-jpeg-v1"
	memoryCacheMaxBytes = 128 * 1024 * 1024
	diskCacheMaxBytes   = 512 * 1024 * 1024
	conversionTimeout   = 30 * time.Second
)

type Options struct {
	Mode      Mode
	BoxID     string
	Encrypted bool
}

type Result struct {
	Data []byte
	Path string
	ETag string
}

type memoryEntry struct {
	key   string
	boxID string
	data  []byte
}

type diskEntry struct {
	path    string
	size    int64
	modTime time.Time
}

var (
	conversions      singleflight.Group
	diskCacheLock    sync.Mutex
	memoryCacheLock  sync.Mutex
	memoryCacheList  = list.New()
	memoryCacheItems = map[string]*list.Element{}
	memoryCacheBytes int
)

func IsPath(path string) bool {
	path = strings.ToLower(path)
	if index := strings.IndexAny(path, "?#"); index >= 0 {
		path = path[:index]
	}
	ext := filepath.Ext(path)
	return ext == ".heic" || ext == ".heif"
}

func GetOrCreate(ctx context.Context, source []byte, options Options) (Result, error) {
	if options.Mode != ModePreview && options.Mode != ModeThumbnail {
		return Result{}, ErrInvalidMode
	}
	if options.Encrypted && options.BoxID == "" {
		return Result{}, errors.New("encrypted HEIF cache requires a notebook ID")
	}
	if len(source) == 0 {
		return Result{}, errors.New("empty HEIF image")
	}
	if len(source) > MaxInputBytes {
		return Result{}, ErrInputTooLarge
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}

	digest := cacheDigest(source, options.Mode)
	etag := `"heif-` + digest + `"`
	cacheKey := digest
	if options.Encrypted {
		cacheKey = options.BoxID + ":" + digest
		if data := getMemoryCache(cacheKey); data != nil {
			return Result{Data: data, ETag: etag}, nil
		}
	} else if cachePath := existingDiskCache(options.Mode, digest); cachePath != "" {
		return Result{Path: cachePath, ETag: etag}, nil
	}

	flightKey := "disk:" + cacheKey
	if options.Encrypted {
		flightKey = "memory:" + cacheKey
	}
	value, err, _ := conversions.Do(flightKey, func() (any, error) {
		if options.Encrypted {
			if data := getMemoryCache(cacheKey); data != nil {
				return Result{Data: data, ETag: etag}, nil
			}
		} else if cachePath := existingDiskCache(options.Mode, digest); cachePath != "" {
			return Result{Path: cachePath, ETag: etag}, nil
		}

		data, err := convert(ctx, source, options.Mode)
		if err != nil {
			return Result{}, err
		}
		if options.Encrypted {
			putMemoryCache(cacheKey, options.BoxID, data)
			return Result{Data: data, ETag: etag}, nil
		}
		cachePath, cached, err := writeDiskCache(options.Mode, digest, data)
		if err != nil {
			return Result{Data: data, ETag: etag}, nil
		}
		if !cached {
			return Result{Data: data, ETag: etag}, nil
		}
		return Result{Path: cachePath, ETag: etag}, nil
	})
	if err != nil {
		return Result{}, err
	}
	return cloneResult(value.(Result)), nil
}

func ClearMemoryCache(boxID string) {
	memoryCacheLock.Lock()
	defer memoryCacheLock.Unlock()
	for key, element := range memoryCacheItems {
		entry := element.Value.(*memoryEntry)
		if boxID != "" && entry.boxID != boxID {
			continue
		}
		clear(entry.data)
		memoryCacheBytes -= len(entry.data)
		memoryCacheList.Remove(element)
		delete(memoryCacheItems, key)
	}
}

func cacheDigest(source []byte, mode Mode) string {
	hash := sha256.New()
	hash.Write([]byte(cacheVersion))
	hash.Write([]byte{0})
	hash.Write([]byte(mode))
	hash.Write([]byte{0})
	hash.Write(source)
	return hex.EncodeToString(hash.Sum(nil))
}

func getMemoryCache(key string) []byte {
	memoryCacheLock.Lock()
	defer memoryCacheLock.Unlock()
	element := memoryCacheItems[key]
	if element == nil {
		return nil
	}
	memoryCacheList.MoveToFront(element)
	return bytes.Clone(element.Value.(*memoryEntry).data)
}

func putMemoryCache(key, boxID string, data []byte) {
	if len(data) > memoryCacheMaxBytes {
		return
	}
	memoryCacheLock.Lock()
	defer memoryCacheLock.Unlock()
	if existing := memoryCacheItems[key]; existing != nil {
		memoryCacheList.MoveToFront(existing)
		return
	}
	element := memoryCacheList.PushFront(&memoryEntry{key: key, boxID: boxID, data: bytes.Clone(data)})
	memoryCacheItems[key] = element
	memoryCacheBytes += len(data)
	for memoryCacheBytes > memoryCacheMaxBytes {
		oldest := memoryCacheList.Back()
		if oldest == nil {
			break
		}
		entry := oldest.Value.(*memoryEntry)
		clear(entry.data)
		memoryCacheBytes -= len(entry.data)
		delete(memoryCacheItems, entry.key)
		memoryCacheList.Remove(oldest)
	}
}

func cloneResult(result Result) Result {
	result.Data = bytes.Clone(result.Data)
	return result
}

func diskCachePath(mode Mode, digest string) string {
	return filepath.Join(util.TempDir, "assets-cache", "heif", string(mode), digest[:2], digest+".jpg")
}

func existingDiskCache(mode Mode, digest string) string {
	cachePath := diskCachePath(mode, digest)
	info, err := os.Stat(cachePath)
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		return ""
	}
	now := time.Now()
	_ = os.Chtimes(cachePath, now, now)
	return cachePath
}

func writeDiskCache(mode Mode, digest string, data []byte) (string, bool, error) {
	if int64(len(data)) > diskCacheMaxBytes {
		return "", false, nil
	}
	diskCacheLock.Lock()
	defer diskCacheLock.Unlock()
	if cachePath := existingDiskCache(mode, digest); cachePath != "" {
		return cachePath, true, nil
	}

	cachePath := diskCachePath(mode, digest)
	if err := os.MkdirAll(filepath.Dir(cachePath), 0755); err != nil {
		return "", false, err
	}
	temporary, err := os.CreateTemp(filepath.Dir(cachePath), ".heif-*.tmp")
	if err != nil {
		return "", false, err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err = temporary.Chmod(0600); err == nil {
		_, err = temporary.Write(data)
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return "", false, err
	}
	if err = os.Rename(temporaryPath, cachePath); err != nil {
		if existing := existingDiskCache(mode, digest); existing != "" {
			return existing, true, nil
		}
		return "", false, err
	}
	pruneDiskCacheLocked()
	return cachePath, true, nil
}

func pruneDiskCacheLocked() {
	root := filepath.Join(util.TempDir, "assets-cache", "heif")
	var total int64
	var entries []diskEntry
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		if strings.HasSuffix(entry.Name(), ".tmp") {
			_ = os.Remove(path)
			return nil
		}
		total += info.Size()
		entries = append(entries, diskEntry{path: path, size: info.Size(), modTime: info.ModTime()})
		return nil
	})
	if total <= diskCacheMaxBytes {
		return
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].modTime.Before(entries[j].modTime)
	})
	for _, entry := range entries {
		if total <= diskCacheMaxBytes {
			break
		}
		if err := os.Remove(entry.path); err == nil {
			total -= entry.size
		}
	}
}
