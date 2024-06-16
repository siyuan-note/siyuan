// SiYuan - Refactor your thinking
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

package util

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/88250/go-humanize"
	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
)

var (
	TesseractBin     = "tesseract"
	TesseractEnabled bool
	TesseractMaxSize = 2 * 1000 * uint64(1000)
	TesseractLangs   []string

	assetsTexts        = map[string]string{}
	assetsTextsLock    = sync.Mutex{}
	assetsTextsChanged = atomic.Bool{}
)

func CleanNotExistAssetsTexts() {
	assetsTextsLock.Lock()
	defer assetsTextsLock.Unlock()

	assetsPath := GetDataAssetsAbsPath()
	var toRemoves []string
	for asset, _ := range assetsTexts {
		assetAbsPath := strings.TrimPrefix(asset, "assets")
		assetAbsPath = filepath.Join(assetsPath, assetAbsPath)
		if !filelock.IsExist(assetAbsPath) {
			toRemoves = append(toRemoves, asset)
		}
	}

	for _, asset := range toRemoves {
		delete(assetsTexts, asset)
		assetsTextsChanged.Store(true)
	}
	return
}

func LoadAssetsTexts() {
	assetsPath := GetDataAssetsAbsPath()
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

	assetsTextsLock.Lock()
	if err = gulu.JSON.UnmarshalJSON(data, &assetsTexts); nil != err {
		logging.LogErrorf("unmarshal assets texts failed: %s", err)
		if err = filelock.Remove(assetsTextsPath); nil != err {
			logging.LogErrorf("removed corrupted assets texts failed: %s", err)
		}
		return
	}
	assetsTextsLock.Unlock()
	debug.FreeOSMemory()

	if elapsed := time.Since(start).Seconds(); 2 < elapsed {
		logging.LogWarnf("read assets texts [%s] to [%s], elapsed [%.2fs]", humanize.BytesCustomCeil(uint64(len(data)), 2), assetsTextsPath, elapsed)
	}
	return
}

func SaveAssetsTexts() {
	if !assetsTextsChanged.Load() {
		return
	}

	start := time.Now()

	assetsTextsLock.Lock()
	data, err := gulu.JSON.MarshalIndentJSON(assetsTexts, "", "  ")
	if nil != err {
		logging.LogErrorf("marshal assets texts failed: %s", err)
		return
	}
	assetsTextsLock.Unlock()

	assetsPath := GetDataAssetsAbsPath()
	assetsTextsPath := filepath.Join(assetsPath, "ocr-texts.json")
	if err = filelock.WriteFile(assetsTextsPath, data); nil != err {
		logging.LogErrorf("write assets texts failed: %s", err)
		return
	}
	debug.FreeOSMemory()

	if elapsed := time.Since(start).Seconds(); 2 < elapsed {
		logging.LogWarnf("save assets texts [size=%s] to [%s], elapsed [%.2fs]", humanize.BytesCustomCeil(uint64(len(data)), 2), assetsTextsPath, elapsed)
	}

	assetsTextsChanged.Store(false)
}

func SetAssetText(asset, text string) {
	var oldText string
	assetsTextsLock.Lock()
	oldText = assetsTexts[asset]
	assetsTexts[asset] = text
	assetsTextsLock.Unlock()
	if oldText != text {
		assetsTextsChanged.Store(true)
	}
}

func ExistsAssetText(asset string) (ret bool) {
	assetsTextsLock.Lock()
	_, ret = assetsTexts[asset]
	assetsTextsLock.Unlock()
	return
}

func OcrAsset(asset string) (ret []map[string]interface{}) {
	assetsPath := GetDataAssetsAbsPath()
	assetAbsPath := strings.TrimPrefix(asset, "assets")
	assetAbsPath = filepath.Join(assetsPath, assetAbsPath)
	ret = Tesseract(assetAbsPath)
	assetsTextsLock.Lock()
	ocrText := GetOcrJsonText(ret)
	assetsTexts[asset] = ocrText
	assetsTextsLock.Unlock()
	if "" != ocrText {
		assetsTextsChanged.Store(true)
	}
	return
}

