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
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func GetAssetImgSize(assetPath string) (width, height int) {
	absPath, err := GetAssetAbsPath(assetPath)
	if err != nil {
		logging.LogErrorf("get asset [%s] abs path failed: %s", assetPath, err)
		return
	}

	img, err := imaging.Open(absPath)
	if err != nil {
		logging.LogErrorf("open asset image [%s] failed: %s", absPath, err)
		return
	}

	width = img.Bounds().Dx()
	height = img.Bounds().Dy()
	return
}

func GetAssetPathByHash(hash string) string {
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

	if ".DS_Store" == filepath.Base(assetAbsPath) {
		return
	}

	removeIndexAssetContent(assetAbsPath)
	removeAssetThumbnail(assetAbsPath)
}

func HandleAssetsChangeEvent(assetAbsPath string) {
	if !filelock.IsExist(assetAbsPath) {
		return
	}

	if ".DS_Store" == filepath.Base(assetAbsPath) {
		return
	}

	indexAssetContent(assetAbsPath)
	removeAssetThumbnail(assetAbsPath)
}

func removeAssetThumbnail(assetAbsPath string) {
	if util.IsCompressibleAssetImage(assetAbsPath) {
		p := filepath.ToSlash(assetAbsPath)
		idx := strings.Index(p, "assets/")
		if -1 == idx {
			return
		}
		thumbnailPath := filepath.Join(util.TempDir, "thumbnails", "assets", p[idx+7:])
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

func DocAssets(rootID string) (ret []string, err error) {
	tree, err := LoadTreeByBlockID(rootID)
	if err != nil {
		return
	}

	ret = getAssetsLinkDests(tree.Root, false)
	return
}

func NetAssets2LocalAssets(rootID string, onlyImg bool, originalURL string) (err error) {
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
			if strings.HasPrefix(strings.ToLower(dest), "file://") { // 处理本地文件链接
				u := dest[7:]
				unescaped, _ := url.PathUnescape(u)
				if unescaped != u {
					// `Convert network images/assets to local` supports URL-encoded local file names https://github.com/siyuan-note/siyuan/issues/9929
					u = unescaped
				}
				if strings.Contains(u, ":") {
					u = strings.TrimPrefix(u, "/")
				}
				if strings.Contains(u, "?") {
					u = u[:strings.Index(u, "?")]
				}

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
				name = util.AssetName(name, ast.NewNodeID())
				writePath := filepath.Join(assetsDirPath, name)
				if err = filelock.Copy(u, writePath); err != nil {
					logging.LogErrorf("copy [%s] to [%s] failed: %s", u, writePath, err)
					continue
				}

				setAssetsLinkDest(destNode, dest, "assets/"+name)
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
				name = util.AssetName(name, ast.NewNodeID())
				name = "network-asset-" + name
				writePath := filepath.Join(assetsDirPath, name)
				if err = filelock.WriteFile(writePath, data); err != nil {
					logging.LogErrorf("write downloaded network asset [%s] to local asset [%s] failed: %s", u, writePath, err)
					continue
				}

				setAssetsLinkDest(destNode, dest, "assets/"+name)
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

func SearchAssetsByName(keyword string, exts []string) (ret []*cache.Asset) {
	ret = []*cache.Asset{}
	var keywords []string
	keywords = append(keywords, keyword)
	if "" != keyword {
		keywords = append(keywords, strings.Split(keyword, " ")...)
	}
	pathHitCount := map[string]int{}
	filterByExt := 0 < len(exts)
	for _, asset := range cache.GetAssets() {
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
				continue
			}
		}

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

		if 1 > hitNameCount+hitPathCount {
			continue
		}
		pathHitCount[asset.Path] += hitNameCount + hitPathCount

		hName := asset.HName
		if 0 < hitNameCount {
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

func GetAssetAbsPath(relativePath string) (ret string, err error) {
	relativePath = strings.TrimSpace(relativePath)
	if strings.Contains(relativePath, "?") {
		relativePath = relativePath[:strings.Index(relativePath, "?")]
	}

	// 在全局 assets 路径下搜索
	p := filepath.Join(util.DataDir, relativePath)
	if gulu.File.IsExist(p) {
		ret = p
		if !util.IsSubPath(util.WorkspaceDir, ret) {
			err = fmt.Errorf("[%s] is not sub path of workspace", ret)
			return
		}
		return
	}

	// 在笔记本下搜索
	notebooks, err := ListNotebooks()
	if err != nil {
		err = errors.New(Conf.Language(0))
		return
	}
	for _, notebook := range notebooks {
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
					ret = path
					return fs.SkipAll
				}
			}
			return nil
		})

		if "" != ret {
			if !util.IsSubPath(util.WorkspaceDir, ret) {
				err = fmt.Errorf("[%s] is not sub path of workspace", ret)
				return
			}
			return
		}
	}
	return "", errors.New(fmt.Sprintf(Conf.Language(12), relativePath))
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
			err = errors.New(fmt.Sprintf(Conf.Language(94), requestResult.Msg))
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

	unusedAssets := UnusedAssets()

	historyDir, err := GetHistoryDir(HistoryOpClean)
	if err != nil {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}

	var hashes []string
	for _, p := range unusedAssets {
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
		absPath := filepath.Join(util.DataDir, unusedAsset)
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

			if !isFileWatcherAvailable() {
				HandleAssetsRemoveEvent(absPath)
			}

			if removeErr := filelock.RemoveWithoutFatal(absPath); removeErr != nil {
				logging.LogErrorf("remove unused asset [%s] failed: %s", absPath, removeErr)
				util.PushErrMsg(fmt.Sprintf("%s", removeErr), 7000)
				return
			}

			util.RemoveAssetText(unusedAsset)
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

	historyDir, err := GetHistoryDir(HistoryOpClean)
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

	if !isFileWatcherAvailable() {
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

	newName = strings.TrimSpace(newName)
	newName = util.FilterUploadFileName(newName)
	if path.Base(oldPath) == newName {
		return
	}
	if "" == newName {
		return
	}

	if !gulu.File.IsValidFilename(newName) {
		err = errors.New(Conf.Language(151))
		return
	}

	newName = util.AssetName(newName+filepath.Ext(oldPath), ast.NewNodeID())
	parentDir := path.Dir(oldPath)
	newPath = path.Join(parentDir, newName)
	oldAbsPath, getErr := GetAssetAbsPath(oldPath)
	if getErr != nil {
		logging.LogErrorf("get asset [%s] abs path failed: %s", oldPath, getErr)
		return
	}
	newAbsPath := filepath.Join(filepath.Dir(oldAbsPath), newName)
	if err = filelock.Copy(oldAbsPath, newAbsPath); err != nil {
		logging.LogErrorf("copy asset [%s] failed: %s", oldAbsPath, err)
		return
	}

	if filelock.IsExist(filepath.Join(util.DataDir, oldPath+".sya")) {
		// Rename the .sya annotation file when renaming a PDF asset https://github.com/siyuan-note/siyuan/issues/9390
		if err = filelock.Copy(filepath.Join(util.DataDir, oldPath+".sya"), filepath.Join(util.DataDir, newPath+".sya")); err != nil {
			logging.LogErrorf("copy PDF annotation [%s] failed: %s", oldPath+".sya", err)
			return
		}
	}

	oldName := path.Base(oldPath)

	notebooks, err := ListNotebooks()
	if err != nil {
		return
	}

	luteEngine := util.NewLute()
	for _, notebook := range notebooks {
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

				p := filepath.ToSlash(strings.TrimPrefix(treeAbsPath, filepath.Join(util.DataDir, notebook.ID)))
				tree, parseErr := filesys.LoadTreeByData(data, notebook.ID, p, luteEngine)
				if nil != parseErr {
					logging.LogWarnf("parse json to tree [%s] failed: %s", treeAbsPath, parseErr)
					continue
				}

				treenode.UpsertBlockTree(tree)
				sql.UpsertTreeQueue(tree)

				util.PushEndlessProgress(fmt.Sprintf(Conf.Language(111), util.EscapeHTML(tree.Root.IALAttr("title"))))
			}
		}
	}

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

func UnusedAssets() (ret []string) {
	defer logging.Recover()
	ret = []string{}

	assetsPathMap, err := allAssetAbsPaths()
	if err != nil {
		return
	}
	linkDestMap := map[string]bool{}
	notebooks, err := ListNotebooks()
	if err != nil {
		return
	}
	luteEngine := util.NewLute()
	for _, notebook := range notebooks {
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

	// 排除数据库中引用的资源文件
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
		p = filepath.ToSlash(p)
		if strings.HasPrefix(p, "/") {
			p = p[1:]
		}
		ret = append(ret, p)
	}
	sort.Strings(ret)
	return
}

func MissingAssets() (ret []string) {
	defer logging.Recover()
	ret = []string{}

	assetsPathMap, err := allAssetAbsPaths()
	if err != nil {
		return
	}
	notebooks, err := ListNotebooks()
	if err != nil {
		return
	}
	luteEngine := util.NewLute()
	for _, notebook := range notebooks {
		if notebook.Closed {
			continue
		}

		dests := map[string]bool{}
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

		for dest := range dests {
			if !strings.HasPrefix(dest, "assets/") {
				continue
			}

			if idx := strings.Index(dest, "?"); 0 < idx {
				dest = dest[:idx]
			}

			if strings.HasSuffix(dest, "/") {
				continue
			}

			if strings.Contains(strings.ToLower(dest), ".pdf/") {
				if idx := strings.LastIndex(dest, "/"); -1 < idx {
					if ast.IsNodeIDPattern(dest[idx+1:]) {
						// PDF 标注不计入 https://github.com/siyuan-note/siyuan/issues/13891
						continue
					}
				}
			}

			if "" == assetsPathMap[dest] {
				if strings.HasPrefix(dest, "assets/.") {
					// Assets starting with `.` should not be considered missing assets https://github.com/siyuan-note/siyuan/issues/8821
					if !filelock.IsExist(filepath.Join(util.DataDir, dest)) {
						ret = append(ret, dest)
					}
				} else {
					ret = append(ret, dest)
				}
				continue
			}
		}
	}

	sort.Strings(ret)
	return
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
			idx := bytes.Index(tokens, []byte("src=\""))
			if -1 == idx {
				return ast.WalkContinue
			}
			src := tokens[idx+len("src=\""):]
			src = src[:bytes.Index(src, []byte("\""))]
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
	// 笔记本 assets
	for _, notebook := range notebooks {
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

func isFileWatcherAvailable() bool {
	return util.ContainerAndroid != util.Container && util.ContainerIOS != util.Container && util.ContainerHarmony != util.Container
}
