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

package model

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/88250/go-humanize"
	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/disintegration/imaging"
	"github.com/gabriel-vasile/mimetype"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func GetAssetImgSize(assetPath string) (width, height int) {
	return GetAssetImgSizeInBox(assetPath, "")
}

func GetAssetImgSizeInBox(assetPath, boxID string) (width, height int) {
	data, err := ReadAssetBytesInBox(boxID, assetPath)
	if err != nil {
		logging.LogErrorf("get asset [%s] abs path failed: %s", assetPath, err)
		return
	}

	img, err := imaging.Decode(bytes.NewReader(data))
	if err != nil {
		logging.LogErrorf("open asset image [%s] failed: %s", assetPath, err)
		return
	}

	width = img.Bounds().Dx()
	height = img.Bounds().Dy()
	return
}

// ReadAssetBytesInBox 读取指定 box 内的资源文件字节。若 box 为加密笔记本则自动解密返回明文。
// relativePath 形如 "assets/xxx.png"，可带 ?box= 查询参数。
func ReadAssetBytesInBox(boxID, relativePath string) ([]byte, error) {
	absPath, err := GetAssetAbsPathInBox(relativePath, boxID)
	if err != nil {
		return nil, err
	}
	data, readErr := os.ReadFile(absPath)
	if readErr != nil {
		return nil, readErr
	}
	// 从解析到的绝对路径反推有效 boxID，不轻信传入参数（路径可能通过 ?box= 指定了不同 box）
	effectiveBoxID := ExtractBoxIDFromAssetsPath(absPath)
	if effectiveBoxID != "" && IsEncryptedBox(effectiveBoxID) {
		HoldBoxReadLock(effectiveBoxID)
		dek, dekErr := GetDEKIfUnlocked(effectiveBoxID)
		if dekErr != nil {
			ReleaseBoxReadLock(effectiveBoxID)
			return nil, dekErr
		}
		defer ReleaseBoxReadLock(effectiveBoxID)
		diskName := filepath.Base(AssetPathWithoutQuery(relativePath))
		plain, decErr := DecryptAsset(effectiveBoxID, diskName, dek, data)
		if decErr != nil {
			return nil, decErr
		}
		return plain, nil
	}
	return data, nil
}

// GetAssetPathByHash 按 hash 查已存在的 asset 路径用于去重。boxID 非空且为加密笔记本时返回空——
// 加密笔记本不参与全局去重（避免复用普通明文 asset）；普通 box 走全局 cache/SQL（加密笔记本数据不在全局表）。
func GetAssetPathByHash(hash, boxID string) string {
	if boxID != "" && IsEncryptedBox(boxID) {
		return "" // 加密 box：跳过全局去重，强制新写（防跨边界复用明文 asset）
	}
	assetHash := cache.GetAssetHash(hash)
	if nil == assetHash {
		sqlAsset := sql.QueryAssetByHash(hash)
		if nil == sqlAsset {
			return ""
		}
		cache.SetAssetHash(sqlAsset.Hash, sqlAsset.Path)
		return sqlAsset.Path
	}
	return assetHash.Path
}

func HandleAssetsRemoveEvent(assetAbsPath string) {
	if !filelock.IsExist(assetAbsPath) {
		return
	}
	if gulu.File.IsDir(assetAbsPath) {
		return
	}
	// 跳过隐藏文件，如 WPS 的临时文件、Mac 的 .DS_Store
	if filelock.IsHidden(assetAbsPath) {
		return
	}
	if util.IsOfficeTempFile(assetAbsPath) {
		return
	}
	if strings.HasSuffix(assetAbsPath, ".tmp") {
		return
	}

	// 加密笔记本的 asset 是密文，跳过全局索引和 hash 缓存操作
	if IsEncryptedAssetPath(assetAbsPath) {
		removeAssetThumbnail(assetAbsPath)
		return
	}

	removeIndexAssetContent(assetAbsPath)
	removeAssetThumbnail(assetAbsPath)

	hash, err := util.GetEtag(assetAbsPath)
	if nil != err {
		logging.LogErrorf("calc asset [%s] hash failed: %s", assetAbsPath, err)
	} else {
		cache.RemoveAssetHash(hash)
	}
}

func HandleAssetsChangeEvent(assetAbsPath string) {
	if !filelock.IsExist(assetAbsPath) {
		return
	}
	if gulu.File.IsDir(assetAbsPath) {
		return
	}
	if filelock.IsHidden(assetAbsPath) {
		return
	}
	if util.IsOfficeTempFile(assetAbsPath) {
		return
	}
	if strings.HasSuffix(assetAbsPath, ".tmp") {
		return
	}

	// 加密笔记本的 asset 是密文，跳过全局内容索引和 hash 缓存（避免密文污染搜索索引）
	if IsEncryptedAssetPath(assetAbsPath) {
		removeAssetThumbnail(assetAbsPath)
		return
	}

	indexAssetContent(assetAbsPath)
	removeAssetThumbnail(assetAbsPath)

	hash, err := util.GetEtag(assetAbsPath)
	if nil != err {
		logging.LogErrorf("calc asset [%s] hash failed: %s", assetAbsPath, err)
	} else {
		p := strings.TrimPrefix(assetAbsPath, util.DataDir)
		p = strings.TrimPrefix(filepath.ToSlash(p), "/")
		cache.SetAssetHash(hash, p)
	}
}

func removeAssetThumbnail(assetAbsPath string) {
	if util.IsCompressibleAssetImage(assetAbsPath) {
		p := filepath.ToSlash(assetAbsPath)
		_, after, found := strings.Cut(p, "assets/")
		if !found {
			return
		}
		thumbnailPath := filepath.Join(util.TempDir, "thumbnails", "assets", after)
		os.RemoveAll(thumbnailPath)
	}
}

func NeedGenerateAssetsThumbnail(sourceImgPath string) bool {
	info, err := os.Stat(sourceImgPath)
	if err != nil {
		return false
	}
	if info.IsDir() {
		return false
	}
	return info.Size() > 1024*1024
}

func GenerateAssetsThumbnail(sourceImgPath, resizedImgPath string) (err error) {
	start := time.Now()
	img, err := imaging.Open(sourceImgPath)
	if err != nil {
		return
	}

	// 获取原图宽高
	originalWidth := img.Bounds().Dx()
	originalHeight := img.Bounds().Dy()

	// 固定最大宽度为 520，计算缩放比例
	maxWidth := 520
	scale := float64(maxWidth) / float64(originalWidth)

	// 按比例计算新的宽高
	newWidth := maxWidth
	newHeight := int(float64(originalHeight) * scale)

	// 缩放图片
	resizedImg := imaging.Resize(img, newWidth, newHeight, imaging.Lanczos)

	// 保存缩放后的图片
	err = os.MkdirAll(filepath.Dir(resizedImgPath), 0755)
	if err != nil {
		return
	}
	err = imaging.Save(resizedImg, resizedImgPath)
	if err != nil {
		return
	}
	logging.LogDebugf("generated thumbnail image [%s] to [%s], cost [%d]ms", sourceImgPath, resizedImgPath, time.Since(start).Milliseconds())
	return
}

func DocImageAssets(rootID string) (ret []string, err error) {
	tree, err := LoadTreeByBlockID(rootID)
	if err != nil {
		return
	}

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if ast.NodeImage == n.Type {
			linkDest := n.ChildByType(ast.NodeLinkDest)
			dest := linkDest.Tokens
			if 1 > len(dest) { // 双击打开图片不对 https://github.com/siyuan-note/siyuan/issues/5876
				return ast.WalkContinue
			}
			ret = append(ret, gulu.Str.FromBytes(dest))
		}
		return ast.WalkContinue
	})
	return
}

type ImageArtifactRef struct {
	Kind       string `json:"kind"`
	Path       string `json:"path"`
	MIMEType   string `json:"mimeType,omitempty"`
	DocumentID string `json:"documentId,omitempty"`
}

type DocumentImageList struct {
	DocumentID string             `json:"documentId"`
	Images     []ImageArtifactRef `json:"images"`
}

type AnalyzeDocumentImageRequest struct {
	DocumentID string `json:"documentId"`
	AssetPath  string `json:"assetPath"`
	Question   string `json:"question"`
	Detail     string `json:"detail"`
}

type AnalyzeDocumentImageResult struct {
	Artifact ImageArtifactRef `json:"artifact"`
	Analysis string           `json:"analysis"`
	Width    int              `json:"width"`
	Height   int              `json:"height"`
}

