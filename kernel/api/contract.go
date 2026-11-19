// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/base64"
	"errors"
	"io"
	"mime/multipart"
	"net/http"

	"github.com/gin-gonic/gin"
	goccyJSON "github.com/goccy/go-json"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// maxContractJSONBodyBytes 限制契约 JSON 请求体的读取量，公开接口不再按请求内容无限分配内存。
// 表单和 multipart 上传保留各自的内存与文件上限。
const maxContractJSONBodyBytes = 32 << 20

const contractBodyLimitKey = "siyuan-contract-body-limit"

// limitedRequestBody 在超限读取发生时留下标记，解码错误被包装后仍可统一返回请求体过大。
type limitedRequestBody struct {
	io.ReadCloser
	exceeded *bool
}

func (r *limitedRequestBody) Read(p []byte) (int, error) {
	n, err := r.ReadCloser.Read(p)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			*r.exceeded = true
		}
	}
	return n, err
}

// limitContractBody 为请求体设置读取上限，同一请求的多个上限共用超限标记。
func limitContractBody(c *gin.Context, limit int64) *bool {
	exceeded, ok := c.Get(contractBodyLimitKey)
	var flag *bool
	if ok {
		flag = exceeded.(*bool)
	} else {
		flag = new(bool)
		c.Set(contractBodyLimitKey, flag)
	}
	c.Request.Body = &limitedRequestBody{ReadCloser: http.MaxBytesReader(c.Writer, c.Request.Body, limit), exceeded: flag}
	return flag
}

func notebookConfContract(value *conf.BoxConf) *apicontract.NotebookConf {
	if value == nil {
		return nil
	}
	result := &apicontract.NotebookConf{
		DocCreateTarget: documentTargetContract(value.DocCreateTarget),
		RefCreateTarget: documentTargetContract(value.RefCreateTarget),
		DailyNoteTarget: documentTargetContract(value.DailyNoteTarget),
		Name:            value.Name, Sort: value.Sort, Icon: value.Icon, Closed: value.Closed,
		RefCreateSaveBox: value.RefCreateSaveBox, RefCreateSavePath: value.RefCreateSavePath,
		DocCreateSaveBox: value.DocCreateSaveBox, DocCreateSavePath: value.DocCreateSavePath,
		DocCreateTemplatePath: value.DocCreateTemplatePath, DailyNoteSavePath: value.DailyNoteSavePath,
		DailyNoteTemplatePath: value.DailyNoteTemplatePath, SortMode: value.SortMode, Encrypted: value.Encrypted,
	}
	if crypt := value.BoxCrypt; crypt != nil {
		encode := func(bytes []byte) *string {
			if bytes == nil {
				return nil
			}
			encoded := base64.StdEncoding.EncodeToString(bytes)
			return &encoded
		}
		result.BoxCrypt = &apicontract.NotebookEncryption{Spec: crypt.Spec, WrappedDEK: encode(crypt.WrappedDEK),
			WrapNonce: encode(crypt.WrapNonce), Metadata: base64.StdEncoding.EncodeToString(crypt.Metadata), CreatedAt: crypt.CreatedAt}
	}
	return result
}

