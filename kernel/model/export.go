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
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/lex"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/88250/pdfcpu/pkg/api"
	"github.com/88250/pdfcpu/pkg/pdfcpu"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/emirpasic/gods/stacks/linkedliststack"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func ExportSY(id string) (name, zipPath string) {
	block := treenode.GetBlockTree(id)
	if nil == block {
		util.LogErrorf("not found block [%s]", id)
		return
	}

	boxID := block.BoxID
	box := Conf.Box(boxID)
	baseFolderName := path.Base(block.HPath)
	if "." == baseFolderName {
		baseFolderName = path.Base(block.Path)
	}
	rootPath := block.Path
	docPaths := []string{rootPath}
	docFiles := box.ListFiles(strings.TrimSuffix(block.Path, ".sy"))
	for _, docFile := range docFiles {
		docPaths = append(docPaths, docFile.path)
	}
	zipPath = exportSYZip(boxID, path.Dir(rootPath), baseFolderName, docPaths)
	name = strings.TrimSuffix(filepath.Base(block.Path), ".sy")
	return
}

func ExportDataInFolder(exportFolder string) (err error) {
	util.PushEndlessProgress(Conf.Language(65))
	defer util.ClearPushProgress(100)

	WaitForWritingFiles()
	writingDataLock.Lock()
	defer writingDataLock.Unlock()

	exportFolder = filepath.Join(exportFolder, util.CurrentTimeSecondsStr())
	err = exportData(exportFolder)
	if nil != err {
		return
	}
	return
}

func ExportData() (zipPath string) {
	util.PushEndlessProgress(Conf.Language(65))
	defer util.ClearPushProgress(100)

	WaitForWritingFiles()
	writingDataLock.Lock()
	defer writingDataLock.Unlock()

	baseFolderName := "data-" + util.CurrentTimeSecondsStr()
	exportFolder := filepath.Join(util.TempDir, "export", baseFolderName)
	zipPath = exportFolder + ".zip"
	err := exportData(exportFolder)
	if nil != err {
		return
	}
	zipPath = "/export/" + url.PathEscape(filepath.Base(zipPath))
	return
}

func exportData(exportFolder string) (err error) {
	baseFolderName := "data-" + util.CurrentTimeSecondsStr()
	if err = os.MkdirAll(exportFolder, 0755); nil != err {
		util.LogErrorf("create export temp folder failed: %s", err)
		return
	}

	err = filelock.ReleaseAllFileLocks()
	if nil != err {
		return
	}

	data := filepath.Join(util.WorkspaceDir, "data")
	if err = stableCopy(data, exportFolder); nil != err {
		util.LogErrorf("copy data dir from [%s] to [%s] failed: %s", data, baseFolderName, err)
		err = errors.New(fmt.Sprintf(Conf.Language(23), formatErrorMsg(err)))
		return
	}

	zipPath := exportFolder + ".zip"
	zip, err := gulu.Zip.Create(zipPath)
	if nil != err {
		util.LogErrorf("create export data zip [%s] failed: %s", exportFolder, err)
		return
	}

	if err = zip.AddDirectory(baseFolderName, exportFolder); nil != err {
		util.LogErrorf("create export data zip [%s] failed: %s", exportFolder, err)
		return
	}

	if err = zip.Close(); nil != err {
		util.LogErrorf("close export data zip failed: %s", err)
	}

	os.RemoveAll(exportFolder)
	return
}

func Preview(id string) string {
	tree, _ := loadTreeByBlockID(id)
	tree = exportTree(tree, false)
	luteEngine := NewLute()
	luteEngine.SetFootnotes(true)
	md := treenode.FormatNode(tree.Root, luteEngine)
	tree = parse.Parse("", []byte(md), luteEngine.ParseOptions)
	return luteEngine.ProtylePreview(tree, luteEngine.RenderOptions)
}

func ExportDocx(id, savePath string) (err error) {
	if !util.IsValidPandocBin(Conf.Export.PandocBin) {
		return errors.New(Conf.Language(115))
	}

	tmpDir := filepath.Join(util.TempDir, "export", gulu.Rand.String(7))
	defer os.Remove(tmpDir)
	name, dom := ExportMarkdownHTML(id, tmpDir, true)
	tmpDocxPath := filepath.Join(tmpDir, name+".docx")
	args := []string{ // pandoc -f html --resource-path=请从这里开始 请从这里开始\index.html -o test.docx
		"-f", "html",
		"--resource-path", tmpDir,
		"-o", tmpDocxPath,
	}

	pandoc := exec.Command(Conf.Export.PandocBin, args...)
	util.CmdAttr(pandoc)
	pandoc.Stdin = bytes.NewBufferString(dom)
	output, err := pandoc.CombinedOutput()
	if nil != err {
		util.LogErrorf("export docx failed: %s", gulu.Str.FromBytes(output))
		msg := fmt.Sprintf(Conf.Language(14), gulu.Str.FromBytes(output))
		return errors.New(msg)
	}

	if err = gulu.File.Copy(tmpDocxPath, filepath.Join(savePath, name+".docx")); nil != err {
		util.LogErrorf("export docx failed: %s", err)
		return errors.New(fmt.Sprintf(Conf.Language(14), err))
	}
	tmpAssets := filepath.Join(tmpDir, "assets")
	if gulu.File.IsDir(tmpAssets) {
		if err = gulu.File.Copy(tmpAssets, filepath.Join(savePath, "assets")); nil != err {
			util.LogErrorf("export docx failed: %s", err)
			return errors.New(fmt.Sprintf(Conf.Language(14), err))
		}
	}
	return
}