type AnalyzeImageResult struct {
	Analysis string `json:"analysis"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
}

type GenerateImageRequest struct {
	Prompt       string `json:"prompt"`
	Size         string `json:"size"`
	Quality      string `json:"quality"`
	OutputFormat string `json:"outputFormat"`
}

type GenerateImageResult struct {
	Data          []byte `json:"-"`
	MIMEType      string `json:"mimeType"`
	Extension     string `json:"extension"`
	RevisedPrompt string `json:"revisedPrompt,omitempty"`
}

type GenerateDocumentImageRequest struct {
	DocumentID   string `json:"documentId"`
	Prompt       string `json:"prompt"`
	Size         string `json:"size"`
	Quality      string `json:"quality"`
	OutputFormat string `json:"outputFormat"`
}

type GenerateDocumentImageResult struct {
	Artifact      ImageArtifactRef `json:"artifact"`
	RevisedPrompt string           `json:"revisedPrompt,omitempty"`
}

type imageExecutionUnknownError struct {
	err error
}

func (err *imageExecutionUnknownError) Error() string {
	return err.err.Error()
}

func (err *imageExecutionUnknownError) Unwrap() error {
	return err.err
}

// IsImageExecutionUnknown 判断图片提供商调用是否已经开始，调用方不得自动重试这类错误。
func IsImageExecutionUnknown(err error) bool {
	var target *imageExecutionUnknownError
	return errors.As(err, &target)
}

func markImageExecutionUnknown(err error) error {
	if err == nil || IsImageExecutionUnknown(err) {
		return err
	}
	return &imageExecutionUnknownError{err: err}
}

// ListDocumentImages 返回文档引用的本地图片，供智能体工具和编辑器功能复用。
func ListDocumentImages(documentID string) (DocumentImageList, error) {
	bt, err := resolveMultimodalDocument(documentID)
	if err != nil {
		return DocumentImageList{}, err
	}
	paths, err := DocImageAssets(bt.RootID)
	if err != nil {
		return DocumentImageList{}, fmt.Errorf("list document images failed: %w", err)
	}
	refs := make([]ImageArtifactRef, 0, len(paths))
	seen := map[string]bool{}
	for _, assetPath := range paths {
		if !strings.HasPrefix(AssetPathWithoutQuery(assetPath), "assets/") || seen[assetPath] {
			continue
		}
		seen[assetPath] = true
		refs = append(refs, ImageArtifactRef{Kind: "image", Path: assetPath, DocumentID: bt.RootID})
	}
	return DocumentImageList{DocumentID: bt.RootID, Images: refs}, nil
}

// AnalyzeDocumentImage 使用全局图片理解配置分析文档引用的资源图片。
func AnalyzeDocumentImage(ctx context.Context, request AnalyzeDocumentImageRequest) (AnalyzeDocumentImageResult, error) {
	if strings.TrimSpace(request.AssetPath) == "" {
		return AnalyzeDocumentImageResult{}, errors.New("assetPath is required for analyze")
	}
	if !strings.HasPrefix(AssetPathWithoutQuery(request.AssetPath), "assets/") {
		return AnalyzeDocumentImageResult{}, errors.New("only local assets/... images are supported")
	}
	bt, err := resolveMultimodalDocument(request.DocumentID)
	if err != nil {
		return AnalyzeDocumentImageResult{}, err
	}
	if !documentReferencesImage(bt.RootID, request.AssetPath) {
		return AnalyzeDocumentImageResult{}, errors.New("assetPath is not an image referenced by the document")
	}
	data, err := ReadAssetBytesInBox(bt.BoxID, request.AssetPath)
	if err != nil {
		return AnalyzeDocumentImageResult{}, fmt.Errorf("read image failed: %w", err)
	}
	result, err := AnalyzeImage(ctx, data, request.Question, request.Detail)
	if err != nil {
		return AnalyzeDocumentImageResult{}, err
	}
	return AnalyzeDocumentImageResult{
		Artifact: ImageArtifactRef{Kind: "image", Path: request.AssetPath, DocumentID: bt.RootID},
		Analysis: result.Analysis,
		Width:    result.Width,
		Height:   result.Height,
	}, nil
}

// AnalyzeImage 使用全局图片理解配置分析图片字节，可供文档资源、聊天附件和其他图片入口复用。
func AnalyzeImage(ctx context.Context, data []byte, question, detail string) (AnalyzeImageResult, error) {
	if Conf == nil || Conf.AI == nil {
		return AnalyzeImageResult{}, errors.New("AI configuration is unavailable")
	}
	provider, visionModel := Conf.AI.GetVisionModel()
	if err := validateImageModel(provider, visionModel); err != nil {
		return AnalyzeImageResult{}, err
	}
	prepared, err := util.PrepareForVision(data, Conf.AI.Vision.MaxImageBytes, Conf.AI.Vision.MaxPixels, Conf.AI.Vision.MaxEdge)
	if err != nil {
		return AnalyzeImageResult{}, err
	}
	analysis, err := util.NewOpenAIImageAdapter(
		provider.APIKey, provider.BaseURL, visionModel.Name, Conf.AI.Vision.RequestTimeout,
	).Analyze(ctx, prepared, question, detail)
	if err != nil {
		return AnalyzeImageResult{}, markImageExecutionUnknown(fmt.Errorf("analyze image failed: %w", err))
	}
	return AnalyzeImageResult{Analysis: analysis, Width: prepared.Width, Height: prepared.Height}, nil
}

// GenerateImage 使用全局图片生成配置创建图片字节，可供文档资源、编辑器和其他图片入口复用。
func GenerateImage(ctx context.Context, request GenerateImageRequest) (GenerateImageResult, error) {
	if Conf == nil || Conf.AI == nil {
		return GenerateImageResult{}, errors.New("AI configuration is unavailable")
	}
	provider, generationModel := Conf.AI.GetImageGenerationModel()
	if err := validateImageModel(provider, generationModel); err != nil {
		return GenerateImageResult{}, err
	}
	prompt := strings.TrimSpace(request.Prompt)
	if prompt == "" {
		return GenerateImageResult{}, errors.New("prompt is required for image generation")
	}
	size := multimodalValueOrDefault(request.Size, Conf.AI.ImageGeneration.Size)
	quality := multimodalValueOrDefault(request.Quality, Conf.AI.ImageGeneration.Quality)
	outputFormat := strings.ToLower(multimodalValueOrDefault(request.OutputFormat, Conf.AI.ImageGeneration.OutputFormat))
	if outputFormat != "png" && outputFormat != "jpeg" && outputFormat != "webp" {
		return GenerateImageResult{}, errors.New("unsupported image output format")
	}
	generated, err := util.NewOpenAIImageAdapter(
		provider.APIKey, provider.BaseURL, generationModel.Name, Conf.AI.ImageGeneration.RequestTimeout,
	).Generate(ctx, util.GenerateImageRequest{
		Prompt: prompt, Size: size, Quality: quality, OutputFormat: outputFormat,
	})
	if err != nil {
		return GenerateImageResult{}, markImageExecutionUnknown(fmt.Errorf("generate image failed: %w", err))
	}
	if ctx.Err() != nil {
		return GenerateImageResult{}, markImageExecutionUnknown(errors.New("image generation was cancelled"))
	}
	return GenerateImageResult{
		Data: generated.Data, MIMEType: generated.MIMEType, Extension: generated.Extension, RevisedPrompt: generated.RevisedPrompt,
	}, nil
}

// GenerateDocumentImage 使用通用图片生成能力创建文档资源。
func GenerateDocumentImage(ctx context.Context, request GenerateDocumentImageRequest) (GenerateDocumentImageResult, error) {
	bt, err := resolveMultimodalDocument(request.DocumentID)
	if err != nil {
		return GenerateDocumentImageResult{}, err
	}
	generated, err := GenerateImage(ctx, GenerateImageRequest{
		Prompt: request.Prompt, Size: request.Size, Quality: request.Quality, OutputFormat: request.OutputFormat,
	})
	if err != nil {
		return GenerateDocumentImageResult{}, err
	}
	assetPath, _, err := InsertAssetBytes(bt.RootID, "ai-image"+generated.Extension, generated.Data)
	if err != nil {
		return GenerateDocumentImageResult{}, markImageExecutionUnknown(fmt.Errorf("save generated image failed: %w", err))
	}
	return GenerateDocumentImageResult{
		Artifact: ImageArtifactRef{
			Kind: "image", Path: assetPath, MIMEType: generated.MIMEType, DocumentID: bt.RootID,
		},
		RevisedPrompt: generated.RevisedPrompt,
	}, nil
}

func resolveMultimodalDocument(documentID string) (*treenode.BlockTree, error) {
	bt := treenode.GetBlockTree(strings.TrimSpace(documentID))
	if bt == nil {
		return nil, errors.New("document not found: " + documentID)
	}
	return bt, nil
}

func validateImageModel(provider *conf.Provider, imageModel *conf.Model) error {
	if provider == nil || imageModel == nil {
		return errors.New("image model is not configured")
	}
	if provider.Protocol != "" && provider.Protocol != "openai" {
		return fmt.Errorf("unsupported multimodal provider protocol: %s", provider.Protocol)
	}
	return nil
}

func documentReferencesImage(rootID, assetPath string) bool {
	paths, err := DocImageAssets(rootID)
	if err != nil {
		return false
	}
	wanted := AssetPathWithoutQuery(assetPath)
	for _, current := range paths {
		if AssetPathWithoutQuery(current) == wanted {
			return true
		}
	}
	return false
}

func multimodalValueOrDefault(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func DocAssets(rootID string, retainQueryStr bool) (ret []string, err error) {
	tree, err := LoadTreeByBlockID(rootID)
	if err != nil {
		return
	}

	ret = getAssetsLinkDests(tree.Root, false)
	if !retainQueryStr {
		for i, asset := range ret {
			if before, _, ok := strings.Cut(asset, "?"); ok {
				ret[i] = before
			}
		}
	}
	return
}

func NetAssets2LocalAssets(rootID string, onlyImg bool, originalURL string) (err error) {
	syncingFiles.Store(rootID, true)
	defer syncingFiles.Delete(rootID)

	tree, err := LoadTreeByBlockID(rootID)
	if err != nil {
		return
	}

	docDirLocalPath := filepath.Join(util.DataDir, tree.Box, path.Dir(tree.Path))
	assetsDirPath := getAssetsDir(filepath.Join(util.DataDir, tree.Box), docDirLocalPath)
	if !gulu.File.IsExist(assetsDirPath) {
		if err = os.MkdirAll(assetsDirPath, 0755); err != nil {
			return
		}
	}

	err = netAssets2LocalAssets0(tree, onlyImg, originalURL, assetsDirPath, true)
	go func() {
		time.Sleep(128 * time.Microsecond)
		util.PushReloadProtyle(rootID)
	}()
	return
}

func netAssets2LocalAssets0(tree *parse.Tree, onlyImg bool, originalURL string, assetsDirPath string, needWriteTree bool) (err error) {
	var files int
	var size int64
	msgId := gulu.Rand.String(7)

	browserClient := util.NewCustomReqClient() // 自定义了 TLS 指纹，增加下载成功率

	forbiddenCount := 0
	destNodes := getRemoteAssetsLinkDestsInTree(tree, onlyImg)
	assetsMap := map[string]string{}
	for _, destNode := range destNodes {
		dests := getRemoteAssetsLinkDests(destNode, onlyImg)
		if 1 > len(dests) {
			continue
		}

		for _, dest := range dests {
			if u := util.FileURLToLocalPath(dest); u != "" { // 处理本地文件链接
				if !gulu.File.IsExist(u) {
					logging.LogErrorf("local file asset [%s] not exist", u)
					continue
				}

				if gulu.File.IsDir(u) {
					logging.LogWarnf("ignore converting directory path [%s] to local asset", u)
					continue
				}

				if util.IsSensitivePath(u) {
					logging.LogWarnf("ignore converting sensitive path [%s] to local asset", u)
					continue
				}

				name := assetsMap[u]
				if "" != name {
					setAssetsLinkDest(destNode, dest, "assets/"+name)
					continue
				}

				name = filepath.Base(u)
				name = util.FilterUploadFileName(name)
				name = "network-asset-" + name
				var writePath string
				if IsEncryptedBox(tree.Box) {
					// 加密 box：脱敏文件名 + 加密内容（writeAssetFile 内部按路径反查 box 加密）+ 写映射
					diskName := encryptedAssetName(util.Ext(name), ast.NewNodeID())
					writePath = filepath.Join(assetsDirPath, diskName)
					f, openErr := os.Open(u)
					if openErr != nil {
						logging.LogErrorf("open [%s] failed: %s", u, openErr)
						continue
					}
					if err = writeAssetFile(writePath, f, tree.Box); err != nil {
						logging.LogErrorf("write encrypted asset [%s] failed: %s", writePath, err)
						f.Close()
						continue
					}
					f.Close()
					// 映射写失败则回滚已写的 asset 密文，避免产出"孤儿密文 asset 无映射"（详见设计文档 §7）
					if mapErr := writeAssetNameMapping(tree.Box, diskName, name); mapErr != nil {
						logging.LogErrorf("write asset name mapping for [%s] failed: %s", name, mapErr)
						_ = filelock.Remove(writePath)
						continue
					}
					name = diskName
				} else {
					name = util.AssetName(name, ast.NewNodeID())
					writePath = filepath.Join(assetsDirPath, name)
					if err = filelock.Copy(u, writePath); err != nil {
						logging.LogErrorf("copy [%s] to [%s] failed: %s", u, writePath, err)
						continue
					}
				}

				assetURL := "assets/" + name
				if IsEncryptedBox(tree.Box) {
					assetURL += "?box=" + tree.Box
				}
				setAssetsLinkDest(destNode, dest, assetURL)
				assetsMap[u] = name
				files++
				size += gulu.File.GetFileSize(writePath)
				continue
			}

			if strings.HasPrefix(strings.ToLower(dest), "https://") || strings.HasPrefix(strings.ToLower(dest), "http://") || strings.HasPrefix(dest, "//") {
				if strings.HasPrefix(dest, "//") {
					// `Convert network images to local` supports `//` https://github.com/siyuan-note/siyuan/issues/10598
					dest = "https:" + dest
				}

				u := dest
				if strings.Contains(u, "qpic.cn") {
					// 改进 `网络图片转换为本地图片` 微信图片拉取 https://github.com/siyuan-note/siyuan/issues/5052
					if strings.Contains(u, "http://") {
						u = strings.Replace(u, "http://", "https://", 1)
					}

					// 改进 `网络图片转换为本地图片` 微信图片拉取 https://github.com/siyuan-note/siyuan/issues/6431
					// 下面这部分需要注释掉，否则会导致响应 400
					//if strings.HasSuffix(u, "/0") {
					//	u = strings.Replace(u, "/0", "/640", 1)
					//} else if strings.Contains(u, "/0?") {
					//	u = strings.Replace(u, "/0?", "/640?", 1)
					//}
				}

				name := assetsMap[u]
				if "" != name {
					setAssetsLinkDest(destNode, dest, "assets/"+name)
					continue
				}

				displayU := u
				if 64 < len(displayU) {
					displayU = displayU[:64] + "..."
				}

				util.PushUpdateMsg(msgId, fmt.Sprintf(Conf.Language(119), displayU), 15000)
				request := browserClient.R()
				request.SetRetryCount(1).SetRetryFixedInterval(3 * time.Second)
				if "" != originalURL {
					request.SetHeader("Referer", originalURL) // 改进浏览器剪藏扩展转换本地图片成功率 https://github.com/siyuan-note/siyuan/issues/7464
				}
				resp, reqErr := request.Get(u)
				if nil != reqErr {
					logging.LogErrorf("download network asset [%s] failed: %s", u, reqErr)
					continue
				}
				if http.StatusForbidden == resp.StatusCode || http.StatusUnauthorized == resp.StatusCode {
					forbiddenCount++
				}
				if strings.Contains(strings.ToLower(resp.GetContentType()), "text/html") {
					// 忽略超链接网页 `Convert network assets to local` no longer process webpage https://github.com/siyuan-note/siyuan/issues/9965
					continue
				}
				if 200 != resp.StatusCode {
					logging.LogErrorf("download network asset [%s] failed: %d", u, resp.StatusCode)
					continue
				}

				if 1024*1024*96 < resp.ContentLength {
					logging.LogWarnf("network asset [%s]' size [%s] is large then [96 MB], ignore it", u, humanize.IBytes(uint64(resp.ContentLength)))
					continue
				}

				data, repErr := resp.ToBytes()
				if nil != repErr {
					logging.LogErrorf("download network asset [%s] failed: %s", u, repErr)
					continue
				}
				if strings.Contains(u, "?") {
					name = u[:strings.Index(u, "?")]
					name = path.Base(name)
				} else {
					name = path.Base(u)
				}
				if strings.Contains(name, "#") {
					name = name[:strings.Index(name, "#")]
				}
				name, _ = url.PathUnescape(name)
				name = util.FilterUploadFileName(name)
				ext := util.Ext(name)
				if !util.IsCommonExt(ext) {
					if mtype := mimetype.Detect(data); nil != mtype {
						ext = mtype.Extension()
						name += ext
					}
				}
				if "" == ext && bytes.HasPrefix(data, []byte("<svg ")) && bytes.HasSuffix(data, []byte("</svg>")) {
					ext = ".svg"
					name += ext
				}
				if "" == ext {
					contentType := resp.Header.Get("Content-Type")
					exts, _ := mime.ExtensionsByType(contentType)
					if 0 < len(exts) {
						ext = exts[0]
						name += ext
					}
				}
				if IsEncryptedBox(tree.Box) {
					// 加密 box：脱敏文件名 + 加密内容 + 写映射
					name = "network-asset-" + name
					diskName := encryptedAssetName(util.Ext(name), ast.NewNodeID())
					writePath := filepath.Join(assetsDirPath, diskName)
					if err = writeAssetFile(writePath, bytes.NewReader(data), tree.Box); err != nil {
						logging.LogErrorf("write encrypted network asset [%s] failed: %s", writePath, err)
						continue
					}
					// 映射写失败则回滚已写的 asset 密文，避免产出"孤儿密文 asset 无映射"（详见设计文档 §7）
					if mapErr := writeAssetNameMapping(tree.Box, diskName, name); mapErr != nil {
						logging.LogErrorf("write asset name mapping for [%s] failed: %s", name, mapErr)
						_ = filelock.Remove(writePath)
						continue
					}
					name = diskName
				} else {
					name = util.AssetName(name, ast.NewNodeID())
					name = "network-asset-" + name
					writePath := filepath.Join(assetsDirPath, name)
					if err = filelock.WriteFile(writePath, data); err != nil {
						logging.LogErrorf("write downloaded network asset [%s] to local asset [%s] failed: %s", u, writePath, err)
						continue
					}
				}

				assetURL := "assets/" + name
				if IsEncryptedBox(tree.Box) {
					assetURL += "?box=" + tree.Box
				}
				setAssetsLinkDest(destNode, dest, assetURL)
				assetsMap[u] = name
				files++
				size += int64(len(data))
				continue
			}
		}
	}

	util.PushClearMsg(msgId)

	if needWriteTree {
		if 0 < files {
			msgId = util.PushMsg(Conf.Language(113), 7000)
			if err = writeTreeUpsertQueue(tree); err != nil {
				return
			}
			util.PushUpdateMsg(msgId, fmt.Sprintf(Conf.Language(120), files, humanize.BytesCustomCeil(uint64(size), 2)), 5000)

			if 0 < forbiddenCount {
				util.PushErrMsg(fmt.Sprintf(Conf.Language(255), forbiddenCount), 5000)
			}
		} else {
			if 0 < forbiddenCount {
				util.PushErrMsg(fmt.Sprintf(Conf.Language(255), forbiddenCount), 5000)
			} else {
				util.PushMsg(Conf.Language(121), 3000)
			}
		}
	}
	return
}

