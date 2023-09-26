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
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/88250/pdfcpu/pkg/api"
	"github.com/88250/pdfcpu/pkg/pdfcpu"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/emirpasic/gods/stacks/linkedliststack"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func Export2Liandi(id string) (err error) {
	tree, err := loadTreeByBlockID(id)
	if nil != err {
		logging.LogErrorf("load tree by block id [%s] failed: %s", id, err)
		return
	}

	if IsUserGuide(tree.Box) {
		// Doc in the user guide no longer supports one-click sending to the community https://github.com/siyuan-note/siyuan/issues/8388
		return errors.New(Conf.Language(204))
	}

	sqlAssets := sql.QueryRootBlockAssets(id)
	err = uploadAssets2Cloud(sqlAssets, bizTypeExport2Liandi)
	if nil != err {
		return
	}

	msgId := util.PushMsg(Conf.Language(182), 15000)
	defer util.PushClearMsg(msgId)

	// 判断帖子是否已经存在，存在则使用更新接口
	const liandiArticleIdAttrName = "custom-liandi-articleId"
	foundArticle := false
	articleId := tree.Root.IALAttr(liandiArticleIdAttrName)
	if "" != articleId {
		result := gulu.Ret.NewResult()
		request := httpclient.NewCloudRequest30s()
		resp, getErr := request.
			SetSuccessResult(result).
			SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
			Get(util.GetCloudAccountServer() + "/api/v2/article/update/" + articleId)
		if nil != getErr {
			logging.LogErrorf("get liandi article info failed: %s", getErr)
			return getErr
		}

		switch resp.StatusCode {
		case 200:
			if 0 == result.Code {
				foundArticle = true
			} else if 1 == result.Code {
				foundArticle = false
			}
		case 404:
			foundArticle = false
		default:
			msg := fmt.Sprintf("get liandi article info failed [sc=%d]", resp.StatusCode)
			err = errors.New(msg)
			return
		}
	}

	apiURL := util.GetCloudAccountServer() + "/api/v2/article"
	if foundArticle {
		apiURL += "/" + articleId
	}

	title := path.Base(tree.HPath)
	tags := tree.Root.IALAttr("tags")
	content := exportMarkdownContent0(tree, util.GetCloudForumAssetsServer()+time.Now().Format("2006/01")+"/siyuan/"+Conf.User.UserId+"/", true,
		4, 1, 0,
		"#", "#",
		"", "",
		false)
	result := gulu.Ret.NewResult()
	request := httpclient.NewCloudRequest30s()
	request = request.
		SetSuccessResult(result).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.User.UserToken}).
		SetBody(map[string]interface{}{
			"articleTitle":   title,
			"articleTags":    tags,
			"articleContent": content})
	var resp *req.Response
	var sendErr error
	if foundArticle {
		resp, sendErr = request.Put(apiURL)
	} else {
		resp, sendErr = request.Post(apiURL)
	}
	if nil != sendErr {
		logging.LogErrorf("send article to liandi failed: %s", err)
		return err
	}
	if 200 != resp.StatusCode {
		msg := fmt.Sprintf("send article to liandi failed [sc=%d]", resp.StatusCode)
		logging.LogErrorf(msg)
		return errors.New(msg)
	}

	if 0 != result.Code {
		msg := fmt.Sprintf("send article to liandi failed [code=%d, msg=%s]", result.Code, result.Msg)
		logging.LogErrorf(msg)
		util.PushClearMsg(msgId)
		return errors.New(result.Msg)
	}

	if !foundArticle {
		articleId = result.Data.(string)
		tree, _ = loadTreeByBlockID(id) // 这里必须重新加载，因为前面导出时已经修改了树结构
		tree.Root.SetIALAttr(liandiArticleIdAttrName, articleId)
		if err = writeJSONQueue(tree); nil != err {
			return
		}
	}

	msg := fmt.Sprintf(Conf.Language(181), util.GetCloudAccountServer()+"/article/"+articleId)
	util.PushMsg(msg, 7000)
	return
}

func ExportSystemLog() (zipPath string) {
	exportFolder := filepath.Join(util.TempDir, "export", "system-log")
	os.RemoveAll(exportFolder)
	if err := os.MkdirAll(exportFolder, 0755); nil != err {
		logging.LogErrorf("create export temp folder failed: %s", err)
		return
	}

	appLog := filepath.Join(util.HomeDir, ".config", "siyuan", "app.log")
	if gulu.File.IsExist(appLog) {
		to := filepath.Join(exportFolder, "app.log")
		if err := filelock.Copy(appLog, to); nil != err {
			logging.LogErrorf("copy app log from [%s] to [%s] failed: %s", err, appLog, to)
		}
	}

	kernelLog := filepath.Join(util.HomeDir, ".config", "siyuan", "kernel.log")
	if gulu.File.IsExist(kernelLog) {
		to := filepath.Join(exportFolder, "kernel.log")
		if err := filelock.Copy(kernelLog, to); nil != err {
			logging.LogErrorf("copy kernel log from [%s] to [%s] failed: %s", err, kernelLog, to)
		}
	}

	siyuanLog := filepath.Join(util.TempDir, "siyuan.log")
	if gulu.File.IsExist(siyuanLog) {
		to := filepath.Join(exportFolder, "siyuan.log")
		if err := filelock.Copy(siyuanLog, to); nil != err {
			logging.LogErrorf("copy kernel log from [%s] to [%s] failed: %s", err, siyuanLog, to)
		}
	}

	zipPath = exportFolder + ".zip"
	zip, err := gulu.Zip.Create(zipPath)
	if nil != err {
		logging.LogErrorf("create export log zip [%s] failed: %s", exportFolder, err)
		return ""
	}

	if err = zip.AddDirectory("log", exportFolder); nil != err {
		logging.LogErrorf("create export log zip [%s] failed: %s", exportFolder, err)
		return ""
	}

	if err = zip.Close(); nil != err {
		logging.LogErrorf("close export log zip failed: %s", err)
	}

	os.RemoveAll(exportFolder)
	zipPath = "/export/" + url.PathEscape(filepath.Base(zipPath))
	return
}

func ExportNotebookSY(id string) (zipPath string) {
	zipPath = exportBoxSYZip(id)
	return
}