func ExportMarkdownHTML(id, savePath string, docx bool) (name, dom string) {
	tree, _ := loadTreeByBlockID(id)

	tree = exportTree(tree, true)
	name = path.Base(tree.HPath)

	if err := os.MkdirAll(savePath, 0755); nil != err {
		util.LogErrorf("mkdir [%s] failed: %s", savePath, err)
		return
	}

	assets := assetsLinkDestsInTree(tree)
	for _, asset := range assets {
		if strings.HasPrefix(asset, "assets/") {
			srcAbsPath, err := GetAssetAbsPath(asset)
			if nil != err {
				util.LogWarnf("resolve path of asset [%s] failed: %s", asset, err)
				continue
			}
			targetAbsPath := filepath.Join(savePath, asset)
			if err = gulu.File.Copy(srcAbsPath, targetAbsPath); nil != err {
				util.LogWarnf("copy asset from [%s] to [%s] failed: %s", srcAbsPath, targetAbsPath, err)
			}
		}
	}

	srcs := []string{"stage/build/export", "stage/build/fonts", "stage/protyle"}
	for _, src := range srcs {
		from := filepath.Join(util.WorkingDir, src)
		to := filepath.Join(savePath, src)
		if err := gulu.File.Copy(from, to); nil != err {
			util.LogWarnf("copy stage from [%s] to [%s] failed: %s", from, savePath, err)
			return
		}
	}

	theme := Conf.Appearance.ThemeLight
	if 1 == Conf.Appearance.Mode {
		theme = Conf.Appearance.ThemeDark
	}
	srcs = []string{"icons", "themes/" + theme}
	for _, src := range srcs {
		from := filepath.Join(util.AppearancePath, src)
		to := filepath.Join(savePath, "appearance", src)
		if err := gulu.File.Copy(from, to); nil != err {
			util.LogErrorf("copy appearance from [%s] to [%s] failed: %s", from, savePath, err)
			return
		}
	}

	luteEngine := NewLute()
	luteEngine.SetFootnotes(true)
	md := treenode.FormatNode(tree.Root, luteEngine)
	tree = parse.Parse("", []byte(md), luteEngine.ParseOptions)
	if docx {
		processIFrame(tree)
	}

	dom = luteEngine.ProtylePreview(tree, luteEngine.RenderOptions)
	return
}

func ExportHTML(id, savePath string, pdf bool) (name, dom string) {
	tree, _ := loadTreeByBlockID(id)
	var headings []*ast.Node
	if pdf { // 导出 PDF 需要标记目录书签
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && ast.NodeHeading == n.Type && !n.ParentIs(ast.NodeBlockquote) {
				headings = append(headings, n)
				return ast.WalkSkipChildren
			}
			return ast.WalkContinue
		})

		for _, h := range headings {
			link := &ast.Node{Type: ast.NodeLink}
			link.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
			link.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(" ")})
			link.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
			link.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
			link.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("pdf-outline://" + h.ID)})
			link.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
			h.PrependChild(link)
		}
	}

	tree = exportTree(tree, true)
	name = path.Base(tree.Path)

	if err := os.MkdirAll(savePath, 0755); nil != err {
		util.LogErrorf("mkdir [%s] failed: %s", savePath, err)
		return
	}

	assets := assetsLinkDestsInTree(tree)
	for _, asset := range assets {
		srcAbsPath, err := GetAssetAbsPath(asset)
		if nil != err {
			util.LogWarnf("resolve path of asset [%s] failed: %s", asset, err)
			continue
		}
		targetAbsPath := filepath.Join(savePath, asset)
		if err = gulu.File.Copy(srcAbsPath, targetAbsPath); nil != err {
			util.LogWarnf("copy asset from [%s] to [%s] failed: %s", srcAbsPath, targetAbsPath, err)
		}
	}

	luteEngine := NewLute()
	if !pdf { // 导出 HTML 需要复制静态资源
		srcs := []string{"stage/build/export", "stage/build/fonts", "stage/protyle"}
		for _, src := range srcs {
			from := filepath.Join(util.WorkingDir, src)
			to := filepath.Join(savePath, src)
			if err := gulu.File.Copy(from, to); nil != err {
				util.LogErrorf("copy stage from [%s] to [%s] failed: %s", from, savePath, err)
				return
			}
		}

		theme := Conf.Appearance.ThemeLight
		if 1 == Conf.Appearance.Mode {
			theme = Conf.Appearance.ThemeDark
		}
		srcs = []string{"icons", "themes/" + theme}
		for _, src := range srcs {
			from := filepath.Join(util.AppearancePath, src)
			to := filepath.Join(savePath, "appearance", src)
			if err := gulu.File.Copy(from, to); nil != err {
				util.LogErrorf("copy appearance from [%s] to [%s] failed: %s", from, savePath, err)
				return
			}
		}
	} else { // 导出 PDF 需要将资源文件路径改为 HTTP 伺服
		luteEngine.RenderOptions.LinkBase = "http://127.0.0.1:" + util.ServerPort + "/"
	}

	if pdf {
		processIFrame(tree)
	}

	luteEngine.SetFootnotes(true)
	luteEngine.RenderOptions.ProtyleContenteditable = false
	renderer := render.NewBlockExportRenderer(tree, luteEngine.RenderOptions)
	dom = gulu.Str.FromBytes(renderer.Render())
	return
}

func processIFrame(tree *parse.Tree) {
	// 导出 PDF/Word 时 IFrame 块使用超链接 https://github.com/siyuan-note/siyuan/issues/4035
	var unlinks []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if ast.NodeIFrame == n.Type {
			index := bytes.Index(n.Tokens, []byte("src=\""))
			if 0 > index {
				n.InsertBefore(&ast.Node{Type: ast.NodeText, Tokens: n.Tokens})
			} else {
				src := n.Tokens[index+len("src=\""):]
				src = src[:bytes.Index(src, []byte("\""))]
				src = html.UnescapeHTML(src)
				link := &ast.Node{Type: ast.NodeLink}
				link.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
				link.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: src})
				link.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
				link.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
				link.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: src})
				link.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
				n.InsertBefore(link)
			}
			unlinks = append(unlinks, n)
		}
		return ast.WalkContinue
	})
	for _, n := range unlinks {
		n.Unlink()
	}
}