// DownloadNetAssets2LocalAssets 将语法树中的网络资源下载到本地并改写链接，
// 不持久化文档树，由调用方负责后续保存与渲染。
func DownloadNetAssets2LocalAssets(tree *parse.Tree, onlyImg bool, originalURL string, assetsDirPath string) {
	netAssets2LocalAssets0(tree, onlyImg, originalURL, assetsDirPath, false)
}

func SearchAssetsByName(keyword string, exts []string) (ret []*cache.Asset) {
	ret = []*cache.Asset{}
	var keywords []string
	keywords = append(keywords, keyword)
	if "" != keyword {
		keywords = append(keywords, strings.Split(keyword, " ")...)
	}
	pathHitCount := map[string]int{}
	filterByExt := 0 < len(exts)
	matchedAssets := cache.FilterAssets(func(path string, asset *cache.Asset) bool {

		// 扩展名过滤
		if filterByExt {
			ext := filepath.Ext(asset.HName)
			includeExt := false
			for _, e := range exts {
				if strings.ToLower(ext) == strings.ToLower(e) {
					includeExt = true
					break
				}
			}
			if !includeExt {
				return false
			}
		}

		// 关键字匹配
		lowerHName := strings.ToLower(asset.HName)
		lowerPath := strings.ToLower(asset.Path)
		var hitNameCount, hitPathCount int
		for i, k := range keywords {
			lowerKeyword := strings.ToLower(k)
			if 0 == i {
				// 第一个是完全匹配，权重最高
				if strings.Contains(lowerHName, lowerKeyword) {
					hitNameCount += 64
				}
				if strings.Contains(lowerPath, lowerKeyword) {
					hitPathCount += 64
				}
			}

			hitNameCount += strings.Count(lowerHName, lowerKeyword)
			hitPathCount += strings.Count(lowerPath, lowerKeyword)
			if 1 > hitNameCount && 1 > hitPathCount {
				continue
			}
		}

		// 只返回有匹配的资源
		if 1 > hitNameCount+hitPathCount {
			return false
		}

		// 记录命中次数用于排序
		pathHitCount[asset.Path] = hitNameCount + hitPathCount
		return true
	})

	// 添加高亮
	for _, asset := range matchedAssets {
		hitCount := pathHitCount[asset.Path]
		hName := asset.HName
		if hitCount > 0 {
			_, hName = search.MarkText(asset.HName, strings.Join(keywords, search.TermSep), 64, Conf.Search.CaseSensitive)
		}
		ret = append(ret, &cache.Asset{
			HName:   hName,
			Path:    asset.Path,
			Updated: asset.Updated,
		})
	}

	if 0 < len(pathHitCount) {
		sort.Slice(ret, func(i, j int) bool {
			return pathHitCount[ret[i].Path] > pathHitCount[ret[j].Path]
		})
	} else {
		sort.Slice(ret, func(i, j int) bool {
			return ret[i].Updated > ret[j].Updated
		})
	}

	if Conf.Search.Limit <= len(ret) {
		ret = ret[:Conf.Search.Limit]
	}
	return
}

