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

package oidc

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model/oidc/provider"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	oidcLoginTimeout = 10 * time.Second
)

func IsEnabled(oidcConf *conf.OIDC) bool {
	if nil == oidcConf || "" == strings.TrimSpace(oidcConf.Provider) {
		return false
	}

	pc := providerConf(oidcConf)
	if nil == pc {
		return false
	}

	return true
}

const defaultProviderLabel = "Login with SSO"

func ProviderLabel(oidcConf *conf.OIDC) string {
	if !IsEnabled(oidcConf) {
		return defaultProviderLabel
	}
	p, err := providerInstance(oidcConf)
	if err != nil {
		return defaultProviderLabel
	}
	return p.Label()
}

func IsSessionValid(oidcConf *conf.OIDC, workspaceSession *util.WorkspaceSession) bool {
	if nil == workspaceSession || nil == workspaceSession.OIDC {
		return false
	}
	if !IsEnabled(oidcConf) {
		return false
	}
	p, err := providerInstance(oidcConf)
	if err != nil {
		return false
	}
	if workspaceSession.OIDC.Provider != p.ID() {
		return false
	}
	return "" != workspaceSession.OIDC.Subject
}

func Login(c *gin.Context, oidcConf *conf.OIDC) {
	if !IsEnabled(oidcConf) {
		c.Status(http.StatusNotFound)
		return
	}

	p, err := providerInstance(oidcConf)
	if err != nil {
		logging.LogErrorf("init oidc provider failed: %s", err)
		c.Status(http.StatusInternalServerError)
		return
	}

	session := util.GetSession(c)
	workspaceSession := util.GetWorkspaceSession(session)
	workspaceSession.OIDC.Challenge(p.ID(), sanitizeRedirectPath(c.Query("to")), parseBoolQuery(c.Query("rememberMe")))

	if err := session.Save(c); err != nil {
		logging.LogErrorf("save session failed: %s", err)
		c.Status(http.StatusInternalServerError)
		return
	}

	authURL := p.AuthURL(workspaceSession.OIDC.State, workspaceSession.OIDC.Nonce)
	if "" == authURL {
		c.Status(http.StatusInternalServerError)
		return
	}
	c.Redirect(http.StatusFound, authURL)
}

func Callback(c *gin.Context, oidcConf *conf.OIDC) {
	if !IsEnabled(oidcConf) {
		c.Status(http.StatusNotFound)
		return
	}

	session := util.GetSession(c)
	workspaceSession := util.GetWorkspaceSession(session)
	if "" == workspaceSession.OIDC.State || c.Query("state") != workspaceSession.OIDC.State {
		logging.LogWarnf("invalid oidc state [ip=%s]", util.GetRemoteAddr(c.Request))
		c.Status(http.StatusUnauthorized)
		return
	}

	code := c.Query("code")
	if "" == code {
		logging.LogWarnf("missing oidc code [ip=%s]", util.GetRemoteAddr(c.Request))
		c.Status(http.StatusUnauthorized)
		return
	}

	p, err := providerInstance(oidcConf)
	if err != nil {
		logging.LogErrorf("init oidc provider failed: %s", err)
		c.Status(http.StatusInternalServerError)
		return
	}

	if "" != workspaceSession.OIDC.Provider && workspaceSession.OIDC.Provider != p.ID() {
		logging.LogWarnf("oidc provider mismatch [ip=%s]", util.GetRemoteAddr(c.Request))
		c.Status(http.StatusUnauthorized)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), oidcLoginTimeout)
	defer cancel()

	claims, err := p.HandleCallback(ctx, code, workspaceSession.OIDC.Nonce)
	if err != nil {
		logging.LogWarnf("oidc callback failed: %s", err)
		c.Status(http.StatusUnauthorized)
		return
	}

	if "" == claims.Subject {
		logging.LogWarnf("oidc subject missing [ip=%s]", util.GetRemoteAddr(c.Request))
		c.Status(http.StatusUnauthorized)
		return
	}

	if !IsAllowed(oidcConf.Filters, claims) {
		logging.LogWarnf("oidc filter rejected [ip=%s]", util.GetRemoteAddr(c.Request))
		c.Status(http.StatusUnauthorized)
		return
	}

	redirectTo, rememberMe := workspaceSession.OIDC.Complete(claims.Subject, claims.Email)
	redirectTo = sanitizeRedirectPath(redirectTo)

	maxAge := 0
	if rememberMe {
		maxAge = 60 * 60 * 24 * 30
	}
	ginSessions.Default(c).Options(ginSessions.Options{
		Path:     "/",
		Secure:   util.SSL,
		MaxAge:   maxAge,
		HttpOnly: true,
	})

	if err = session.Save(c); err != nil {
		logging.LogErrorf("save session failed: %s", err)
		c.Status(http.StatusInternalServerError)
		return
	}
	logging.LogInfof("oidc auth success [ip=%s, maxAge=%d]", util.GetRemoteAddr(c.Request), maxAge)

	c.Redirect(http.StatusFound, redirectTo)
}

func providerConf(oidcConf *conf.OIDC) *conf.OIDCProviderConf {
	providerID := strings.TrimSpace(oidcConf.Provider)
	return oidcConf.Providers[providerID]
}

func providerInstance(oidcConf *conf.OIDC) (provider.Provider, error) {
	pc := providerConf(oidcConf)
	if nil == pc {
		return nil, errors.New("OIDC provider config not found")
	}
	return provider.New(oidcConf.Provider, pc)
}

func parseBoolQuery(val string) bool {
	val = strings.TrimSpace(val)
	if "" == val {
		return false
	}
	if "1" == val {
		return true
	}
	parsed, err := strconv.ParseBool(val)
	return err == nil && parsed
}

func sanitizeRedirectPath(dest string) string {
	if "" == dest {
		return "/"
	}
	parsed, err := url.Parse(dest)
	if err != nil || parsed.IsAbs() || "" != parsed.Host {
		return "/"
	}
	if strings.HasPrefix(parsed.Path, "//") {
		return "/"
	}
	if "" == parsed.Path {
		parsed.Path = "/"
	}
	if !strings.HasPrefix(parsed.Path, "/") {
		return "/"
	}
	parsed.Scheme = ""
	parsed.Host = ""
	parsed.User = nil
	return parsed.String()
}
