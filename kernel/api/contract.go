package api

import (
	"encoding/base64"
	"fmt"
	"mime/multipart"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	goccyJSON "github.com/goccy/go-json"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func notebookConfContract(value *conf.BoxConf) *apicontract.NotebookConf {
	if value == nil {
		return nil
	}
	result := &apicontract.NotebookConf{
		Name: value.Name, Sort: value.Sort, Icon: value.Icon, Closed: value.Closed,
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
		// 保留在读取请求体前完成的角色判断或大小限制，提前响应也使用相同的载荷类型。
		for _, before := range beforeDecode {
			if response := before(c); response != nil {
				writeResponse(*response)
				return
			}
		}
		var request Request
		var err error
		if endpoint.Definition().Body == apicontract.FormBody {
			// 保留 PostForm 对普通表单、重复字段和解析失败后已有字段的处理。
			c.PostForm("")
			form := &multipart.Form{Value: c.Request.PostForm}
			if c.Request.MultipartForm != nil {
				form.File = c.Request.MultipartForm.File
			}
			request, err = endpoint.DecodeMultipart(form)
		} else if endpoint.Definition().Body == apicontract.MultipartBody {
			form, parseErr := c.MultipartForm()
			if parseErr != nil {
				err = parseErr
			} else {
				request, err = endpoint.DecodeMultipart(form)
			}
		} else {
			request, err = endpoint.Decode(c.Request.Body)
		}
		if err != nil {
			writeResponse(endpoint.DecodeFailure(err))
			return
		}
		writeResponse(handler(c, request))
	}
}

// contractFailure 保留既有业务校验的错误码和消息，并限制其错误载荷形态。
func contractFailure[Data any](result *gulu.Result) apicontract.Response[Data] {
	switch data := result.Data.(type) {
	case nil:
		return apicontract.Failure[Data](result.Code, result.Msg)
	case string:
		return apicontract.FailureWithText[Data](result.Code, result.Msg, data)
	default:
		panic(fmt.Sprintf("unsupported API error data %T", result.Data))
	}
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
func holdContractBlockRequest(c *gin.Context, notebook, id string, ids []string, allowMissing bool) (boxID string, err error) {
	if notebook != "" && model.IsEncryptedBox(notebook) {
		boxID = notebook
	}
	leaseIDs := append([]string{id}, ids...)
	err = holdEncryptedBlockRequests(c, boxID, leaseIDs, allowMissing)
	return
}