func GetAssetAbsPath(relativePath string) (string, error) {
	return GetAssetAbsPathWithOpt(relativePath, false)
}

// AssetPathWithoutQuery 返回去掉查询参数后的资源路径，用于复制到导出目录等磁盘路径场景。
func AssetPathWithoutQuery(relativePath string) string {
	relativePath = strings.TrimSpace(relativePath)
	if idx := strings.Index(relativePath, "?"); idx >= 0 {
		relativePath = relativePath[:idx]
	}
	return filepath.ToSlash(relativePath)
}

func assetPathAndBox(relativePath, defaultBoxID string) (cleanPath, boxID string, err error) {
	relativePath = strings.TrimSpace(relativePath)
	boxID = defaultBoxID
	if idx := strings.Index(relativePath, "?"); idx >= 0 {
		query := relativePath[idx+1:]
		relativePath = relativePath[:idx]
		if values, parseErr := url.ParseQuery(query); parseErr == nil {
			if queryBoxID := strings.TrimSpace(values.Get("box")); queryBoxID != "" {
				if defaultBoxID != "" && defaultBoxID != queryBoxID {
					// 调用方指定了 boxID 但 URL 里是另一个 box：拒绝，防止解析到错误 box
					err = fmt.Errorf("box mismatch: caller specified [%s] but URL has [%s]", defaultBoxID, queryBoxID)
					return
				}
				boxID = queryBoxID
			}
		}
	}
	cleanPath = filepath.ToSlash(relativePath)
	return
}

// GetAssetAbsPathInBox 在指定 box 内解析资源绝对路径，不进行全局遍历。
// relativePath 必须以 assets/ 前缀开头，boxID 为空且路径没有 box 查询参数时只解析普通/全局资源，不遍历加密 box。
// 加密 box 直接从 <boxID>/assets/ 查找，不依赖后缀匹配。
func GetAssetAbsPathInBox(relativePath, boxID string) (string, error) {
	var err error
	relativePath, boxID, err = assetPathAndBox(relativePath, boxID)
	if err != nil {
		return "", err
	}
	relativePath = path.Clean(relativePath)
	if relativePath == "." || strings.HasPrefix(relativePath, "../") || relativePath == ".." || path.IsAbs(relativePath) {
		return "", fmt.Errorf("[%s] is not an asset path", relativePath)
	}
	if !strings.HasPrefix(relativePath, "assets/") {
		return "", fmt.Errorf("[%s] is not an asset path (must start with assets/)", relativePath)
	}
	if boxID != "" && !ast.IsNodeIDPattern(boxID) {
		return "", fmt.Errorf("[%s] is not a box id", boxID)
	}

	if boxID == "" {
		return GetAssetAbsPathWithOpt(relativePath, false)
	}

	p := filepath.Join(util.DataDir, boxID, relativePath)
	if gulu.File.IsExist(p) {
		if !gulu.File.IsSubPath(util.WorkspaceDir, p) {
			return "", fmt.Errorf("[%s] is not sub path of workspace", p)
		}
		// 解析符号链接/目录联接，防止软链接跳出资产根目录
		if realP, evalErr := filepath.EvalSymlinks(p); evalErr == nil && realP != p {
			if !gulu.File.IsSubPath(util.WorkspaceDir, realP) {
				return "", fmt.Errorf("symlink [%s] resolves outside workspace: [%s]", p, realP)
			}
			// 验证解析后的路径仍在 <boxID>/assets/ 或全局 data/assets/ 下
			expectedPrefix := filepath.Join(util.DataDir, "assets")
			if boxID != "" {
				expectedPrefix = filepath.Join(util.DataDir, boxID, "assets")
			}
			if !gulu.File.IsSubPath(expectedPrefix, realP) {
				return "", fmt.Errorf("symlink [%s] resolves outside assets directory: [%s]", p, realP)
			}
		}
		return p, nil
	}
	// 非加密 box 的资源可能回退到全局 data/assets（兼容旧笔记本结构）
	if !IsEncryptedBox(boxID) {
		return GetAssetAbsPathWithOpt(relativePath, false)
	}
	return "", fmt.Errorf(Conf.Language(12), relativePath)
}

// GetAssetAbsPathWithOpt 与 GetAssetAbsPath 一致，但可通过 includeEncrypted 控制是否遍历加密 box。
// serveAssets 传 true（下游 serveEncryptedAsset 会按锁定状态 fail-closed），其他调用方传 false（安全跳过）。
func GetAssetAbsPathWithOpt(relativePath string, includeEncrypted bool) (string, error) {
	relativePath = strings.TrimSpace(relativePath)
	if idx := strings.Index(relativePath, "?"); idx >= 0 {
		relativePath = relativePath[:idx]
	}

	absPath, err := getAssetAbsPath(relativePath, includeEncrypted)
	if err == nil && absPath != "" {
		return absPath, nil
	}

	if err != nil {
		return "", err
	}
	return "", fmt.Errorf(Conf.Language(12), relativePath)
}

func getAssetAbsPath(relativePath string, includeEncrypted bool) (absPath string, err error) {
	relativePath = filepath.ToSlash(relativePath)
	// 在 data 文件夹下搜索，主要是 data/assets 文件夹
	p := filepath.Join(util.DataDir, relativePath)
	if gulu.File.IsExist(p) {
		if !gulu.File.IsSubPath(util.WorkspaceDir, p) {
			return "", fmt.Errorf("[%s] is not sub path of workspace", p)
		}
		// 解析符号链接，验证真实路径仍在 data/assets/ 下
		if realP, evalErr := filepath.EvalSymlinks(p); evalErr == nil && realP != p {
			assetsRoot := util.GetDataAssetsAbsPath()
			realAssetsRoot, rootEvalErr := filepath.EvalSymlinks(assetsRoot)
			if rootEvalErr != nil {
				return "", fmt.Errorf("resolve assets root [%s] failed: %w", assetsRoot, rootEvalErr)
			}
			if !gulu.File.IsSubPath(realAssetsRoot, realP) {
				return "", fmt.Errorf("symlink [%s] resolves outside data/assets: [%s]", p, realP)
			}
			// 安全校验使用解析后的路径，返回原路径以便下游与 DataDir 保持同一路径形式
			return p, nil
		}
		return p, nil
	}

	// 在文档同级 assets 文件夹下搜索
	if !strings.HasPrefix(relativePath, "assets/") {
		return "", nil
	}
	notebooks, err := ListNotebooks()
	if err != nil {
		return "", errors.New(Conf.Language(0))
	}
	for _, notebook := range notebooks {
		if !includeEncrypted && IsEncryptedBox(notebook.ID) {
			continue // 加密笔记本的资源不参与全局路径解析（孤岛，资源不跨边界）
		}
		notebookAbsPath := filepath.Join(util.DataDir, notebook.ID)
		filelock.Walk(notebookAbsPath, func(path string, d fs.DirEntry, err error) error {
			if isSkipFile(d.Name()) {
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if p := filepath.ToSlash(path); strings.HasSuffix(p, relativePath) {
				if gulu.File.IsExist(path) {
					absPath = path
					return fs.SkipAll
				}
			}
			return nil
		})

		if "" != absPath {
			if !gulu.File.IsSubPath(util.WorkspaceDir, absPath) {
				return "", fmt.Errorf("[%s] is not sub path of workspace", absPath)
			}
			return absPath, nil
		}
	}
	return "", nil
}

func UploadAssets2Cloud(id string, ignorePushMsg bool) (count int, err error) {
	if !IsSubscriber() {
		return
	}

	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		err = ErrBlockNotFound
		return
	}

	nodes := []*ast.Node{node}
	if ast.NodeHeading == node.Type {
		nodes = append(nodes, treenode.HeadingChildren(node)...)
	}

	var assets []string
	for _, n := range nodes {
		assets = append(assets, getAssetsLinkDests(n, false)...)
		assets = append(assets, getQueryEmbedNodesAssetsLinkDests(n)...)
	}
	assets = gulu.Str.RemoveDuplicatedElem(assets)
	count, err = uploadAssets2Cloud(assets, bizTypeUploadAssets, ignorePushMsg)
	if err != nil {
		return
	}
	return
}

func UploadAssets2CloudByAssetsPaths(assetPaths []string, ignorePushMsg bool) (count int, err error) {
	if !IsSubscriber() {
		return
	}

	count, err = uploadAssets2Cloud(assetPaths, bizTypeUploadAssets, ignorePushMsg)
	return
}

const (
	bizTypeUploadAssets  = "upload-assets"
	bizTypeExport2Liandi = "export-liandi"
)