// contractHandler 将请求绑定和响应类型与注册契约关联，业务入口继续使用现有中间件。
func contractHandler[Request, Data any](endpoint apicontract.Endpoint[Request, Data],
	handler func(*gin.Context, Request) apicontract.Response[Data], beforeDecode ...func(*gin.Context) *apicontract.Response[Data]) gin.HandlerFunc {
	setting := endpoint.Definition().Setting
	// 合并写入在取得配置段锁之后才读取当前配置，避免并发提交互相覆盖。
	merge := setting.Declared() && setting.Merge
	if !merge {
		// 按契约声明的模式串行化：Notify 补发变更通知，Silent 只取配置互斥锁。
		// 读取完整配置与写入共用互斥，保证读到已提交的配置。
		if setting.Declared() && setting.Mode == apicontract.SettingNotify {
			handler = serializeSetting(setting.Namespace, handler)
		} else if setting.Declared() && setting.Mode == apicontract.SettingSilent || endpoint.Definition().Path == "/api/system/getConf" {
			serialized := handler
			handler = func(c *gin.Context, request Request) apicontract.Response[Data] {
				namespace := setting.Namespace
				if namespace == "" {
					namespace = "*"
				}
				release := lockSetting(namespace)
				defer release()
				return serialized(c, request)
			}
		}
	}
	return func(c *gin.Context) {
		writeResponse := func(response apicontract.Response[Data]) {
			if after := response.AfterWrite(); after != nil {
				defer after()
			}
			status := endpoint.Status(response)
			if upgrade := response.Upgrade(); upgrade != nil {
				upgrade(c.Writer, c.Request)
				return
			}
			if stream := response.Stream(); stream != nil {
				stream(c.Writer, c.Request)
				return
			}
			if status == 204 || response.Empty() {
				c.Status(status)
				return
			}
			if redirect := response.Redirect(); redirect != nil {
				c.Redirect(status, redirect.Location)
				return
			}
			if content := response.Binary(); content != nil {
				c.Data(status, content.ContentType, content.Bytes)
				return
			}
			if endpoint.Definition().FastJSON {
				if data, err := response.MarshalWith(goccyJSON.Marshal); err == nil && len(data) > 0 {
					c.Data(status, "application/json; charset=utf-8", data)
					return
				}
			}
			c.JSON(status, response)
		}
		// 渠道禁用在读取请求体前生效，路由上的身份和权限中间件仍先执行。
		if apicontract.RequiresAI(endpoint.Definition().Path) && util.IsDisabledFeature("ai") {
			message := util.I18nTerm(model.Conf.Lang, "agentCapabilitiesUnavailable")
			if endpoint.Definition().Path == apicontract.AIMCPOAuthCallback.Definition().Path {
				c.Data(403, "text/plain; charset=utf-8", []byte(message))
			} else {
				writeResponse(apicontract.Failure[Data](-1, message))
			}
			return
		}
		// 解码前限制 JSON 请求体读取量，避免公开接口按请求内容分配内存。
		var bodyLimit *bool
		switch endpoint.Definition().Body {
		case apicontract.JSONBody, apicontract.StructJSONBody, apicontract.LegacyOptionalBody:
			bodyLimit = limitContractBody(c, maxContractJSONBodyBytes)
		}
		if merge && nil == bodyLimit {
			bodyLimit = limitContractBody(c, maxContractJSONBodyBytes)
		}
		bodyTooLarge := func() bool { return nil != bodyLimit && *bodyLimit }
		// 保留在读取请求体前完成的角色判断或大小限制，提前响应也使用相同的载荷类型。
		for _, before := range beforeDecode {
			if response := before(c); response != nil {
				writeResponse(*response)
				return
			}
		}
		// 合并写入要基于锁内读取的配置段，请求体本身在取得锁之前读取完毕。
		var rawBody []byte
		if merge {
			body, err := io.ReadAll(c.Request.Body)
			if err != nil {
				if bodyTooLarge() {
					writeResponse(apicontract.Failure[Data](-1, "request body is too large"))
					return
				}
				writeResponse(endpoint.DecodeFailure(err))
				return
			}
			rawBody = body
		}
		decodeRequest := func() (request Request, err error) {
			switch endpoint.Definition().Body {
			case apicontract.FormBody:
				// 保留 PostForm 对普通表单、重复字段和解析失败后已有字段的处理。
				c.PostForm("")
				form := &multipart.Form{Value: c.Request.PostForm}
				if c.Request.MultipartForm != nil {
					form.File = c.Request.MultipartForm.File
				}
				return endpoint.DecodeMultipart(form)
			case apicontract.MultipartBody:
				form, parseErr := c.MultipartForm()
				if parseErr != nil {
					return request, parseErr
				}
				return endpoint.DecodeMultipart(form)
			default:
				if merge {
					return endpoint.Decode(bytes.NewReader(mergeSettingBody(setting.Namespace, rawBody)))
				}
				return endpoint.Decode(c.Request.Body)
			}
		}
		run := func() apicontract.Response[Data] {
			request, err := decodeRequest()
			if err != nil {
				if bodyTooLarge() {
					return apicontract.Failure[Data](-1, "request body is too large")
				}
				return endpoint.DecodeFailure(err)
			}
			if err = model.LockRequestAfterDecode(c); err != nil {
				if bodyTooLarge() {
					return apicontract.Failure[Data](-1, "request body is too large")
				}
				return endpoint.DecodeFailure(err)
			}
			return handler(c, request)
		}
		if !merge {
			writeResponse(run())
			return
		}
		writeResponse(withSettingLock(setting.Namespace, run))
	}
}

// mergeSettingBody 把请求体合并进当前配置段；合并失败时保留原始请求体，沿用契约的解码错误。
func mergeSettingBody(namespace string, body []byte) []byte {
	if merged, err := mergeSettingPatch(namespace, body); err == nil {
		return merged
	}
	return body
}

func notebookContract(box *model.Box) *apicontract.Notebook {
	if box == nil {
		return nil
	}
	return &apicontract.Notebook{
		ID: box.ID, Name: box.Name, Icon: box.Icon, Sort: box.Sort, SortMode: box.SortMode,
		Closed: box.Closed, SubFileCount: box.SubFileCount, NewFlashcardCount: box.NewFlashcardCount,
		DueFlashcardCount: box.DueFlashcardCount, FlashcardCount: box.FlashcardCount,
		Encrypted: box.Encrypted, Unlocked: box.Unlocked, State: string(box.State),
	}
}

func notebookInfoContract(info *model.BoxInfo) *apicontract.NotebookInfo {
	if info == nil {
		return nil
	}
	return &apicontract.NotebookInfo{
		ID: info.ID, Name: info.Name, DocCount: info.DocCount, Size: info.Size, HSize: info.HSize,
		Mtime: info.Mtime, CTime: info.CTime, HMtime: info.HMtime, HCtime: info.HCtime,
	}
}

// holdContractBlockRequest 保留显式笔记本选择及全部附带 ID 的租约检查。
// 只读角色对发布门禁拒绝的加密笔记本不取得租约，并统一按块缺失处理，避免锁定状态经响应差异泄露
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-v79r-27qf-2pmg
func holdContractBlockRequest(c *gin.Context, notebook, id string, ids []string, allowMissing bool) (boxID string, err error) {
	readOnly := model.IsReadOnlyRoleContext(c)
	if notebook != "" && model.IsEncryptedBox(notebook) {
		boxID = notebook
		if readOnly && model.IsEncryptedBoxDeniedByPublishAccess(notebook) {
			return
		}
	}
	leaseIDs := append([]string{id}, ids...)
	err = holdEncryptedBlockRequests(c, boxID, leaseIDs, allowMissing || readOnly)
	return
}

// holdContractBlockReadRequest 读取块时对只读角色放行缺失 ID：发布拒绝与不存在都返回空结果，避免暴露块存在性。
func holdContractBlockReadRequest(c *gin.Context, notebook, id string, ids []string) (boxID string, err error) {
	return holdContractBlockRequest(c, notebook, id, ids, model.IsReadOnlyRoleContext(c))
}