func AddPDFOutline(id, p string) (err error) {
	inFile := p
	links, err := api.ListToCLinks(inFile)
	if nil != err {
		return
	}

	sort.Slice(links, func(i, j int) bool {
		return links[i].Page < links[j].Page
	})

	bms := map[string]*pdfcpu.Bookmark{}
	for _, link := range links {
		linkID := link.URI[strings.LastIndex(link.URI, "/")+1:]
		title := sql.GetBlock(linkID).Content
		title, _ = url.QueryUnescape(title)
		bm := &pdfcpu.Bookmark{
			Title:    title,
			PageFrom: link.Page,
			AbsPos:   link.Rect.UR.Y,
		}
		bms[linkID] = bm
	}

	if 1 > len(bms) {
		return
	}

	tree, _ := loadTreeByBlockID(id)
	if nil == tree {
		return
	}

	var headings []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeHeading == n.Type && !n.ParentIs(ast.NodeBlockquote) {
			headings = append(headings, n)
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})

	var topBms []*pdfcpu.Bookmark
	stack := linkedliststack.New()
	for _, h := range headings {
	L:
		for ; ; stack.Pop() {
			cur, ok := stack.Peek()
			if !ok {
				bm := bms[h.ID]
				bm.Level = h.HeadingLevel
				stack.Push(bm)
				topBms = append(topBms, bm)
				break L
			}

			tip := cur.(*pdfcpu.Bookmark)
			if tip.Level < h.HeadingLevel {
				bm := bms[h.ID]
				bm.Level = h.HeadingLevel
				bm.Parent = tip
				tip.Children = append(tip.Children, bm)
				stack.Push(bm)
				break L
			}
		}
	}

	outFile := inFile + ".tmp"
	err = api.AddBookmarksFile(inFile, outFile, topBms, nil)
	if nil != err {
		util.LogErrorf("add bookmark failed: %s", err)
		return
	}
	err = os.Rename(outFile, inFile)
	return
}

func CopyStdMarkdown(id string) string {
	tree, _ := loadTreeByBlockID(id)
	tree = exportTree(tree, false)
	luteEngine := NewLute()
	luteEngine.SetFootnotes(true)
	luteEngine.SetKramdownIAL(false)
	if IsSubscriber() {
		// 订阅用户使用云端图床服务
		luteEngine.RenderOptions.LinkBase = "https://assets.b3logfile.com/siyuan/" + Conf.User.UserId + "/"
	}
	return treenode.FormatNode(tree.Root, luteEngine)
}

func ExportMarkdown(id string) (name, zipPath string) {
	block := treenode.GetBlockTree(id)
	if nil == block {
		util.LogErrorf("not found block [%s]", id)
		return
	}

	boxID := block.BoxID
	box := Conf.Box(boxID)
	baseFolderName := path.Base(block.HPath)
	if "." == baseFolderName {
		baseFolderName = path.Base(block.Path)
	}
	docPaths := []string{block.Path}
	docFiles := box.ListFiles(strings.TrimSuffix(block.Path, ".sy"))
	for _, docFile := range docFiles {
		docPaths = append(docPaths, docFile.path)
	}
	zipPath = exportMarkdownZip(boxID, baseFolderName, docPaths)
	name = strings.TrimSuffix(filepath.Base(block.Path), ".sy")
	return
}

func BatchExportMarkdown(boxID, folderPath string) (zipPath string) {
	box := Conf.Box(boxID)

	var baseFolderName string
	if "/" == folderPath {
		baseFolderName = box.Name
	} else {
		block := treenode.GetBlockTreeRootByHPath(box.ID, folderPath)
		if nil == block {
			util.LogErrorf("not found block")
			return
		}
		baseFolderName = path.Base(block.HPath)
	}
	if "" == baseFolderName {
		baseFolderName = "Untitled"
	}

	docFiles := box.ListFiles(folderPath)
	var docPaths []string
	for _, docFile := range docFiles {
		docPaths = append(docPaths, docFile.path)
	}
	zipPath = exportMarkdownZip(boxID, baseFolderName, docPaths)
	return
}

func exportMarkdownZip(boxID, baseFolderName string, docPaths []string) (zipPath string) {
	dir, name := path.Split(baseFolderName)
	name = util.FilterFileName(name)
	if strings.HasSuffix(name, "..") {
		// 文档标题以 `..` 结尾时无法导出 Markdown https://github.com/siyuan-note/siyuan/issues/4698
		// 似乎是 os.MkdirAll 的 bug，以 .. 结尾的路径无法创建，所以这里加上 _ 结尾
		name += "_"
	}
	baseFolderName = path.Join(dir, name)
	box := Conf.Box(boxID)

	exportFolder := filepath.Join(util.TempDir, "export", baseFolderName)
	if err := os.MkdirAll(exportFolder, 0755); nil != err {
		util.LogErrorf("create export temp folder failed: %s", err)
		return
	}

	copiedAssets := hashset.New()
	luteEngine := util.NewLute()
	for _, p := range docPaths {
		docIAL := box.docIAL(p)
		if nil == docIAL {
			continue
		}

		id := docIAL["id"]
		hPath, md := exportMarkdownContent(id)
		dir, name = path.Split(hPath)
		dir = util.FilterFilePath(dir) // 导出文档时未移除不支持的文件名符号 https://github.com/siyuan-note/siyuan/issues/4590
		name = util.FilterFileName(name)
		hPath = path.Join(dir, name)
		p = hPath + ".md"
		writePath := filepath.Join(exportFolder, p)
		if gulu.File.IsExist(writePath) {
			// 重名文档加 ID
			p = hPath + "-" + id + ".md"
			writePath = filepath.Join(exportFolder, p)
		}
		writeFolder := filepath.Dir(writePath)
		if err := os.MkdirAll(writeFolder, 0755); nil != err {
			util.LogErrorf("create export temp folder [%s] failed: %s", writeFolder, err)
			continue
		}
		if err := gulu.File.WriteFileSafer(writePath, gulu.Str.ToBytes(md), 0644); nil != err {
			util.LogErrorf("write export markdown file [%s] failed: %s", writePath, err)
			continue
		}

		// 解析导出后的标准 Markdown，汇总 assets
		tree := parse.Parse("", gulu.Str.ToBytes(md), luteEngine.ParseOptions)
		var assets []string
		assets = append(assets, assetsLinkDestsInTree(tree)...)
		for _, asset := range assets {
			asset = string(html.DecodeDestination([]byte(asset)))
			if strings.Contains(asset, "?") {
				asset = asset[:strings.LastIndex(asset, "?")]
			}

			if copiedAssets.Contains(asset) {
				continue
			}

			srcPath, err := GetAssetAbsPath(asset)
			if nil != err {
				util.LogWarnf("get asset [%s] abs path failed: %s", asset, err)
				continue
			}

			destPath := filepath.Join(writeFolder, asset)
			if gulu.File.IsDir(srcPath) {
				err = gulu.File.Copy(srcPath, destPath)
			} else {
				err = gulu.File.CopyFile(srcPath, destPath)
			}
			if nil != err {
				util.LogErrorf("copy asset from [%s] to [%s] failed: %s", srcPath, destPath, err)
				continue
			}

			copiedAssets.Add(asset)
		}
	}

	zipPath = exportFolder + ".zip"
	zip, err := gulu.Zip.Create(zipPath)
	if nil != err {
		util.LogErrorf("create export markdown zip [%s] failed: %s", exportFolder, err)
		return ""
	}

	if err = zip.AddDirectory(baseFolderName, exportFolder); nil != err {
		util.LogErrorf("create export markdown zip [%s] failed: %s", exportFolder, err)
		return ""
	}

	if err = zip.Close(); nil != err {
		util.LogErrorf("close export markdown zip failed: %s", err)
	}

	os.RemoveAll(exportFolder)
	zipPath = "/export/" + url.PathEscape(filepath.Base(zipPath))
	return
}