// uploadAssets2Cloud 将资源文件上传到云端图床。
func uploadAssets2Cloud(assetPaths []string, bizType string, ignorePushMsg bool) (count int, err error) {
	var uploadAbsAssets []string
	for _, assetPath := range assetPaths {
		var absPath string
		absPath, err = GetAssetAbsPath(assetPath)
		if err != nil {
			logging.LogWarnf("get asset [%s] abs path failed: %s", assetPath, err)
			return
		}
		if "" == absPath {
			logging.LogErrorf("not found asset [%s]", assetPath)
			continue
		}

		uploadAbsAssets = append(uploadAbsAssets, absPath)
	}

	uploadAbsAssets = gulu.Str.RemoveDuplicatedElem(uploadAbsAssets)
	if 1 > len(uploadAbsAssets) {
		return
	}

	logging.LogInfof("uploading [%d] assets", len(uploadAbsAssets))

	var msgId string
	if !ignorePushMsg {
		msgId = util.PushMsg(fmt.Sprintf(Conf.Language(27), len(uploadAbsAssets)), 3000)
	}
	if loadErr := LoadUploadToken(); nil != loadErr {
		util.PushMsg(loadErr.Error(), 5000)
		return
	}

	limitSize := uint64(3 * 1024 * 1024) // 3MB
	if IsSubscriber() {
		limitSize = 10 * 1024 * 1024 // 10MB
	}

	// metaType 为服务端 Filemeta.FILEMETA_TYPE，这里只有两个值：
	//
	//	5: SiYuan，表示为 SiYuan 上传图床
	//	4: Client，表示作为客户端分享发布帖子时上传的文件
	var metaType = "5"
	if bizTypeUploadAssets == bizType {
		metaType = "5"
	} else if bizTypeExport2Liandi == bizType {
		metaType = "4"
	}

	pushErrMsgCount := 0
	var completedUploadAssets []string
	for _, absAsset := range uploadAbsAssets {
		fi, statErr := os.Stat(absAsset)
		if nil != statErr {
			logging.LogErrorf("stat file [%s] failed: %s", absAsset, statErr)
			return count, statErr
		}

		if limitSize < uint64(fi.Size()) {
			logging.LogWarnf("file [%s] larger than limit size [%s], ignore uploading it", absAsset, humanize.IBytes(limitSize))
			if 3 > pushErrMsgCount {
				msg := fmt.Sprintf(Conf.Language(247), filepath.Base(absAsset), humanize.IBytes(limitSize))
				util.PushErrMsg(msg, 30000)
			}
			pushErrMsgCount++
			continue
		}

		if !ignorePushMsg {
			msg := fmt.Sprintf(Conf.Language(27), html.EscapeString(absAsset))
			util.PushStatusBar(msg)
			util.PushUpdateMsg(msgId, msg, 3000)
		}

		requestResult := gulu.Ret.NewResult()
		request := httpclient.NewCloudFileRequest2m()
		resp, reqErr := request.
			SetSuccessResult(requestResult).
			SetFile("file[]", absAsset).
			SetCookies(&http.Cookie{Name: "symphony", Value: uploadToken}).
			SetHeader("meta-type", metaType).
			SetHeader("biz-type", bizType).
			Post(util.GetCloudServer() + "/apis/siyuan/upload?ver=" + util.Ver)
		if nil != reqErr {
			logging.LogErrorf("upload assets failed: %s", reqErr)
			return count, ErrFailedToConnectCloudServer
		}

		if 401 == resp.StatusCode {
			err = errors.New(Conf.Language(31))
			return
		}

		if 0 != requestResult.Code {
			logging.LogErrorf("upload assets failed: %s", requestResult.Msg)
			err = fmt.Errorf(Conf.Language(94), requestResult.Msg)
			return
		}

		absAsset = filepath.ToSlash(absAsset)
		relAsset := absAsset[strings.Index(absAsset, "assets/"):]
		completedUploadAssets = append(completedUploadAssets, relAsset)
		logging.LogInfof("uploaded asset [%s]", relAsset)
		count++
	}

	if !ignorePushMsg {
		util.PushClearMsg(msgId)
	}

	if 0 < len(completedUploadAssets) {
		logging.LogInfof("uploaded [%d] assets", len(completedUploadAssets))
	}
	return
}

func RemoveUnusedAssets() (ret []string) {
	ret = []string{}
	var size int64

	msgId := util.PushMsg(Conf.Language(100), 30*1000)
	defer func() {
		msg := fmt.Sprintf(Conf.Language(91), len(ret), humanize.BytesCustomCeil(uint64(size), 2))
		util.PushUpdateMsg(msgId, msg, 7000)
	}()

	unusedAssets := UnusedAssets(false)

	historyDir, err := getHistoryDir(HistoryOpClean)
	if err != nil {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}

	var hashes []string
	for _, unusedAsset := range unusedAssets {
		p := unusedAsset.Item
		historyPath := filepath.Join(historyDir, p)
		if p = filepath.Join(util.DataDir, p); filelock.IsExist(p) {
			if filelock.IsHidden(p) {
				continue
			}

			if err = filelock.Copy(p, historyPath); err != nil {
				return
			}

			hash, _ := util.GetEtag(p)
			hashes = append(hashes, hash)
			cache.RemoveAssetHash(hash)
		}
	}

	sql.BatchRemoveAssetsQueue(hashes)

	for _, unusedAsset := range unusedAssets {
		p := unusedAsset.Item
		absPath := filepath.Join(util.DataDir, p)
		if filelock.IsExist(absPath) {
			info, statErr := os.Stat(absPath)
			if statErr == nil {
				if info.IsDir() {
					dirSize, _ := util.SizeOfDirectory(absPath)
					size += dirSize
				} else {
					size += info.Size()
				}
			}

			if util.IsMobileContainer() {
				HandleAssetsRemoveEvent(absPath)
			}

			if removeErr := filelock.RemoveWithoutFatal(absPath); removeErr != nil {
				logging.LogErrorf("remove unused asset [%s] failed: %s", absPath, removeErr)
				util.PushErrMsg(fmt.Sprintf("%s", removeErr), 7000)
				return
			}

			util.RemoveAssetText(p)
		}
		ret = append(ret, absPath)
	}
	if 0 < len(ret) {
		IncSync()
	}

	indexHistoryDir(filepath.Base(historyDir), util.NewLute())
	cache.LoadAssets()
	return
}

func RemoveUnusedAsset(p string) (ret string) {
	absPath := filepath.Join(util.DataDir, p)
	if !filelock.IsExist(absPath) {
		return absPath
	}

	// 加密笔记本的资源不参与未引用清理（与批量版 RemoveUnusedAssets 经 UnusedAssets 的排除一致），
	// 否则未解锁时 admin 可删加密 box 的资源，破坏可用性且留下悬空的文件名映射。
	if IsEncryptedAssetPath(absPath) {
		return absPath
	}

	historyDir, err := getHistoryDir(HistoryOpClean)
	if err != nil {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}

	newP := strings.TrimPrefix(absPath, util.DataDir)
	historyPath := filepath.Join(historyDir, newP)
	if filelock.IsExist(absPath) {
		if err = filelock.Copy(absPath, historyPath); err != nil {
			return
		}

		hash, _ := util.GetEtag(absPath)
		sql.BatchRemoveAssetsQueue([]string{hash})
		cache.RemoveAssetHash(hash)
	}

	if util.IsMobileContainer() {
		HandleAssetsRemoveEvent(absPath)
	}

	if err = filelock.RemoveWithoutFatal(absPath); err != nil {
		logging.LogErrorf("remove unused asset [%s] failed: %s", absPath, err)
		util.PushErrMsg(fmt.Sprintf("%s", err), 7000)
		return
	}
	ret = absPath

	util.RemoveAssetText(p)

	IncSync()

	indexHistoryDir(filepath.Base(historyDir), util.NewLute())
	cache.RemoveAsset(p)
	return
}