// https://github.com/siyuan-note/siyuan/pull/11708
func GetAssetText(asset string) (ret string) {
	ret = assetsTexts[asset]
	return
}

func IsTesseractExtractable(p string) bool {
	lowerName := strings.ToLower(p)
	return strings.HasSuffix(lowerName, ".png") || strings.HasSuffix(lowerName, ".jpg") || strings.HasSuffix(lowerName, ".jpeg")
}

// tesseractOCRLock 用于 Tesseract OCR 加锁串行执行提升稳定性 https://github.com/siyuan-note/siyuan/issues/7265
var tesseractOCRLock = sync.Mutex{}

func Tesseract(imgAbsPath string) (ret []map[string]interface{}) {
	if ContainerStd != Container || !TesseractEnabled {
		return
	}

	defer logging.Recover()
	tesseractOCRLock.Lock()
	defer tesseractOCRLock.Unlock()

	if !IsTesseractExtractable(imgAbsPath) {
		return
	}

	info, err := os.Stat(imgAbsPath)
	if nil != err {
		return
	}

	if TesseractMaxSize < uint64(info.Size()) {
		return
	}

	defer logging.Recover()

	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, TesseractBin, "-c", "debug_file=/dev/null", imgAbsPath, "stdout", "-l", strings.Join(TesseractLangs, "+"), "tsv")
	gulu.CmdAttr(cmd)
	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		logging.LogWarnf("tesseract [path=%s, size=%d] timeout", imgAbsPath, info.Size())
		return
	}

	if nil != err {
		logging.LogWarnf("tesseract [path=%s, size=%d] failed: %s", imgAbsPath, info.Size(), err)
		return
	}

	tsv := string(output)

	// 按行分割 TSV 数据
	lines := strings.Split(tsv, "\r\n")

	// 解析 TSV 数据 跳过标题行，从第二行开始处理
	for _, line := range lines[1:] {
		if line == "" {
			continue // 跳过空行
		}
		// 分割每列数据
		fields := strings.Split(line, "\t")
		// 将字段名和字段值映射到一个 map 中
		dataMap := make(map[string]interface{})
		for i, header := range strings.Split(lines[0], "\t") {
			dataMap[header] = fields[i]
		}
		ret = append(ret, dataMap)
	}

	tsv = gulu.Str.RemoveInvisible(tsv)
	tsv = RemoveRedundantSpace(tsv)
	msg := fmt.Sprintf("OCR [%s] [%s]", html.EscapeString(info.Name()), html.EscapeString(GetOcrJsonText(ret)))
	PushStatusBar(msg)
	return
}

// 提取并连接所有 text 字段的函数
func GetOcrJsonText(jsonData []map[string]interface{}) (ret string) {
	for _, dataMap := range jsonData {
		// 检查 text 字段是否存在
		if text, ok := dataMap["text"]; ok {
			// 确保 text 是字符串类型
			if textStr, ok := text.(string); ok {
				ret += " " + textStr
			}
		}
	}
	ret = gulu.Str.RemoveInvisible(ret)
	ret = RemoveRedundantSpace(ret)
	return ret
}

var tesseractInited = atomic.Bool{}

func WaitForTesseractInit() {
	for {
		if tesseractInited.Load() {
			return
		}
		time.Sleep(time.Second)
	}
}