func exportSYZip(boxID, rootDirPath, baseFolderName string, docPaths []string) (zipPath string) {
	dir, name := path.Split(baseFolderName)
	name = util.FilterFileName(name)
	if strings.HasSuffix(name, "..") {
		// 文档标题以 `..` 结尾时无法导出 Markdown https://github.com/siyuan-note/siyuan/issues/4698
		// 似乎是 os.MkdirAll 的 bug，以 .. 结尾的路径无法创建，所以这里加上 _ 结尾
		name += "_"
	}
	baseFolderName = path.Join(dir, name)
	box := Conf.Box(boxID)

	exportFolder := filepath.Join(util.TempDir, "export", baseFolderName)
	if err := os.MkdirAll(exportFolder, 0755); nil != err {
		util.LogErrorf("create export temp folder failed: %s", err)
		return
	}

	trees := map[string]*parse.Tree{}
	refTrees := map[string]*parse.Tree{}
	for _, p := range docPaths {
		docIAL := box.docIAL(p)
		if nil == docIAL {
			continue
		}

		id := docIAL["id"]
		tree, err := loadTreeByBlockID(id)
		if nil != err {
			continue
		}
		trees[tree.ID] = tree
	}
	for _, tree := range trees {
		refs := exportRefTrees(tree)
		for refTreeID, refTree := range refs {
			if nil == trees[refTreeID] {
				refTrees[refTreeID] = refTree
			}
		}
	}

	// 按文件夹结构复制选择的树
	for _, tree := range trees {
		readPath := filepath.Join(util.DataDir, tree.Box, tree.Path)
		data, readErr := filelock.NoLockFileRead(readPath)
		if nil != readErr {
			util.LogErrorf("read file [%s] failed: %s", readPath, readErr)
			continue
		}

		writePath := strings.TrimPrefix(tree.Path, rootDirPath)
		writePath = filepath.Join(exportFolder, writePath)
		writeFolder := filepath.Dir(writePath)
		if mkdirErr := os.MkdirAll(writeFolder, 0755); nil != mkdirErr {
			util.LogErrorf("create export temp folder [%s] failed: %s", writeFolder, mkdirErr)
			continue
		}
		if writeErr := os.WriteFile(writePath, data, 0644); nil != writeErr {
			util.LogErrorf("write export file [%s] failed: %s", writePath, writeErr)
			continue
		}
	}

	// 引用树放在导出文件夹根路径下
	for treeID, tree := range refTrees {
		readPath := filepath.Join(util.DataDir, tree.Box, tree.Path)
		data, readErr := filelock.NoLockFileRead(readPath)
		if nil != readErr {
			util.LogErrorf("read file [%s] failed: %s", readPath, readErr)
			continue
		}

		writePath := strings.TrimPrefix(tree.Path, rootDirPath)
		writePath = filepath.Join(exportFolder, treeID+".sy")
		if writeErr := os.WriteFile(writePath, data, 0644); nil != writeErr {
			util.LogErrorf("write export file [%s] failed: %s", writePath, writeErr)
			continue
		}
	}

	// 将引用树合并到选择树中，以便后面一次性导出资源文件
	for treeID, tree := range refTrees {
		trees[treeID] = tree
	}

	// 导出引用的资源文件
	copiedAssets := hashset.New()
	for _, tree := range trees {
		var assets []string
		assets = append(assets, assetsLinkDestsInTree(tree)...)
		for _, asset := range assets {
			asset = string(html.DecodeDestination([]byte(asset)))
			if strings.Contains(asset, "?") {
				asset = asset[:strings.LastIndex(asset, "?")]
			}

			if copiedAssets.Contains(asset) {
				continue
			}

			srcPath, assetErr := GetAssetAbsPath(asset)
			if nil != assetErr {
				util.LogWarnf("get asset [%s] abs path failed: %s", asset, assetErr)
				continue
			}

			destPath := filepath.Join(exportFolder, asset)
			if gulu.File.IsDir(srcPath) {
				assetErr = gulu.File.Copy(srcPath, destPath)
			} else {
				assetErr = gulu.File.CopyFile(srcPath, destPath)
			}
			if nil != assetErr {
				util.LogErrorf("copy asset from [%s] to [%s] failed: %s", srcPath, destPath, assetErr)
				continue
			}

			copiedAssets.Add(asset)
		}
	}

	zipPath = exportFolder + ".sy.zip"
	zip, err := gulu.Zip.Create(zipPath)
	if nil != err {
		util.LogErrorf("create export markdown zip [%s] failed: %s", exportFolder, err)
		return ""
	}

	if err = zip.AddDirectory(baseFolderName, exportFolder); nil != err {
		util.LogErrorf("create export markdown zip [%s] failed: %s", exportFolder, err)
		return ""
	}

	if err = zip.Close(); nil != err {
		util.LogErrorf("close export markdown zip failed: %s", err)
	}

	os.RemoveAll(exportFolder)
	zipPath = "/export/" + url.PathEscape(filepath.Base(zipPath))
	return
}