func RenameAsset(oldPath, newName string) (newPath string, err error) {
	util.PushEndlessProgress(Conf.Language(110))
	defer util.PushClearProgress()

	oldCleanPath := AssetPathWithoutQuery(oldPath)

	// 加密笔记本的资源文件名已脱敏，重命名会破坏映射关系，禁止
	if absPath, absErr := GetAssetAbsPathInBox(oldPath, ""); absErr == nil {
		if IsEncryptedAssetPath(absPath) {
			err = errors.New("renaming assets in encrypted notebooks is not supported")
			return
		}
	}

	newName = strings.TrimSpace(newName)
	newName = util.FilterUploadFileName(newName)
	if path.Base(oldCleanPath) == newName {
		return
	}
	if "" == newName {
		return
	}

	if !gulu.File.IsValidFilename(newName) {
		err = errors.New(Conf.Language(151))
		return
	}

	newName = util.AssetName(newName+filepath.Ext(oldCleanPath), ast.NewNodeID())
	parentDir := path.Dir(oldCleanPath)
	newPath = path.Join(parentDir, newName)
	oldAbsPath, getErr := GetAssetAbsPathInBox(oldPath, "")
	if getErr != nil {
		logging.LogErrorf("get asset [%s] abs path failed: %s", oldPath, getErr)
		return
	}
	newAbsPath := filepath.Join(filepath.Dir(oldAbsPath), newName)
	filelock.Lock(oldAbsPath)
	if err = os.Rename(oldAbsPath, newAbsPath); err != nil {
		if err = gulu.File.Copy(oldAbsPath, newAbsPath); err != nil {
			filelock.Unlock(oldAbsPath)
			logging.LogErrorf("copy asset [%s] failed: %s", oldAbsPath, err)
			return
		}
	}
	filelock.Unlock(oldAbsPath)

	oldSya := filepath.Join(util.DataDir, oldPath+".sya")
	filelock.Lock(oldSya)
	if gulu.File.IsExist(oldSya) {
		// Rename the .sya annotation file when renaming a PDF asset https://github.com/siyuan-note/siyuan/issues/9390
		newSya := filepath.Join(util.DataDir, newPath+".sya")
		if err = os.Rename(oldSya, newSya); err != nil {
			if err = gulu.File.Copy(oldSya, newSya); err != nil {
				filelock.Unlock(oldSya)
				logging.LogErrorf("copy PDF annotation [%s] failed: %s", oldPath+".sya", err)
				return
			}
		}
	}
	filelock.Unlock(oldSya)

	oldName := path.Base(oldPath)

	notebooks, err := ListNotebooks()
	if err != nil {
		return
	}

	historyDir, err := getHistoryDir(HistoryOpReplace)
	if nil != err {
		return
	}

	luteEngine := util.NewLute()
	for _, notebook := range notebooks {
		// 加密笔记本的资源重命名已在入口处拦截，这里跳过加密 box
		if IsEncryptedBox(notebook.ID) {
			continue
		}
		pages := pagedPaths(filepath.Join(util.DataDir, notebook.ID), 32)

		for _, paths := range pages {
			for _, treeAbsPath := range paths {
				data, readErr := filelock.ReadFile(treeAbsPath)
				if nil != readErr {
					logging.LogErrorf("get data [path=%s] failed: %s", treeAbsPath, readErr)
					err = readErr
					return
				}

				if !bytes.Contains(data, []byte(oldName)) {
					continue
				}

				data = bytes.Replace(data, []byte(oldName), []byte(newName), -1)
				if writeErr := filelock.WriteFile(treeAbsPath, data); nil != writeErr {
					logging.LogErrorf("write data [path=%s] failed: %s", treeAbsPath, writeErr)
					err = writeErr
					return
				}

				cache.RemoveTreeData(util.GetTreeID(treeAbsPath))
				p := filepath.ToSlash(strings.TrimPrefix(treeAbsPath, filepath.Join(util.DataDir, notebook.ID)))
				tree, parseErr := filesys.LoadTreeByData(data, notebook.ID, p, luteEngine)
				if nil != parseErr {
					logging.LogWarnf("parse json to tree [%s] failed: %s", treeAbsPath, parseErr)
					continue
				}

				generateTreeHistory(tree, historyDir)
				treenode.UpsertBlockTree(tree)
				sql.UpsertTreeQueue(tree)

				util.PushEndlessProgress(fmt.Sprintf(Conf.Language(111), util.EscapeHTML(tree.Root.IALAttr("title"))))
			}
		}
	}
	indexHistoryDir(filepath.Base(historyDir), util.NewLute())

	storageAvDir := filepath.Join(util.DataDir, "storage", "av")
	if gulu.File.IsDir(storageAvDir) {
		entries, readErr := os.ReadDir(storageAvDir)
		if nil != readErr {
			logging.LogErrorf("read dir [%s] failed: %s", storageAvDir, readErr)
			err = readErr
			return
		}

		for _, entry := range entries {
			if !strings.HasSuffix(entry.Name(), ".json") || !ast.IsNodeIDPattern(strings.TrimSuffix(entry.Name(), ".json")) {
				continue
			}

			data, readDataErr := filelock.ReadFile(filepath.Join(util.DataDir, "storage", "av", entry.Name()))
			if nil != readDataErr {
				logging.LogErrorf("read file [%s] failed: %s", entry.Name(), readDataErr)
				err = readDataErr
				return
			}

			if bytes.Contains(data, []byte(oldPath)) {
				data = bytes.ReplaceAll(data, []byte(oldPath), []byte(newPath))
				if writeDataErr := filelock.WriteFile(filepath.Join(util.DataDir, "storage", "av", entry.Name()), data); nil != writeDataErr {
					logging.LogErrorf("write file [%s] failed: %s", entry.Name(), writeDataErr)
					err = writeDataErr
					return
				}
			}

			util.PushEndlessProgress(fmt.Sprintf(Conf.Language(111), util.EscapeHTML(entry.Name())))
		}
	}

	if ocrText := util.GetAssetText(oldPath); "" != ocrText {
		// 图片重命名后 ocr-texts.json 需要更新 https://github.com/siyuan-note/siyuan/issues/12974
		util.SetAssetText(newPath, ocrText)
	}

	IncSync()
	return
}

type UnusedItem struct {
	Item     string    `json:"item"`
	Name     string    `json:"name"`
	BlockIDs []string  `json:"blockIDs,omitempty"`
	ModTime  time.Time `json:"-"`
}

func UnusedAssets(sorted bool) (ret []*UnusedItem) {
	defer logging.Recover()
	ret = []*UnusedItem{}

	assetsPathMap, err := allAssetAbsPaths()
	if err != nil {
		return
	}
	// 排除加密笔记本的资源：加密笔记本锁定时 loadTree 失败会误判引用关系，
	// 且加密笔记本是孤岛，资源不参与全局未引用清理
	for dest, absPath := range assetsPathMap {
		if boxID := ExtractBoxIDFromAssetsPath(absPath); boxID != "" && IsEncryptedBox(boxID) {
			delete(assetsPathMap, dest)
		}
	}
	linkDestMap := map[string]bool{}
	notebooks, err := ListNotebooks()
	if err != nil {
		return
	}
	luteEngine := util.NewLute()
	for _, notebook := range notebooks {
		if IsEncryptedBox(notebook.ID) {
			continue // 加密笔记本的资源不参与未引用清理（孤岛，资源不跨边界）
		}
		dests := map[string]bool{}

		// 分页加载，优化清理未引用资源内存占用 https://github.com/siyuan-note/siyuan/issues/5200
		pages := pagedPaths(filepath.Join(util.DataDir, notebook.ID), 32)
		for _, paths := range pages {
			var trees []*parse.Tree
			for _, localPath := range paths {
				tree, loadTreeErr := loadTree(localPath, luteEngine)
				if nil != loadTreeErr {
					continue
				}
				trees = append(trees, tree)
			}
			for _, tree := range trees {
				for _, d := range getAssetsLinkDests(tree.Root, false) {
					dests[d] = true
				}

				if titleImgPath := treenode.GetDocTitleImgPath(tree.Root); "" != titleImgPath {
					// 题头图计入
					if !util.IsAssetLinkDest([]byte(titleImgPath), false) {
						continue
					}
					dests[titleImgPath] = true
				}
			}
		}

		var linkDestFolderPaths, linkDestFilePaths []string
		for dest := range dests {
			if !strings.HasPrefix(dest, "assets/") {
				continue
			}

			if idx := strings.Index(dest, "?"); 0 < idx {
				// `pdf?page` 资源文件链接会被判定为未引用资源 https://github.com/siyuan-note/siyuan/issues/5649
				dest = dest[:idx]
			}

			if "" == assetsPathMap[dest] {
				continue
			}
			if strings.HasSuffix(dest, "/") {
				linkDestFolderPaths = append(linkDestFolderPaths, dest)
			} else {
				linkDestFilePaths = append(linkDestFilePaths, dest)
			}
		}

		// 排除文件夹链接
		var toRemoves []string
		for asset := range assetsPathMap {
			for _, linkDestFolder := range linkDestFolderPaths {
				if strings.HasPrefix(asset, linkDestFolder) {
					toRemoves = append(toRemoves, asset)
				}
			}
			for _, linkDestPath := range linkDestFilePaths {
				if strings.HasPrefix(linkDestPath, asset) {
					toRemoves = append(toRemoves, asset)
				}
			}
		}
		for _, toRemove := range toRemoves {
			delete(assetsPathMap, toRemove)
		}

		for _, dest := range linkDestFilePaths {
			linkDestMap[dest] = true

			if strings.HasSuffix(dest, ".pdf") {
				linkDestMap[dest+".sya"] = true
			}
		}
	}

	var toRemoves []string
	for asset := range assetsPathMap {
		if strings.HasSuffix(asset, "ocr-texts.json") {
			// 排除 OCR 结果文本
			toRemoves = append(toRemoves, asset)
			continue
		}

		if strings.HasSuffix(asset, "android-notification-texts.txt") {
			// 排除 Android 通知文本
			toRemoves = append(toRemoves, asset)
			continue
		}
	}

	// 排除数据库中引用的资源文件。加密笔记本的资源不参与未引用清理（孤岛，资源不跨边界）
	storageAvDir := filepath.Join(util.DataDir, "storage", "av")
	if gulu.File.IsDir(storageAvDir) {
		entries, readErr := os.ReadDir(storageAvDir)
		if nil != readErr {
			logging.LogErrorf("read dir [%s] failed: %s", storageAvDir, readErr)
			err = readErr
			return
		}

		for _, entry := range entries {
			if !strings.HasSuffix(entry.Name(), ".json") || !ast.IsNodeIDPattern(strings.TrimSuffix(entry.Name(), ".json")) {
				continue
			}

			data, readDataErr := filelock.ReadFile(filepath.Join(util.DataDir, "storage", "av", entry.Name()))
			if nil != readDataErr {
				logging.LogErrorf("read file [%s] failed: %s", entry.Name(), readDataErr)
				err = readDataErr
				return
			}

			for asset := range assetsPathMap {
				if bytes.Contains(data, []byte(asset)) {
					toRemoves = append(toRemoves, asset)
				}
			}
		}
	}

	for _, toRemove := range toRemoves {
		delete(assetsPathMap, toRemove)
	}

	dataAssetsAbsPath := util.GetDataAssetsAbsPath()
	for dest, assetAbsPath := range assetsPathMap {
		if _, ok := linkDestMap[dest]; ok {
			continue
		}

		var p string
		if strings.HasPrefix(dataAssetsAbsPath, assetAbsPath) {
			p = assetAbsPath[strings.Index(assetAbsPath, "assets"):]
		} else {
			p = strings.TrimPrefix(assetAbsPath, filepath.Dir(dataAssetsAbsPath))
		}
		p = strings.TrimPrefix(filepath.ToSlash(p), "/")
		name := path.Base(p)

		var modTime time.Time
		if sorted {
			if info, statErr := os.Stat(assetAbsPath); nil == statErr {
				modTime = info.ModTime()
			}
		}

		ret = append(ret, &UnusedItem{Item: p, Name: name, ModTime: modTime})
	}

	if sorted {
		sort.Slice(ret, func(i, j int) bool {
			if !ret[i].ModTime.Equal(ret[j].ModTime) {
				return ret[i].ModTime.After(ret[j].ModTime)
			}
			return ret[i].Item > ret[j].Item
		})
	}
	return
}

