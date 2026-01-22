package model

import (
	"path/filepath"
	"strings"
	"time"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func OCRAssetsJob() {
	util.WaitForTesseractInit()

	if !util.TesseractEnabled {
		return
	}

	task.AppendTaskWithTimeout(task.OCRImage, 30*time.Second, autoOCRAssets)
}

func autoOCRAssets() {
	if !util.TesseractEnabled {
		return
	}

	defer logging.Recover()

	assetsPath := util.GetDataAssetsAbsPath()
	assets := getUnOCRAssetsAbsPaths()
	if 0 < len(assets) {
		for i, assetAbsPath := range assets {
			text := util.GetOcrJsonText(util.Tesseract(assetAbsPath))
			p := strings.TrimPrefix(assetAbsPath, assetsPath)
			p = "assets" + filepath.ToSlash(p)
			util.SetAssetText(p, text)
			if 7 <= i { // 一次任务中最多处理 7 张图片，防止长时间占用系统资源
				break
			}
		}
	}

	util.CleanNotExistAssetsTexts()

	// 刷新 OCR 结果到数据库
	util.NodeOCRQueueLock.Lock()
	defer util.NodeOCRQueueLock.Unlock()
	for _, id := range util.NodeOCRQueue {
		sql.IndexNodeQueue(id)
	}
	util.NodeOCRQueue = nil
}

func getUnOCRAssetsAbsPaths() (ret []string) {
	// 只获取需要 OCR 的资源
	ocrAssets := cache.FilterAssets(func(path string, asset *cache.Asset) bool {
		return util.IsTesseractExtractable(asset.Path)
	})

	assetsPath := util.GetDataAssetsAbsPath()
	for _, asset := range ocrAssets {
		// 跳过已经存在 OCR 文本的资源
		if util.ExistsAssetText(asset.Path) {
			continue
		}
		absPath := filepath.Join(assetsPath, strings.TrimPrefix(asset.Path, "assets"))
		ret = append(ret, absPath)
	}
	return
}

func FlushAssetsTextsJob() {
	util.SaveAssetsTexts()
}
