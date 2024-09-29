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
	"io"
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
	"github.com/gabriel-vasile/mimetype"
	"github.com/imroc/req/v3"
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

func NetAssets2LocalAssets(rootID string, onlyImg bool, originalURL string) (err error) {
	tree, err := LoadTreeByBlockID(rootID)
	if err != nil {
		return
	}

	var files int
	msgId := gulu.Rand.String(7)

	docDirLocalPath := filepath.Join(util.DataDir, tree.Box, path.Dir(tree.Path))
	assetsDirPath := getAssetsDir(filepath.Join(util.DataDir, tree.Box), docDirLocalPath)
	if !gulu.File.IsExist(assetsDirPath) {
		if err = os.MkdirAll(assetsDirPath, 0755); err != nil {
			return
		}
	}

	browserClient := req.C().
		SetUserAgent(util.UserAgent).
		SetTimeout(30 * time.Second).
		EnableInsecureSkipVerify().
		SetProxy(httpclient.ProxyFromEnvironment)

	destNodes := getRemoteAssetsLinkDestsInTree(tree, onlyImg)
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

				if !gulu.File.IsExist(u) || gulu.File.IsDir(u) {
					continue
				}

				name := filepath.Base(u)
				name = util.FilterUploadFileName(name)
				name = util.TruncateLenFileName(name)
				name = "network-asset-" + name
				name = util.AssetName(name)
				writePath := filepath.Join(assetsDirPath, name)
				if err = filelock.Copy(u, writePath); err != nil {
					logging.LogErrorf("copy [%s] to [%s] failed: %s", u, writePath, err)
					continue
				}

				setAssetsLinkDest(destNode, dest, "assets/"+name)
				files++
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
				if strings.Contains(strings.ToLower(resp.GetContentType()), "text/html") {
					// 忽略超链接网页 `Convert network assets to local` no longer process webpage https://github.com/siyuan-note/siyuan/issues/9965
					continue
				}

				if nil != reqErr {
					logging.LogErrorf("download network asset [%s] failed: %s", u, reqErr)
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
				var name string
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
				ext := path.Ext(name)
				if "" == ext {
					if mtype := mimetype.Detect(data); nil != mtype {
						ext = mtype.Extension()
					}
				}
				if "" == ext {
					contentType := resp.Header.Get("Content-Type")
					exts, _ := mime.ExtensionsByType(contentType)
					if 0 < len(exts) {
						ext = exts[0]
					}
				}
				name = strings.TrimSuffix(name, ext)
				name = util.FilterUploadFileName(name)
				name = util.TruncateLenFileName(name)
				name = "network-asset-" + name + "-" + ast.NewNodeID() + ext
				writePath := filepath.Join(assetsDirPath, name)
				if err = filelock.WriteFile(writePath, data); err != nil {
					logging.LogErrorf("write downloaded network asset [%s] to local asset [%s] failed: %s", u, writePath, err)
					continue
				}

				setAssetsLinkDest(destNode, dest, "assets/"+name)
				files++
				continue
			}
		}
	}

	if 0 < files {
		util.PushUpdateMsg(msgId, Conf.Language(113), 7000)
		if err = writeTreeUpsertQueue(tree); err != nil {
			return
		}
		util.PushUpdateMsg(msgId, fmt.Sprintf(Conf.Language(120), files), 5000)
	} else {
		util.PushUpdateMsg(msgId, Conf.Language(121), 3000)
	}
	return
}

func SearchAssetsByName(keyword string, exts []string) (ret []*cache.Asset) {
	ret = []*cache.Asset{}

	count := 0
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
		lowerKeyword := strings.ToLower(keyword)
		hitName := strings.Contains(lowerHName, lowerKeyword)
		hitPath := strings.Contains(lowerPath, lowerKeyword)
		if !hitName && !hitPath {
			continue
		}

		hName := asset.HName
		if hitName {
			_, hName = search.MarkText(asset.HName, keyword, 64, Conf.Search.CaseSensitive)
		}
		ret = append(ret, &cache.Asset{
			HName:   hName,
			Path:    asset.Path,
			Updated: asset.Updated,
		})
		count++
		if Conf.Search.Limit <= count {
			return
		}
	}

	sort.Slice(ret, func(i, j int) bool {
		return ret[i].Updated > ret[j].Updated
	})
	return
}

