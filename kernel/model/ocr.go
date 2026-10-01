package model

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/ocr"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var ocrRegistry = ocr.NewRegistry()
var ocrInit sync.Once
var nativePaddle = &ocr.PaddleProvider{Config: currentPaddleConfig}

func InitOCR() {
	ocrInit.Do(func() {
		if err := ocrRegistry.Register(ocr.Tesseract, util.TesseractProvider{}); err != nil {
			panic(err)
		}
		if err := ocrRegistry.Register(ocr.PaddleOCR, nativePaddle); err != nil {
			panic(err)
		}
	})
}

func (config *AppConf) GetOCR() conf.OCR {
	config.m.RLock()
	defer config.m.RUnlock()
	if config.OCR == nil {
		return *conf.NewOCR(util.IsMobileContainer())
	}
	return *config.OCR
}

func (config *AppConf) SetOCR(value conf.OCR) error {
	if value.Provider != string(ocr.Tesseract) && value.Provider != string(ocr.PaddleOCR) {
		return errors.New("unknown OCR provider")
	}
	if value.Model != "tiny" && value.Model != "small" {
		if len(value.Model) != 64 || strings.Trim(value.Model, "0123456789abcdef") != "" {
			return errors.New("invalid OCR model ID")
		}
	}
	if value.Provider == string(ocr.PaddleOCR) {
		if err := ocr.ValidateModels(ocrModelDirectory(value.Model)); err != nil {
			return err
		}
	}
	config.m.Lock()
	changed := config.OCR == nil || config.OCR.Provider != value.Provider || config.OCR.Model != value.Model
	config.OCR = &value
	config.m.Unlock()
	config.Save()
	if changed {
		go nativePaddle.Close()
	}
	return nil
}

func ocrModelDirectory(id string) string {
	if id == "tiny" || id == "small" {
		return filepath.Join(util.WorkingDir, "stage", "ocr", "models", id)
	}
	return filepath.Join(util.DataDir, "ocr", "models", id)
}

func currentPaddleConfig() ocr.PaddleConfig {
	value := Conf.GetOCR()
	directory := filepath.Join(util.WorkingDir, "stage", "ocr", "runtime", runtime.GOOS+"-"+runtime.GOARCH)
	filename := "libonnxruntime.so"
	if runtime.GOOS == "windows" {
		filename = "onnxruntime.dll"
	} else if runtime.GOOS == "darwin" {
		filename = "libonnxruntime.dylib"
	}
	result := ocr.PaddleConfig{Directory: ocrModelDirectory(value.Model), Library: filepath.Join(directory, filename)}
	if runtime.GOOS == "linux" {
		result.Worker = filepath.Join(directory, "siyuan-ocr")
	}
	if runtime.GOOS == "android" {
		result.Library = "libonnxruntime.so"
	}
	return result
}

// IsEncryptedOCRAsset 保留笔记本查询参数并忽略链接片段，不依赖资源已下载或笔记本已解锁。
func IsEncryptedOCRAsset(path string) bool {
	path = strings.SplitN(path, "#", 2)[0]
	_, boxID, err := assetPathAndBox(path, "")
	if err == nil && boxID != "" && IsEncryptedBox(boxID) {
		return true
	}
	absPath, err := GetAssetAbsPathInBox(path, "")
	return err == nil && IsEncryptedAssetPath(absPath)
}

// OCRAsset 与自动任务共用内核识别和存储流程，失败时保留已有结果。
func OCRAsset(ctx context.Context, path string) ([]map[string]string, error) {
	InitOCR()
	path = strings.SplitN(path, "#", 2)[0]
	if IsEncryptedOCRAsset(path) {
		return nil, errors.New(Conf.Language(380))
	}
	absPath, err := GetAssetAbsPathInBox(path, "")
	if err != nil {
		return nil, err
	}
	if IsEncryptedAssetPath(absPath) {
		return nil, errors.New(Conf.Language(380))
	}
	if err = EnsureAssetLocal(absPath); err != nil {
		return nil, err
	}
	value := Conf.GetOCR()
	if value.Provider == string(ocr.Tesseract) {
		if err = util.WaitForTesseractInitContext(ctx); err != nil {
			return nil, err
		}
	}
	rows, err := ocrRegistry.Recognize(ctx, ocr.ProviderID(value.Provider), absPath)
	if err != nil {
		return nil, err
	}
	canonical, boxID, err := assetPathAndBox(path, "")
	if err != nil {
		return nil, err
	}
	if boxID != "" {
		canonical += "?box=" + url.QueryEscape(boxID)
	}
	SetOCRAssetText(canonical, util.GetOcrJsonText(rows))
	return rows, nil
}

