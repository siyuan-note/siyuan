// SiYuan - Build Your Eternal Digital Garden
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

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gabriel-vasile/mimetype"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func DocImageAssets(rootID string) (ret []string, err error) {
	tree, err := loadTreeByBlockID(rootID)
	if nil != err {
		return
	}

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if ast.NodeImage == n.Type {
			linkDest := n.ChildByType(ast.NodeLinkDest)
			dest := linkDest.Tokens
			ret = append(ret, gulu.Str.FromBytes(dest))
		}
		return ast.WalkContinue
	})
	return
}

func NetImg2LocalAssets(rootID string) (err error) {
	tree, err := loadTreeByBlockID(rootID)
	if nil != err {
		return
	}

	var files int
	msgId := gulu.Rand.String(7)
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if ast.NodeImage == n.Type {
			linkDest := n.ChildByType(ast.NodeLinkDest)
			dest := linkDest.Tokens
			if !sql.IsAssetLinkDest(dest) && (bytes.HasPrefix(bytes.ToLower(dest), []byte("https://")) || bytes.HasPrefix(bytes.ToLower(dest), []byte("http://"))) {
				u := string(dest)
				if strings.Contains(u, "qpic.cn") {
					// 微信图片拉取改进 https://github.com/siyuan-note/siyuan/issues/5052
					if strings.Contains(u, "http://") {
						u = strings.Replace(u, "http://", "https://", 1)
					}
					if strings.HasSuffix(u, "/0") {
						u = strings.Replace(u, "/0", "/640", 1)
					} else if strings.Contains(u, "/0?") {
						u = strings.Replace(u, "/0?", "/640?", 1)
					}
				}
				util.PushUpdateMsg(msgId, fmt.Sprintf(Conf.Language(119), u), 15000)
				request := httpclient.NewBrowserRequest()
				resp, reqErr := request.Get(u)
				if nil != reqErr {
					logging.LogErrorf("download net img [%s] failed: %s", u, reqErr)
					return ast.WalkSkipChildren
				}
				if 200 != resp.StatusCode {
					logging.LogErrorf("download net img [%s] failed: %d", u, resp.StatusCode)
					return ast.WalkSkipChildren
				}
				data, repErr := resp.ToBytes()
				if nil != repErr {
					logging.LogErrorf("download net img [%s] failed: %s", u, repErr)
					return ast.WalkSkipChildren
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
				name = gulu.Str.SubStr(name, 64)
				name = util.FilterFileName(name)
				name = "net-img-" + name + "-" + ast.NewNodeID() + ext
				writePath := filepath.Join(util.DataDir, "assets", name)
				if err = gulu.File.WriteFileSafer(writePath, data, 0644); nil != err {
					logging.LogErrorf("write downloaded net img [%s] to local assets [%s] failed: %s", u, writePath, err)
					return ast.WalkSkipChildren
				}

				linkDest.Tokens = []byte("assets/" + name)
				files++
			}
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})
	if 0 < files {
		util.PushUpdateMsg(msgId, Conf.Language(113), 7000)
		if err = writeJSONQueue(tree); nil != err {
			return
		}
		sql.WaitForWritingDatabase()
		util.PushUpdateMsg(msgId, fmt.Sprintf(Conf.Language(120), files), 5000)
	} else {
		util.PushUpdateMsg(msgId, Conf.Language(121), 3000)
	}
	return
}

