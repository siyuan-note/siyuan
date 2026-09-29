package apicontract

// MCPOAuthConfig 控制内置 MCP 服务端授权，默认关闭。公开地址必须为不含路径的 HTTPS 源。
// 关闭或修改地址会撤销全部授权；原有 API Token 认证不受影响。
type MCPOAuthConfig struct {
	Enabled   bool   `json:"enabled"`
	PublicURL string `json:"publicURL"`
}

// MCPOAuthClientRequest 由管理员预注册客户端，回调地址精确匹配，不支持通配符。
type MCPOAuthClientRequest struct {
	Name        string `json:"name"`
	RedirectURI string `json:"redirectURI"`
}

type MCPOAuthClient struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	RedirectURI string `json:"redirectURI"`
}

// MCPOAuthClientSecret 仅在创建时返回密钥；磁盘只保存摘要，丢失后需重新注册。
type MCPOAuthClientSecret struct {
	MCPOAuthClient
	Secret string `json:"secret"`
}

type MCPOAuthStatus struct {
	MCPOAuthConfig
	Clients []MCPOAuthClient `json:"clients"`
}

// MCPOAuthRemoveRequest 删除客户端及其全部授权。all 为 true 时撤销所有客户端的授权，保留注册。
type MCPOAuthRemoveRequest struct {
	ID  string `json:"id" api:"optional"`
	All bool   `json:"all" api:"optional"`
}

// MCPOAuthTokenRequest 使用表单编码。仅支持授权码和刷新令牌，始终校验目标 resource。
// 客户端使用 client_secret_basic 或 client_secret_post，授权码必须绑定 PKCE S256。
type MCPOAuthTokenRequest struct {
	GrantType     string `json:"grant_type" api:"optional"`
	ClientID      string `json:"client_id" api:"optional"`
	ClientSecret  string `json:"client_secret" api:"optional"`
	Code          string `json:"code" api:"optional"`
	RedirectURI   string `json:"redirect_uri" api:"optional"`
	CodeVerifier  string `json:"code_verifier" api:"optional"`
	RefreshToken  string `json:"refresh_token" api:"optional"`
	Resource      string `json:"resource" api:"optional"`
	Scope         string `json:"scope" api:"optional"`
	Token         string `json:"token" api:"optional"`
	TokenTypeHint string `json:"token_type_hint" api:"optional"`
}

// MCPOAuthTokenResponse 的访问令牌只用于 /mcp，有效期为一小时。
// offline_access 授权提供三十天有效期的刷新令牌；刷新轮换，重放会撤销同一授权。
type MCPOAuthTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope"`
}

type MCPOAuthError struct {
	Error string `json:"error"`
}

type MCPOAuthResourceMetadata struct {
	Resource               string   `json:"resource"`
	AuthorizationServers   []string `json:"authorization_servers"`
	ScopesSupported        []string `json:"scopes_supported"`
	BearerMethodsSupported []string `json:"bearer_methods_supported"`
}

// MCPOAuthServerMetadata 声明预注册客户端及 PKCE，不声明动态注册或 OIDC 身份接口。
type MCPOAuthServerMetadata struct {
	Issuer                                     string   `json:"issuer"`
	AuthorizationEndpoint                      string   `json:"authorization_endpoint"`
	TokenEndpoint                              string   `json:"token_endpoint"`
	RevocationEndpoint                         string   `json:"revocation_endpoint"`
	ResponseTypesSupported                     []string `json:"response_types_supported"`
	GrantTypesSupported                        []string `json:"grant_types_supported"`
	CodeChallengeMethodsSupported              []string `json:"code_challenge_methods_supported"`
	TokenEndpointAuthMethodsSupported          []string `json:"token_endpoint_auth_methods_supported"`
	ScopesSupported                            []string `json:"scopes_supported"`
	AuthorizationResponseISSParameterSupported bool     `json:"authorization_response_iss_parameter_supported"`
}

type MCPOAuthConsentRequest struct {
	Ticket   string `json:"ticket" api:"optional"`
	Decision string `json:"decision" api:"optional"`
}

func mcpOAuthContentOptions() ResponseOptions {
	return HTTPContentOptions(
		HTTPContentVariant{Status: 200, ContentType: "application/json"},
		HTTPContentVariant{Status: 400, ContentType: "application/json"},
		HTTPContentVariant{Status: 401, ContentType: "application/json"},
		HTTPContentVariant{Status: 404, ContentType: "application/json"},
		HTTPContentVariant{Status: 429, ContentType: "application/json"},
		HTTPContentVariant{Status: 500, ContentType: "application/json"},
	)
}

func init() {
	MCPOAuthToken.decodeFailure = func(error) Response[BinaryContent] {
		return SuccessHTTPContent(400, "application/json", []byte(`{"error":"invalid_request"}`))
	}
	MCPOAuthRevoke.decodeFailure = MCPOAuthToken.decodeFailure
}
