# Banner-PB 登录体系设计

## 方案概述

基于 PocketBase 原生 Auth 系统，最小化侵入现有代码，支持：
- 邮箱/密码 注册登录
- JWT Token 自动刷新
- 角色权限控制（admin / designer）
- 前端登录页 + Auth Context

---

## 数据模型

### 使用 PocketBase 内置 `users` collection

PocketBase 自带 `users` 表，包含：
- email, password（加密存储）
- verified（邮箱验证状态）
- 可扩展自定义字段

### 扩展字段

在 PocketBase Admin Dashboard 中为 `users` 添加：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| role | select | `admin` / `designer`，默认 `designer` |
| display_name | text | 显示名 |

---

## 权限规则设计

### 现有 collections 的规则改为：

```js
// projects
ListRule:   "@request.auth.id != ''"       // 登录即可查看
ViewRule:   "@request.auth.id != ''"
CreateRule: "@request.auth.role = 'admin'" // 仅管理员创建
UpdateRule: "@request.auth.role = 'admin'"
DeleteRule: "@request.auth.role = 'admin'"

// tasks / iterations / generation_configs / generation_results / evaluations
// 规则同上，允许 designer 创建和修改自己的工作
ListRule:   "@request.auth.id != ''"
ViewRule:   "@request.auth.id != ''"
CreateRule: "@request.auth.id != ''"        // 登录即可创建
UpdateRule: "@request.auth.id = owner || @request.auth.role = 'admin'"
DeleteRule: "@request.auth.id = owner || @request.auth.role = 'admin'"
```

注意：需要为 tasks/iterations 等表添加 `owner` 字段（relation → users）。

---

## 前端实现

### 新增文件

```
src/
├── auth/
│   ├── AuthContext.jsx     // React Context，管理登录状态
│   ├── LoginPage.jsx        // 登录页
│   └── ProtectedRoute.jsx  // 路由守卫
```

### AuthContext.jsx

```jsx
import { createContext, useContext, useState, useEffect } from "react";
import pb from "../pb";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(pb.authStore.model);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    pb.authStore.onChange((token, model) => {
      setUser(model);
      setLoading(false);
    });
    // 尝试从 localStorage 恢复登录
    if (pb.authStore.isValid) {
      pb.collection("users").authRefresh().catch(() => {
        pb.authStore.clear();
      });
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    return pb.collection("users").authWithPassword(email, password);
  };

  const register = async (email, password, passwordConfirm, displayName) => {
    return pb.collection("users").create({
      email,
      password,
      passwordConfirm,
      display_name: displayName,
      role: "designer",
    });
  };

  const logout = () => {
    pb.authStore.clear();
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

### LoginPage.jsx

```jsx
import { useState } from "react";
import { useAuth } from "./AuthContext";

export function LoginPage() {
  const { login, register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isRegister) {
        await register(email, password, password, displayName);
      }
      await login(email, password);
    } catch (err) {
      setError(err.message || "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Banner-PB</h1>
        <p className="login-subtitle">AI 驱动的 Banner 生图工具</p>
        <form onSubmit={handleSubmit}>
          {isRegister && (
            <input
              type="text"
              placeholder="显示名称"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          )}
          <input
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? "处理中..." : isRegister ? "注册" : "登录"}
          </button>
        </form>
        <p className="login-switch">
          {isRegister ? "已有账号？" : "没有账号？"}
          <button type="button" onClick={() => { setIsRegister(!isRegister); setError(""); }}>
            {isRegister ? "去登录" : "去注册"}
          </button>
        </p>
      </div>
    </div>
  );
}
```

---

## 后端改动

### 1. 为相关表添加 owner 字段

在 `backend/migrations.go` 的 `ensureTasks`、`ensureIterations` 等函数中添加：

```go
&core.RelationField{Name: "owner", CollectionId: users.Id, Required: true, MaxSelect: 1},
```

### 2. 创建超级管理员

```bash
cd backend
./banner-backend superuser create admin@banner.local your-password
```

### 3. 首次启动自动创建 designer 角色用户（可选，通过 API）

---

## 部署注意事项

1. **PocketBase Admin Dashboard** 访问 `http://127.0.0.1:8090/_/` 管理权限规则
2. **SMTP 配置**（可选）：在 PocketBase Settings → Mail settings 中配置，用于邮箱验证和密码重置
3. **生产环境**：建议使用 Nginx 反向代理 + HTTPS

---

## 接入计划

| 步骤 | 内容 | 影响范围 |
|------|------|---------|
| Step 1 | PocketBase 中为 users 扩展 role/display_name 字段 | 后端 |
| Step 2 | 为各 collection 添加 owner 字段 | 迁移脚本 |
| Step 3 | 设置权限规则（PocketBase Admin UI） | 配置 |
| Step 4 | 创建 AuthContext + LoginPage | 前端 |
| Step 5 | 在 App.jsx 根节点包裹 AuthProvider | 前端 |
| Step 6 | 登录后显示用户名和登出按钮 | ProjectNav |

---

## 备选方案：无后端登录的本地模式

如果暂时不需要多用户体系，可以用简单的本地 token 方案：

```js
// 在 .env 中设置 VITE_ACCESS_TOKEN
// 前端每次请求带上 header: Authorization: Bearer <token>
```

但推荐使用 PocketBase 原生 Auth，代码量小，功能完整。