func GetAssetAbsPath(relativePath string) (ret string, err error) {
	relativePath = strings.TrimSpace(relativePath)
	if strings.Contains(relativePath, "?") {
		relativePath = relativePath[:strings.Index(relativePath, "?")]
	}
	notebooks, err := ListNotebooks()
	if err != nil {
		err = errors.New(Conf.Language(0))
		return
	}

	// 在笔记本下搜索
	for _, notebook := range notebooks {
		notebookAbsPath := filepath.Join(util.DataDir, notebook.ID)
		filelock.Walk(notebookAbsPath, func(path string, info fs.FileInfo, _ error) error {
			if isSkipFile(info.Name()) {
				if info.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if p := filepath.ToSlash(path); strings.HasSuffix(p, relativePath) {
				if gulu.File.IsExist(path) {
					ret = path
					return io.EOF
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
	return "", errors.New(fmt.Sprintf(Conf.Language(12), relativePath))
}

func UploadAssets2Cloud(rootID string) (count int, err error) {
	if !IsSubscriber() {
		return
	}

	tree, err := LoadTreeByBlockID(rootID)
	if err != nil {
		return
	}

	assets := assetsLinkDestsInTree(tree)
	embedAssets := assetsLinkDestsInQueryEmbedNodes(tree)
	assets = append(assets, embedAssets...)
	avAssets := assetsLinkDestsInAttributeViewNodes(tree)
	assets = append(assets, avAssets...)
	assets = gulu.Str.RemoveDuplicatedElem(assets)
	count, err = uploadAssets2Cloud(assets, bizTypeUploadAssets)
	if err != nil {
		return
	}
	return
}

const (
	bizTypeUploadAssets  = "upload-assets"
	bizTypeExport2Liandi = "export-liandi"
)

// uploadAssets2Cloud 将资源文件上传到云端图床。
func uploadAssets2Cloud(assetPaths []string, bizType string) (count int, err error) {
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
	msgId := util.PushMsg(fmt.Sprintf(Conf.Language(27), len(uploadAbsAssets)), 3000)
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

		msg := fmt.Sprintf(Conf.Language(27), html.EscapeString(absAsset))
		util.PushStatusBar(msg)
		util.PushUpdateMsg(msgId, msg, 3000)

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
	util.PushClearMsg(msgId)

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
		}
	}

	sql.BatchRemoveAssetsQueue(hashes)

	for _, unusedAsset := range unusedAssets {
		if unusedAsset = filepath.Join(util.DataDir, unusedAsset); filelock.IsExist(unusedAsset) {
			info, statErr := os.Stat(unusedAsset)
			if statErr == nil {
				size += info.Size()
			}

			if err := filelock.Remove(unusedAsset); err != nil {
				logging.LogErrorf("remove unused asset [%s] failed: %s", unusedAsset, err)
			}
		}
		ret = append(ret, unusedAsset)
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
	}

	if err = filelock.Remove(absPath); err != nil {
		logging.LogErrorf("remove unused asset [%s] failed: %s", absPath, err)
	}
	ret = absPath
	IncSync()

	indexHistoryDir(filepath.Base(historyDir), util.NewLute())
	cache.RemoveAsset(p)
	return
}

func RenameAsset(oldPath, newName string) (newPath string, err error) {
	util.PushEndlessProgress(Conf.Language(110))
	defer util.PushClearProgress()

	newName = strings.TrimSpace(newName)
	newName = gulu.Str.RemoveInvisible(newName)
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

	newName = util.AssetName(newName + filepath.Ext(oldPath))
	newPath = "assets/" + newName
	if err = filelock.Copy(filepath.Join(util.DataDir, oldPath), filepath.Join(util.DataDir, newPath)); err != nil {
		logging.LogErrorf("copy asset [%s] failed: %s", oldPath, err)
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
				for _, d := range assetsLinkDestsInTree(tree) {
					dests[d] = true
				}

				if titleImgPath := treenode.GetDocTitleImgPath(tree.Root); "" != titleImgPath {
					// 题头图计入
					if !util.IsAssetLinkDest([]byte(titleImgPath)) {
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
				for _, d := range assetsLinkDestsInTree(tree) {
					dests[d] = true
				}

				if titleImgPath := treenode.GetDocTitleImgPath(tree.Root); "" != titleImgPath {
					// 题头图计入
					if !util.IsAssetLinkDest([]byte(titleImgPath)) {
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

func assetsLinkDestsInAttributeViewNodes(tree *parse.Tree) (ret []string) {
	// The images in the databases are not uploaded to the community hosting https://github.com/siyuan-note/siyuan/issues/11948

	ret = []string{}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeAttributeView != n.Type {
			return ast.WalkContinue
		}

		attrView, _ := av.ParseAttributeView(n.AttributeViewID)
		if nil == attrView {
			return ast.WalkContinue
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
					if !treenode.IsRelativePath([]byte(dest)) {
						continue
					}

					ret = append(ret, strings.TrimSpace(dest))
				}
			}
		}
		return ast.WalkContinue
	})
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func assetsLinkDestsInQueryEmbedNodes(tree *parse.Tree) (ret []string) {
	// The images in the embed blocks are not uploaded to the community hosting https://github.com/siyuan-note/siyuan/issues/10042

	ret = []string{}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
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

			ret = append(ret, assetsLinkDestsInNode(embedNode)...)
		}
		return ast.WalkContinue
	})
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func assetsLinkDestsInTree(tree *parse.Tree) (ret []string) {
	ret = assetsLinkDestsInNode(tree.Root)
	return
}

func assetsLinkDestsInNode(node *ast.Node) (ret []string) {
	ret = []string{}
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if n.IsBlock() {
			// 以 custom-data-assets 开头的块属性值可能是多个资源文件链接，需要计入
			// Ignore assets associated with the `custom-data-assets` block attribute when cleaning unreferenced assets https://github.com/siyuan-note/siyuan/issues/12574
			for _, kv := range n.KramdownIAL {
				k := kv[0]
				if strings.HasPrefix(k, "custom-data-assets") {
					dest := kv[1]
					if "" == dest || !treenode.IsRelativePath([]byte(dest)) {
						continue
					}
					ret = append(ret, dest)
				}
			}
		}

		// 修改以下代码时需要同时修改 database 构造行级元素实现，增加必要的类型
		if !entering || (ast.NodeLinkDest != n.Type && ast.NodeHTMLBlock != n.Type && ast.NodeInlineHTML != n.Type &&
			ast.NodeIFrame != n.Type && ast.NodeWidget != n.Type && ast.NodeAudio != n.Type && ast.NodeVideo != n.Type &&
			!n.IsTextMarkType("a") && !n.IsTextMarkType("file-annotation-ref")) {
			return ast.WalkContinue
		}

		if ast.NodeLinkDest == n.Type {
			if !treenode.IsRelativePath(n.Tokens) {
				return ast.WalkContinue
			}

			dest := strings.TrimSpace(string(n.Tokens))
			ret = append(ret, dest)
		} else if n.IsTextMarkType("a") {
			if !treenode.IsRelativePath(gulu.Str.ToBytes(n.TextMarkAHref)) {
				return ast.WalkContinue
			}

			dest := strings.TrimSpace(n.TextMarkAHref)
			ret = append(ret, dest)
		} else if n.IsTextMarkType("file-annotation-ref") {
			if !treenode.IsRelativePath(gulu.Str.ToBytes(n.TextMarkFileAnnotationRefID)) {
				return ast.WalkContinue
			}

			if !strings.Contains(n.TextMarkFileAnnotationRefID, "/") {
				return ast.WalkContinue
			}

			dest := n.TextMarkFileAnnotationRefID[:strings.LastIndexByte(n.TextMarkFileAnnotationRefID, '/')]
			dest = strings.TrimSpace(dest)
			ret = append(ret, dest)
		} else {
			if ast.NodeWidget == n.Type {
				dataAssets := n.IALAttr("custom-data-assets")
				if "" == dataAssets {
					// 兼容两种属性名 custom-data-assets 和 data-assets https://github.com/siyuan-note/siyuan/issues/4122#issuecomment-1154796568
					dataAssets = n.IALAttr("data-assets")
				}
				if "" == dataAssets || !treenode.IsRelativePath([]byte(dataAssets)) {
					return ast.WalkContinue
				}
				ret = append(ret, dataAssets)
			} else { // HTMLBlock/InlineHTML/IFrame/Audio/Video
				dest := treenode.GetNodeSrcTokens(n)
				if "" != dest {
					ret = append(ret, dest)
				}
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
				if !util.IsAssetLinkDest(node.Tokens) {
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
						if !util.IsAssetLinkDest([]byte(dest)) {
							ret = append(ret, strings.TrimSpace(dest))
						}
					}
				}
			}
		}
	} else {
		if ast.NodeLinkDest == node.Type {
			if !util.IsAssetLinkDest(node.Tokens) {
				ret = append(ret, string(node.Tokens))
			}
		} else if node.IsTextMarkType("a") {
			if !util.IsAssetLinkDest([]byte(node.TextMarkAHref)) {
				ret = append(ret, node.TextMarkAHref)
			}
		} else if ast.NodeAudio == node.Type || ast.NodeVideo == node.Type {
			src := treenode.GetNodeSrcTokens(node)
			if !util.IsAssetLinkDest([]byte(src)) {
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
						if !util.IsAssetLinkDest([]byte(dest)) {
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
		filelock.Walk(notebookAbsPath, func(path string, info fs.FileInfo, err error) error {
			if notebookAbsPath == path {
				return nil
			}
			if isSkipFile(info.Name()) {
				if info.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}

			if filelock.IsHidden(path) {
				// 清理资源文件时忽略隐藏文件 Ignore hidden files when cleaning unused assets https://github.com/siyuan-note/siyuan/issues/12172
				return nil
			}

			if info.IsDir() && "assets" == info.Name() {
				filelock.Walk(path, func(assetPath string, info fs.FileInfo, err error) error {
					if path == assetPath {
						return nil
					}
					if isSkipFile(info.Name()) {
						if info.IsDir() {
							return filepath.SkipDir
						}
						return nil
					}
					relPath := filepath.ToSlash(assetPath)
					relPath = relPath[strings.Index(relPath, "assets/"):]
					if info.IsDir() {
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
	filelock.Walk(dataAssetsAbsPath, func(assetPath string, info fs.FileInfo, err error) error {
		if dataAssetsAbsPath == assetPath {
			return nil
		}

		if isSkipFile(info.Name()) {
			if info.IsDir() {
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
		if info.IsDir() {
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
	filelock.Walk(rootPath, func(path string, info fs.FileInfo, err error) error {
		if rootPath == path || nil == info {
			return nil
		}

		isDir := info.IsDir()
		name := info.Name()

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