func ExportMarkdownContent(id string) (hPath, exportedMd string) {
	return exportMarkdownContent(id)
}

func exportMarkdownContent(id string) (hPath, exportedMd string) {
	tree, _ := loadTreeByBlockID(id)
	hPath = tree.HPath
	tree = exportTree(tree, false)
	luteEngine := NewLute()
	luteEngine.SetFootnotes(true)
	luteEngine.SetKramdownIAL(false)
	exportedMd = formatExportMd(tree.Root, luteEngine.ParseOptions, luteEngine.RenderOptions)
	return
}

func formatExportMd(node *ast.Node, parseOptions *parse.Options, renderOptions *render.Options) string {
	root := &ast.Node{Type: ast.NodeDocument}
	tree := &parse.Tree{Root: root, Context: &parse.Context{ParseOption: parseOptions}}
	renderer := render.NewFormatRenderer(tree, renderOptions)
	renderer.Writer = &bytes.Buffer{}
	renderer.Writer.Grow(4096)
	renderer.NodeWriterStack = append(renderer.NodeWriterStack, renderer.Writer)
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		switch n.Type {
		case ast.NodeParagraph: // 段落需要单独处理。导出为 Markdown 时段落开头空两格不生效 https://github.com/siyuan-note/siyuan/issues/3167
			return renderExportMdParagraph(renderer, n, entering)
		case ast.NodeMathBlockContent:
			return renderExportMdMathBlockContent(renderer, n, entering)
		case ast.NodeInlineMathContent:
			return renderExportMdInlineMathContent(renderer, n, entering)
		case ast.NodeCodeBlockCode:
			return renderExportMdCodeBlockCode(renderer, n, entering)
		default:
			rendererFunc := renderer.RendererFuncs[n.Type]
			return rendererFunc(n, entering)
		}
	})
	return gulu.Str.FromBytes(renderer.Writer.Bytes())
}

func renderExportMdCodeBlockCode(r *render.FormatRenderer, node *ast.Node, entering bool) ast.WalkStatus {
	if entering {
		tokens := node.Tokens
		info := node.Parent.ChildByType(ast.NodeCodeBlockFenceInfoMarker)
		if nil != info &&
			bytes.Contains(info.CodeBlockInfo, []byte("flowchart")) ||
			bytes.Contains(info.CodeBlockInfo, []byte("mermaid")) ||
			bytes.Contains(info.CodeBlockInfo, []byte("graphviz")) ||
			bytes.Contains(info.CodeBlockInfo, []byte("plantuml")) {
			tokens = html.UnescapeHTML(tokens)
		}
		r.Write(tokens)
	}
	return ast.WalkContinue
}

func renderExportMdMathBlockContent(r *render.FormatRenderer, node *ast.Node, entering bool) ast.WalkStatus {
	if entering {
		tokens := html.UnescapeHTML(node.Tokens)
		r.Write(tokens)
		r.WriteByte(lex.ItemNewline)
	}
	return ast.WalkContinue
}

func renderExportMdInlineMathContent(r *render.FormatRenderer, node *ast.Node, entering bool) ast.WalkStatus {
	if entering {
		tokens := html.UnescapeHTML(node.Tokens)
		r.Write(tokens)
	}
	return ast.WalkContinue
}

func renderExportMdParagraph(r *render.FormatRenderer, node *ast.Node, entering bool) ast.WalkStatus {
	if entering {
		if r.Options.ChineseParagraphBeginningSpace && ast.NodeDocument == node.Parent.Type {
			r.WriteString("　　")
		}
	} else {
		if !r.Options.KeepParagraphBeginningSpace && nil != node.FirstChild {
			node.FirstChild.Tokens = bytes.TrimSpace(node.FirstChild.Tokens)
		}

		if node.ParentIs(ast.NodeTableCell) {
			if nil != node.Next && ast.NodeText != node.Next.Type {
				r.WriteString("<br /><br />")
			}
			return ast.WalkContinue
		}

		if withoutKramdownBlockIAL(r, node) {
			r.Newline()
		}

		inTightList := false
		lastListItemLastPara := false
		if parent := node.Parent; nil != parent {
			if ast.NodeListItem == parent.Type { // ListItem.Paragraph
				listItem := parent
				if nil != listItem.Parent && nil != listItem.Parent.ListData {
					// 必须通过列表（而非列表项）上的紧凑标识判断，因为在设置该标识时仅设置了 List.Tight
					// 设置紧凑标识的具体实现可参考函数 List.Finalize()
					inTightList = listItem.Parent.ListData.Tight

					if nextItem := listItem.Next; nil == nextItem {
						nextPara := node.Next
						lastListItemLastPara = nil == nextPara
					}
				} else {
					inTightList = true
				}
			}
		}

		if !inTightList || (lastListItemLastPara) {
			if withoutKramdownBlockIAL(r, node) {
				r.WriteByte(lex.ItemNewline)
			}
		}
	}
	return ast.WalkContinue
}

func withoutKramdownBlockIAL(r *render.FormatRenderer, node *ast.Node) bool {
	return !r.Options.KramdownBlockIAL || 0 == len(node.KramdownIAL)
}

