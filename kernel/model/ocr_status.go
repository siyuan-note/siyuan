package model

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/siyuan/kernel/ocr"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const ocrFailureLimit = 1024

var ocrFailures = struct {
	sync.Mutex
	paths map[string]time.Time
}{paths: map[string]time.Time{}}

// 失败提示只记录实际尝试的普通本地资源，不保存错误详情，也不写入同步数据。
func recordOCRFailure(path string, err error) {
	if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, ocr.ErrUnsupportedImage) {
		return
	}
	path = util.OCRAssetKey(strings.TrimSpace(path))
	if !strings.HasPrefix(path, "assets/") || IsEncryptedOCRAsset(path) {
		return
	}
	ocrFailures.Lock()
	defer ocrFailures.Unlock()
	if _, exists := ocrFailures.paths[path]; !exists && len(ocrFailures.paths) >= ocrFailureLimit {
		oldest := ""
		var oldestTime time.Time
		for key, updated := range ocrFailures.paths {
			if oldest == "" || updated.Before(oldestTime) {
				oldest, oldestTime = key, updated
			}
		}
		delete(ocrFailures.paths, oldest)
	}
	ocrFailures.paths[path] = time.Now()
}

// HasOCRFailure 查询当前内核运行期间的识别失败；笔记本身份与 OCR 文本使用相同规范键。
func HasOCRFailure(path string) bool {
	ocrFailures.Lock()
	defer ocrFailures.Unlock()
	_, failed := ocrFailures.paths[util.OCRAssetKey(path)]
	return failed
}

func clearOCRFailure(path string) {
	ocrFailures.Lock()
	defer ocrFailures.Unlock()
	delete(ocrFailures.paths, util.OCRAssetKey(path))
}
