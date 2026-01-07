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

package provider

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Provider interface {
	ID() string
	Label() string

	// AuthURL generates the login URL.
	// state: used for CSRF protection.
	// nonce: used for OIDC replay protection (optional for pure OAuth2).
	AuthURL(state, nonce string) string

	// HandleCallback processes the code returned by the provider.
	// It exchanges the code for a token and retrieves user claims.
	// nonce: passed to verify OIDC ID Token (if applicable).
	HandleCallback(ctx context.Context, code, nonce string) (*OIDCClaims, error)
}

func New(name string, cfg *conf.OIDCProviderConf) (Provider, error) {
	switch name {
	case "custom":
		return NewCustom(cfg)
	case "google":
		return NewGoogle(cfg)
	case "microsoft":
		return NewMicrosoft(cfg)
	case "github":
		return NewGitHub(cfg)
	case "casdoor":
		return NewCasdoor(cfg)
	default:
		return nil, errors.New("oidc provider is not supported")
	}
}

func formatRedirectURL(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return defaultRedirectURL()
	}

	u, err := url.Parse(rawURL)
	if err != nil {
		// If parsing fails, try prepending http:// if it looks like a host:port
		if !strings.HasPrefix(rawURL, "http") {
			u, err = url.Parse("http://" + rawURL)
		}
	}

	if err == nil {
		// If no path is specified (or just /), append the default callback path
		if u.Path == "" || u.Path == "/" {
			u.Path = "/auth/oidc/callback"
			return u.String()
		}
	}

	return rawURL
}

func defaultRedirectURL() string {
	switch util.Container {
	case util.ContainerAndroid, util.ContainerIOS, util.ContainerHarmony:
		return "siyuan://oidc-callback"
	case util.ContainerStd:
		return fmt.Sprintf("http://127.0.0.1:%s/auth/oidc/callback", util.ServerPort)
	default:
		return ""
	}
}

const (
	OIDCClaimProvider          = "provider"
	OIDCClaimSubject           = "sub"
	OIDCClaimEmail             = "email"
	OIDCClaimEmailVerified     = "email_verified"
	OIDCClaimPreferredUsername = "preferred_username"
	OIDCClaimName              = "name"
	OIDCClaimIssuer            = "iss"
	OIDCClaimAudience          = "aud"
	OIDCClaimHostedDomain      = "hd"
	OIDCClaimTenantID          = "tid"
	OIDCClaimGroups            = "groups"
)

type OIDCClaims struct {
	Provider          string
	Subject           string
	Email             string
	EmailVerified     *bool
	PreferredUsername string
	Name              string
	Issuer            string
	Audience          []string
	HostedDomain      string
	TenantID          string
	Groups            []string
}

func (claims *OIDCClaims) FilterValues() map[string][]string {
	values := map[string][]string{}
	addValue(values, OIDCClaimProvider, claims.Provider)
	addValue(values, OIDCClaimSubject, claims.Subject)
	addValue(values, OIDCClaimEmail, claims.Email)
	addValue(values, OIDCClaimPreferredUsername, claims.PreferredUsername)
	addValue(values, OIDCClaimName, claims.Name)
	addValue(values, OIDCClaimIssuer, claims.Issuer)
	if nil != claims.EmailVerified {
		addValue(values, OIDCClaimEmailVerified, strconv.FormatBool(*claims.EmailVerified))
	}
	for _, aud := range claims.Audience {
		addValue(values, OIDCClaimAudience, aud)
	}
	addValue(values, OIDCClaimHostedDomain, claims.HostedDomain)
	addValue(values, OIDCClaimTenantID, claims.TenantID)
	for _, group := range claims.Groups {
		addValue(values, OIDCClaimGroups, group)
	}
	return values
}

func addValue(values map[string][]string, key, value string) {
	if "" == value {
		return
	}
	values[key] = append(values[key], value)
}

func claimString(raw map[string]any, key string) string {
	val, ok := raw[key]
	if !ok || nil == val {
		return ""
	}
	switch typed := val.(type) {
	case string:
		return typed
	}
	return ""
}

func claimStringArray(raw map[string]any, key string) []string {
	val, ok := raw[key]
	if !ok || nil == val {
		return nil
	}
	switch typed := val.(type) {
	case []string:
		return typed
	case []interface{}:
		var out []string
		for _, item := range typed {
			if str, ok := item.(string); ok {
				out = append(out, str)
			}
		}
		return out
	case string:
		return []string{typed}
	}
	return nil
}

func claimBool(raw map[string]any, key string) *bool {
	val, ok := raw[key]
	if !ok || nil == val {
		return nil
	}
	switch typed := val.(type) {
	case bool:
		return &typed
	}
	return nil
}