func exportTree(tree *parse.Tree, wysiwyg bool) (ret *parse.Tree) {
	luteEngine := NewLute()
	ret = tree
	id := tree.Root.ID
	var unlinks []*ast.Node

	// 解析查询嵌入节点
	ast.Walk(ret.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeBlockQueryEmbed != n.Type {
			return ast.WalkContinue
		}

		var defMd string
		stmt := n.ChildByType(ast.NodeBlockQueryEmbedScript).TokensStr()
		stmt = html.UnescapeString(stmt)
		blocks := searchEmbedBlock(stmt, nil, 0)
		if 1 > len(blocks) {
			return ast.WalkContinue
		}

		defMdBuf := bytes.Buffer{}
		for _, def := range blocks {
			defMdBuf.WriteString(renderBlockMarkdownR(def.ID))
			defMdBuf.WriteString("\n\n")
		}
		defMd = defMdBuf.String()

		buf := &bytes.Buffer{}
		lines := strings.Split(defMd, "\n")
		for i, line := range lines {
			if 0 == Conf.Export.BlockEmbedMode { // 原始文本
				buf.WriteString(line)
			} else { // Blockquote
				buf.WriteString("> " + line)
			}
			if i < len(lines)-1 {
				buf.WriteString("\n")
			}
		}
		buf.WriteString("\n\n")

		refTree := parse.Parse("", buf.Bytes(), luteEngine.ParseOptions)
		var children []*ast.Node
		for c := refTree.Root.FirstChild; nil != c; c = c.Next {
			children = append(children, c)
		}
		for _, c := range children {
			if ast.NodeDocument == c.Type {
				continue
			}
			n.InsertBefore(c)
		}
		unlinks = append(unlinks, n)
		return ast.WalkSkipChildren
	})
	for _, n := range unlinks {
		n.Unlink()
	}
	unlinks = nil

	// 收集引用转脚注
	var refFootnotes []*refAsFootnotes
	if 4 == Conf.Export.BlockRefMode { // 块引转脚注
		treeCache := map[string]*parse.Tree{}
		treeCache[id] = ret
		depth := 0
		collectFootnotesDefs(ret.ID, &refFootnotes, &treeCache, &depth)
	}

	ast.Walk(ret.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		switch n.Type {
		case ast.NodeTagOpenMarker: // 配置标签开始标记符
			if !wysiwyg {
				n.Type = ast.NodeText
				n.Tokens = []byte(Conf.Export.TagOpenMarker)
				return ast.WalkContinue
			}
		case ast.NodeTagCloseMarker: // 配置标记结束标记符
			if !wysiwyg {
				n.Type = ast.NodeText
				n.Tokens = []byte(Conf.Export.TagCloseMarker)
				return ast.WalkContinue
			}
		case ast.NodeSuperBlockOpenMarker, ast.NodeSuperBlockLayoutMarker, ast.NodeSuperBlockCloseMarker:
			if !wysiwyg {
				unlinks = append(unlinks, n)
				return ast.WalkContinue
			}
		case ast.NodeHeading:
			n.HeadingNormalizedID = n.IALAttr("id")
			n.ID = n.HeadingNormalizedID
		case ast.NodeInlineMathContent, ast.NodeMathBlockContent:
			n.Tokens = bytes.TrimSpace(n.Tokens) // 导出 Markdown 时去除公式内容中的首尾空格 https://github.com/siyuan-note/siyuan/issues/4666
			return ast.WalkContinue
		case ast.NodeFileAnnotationRef:
			refIDNode := n.ChildByType(ast.NodeFileAnnotationRefID)
			if nil == refIDNode {
				return ast.WalkSkipChildren
			}
			refID := refIDNode.TokensStr()
			p := refID[:strings.LastIndex(refID, "/")]
			absPath, err := GetAssetAbsPath(p)
			if nil != err {
				util.LogWarnf("get assets abs path by rel path [%s] failed: %s", p, err)
				return ast.WalkSkipChildren
			}
			sya := absPath + ".sya"
			syaData, err := os.ReadFile(sya)
			if nil != err {
				util.LogErrorf("read file [%s] failed: %s", sya, err)
				return ast.WalkSkipChildren
			}
			syaJSON := map[string]interface{}{}
			if err = gulu.JSON.UnmarshalJSON(syaData, &syaJSON); nil != err {
				util.LogErrorf("unmarshal file [%s] failed: %s", sya, err)
				return ast.WalkSkipChildren
			}
			annotationID := refID[strings.LastIndex(refID, "/")+1:]
			annotationData := syaJSON[annotationID]
			if nil == annotationData {
				util.LogErrorf("not found annotation [%s] in .sya", annotationID)
				return ast.WalkSkipChildren
			}
			pages := annotationData.(map[string]interface{})["pages"].([]interface{})
			page := int(pages[0].(map[string]interface{})["index"].(float64)) + 1
			pageStr := strconv.Itoa(page)
			refTextNode := n.ChildByType(ast.NodeFileAnnotationRefText)
			if nil == refTextNode {
				return ast.WalkSkipChildren
			}
			refText := refTextNode.TokensStr()
			ext := filepath.Ext(p)
			file := p[7:len(p)-23-len(ext)] + ext
			fileAnnotationRefLink := &ast.Node{Type: ast.NodeLink}
			fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
			if 0 == Conf.Export.FileAnnotationRefMode {
				fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte(file + " - p" + pageStr + " - " + refText)})
			} else {
				fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte(refText)})
			}
			fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
			fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
			fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte(p + "?p=" + pageStr)})
			fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
			n.InsertBefore(fileAnnotationRefLink)
			unlinks = append(unlinks, n)
			return ast.WalkSkipChildren
		}

		if ast.NodeBlockRef != n.Type {
			return ast.WalkContinue
		}

		// 处理引用节点

		var linkText string
		id := n.ChildByType(ast.NodeBlockRefID).TokensStr()
		if anchor := n.ChildByType(ast.NodeBlockRefText); nil != anchor {
			linkText = anchor.Text()
		} else if anchor = n.ChildByType(ast.NodeBlockRefDynamicText); nil != anchor {
			linkText = anchor.Text()
		} else {
			linkText = sql.GetRefText(id)
		}
		if Conf.Editor.BlockRefDynamicAnchorTextMaxLen < utf8.RuneCountInString(linkText) {
			linkText = gulu.Str.SubStr(linkText, Conf.Editor.BlockRefDynamicAnchorTextMaxLen) + "..."
		}
		linkText = Conf.Export.BlockRefTextLeft + linkText + Conf.Export.BlockRefTextRight

		defTree, _ := loadTreeByBlockID(id)
		if nil == defTree {
			return ast.WalkContinue
		}

		switch Conf.Export.BlockRefMode {
		case 2: // 锚文本块链
			var blockRefLink *ast.Node
			blockRefLink = &ast.Node{Type: ast.NodeLink}
			blockRefLink.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
			blockRefLink.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte(linkText)})
			blockRefLink.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
			blockRefLink.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
			blockRefLink.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("siyuan://blocks/" + id)})
			blockRefLink.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
			n.InsertBefore(blockRefLink)
		case 3: // 仅锚文本
			n.InsertBefore(&ast.Node{Type: ast.NodeText, Tokens: []byte(linkText)})
		case 4: // 脚注
			defID := n.ChildByType(ast.NodeBlockRefID).TokensStr()
			refFoot := getRefAsFootnotes(defID, &refFootnotes)
			n.InsertBefore(&ast.Node{Type: ast.NodeText, Tokens: []byte(linkText)})
			n.InsertBefore(&ast.Node{Type: ast.NodeFootnotesRef, Tokens: []byte("^" + refFoot.refNum), FootnotesRefId: refFoot.refNum, FootnotesRefLabel: []byte("^" + refFoot.refNum)})
		}
		unlinks = append(unlinks, n)
		return ast.WalkSkipChildren
	})
	for _, n := range unlinks {
		n.Unlink()
	}

	if 4 == Conf.Export.BlockRefMode { // 块引转脚注
		if footnotesDefBlock := resolveFootnotesDefs(&refFootnotes, ret.Root.ID); nil != footnotesDefBlock {
			ret.Root.AppendChild(footnotesDefBlock)
		}
	}

	if Conf.Export.AddTitle {
		if root, _ := getBlock(id); nil != root {
			title := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1}
			title.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(root.Content)})
			ret.Root.PrependChild(title)
		}
	}

	// 导出时支持导出题头图 https://github.com/siyuan-note/siyuan/issues/4372
	titleImgPath := treenode.GetDocTitleImgPath(ret.Root)
	if "" != titleImgPath {
		p := &ast.Node{Type: ast.NodeParagraph}
		titleImg := &ast.Node{Type: ast.NodeImage}
		titleImg.AppendChild(&ast.Node{Type: ast.NodeBang})
		titleImg.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
		titleImg.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte("image")})
		titleImg.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
		titleImg.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
		titleImg.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte(titleImgPath)})
		titleImg.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
		p.AppendChild(titleImg)
		ret.Root.PrependChild(p)
	}

	unlinks = nil
	ast.Walk(ret.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		// 块折叠以后导出 HTML/PDF 固定展开 https://github.com/siyuan-note/siyuan/issues/4064
		n.RemoveIALAttr("fold")
		n.RemoveIALAttr("heading-fold")

		if ast.NodeWidget == n.Type {
			// 挂件块导出 https://github.com/siyuan-note/siyuan/issues/3834
			exportMdVal := n.IALAttr("data-export-md")
			exportMdVal = html.UnescapeString(exportMdVal) // 导出 `data-export-md` 时未解析代码块与行内代码内的转义字符 https://github.com/siyuan-note/siyuan/issues/4180
			if "" != exportMdVal {
				exportMdTree := parse.Parse("", []byte(exportMdVal), luteEngine.ParseOptions)
				var insertNodes []*ast.Node
				for c := exportMdTree.Root.FirstChild; nil != c; c = c.Next {
					if ast.NodeKramdownBlockIAL != c.Type {
						insertNodes = append(insertNodes, c)
					}
				}
				for _, insertNode := range insertNodes {
					n.InsertBefore(insertNode)
				}
				unlinks = append(unlinks, n)
			}
			return ast.WalkContinue
		}

		if ast.NodeText != n.Type {
			return ast.WalkContinue
		}
		// Shift+Enter 换行在导出为 Markdown 时使用硬换行 https://github.com/siyuan-note/siyuan/issues/3458
		n.Tokens = bytes.ReplaceAll(n.Tokens, []byte("\n"), []byte("  \n"))
		return ast.WalkContinue
	})
	for _, n := range unlinks {
		n.Unlink()
	}
	return ret
}