func MissingAssets() (ret []*UnusedItem) {
	defer logging.Recover()
	ret = []*UnusedItem{}

	assetsPathMap, err := allAssetAbsPaths()
	if err != nil {
		return
	}
	notebooks, err := ListNotebooks()
	if err != nil {
		return
	}
	luteEngine := util.NewLute()
	destBlockIDs := map[string]map[string]bool{}
	for _, notebook := range notebooks {
		if notebook.Closed {
			continue
		}

		pages := pagedPaths(filepath.Join(util.DataDir, notebook.ID), 32)
		for _, paths := range pages {
			var trees []*parse.Tree
			for _, localPath := range paths {
				tree, loadTreeErr := loadTree(localPath, luteEngine)
				if nil != loadTreeErr {
					continue
				}
				trees = append(trees, tree)
			}
			for _, tree := range trees {
				ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
					if !entering {
						return ast.WalkContinue
					}

					blockID := assetLinkDestBlockID(n)
					for _, dest := range getAssetLinkDestsByNode(n, false) {
						addAssetLinkDestBlockID(destBlockIDs, dest, blockID)
					}
					return ast.WalkContinue
				})

				if titleImgPath := treenode.GetDocTitleImgPath(tree.Root); "" != titleImgPath {
					// 题头图计入
					if !util.IsAssetLinkDest([]byte(titleImgPath), false) {
						continue
					}
					addAssetLinkDestBlockID(destBlockIDs, titleImgPath, tree.Root.ID)
				}
			}
		}
	}

	for dest, blockIDSet := range destBlockIDs {
		if "" == assetsPathMap[dest] {
			if strings.HasPrefix(dest, "assets/.") {
				// Assets starting with `.` should not be considered missing assets https://github.com/siyuan-note/siyuan/issues/8821
				if filelock.IsExist(filepath.Join(util.DataDir, dest)) {
					continue
				}
			}

			blockIDs := make([]string, 0, len(blockIDSet))
			for blockID := range blockIDSet {
				blockIDs = append(blockIDs, blockID)
			}
			sort.Strings(blockIDs)
			ret = append(ret, &UnusedItem{Item: dest, Name: path.Base(dest), BlockIDs: blockIDs})
		}
	}
	sort.Slice(ret, func(i, j int) bool {
		return ret[i].Item < ret[j].Item
	})
	return
}

func addAssetLinkDestBlockID(destBlockIDs map[string]map[string]bool, dest, blockID string) {
	dest = normalizeMissingAssetLinkDest(dest)
	if "" == dest {
		return
	}

	blockIDs := destBlockIDs[dest]
	if nil == blockIDs {
		blockIDs = map[string]bool{}
		destBlockIDs[dest] = blockIDs
	}
	if "" != blockID {
		blockIDs[blockID] = true
	}
}

func normalizeMissingAssetLinkDest(dest string) string {
	dest = strings.TrimSpace(dest)
	if !strings.HasPrefix(dest, "assets/") {
		return ""
	}
	if idx := strings.Index(dest, "?"); 0 < idx {
		dest = dest[:idx]
	}
	if strings.HasSuffix(dest, "/") || strings.HasSuffix(dest, ".rtfd") {
		return ""
	}
	if strings.Contains(strings.ToLower(dest), ".pdf/") {
		if idx := strings.LastIndex(dest, "/"); -1 < idx && ast.IsNodeIDPattern(dest[idx+1:]) {
			// PDF 标注不计入 https://github.com/siyuan-note/siyuan/issues/13891
			return ""
		}
	}
	return dest
}

func assetLinkDestBlockID(node *ast.Node) string {
	if node.IsBlock() && "" != node.ID {
		return node.ID
	}
	if block := treenode.ParentBlock(node); nil != block {
		return block.ID
	}
	return ""
}

func getAssetLinkDestsByNode(node *ast.Node, includeServePath bool) []string {
	if !node.IsBlock() && ast.NodeLinkDest != node.Type && ast.NodeHTMLBlock != node.Type && ast.NodeInlineHTML != node.Type &&
		ast.NodeIFrame != node.Type && ast.NodeWidget != node.Type && ast.NodeAudio != node.Type && ast.NodeVideo != node.Type &&
		ast.NodeAttributeView != node.Type && !node.IsTextMarkType("a") && !node.IsTextMarkType("file-annotation-ref") {
		return nil
	}

	// 复用统一的资源链接提取逻辑，但仅处理当前节点，避免重复遍历子树。
	nodeCopy := *node
	nodeCopy.Parent = nil
	nodeCopy.Previous = nil
	nodeCopy.Next = nil
	nodeCopy.FirstChild = nil
	nodeCopy.LastChild = nil
	return getAssetsLinkDests(&nodeCopy, includeServePath)
}

func emojisInTree(tree *parse.Tree) (ret []string) {
	if icon := tree.Root.IALAttr("icon"); "" != icon {
		if !strings.Contains(icon, "://") && !strings.HasPrefix(icon, "api/icon/") && !util.NativeEmojiChars[icon] {
			ret = append(ret, "/emojis/"+icon)
		}
	}

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if ast.NodeEmojiImg == n.Type {
			tokens := n.Tokens
			_, src, found := bytes.Cut(tokens, []byte("src=\""))
			if !found {
				return ast.WalkContinue
			}
			idx := bytes.Index(src, []byte("\""))
			if idx == -1 {
				return ast.WalkContinue
			}
			src = src[:idx]
			ret = append(ret, string(src))
		}
		return ast.WalkContinue
	})
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func getQueryEmbedNodesAssetsLinkDests(node *ast.Node) (ret []string) {
	// The images in the embed blocks are not uploaded to the community hosting https://github.com/siyuan-note/siyuan/issues/10042

	ret = []string{}
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeBlockQueryEmbedScript != n.Type {
			return ast.WalkContinue
		}

		stmt := n.TokensStr()
		stmt = html.UnescapeString(stmt)
		stmt = strings.ReplaceAll(stmt, editor.IALValEscNewLine, "\n")
		sqlBlocks := sql.SelectBlocksRawStmt(stmt, 1, Conf.Search.Limit)
		for _, sqlBlock := range sqlBlocks {
			subtree, _ := LoadTreeByBlockID(sqlBlock.ID)
			if nil == subtree {
				continue
			}
			embedNode := treenode.GetNodeInTree(subtree, sqlBlock.ID)
			if nil == embedNode {
				continue
			}

			ret = append(ret, getAssetsLinkDests(embedNode, false)...)
		}
		return ast.WalkContinue
	})
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func getAssetsLinkDests(node *ast.Node, includeServePath bool) (ret []string) {
	ret = []string{}
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if n.IsBlock() {
			// 以 custom-data-assets 开头的块属性值可能是多个资源文件链接，需要计入
			// Ignore assets associated with the `custom-data-assets` block attribute when cleaning unreferenced assets https://github.com/siyuan-note/siyuan/issues/12574
			for _, kv := range n.KramdownIAL {
				k := kv[0]
				if strings.HasPrefix(k, "custom-data-assets") {
					dest := kv[1]
					if "" == dest || !util.IsAssetLinkDest([]byte(dest), includeServePath) {
						continue
					}
					ret = append(ret, dest)
				}
			}
		}

		// 修改以下代码时需要同时修改 database 构造行级元素实现，增加必要的类型
		if !entering || (ast.NodeLinkDest != n.Type && ast.NodeHTMLBlock != n.Type && ast.NodeInlineHTML != n.Type &&
			ast.NodeIFrame != n.Type && ast.NodeWidget != n.Type && ast.NodeAudio != n.Type && ast.NodeVideo != n.Type &&
			ast.NodeAttributeView != n.Type && !n.IsTextMarkType("a") && !n.IsTextMarkType("file-annotation-ref")) {
			return ast.WalkContinue
		}

		if ast.NodeLinkDest == n.Type {
			if !util.IsAssetLinkDest(n.Tokens, includeServePath) {
				return ast.WalkContinue
			}

			dest := strings.TrimSpace(string(n.Tokens))
			ret = append(ret, dest)
		} else if n.IsTextMarkType("a") {
			if !util.IsAssetLinkDest(gulu.Str.ToBytes(n.TextMarkAHref), includeServePath) {
				return ast.WalkContinue
			}

			dest := strings.TrimSpace(n.TextMarkAHref)
			ret = append(ret, dest)
		} else if n.IsTextMarkType("file-annotation-ref") {
			if !util.IsAssetLinkDest(gulu.Str.ToBytes(n.TextMarkFileAnnotationRefID), includeServePath) {
				return ast.WalkContinue
			}

			if !strings.Contains(n.TextMarkFileAnnotationRefID, "/") {
				return ast.WalkContinue
			}

			dest := n.TextMarkFileAnnotationRefID[:strings.LastIndexByte(n.TextMarkFileAnnotationRefID, '/')]
			dest = strings.TrimSpace(dest)
			ret = append(ret, dest)
		} else if ast.NodeAttributeView == n.Type {
			attrView, _ := av.ParseAttributeView(n.AttributeViewID)
			if nil == attrView {
				return ast.WalkContinue
			}

			for _, keyValues := range attrView.KeyValues {
				if av.KeyTypeMAsset == keyValues.Key.Type {
					for _, value := range keyValues.Values {
						if 1 > len(value.MAsset) {
							continue
						}

						for _, asset := range value.MAsset {
							dest := asset.Content
							if !util.IsAssetLinkDest([]byte(dest), includeServePath) {
								continue
							}
							ret = append(ret, strings.TrimSpace(dest))
						}
					}
				} else if av.KeyTypeURL == keyValues.Key.Type {
					for _, value := range keyValues.Values {
						if nil != value.URL {
							dest := value.URL.Content
							if !util.IsAssetLinkDest([]byte(dest), includeServePath) {
								continue
							}
							ret = append(ret, strings.TrimSpace(dest))
						}
					}
				}
			}
		} else {
			if ast.NodeWidget == n.Type {
				dataAssets := n.IALAttr("custom-data-assets")
				if "" == dataAssets {
					// 兼容两种属性名 custom-data-assets 和 data-assets https://github.com/siyuan-note/siyuan/issues/4122#issuecomment-1154796568
					dataAssets = n.IALAttr("data-assets")
				}
				if !util.IsAssetLinkDest([]byte(dataAssets), includeServePath) {
					return ast.WalkContinue
				}
				ret = append(ret, dataAssets)
			} else { // HTMLBlock/InlineHTML/IFrame/Audio/Video
				dest := treenode.GetNodeSrcTokens(n)
				if !util.IsAssetLinkDest([]byte(dest), includeServePath) {
					return ast.WalkContinue
				}
				ret = append(ret, dest)
			}
		}
		return ast.WalkContinue
	})
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	for i, dest := range ret {
		// 对于 macOS 的 rtfd 文件夹格式需要特殊处理，为其加上结尾 /
		if strings.HasSuffix(dest, ".rtfd") {
			ret[i] = dest + "/"
		}
	}
	return
}

