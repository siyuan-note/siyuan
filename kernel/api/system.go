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

package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/html"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func clearTempFiles(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	model.ClearTempFiles()
}

func vacuumDataIndex(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	model.VacuumDataIndex()
}

func rebuildDataIndex(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	model.FullReindex(false)
}

func addMicrosoftDefenderExclusion(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if !gulu.OS.IsWindows() {
		return
	}

	err := model.AddMicrosoftDefenderExclusion()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
	}
}

func ignoreAddMicrosoftDefenderExclusion(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if !gulu.OS.IsWindows() {
		return
	}

	model.Conf.System.MicrosoftDefenderExcluded = true
	model.Conf.Save()
}

func getWorkspaceInfo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = map[string]any{
		"workspaceDir": util.WorkspaceDir,
		"siyuanVer":    util.Ver,
	}
}

func getNetwork(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	maskedConf, err := model.GetMaskedConf()
	if err != nil {
		ret.Code = -1
		ret.Msg = "get conf failed: " + err.Error()
		return
	}

	ret.Data = map[string]any{
		"proxy": maskedConf.System.NetworkProxy,
	}
}

func getChangelog(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	data := map[string]any{"show": false, "html": ""}
	ret.Data = data

	changelogsDir := filepath.Join(util.WorkingDir, "changelogs")
	if !gulu.File.IsDir(changelogsDir) {
		return
	}

	if !model.Conf.ShowChangelog {
		return
	}

	if !util.IsReleaseVer(util.Ver) {
		model.Conf.ShowChangelog = false
		model.Conf.Save()
		return
	}

	verDir := filepath.Join(changelogsDir, "v"+util.Ver)
	changelogPath := filepath.Join(verDir, "v"+util.Ver+"."+model.Conf.Lang+".md")
	if !gulu.File.IsExist(changelogPath) {
		changelogPath = filepath.Join(verDir, "v"+util.Ver+".md")
	}
	if !gulu.File.IsExist(changelogPath) {
		logging.LogErrorf("changelog not found in %s", verDir)
		return
	}

	contentData, err := os.ReadFile(changelogPath)
	if err != nil {
		logging.LogErrorf("read changelog failed: %s", err)
		return
	}

	model.Conf.ShowChangelog = false
	model.Conf.Save()
	luteEngine := lute.New()
	htmlContent := luteEngine.MarkdownStr("", string(contentData))
	htmlContent = util.LinkTarget(htmlContent, "")

	data["show"] = true
	data["html"] = htmlContent
	ret.Data = data
}