func resolveFootnotesDefs(refFootnotes *[]*refAsFootnotes, rootID string) (footnotesDefBlock *ast.Node) {
	if 1 > len(*refFootnotes) {
		return nil
	}

	footnotesDefBlock = &ast.Node{Type: ast.NodeFootnotesDefBlock}
	for _, foot := range *refFootnotes {
		t, err := loadTreeByBlockID(foot.defID)
		if nil != err {
			continue
		}
		defNode := treenode.GetNodeInTree(t, foot.defID)
		var nodes []*ast.Node
		if ast.NodeHeading == defNode.Type {
			nodes = append(nodes, defNode)
			children := treenode.HeadingChildren(defNode)
			nodes = append(nodes, children...)
		} else if ast.NodeDocument == defNode.Type {
			docTitle := &ast.Node{ID: defNode.ID, Type: ast.NodeHeading, HeadingLevel: 1}
			docTitle.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(defNode.IALAttr("title"))})
			nodes = append(nodes, docTitle)
			for c := defNode.FirstChild; nil != c; c = c.Next {
				nodes = append(nodes, c)
			}
		} else {
			nodes = append(nodes, defNode)
		}

		var newNodes []*ast.Node
		for _, node := range nodes {
			var unlinks []*ast.Node

			ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering {
					return ast.WalkContinue
				}

				if ast.NodeBlockRef == n.Type {
					defID := n.ChildByType(ast.NodeBlockRefID).TokensStr()
					if f := getRefAsFootnotes(defID, refFootnotes); nil != f {
						n.InsertBefore(&ast.Node{Type: ast.NodeText, Tokens: []byte(Conf.Export.BlockRefTextLeft + f.refAnchorText + Conf.Export.BlockRefTextRight)})
						n.InsertBefore(&ast.Node{Type: ast.NodeFootnotesRef, Tokens: []byte("^" + f.refNum), FootnotesRefId: f.refNum, FootnotesRefLabel: []byte("^" + f.refNum)})
						unlinks = append(unlinks, n)
					}
					return ast.WalkSkipChildren
				} else if ast.NodeBlockQueryEmbed == n.Type {
					stmt := n.ChildByType(ast.NodeBlockQueryEmbedScript).TokensStr()
					stmt = html.UnescapeString(stmt)
					sqlBlocks := sql.SelectBlocksRawStmt(stmt, Conf.Search.Limit)
					depth := 0
					for _, b := range sqlBlocks {
						subNodes := renderBlockMarkdownR0(b.ID, &depth)
						for _, subNode := range subNodes {
							if ast.NodeListItem == subNode.Type {
								parentList := &ast.Node{Type: ast.NodeList, ListData: &ast.ListData{Typ: subNode.ListData.Typ}}
								parentList.AppendChild(subNode)
								newNodes = append(newNodes, parentList)
							} else {
								newNodes = append(newNodes, subNode)
							}
						}
					}
					unlinks = append(unlinks, n)
					return ast.WalkSkipChildren
				}
				return ast.WalkContinue
			})
			for _, n := range unlinks {
				n.Unlink()
			}

			if ast.NodeBlockQueryEmbed != node.Type {
				if ast.NodeListItem == node.Type {
					parentList := &ast.Node{Type: ast.NodeList, ListData: &ast.ListData{Typ: node.ListData.Typ}}
					parentList.AppendChild(node)
					newNodes = append(newNodes, parentList)
				} else {
					newNodes = append(newNodes, node)
				}
			}
		}

		footnotesDef := &ast.Node{Type: ast.NodeFootnotesDef, Tokens: []byte("^" + foot.refNum), FootnotesRefId: foot.refNum, FootnotesRefLabel: []byte("^" + foot.refNum)}
		for _, node := range newNodes {
			ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering {
					return ast.WalkContinue
				}
				if ast.NodeParagraph != n.Type {
					return ast.WalkContinue
				}

				docID := strings.TrimSuffix(path.Base(n.Path), ".sy")
				if rootID == docID { // 在同一个文档的话缩略显示 https://github.com/siyuan-note/siyuan/issues/3299
					if text := sql.GetRefText(n.ID); 64 < utf8.RuneCountInString(text) {
						var unlinkChildren []*ast.Node
						for c := n.FirstChild; nil != c; c = c.Next {
							unlinkChildren = append(unlinkChildren, c)
						}
						for _, c := range unlinkChildren {
							c.Unlink()
						}
						text = gulu.Str.SubStr(text, 64) + "..."
						n.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(text)})
						return ast.WalkSkipChildren
					}
				}
				return ast.WalkContinue
			})

			footnotesDef.AppendChild(node)
		}
		footnotesDefBlock.AppendChild(footnotesDef)
	}
	return
}