func ExportSY(id string) (name, zipPath string) {
	block := treenode.GetBlockTree(id)
	if nil == block {
		logging.LogErrorf("not found block [%s]", id)
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

func ExportDataInFolder(exportFolder string) (name string, err error) {
	util.PushEndlessProgress(Conf.Language(65))
	defer util.ClearPushProgress(100)

	zipPath, err := ExportData()
	if nil != err {
		return
	}
	name = filepath.Base(zipPath)
	name, err = url.PathUnescape(name)
	if nil != err {
		logging.LogErrorf("url unescape [%s] failed: %s", name, err)
		return
	}

	targetZipPath := filepath.Join(exportFolder, name)
	zipAbsPath := filepath.Join(util.TempDir, "export", name)
	err = filelock.Copy(zipAbsPath, targetZipPath)
	if nil != err {
		logging.LogErrorf("copy export zip from [%s] to [%s] failed: %s", zipAbsPath, targetZipPath, err)
		return
	}
	if removeErr := os.Remove(zipAbsPath); nil != removeErr {
		logging.LogErrorf("remove export zip failed: %s", removeErr)
	}
	return
}

func ExportData() (zipPath string, err error) {
	util.PushEndlessProgress(Conf.Language(65))
	defer util.ClearPushProgress(100)

	name := util.FilterFileName(filepath.Base(util.WorkspaceDir)) + "-" + util.CurrentTimeSecondsStr()
	exportFolder := filepath.Join(util.TempDir, "export", name)
	zipPath, err = exportData(exportFolder)
	if nil != err {
		return
	}
	zipPath = "/export/" + url.PathEscape(filepath.Base(zipPath))
	return
}

func exportData(exportFolder string) (zipPath string, err error) {
	WaitForWritingFiles()

	baseFolderName := "data-" + util.CurrentTimeSecondsStr()
	if err = os.MkdirAll(exportFolder, 0755); nil != err {
		logging.LogErrorf("create export temp folder failed: %s", err)
		return
	}

	data := filepath.Join(util.WorkspaceDir, "data")
	if err = filelock.Copy(data, exportFolder); nil != err {
		logging.LogErrorf("copy data dir from [%s] to [%s] failed: %s", data, baseFolderName, err)
		err = errors.New(fmt.Sprintf(Conf.Language(14), err.Error()))
		return
	}

	zipPath = exportFolder + ".zip"
	zip, err := gulu.Zip.Create(zipPath)
	if nil != err {
		logging.LogErrorf("create export data zip [%s] failed: %s", exportFolder, err)
		return
	}

	if err = zip.AddDirectory(baseFolderName, exportFolder); nil != err {
		logging.LogErrorf("create export data zip [%s] failed: %s", exportFolder, err)
		return
	}

	if err = zip.Close(); nil != err {
		logging.LogErrorf("close export data zip failed: %s", err)
	}

	os.RemoveAll(exportFolder)
	return
}

func ExportResources(resourcePaths []string, mainName string) (exportFilePath string, err error) {
	WaitForWritingFiles()

	// 用于导出的临时文件夹完整路径
	exportFolderPath := filepath.Join(util.TempDir, "export", mainName)
	if err = os.MkdirAll(exportFolderPath, 0755); nil != err {
		logging.LogErrorf("create export temp folder failed: %s", err)
		return
	}

	// 将需要导出的文件/文件夹复制到临时文件夹
	for _, resourcePath := range resourcePaths {
		resourceFullPath := filepath.Join(util.WorkspaceDir, resourcePath)    // 资源完整路径
		resourceBaseName := filepath.Base(resourceFullPath)                   // 资源名称
		resourceCopyPath := filepath.Join(exportFolderPath, resourceBaseName) // 资源副本完整路径
		if err = filelock.Copy(resourceFullPath, resourceCopyPath); nil != err {
			logging.LogErrorf("copy resource will be exported from [%s] to [%s] failed: %s", resourcePath, resourceCopyPath, err)
			err = fmt.Errorf(Conf.Language(14), err.Error())
			return
		}
	}

	zipFilePath := exportFolderPath + ".zip" // 导出的 *.zip 文件完整路径
	zip, err := gulu.Zip.Create(zipFilePath)
	if nil != err {
		logging.LogErrorf("create export zip [%s] failed: %s", zipFilePath, err)
		return
	}

	if err = zip.AddDirectory(mainName, exportFolderPath); nil != err {
		logging.LogErrorf("create export zip [%s] failed: %s", exportFolderPath, err)
		return
	}

	if err = zip.Close(); nil != err {
		logging.LogErrorf("close export zip failed: %s", err)
	}

	os.RemoveAll(exportFolderPath)

	exportFilePath = path.Join("temp", "export", mainName+".zip") // 导出的 *.zip 文件相对于工作区目录的路径
	return
}

func Preview(id string) (retStdHTML string, retOutline []*Path) {
	tree, _ := loadTreeByBlockID(id)
	tree = exportTree(tree, false, false, false,
		Conf.Export.BlockRefMode, Conf.Export.BlockEmbedMode, Conf.Export.FileAnnotationRefMode,
		Conf.Export.TagOpenMarker, Conf.Export.TagCloseMarker,
		Conf.Export.BlockRefTextLeft, Conf.Export.BlockRefTextRight,
		Conf.Export.AddTitle)
	luteEngine := NewLute()
	luteEngine.SetFootnotes(true)
	md := treenode.FormatNode(tree.Root, luteEngine)
	tree = parse.Parse("", []byte(md), luteEngine.ParseOptions)
	retStdHTML = luteEngine.ProtylePreview(tree, luteEngine.RenderOptions)

	if footnotesDefBlock := tree.Root.ChildByType(ast.NodeFootnotesDefBlock); nil != footnotesDefBlock {
		footnotesDefBlock.Unlink()
	}
	retOutline = outline(tree)
	return
}

func ExportDocx(id, savePath string, removeAssets, merge bool) (err error) {
	if !util.IsValidPandocBin(Conf.Export.PandocBin) {
		Conf.Export.PandocBin = util.PandocBinPath
		Conf.Save()
		if !util.IsValidPandocBin(Conf.Export.PandocBin) {
			return errors.New(Conf.Language(115))
		}
	}

	tmpDir := filepath.Join(util.TempDir, "export", gulu.Rand.String(7))
	if err = os.MkdirAll(tmpDir, 0755); nil != err {
		return
	}
	defer os.Remove(tmpDir)
	name, content := ExportMarkdownHTML(id, tmpDir, true, merge)

	tmpDocxPath := filepath.Join(tmpDir, name+".docx")
	args := []string{ // pandoc -f html --resource-path=请从这里开始 请从这里开始\index.html -o test.docx
		"-f", "html+tex_math_dollars",
		"--resource-path", tmpDir,
		"-o", tmpDocxPath,
	}

	// Pandoc template for exporting docx https://github.com/siyuan-note/siyuan/issues/8740
	docxTemplate := gulu.Str.RemoveInvisible(Conf.Export.DocxTemplate)
	docxTemplate = strings.TrimSpace(docxTemplate)
	if "" != docxTemplate {
		if !gulu.File.IsExist(docxTemplate) {
			logging.LogErrorf("docx template [%s] not found", docxTemplate)
			msg := fmt.Sprintf(Conf.Language(197), docxTemplate)
			return errors.New(msg)
		}

		args = append(args, "--reference-doc", docxTemplate)
	}

	pandoc := exec.Command(Conf.Export.PandocBin, args...)
	gulu.CmdAttr(pandoc)
	pandoc.Stdin = bytes.NewBufferString(content)
	output, err := pandoc.CombinedOutput()
	if nil != err {
		logging.LogErrorf("export docx failed: %s", gulu.Str.FromBytes(output))
		msg := fmt.Sprintf(Conf.Language(14), gulu.Str.FromBytes(output))
		return errors.New(msg)
	}

	targetPath := filepath.Join(savePath, name+".docx")
	if gulu.File.IsExist(targetPath) {
		// 先删除目标文件，以检查是否被占用 https://github.com/siyuan-note/siyuan/issues/8822
		if err := os.RemoveAll(targetPath); nil != err {
			logging.LogErrorf("export docx failed: %s", err)
			msg := fmt.Sprintf(Conf.language(215))
			return errors.New(msg)
		}
	}

	if err = filelock.Copy(tmpDocxPath, targetPath); nil != err {
		logging.LogErrorf("export docx failed: %s", err)
		return errors.New(fmt.Sprintf(Conf.Language(14), err))
	}

	if tmpAssets := filepath.Join(tmpDir, "assets"); !removeAssets && gulu.File.IsDir(tmpAssets) {
		if err = filelock.Copy(tmpAssets, filepath.Join(savePath, "assets")); nil != err {
			logging.LogErrorf("export docx failed: %s", err)
			return errors.New(fmt.Sprintf(Conf.Language(14), err))
		}
	}
	return
}

func ExportMarkdownHTML(id, savePath string, docx, merge bool) (name, dom string) {
	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return
	}

	tree := prepareExportTree(bt)

	if merge {
		var mergeErr error
		tree, mergeErr = mergeSubDocs(tree)
		if nil != mergeErr {
			logging.LogErrorf("merge sub docs failed: %s", mergeErr)
			return
		}
	}

	tree = exportTree(tree, true, true, false,
		Conf.Export.BlockRefMode, Conf.Export.BlockEmbedMode, Conf.Export.FileAnnotationRefMode,
		Conf.Export.TagOpenMarker, Conf.Export.TagCloseMarker,
		Conf.Export.BlockRefTextLeft, Conf.Export.BlockRefTextRight,
		Conf.Export.AddTitle)
	name = path.Base(tree.HPath)
	name = util.FilterFileName(name) // 导出 PDF、HTML 和 Word 时未移除不支持的文件名符号 https://github.com/siyuan-note/siyuan/issues/5614
	savePath = strings.TrimSpace(savePath)

	if err := os.MkdirAll(savePath, 0755); nil != err {
		logging.LogErrorf("mkdir [%s] failed: %s", savePath, err)
		return
	}

	assets := assetsLinkDestsInTree(tree)
	for _, asset := range assets {
		if strings.HasPrefix(asset, "assets/") {
			if strings.Contains(asset, "?") {
				asset = asset[:strings.LastIndex(asset, "?")]
			}

			srcAbsPath, err := GetAssetAbsPath(asset)
			if nil != err {
				logging.LogWarnf("resolve path of asset [%s] failed: %s", asset, err)
				continue
			}
			targetAbsPath := filepath.Join(savePath, asset)
			if err = filelock.Copy(srcAbsPath, targetAbsPath); nil != err {
				logging.LogWarnf("copy asset from [%s] to [%s] failed: %s", srcAbsPath, targetAbsPath, err)
			}
		}
	}

	srcs := []string{"stage/build/export", "stage/build/fonts", "stage/protyle"}
	for _, src := range srcs {
		from := filepath.Join(util.WorkingDir, src)
		to := filepath.Join(savePath, src)
		if err := filelock.Copy(from, to); nil != err {
			logging.LogWarnf("copy stage from [%s] to [%s] failed: %s", from, savePath, err)
			return
		}
	}

	theme := Conf.Appearance.ThemeLight
	if 1 == Conf.Appearance.Mode {
		theme = Conf.Appearance.ThemeDark
	}
	srcs = []string{"icons", "themes/" + theme}
	appearancePath := util.AppearancePath
	if util.IsSymlinkPath(util.AppearancePath) {
		// Support for symlinked theme folder when exporting HTML https://github.com/siyuan-note/siyuan/issues/9173
		var readErr error
		appearancePath, readErr = filepath.EvalSymlinks(util.AppearancePath)
		if nil != readErr {
			logging.LogErrorf("readlink [%s] failed: %s", util.AppearancePath, readErr)
			return
		}
	}

	for _, src := range srcs {
		from := filepath.Join(appearancePath, src)
		to := filepath.Join(savePath, "appearance", src)
		if err := filelock.Copy(from, to); nil != err {
			logging.LogErrorf("copy appearance from [%s] to [%s] failed: %s", from, savePath, err)
			return
		}
	}

	// 复制自定义表情图片
	emojis := emojisInTree(tree)
	for _, emoji := range emojis {
		from := filepath.Join(util.DataDir, emoji)
		to := filepath.Join(savePath, emoji)
		if err := filelock.Copy(from, to); nil != err {
			logging.LogErrorf("copy emojis from [%s] to [%s] failed: %s", from, savePath, err)
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

	// 自定义表情图片地址去掉开头的 /
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if ast.NodeEmojiImg == n.Type {
			n.Tokens = bytes.ReplaceAll(n.Tokens, []byte("src=\"/emojis"), []byte("src=\"emojis"))
		}
		return ast.WalkContinue
	})

	if docx {
		renderer := render.NewProtyleExportDocxRenderer(tree, luteEngine.RenderOptions)
		output := renderer.Render()
		dom = gulu.Str.FromBytes(output)
	} else {
		dom = luteEngine.ProtylePreview(tree, luteEngine.RenderOptions)
	}
	return
}

func ExportHTML(id, savePath string, pdf, image, keepFold, merge bool) (name, dom string) {
	savePath = strings.TrimSpace(savePath)

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return
	}

	tree := prepareExportTree(bt)

	if merge {
		var mergeErr error
		tree, mergeErr = mergeSubDocs(tree)
		if nil != mergeErr {
			logging.LogErrorf("merge sub docs failed: %s", mergeErr)
			return
		}
	}

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

	tree = exportTree(tree, true, true, keepFold,
		Conf.Export.BlockRefMode, Conf.Export.BlockEmbedMode, Conf.Export.FileAnnotationRefMode,
		Conf.Export.TagOpenMarker, Conf.Export.TagCloseMarker,
		Conf.Export.BlockRefTextLeft, Conf.Export.BlockRefTextRight,
		Conf.Export.AddTitle)
	name = path.Base(tree.HPath)
	name = util.FilterFileName(name) // 导出 PDF、HTML 和 Word 时未移除不支持的文件名符号 https://github.com/siyuan-note/siyuan/issues/5614

	if "" != savePath {
		if err := os.MkdirAll(savePath, 0755); nil != err {
			logging.LogErrorf("mkdir [%s] failed: %s", savePath, err)
			return
		}

		assets := assetsLinkDestsInTree(tree)
		for _, asset := range assets {
			if strings.Contains(asset, "?") {
				asset = asset[:strings.LastIndex(asset, "?")]
			}

			srcAbsPath, err := GetAssetAbsPath(asset)
			if nil != err {
				logging.LogWarnf("resolve path of asset [%s] failed: %s", asset, err)
				continue
			}
			targetAbsPath := filepath.Join(savePath, asset)
			if err = filelock.Copy(srcAbsPath, targetAbsPath); nil != err {
				logging.LogWarnf("copy asset from [%s] to [%s] failed: %s", srcAbsPath, targetAbsPath, err)
			}
		}
	}

	luteEngine := NewLute()
	if !pdf && "" != savePath { // 导出 HTML 需要复制静态资源
		srcs := []string{"stage/build/export", "stage/build/fonts", "stage/protyle"}
		for _, src := range srcs {
			from := filepath.Join(util.WorkingDir, src)
			to := filepath.Join(savePath, src)
			if err := filelock.Copy(from, to); nil != err {
				logging.LogErrorf("copy stage from [%s] to [%s] failed: %s", from, savePath, err)
				return
			}
		}

		theme := Conf.Appearance.ThemeLight
		if 1 == Conf.Appearance.Mode {
			theme = Conf.Appearance.ThemeDark
		}
		srcs = []string{"icons", "themes/" + theme}
		appearancePath := util.AppearancePath
		if util.IsSymlinkPath(util.AppearancePath) {
			// Support for symlinked theme folder when exporting HTML https://github.com/siyuan-note/siyuan/issues/9173
			var readErr error
			appearancePath, readErr = filepath.EvalSymlinks(util.AppearancePath)
			if nil != readErr {
				logging.LogErrorf("readlink [%s] failed: %s", util.AppearancePath, readErr)
				return
			}
		}
		for _, src := range srcs {
			from := filepath.Join(appearancePath, src)
			to := filepath.Join(savePath, "appearance", src)
			if err := filelock.Copy(from, to); nil != err {
				logging.LogErrorf("copy appearance from [%s] to [%s] failed: %s", from, savePath, err)
				return
			}
		}

		// 复制自定义表情图片
		emojis := emojisInTree(tree)
		for _, emoji := range emojis {
			from := filepath.Join(util.DataDir, emoji)
			to := filepath.Join(savePath, emoji)
			if err := filelock.Copy(from, to); nil != err {
				logging.LogErrorf("copy emojis from [%s] to [%s] failed: %s", from, savePath, err)
				return
			}
		}
	}

	if pdf {
		processIFrame(tree)
	}

	luteEngine.SetFootnotes(true)
	luteEngine.RenderOptions.ProtyleContenteditable = false
	luteEngine.SetProtyleMarkNetImg(false)
	// 不进行安全过滤，因为导出时需要保留所有的 HTML 标签
	// 使用属性 `data-export-html` 导出时 `<style></style>` 标签丢失 https://github.com/siyuan-note/siyuan/issues/6228
	luteEngine.SetSanitize(false)
	renderer := render.NewProtyleExportRenderer(tree, luteEngine.RenderOptions)
	dom = gulu.Str.FromBytes(renderer.Render())
	return
}

