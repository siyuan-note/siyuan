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

func notifyOCRModelsChanged() {
	util.BroadcastByType("main", "ocrChanged", 0, "", nil)
}

// 同步路径相对于 data 目录，仅模型目录变化需要刷新 OCR 选项。
func ocrModelFilesChanged(changes ...[]string) bool {
	for _, paths := range changes {
		for _, value := range paths {
			value = strings.TrimPrefix(strings.ReplaceAll(value, "\\", "/"), "/")
			if value == "ocr/models" || strings.HasPrefix(value, "ocr/models/") {
				return true
			}
		}
	}
	return false
}

// 新设备使用内置 PaddleOCR 并关闭自动识别，已有设备缺少 OCR 配置时保留 Tesseract 自动识别。
func normalizeOCRConfig(value *conf.OCR, confFileExists bool) *conf.OCR {
	if value != nil {
		// 内置模型统一为 Tiny，自行导入的模型仍保留内容摘要标识。
		if value.Model == "small" {
			value.Model = "tiny"
		}
		return value
	}
	value = conf.NewOCR()
	if confFileExists {
		value.Provider = string(ocr.Tesseract)
		value.Auto = true
	}
	return value
}

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
		return *conf.NewOCR()
	}
	return *config.OCR
}

func (config *AppConf) SetOCR(value conf.OCR) error {
	// 兼容旧客户端提交的内置 Small 标识，响应和持久化配置均使用 Tiny。
	if value.Model == "small" {
		value.Model = "tiny"
	}
	if err := (ocr.Thresholds(value.Thresholds)).Validate(); err != nil {
		return err
	}
	if value.Provider != string(ocr.Tesseract) && value.Provider != string(ocr.PaddleOCR) && value.Provider != "ai" {
		return errors.New("unknown OCR provider")
	}
	if value.Model != "tiny" {
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
	previous := config.OCR
	if value.Provider == "ai" && (previous == nil || previous.AIModelID == "" || previous.AIModelID != value.AIModelID) {
		provider, model := getOCRAIModel(value)
		if provider == nil || model == nil {
			config.m.Unlock()
			return errors.New(Conf.Language(412))
		}
	}
	if value.Provider == "ai" && (previous == nil || previous.Provider != "ai") {
		value.Auto = false
	}
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
	if id == "tiny" {
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
	result := ocr.PaddleConfig{Directory: ocrModelDirectory(value.Model), Library: filepath.Join(directory, filename), Thresholds: ocr.Thresholds(value.Thresholds)}
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
func OCRAsset(ctx context.Context, path string) (string, []map[string]string, error) {
	return ocrAsset(ctx, path, Conf.GetOCR(), false)
}

func ocrAsset(ctx context.Context, path string, value conf.OCR, automatic bool) (string, []map[string]string, error) {
	if value.Provider == "ai" {
		text, err := aiOCRAsset(ctx, path, value, automatic)
		return text, []map[string]string{}, err
	}
	InitOCR()
	path = strings.SplitN(path, "#", 2)[0]
	if IsEncryptedOCRAsset(path) {
		return "", nil, errors.New(Conf.Language(380))
	}
	absPath, err := GetAssetAbsPathInBox(path, "")
	if err != nil {
		return "", nil, err
	}
	if IsEncryptedAssetPath(absPath) {
		return "", nil, errors.New(Conf.Language(380))
	}
	if err = EnsureAssetLocal(absPath); err != nil {
		return "", nil, err
	}
	if value.Provider == string(ocr.Tesseract) {
		if err = util.WaitForTesseractInitContext(ctx); err != nil {
			return "", nil, err
		}
	}
	rows, err := ocrRegistry.Recognize(ctx, ocr.ProviderID(value.Provider), absPath)
	if err != nil {
		return "", nil, err
	}
	canonical, boxID, err := assetPathAndBox(path, "")
	if err != nil {
		return "", nil, err
	}
	if boxID != "" {
		canonical += "?box=" + url.QueryEscape(boxID)
	}
	if automatic && !canSaveAutomaticOCR(value, canonical) {
		return "", nil, context.Canceled
	}
	text := util.GetOcrJsonText(rows)
	SetOCRAssetText(canonical, text)
	return text, rows, nil
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
	if !OCRProviderAvailable(value.Provider) {
		return
	}
	task.AppendTaskWithTimeout(task.OCRImage, automaticOCRTimeout(value), autoOCRAssets)
}

var ocrRetry sync.Map

func autoOCRAssets() {
	defer logging.Recover()
	value := Conf.GetOCR()
	if !value.Auto || !OCRProviderAvailable(value.Provider) {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), automaticOCRTimeout(value))
	defer cancel()
	assets := cache.FilterAssets(func(path string, asset *cache.Asset) bool {
		if value.Provider == "ai" {
			return isAIOCRPath(asset.Path)
		}
		return util.IsTesseractExtractable(asset.Path)
	})
	limit := 7
	if value.Provider == "ai" {
		limit = 1
	}
	processed := 0
	for _, asset := range assets {
		if ctx.Err() != nil || processed >= limit || !automaticOCRMatches(value) {
			break
		}
		if util.ExistsAssetText(asset.Path) {
			continue
		}
		key := fmt.Sprintf("%s:%s:%s:%s", value.Provider, value.Model, value.AIModelID, asset.Path)
		if retry, exists := ocrRetry.Load(key); exists && time.Now().Before(retry.(time.Time)) {
			continue
		}
		absPath, err := GetAssetAbsPathInBox(asset.Path, "")
		if err != nil || IsEncryptedAssetPath(absPath) {
			continue
		}
		processed++
		if _, _, err = ocrAsset(ctx, asset.Path, value, true); err != nil {
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
	result := []string{"tiny"}
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
	if id == "ai" {
		value := Conf.GetOCR()
		if value.Provider != "ai" {
			return len(OCRAIModels()) > 0
		}
		provider, model := getOCRAIModel(value)
		return provider != nil && model != nil
	}
	InitOCR()
	return ocrRegistry.Available(ocr.ProviderID(id))
}

func automaticOCRTimeout(value conf.OCR) time.Duration {
	if value.Provider == "ai" {
		return 2 * time.Minute
	}
	return 30 * time.Second
}

func automaticOCRMatches(value conf.OCR) bool {
	current := Conf.GetOCR()
	return current.Auto && current.Provider == value.Provider && current.Model == value.Model && current.AIModelID == value.AIModelID
}

// 自动识别仅提交仍为空的结果，关闭自动识别、切换配置或手动编辑后丢弃在途响应。
func canSaveAutomaticOCR(value conf.OCR, path string) bool {
	return automaticOCRMatches(value) && OCRProviderAvailable(value.Provider) && !util.ExistsAssetText(path)
}

func FlushAssetsTextsJob() { util.SaveAssetsTexts() }
