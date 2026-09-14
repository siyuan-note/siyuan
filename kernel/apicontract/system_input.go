package apicontract

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

func init() {
	SystemGetChangelog.decodeRequest = func(reader io.Reader) (r SystemChangelogRequest, err error) {
		config, err := decodeSettingConfig(reader, SystemGetChangelog.Definition().Path, false)
		if err != nil {
			return r, nil
		}
		r.Force, err = legacyField[bool](config.fields, "force", "Boolean", false)
		return
	}
	SystemSetUILayout.decodeRequest = func(reader io.Reader) (r SystemUILayoutRequest, err error) {
		config, err := decodeSettingConfig(reader, SystemSetUILayout.Definition().Path, false)
		if err != nil {
			return r, err
		}
		raw := config.fields["layout"]
		if len(raw) == 0 {
			raw = []byte("null")
		}
		r.Layout, r.layoutError = legacyJSONValue[map[string]JSONValue](raw)
		if r.layoutError != nil {
			r.layoutError = errors.New(strings.ReplaceAll(r.layoutError.Error(), "map[string]apicontract.JSONValue", "conf.UILayout"))
		}
		return
	}
	SystemLoginAuth.decodeRequest = func(reader io.Reader) (r SystemLoginAuthRequest, err error) {
		config, err := decodeSettingConfig(reader, SystemLoginAuth.Definition().Path, false)
		if err != nil {
			return r, err
		}
		r.AuthCode, r.authCodeError = legacyField[string](config.fields, "authCode", "String", true)
		r.Captcha, r.captchaError = legacyField[string](config.fields, "captcha", "String", false)
		r.RememberMe, _ = legacyField[bool](config.fields, "rememberMe", "Boolean", false)
		return
	}
	SystemOIDCStart.decodeRequest = func(reader io.Reader) (r SystemOIDCStartRequest, err error) {
		r.parseError = json.NewDecoder(reader).Decode(&r)
		return
	}
	SystemOIDCMobileCallback.decodeRequest = func(reader io.Reader) (r SystemOIDCMobileRequest, err error) {
		r.parseError = json.NewDecoder(reader).Decode(&r)
		return
	}
	SystemOIDCPoll.decodeRequest = func(reader io.Reader) (r SystemOIDCPollRequest, err error) {
		r.parseError = json.NewDecoder(reader).Decode(&r)
		return
	}
	SystemOIDCValidatePoll.decodeRequest = func(reader io.Reader) (r SystemOIDCPollRequest, err error) {
		r.parseError = json.NewDecoder(reader).Decode(&r)
		return
	}
	SystemOIDCValidateActivate.decodeRequest = func(reader io.Reader) (r SystemOIDCPollRequest, err error) {
		r.parseError = json.NewDecoder(reader).Decode(&r)
		return
	}
	SystemOIDCValidateCancel.decodeRequest = func(reader io.Reader) (r SystemOIDCPollRequest, err error) {
		r.parseError = json.NewDecoder(reader).Decode(&r)
		return
	}
	decodeOIDC := func(reader io.Reader) (r SystemOIDCRequest, err error) {
		r.SystemOIDC = SystemOIDC{Provider: "custom", Scopes: []string{"openid", "profile", "email"}, ClaimRules: []*SystemOIDCClaimRule{}}
		r.parseError = json.NewDecoder(reader).Decode(&r.SystemOIDC)
		return
	}
	SystemSetOIDC.decodeRequest = decodeOIDC
	SystemOIDCValidateStart.decodeRequest = decodeOIDC
	SystemImportCustomFont.decodeFailure = func(err error) Response[*SystemCustomFont] {
		var sizeError *http.MaxBytesError
		if errors.As(err, &sizeError) {
			return Failure[*SystemCustomFont](413, "font file is too large")
		}
		return Failure[*SystemCustomFont](400, "Field [file] must not be empty")
	}
	SystemImportTLSCABundle.decodeFailure = func(err error) Response[SystemMessageData] {
		return Failure[SystemMessageData](-1, "[file] is required: "+err.Error())
	}
}