func getEmojiConf(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	builtConfPath := filepath.Join(util.AppearancePath, "emojis", "conf.json")
	data, err := os.ReadFile(builtConfPath)
	if err != nil {
		logging.LogErrorf("read emojis conf.json failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	var conf []map[string]any
	if err = gulu.JSON.UnmarshalJSON(data, &conf); err != nil {
		logging.LogErrorf("unmarshal emojis conf.json failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	customConfDir := filepath.Join(util.DataDir, "emojis")
	custom := map[string]any{
		"id":          "custom",
		"title":       "Custom",
		"title_zh_cn": "自定义",
		"title_ja_jp": "カスタム",
	}
	items := []map[string]any{}
	custom["items"] = items
	if gulu.File.IsDir(customConfDir) {
		model.ClearCustomEmojis()
		readCustomEmojis(customConfDir, "", &items)
	}
	custom["items"] = items
	conf = append([]map[string]any{custom}, conf...)

	ret.Data = conf
	return
}

func readCustomEmojis(rootDir, relativeDir string, items *[]map[string]any) {
	dir := filepath.Join(rootDir, filepath.FromSlash(relativeDir))
	customEmojis, err := os.ReadDir(dir)
	if err != nil {
		logging.LogErrorf("read custom emojis failed: %s", err)
		return
	}

	for _, customEmoji := range customEmojis {
		name := customEmoji.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}

		if !util.IsValidUploadFileName(html.UnescapeString(name)) {
			oldPath := filepath.Join(dir, name)
			name = util.FilterUploadEmojiFileName(name)
			newPath := filepath.Join(dir, name)
			// XSS through emoji name https://github.com/siyuan-note/siyuan/issues/15034
			logging.LogWarnf("renaming invalid custom emoji file [%s] to [%s]", oldPath, newPath)
			if renameErr := filelock.Rename(oldPath, newPath); nil != renameErr {
				logging.LogErrorf("renaming invalid custom emoji file to [%s] failed: %s", newPath, renameErr)
				continue
			}
		}

		relativePath := filepath.ToSlash(filepath.Join(relativeDir, name))
		if customEmoji.IsDir() {
			readCustomEmojis(rootDir, relativePath, items)
			continue
		}
		appendCustomEmoji(relativePath, items)
	}
}

func appendCustomEmoji(name string, items *[]map[string]any) {
	ext := filepath.Ext(name)
	nameWithoutExt := strings.TrimSuffix(name, ext)
	emoji := map[string]any{
		"unicode":           name,
		"description":       nameWithoutExt,
		"description_zh_cn": nameWithoutExt,
		"description_ja_jp": nameWithoutExt,
		"keywords":          nameWithoutExt,
	}
	*items = append(*items, emoji)

	imgSrc := "/emojis/" + name
	model.AddCustomEmoji(nameWithoutExt, imgSrc)
}

const maxCustomEmojiSize = 10 * 1024 * 1024

func addCustomEmoji(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	data, err := readCustomEmojiData(c)
	if err != nil {
		ret.Code = http.StatusBadRequest
		ret.Msg = err.Error()
		return
	}
	if len(data) > maxCustomEmojiSize {
		ret.Code = http.StatusRequestEntityTooLarge
		ret.Msg = "custom emoji file is too large"
		return
	}

	data, ext, err := normalizeCustomEmojiData(data)
	if err != nil {
		ret.Code = http.StatusBadRequest
		ret.Msg = err.Error()
		return
	}
	relativePath, err := normalizeCustomEmojiPath(c.PostForm("name"), ext)
	if err != nil {
		ret.Code = http.StatusBadRequest
		ret.Msg = err.Error()
		return
	}

	emojisDir := filepath.Join(util.DataDir, "emojis")
	emojiPath := util.GetUniqueFilename(filepath.Join(emojisDir, filepath.FromSlash(relativePath)))
	if err = os.MkdirAll(filepath.Dir(emojiPath), 0755); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err = filelock.WriteFile(emojiPath, data); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.IncSync()
	relativePath, _ = filepath.Rel(emojisDir, emojiPath)
	relativePath = filepath.ToSlash(relativePath)
	ret.Data = map[string]any{"path": relativePath}
}

func readCustomEmojiData(c *gin.Context) ([]byte, error) {
	fileHeader, fileErr := c.FormFile("file")
	if fileErr == nil {
		file, err := fileHeader.Open()
		if err != nil {
			return nil, err
		}
		defer file.Close()
		return io.ReadAll(io.LimitReader(file, maxCustomEmojiSize+1))
	}

	rawURL := strings.TrimSpace(c.PostForm("url"))
	if rawURL == "" {
		return nil, fmt.Errorf("field [file] or [url] must not be empty")
	}
	return downloadCustomEmojiData(rawURL)
}

func downloadCustomEmojiData(rawURL string) ([]byte, error) {
	parsedURL, err := url.Parse(rawURL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Host == "" {
		return nil, fmt.Errorf("invalid custom emoji URL")
	}

	response, err := util.NewCustomReqClient().R().Get(parsedURL.String())
	if err != nil {
		return nil, fmt.Errorf("download custom emoji failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download custom emoji failed with status %d", response.StatusCode)
	}
	if response.ContentLength > maxCustomEmojiSize {
		return nil, fmt.Errorf("custom emoji file is too large")
	}

	data, err := io.ReadAll(io.LimitReader(response.Body, maxCustomEmojiSize+1))
	if err != nil {
		return nil, fmt.Errorf("read custom emoji response failed: %w", err)
	}
	return data, nil
}

func normalizeCustomEmojiData(data []byte) (normalized []byte, ext string, err error) {
	if len(data) == 0 {
		return nil, "", fmt.Errorf("custom emoji file must not be empty")
	}

	raster := true
	switch http.DetectContentType(data) {
	case "image/png":
		ext = ".png"
	case "image/jpeg":
		ext = ".jpg"
	case "image/gif":
		ext = ".gif"
	case "image/webp":
		ext = ".webp"
	default:
		raster = false
	}
	if raster {
		config, _, decodeErr := image.DecodeConfig(bytes.NewReader(data))
		if decodeErr != nil || config.Width < 1 || config.Height < 1 || config.Width > 16384 || config.Height > 16384 ||
			int64(config.Width)*int64(config.Height) > 100*1000*1000 {
			return nil, "", fmt.Errorf("invalid custom emoji image")
		}
		return data, ext, nil
	}

	sanitizedSVG, sanitizeErr := util.SanitizeSVG(string(data))
	if sanitizeErr == nil {
		return []byte(sanitizedSVG), ".svg", nil
	}
	return nil, "", fmt.Errorf("unsupported custom emoji image format")
}

func normalizeCustomEmojiPath(name, ext string) (string, error) {
	name = strings.TrimSpace(strings.ReplaceAll(name, "\\", "/"))
	parts := strings.Split(name, "/")
	if len(parts) == 0 {
		return "", fmt.Errorf("custom emoji name must not be empty")
	}

	lastIndex := len(parts) - 1
	switch strings.ToLower(filepath.Ext(parts[lastIndex])) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg":
		parts[lastIndex] = strings.TrimSuffix(parts[lastIndex], filepath.Ext(parts[lastIndex]))
	}
	for i, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" || part == "." || part == ".." {
			return "", fmt.Errorf("invalid custom emoji name")
		}
		part = util.FilterUploadFileName(part)
		if part == "" || part == "." || part == ".." {
			return "", fmt.Errorf("invalid custom emoji name")
		}
		parts[i] = part
	}
	parts[lastIndex] += ext
	return strings.Join(parts, "/"), nil
}

func checkUpdate(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	showMsg := arg["showMsg"].(bool)
	model.CheckUpdate(showMsg)
}

func exportLog(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	zipPath := model.ExportSystemLog()
	ret.Data = map[string]any{
		"zip": zipPath,
	}
}

func exportConf(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	logging.LogInfof("exporting conf...")

	name := "siyuan-conf-" + time.Now().Format("20060102150405") + ".json"
	tmpDir := filepath.Join(util.TempDir, "export")
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		logging.LogErrorf("export conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	data, err := gulu.JSON.MarshalJSON(model.Conf)
	if err != nil {
		logging.LogErrorf("export conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	clonedConf := &model.AppConf{}
	if err = gulu.JSON.UnmarshalJSON(data, clonedConf); err != nil {
		logging.LogErrorf("export conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if nil != clonedConf.Appearance {
		clonedConf.Appearance.DarkThemes = nil
		clonedConf.Appearance.LightThemes = nil
		clonedConf.Appearance.Icons = nil
	}
	if nil != clonedConf.Editor {
		clonedConf.Editor.Emoji = []string{}
		if strings.HasPrefix(clonedConf.Editor.FontFamily, util.CustomFontFamilyPrefix) {
			clonedConf.Editor.FontFamily = ""
			clonedConf.Editor.FontWeight = 400
			clonedConf.Editor.FontFamilyDisplay = ""
		}
	}
	if nil != clonedConf.Export {
		clonedConf.Export.PandocBin = ""
	}
	clonedConf.UserData = ""
	clonedConf.Account = nil
	clonedConf.AccessAuthCode = ""
	if nil != clonedConf.System {
		clonedConf.System.ID = ""
		clonedConf.System.Name = ""
		clonedConf.System.OSPlatform = ""
		clonedConf.System.Container = ""
		clonedConf.System.IsMicrosoftStore = false
		clonedConf.System.UpdateChannel = ""
		clonedConf.System.MicrosoftDefenderExcluded = false
	}
	clonedConf.Sync = nil
	clonedConf.Stat = nil
	clonedConf.Api = nil
	clonedConf.Repo = nil
	clonedConf.Secrets = nil
	clonedConf.NotebookCrypto = nil
	clonedConf.Onboarding = nil
	clonedConf.Publish = nil
	clonedConf.CookieKey = ""
	clonedConf.MCPOAuth = ""
	clonedConf.CloudRegion = 0
	if nil != clonedConf.AI {
		for _, provider := range clonedConf.AI.Providers {
			if nil != provider {
				provider.APIKey = ""
			}
		}
		if nil != clonedConf.AI.Embedding {
			clonedConf.AI.Embedding.APIKey = ""
		}
		if nil != clonedConf.AI.Rerank {
			clonedConf.AI.Rerank.APIKey = ""
		}
		clonedConf.AI.MCP = nil
	}

	data, err = gulu.JSON.MarshalIndentJSON(clonedConf, "", "  ")
	if err != nil {
		logging.LogErrorf("export conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	tmp := filepath.Join(tmpDir, name)
	if err = os.WriteFile(tmp, data, 0644); err != nil {
		logging.LogErrorf("export conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	zipFile, err := gulu.Zip.Create(tmp + ".zip")
	if err != nil {
		logging.LogErrorf("export conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if err = zipFile.AddEntry(name, tmp); err != nil {
		logging.LogErrorf("export conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if err = zipFile.Close(); err != nil {
		logging.LogErrorf("export conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	logging.LogInfof("exported conf")

	zipPath := "/export/" + name + ".zip"
	ret.Data = map[string]any{
		"name": name,
		"zip":  zipPath,
	}
}

func importConf(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(200, ret)

	logging.LogInfof("importing conf...")

	form, err := c.MultipartForm()
	if err != nil {
		logging.LogErrorf("read upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	files := form.File["file"]
	if 1 != len(files) {
		ret.Code = -1
		ret.Msg = "invalid upload file"
		return
	}

	f := files[0]
	fh, err := f.Open()
	if err != nil {
		logging.LogErrorf("read upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	data, err := io.ReadAll(fh)
	fh.Close()
	if err != nil {
		logging.LogErrorf("read upload file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	importDir := filepath.Join(util.TempDir, "import")
	if err = os.MkdirAll(importDir, 0755); err != nil {
		logging.LogErrorf("import conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	writePath := filepath.Join(importDir, f.Filename)
	if !gulu.File.IsSubPath(importDir, writePath) {
		logging.LogErrorf("import path [%s] is not sub path of import dir [%s]", writePath, importDir)
		ret.Code = -1
		ret.Msg = "import path is not sub path of import dir"
		return
	}

	if err = os.WriteFile(writePath, data, 0644); err != nil {
		logging.LogErrorf("import conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	tmpDir := filepath.Join(importDir, "conf")
	os.RemoveAll(tmpDir)
	if strings.HasSuffix(strings.ToLower(writePath), ".zip") {
		if err = gulu.Zip.Unzip(writePath, tmpDir); err != nil {
			logging.LogErrorf("import conf failed: %s", err)
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
	} else if strings.HasSuffix(strings.ToLower(writePath), ".json") {
		if err = gulu.File.CopyFile(writePath, filepath.Join(tmpDir, f.Filename)); err != nil {
			logging.LogErrorf("import conf failed: %s", err)
			ret.Code = -1
			ret.Msg = err.Error()
		}
	} else {
		logging.LogErrorf("invalid conf package")
		ret.Code = -1
		ret.Msg = "invalid conf package"
		return
	}

	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		logging.LogErrorf("import conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if 1 != len(entries) {
		logging.LogErrorf("invalid conf package")
		ret.Code = -1
		ret.Msg = "invalid conf package"
		return
	}

	writePath = filepath.Join(tmpDir, entries[0].Name())
	data, err = os.ReadFile(writePath)
	if err != nil {
		logging.LogErrorf("import conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	importedConf := model.NewAppConf()
	if err = gulu.JSON.UnmarshalJSON(data, importedConf); err != nil {
		logging.LogErrorf("import conf failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	preserveImportedAISecrets(importedConf.AI, model.Conf.AI)
	if nil != importedConf.System && nil != model.Conf.System {
		// 更新通道是应用级全局设置，导入工作空间配置时保持不变。
		importedConf.System.UpdateChannel = model.Conf.System.UpdateChannel
	}

	model.Conf.FileTree = importedConf.FileTree
	model.Conf.Tag = importedConf.Tag
	model.Conf.Editor = importedConf.Editor
	model.Conf.Export = importedConf.Export
	model.Conf.Graph = importedConf.Graph
	model.Conf.UILayout = importedConf.UILayout
	model.Conf.System = importedConf.System
	model.Conf.Keymap = importedConf.Keymap
	model.Conf.Search = importedConf.Search
	model.Conf.Flashcard = importedConf.Flashcard
	model.Conf.AI = importedConf.AI
	model.Conf.Bazaar = importedConf.Bazaar
	model.Conf.Save()

	logging.LogInfof("imported conf")
}

func preserveImportedAISecrets(imported, current *conf.AI) {
	if imported == nil || current == nil {
		return
	}

	currentProviders := map[string]*conf.Provider{}
	for _, provider := range current.Providers {
		if provider != nil && provider.ID != "" && provider.APIKey != "" {
			currentProviders[provider.ID] = provider
		}
	}
	for _, provider := range imported.Providers {
		if provider != nil && provider.APIKey == "" {
			if currentProvider := currentProviders[provider.ID]; currentProvider != nil &&
				currentProvider.BaseURL == provider.BaseURL && currentProvider.Protocol == provider.Protocol {
				provider.APIKey = currentProvider.APIKey
			}
		}
	}

	if imported.Embedding != nil && current.Embedding != nil && imported.Embedding.APIKey == "" &&
		imported.Embedding.ID != "" && imported.Embedding.ID == current.Embedding.ID &&
		imported.Embedding.BaseURL == current.Embedding.BaseURL {
		imported.Embedding.APIKey = current.Embedding.APIKey
	}
	if imported.Rerank != nil && current.Rerank != nil && imported.Rerank.APIKey == "" &&
		imported.Rerank.ID != "" && imported.Rerank.ID == current.Rerank.ID &&
		imported.Rerank.Endpoint == current.Rerank.Endpoint {
		imported.Rerank.APIKey = current.Rerank.APIKey
	}
	if imported.MCP == nil {
		imported.MCP = current.MCP
	}
}

func getConf(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	maskedConf, err := model.GetMaskedConf()
	if err != nil {
		ret.Code = -1
		ret.Msg = "get conf failed: " + err.Error()
		return
	}

	if !maskedConf.Sync.Enabled || (0 == maskedConf.Sync.Provider && !model.IsSubscriber()) {
		maskedConf.Sync.Stat = model.Conf.Language(53)
	}

	// REF: https://github.com/siyuan-note/siyuan/issues/11364
	role := model.GetGinContextRole(c)
	isPublish := model.IsReadOnlyRole(role)
	if isPublish {
		maskedConf.ReadOnly = true
	}
	if !model.IsValidRole(role, []model.Role{
		model.RoleAdministrator,
	}) {
		model.HideConfSecret(maskedConf)
	}

	if model.IsReadOnlyRoleContext(c) {
		maskedConf.UILayout = &conf.UILayout{}
	}

	// 浏览器环境下不返回工作空间绝对路径，避免泄露用户名等敏感信息
	// 原生客户端（桌面 Electron、移动端）UA 以 "SiYuan/" 开头，照常返回真实路径
	// REF: https://github.com/siyuan-note/siyuan/issues/17410
	if util.IsBrowserRequest(c) {
		maskedConf.System.WorkspaceDir = ""
		maskedConf.System.AppDir = ""
		maskedConf.System.ConfDir = ""
		maskedConf.System.DataDir = ""
		maskedConf.System.HomeDir = ""
	}

	ret.Data = map[string]any{
		"conf":      maskedConf,
		"start":     !util.IsUILoaded,
		"isPublish": isPublish,
	}
}

func ensureOnboarding(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	onboarding, notebookCreated, err := model.EnsureOnboarding()
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if notebookCreated {
		box := model.Conf.Box(onboarding.NotebookID)
		if nil != box {
			evt := util.NewCmdResult("createnotebook", 0, util.PushModeBroadcast)
			evt.Data = map[string]any{"box": box, "existed": false}
			util.PushEvent(evt)
		}
	}
	ret.Data = onboarding
}

func dismissOnboarding(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	ret.Data = model.DismissOnboarding()
}

func setUILayout(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if util.ReadOnly {
		return
	}

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg["layout"])
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	uiLayout := &conf.UILayout{}
	if err = gulu.JSON.UnmarshalJSON(param, uiLayout); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.Conf.SetUILayout(uiLayout)
	model.Conf.Save()
}

func setAPIToken(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	token := arg["token"].(string)
	token = util.RemoveInvalid(token)
	token = strings.TrimSpace(token)

	// 仅校验新设置的 token，清空（禁用 API token 鉴权）不做长度限制 https://github.com/siyuan-note/siyuan/security/advisories/GHSA-m6w6-p7pc-fpg2
	if 0 < len(token) && 8 > len(token) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(356)
		return
	}

	model.Conf.Api.Token = token
	model.Conf.Save()
}

func setAccessAuthCode(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if util.ContainerDocker == util.Container {
		ret.Code = -1
		ret.Msg = "access auth code cannot be set in Docker container"
		return
	}

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	aac := arg["accessAuthCode"].(string)
	masked := model.MaskedAccessAuthCode == aac
	if masked {
		aac = model.Conf.AccessAuthCode
	}

	originalLen := len(aac)

	aac = util.RemoveInvalid(aac)
	aac = strings.TrimSpace(aac)

	if 0 < originalLen && 0 == len(aac) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(287)
		return
	}

	// 仅校验新设置的密码，掩码回填的已有密码和清空（禁用锁屏）不做长度限制，避免用户被锁定 https://github.com/siyuan-note/siyuan/security/advisories/GHSA-w3xh-mmmh-r54v
	if !masked && 0 < len(aac) && 8 > len(aac) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(355)
		return
	}
	if aac == "" {
		currentOIDC := model.Conf.GetOIDC()
		var err error
		if util.IsMobileContainer() && currentOIDC.Enabled {
			err = model.ValidateOIDCMobileConfiguration(currentOIDC)
		} else if !model.IsLocalRequest(c) {
			err = model.ValidateOIDCConfigurationChange(c.Request.Context(), currentOIDC, true, false,
				util.SiYuanAccessAuthCodeBypass)
		}
		if err != nil {
			ret.Code = -1
			ret.Msg = model.Conf.Language(369)
			logging.LogWarnf("reject clearing the last usable access authentication method [ip=%s]: %s", c.ClientIP(), err)
			return
		}
	}

	model.Conf.AccessAuthCode = aac
	model.Conf.Save()

	session := util.GetSession(c)
	workspaceSession := util.GetWorkspaceSession(session)
	workspaceSession.AccessAuthCode = aac
	session.Save(c)
	go func() {
		time.Sleep(200 * time.Millisecond)
		util.ReloadUI()
	}()
	return
}

func setOIDC(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	config := conf.NewOIDC()
	if err := c.ShouldBindJSON(config); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(369)
		logging.LogWarnf("bind OIDC configuration failed [ip=%s]: %s", c.ClientIP(), err)
		return
	}
	currentConfig := model.Conf.GetOIDC()
	config.Normalize()
	requireRemoteAuthentication := util.ContainerDocker == util.Container || !model.IsLocalRequest(c)
	if err := model.ValidateOIDCConfigurationChange(c.Request.Context(), config, requireRemoteAuthentication,
		model.Conf.AccessAuthCode != "", util.SiYuanAccessAuthCodeBypass); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(369)
		logging.LogErrorf("validate OIDC configuration change failed [ip=%s]: %s", c.ClientIP(), err)
		return
	}
	configurationChanged := !reflect.DeepEqual(currentConfig, config)
	if configurationChanged && config.Enabled {
		ret.Code = -1
		ret.Msg = model.Conf.Language(369)
		logging.LogWarnf("reject unverified OIDC configuration change [ip=%s]", c.ClientIP())
		return
	}
	model.Conf.SetOIDC(config)
	masked, err := model.GetMaskedConf()
	if err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(369)
		logging.LogErrorf("get masked configuration after setting OIDC failed: %s", err)
		return
	}
	ret.Data = masked.OIDC
	if configurationChanged {
		util.CloseOIDCSessions()
	}
}

func setFollowSystemLockScreen(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	lockScreenMode := int(arg["lockScreenMode"].(float64))

	model.Conf.System.LockScreenMode = lockScreenMode
	model.Conf.Save()
	return
}

func getSysFonts(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	fonts := util.LoadSysFonts()
	ret.Data = fonts
}

func getCustomFonts(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = util.LoadCustomFonts()
}

func importCustomFont(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, util.MaxCustomFontSize+1024*1024)
	fileHeader, err := c.FormFile("file")
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			ret.Code = http.StatusRequestEntityTooLarge
			ret.Msg = "font file is too large"
		} else {
			ret.Code = http.StatusBadRequest
			ret.Msg = "Field [file] must not be empty"
		}
		return
	}
	if util.MaxCustomFontSize < fileHeader.Size {
		ret.Code = http.StatusRequestEntityTooLarge
		ret.Msg = "font file is too large"
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		ret.Code = http.StatusBadRequest
		ret.Msg = err.Error()
		return
	}
	defer file.Close()

	tempFile, err := util.CreateCustomFontTemp()
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	tempPath := tempFile.Name()
	defer util.DiscardCustomFontTemp(tempPath)

	written, copyErr := io.Copy(tempFile, io.LimitReader(file, util.MaxCustomFontSize+1))
	closeErr := tempFile.Close()
	if copyErr != nil {
		ret.Code = http.StatusBadRequest
		ret.Msg = copyErr.Error()
		return
	}
	if closeErr != nil {
		ret.Code = -1
		ret.Msg = closeErr.Error()
		return
	}
	if util.MaxCustomFontSize < written {
		ret.Code = http.StatusRequestEntityTooLarge
		ret.Msg = "font file is too large"
		return
	}

	font, _, err := util.InstallCustomFont(tempPath)
	if err != nil {
		ret.Code = http.StatusBadRequest
		ret.Msg = err.Error()
		return
	}
	ret.Data = font
}

func removeCustomFont(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	id, _ := arg["id"].(string)
	font, err := util.RemoveCustomFont(id)
	if err != nil {
		if os.IsNotExist(err) {
			ret.Code = http.StatusNotFound
		} else {
			ret.Code = http.StatusBadRequest
		}
		ret.Msg = err.Error()
		return
	}

	var editor *conf.Editor
	if model.Conf.Editor.FontFamily == font.Family {
		model.Conf.Editor.FontFamily = ""
		model.Conf.Editor.FontWeight = 400
		model.Conf.Editor.FontFamilyDisplay = ""
		model.Conf.Save()
		editor = model.Conf.Editor
	}
	ret.Data = map[string]any{
		"font":   font,
		"editor": editor,
	}
}

func version(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = util.Ver
}

func currentTime(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = util.CurrentTimeMillis()
}

func bootProgress(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	progress, details := util.GetBootProgressDetails()
	ret.Data = map[string]any{"progress": progress, "details": details}
}

// bootProgressSSE 以 Server-Sent Events 推送启动进度，仅在进度发生变化时写一帧。
func bootProgressSSE(c *gin.Context) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Writer.Flush()

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		return
	}

	// 连接后立即推送当前进度，避免等待第一个 tick
	progress, details := util.GetBootProgressDetails()
	lastProgress, lastDetails := progress, details
	if err := writeBootProgressSSE(c, flusher, progress, details); err != nil {
		return
	}
	if 100 <= progress {
		return
	}

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	ctx := c.Request.Context()
	for {
		select {
		case <-ctx.Done():
			// 客户端断开连接
			return
		case <-ticker.C:
			progress, details = util.GetBootProgressDetails()
			if progress == lastProgress && details == lastDetails {
				continue
			}
			lastProgress, lastDetails = progress, details
			if err := writeBootProgressSSE(c, flusher, progress, details); err != nil {
				return
			}
			if 100 <= progress {
				return
			}
		}
	}
}

func writeBootProgressSSE(c *gin.Context, flusher http.Flusher, progress int32, details string) error {
	data, err := json.Marshal(map[string]any{"progress": progress, "details": details})
	if err != nil {
		return err
	}
	if _, err = fmt.Fprintf(c.Writer, "data: %s\n\n", data); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}

func setAppearanceMode(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	mode := int(arg["mode"].(float64))
	model.Conf.Appearance.Mode = mode
	model.LoadThemes()
	model.WatchThemes()
	model.Conf.Save()

	ret.Data = map[string]any{
		"appearance": model.Conf.Appearance,
	}
}

func setNetworkServe(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	networkServe := arg["networkServe"].(bool)
	model.Conf.System.NetworkServe = networkServe
	model.Conf.Save()

	util.PushMsg(model.Conf.Language(42), 1000*15)
	time.Sleep(time.Second * 3)
}

func setNetworkServeTLS(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	networkServeTLS := arg["networkServeTLS"].(bool)
	model.Conf.System.NetworkServeTLS = networkServeTLS
	model.Conf.Save()

	util.PushMsg(model.Conf.Language(42), 1000*15)
	time.Sleep(time.Second * 3)
}

func exportTLSCACert(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	caCertPath := filepath.Join(util.ConfDir, util.TLSCACertFilename)
	if !gulu.File.IsExist(caCertPath) {
		ret.Code = -1
		ret.Msg = "CA certificate not found"
		return
	}

	tmpDir := filepath.Join(util.TempDir, "export")
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	exportPath := filepath.Join(tmpDir, util.TLSCACertFilename)
	if err := gulu.File.CopyFile(caCertPath, exportPath); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]any{
		"path": "/export/" + util.TLSCACertFilename,
	}
}

func exportTLSCABundle(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	caCertPath := filepath.Join(util.ConfDir, util.TLSCACertFilename)
	caKeyPath := filepath.Join(util.ConfDir, util.TLSCAKeyFilename)

	if !gulu.File.IsExist(caCertPath) || !gulu.File.IsExist(caKeyPath) {
		ret.Code = -1
		ret.Msg = "CA certificate not found, please enable TLS first"
		return
	}

	tmpDir := filepath.Join(util.TempDir, "export", "ca-bundle")
	os.RemoveAll(tmpDir)
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	defer os.RemoveAll(tmpDir)

	if err := gulu.File.CopyFile(caCertPath, filepath.Join(tmpDir, util.TLSCACertFilename)); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err := gulu.File.CopyFile(caKeyPath, filepath.Join(tmpDir, util.TLSCAKeyFilename)); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	zipPath := filepath.Join(util.TempDir, "export", "ca-bundle.zip")
	zipFile, err := gulu.Zip.Create(zipPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if err := zipFile.AddDirectory("", tmpDir); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if err := zipFile.Close(); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]any{
		"path": "/export/ca-bundle.zip",
	}
}

func importTLSCABundle(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	file, err := c.FormFile("file")
	if err != nil {
		ret.Code = -1
		ret.Msg = "[file] is required: " + err.Error()
		return
	}

	tmpDir := filepath.Join(util.TempDir, "import")
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	tmpZipPath := filepath.Join(tmpDir, "ca-bundle.zip")
	if err := c.SaveUploadedFile(file, tmpZipPath); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	defer os.Remove(tmpZipPath)

	extractDir := filepath.Join(tmpDir, "ca-bundle")
	os.RemoveAll(extractDir)
	if err := gulu.Zip.Unzip(tmpZipPath, extractDir); err != nil {
		ret.Code = -1
		ret.Msg = "failed to extract zip file: " + err.Error()
		return
	}
	defer os.RemoveAll(extractDir)

	caCertPath := filepath.Join(extractDir, util.TLSCACertFilename)
	caCertPEM, err := os.ReadFile(caCertPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = "ca.crt not found in zip file"
		return
	}

	caKeyPath := filepath.Join(extractDir, util.TLSCAKeyFilename)
	caKeyPEM, err := os.ReadFile(caKeyPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = "ca.key not found in zip file"
		return
	}

	if err := util.ImportCABundle(string(caCertPEM), string(caKeyPEM)); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]any{
		"msg": "CA bundle imported successfully. Please restart to apply changes.",
	}
}

func setAutoLaunch(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	autoLaunch := int(arg["autoLaunch"].(float64))
	model.Conf.System.AutoLaunch2 = autoLaunch
	model.Conf.Save()
}

func setDownloadInstallPkg(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	downloadInstallPkg := arg["downloadInstallPkg"].(bool)
	model.Conf.System.DownloadInstallPkg = downloadInstallPkg
	model.Conf.Save()
}

func setUpdateChannel(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	updateChannel, ok := arg["updateChannel"].(string)
	if !ok {
		ret.Code = -1
		ret.Msg = "update channel is invalid"
		return
	}
	if err := model.SetUpdateChannel(updateChannel); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
	}
}

func setNetworkProxy(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	scheme := arg["scheme"].(string)
	host := arg["host"].(string)
	port := arg["port"].(string)
	model.Conf.System.NetworkProxy = &conf.NetworkProxy{
		Scheme: scheme,
		Host:   host,
		Port:   port,
	}
	model.Conf.Save()

	proxyURL := model.Conf.System.NetworkProxy.String()
	util.SetNetworkProxy(proxyURL, model.Conf.System.NetworkProxy.IsSystem())
	util.PushMsg(model.Conf.Language(102), 3000)
}

func addUIProcess(c *gin.Context) {
	pid := c.Query("pid")
	util.UIProcessIDs.Store(pid, true)
}

func exit(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	forceArg := arg["force"]
	var force bool
	if nil != forceArg {
		force = forceArg.(bool)
	}

	execInstallPkgArg := arg["execInstallPkg"] // 0：默认检查新版本，1：不返回安装包，2：返回安装包路径并退出
	execInstallPkg := 0
	if nil != execInstallPkgArg {
		execInstallPkg = int(execInstallPkgArg.(float64))
	}

	setCurrentWorkspaceArg := arg["setCurrentWorkspace"]
	setCurrentWorkspace := true
	if nil != setCurrentWorkspaceArg {
		setCurrentWorkspace = setCurrentWorkspaceArg.(bool)
	}

	exitCode, installPkgPath := model.Close(force, setCurrentWorkspace, execInstallPkg)
	ret.Code = exitCode
	data := map[string]any{"closeTimeout": 0}
	if "" != installPkgPath {
		data["installPkgPath"] = installPkgPath
	}
	ret.Data = data
	switch exitCode {
	case 0:
	case 1: // 同步执行失败
		ret.Msg = model.Conf.Language(96) + "<div class=\"fn__space\"></div><button class=\"b3-button b3-button--white\">" + model.Conf.Language(97) + "</button>"
	case 2: // 提示新安装包
		ret.Msg = model.Conf.Language(61)
	}
}
