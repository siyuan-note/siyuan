// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"slices"
	"sort"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	pdfmodel "github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	pdfImageMaxPDFBytes = 64 * 1024 * 1024
	pdfImageMaxBytes    = 20 * 1024 * 1024
	pdfImageMaxPixels   = 40_000_000
	pdfImageMaxEntries  = 10000
)

// PDFImageSelection 将对象编号绑定到认证读取后的 PDF 内容版本，避免文件替换后读取另一张图。
type PDFImageSelection struct {
	Revision string `json:"revision"`
	Page     int    `json:"page"`
	Object   int    `json:"object"`
}

type PDFImageInfo struct {
	Page     int    `json:"page"`
	Object   int    `json:"object"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Encoding string `json:"encoding"`
}

type PDFImageList struct {
	Revision  string         `json:"revision"`
	PageCount int            `json:"pageCount"`
	Images    []PDFImageInfo `json:"images"`
	Total     int            `json:"total"`
	Offset    int            `json:"offset"`
	HasMore   bool           `json:"hasMore"`
}

type PDFImageSource struct {
	DocumentID string
	Path       string
}

type pdfImageDocument struct {
	ctx      *pdfmodel.Context
	data     []byte
	revision string
	boxID    string
}

// openPDFImages 只读取源文档实际引用的本地 PDF，明文只保留在当前操作内存中。
func openPDFImages(ctx context.Context, source PDFImageSource, revision string) (ret *pdfImageDocument, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			ret, err = nil, fmt.Errorf("read PDF failed: %v", recovered)
		}
	}()
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	u, err := url.Parse(source.Path)
	if err != nil || u.IsAbs() || u.Host != "" || !strings.HasPrefix(u.Path, "assets/") ||
		path.Clean(u.Path) != u.Path || strings.Contains(u.Path, "\\") || !strings.EqualFold(path.Ext(u.Path), ".pdf") {
		return nil, errors.New("path must be a local assets/... PDF referenced by the source document")
	}
	bt := treenode.GetBlockTree(source.DocumentID)
	if bt == nil {
		return nil, errors.New("source document not found")
	}
	if box := u.Query().Get("box"); box != "" && box != bt.BoxID {
		return nil, errors.New("PDF notebook does not match the source document")
	}
	refs, err := DocAssets(bt.RootID, true)
	if err != nil {
		return nil, err
	}
	found := false
	for _, ref := range refs {
		refURL, parseErr := url.Parse(ref)
		if parseErr == nil && refURL.Path == u.Path && (refURL.Query().Get("box") == "" || refURL.Query().Get("box") == bt.BoxID) {
			found = true
			break
		}
	}
	if !found {
		return nil, errors.New("PDF is not referenced by the source document")
	}
	abs, err := GetAssetAbsPathInBox(source.Path, bt.BoxID)
	if err != nil {
		return nil, err
	}
	if err = ensureReadableAssetLocal(abs); err != nil {
		return nil, err
	}
	stat, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if stat.Size() > pdfImageMaxPDFBytes+2*1024*1024 {
		return nil, errors.New("PDF exceeds the 64 MiB extraction limit")
	}
	data, err := ReadAssetBytesInBox(bt.BoxID, source.Path)
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			clear(data)
		}
	}()
	if len(data) > pdfImageMaxPDFBytes {
		return nil, errors.New("PDF exceeds the 64 MiB extraction limit")
	}
	sum := sha256.Sum256(data)
	actualRevision := hex.EncodeToString(sum[:])
	if revision != "" && revision != actualRevision {
		return nil, errors.New("PDF changed; list images again before selecting an image")
	}
	config := pdfmodel.NewDefaultConfiguration()
	pdf, err := api.ReadValidateAndOptimize(bytes.NewReader(data), config)
	if err != nil {
		return nil, fmt.Errorf("read PDF failed (damaged, unsupported or password-protected PDF): %w", err)
	}
	if pdf.PageCount > pdfImageMaxEntries {
		return nil, errors.New("PDF has too many pages for image extraction")
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	ok = true
	return &pdfImageDocument{ctx: pdf, data: data, revision: actualRevision, boxID: bt.BoxID}, nil
}

func ListPDFImages(ctx context.Context, source PDFImageSource, pages []int, offset, limit int, revision string) (ret PDFImageList, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("list PDF images failed: %v", recovered)
		}
	}()
	if offset < 0 || limit < 1 || limit > 100 {
		return ret, errors.New("offset must be nonnegative and limit must be between 1 and 100")
	}
	if offset > 0 && revision == "" {
		return ret, errors.New("revision is required when continuing an image list")
	}
	pdf, err := openPDFImages(ctx, source, revision)
	if err != nil {
		return ret, err
	}
	defer clear(pdf.data)
	selected := slices.Clone(pages)
	if len(selected) == 0 {
		for page := 1; page <= pdf.ctx.PageCount; page++ {
			selected = append(selected, page)
		}
	}
	sort.Ints(selected)
	selected = slices.Compact(selected)
	var images []PDFImageInfo
	for _, page := range selected {
		if err = ctx.Err(); err != nil {
			return ret, err
		}
		if page < 1 || page > pdf.ctx.PageCount {
			return ret, errors.New("page is outside the PDF page range")
		}
		items, listErr := pdfcpu.ExtractPageImages(pdf.ctx, page, true)
		if listErr != nil {
			return ret, fmt.Errorf("list PDF page %d images failed: %w", page, listErr)
		}
		for _, img := range items {
			if img.Thumb || img.IsImgMask {
				continue
			}
			images = append(images, PDFImageInfo{Page: page, Object: img.ObjNr, Width: img.Width, Height: img.Height, Encoding: img.Filter})
			if len(images) > pdfImageMaxEntries {
				return ret, errors.New("too many PDF images; select fewer pages")
			}
		}
	}
	sort.Slice(images, func(i, j int) bool {
		if images[i].Page != images[j].Page {
			return images[i].Page < images[j].Page
		}
		return images[i].Object < images[j].Object
	})
	start := min(offset, len(images))
	end := min(start+limit, len(images))
	return PDFImageList{Revision: pdf.revision, PageCount: pdf.ctx.PageCount, Images: append([]PDFImageInfo{}, images[start:end]...), Total: len(images), Offset: start, HasMore: end < len(images)}, nil
}

func (pdf *pdfImageDocument) image(ctx context.Context, selection PDFImageSelection) (data []byte, format string, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			data, err = nil, fmt.Errorf("extract PDF image failed: %v", recovered)
		}
	}()
	if err = ctx.Err(); err != nil {
		return nil, "", err
	}
	if selection.Page < 1 || selection.Page > pdf.ctx.PageCount || selection.Object < 1 {
		return nil, "", errors.New("invalid PDF image selection")
	}
	if !slices.Contains(pdfcpu.ImageObjNrs(pdf.ctx, selection.Page), selection.Object) {
		return nil, "", errors.New("image object is not on the selected PDF page")
	}
	object := pdf.ctx.Optimize.ImageObjects[selection.Object]
	stub, err := pdfcpu.ExtractImage(pdf.ctx, object.ImageDict, false, "", selection.Object, true)
	if err != nil {
		return nil, "", err
	}
	if stub == nil || stub.IsImgMask || stub.Width < 1 || stub.Height < 1 || stub.Width > pdfImageMaxPixels/stub.Height {
		return nil, "", errors.New("unsupported PDF image or image exceeds the 40 megapixel limit")
	}
	img, err := pdfcpu.ExtractImage(pdf.ctx, object.ImageDict, false, "", selection.Object, false)
	if err != nil {
		return nil, "", err
	}
	if img == nil || img.Reader == nil {
		return nil, "", errors.New("PDF image encoding is unsupported")
	}
	data, err = io.ReadAll(io.LimitReader(img.Reader, pdfImageMaxBytes+1))
	if err != nil {
		return nil, "", err
	}
	if len(data) > pdfImageMaxBytes {
		clear(data)
		return nil, "", errors.New("PDF image exceeds the 20 MiB extraction limit")
	}
	switch img.FileType {
	case "png", "jpg", "jpeg", "tif", "tiff":
	default:
		return nil, "", errors.New("PDF image encoding is unsupported")
	}
	return data, img.FileType, ctx.Err()
}

func PreparePDFImage(ctx context.Context, source PDFImageSource, selection PDFImageSelection) (ret util.PreparedImage, err error) {
	if selection.Revision == "" {
		return ret, errors.New("revision from list is required")
	}
	pdf, err := openPDFImages(ctx, source, selection.Revision)
	if err != nil {
		return ret, err
	}
	defer clear(pdf.data)
	data, _, err := pdf.image(ctx, selection)
	if err != nil {
		return ret, err
	}
	defer clear(data)
	ret, err = util.PrepareModelImage(data, pdfImageMaxBytes, pdfImageMaxPixels, 2048)
	if err == nil {
		ret.Data = bytes.Clone(ret.Data)
	}
	return ret, err
}

type PDFImageExtractResult struct {
	Page      int               `json:"page"`
	Object    int               `json:"object"`
	Artifact  *ImageArtifactRef `json:"artifact,omitempty"`
	SourceURL string            `json:"sourceURL,omitempty"`
	Error     string            `json:"error,omitempty"`
}

func ExtractPDFImages(ctx context.Context, source PDFImageSource, revision, targetDocumentID string, selections []PDFImageSelection) (ret []PDFImageExtractResult, err error) {
	if revision == "" || len(selections) == 0 || len(selections) > 20 {
		return nil, errors.New("revision and between 1 and 20 image selections are required")
	}
	pdf, err := openPDFImages(ctx, source, revision)
	if err != nil {
		return nil, err
	}
	defer clear(pdf.data)
	target := treenode.GetBlockTree(targetDocumentID)
	if target == nil {
		return nil, errors.New("target document not found")
	}
	if !IsSameCryptoBoundary(pdf.boxID, target.BoxID) {
		return nil, errors.New("PDF extraction must stay within the same encryption boundary")
	}
	ret = make([]PDFImageExtractResult, 0, len(selections))
	saved := map[string]ImageArtifactRef{}
	for _, selection := range selections {
		if err = ctx.Err(); err != nil {
			return ret, err
		}
		item := PDFImageExtractResult{Page: selection.Page, Object: selection.Object}
		data, format, extractErr := pdf.image(ctx, selection)
		if extractErr != nil {
			item.Error = extractErr.Error()
			ret = append(ret, item)
			continue
		}
		sum := sha256.Sum256(data)
		key := hex.EncodeToString(sum[:])
		artifact, exists := saved[key]
		if !exists {
			var assetPath string
			assetPath, _, extractErr = InsertAssetBytes(target.RootID, "pdf-image-"+key[:16]+"."+format, data)
			if extractErr == nil {
				artifact = ImageArtifactRef{Kind: "image", Path: assetPath, DocumentID: target.RootID}
				saved[key] = artifact
			}
		}
		clear(data)
		if extractErr != nil {
			item.Error = extractErr.Error()
		} else {
			item.Artifact = &artifact
			u, _ := url.Parse(source.Path)
			q := u.Query()
			if IsEncryptedBox(pdf.boxID) {
				q.Set("box", pdf.boxID)
			}
			q.Set("page", fmt.Sprint(selection.Page))
			u.RawQuery = q.Encode()
			u.Fragment = ""
			item.SourceURL = u.String()
		}
		ret = append(ret, item)
	}
	return ret, nil
}