func prepareExportTree(bt *treenode.BlockTree) (ret *parse.Tree) {
	luteEngine := NewLute()
	ret, _ = filesys.LoadTree(bt.BoxID, bt.Path, luteEngine)
	if "d" != bt.Type {
		node := treenode.GetNodeInTree(ret, bt.ID)
		nodes := []*ast.Node{node}
		if "h" == bt.Type {
			children := treenode.HeadingChildren(node)
			for _, child := range children {
				nodes = append(nodes, child)
			}
		}

		ret = parse.Parse("", []byte(""), luteEngine.ParseOptions)
		first := ret.Root.FirstChild
		for _, node := range nodes {
			first.InsertBefore(node)
		}
	}
	ret.Path = bt.Path
	ret.HPath = bt.HPath
	ret.Box = bt.BoxID
	ret.ID = bt.RootID
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

func ProcessPDF(id, p string, merge, removeAssets bool) (err error) {
	tree, _ := loadTreeByBlockID(id)
	if nil == tree {
		return
	}

	if merge {
		var mergeErr error
		tree, mergeErr = mergeSubDocs(tree)
		if nil != mergeErr {
			logging.LogErrorf("merge sub docs failed: %s", mergeErr)
			return
		}
	}

	var headings []*ast.Node
	assetDests := assetsLinkDestsInTree(tree)
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeHeading == n.Type && !n.ParentIs(ast.NodeBlockquote) {
			headings = append(headings, n)
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})

	pdfCtx, ctxErr := api.ReadContextFile(p)
	if nil != ctxErr {
		logging.LogErrorf("read pdf context failed: %s", ctxErr)
		return
	}

	processPDFBookmarks(pdfCtx, headings)
	processPDFLinkEmbedAssets(pdfCtx, assetDests, removeAssets)

	pdfcpu.VersionStr = "SiYuan v" + util.Ver
	if writeErr := api.WriteContextFile(pdfCtx, p); nil != writeErr {
		logging.LogErrorf("write pdf context failed: %s", writeErr)
		return
	}
	return
}

