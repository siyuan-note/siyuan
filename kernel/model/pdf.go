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
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

func PdfListLinks(ctx *model.Context) (assets, others []model.LinkAnnotation, err error) {
	for pg, annos := range ctx.PageAnnots {
		for k, v := range annos {
			if model.AnnLink == k {
				for _, va := range v.Map {
					link := va.ContentString()
					l := va.(model.LinkAnnotation)
					l.Page = pg
					if strings.HasPrefix(link, "http://127.0.0.1:") && strings.Contains(link, "/assets/") {
						assets = append(assets, l)
					} else {
						others = append(others, l)
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
