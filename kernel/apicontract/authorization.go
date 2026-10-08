package apicontract

// Authorization 显式声明路由的访问要求；公开端点也必须使用 PublicAccess 标记。
// 这些标记只描述现有中间件，不替代处理函数中的资源权限检查或笔记本租约。
type Authorization uint8

const (
	PublicAccess Authorization = 1 << iota
	AuthenticatedAccess
	AdminAccess
	WritableAccess
)

func (a Authorization) Valid() bool {
	if a == PublicAccess {
		return true
	}
	return a&AuthenticatedAccess != 0 && a&^(AuthenticatedAccess|AdminAccess|WritableAccess) == 0
}

// Policies 返回生成元数据使用的访问要求，顺序与路由中间件一致。
func (a Authorization) Policies() []string {
	if a == PublicAccess {
		return []string{"public"}
	}
	var result []string
	for _, item := range []struct {
		flag Authorization
		name string
	}{{AuthenticatedAccess, "authenticated"}, {AdminAccess, "admin"}, {WritableAccess, "writable"}} {
		if a&item.flag != 0 {
			result = append(result, item.name)
		}
	}
	return result
}

// MiddlewareNames 用于核对实际注册的鉴权中间件，不引入运行时模型依赖。
func (a Authorization) MiddlewareNames() []string {
	var result []string
	for _, item := range []struct {
		flag Authorization
		name string
	}{{AuthenticatedAccess, "model.CheckAuth"}, {AdminAccess, "model.CheckAdminRole"}, {WritableAccess, "model.CheckReadonly"}} {
		if a&item.flag != 0 {
			result = append(result, item.name)
		}
	}
	return result
}