func processPDFBookmarks(pdfCtx *pdfcpu.Context, headings []*ast.Node) {
	links, err := api.ListToCLinks(pdfCtx)
	if nil != err {
		return
	}

	sort.Slice(links, func(i, j int) bool {
		return links[i].Page < links[j].Page
	})

	bms := map[string]*pdfcpu.Bookmark{}
	for _, link := range links {
		linkID := link.URI[strings.LastIndex(link.URI, "/")+1:]
		b := sql.GetBlock(linkID)
		if nil == b {
			logging.LogWarnf("pdf outline block [%s] not found", linkID)
			continue
		}
		title := b.Content
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

	var topBms []*pdfcpu.Bookmark
	stack := linkedliststack.New()
	for _, h := range headings {
	L:
		for ; ; stack.Pop() {
			cur, ok := stack.Peek()
			if !ok {
				bm := bms[h.ID]
				if nil == bm {
					break L
				}
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

	err = pdfCtx.AddBookmarks(topBms)
	if nil != err {
		logging.LogErrorf("add bookmark failed: %s", err)
		return
	}
}

// processPDFLinkEmbedAssets 处理资源文件超链接，根据 removeAssets 参数决定是否将资源文件嵌入到 PDF 中。
// 导出 PDF 时支持将资源文件作为附件嵌入 https://github.com/siyuan-note/siyuan/issues/7414
func processPDFLinkEmbedAssets(pdfCtx *pdfcpu.Context, assetDests []string, removeAssets bool) {
	var assetAbsPaths []string
	for _, dest := range assetDests {
		if absPath, _ := GetAssetAbsPath(dest); "" != absPath {
			assetAbsPaths = append(assetAbsPaths, absPath)
		}
	}

	if 1 > len(assetAbsPaths) {
		return
	}

	assetLinks, otherLinks, listErr := api.ListLinks(pdfCtx)
	if nil != listErr {
		logging.LogErrorf("list asset links failed: %s", listErr)
		return
	}

	if _, removeErr := pdfCtx.RemoveAnnotations(nil, nil, nil, false); nil != removeErr {
		logging.LogWarnf("remove annotations failed: %s", removeErr)
	}

	linkMap := map[int][]pdfcpu.AnnotationRenderer{}
	for _, link := range otherLinks {
		link.URI, _ = url.PathUnescape(link.URI)
		if 1 > len(linkMap[link.Page]) {
			linkMap[link.Page] = []pdfcpu.AnnotationRenderer{link}
		} else {
			linkMap[link.Page] = append(linkMap[link.Page], link)
		}
	}

	attachmentMap := map[int][]*pdfcpu.IndirectRef{}
	now := pdfcpu.StringLiteral(pdfcpu.DateString(time.Now()))
	for _, link := range assetLinks {
		link.URI = strings.ReplaceAll(link.URI, "http://"+util.LocalHost+":"+util.ServerPort+"/export/temp/", "")
		link.URI = strings.ReplaceAll(link.URI, "http://"+util.LocalHost+":"+util.ServerPort+"/", "") // Exporting PDF embedded asset files as attachments fails https://github.com/siyuan-note/siyuan/issues/7414#issuecomment-1704573557
		link.URI, _ = url.PathUnescape(link.URI)
		if idx := strings.Index(link.URI, "?"); 0 < idx {
			link.URI = link.URI[:idx]
		}

		if !removeAssets {
			// 不移除资源文件夹的话将超链接指向资源文件夹
			if 1 > len(linkMap[link.Page]) {
				linkMap[link.Page] = []pdfcpu.AnnotationRenderer{link}
			} else {
				linkMap[link.Page] = append(linkMap[link.Page], link)
			}

			continue
		}

		// 移除资源文件夹的话使用内嵌附件

		absPath, getErr := GetAssetAbsPath(link.URI)
		if nil != getErr {
			continue
		}

		ir, newErr := pdfCtx.XRefTable.NewEmbeddedFileStreamDict(absPath)
		if nil != newErr {
			logging.LogWarnf("new embedded file stream dict failed: %s", newErr)
			continue
		}

		fn := filepath.Base(absPath)
		fileSpecDict, newErr := pdfCtx.XRefTable.NewFileSpecDict(fn, pdfcpu.EncodeUTF16String(fn), "attached by SiYuan", *ir)
		if nil != newErr {
			logging.LogWarnf("new file spec dict failed: %s", newErr)
			continue
		}

		ir, indErr := pdfCtx.XRefTable.IndRefForNewObject(fileSpecDict)
		if nil != indErr {
			logging.LogWarnf("ind ref for new object failed: %s", indErr)
			continue
		}

		lx := link.Rect.LL.X + link.Rect.Width()
		ly := link.Rect.LL.Y + link.Rect.Height()/2
		ux := lx + link.Rect.Height()/2
		uy := ly + link.Rect.Height()/2

		d := pdfcpu.Dict(
			map[string]pdfcpu.Object{
				"Type":         pdfcpu.Name("Annot"),
				"Subtype":      pdfcpu.Name("FileAttachment"),
				"Contents":     pdfcpu.StringLiteral(""),
				"Rect":         pdfcpu.Rect(lx, ly, ux, uy).Array(),
				"P":            link.P,
				"M":            now,
				"F":            pdfcpu.Integer(0),
				"Border":       pdfcpu.NewIntegerArray(0, 0, 1),
				"C":            pdfcpu.NewNumberArray(0.5, 0.0, 0.5),
				"CA":           pdfcpu.Float(0.95),
				"CreationDate": now,
				"Name":         pdfcpu.Name("FileAttachment"),
				"FS":           *ir,
				"NM":           pdfcpu.StringLiteral(""),
			},
		)

		ann, indErr := pdfCtx.XRefTable.IndRefForNewObject(d)
		if nil != indErr {
			logging.LogWarnf("ind ref for new object failed: %s", indErr)
			continue
		}

		pageDictIndRef, pageErr := pdfCtx.PageDictIndRef(link.Page)
		if nil != pageErr {
			logging.LogWarnf("page dict ind ref failed: %s", pageErr)
			continue
		}

		d, defErr := pdfCtx.DereferenceDict(*pageDictIndRef)
		if nil != defErr {
			logging.LogWarnf("dereference dict failed: %s", defErr)
			continue
		}

		if 1 > len(attachmentMap[link.Page]) {
			attachmentMap[link.Page] = []*pdfcpu.IndirectRef{ann}
		} else {
			attachmentMap[link.Page] = append(attachmentMap[link.Page], ann)
		}
	}

	if 0 < len(linkMap) {
		if _, addErr := pdfCtx.AddAnnotationsMap(linkMap, false); nil != addErr {
			logging.LogErrorf("add annotations map failed: %s", addErr)
		}
	}

	// 添加附件注解指向内嵌的附件
	for page, anns := range attachmentMap {
		pageDictIndRef, pageErr := pdfCtx.PageDictIndRef(page)
		if nil != pageErr {
			logging.LogWarnf("page dict ind ref failed: %s", pageErr)
			continue
		}

		pageDict, defErr := pdfCtx.DereferenceDict(*pageDictIndRef)
		if nil != defErr {
			logging.LogWarnf("dereference dict failed: %s", defErr)
			continue
		}

		array := pdfcpu.Array{}
		for _, ann := range anns {
			array = append(array, *ann)
		}

		obj, found := pageDict.Find("Annots")
		if !found {
			pageDict.Insert("Annots", array)
			pdfCtx.EnsureVersionForWriting()
			continue
		}

		ir, ok := obj.(pdfcpu.IndirectRef)
		if !ok {
			pageDict.Update("Annots", append(obj.(pdfcpu.Array), array...))
			pdfCtx.EnsureVersionForWriting()
			continue
		}

		// Annots array is an IndirectReference.

		o, err := pdfCtx.Dereference(ir)
		if err != nil || o == nil {
			continue
		}

		annots, _ := o.(pdfcpu.Array)
		entry, ok := pdfCtx.FindTableEntryForIndRef(&ir)
		if !ok {
			continue
		}
		entry.Object = append(annots, array...)
		pdfCtx.EnsureVersionForWriting()
	}
}

func ExportStdMarkdown(id string) string {
	tree, err := loadTreeByBlockID(id)
	if nil != err {
		logging.LogErrorf("load tree by block id [%s] failed: %s", id, err)
		return ""
	}

	cloudAssetsBase := ""
	if IsSubscriber() {
		cloudAssetsBase = util.GetCloudAssetsServer() + Conf.User.UserId + "/"
	}
	return exportMarkdownContent0(tree, cloudAssetsBase, false,
		Conf.Export.BlockRefMode, Conf.Export.BlockEmbedMode, Conf.Export.FileAnnotationRefMode,
		Conf.Export.TagOpenMarker, Conf.Export.TagCloseMarker,
		Conf.Export.BlockRefTextLeft, Conf.Export.BlockRefTextRight,
		Conf.Export.AddTitle)
}

func ExportPandocConvertZip(id, pandocTo, ext string) (name, zipPath string) {
	block := treenode.GetBlockTree(id)
	if nil == block {
		logging.LogErrorf("not found block [%s]", id)
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

	zipPath = exportPandocConvertZip(boxID, baseFolderName, docPaths, "gfm+footnotes", pandocTo, ext)
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
			logging.LogErrorf("not found block")
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
	zipPath = exportPandocConvertZip(boxID, baseFolderName, docPaths, "", "", ".md")
	return
}

func yfm(docIAL map[string]string) string {
	// 导出 Markdown 文件时开头附上一些元数据 https://github.com/siyuan-note/siyuan/issues/6880
	// 导出 Markdown 时在文档头添加 YFM 开关https://github.com/siyuan-note/siyuan/issues/7727
	if !Conf.Export.MarkdownYFM {
		return ""
	}

	buf := bytes.Buffer{}
	buf.WriteString("---\n")
	var title, created, updated, tags string
	for k, v := range docIAL {
		if "id" == k {
			createdTime, parseErr := time.Parse("20060102150405", util.TimeFromID(v))
			if nil == parseErr {
				created = createdTime.Format(time.RFC3339)
			}
			continue
		}
		if "title" == k {
			title = v
			continue
		}
		if "updated" == k {
			updatedTime, parseErr := time.Parse("20060102150405", v)
			if nil == parseErr {
				updated = updatedTime.Format(time.RFC3339)
			}
			continue
		}
		if "tags" == k {
			tags = v
			continue
		}
	}
	if "" != title {
		buf.WriteString("title: ")
		buf.WriteString(title)
		buf.WriteString("\n")
	}
	if "" == updated {
		updated = time.Now().Format(time.RFC3339)
	}
	if "" == created {
		created = updated
	}
	buf.WriteString("date: ")
	buf.WriteString(created)
	buf.WriteString("\n")
	buf.WriteString("lastmod: ")
	buf.WriteString(updated)
	buf.WriteString("\n")
	if "" != tags {
		buf.WriteString("tags: [")
		buf.WriteString(tags)
		buf.WriteString("]\n")
	}
	buf.WriteString("---\n\n")
	return buf.String()
}

func exportBoxSYZip(boxID string) (zipPath string) {
	box := Conf.Box(boxID)
	if nil == box {
		logging.LogErrorf("not found box [%s]", boxID)
		return
	}
	baseFolderName := box.Name

	var docPaths []string
	docFiles := box.ListFiles("/")
	for _, docFile := range docFiles {
		docPaths = append(docPaths, docFile.path)
	}
	zipPath = exportSYZip(boxID, "/", baseFolderName, docPaths)
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
		logging.LogErrorf("create export temp folder failed: %s", err)
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
		data, readErr := filelock.ReadFile(readPath)
		if nil != readErr {
			logging.LogErrorf("read file [%s] failed: %s", readPath, readErr)
			continue
		}

		writePath := strings.TrimPrefix(tree.Path, rootDirPath)
		writePath = filepath.Join(exportFolder, writePath)
		writeFolder := filepath.Dir(writePath)
		if mkdirErr := os.MkdirAll(writeFolder, 0755); nil != mkdirErr {
			logging.LogErrorf("create export temp folder [%s] failed: %s", writeFolder, mkdirErr)
			continue
		}
		if writeErr := os.WriteFile(writePath, data, 0644); nil != writeErr {
			logging.LogErrorf("write export file [%s] failed: %s", writePath, writeErr)
			continue
		}
	}

	// 引用树放在导出文件夹根路径下
	for treeID, tree := range refTrees {
		readPath := filepath.Join(util.DataDir, tree.Box, tree.Path)
		data, readErr := filelock.ReadFile(readPath)
		if nil != readErr {
			logging.LogErrorf("read file [%s] failed: %s", readPath, readErr)
			continue
		}

		writePath := strings.TrimPrefix(tree.Path, rootDirPath)
		writePath = filepath.Join(exportFolder, treeID+".sy")
		if writeErr := os.WriteFile(writePath, data, 0644); nil != writeErr {
			logging.LogErrorf("write export file [%s] failed: %s", writePath, writeErr)
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
		titleImgPath := treenode.GetDocTitleImgPath(tree.Root) // Export .sy.zip doc title image is not exported https://github.com/siyuan-note/siyuan/issues/8748
		if "" != titleImgPath {
			assets = append(assets, titleImgPath)
		}

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
				logging.LogWarnf("get asset [%s] abs path failed: %s", asset, assetErr)
				continue
			}

			destPath := filepath.Join(exportFolder, asset)
			assetErr = filelock.Copy(srcPath, destPath)
			if nil != assetErr {
				logging.LogErrorf("copy asset from [%s] to [%s] failed: %s", srcPath, destPath, assetErr)
				continue
			}

			if !gulu.File.IsDir(srcPath) && strings.HasSuffix(strings.ToLower(srcPath), ".pdf") {
				sya := srcPath + ".sya"
				if gulu.File.IsExist(sya) {
					// Related PDF annotation information is not exported when exporting .sy.zip https://github.com/siyuan-note/siyuan/issues/7836
					if syaErr := filelock.Copy(sya, destPath+".sya"); nil != syaErr {
						logging.LogErrorf("copy sya from [%s] to [%s] failed: %s", sya, destPath+".sya", syaErr)
					}
				}
			}

			copiedAssets.Add(asset)
		}
	}

	// 导出数据库 Attribute View export https://github.com/siyuan-note/siyuan/issues/8710
	exportStorageAvDir := filepath.Join(exportFolder, "storage", "av")
	for _, tree := range trees {
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			if ast.NodeAttributeView != n.Type {
				return ast.WalkContinue
			}

			avID := n.AttributeViewID
			avJSONPath := av.GetAttributeViewDataPath(avID)
			if !gulu.File.IsExist(avJSONPath) {
				return ast.WalkContinue
			}

			if copyErr := filelock.Copy(avJSONPath, filepath.Join(exportStorageAvDir, avID+".json")); nil != copyErr {
				logging.LogErrorf("copy av json failed: %s", copyErr)
			}
			return ast.WalkContinue
		})
	}

	// 导出自定义排序
	sortPath := filepath.Join(util.DataDir, box.ID, ".siyuan", "sort.json")
	fullSortIDs := map[string]int{}
	sortIDs := map[string]int{}
	var sortData []byte
	var sortErr error
	if gulu.File.IsExist(sortPath) {
		sortData, sortErr = filelock.ReadFile(sortPath)
		if nil != sortErr {
			logging.LogErrorf("read sort conf failed: %s", sortErr)
		}

		if sortErr = gulu.JSON.UnmarshalJSON(sortData, &fullSortIDs); nil != sortErr {
			logging.LogErrorf("unmarshal sort conf failed: %s", sortErr)
		}

		if 0 < len(fullSortIDs) {
			for _, tree := range trees {
				if v, ok := fullSortIDs[tree.ID]; ok {
					sortIDs[tree.ID] = v
				}
			}
		}

		if 0 < len(sortIDs) {
			sortData, sortErr = gulu.JSON.MarshalJSON(sortIDs)
			if nil != sortErr {
				logging.LogErrorf("marshal sort conf failed: %s", sortErr)
			}
			if 0 < len(sortData) {
				confDir := filepath.Join(exportFolder, ".siyuan")
				if mkdirErr := os.MkdirAll(confDir, 0755); nil != mkdirErr {
					logging.LogErrorf("create export conf folder [%s] failed: %s", confDir, mkdirErr)
				} else {
					sortPath = filepath.Join(confDir, "sort.json")
					if writeErr := os.WriteFile(sortPath, sortData, 0644); nil != writeErr {
						logging.LogErrorf("write sort conf failed: %s", writeErr)
					}
				}
			}
		}
	}

	zipPath = exportFolder + ".sy.zip"
	zip, err := gulu.Zip.Create(zipPath)
	if nil != err {
		logging.LogErrorf("create export .sy.zip [%s] failed: %s", exportFolder, err)
		return ""
	}

	if err = zip.AddDirectory(baseFolderName, exportFolder); nil != err {
		logging.LogErrorf("create export .sy.zip [%s] failed: %s", exportFolder, err)
		return ""
	}

	if err = zip.Close(); nil != err {
		logging.LogErrorf("close export .sy.zip failed: %s", err)
	}

	os.RemoveAll(exportFolder)
	zipPath = "/export/" + url.PathEscape(filepath.Base(zipPath))
	return
}

func ExportMarkdownContent(id string) (hPath, exportedMd string) {
	return exportMarkdownContent(id)
}

func exportMarkdownContent(id string) (hPath, exportedMd string) {
	tree, err := loadTreeByBlockID(id)
	if nil != err {
		logging.LogErrorf("load tree by block id [%s] failed: %s", id, err)
		return
	}
	hPath = tree.HPath
	exportedMd = exportMarkdownContent0(tree, "", false,
		Conf.Export.BlockRefMode, Conf.Export.BlockEmbedMode, Conf.Export.FileAnnotationRefMode,
		Conf.Export.TagOpenMarker, Conf.Export.TagCloseMarker,
		Conf.Export.BlockRefTextLeft, Conf.Export.BlockRefTextRight,
		Conf.Export.AddTitle)
	docIAL := parse.IAL2Map(tree.Root.KramdownIAL)
	exportedMd = yfm(docIAL) + exportedMd
	return
}

func exportMarkdownContent0(tree *parse.Tree, cloudAssetsBase string, assetsDestSpace2Underscore bool,
	blockRefMode, blockEmbedMode, fileAnnotationRefMode int,
	tagOpenMarker, tagCloseMarker string,
	blockRefTextLeft, blockRefTextRight string,
	addTitle bool) (ret string) {
	tree = exportTree(tree, false, true, false,
		blockRefMode, blockEmbedMode, fileAnnotationRefMode,
		tagOpenMarker, tagCloseMarker,
		blockRefTextLeft, blockRefTextRight,
		addTitle)
	luteEngine := NewLute()
	luteEngine.SetFootnotes(true)
	luteEngine.SetKramdownIAL(false)
	if "" != cloudAssetsBase {
		luteEngine.RenderOptions.LinkBase = cloudAssetsBase
	}
	if assetsDestSpace2Underscore { // 上传到社区图床的资源文件会将空格转为下划线，所以这里也需要将文档内容做相应的转换
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			if ast.NodeLinkDest == n.Type {
				if util.IsAssetLinkDest(n.Tokens) {
					n.Tokens = bytes.ReplaceAll(n.Tokens, []byte(" "), []byte("_"))
				}
			} else if n.IsTextMarkType("a") {
				href := n.TextMarkAHref
				if util.IsAssetLinkDest([]byte(href)) {
					n.TextMarkAHref = strings.ReplaceAll(href, " ", "_")
				}
			}
			return ast.WalkContinue
		})
	}

	renderer := render.NewProtyleExportMdRenderer(tree, luteEngine.RenderOptions)
	ret = gulu.Str.FromBytes(renderer.Render())
	return
}