func InitTesseract() {
	ver := getTesseractVer()
	if "" == ver {
		tesseractInited.Store(true)
		return
	}

	langs := getTesseractLangs()
	if 1 > len(langs) {
		logging.LogWarnf("no tesseract langs found")
		TesseractEnabled = false
		tesseractInited.Store(true)
		return
	}

	maxSizeVal := os.Getenv("SIYUAN_TESSERACT_MAX_SIZE")
	if "" != maxSizeVal {
		if maxSize, parseErr := strconv.ParseUint(maxSizeVal, 10, 64); nil == parseErr {
			TesseractMaxSize = maxSize
		}
	}

	// Supports via environment var `SIYUAN_TESSERACT_ENABLED=false` to close OCR https://github.com/siyuan-note/siyuan/issues/9619
	if enabled := os.Getenv("SIYUAN_TESSERACT_ENABLED"); "" != enabled {
		if enabledBool, parseErr := strconv.ParseBool(enabled); nil == parseErr {
			TesseractEnabled = enabledBool
			if !enabledBool {
				logging.LogInfof("tesseract-ocr disabled by env")
				tesseractInited.Store(true)
				return
			}
		}
	}

	TesseractLangs = filterTesseractLangs(langs)
	logging.LogInfof("tesseract-ocr enabled [ver=%s, maxSize=%s, langs=%s]", ver, humanize.BytesCustomCeil(TesseractMaxSize, 2), strings.Join(TesseractLangs, "+"))
	tesseractInited.Store(true)
}

func filterTesseractLangs(langs []string) (ret []string) {
	ret = []string{}

	envLangsVal := os.Getenv("SIYUAN_TESSERACT_LANGS")
	if "" != envLangsVal {
		envLangs := strings.Split(envLangsVal, "+")
		for _, lang := range langs {
			if gulu.Str.Contains(lang, envLangs) {
				ret = append(ret, lang)
			}
		}
	} else {
		for _, lang := range langs {
			if "eng" == lang || strings.HasPrefix(lang, "chi") || "fra" == lang || "spa" == lang || "deu" == lang ||
				"rus" == lang || "osd" == lang {
				ret = append(ret, lang)
			}
		}
	}
	return ret
}

func getTesseractVer() (ret string) {
	if ContainerStd != Container {
		return
	}

	cmd := exec.Command(TesseractBin, "--version")
	gulu.CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if nil != err {
		if strings.Contains(err.Error(), "executable file not found") {
			// macOS 端 Tesseract OCR 安装后不识别 https://github.com/siyuan-note/siyuan/issues/7107
			TesseractBin = "/usr/local/bin/tesseract"
			cmd = exec.Command(TesseractBin, "--version")
			gulu.CmdAttr(cmd)
			data, err = cmd.CombinedOutput()
			if nil != err && strings.Contains(err.Error(), "executable file not found") {
				TesseractBin = "/opt/homebrew/bin/tesseract"
				cmd = exec.Command(TesseractBin, "--version")
				gulu.CmdAttr(cmd)
				data, err = cmd.CombinedOutput()
			}
		}
	}
	if nil != err {
		return
	}

	if strings.HasPrefix(string(data), "tesseract ") {
		parts := bytes.Split(data, []byte("\n"))
		if 0 < len(parts) {
			ret = strings.TrimPrefix(string(parts[0]), "tesseract ")
			ret = strings.TrimSpace(ret)
			TesseractEnabled = true
		}
		return
	}
	return
}

func getTesseractLangs() (ret []string) {
	if !TesseractEnabled {
		return nil
	}

	cmd := exec.Command(TesseractBin, "--list-langs")
	gulu.CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if nil != err {
		return nil
	}

	parts := bytes.Split(data, []byte("\n"))
	if 0 < len(parts) {
		parts = parts[1:]
	}
	for _, part := range parts {
		part = bytes.TrimSpace(part)
		if 0 == len(part) {
			continue
		}
		ret = append(ret, string(part))
	}
	return
}

var (
	NodeOCRQueue     []string
	NodeOCRQueueLock = sync.Mutex{}
)

func PushNodeOCRQueue(n *ast.Node) {
	if nil == n {
		return
	}

	NodeOCRQueueLock.Lock()
	defer NodeOCRQueueLock.Unlock()
	NodeOCRQueue = append(NodeOCRQueue, n.ID)
}