func collectFootnotesDefs(id string, refFootnotes *[]*refAsFootnotes, treeCache *map[string]*parse.Tree, depth *int) {
	*depth++
	if 4096 < *depth {
		return
	}
	b := treenode.GetBlockTree(id)
	if nil == b {
		return
	}
	t := (*treeCache)[b.RootID]
	if nil == t {
		var err error
		if t, err = loadTreeByBlockID(b.ID); nil != err {
			return
		}
		(*treeCache)[t.ID] = t
	}
	node := treenode.GetNodeInTree(t, b.ID)
	if nil == node {
		util.LogErrorf("not found node [%s] in tree [%s]", b.ID, t.Root.ID)
		return
	}
	collectFootnotesDefs0(node, refFootnotes, treeCache, depth)
	if ast.NodeHeading == node.Type {
		children := treenode.HeadingChildren(node)
		for _, c := range children {
			collectFootnotesDefs0(c, refFootnotes, treeCache, depth)
		}
	}
	return
}

func collectFootnotesDefs0(node *ast.Node, refFootnotes *[]*refAsFootnotes, treeCache *map[string]*parse.Tree, depth *int) {
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeBlockRef == n.Type {
			defID := n.ChildByType(ast.NodeBlockRefID).TokensStr()
			if nil == getRefAsFootnotes(defID, refFootnotes) {
				anchorText := sql.GetRefText(defID)
				if Conf.Editor.BlockRefDynamicAnchorTextMaxLen < utf8.RuneCountInString(anchorText) {
					anchorText = gulu.Str.SubStr(anchorText, Conf.Editor.BlockRefDynamicAnchorTextMaxLen) + "..."
				}
				*refFootnotes = append(*refFootnotes, &refAsFootnotes{
					defID:         defID,
					refNum:        strconv.Itoa(len(*refFootnotes) + 1),
					refAnchorText: anchorText,
				})
				collectFootnotesDefs(defID, refFootnotes, treeCache, depth)
			}
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})
}
func getRefAsFootnotes(defID string, slice *[]*refAsFootnotes) *refAsFootnotes {
	for _, e := range *slice {
		if e.defID == defID {
			return e
		}
	}
	return nil
}

type refAsFootnotes struct {
	defID         string
	refNum        string
	refAnchorText string
}

func exportRefTrees(tree *parse.Tree) (ret map[string]*parse.Tree) {
	ret = map[string]*parse.Tree{}
	exportRefTrees0(tree, &ret)
	return
}

func exportRefTrees0(tree *parse.Tree, retTrees *map[string]*parse.Tree) {
	if nil != (*retTrees)[tree.ID] {
		return
	}
	(*retTrees)[tree.ID] = tree

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeBlockRef == n.Type {
			defIDNode := n.ChildByType(ast.NodeBlockRefID)
			if nil == defIDNode {
				return ast.WalkSkipChildren
			}
			defID := defIDNode.TokensStr()
			defBlock := treenode.GetBlockTree(defID)
			if nil == defBlock {
				return ast.WalkSkipChildren
			}
			defTree, err := loadTreeByBlockID(defBlock.RootID)
			if nil != err {
				return ast.WalkSkipChildren
			}

			exportRefTrees0(defTree, retTrees)
		}
		return ast.WalkContinue
	})
}