func getAssetsLinkDestsInTree(tree *parse.Tree, includeServePath bool) (nodes []*ast.Node) {
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		dests := getAssetsLinkDests(n, includeServePath)
		if 1 > len(dests) {
			return ast.WalkContinue
		}

		nodes = append(nodes, n)
		return ast.WalkContinue
	})
	return
}

func setAssetsLinkDest(node *ast.Node, oldDest, dest string) {
	if ast.NodeLinkDest == node.Type {
		if bytes.HasPrefix(node.Tokens, []byte("//")) {
			node.Tokens = append([]byte("https:"), node.Tokens...)
		}
		node.Tokens = bytes.ReplaceAll(node.Tokens, []byte(oldDest), []byte(dest))
	} else if node.IsTextMarkType("a") {
		if strings.HasPrefix(node.TextMarkAHref, "//") {
			node.TextMarkAHref = "https:" + node.TextMarkAHref
		}
		node.TextMarkAHref = strings.ReplaceAll(node.TextMarkAHref, oldDest, dest)
	} else if ast.NodeAudio == node.Type || ast.NodeVideo == node.Type {
		if strings.HasPrefix(node.TextMarkAHref, "//") {
			node.TextMarkAHref = "https:" + node.TextMarkAHref
		}
		node.Tokens = bytes.ReplaceAll(node.Tokens, []byte(oldDest), []byte(dest))
	} else if ast.NodeAttributeView == node.Type {
		needWrite := false
		attrView, _ := av.ParseAttributeView(node.AttributeViewID)
		if nil == attrView {
			return
		}

		for _, keyValues := range attrView.KeyValues {
			if av.KeyTypeMAsset != keyValues.Key.Type {
				continue
			}

			for _, value := range keyValues.Values {
				if 1 > len(value.MAsset) {
					continue
				}

				for _, asset := range value.MAsset {
					if oldDest == asset.Content && oldDest != dest {
						asset.Content = dest
						needWrite = true
					}
				}
			}
		}

		if needWrite {
			av.SaveAttributeView(attrView)
		}
	}
}

func getRemoteAssetsLinkDests(node *ast.Node, onlyImg bool) (ret []string) {
	if onlyImg {
		if ast.NodeLinkDest == node.Type {
			if node.ParentIs(ast.NodeImage) {
				if !util.IsAssetLinkDest(node.Tokens, false) {
					ret = append(ret, string(node.Tokens))
				}

			}
		} else if ast.NodeAttributeView == node.Type {
			attrView, _ := av.ParseAttributeView(node.AttributeViewID)
			if nil == attrView {
				return
			}

			for _, keyValues := range attrView.KeyValues {
				if av.KeyTypeMAsset != keyValues.Key.Type {
					continue
				}

				for _, value := range keyValues.Values {
					if 1 > len(value.MAsset) {
						continue
					}

					for _, asset := range value.MAsset {
						if av.AssetTypeImage != asset.Type {
							continue
						}

						dest := asset.Content
						if !util.IsAssetLinkDest([]byte(dest), false) {
							ret = append(ret, strings.TrimSpace(dest))
						}
					}
				}
			}
		}
	} else {
		if ast.NodeLinkDest == node.Type {
			if !util.IsAssetLinkDest(node.Tokens, false) {
				ret = append(ret, string(node.Tokens))
			}
		} else if node.IsTextMarkType("a") {
			if !util.IsAssetLinkDest([]byte(node.TextMarkAHref), false) {
				ret = append(ret, node.TextMarkAHref)
			}
		} else if ast.NodeAudio == node.Type || ast.NodeVideo == node.Type {
			src := treenode.GetNodeSrcTokens(node)
			if !util.IsAssetLinkDest([]byte(src), false) {
				ret = append(ret, src)
			}
		} else if ast.NodeAttributeView == node.Type {
			attrView, _ := av.ParseAttributeView(node.AttributeViewID)
			if nil == attrView {
				return
			}

			for _, keyValues := range attrView.KeyValues {
				if av.KeyTypeMAsset != keyValues.Key.Type {
					continue
				}

				for _, value := range keyValues.Values {
					if 1 > len(value.MAsset) {
						continue
					}

					for _, asset := range value.MAsset {
						dest := asset.Content
						if !util.IsAssetLinkDest([]byte(dest), false) {
							ret = append(ret, strings.TrimSpace(dest))
						}
					}
				}
			}
		}
	}
	return
}

func getRemoteAssetsLinkDestsInTree(tree *parse.Tree, onlyImg bool) (nodes []*ast.Node) {
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		dests := getRemoteAssetsLinkDests(n, onlyImg)
		if 1 > len(dests) {
			return ast.WalkContinue
		}

		nodes = append(nodes, n)
		return ast.WalkContinue
	})
	return
}

// allAssetAbsPaths 返回 asset 相对路径（assets/xxx）到绝对路径（F:\SiYuan\data\assets\xxx）的映射。
func allAssetAbsPaths() (assetsAbsPathMap map[string]string, err error) {
	notebooks, err := ListNotebooks()
	if err != nil {
		return
	}

	assetsAbsPathMap = map[string]string{}
	// 笔记本 assets（跳过加密 box，加密资产不参与全局去重/清理）
	for _, notebook := range notebooks {
		if IsEncryptedBox(notebook.ID) {
			continue
		}
		notebookAbsPath := filepath.Join(util.DataDir, notebook.ID)
		filelock.Walk(notebookAbsPath, func(path string, d fs.DirEntry, err error) error {
			if notebookAbsPath == path {
				return nil
			}
			if isSkipFile(d.Name()) {
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}

			if filelock.IsHidden(path) {
				// 清理资源文件时忽略隐藏文件 Ignore hidden files when cleaning unused assets https://github.com/siyuan-note/siyuan/issues/12172
				return nil
			}

			if d.IsDir() && "assets" == d.Name() {
				filelock.Walk(path, func(assetPath string, d fs.DirEntry, err error) error {
					if path == assetPath {
						return nil
					}
					if isSkipFile(d.Name()) {
						if d.IsDir() {
							return filepath.SkipDir
						}
						return nil
					}
					relPath := filepath.ToSlash(assetPath)
					relPath = relPath[strings.Index(relPath, "assets/"):]
					if d.IsDir() {
						relPath += "/"
					}
					assetsAbsPathMap[relPath] = assetPath
					return nil
				})
				return filepath.SkipDir
			}
			return nil
		})
	}

	// 全局 assets
	dataAssetsAbsPath := util.GetDataAssetsAbsPath()
	filelock.Walk(dataAssetsAbsPath, func(assetPath string, d fs.DirEntry, err error) error {
		if dataAssetsAbsPath == assetPath {
			return nil
		}

		if isSkipFile(d.Name()) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		if filelock.IsHidden(assetPath) {
			// 清理资源文件时忽略隐藏文件 Ignore hidden files when cleaning unused assets https://github.com/siyuan-note/siyuan/issues/12172
			return nil
		}

		relPath := filepath.ToSlash(assetPath)
		relPath = relPath[strings.Index(relPath, "assets/"):]
		if d.IsDir() {
			relPath += "/"
		}
		assetsAbsPathMap[relPath] = assetPath
		return nil
	})
	return
}

// copyBoxAssetsToDataAssets 将笔记本路径下所有（包括子文档）的 assets 复制一份到 data/assets 中。
func copyBoxAssetsToDataAssets(boxID string) {
	boxLocalPath := filepath.Join(util.DataDir, boxID)
	copyAssetsToDataAssets(boxLocalPath)
}

// copyDocAssetsToDataAssets 将文档路径下所有（包括子文档）的 assets 复制一份到 data/assets 中。
func copyDocAssetsToDataAssets(boxID, parentDocPath string) {
	boxLocalPath := filepath.Join(util.DataDir, boxID)
	parentDocDirAbsPath := filepath.Dir(filepath.Join(boxLocalPath, parentDocPath))
	copyAssetsToDataAssets(parentDocDirAbsPath)
}

func copyAssetsToDataAssets(rootPath string) {
	var assetsDirPaths []string
	filelock.Walk(rootPath, func(path string, d fs.DirEntry, err error) error {
		if nil != err || rootPath == path || nil == d {
			return nil
		}

		isDir, name := d.IsDir(), d.Name()
		if isSkipFile(name) {
			if isDir {
				return filepath.SkipDir
			}
			return nil
		}

		if "assets" == name && isDir {
			assetsDirPaths = append(assetsDirPaths, path)
		}
		return nil
	})

	dataAssetsPath := filepath.Join(util.DataDir, "assets")
	for _, assetsDirPath := range assetsDirPaths {
		if err := filelock.Copy(assetsDirPath, dataAssetsPath); err != nil {
			logging.LogErrorf("copy tree assets from [%s] to [%s] failed: %s", assetsDirPaths, dataAssetsPath, err)
		}
	}
}
