// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"context"
	"encoding/base64"
	"errors"
	"net/url"
	"os"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type decisionImageInput struct {
	URL       string `json:"url,omitempty"`
	AssetPath string `json:"assetPath,omitempty"`
	Notebook  string `json:"notebook,omitempty"`
	Detail    string `json:"detail,omitempty"`
}

func validateDecisionImages(provider string, images []decisionImageInput) error {
	if len(images) != 0 && provider != util.DecisionProviderOpenAI {
		return errors.New("decision images require the OpenAI provider")
	}
	for _, image := range images {
		if (image.URL == "") == (image.AssetPath == "") {
			return errors.New("each decision image requires either url or assetPath")
		}
		if image.Notebook != "" && (!ast.IsNodeIDPattern(image.Notebook) || image.AssetPath == "") {
			return errors.New("image notebook requires a local asset and valid notebook ID")
		}
		if image.AssetPath != "" {
			asset, err := url.Parse(image.AssetPath)
			if err != nil || asset.IsAbs() || asset.Host != "" || asset.Fragment != "" ||
				!strings.HasPrefix(asset.Path, "assets/") {
				return errors.New("decision image assetPath must be a local assets/... path")
			}
			boxes := asset.Query()["box"]
			if len(boxes) > 1 || len(boxes) == 1 && (image.Notebook == "" || boxes[0] != image.Notebook) {
				return errors.New("image asset box must match its explicit notebook")
			}
		}
		if err := util.ValidateDecisionImageDetail(image.Detail); err != nil {
			return err
		}
		if image.URL != "" {
			if err := util.ValidateDecisionImage(util.DecisionImage{URL: image.URL, Detail: image.Detail}); err != nil {
				return err
			}
		}
	}
	return nil
}

func prepareDecisionImages(ctx context.Context, images []decisionImageInput) ([]util.DecisionImage, error) {
	if err := validateDecisionImages(util.DecisionProviderOpenAI, images); err != nil {
		return nil, err
	}
	var boxes []string
	for _, image := range images {
		boxes = append(boxes, image.Notebook)
	}
	release, err := model.AcquireEncryptedBoxOperations(ctx, boxes)
	if err != nil {
		return nil, errors.New("encrypted image notebook is locked, please unlock it first")
	}
	defer release()
	var result []util.DecisionImage
	imageBytes := 0
	for _, image := range images {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		// HTTP(S) 地址交给供应商读取，本地内核不抓取远程 URL。
		prepared := util.DecisionImage{URL: image.URL, Detail: image.Detail}
		if image.URL == "" {
			var err error
			prepared, err = prepareDecisionAssetImage(image)
			if err != nil {
				return nil, err
			}
		}
		imageBytes += len(prepared.URL)
		if imageBytes > util.DecisionMaxBytes {
			return nil, errors.New("decision images exceed the 1 MiB encoded request limit")
		}
		result = append(result, prepared)
	}
	return result, nil
}

func prepareDecisionAssetImage(image decisionImageInput) (util.DecisionImage, error) {
	absPath, err := model.GetAssetAbsPathInBox(image.AssetPath, image.Notebook)
	if err != nil {
		return util.DecisionImage{}, errors.New("decision image asset is unavailable")
	}
	boxID := util.BoxIDFromDataPath(absPath)
	if model.IsEncryptedBox(boxID) && (image.Notebook != boxID || !model.IsBoxUnlocked(boxID)) {
		return util.DecisionImage{}, errors.New("encrypted image requires its unlocked notebook")
	}
	// 保留密文容器开销的余量，同时避免读取任意大的文件。
	if info, statErr := os.Stat(absPath); statErr == nil && info.Size() > util.DecisionMaxBytes+2*1024*1024 {
		return util.DecisionImage{}, errors.New("decision image asset exceeds size limit")
	}
	data, err := model.ReadAssetBytesInBox(image.Notebook, image.AssetPath)
	if err != nil {
		return util.DecisionImage{}, errors.New("could not read or authenticate decision image asset")
	}
	defer clear(data)
	prepared, err := util.PrepareModelImage(data, util.DecisionMaxBytes, 40000000, 2048)
	if err != nil {
		return util.DecisionImage{}, err
	}
	defer clear(prepared.Data)
	return util.DecisionImage{URL: "data:" + prepared.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(prepared.Data), Detail: image.Detail}, nil
}
