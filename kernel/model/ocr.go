package model

import (
	"path/filepath"
	"runtime/debug"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/dustin/go-humanize"
	"github.com/siyuan-note/filelock"
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
			text := util.Tesseract(assetAbsPath)
			p := strings.TrimPrefix(assetAbsPath, assetsPath)
			p = "assets" + filepath.ToSlash(p)
			util.AssetsTextsLock.Lock()
			util.AssetsTexts[p] = text
			util.AssetsTextsLock.Unlock()
			if "" != text {
				util.AssetsTextsChanged.Store(true)
			}
			if 7 <= i { // 一次任务中最多处理 7 张图片，防止长时间占用系统资源
				break
			}
		}
	}

	cleanNotExistAssetsTexts()

	// 刷新 OCR 结果到数据库
	util.NodeOCRQueueLock.Lock()
	defer util.NodeOCRQueueLock.Unlock()
	for _, id := range util.NodeOCRQueue {
		sql.IndexNodeQueue(id)
	}
	util.NodeOCRQueue = nil
}

func cleanNotExistAssetsTexts() {
	util.AssetsTextsLock.Lock()
	defer util.AssetsTextsLock.Unlock()

	assetsPath := util.GetDataAssetsAbsPath()
	var toRemoves []string
	for asset, _ := range util.AssetsTexts {
		assetAbsPath := strings.TrimPrefix(asset, "assets")
		assetAbsPath = filepath.Join(assetsPath, assetAbsPath)
		if !filelock.IsExist(assetAbsPath) {
			toRemoves = append(toRemoves, asset)
		}
	}

	for _, asset := range toRemoves {
		delete(util.AssetsTexts, asset)
		util.AssetsTextsChanged.Store(true)
	}
	return
}

func getUnOCRAssetsAbsPaths() (ret []string) {
	var assetsPaths []string
	assets := cache.GetAssets()
	for _, asset := range assets {
		if !util.IsTesseractExtractable(asset.Path) {
			continue
		}
		assetsPaths = append(assetsPaths, asset.Path)
	}

	assetsPath := util.GetDataAssetsAbsPath()
	assetsTextsTmp := util.AssetsTexts
	for _, assetPath := range assetsPaths {
		if _, ok := assetsTextsTmp[assetPath]; ok {
			continue
		}
		absPath := filepath.Join(assetsPath, strings.TrimPrefix(assetPath, "assets"))
		ret = append(ret, absPath)
	}
	return
}

func FlushAssetsTextsJob() {
	SaveAssetsTexts()
}

func LoadAssetsTexts() {
	assetsPath := util.GetDataAssetsAbsPath()
	assetsTextsPath := filepath.Join(assetsPath, "ocr-texts.json")
	if !filelock.IsExist(assetsTextsPath) {
		return
	}

	start := time.Now()
	data, err := filelock.ReadFile(assetsTextsPath)
	if nil != err {
		logging.LogErrorf("read assets texts failed: %s", err)
		return
	}

	util.AssetsTextsLock.Lock()
	if err = gulu.JSON.UnmarshalJSON(data, &util.AssetsTexts); nil != err {
		logging.LogErrorf("unmarshal assets texts failed: %s", err)
		if err = filelock.Remove(assetsTextsPath); nil != err {
			logging.LogErrorf("removed corrupted assets texts failed: %s", err)
		}
		return
	}
	util.AssetsTextsLock.Unlock()
	debug.FreeOSMemory()

	if elapsed := time.Since(start).Seconds(); 2 < elapsed {
		logging.LogWarnf("read assets texts [%s] to [%s], elapsed [%.2fs]", humanize.Bytes(uint64(len(data))), assetsTextsPath, elapsed)
	}
	return
}

func SaveAssetsTexts() {
	if !util.AssetsTextsChanged.Load() {
		return
	}

	start := time.Now()

	util.AssetsTextsLock.Lock()
	data, err := gulu.JSON.MarshalIndentJSON(util.AssetsTexts, "", "  ")
	if nil != err {
		logging.LogErrorf("marshal assets texts failed: %s", err)
		return
	}
	util.AssetsTextsLock.Unlock()

	assetsPath := util.GetDataAssetsAbsPath()
	assetsTextsPath := filepath.Join(assetsPath, "ocr-texts.json")
	if err = filelock.WriteFile(assetsTextsPath, data); nil != err {
		logging.LogErrorf("write assets texts failed: %s", err)
		return
	}
	debug.FreeOSMemory()

	if elapsed := time.Since(start).Seconds(); 2 < elapsed {
		logging.LogWarnf("save assets texts [size=%s] to [%s], elapsed [%.2fs]", humanize.Bytes(uint64(len(data))), assetsTextsPath, elapsed)
	}

	util.AssetsTextsChanged.Store(false)
}