func processKaTexMacros(n *ast.Node) {
	if ast.NodeMathBlockContent != n.Type && ast.NodeTextMark != n.Type {
		return
	}
	if ast.NodeTextMark == n.Type && !n.IsTextMarkType("inline-math") {
		return
	}

	var mathContent string
	if ast.NodeTextMark == n.Type {
		mathContent = n.TextMarkInlineMathContent
	} else {
		mathContent = string(n.Tokens)
	}
	mathContent = strings.TrimSpace(mathContent)
	if "" == mathContent {
		return
	}

	macros := map[string]string{}
	if err := gulu.JSON.UnmarshalJSON([]byte(Conf.Editor.KaTexMacros), &macros); nil != err {
		logging.LogWarnf("parse katex macros failed: %s", err)
		return
	}

	var keys []string
	for k := range macros {
		keys = append(keys, k)
	}
	useMacro := false
	for k := range macros {
		if strings.Contains(mathContent, k) {
			useMacro = true
			break
		}
	}
	if !useMacro {
		return
	}
	sort.Slice(keys, func(i, j int) bool { return len(keys[i]) > len(keys[j]) })

	mathContent = escapeKaTexSupportedFunctions(mathContent)
	usedMacros := extractUsedMacros(mathContent, &keys)
	for _, usedMacro := range usedMacros {
		expanded := resolveKaTexMacro(usedMacro, &macros, &keys)
		expanded = unescapeKaTexSupportedFunctions(expanded)
		mathContent = strings.ReplaceAll(mathContent, usedMacro, expanded)
	}
	mathContent = unescapeKaTexSupportedFunctions(mathContent)
	if ast.NodeTextMark == n.Type {
		n.TextMarkInlineMathContent = mathContent
	} else {
		n.Tokens = []byte(mathContent)
	}
}

