// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

type WPSPresentationRequest struct {
	Data string `json:"data" api:"trim"`
	Text string `json:"text" api:"optional,nullable"`
	Type string `json:"type" api:"trim"`
}

type WPSPresentationData struct {
	Converted bool   `json:"converted"`
	DOM       string `json:"dom"`
}

func init() {
	WPSPresentation2BlockDOM.decodeFailure = func(err error) Response[WPSPresentationData] {
		return WPSPresentation2BlockDOM.FailureWithData(-1, err.Error(), WPSPresentationData{})
	}
}