func SetOCRAssetText(path, text string) {
	if IsEncryptedOCRAsset(path) {
		return
	}
	path = util.OCRAssetKey(path)
	util.SetAssetText(path, text)
	documents, err := sql.QueryOCRAssetDocuments(path)
	if err != nil {
		logging.LogErrorf("query OCR asset documents failed: %s", err)
		return
	}
	for _, document := range documents {
		if IsEncryptedBox(document.Box) {
			continue
		}
		tree, loadErr := LoadTreeByBlockIDInExactBox(document.RootID, document.Box)
		if loadErr != nil {
			logging.LogWarnf("load OCR asset document failed: %s", loadErr)
			continue
		}
		ids := map[string]bool{}
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if !entering || node.Type != ast.NodeImage {
				return ast.WalkContinue
			}
			destination := node.ChildByType(ast.NodeLinkDest)
			if destination == nil || util.OCRAssetKey(destination.TokensStr()) != path {
				return ast.WalkContinue
			}
			for parent := node.Parent; parent != nil && parent.Type != ast.NodeDocument; parent = parent.Parent {
				if parent.IsBlock() && !ids[parent.ID] {
					ids[parent.ID] = true
					sql.IndexNodeQueue(parent.ID)
				}
			}
			return ast.WalkSkipChildren
		})
	}
}

func OCRAssetsJob() {
	value := Conf.GetOCR()
	if !value.Auto {
		return
	}
	if value.Provider == string(ocr.Tesseract) {
		util.WaitForTesseractInit()
	}
	if !ocrRegistry.Available(ocr.ProviderID(value.Provider)) {
		return
	}
	task.AppendTaskWithTimeout(task.OCRImage, 30*time.Second, autoOCRAssets)
}

var ocrRetry sync.Map

func autoOCRAssets() {
	defer logging.Recover()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	value := Conf.GetOCR()
	if !value.Auto {
		return
	}
	assets := cache.FilterAssets(func(path string, asset *cache.Asset) bool { return util.IsTesseractExtractable(asset.Path) })
	processed := 0
	for _, asset := range assets {
		if ctx.Err() != nil || processed >= 7 {
			break
		}
		if util.ExistsAssetText(asset.Path) {
			continue
		}
		key := fmt.Sprintf("%s:%s:%s", value.Provider, value.Model, asset.Path)
		if retry, exists := ocrRetry.Load(key); exists && time.Now().Before(retry.(time.Time)) {
			continue
		}
		absPath, err := GetAssetAbsPathInBox(asset.Path, "")
		if err != nil || IsEncryptedAssetPath(absPath) {
			continue
		}
		processed++
		if _, err = OCRAsset(ctx, asset.Path); err != nil {
			ocrRetry.Store(key, time.Now().Add(10*time.Minute))
			logging.LogWarnf("automatic OCR failed: %s", err)
		} else {
			ocrRetry.Delete(key)
		}
	}
	if _, err := DeferredSyncAssets(); err != nil {
		logging.LogWarnf("skip OCR text cleanup: %s", err)
	} else {
		util.CleanNotExistAssetsTexts(func(path string) bool {
			_, err := GetAssetAbsPathInBox(strings.SplitN(path, "#", 2)[0], "")
			return err == nil
		})
	}
	util.NodeOCRQueueLock.Lock()
	for _, id := range util.NodeOCRQueue {
		sql.IndexNodeQueue(id)
	}
	util.NodeOCRQueue = nil
	util.NodeOCRQueueLock.Unlock()
}

func OCRModels() []string {
	result := []string{"tiny", "small"}
	entries, _ := os.ReadDir(filepath.Join(util.DataDir, "ocr", "models"))
	for _, entry := range entries {
		id := entry.Name()
		if entry.IsDir() && len(id) == 64 && strings.Trim(id, "0123456789abcdef") == "" && ocr.ValidateModels(ocrModelDirectory(id)) == nil {
			result = append(result, id)
		}
	}
	return result
}

func OCRProviderAvailable(id string) bool {
	InitOCR()
	return ocrRegistry.Available(ocr.ProviderID(id))
}

func FlushAssetsTextsJob() { util.SaveAssetsTexts() }
