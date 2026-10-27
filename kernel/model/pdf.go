// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

type pdfAssetLink struct {
	annotation   model.LinkAnnotation
	objectNumber int
}

func pdfListAssetLinks(ctx *model.Context) (ret []pdfAssetLink) {
	for pg, annos := range ctx.PageAnnots {
		for k, v := range annos {
			if model.AnnLink == k {
				for objectNumber, va := range v.Map {
					link := va.ContentString()
					if (strings.HasPrefix(link, "http://127.0.0.1:") ||
						strings.HasPrefix(link, "https://127.0.0.1:")) && strings.Contains(link, "/assets/") {
						annotation := va.(model.LinkAnnotation)
						annotation.Page = pg
						ret = append(ret, pdfAssetLink{
							annotation:   annotation,
							objectNumber: objectNumber,
						})
					}
				}
			}
		}
	}
	return
}

const PdfOutlineScheme = "pdf-outline"

func PdfListToCLinks(ctx *model.Context) (ret []model.LinkAnnotation, err error) {
	for pg, annos := range ctx.PageAnnots {
		for k, v := range annos {
			if model.AnnLink == k {
				for _, va := range v.Map {
					link := va.ContentString()
					if strings.HasPrefix(link, PdfOutlineScheme+"://") {
						l := va.(model.LinkAnnotation)
						l.Page = pg
						ret = append(ret, l)
					}
				}
			}
		}
	}
	return
}