func SearchAssetsByName(keyword string) (ret []*cache.Asset) {
	ret = []*cache.Asset{}

	count := 0
	for _, asset := range cache.Assets {
		if !strings.Contains(strings.ToLower(asset.HName), strings.ToLower(keyword)) {
			continue
		}

		_, hName := search.MarkText(asset.HName, keyword, 64, Conf.Search.CaseSensitive)
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

func GetAssetAbsPath(relativePath string) (absPath string, err error) {
	relativePath = strings.TrimSpace(relativePath)
	notebooks, err := ListNotebooks()
	if nil != err {
		err = errors.New(Conf.Language(0))
		return
	}

	// 在笔记本下搜索
	for _, notebook := range notebooks {
		notebookAbsPath := filepath.Join(util.DataDir, notebook.ID)
		filepath.Walk(notebookAbsPath, func(path string, info fs.FileInfo, _ error) error {
			if isSkipFile(info.Name()) {
				if info.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if p := filepath.ToSlash(path); strings.HasSuffix(p, relativePath) {
				if gulu.File.IsExist(path) {
					absPath = path
					return io.EOF
				}
			}
			return nil
		})
		if "" != absPath {
			return
		}
	}

	// 在全局 assets 路径下搜索
	p := filepath.Join(util.DataDir, relativePath)
	if gulu.File.IsExist(p) {
		absPath = p
		return
	}
	return "", errors.New(fmt.Sprintf(Conf.Language(12), relativePath))
}

func UploadAssets2Cloud(rootID string) (err error) {
	if !IsSubscriber() {
		return
	}

	sqlAssets := sql.QueryRootBlockAssets(rootID)
	err = uploadCloud(sqlAssets)
	return
}

func uploadCloud(sqlAssets []*sql.Asset) (err error) {
	syncedAssets := readWorkspaceAssets()
	var unSyncAssets []string
	for _, sqlAsset := range sqlAssets {
		if !gulu.Str.Contains(sqlAsset.Path, syncedAssets) && strings.Contains(sqlAsset.Path, "assets/") {
			unSyncAssets = append(unSyncAssets, sqlAsset.Path)
		}
	}

	if 1 > len(unSyncAssets) {
		return
	}

	var uploadAbsAssets []string
	for _, asset := range unSyncAssets {
		var absPath string
		absPath, err = GetAssetAbsPath(asset)
		if nil != err {
			logging.LogWarnf("get asset [%s] abs path failed: %s", asset, err)
			return
		}
		if "" == absPath {
			logging.LogErrorf("not found asset [%s]", asset)
			err = errors.New(fmt.Sprintf(Conf.Language(12), asset))
			return
		}

		uploadAbsAssets = append(uploadAbsAssets, absPath)
	}

	if 1 > len(uploadAbsAssets) {
		return
	}

	uploadAbsAssets = gulu.Str.RemoveDuplicatedElem(uploadAbsAssets)

	logging.LogInfof("uploading [%d] assets", len(uploadAbsAssets))
	msgId := util.PushMsg(fmt.Sprintf(Conf.Language(27), len(uploadAbsAssets)), 3000)
	if loadErr := LoadUploadToken(); nil != loadErr {
		util.PushMsg(loadErr.Error(), 5000)
		return
	}

	var completedUploadAssets []string
	for _, absAsset := range uploadAbsAssets {
		if fi, statErr := os.Stat(absAsset); nil != statErr {
			logging.LogErrorf("stat file [%s] failed: %s", absAsset, statErr)
			return statErr
		} else if 10*1024*1024 <= fi.Size() {
			logging.LogWarnf("file [%s] larger than 10MB, ignore uploading it", absAsset)
			continue
		}

		msg := fmt.Sprintf(Conf.Language(27), absAsset)
		util.PushStatusBar(msg)
		util.PushUpdateMsg(msgId, msg, 3000)

		requestResult := gulu.Ret.NewResult()
		request := httpclient.NewCloudFileRequest2m()
		resp, reqErr := request.
			SetResult(requestResult).
			SetFile("file[]", absAsset).
			SetCookies(&http.Cookie{Name: "symphony", Value: uploadToken}).
			Post(util.AliyunServer + "/apis/siyuan/upload?ver=" + util.Ver)
		if nil != reqErr {
			logging.LogErrorf("upload assets failed: %s", reqErr)
			return ErrFailedToConnectCloudServer
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
	}
	util.PushClearMsg(msgId)

	if 0 < len(completedUploadAssets) {
		syncedAssets = readWorkspaceAssets()
		logging.LogInfof("uploaded [%d] assets", len(completedUploadAssets))
		for _, completedSyncAsset := range completedUploadAssets {
			syncedAssets = append(syncedAssets, completedSyncAsset)
		}
		saveWorkspaceAssets(syncedAssets)
	}
	return
}

func readWorkspaceAssets() (ret []string) {
	ret = []string{}
	confDir := filepath.Join(util.DataDir, "assets", ".siyuan")
	if err := os.MkdirAll(confDir, 0755); nil != err {
		logging.LogErrorf("create assets conf dir [%s] failed: %s", confDir, err)
		return
	}
	confPath := filepath.Join(confDir, "assets.json")
	if !gulu.File.IsExist(confPath) {
		return
	}

	data, err := os.ReadFile(confPath)
	if nil != err {
		logging.LogErrorf("read assets conf failed: %s", err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); nil != err {
		logging.LogErrorf("parse assets conf failed: %s, re-init it", err)
		return
	}
	return
}

func saveWorkspaceAssets(assets []string) {
	confDir := filepath.Join(util.DataDir, "assets", ".siyuan")
	if err := os.MkdirAll(confDir, 0755); nil != err {
		logging.LogErrorf("create assets conf dir [%s] failed: %s", confDir, err)
		return
	}
	confPath := filepath.Join(confDir, "assets.json")

	assets = gulu.Str.RemoveDuplicatedElem(assets)
	sort.Strings(assets)
	data, err := gulu.JSON.MarshalIndentJSON(assets, "", "  ")
	if nil != err {
		logging.LogErrorf("create assets conf failed: %s", err)
		return
	}
	if err = gulu.File.WriteFileSafer(confPath, data, 0644); nil != err {
		logging.LogErrorf("write assets conf failed: %s", err)
		return
	}
}

func RemoveUnusedAssets() (ret []string) {
	msgId := util.PushMsg(Conf.Language(100), 30*1000)
	defer func() {
		util.PushClearMsg(msgId)
		util.PushMsg(Conf.Language(99), 3000)
	}()

	ret = []string{}
	unusedAssets := UnusedAssets()

	historyDir, err := GetHistoryDir(HistoryOpClean)
	if nil != err {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}

	for _, p := range unusedAssets {
		historyPath := filepath.Join(historyDir, p)
		if p = filepath.Join(util.DataDir, p); gulu.File.IsExist(p) {
			if err = gulu.File.Copy(p, historyPath); nil != err {
				return
			}
		}
	}

	for _, unusedAsset := range unusedAssets {
		if unusedAsset = filepath.Join(util.DataDir, unusedAsset); gulu.File.IsExist(unusedAsset) {
			if err := os.RemoveAll(unusedAsset); nil != err {
				logging.LogErrorf("remove unused asset [%s] failed: %s", unusedAsset, err)
			}
		}
		ret = append(ret, unusedAsset)
	}
	if 0 < len(ret) {
		IncSync()
	}

	indexHistoryDir(filepath.Base(historyDir), NewLute())
	return
}

func RemoveUnusedAsset(p string) (ret string) {
	p = filepath.Join(util.DataDir, p)
	if !gulu.File.IsExist(p) {
		return p
	}

	historyDir, err := GetHistoryDir(HistoryOpClean)
	if nil != err {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}

	newP := strings.TrimPrefix(p, util.DataDir)
	historyPath := filepath.Join(historyDir, newP)
	if err = gulu.File.Copy(p, historyPath); nil != err {
		return
	}

	if err = os.RemoveAll(p); nil != err {
		logging.LogErrorf("remove unused asset [%s] failed: %s", p, err)
	}
	ret = p
	IncSync()

	indexHistoryDir(filepath.Base(historyDir), NewLute())
	return
}

func RenameAsset(oldPath, newName string) (err error) {
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

	newName = util.AssetName(newName) + filepath.Ext(oldPath)
	newPath := "assets/" + newName
	if err = gulu.File.Copy(filepath.Join(util.DataDir, oldPath), filepath.Join(util.DataDir, newPath)); nil != err {
		logging.LogErrorf("copy asset [%s] failed: %s", oldPath, err)
		return
	}
	oldName := path.Base(oldPath)

	notebooks, err := ListNotebooks()
	if nil != err {
		return
	}
	for _, notebook := range notebooks {
		pages := pagedPaths(filepath.Join(util.DataDir, notebook.ID), 32)
		for _, paths := range pages {
			for _, treeAbsPath := range paths {
				data, readErr := filelock.NoLockFileRead(treeAbsPath)
				if nil != readErr {
					logging.LogErrorf("get data [path=%s] failed: %s", treeAbsPath, readErr)
					err = readErr
					return
				}

				if !bytes.Contains(data, []byte(oldName)) {
					continue
				}

				data = bytes.Replace(data, []byte(oldName), []byte(newName), -1)
				if writeErr := filelock.NoLockFileWrite(treeAbsPath, data); nil != writeErr {
					logging.LogErrorf("write data [path=%s] failed: %s", treeAbsPath, writeErr)
					err = writeErr
					return
				}

				p := filepath.ToSlash(strings.TrimPrefix(treeAbsPath, filepath.Join(util.DataDir, notebook.ID)))
				tree, parseErr := LoadTree(notebook.ID, p)
				if nil != parseErr {
					logging.LogErrorf("parse json to tree [%s] failed: %s", treeAbsPath, parseErr)
					err = parseErr
					return
				}

				treenode.ReindexBlockTree(tree)
				sql.UpsertTreeQueue(tree)

				util.PushEndlessProgress(fmt.Sprintf(Conf.Language(111), tree.Root.IALAttr("title")))
			}
		}
	}

	IncSync()

	util.PushEndlessProgress(Conf.Language(113))
	sql.WaitForWritingDatabase()
	util.ReloadUI()
	return
}

func UnusedAssets() (ret []string) {
	defer logging.Recover()
	ret = []string{}

	assetsPathMap, err := allAssetAbsPaths()
	if nil != err {
		return
	}
	linkDestMap := map[string]bool{}
	notebooks, err := ListNotebooks()
	if nil != err {
		return
	}
	luteEngine := NewLute()
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
					if !sql.IsAssetLinkDest([]byte(titleImgPath)) {
						continue
					}
					dests[titleImgPath] = true
				}
			}
		}

		var linkDestFolderPaths, linkDestFilePaths []string
		for dest, _ := range dests {
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
		for asset, _ := range assetsPathMap {
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
		}
	}

	// 排除文件注解和对应文件
	var toRemoves []string
	for asset, _ := range assetsPathMap {
		if strings.HasSuffix(asset, ".sya") {
			toRemoves = append(toRemoves, asset, strings.TrimSuffix(asset, ".sya"))
		}
	}
	for _, toRemove := range toRemoves {
		delete(assetsPathMap, toRemove)
	}

	dataAssetsAbsPath, err := getDataAssetsAbsPath()
	if nil != err {
		return
	}

	for _, assetAbsPath := range assetsPathMap {
		if _, ok := linkDestMap[assetAbsPath]; ok {
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

func assetsLinkDestsInTree(tree *parse.Tree) (ret []string) {
	ret = []string{}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		// 修改以下代码时需要同时修改 database 构造行级元素实现，增加必要的类型
		if !entering || (ast.NodeLinkDest != n.Type && ast.NodeHTMLBlock != n.Type && ast.NodeInlineHTML != n.Type &&
			ast.NodeIFrame != n.Type && ast.NodeWidget != n.Type && ast.NodeAudio != n.Type && ast.NodeVideo != n.Type) {
			return ast.WalkContinue
		}

		if ast.NodeLinkDest == n.Type {
			if !isRelativePath(n.Tokens) {
				return ast.WalkContinue
			}

			dest := strings.TrimSpace(string(n.Tokens))
			ret = append(ret, dest)
		} else {
			if ast.NodeWidget == n.Type {
				dataAssets := n.IALAttr("custom-data-assets")
				if "" == dataAssets {
					// 兼容两种属性名 custom-data-assets 和 data-assets https://github.com/siyuan-note/siyuan/issues/4122#issuecomment-1154796568
					dataAssets = n.IALAttr("data-assets")
				}
				if "" == dataAssets || !isRelativePath([]byte(dataAssets)) {
					return ast.WalkContinue
				}
				ret = append(ret, dataAssets)
			} else { // HTMLBlock/InlineHTML/IFrame/Audio/Video
				if index := bytes.Index(n.Tokens, []byte("src=\"")); 0 < index {
					src := n.Tokens[index+len("src=\""):]
					if index = bytes.Index(src, []byte("\"")); 0 < index {
						src = src[:bytes.Index(src, []byte("\""))]
						if !isRelativePath(src) {
							return ast.WalkContinue
						}

						dest := strings.TrimSpace(string(src))
						ret = append(ret, dest)
					} else {
						logging.LogWarnf("src is missing the closing double quote in tree [%s] ", tree.Box+tree.Path)
					}
				}
			}
		}
		return ast.WalkContinue
	})
	return
}

func isRelativePath(dest []byte) bool {
	if 1 > len(dest) {
		return false
	}
	if '/' == dest[0] {
		return false
	}
	return !bytes.Contains(dest, []byte(":"))
}

// allAssetAbsPaths 返回 asset 相对路径（assets/xxx）到绝对路径（F:\SiYuan\data\assets\xxx）的映射。
func allAssetAbsPaths() (assetsAbsPathMap map[string]string, err error) {
	notebooks, err := ListNotebooks()
	if nil != err {
		return
	}

	assetsAbsPathMap = map[string]string{}
	// 笔记本 assets
	for _, notebook := range notebooks {
		notebookAbsPath := filepath.Join(util.DataDir, notebook.ID)
		filepath.Walk(notebookAbsPath, func(path string, info fs.FileInfo, err error) error {
			if notebookAbsPath == path {
				return nil
			}
			if isSkipFile(info.Name()) {
				if info.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}

			if info.IsDir() && "assets" == info.Name() {
				filepath.Walk(path, func(assetPath string, info fs.FileInfo, err error) error {
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
	dataAssetsAbsPath, err := getDataAssetsAbsPath()
	if nil != err {
		return
	}
	filepath.Walk(dataAssetsAbsPath, func(assetPath string, info fs.FileInfo, err error) error {
		if dataAssetsAbsPath == assetPath {
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
	filelock.ReleaseFileLocks(rootPath)

	var assetsDirPaths []string
	filepath.Walk(rootPath, func(path string, info fs.FileInfo, err error) error {
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
		if err := gulu.File.Copy(assetsDirPath, dataAssetsPath); nil != err {
			logging.LogErrorf("copy tree assets from [%s] to [%s] failed: %s", assetsDirPaths, dataAssetsPath, err)
		}
	}
}

func getDataAssetsAbsPath() (ret string, err error) {
	ret = filepath.Join(util.DataDir, "assets")
	stat, statErr := os.Lstat(ret)
	if nil != statErr {
		err = statErr
		return
	}
	if 0 != stat.Mode()&os.ModeSymlink {
		// 跟随符号链接 https://github.com/siyuan-note/siyuan/issues/5480
		ret, err = os.Readlink(ret)
		if nil != err {
			return
		}
	}
	return
}