func exportTree(tree *parse.Tree, wysiwyg, expandKaTexMacros, keepFold bool,
	blockRefMode, blockEmbedMode, fileAnnotationRefMode int,
	tagOpenMarker, tagCloseMarker string,
	blockRefTextLeft, blockRefTextRight string,
	addTitle bool) (ret *parse.Tree) {
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
		stmt = strings.ReplaceAll(stmt, editor.IALValEscNewLine, "\n")
		embedBlocks := searchEmbedBlock(n.ID, stmt, nil, 0, false)
		if 1 > len(embedBlocks) {
			return ast.WalkContinue
		}

		defMdBuf := bytes.Buffer{}
		for _, def := range embedBlocks {
			defMdBuf.WriteString(renderBlockMarkdownR(def.Block.ID))
			defMdBuf.WriteString("\n\n")
		}
		defMd = defMdBuf.String()

		buf := &bytes.Buffer{}
		lines := strings.Split(defMd, "\n")
		for i, line := range lines {
			if 0 == blockEmbedMode { // 原始文本
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
	if 4 == blockRefMode { // 块引转脚注
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
		case ast.NodeSuperBlockOpenMarker, ast.NodeSuperBlockLayoutMarker, ast.NodeSuperBlockCloseMarker:
			if !wysiwyg {
				unlinks = append(unlinks, n)
				return ast.WalkContinue
			}
		case ast.NodeHeading:
			n.HeadingNormalizedID = n.IALAttr("id")
			n.ID = n.HeadingNormalizedID
		case ast.NodeMathBlockContent:
			n.Tokens = bytes.TrimSpace(n.Tokens) // 导出 Markdown 时去除公式内容中的首尾空格 https://github.com/siyuan-note/siyuan/issues/4666
			return ast.WalkContinue
		case ast.NodeTextMark:
			if n.IsTextMarkType("inline-math") {
				n.TextMarkInlineMathContent = strings.TrimSpace(n.TextMarkInlineMathContent)
				return ast.WalkContinue
			} else if treenode.IsFileAnnotationRef(n) {
				refID := n.TextMarkFileAnnotationRefID
				if !strings.Contains(refID, "/") {
					return ast.WalkSkipChildren
				}

				status := processFileAnnotationRef(refID, n, fileAnnotationRefMode)
				unlinks = append(unlinks, n)
				return status
			} else if n.IsTextMarkType("tag") {
				if !wysiwyg {
					n.Type = ast.NodeText
					n.Tokens = []byte(tagOpenMarker + n.TextMarkTextContent + tagCloseMarker)
					return ast.WalkContinue
				}
			}
		}

		if !treenode.IsBlockRef(n) {
			return ast.WalkContinue
		}

		// 处理引用节点

		defID, linkText, _ := treenode.GetBlockRef(n)
		if "" == linkText {
			linkText = sql.GetRefText(defID)
		}
		linkText = html.UnescapeHTMLStr(linkText) // 块引锚文本导出时 `&` 变为实体 `&amp;` https://github.com/siyuan-note/siyuan/issues/7659
		if Conf.Editor.BlockRefDynamicAnchorTextMaxLen < utf8.RuneCountInString(linkText) {
			linkText = gulu.Str.SubStr(linkText, Conf.Editor.BlockRefDynamicAnchorTextMaxLen) + "..."
		}
		linkText = blockRefTextLeft + linkText + blockRefTextRight

		defTree, _ := loadTreeByBlockID(defID)
		if nil == defTree {
			return ast.WalkContinue
		}

		switch blockRefMode {
		case 2: // 锚文本块链
			var blockRefLink *ast.Node
			blockRefLink = &ast.Node{Type: ast.NodeLink}
			blockRefLink.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
			blockRefLink.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte(linkText)})
			blockRefLink.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
			blockRefLink.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
			blockRefLink.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("siyuan://blocks/" + defID)})
			blockRefLink.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
			n.InsertBefore(blockRefLink)
		case 3: // 仅锚文本
			n.InsertBefore(&ast.Node{Type: ast.NodeText, Tokens: []byte(linkText)})
		case 4: // 脚注
			refFoot := getRefAsFootnotes(defID, &refFootnotes)
			n.InsertBefore(&ast.Node{Type: ast.NodeText, Tokens: []byte(linkText)})
			n.InsertBefore(&ast.Node{Type: ast.NodeFootnotesRef, Tokens: []byte("^" + refFoot.refNum), FootnotesRefId: refFoot.refNum, FootnotesRefLabel: []byte("^" + refFoot.refNum)})
		}
		unlinks = append(unlinks, n)
		if nil != n.Next && ast.NodeKramdownSpanIAL == n.Next.Type {
			// 引用加排版标记（比如颜色）重叠时丢弃后面的排版属性节点
			unlinks = append(unlinks, n.Next)
		}
		return ast.WalkSkipChildren
	})
	for _, n := range unlinks {
		n.Unlink()
	}

	if 4 == blockRefMode { // 块引转脚注
		if footnotesDefBlock := resolveFootnotesDefs(&refFootnotes, ret.Root.ID, blockRefTextLeft, blockRefTextRight); nil != footnotesDefBlock {
			ret.Root.AppendChild(footnotesDefBlock)
		}
	}

	if addTitle {
		if root, _ := getBlock(id, tree); nil != root {
			title := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1, KramdownIAL: parse.Map2IAL(root.IAL)}
			content := html.UnescapeString(root.Content)
			title.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(content)})
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
	var emptyParagraphs []*ast.Node
	ast.Walk(ret.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		// 支持按照现有折叠状态导出 PDF https://github.com/siyuan-note/siyuan/issues/5941
		if !keepFold {
			// 块折叠以后导出 HTML/PDF 固定展开 https://github.com/siyuan-note/siyuan/issues/4064
			n.RemoveIALAttr("fold")
			n.RemoveIALAttr("heading-fold")
		} else {
			if "1" == n.IALAttr("heading-fold") {
				unlinks = append(unlinks, n)
				return ast.WalkContinue
			}
		}

		// 导出时去掉内容块闪卡样式 https://github.com/siyuan-note/siyuan/issues/7374
		if n.IsBlock() {
			n.RemoveIALAttr("custom-riff-decks")
		}

		switch n.Type {
		case ast.NodeParagraph:
			if nil == n.FirstChild {
				// 空的段落块需要补全文本展位，否则后续格式化后再解析树会语义不一致 https://github.com/siyuan-note/siyuan/issues/5806
				emptyParagraphs = append(emptyParagraphs, n)
			}
		case ast.NodeMathBlockContent:
			if expandKaTexMacros {
				processKaTexMacros(n)
			}
		case ast.NodeTextMark:
			if expandKaTexMacros && n.IsTextMarkType("inline-math") {
				processKaTexMacros(n)
			}
		case ast.NodeWidget:
			// 挂件块导出 https://github.com/siyuan-note/siyuan/issues/3834 https://github.com/siyuan-note/siyuan/issues/6188

			if wysiwyg {
				exportHtmlVal := n.IALAttr("data-export-html")
				if "" != exportHtmlVal {
					htmlBlock := &ast.Node{Type: ast.NodeHTMLBlock, Tokens: []byte(exportHtmlVal)}
					n.InsertBefore(htmlBlock)
					unlinks = append(unlinks, n)
					return ast.WalkContinue
				}
			}

			exportMdVal := n.IALAttr("data-export-md")
			exportMdVal = html.UnescapeString(exportMdVal) // 导出 `data-export-md` 时未解析代码块与行内代码内的转义字符 https://github.com/siyuan-note/siyuan/issues/4180
			if "" != exportMdVal {
				luteEngine0 := util.NewLute()
				luteEngine0.SetYamlFrontMatter(true) // 挂件导出属性 `data-export-md` 支持 YFM https://github.com/siyuan-note/siyuan/issues/7752
				exportMdTree := parse.Parse("", []byte(exportMdVal), luteEngine0.ParseOptions)
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
		case ast.NodeSuperBlockOpenMarker, ast.NodeSuperBlockLayoutMarker, ast.NodeSuperBlockCloseMarker:
			if !wysiwyg {
				unlinks = append(unlinks, n)
			}
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
	for _, emptyParagraph := range emptyParagraphs {
		emptyParagraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(editor.Zwj)})
	}

	unlinks = nil
	// Attribute View export https://github.com/siyuan-note/siyuan/issues/8710
	ast.Walk(ret.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeAttributeView != n.Type {
			return ast.WalkContinue
		}

		avID := n.AttributeViewID
		if avJSONPath := av.GetAttributeViewDataPath(avID); !gulu.File.IsExist(avJSONPath) {
			return ast.WalkContinue
		}

		attrView, err := av.ParseAttributeView(avID)
		if nil != err {
			logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
			return ast.WalkContinue
		}

		var view *av.View
		if "" != attrView.ViewID {
			for _, v := range attrView.Views {
				if v.ID == attrView.ViewID {
					view = v
					break
				}
			}
		} else {
			view = attrView.Views[0]
		}

		table, err := renderAttributeViewTable(attrView, view)
		if nil != err {
			logging.LogErrorf("render attribute view [%s] table failed: %s", avID, err)
			return ast.WalkContinue
		}

		var aligns []int
		for range table.Columns {
			aligns = append(aligns, 0)
		}
		mdTable := &ast.Node{Type: ast.NodeTable, TableAligns: aligns}
		mdTableHead := &ast.Node{Type: ast.NodeTableHead}
		mdTable.AppendChild(mdTableHead)
		mdTableHeadRow := &ast.Node{Type: ast.NodeTableRow, TableAligns: aligns}
		mdTableHead.AppendChild(mdTableHeadRow)
		for _, col := range table.Columns {
			cell := &ast.Node{Type: ast.NodeTableCell}
			cell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(col.Name)})
			mdTableHeadRow.AppendChild(cell)
		}
		for _, row := range table.Rows {
			mdTableRow := &ast.Node{Type: ast.NodeTableRow, TableAligns: aligns}
			mdTable.AppendChild(mdTableRow)
			for _, cell := range row.Cells {
				mdTableCell := &ast.Node{Type: ast.NodeTableCell}
				mdTableRow.AppendChild(mdTableCell)
				var val string
				if nil != cell.Value {
					if av.KeyTypeDate == cell.Value.Type && nil != cell.Value.Date {
						cell.Value.Date = av.NewFormattedValueDate(cell.Value.Date.Content, cell.Value.Date.Content2, av.DateFormatNone)
					}

					val = cell.Value.String()
				}
				mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(val)})
			}
		}

		n.InsertBefore(mdTable)
		unlinks = append(unlinks, n)
		return ast.WalkContinue
	})
	for _, n := range unlinks {
		n.Unlink()
	}
	return ret
}

