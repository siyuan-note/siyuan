package model

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model/mcpoauth"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var mcpOAuthStore struct {
	sync.Mutex
	path    string
	service *mcpoauth.Service
}

// MCPOAuthService 的授权状态属于当前工作空间，管理员认证配置变化时撤销既有授权。
func MCPOAuthService() (*mcpoauth.Service, error) {
	mcpOAuthStore.Lock()
	defer mcpOAuthStore.Unlock()
	if Conf == nil || util.ConfDir == "" {
		return nil, mcpoauth.ErrDisabled
	}
	data, err := json.Marshal(struct {
		Cookie, Password string
		OIDC             *conf.OIDC
	}{Conf.CookieKey, Conf.AccessAuthCode, Conf.GetOIDC()})
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(data)
	epoch := hex.EncodeToString(digest[:])
	path := filepath.Join(util.ConfDir, "mcp-oauth.json")
	if mcpOAuthStore.service == nil || mcpOAuthStore.path != path {
		service, openErr := mcpoauth.Open(path, epoch)
		if openErr != nil {
			return nil, openErr
		}
		mcpOAuthStore.path, mcpOAuthStore.service = path, service
	}
	if err = mcpOAuthStore.service.EnsureEpoch(epoch); err != nil {
		return nil, err
	}
	return mcpOAuthStore.service, nil
}

func MCPOAuthAvailable() bool {
	return Conf != nil && IsAccessAuthRequired() && !util.SiYuanAccessAuthCodeBypass
}

type mcpOAuthChallengeWriter struct {
	gin.ResponseWriter
	challenge string
}

func (w *mcpOAuthChallengeWriter) WriteHeader(status int) {
	if status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", w.challenge)
	}
	w.ResponseWriter.WriteHeader(status)
}

// CheckMCPAuth 仅在 MCP 入口接受 OAuth 凭证，保留 API Token、会话和角色校验。
func CheckMCPAuth(c *gin.Context) {
	header := strings.Fields(c.GetHeader("Authorization"))
	isBearer := len(header) == 2 && strings.EqualFold(header[0], "Bearer")
	if isBearer && util.AuthCodeEquals(Conf.Api.Token, header[1]) {
		CheckAuth(c)
		return
	}
	service, err := MCPOAuthService()
	enabled := err == nil && service.Status().Enabled && MCPOAuthAvailable()
	if isBearer && (strings.HasPrefix(header[1], mcpoauth.AccessPrefix) || enabled) {
		if !enabled {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		// 已注入的非管理员身份不能被 OAuth 令牌提升。
		role := GetGinContextRole(c)
		if role == RoleReader || role == RoleEditor {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		metadata := service.Status().PublicURL + "/.well-known/oauth-protected-resource/mcp"
		verifier := func(context.Context, string, *http.Request) (*auth.TokenInfo, error) {
			grant, verifyErr := service.Access(header[1])
			if verifyErr != nil {
				return nil, auth.ErrInvalidToken
			}
			return &auth.TokenInfo{UserID: grant.ID, Scopes: strings.Fields(grant.Scope), Expiration: grant.Expires}, nil
		}
		handler := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			c.Request = r
			c.Set(RoleContextKey, RoleAdministrator)
			c.Next()
		})
		auth.RequireBearerToken(verifier, &auth.RequireBearerTokenOptions{ResourceMetadataURL: metadata})(handler).ServeHTTP(c.Writer, c.Request)
		c.Abort()
		return
	}
	if enabled {
		challenge := fmt.Sprintf(`Bearer resource_metadata="%s/.well-known/oauth-protected-resource/mcp", scope="mcp offline_access"`, service.Status().PublicURL)
		if c.GetHeader("Authorization") == "" && c.Query("token") == "" &&
			!IsAdminRoleContext(c) && GetGinContextRole(c) != RoleReader && GetGinContextRole(c) != RoleEditor &&
			!IsWorkspaceSessionAuthenticated(util.GetWorkspaceSession(util.GetSession(c))) {
			c.Header("WWW-Authenticate", challenge)
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		c.Writer = &mcpOAuthChallengeWriter{ResponseWriter: c.Writer,
			challenge: challenge}
	}
	CheckAuth(c)
}
