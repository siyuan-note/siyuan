// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import "mime/multipart"

type StartLivePhotoPreviewRequest struct {
	Path         string `json:"path"`
	ClientEncode bool   `json:"clientEncode" api:"optional"`
}

type LivePhotoPreviewRequest struct {
	ID string `json:"id"`
}

type LivePhotoFrameRequest struct {
	ID    string `json:"id"`
	Index int    `json:"index"`
}

type FinishLivePhotoPreviewRequest struct {
	ID   string                `json:"id"`
	File *multipart.FileHeader `json:"file"`
}

type LivePhotoFrameTime struct {
	Timestamp int64 `json:"timestamp"`
	Duration  int64 `json:"duration"`
}

type LivePhotoColor struct {
	Primaries uint16 `json:"primaries"`
	Transfer  uint16 `json:"transfer"`
	Matrix    uint16 `json:"matrix"`
	FullRange bool   `json:"fullRange"`
}

type LivePhotoPreviewSession struct {
	ID     string               `json:"id"`
	Encode bool                 `json:"encode"`
	Width  int                  `json:"width"`
	Height int                  `json:"height"`
	Frames []LivePhotoFrameTime `json:"frames"`
	Color  LivePhotoColor       `json:"color"`
}

type DocumentPreviewImage struct {
	Src      string `json:"src"`
	Video    string `json:"video,omitempty"`
	Notebook string `json:"notebook"`
}