func resolveFootnotesDefs(refFootnotes *[]*refAsFootnotes, rootID string, blockRefTextLeft, blockRefTextRight string) (footnotesDefBlock *ast.Node) {
	if 1 > len(*refFootnotes) {
		return nil
	}

	footnotesDefBlock = &ast.Node{Type: ast.NodeFootnotesDefBlock}
	var rendered []string
	for _, foot := range *refFootnotes {
		t, err := loadTreeByBlockID(foot.defID)
		if nil != err {
			continue
		}
		defNode := treenode.GetNodeInTree(t, foot.defID)
		docID := strings.TrimSuffix(path.Base(defNode.Path), ".sy")
		var nodes []*ast.Node
		if ast.NodeHeading == defNode.Type {
			nodes = append(nodes, defNode)
			if rootID != docID {
				// 同文档块引转脚注缩略定义考虑容器块和标题块 https://github.com/siyuan-note/siyuan/issues/5917
				children := treenode.HeadingChildren(defNode)
				nodes = append(nodes, children...)
			}
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

				if treenode.IsBlockRef(n) {
					defID, _, _ := treenode.GetBlockRef(n)
					if f := getRefAsFootnotes(defID, refFootnotes); nil != f {
						n.InsertBefore(&ast.Node{Type: ast.NodeText, Tokens: []byte(blockRefTextLeft + f.refAnchorText + blockRefTextRight)})
						n.InsertBefore(&ast.Node{Type: ast.NodeFootnotesRef, Tokens: []byte("^" + f.refNum), FootnotesRefId: f.refNum, FootnotesRefLabel: []byte("^" + f.refNum)})
						unlinks = append(unlinks, n)
					}
					return ast.WalkSkipChildren
				} else if ast.NodeBlockQueryEmbed == n.Type {
					stmt := n.ChildByType(ast.NodeBlockQueryEmbedScript).TokensStr()
					stmt = html.UnescapeString(stmt)
					stmt = strings.ReplaceAll(stmt, editor.IALValEscNewLine, "\n")
					sqlBlocks := sql.SelectBlocksRawStmt(stmt, 1, Conf.Search.Limit)
					for _, b := range sqlBlocks {
						subNodes := renderBlockMarkdownR0(b.ID, &rendered)
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
				if rootID == docID {
					// 同文档块引转脚注缩略定义 https://github.com/siyuan-note/siyuan/issues/3299
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
		logging.LogErrorf("not found node [%s] in tree [%s]", b.ID, t.Root.ID)
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

		if treenode.IsBlockRef(n) {
			defID, refText, _ := treenode.GetBlockRef(n)
			if nil == getRefAsFootnotes(defID, refFootnotes) {
				anchorText := refText
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

		if treenode.IsBlockRef(n) {
			defID, _, _ := treenode.GetBlockRef(n)
			if "" == defID {
				return ast.WalkContinue
			}
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

func processFileAnnotationRef(refID string, n *ast.Node, fileAnnotationRefMode int) ast.WalkStatus {
	p := refID[:strings.LastIndex(refID, "/")]
	absPath, err := GetAssetAbsPath(p)
	if nil != err {
		logging.LogWarnf("get assets abs path by rel path [%s] failed: %s", p, err)
		return ast.WalkSkipChildren
	}
	sya := absPath + ".sya"
	syaData, err := os.ReadFile(sya)
	if nil != err {
		logging.LogErrorf("read file [%s] failed: %s", sya, err)
		return ast.WalkSkipChildren
	}
	syaJSON := map[string]interface{}{}
	if err = gulu.JSON.UnmarshalJSON(syaData, &syaJSON); nil != err {
		logging.LogErrorf("unmarshal file [%s] failed: %s", sya, err)
		return ast.WalkSkipChildren
	}
	annotationID := refID[strings.LastIndex(refID, "/")+1:]
	annotationData := syaJSON[annotationID]
	if nil == annotationData {
		logging.LogErrorf("not found annotation [%s] in .sya", annotationID)
		return ast.WalkSkipChildren
	}
	pages := annotationData.(map[string]interface{})["pages"].([]interface{})
	page := int(pages[0].(map[string]interface{})["index"].(float64)) + 1
	pageStr := strconv.Itoa(page)

	refText := n.TextMarkTextContent
	ext := filepath.Ext(p)
	file := p[7:len(p)-23-len(ext)] + ext
	fileAnnotationRefLink := &ast.Node{Type: ast.NodeLink}
	fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
	if 0 == fileAnnotationRefMode {
		fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte(file + " - p" + pageStr + " - " + refText)})
	} else {
		fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte(refText)})
	}
	fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
	fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
	fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte(p + "?p=" + pageStr)})
	fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
	n.InsertBefore(fileAnnotationRefLink)
	return ast.WalkSkipChildren
}

func exportPandocConvertZip(boxID, baseFolderName string, docPaths []string,
	pandocFrom, pandocTo, ext string) (zipPath string) {
	dir, name := path.Split(baseFolderName)
	name = util.FilterFileName(name)
	if strings.HasSuffix(name, "..") {
		// 文档标题以 `..` 结尾时无法导出 Markdown https://github.com/siyuan-note/siyuan/issues/4698
		// 似乎是 os.MkdirAll 的 bug，以 .. 结尾的路径无法创建，所以这里加上 _ 结尾
		name += "_"
	}
	baseFolderName = path.Join(dir, name)
	box := Conf.Box(boxID)

	exportFolder := filepath.Join(util.TempDir, "export", baseFolderName+ext)
	os.RemoveAll(exportFolder)
	if err := os.MkdirAll(exportFolder, 0755); nil != err {
		logging.LogErrorf("create export temp folder failed: %s", err)
		return
	}

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
		p = hPath + ext
		writePath := filepath.Join(exportFolder, p)
		if gulu.File.IsExist(writePath) {
			// 重名文档加 ID
			p = hPath + "-" + id + ext
			writePath = filepath.Join(exportFolder, p)
		}
		writeFolder := filepath.Dir(writePath)
		if err := os.MkdirAll(writeFolder, 0755); nil != err {
			logging.LogErrorf("create export temp folder [%s] failed: %s", writeFolder, err)
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

			srcPath, err := GetAssetAbsPath(asset)
			if nil != err {
				logging.LogWarnf("get asset [%s] abs path failed: %s", asset, err)
				continue
			}

			destPath := filepath.Join(writeFolder, asset)
			err = filelock.Copy(srcPath, destPath)
			if nil != err {
				logging.LogErrorf("copy asset from [%s] to [%s] failed: %s", srcPath, destPath, err)
				continue
			}
		}

		// 调用 Pandoc 进行格式转换
		err := util.Pandoc(pandocFrom, pandocTo, writePath, md)
		if nil != err {
			logging.LogErrorf("pandoc failed: %s", err)
			continue
		}
	}

	zipPath = exportFolder + ".zip"
	zip, err := gulu.Zip.Create(zipPath)
	if nil != err {
		logging.LogErrorf("create export markdown zip [%s] failed: %s", exportFolder, err)
		return ""
	}

	// 导出 Markdown zip 包内不带文件夹 https://github.com/siyuan-note/siyuan/issues/6869
	entries, err := os.ReadDir(exportFolder)
	if nil != err {
		logging.LogErrorf("read export markdown folder [%s] failed: %s", exportFolder, err)
		return ""
	}
	for _, entry := range entries {
		entryPath := filepath.Join(exportFolder, entry.Name())
		if gulu.File.IsDir(entryPath) {
			err = zip.AddDirectory(entry.Name(), entryPath)
		} else {
			err = zip.AddEntry(entry.Name(), entryPath)
		}
		if nil != err {
			logging.LogErrorf("add entry [%s] to zip failed: %s", entry.Name(), err)
			return ""
		}
	}

	if err = zip.Close(); nil != err {
		logging.LogErrorf("close export markdown zip failed: %s", err)
	}

	os.RemoveAll(exportFolder)
	zipPath = "/export/" + url.PathEscape(filepath.Base(zipPath))
	return
}
