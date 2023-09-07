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

package api

import (
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func forwardProxy(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	destURL := arg["url"].(string)
	if _, e := url.ParseRequestURI(destURL); nil != e {
		ret.Code = -1
		ret.Msg = "invalid [url]"
		return
	}

	method := "POST"
	if methodArg := arg["method"]; nil != methodArg {
		method = strings.ToUpper(methodArg.(string))
	}
	timeout := 7 * 1000
	if timeoutArg := arg["timeout"]; nil != timeoutArg {
		timeout = int(timeoutArg.(float64))
		if 1 > timeout {
			timeout = 7 * 1000
		}
	}

	client := req.C()
	client.SetTimeout(time.Duration(timeout) * time.Millisecond)
	request := client.R()
	headers := arg["headers"].([]interface{})
	for _, pair := range headers {
		for k, v := range pair.(map[string]interface{}) {
			request.SetHeader(k, fmt.Sprintf("%s", v))
		}
	}

	contentType := "application/json"
	if contentTypeArg := arg["contentType"]; nil != contentTypeArg {
		contentType = contentTypeArg.(string)
	}
	request.SetHeader("Content-Type", contentType)

	payloadEncoding := "json"
	if payloadEncodingArg := arg["payloadEncoding"]; nil != payloadEncodingArg {
		payloadEncoding = payloadEncodingArg.(string)
	}

	switch payloadEncoding {
	case "base64":
		fallthrough
	case "base64-std":
		if payload, err := base64.StdEncoding.DecodeString(arg["payload"].(string)); nil != err {
			ret.Code = -2
			ret.Msg = "decode base64-std payload failed: " + err.Error()
			return
		} else {
			request.SetBody(payload)
		}
	case "base64-url":
		if payload, err := base64.URLEncoding.DecodeString(arg["payload"].(string)); nil != err {
			ret.Code = -2
			ret.Msg = "decode base64-url payload failed: " + err.Error()
			return
		} else {
			request.SetBody(payload)
		}
	case "base32":
		fallthrough
	case "base32-std":
		if payload, err := base32.StdEncoding.DecodeString(arg["payload"].(string)); nil != err {
			ret.Code = -2
			ret.Msg = "decode base32-std payload failed: " + err.Error()
			return
		} else {
			request.SetBody(payload)
		}
	case "base32-hex":
		if payload, err := base32.HexEncoding.DecodeString(arg["payload"].(string)); nil != err {
			ret.Code = -2
			ret.Msg = "decode base32-hex payload failed: " + err.Error()
			return
		} else {
			request.SetBody(payload)
		}
	case "hex":
		if payload, err := hex.DecodeString(arg["payload"].(string)); nil != err {
			ret.Code = -2
			ret.Msg = "decode hex payload failed: " + err.Error()
			return
		} else {
			request.SetBody(payload)
		}
	case "text":
	default:
		request.SetBody(arg["payload"])
	}

	started := time.Now()
	resp, err := request.Send(method, destURL)
	if nil != err {
		ret.Code = -1
		ret.Msg = "forward request failed: " + err.Error()
		return
	}

	bodyData, err := io.ReadAll(resp.Body)
	if nil != err {
		ret.Code = -1
		ret.Msg = "read response body failed: " + err.Error()
		return
	}

	elapsed := time.Now().Sub(started)

	responseEncoding := "text"
	if responseEncodingArg := arg["responseEncoding"]; nil != responseEncodingArg {
		responseEncoding = responseEncodingArg.(string)
	}

	body := ""
	switch responseEncoding {
	case "base64":
		fallthrough
	case "base64-std":
		body = base64.StdEncoding.EncodeToString(bodyData)
	case "base64-url":
		body = base64.URLEncoding.EncodeToString(bodyData)
	case "base32":
		fallthrough
	case "base32-std":
		body = base32.StdEncoding.EncodeToString(bodyData)
	case "base32-hex":
		body = base32.HexEncoding.EncodeToString(bodyData)
	case "hex":
		body = hex.EncodeToString(bodyData)
	case "text":
		fallthrough
	default:
		responseEncoding = "text"
		body = string(bodyData)
	}

	data := map[string]interface{}{
		"url":          destURL,
		"status":       resp.StatusCode,
		"contentType":  resp.GetHeader("content-type"),
		"body":         body,
		"bodyEncoding": responseEncoding,
		"headers":      resp.Header,
		"elapsed":      elapsed.Milliseconds(),
	}
	ret.Data = data

	//shortBody := ""
	//if 64 > len(body) {
	//	shortBody = body
	//} else {
	//	shortBody = body[:64]
	//}
	//
	//logging.LogInfof("elapsed [%.1fs], length [%d], request [url=%s, headers=%s, content-type=%s, body=%s], status [%d], body [%s]",
	//	elapsed.Seconds(), len(bodyData), data["url"], headers, contentType, arg["payload"], data["status"], shortBody)
}
