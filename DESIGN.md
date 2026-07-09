# Redis Operator - 设计文档

## 1. 项目概述

### 1.1 项目简介
Redis Operator 是一个轻量级的 Redis 数据管理工具，提供可视化界面来管理 Redis 数据库中的数据。支持所有 Redis 数据类型的查看和操作，包括 String、List、Hash、Set、ZSet 和 Stream。

### 1.2 技术栈

| 层次 | 技术 | 版本 |
|------|------|------|
| 后端框架 | Express | 4.18.2 |
| Redis客户端 | ioredis | 5.3.2 |
| 前端 | 原生HTML/CSS/JS | - |
| 桌面框架 | Electron | 43.1.0 |
| 打包工具 | electron-builder | 26.15.3 |

### 1.3 运行模式

- **开发模式**: `npm start` - 直接运行 Node.js 服务
- **桌面模式**: `npm run electron` - 通过 Electron 启动
- **打包部署**: `npm run build` - 打包为 Windows 安装程序

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron 主进程                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  main.js                                                 │  │
│  │  - 启动/管理 Express 后端服务                             │  │
│  │  - 创建/管理 Electron 窗口                               │  │
│  │  - 日志系统集成                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Express 后端服务 (server.js)                            │  │
│  │  - RESTful API 路由                                     │  │
│  │  - Redis 连接池管理                                      │  │
│  │  - 请求日志记录                                          │  │
│  │  - CORS 跨域支持                                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  前端页面 (public/index.html)                            │  │
│  │  - 连接面板                                              │  │
│  │  - Key 列表                                              │  │
│  │  - 详情面板                                              │  │
│  │  - 各种数据类型编辑器                                     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌──────────────────┐
                    │   Redis Server   │
                    └──────────────────┘
```

### 2.2 目录结构

```
RedisOperator/
├── build/                 # 构建资源
│   ├── icon.ico
│   ├── icon.jpg
│   └── icon.png
├── electron/              # Electron 主进程
│   └── main.js
├── logs/                  # 日志文件（运行时生成）
│   └── redis-operator-YYYY-MM-DD.log
├── public/                # 前端静态资源
│   └── index.html
├── server.js              # Express 后端服务
├── logger.js              # 日志模块
├── package.json           # 项目配置
└── DESIGN.md              # 设计文档
```

---

## 3. 核心模块设计

### 3.1 日志模块 (logger.js)

#### 3.1.1 功能概述
提供统一的日志记录功能，支持文件日志和控制台输出，具备日志轮转能力。

#### 3.1.2 设计要点

| 属性 | 说明 |
|------|------|
| 日志存储路径 | 优先 `%APPDATA%\RedisOperator\logs`，失败时回退到项目目录 `logs` |
| 日志文件名 | `redis-operator-YYYY-MM-DD.log` |
| 单文件最大大小 | 5MB |
| 保留日志文件数 | 5个 |
| 日志级别 | info, warn, error, debug |

#### 3.1.3 日志格式
```
[2026-07-08 22:25:50.922] [INFO] [PID:39320] Request: POST /api/connect [{"body":{"host":"127.0.0.1","port":6379}}]
```

#### 3.1.4 API

| 方法 | 参数 | 说明 |
|------|------|------|
| `info(message, ...args)` | message: 日志消息，args: 附加数据 | 记录信息级别日志 |
| `warn(message, ...args)` | message: 日志消息，args: 附加数据 | 记录警告级别日志 |
| `error(message, ...args)` | message: 日志消息，args: 附加数据 | 记录错误级别日志 |
| `debug(message, ...args)` | message: 日志消息，args: 附加数据 | 记录调试级别日志 |
| `getLogDir()` | 无 | 获取日志目录路径 |

---

### 3.2 Redis 连接管理 (server.js)

#### 3.2.1 连接池设计

```javascript
const connections = new Map(); // key: connId, value: Redis client
```

**连接ID格式**: `host:port/db`

#### 3.2.2 创建连接参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| id | string | - | 连接标识 |
| host | string | '127.0.0.1' | Redis主机 |
| port | number | 6379 | Redis端口 |
| password | string | undefined | 密码（可选） |
| db | number | 0 | 数据库编号 |
| testMode | boolean | false | 测试模式（禁用重试） |

#### 3.2.3 连接配置

```javascript
{
  lazyConnect: true,           // 延迟连接
  connectTimeout: 10000,      // 连接超时 10秒
  retryStrategy(times) {       // 重试策略
    const delay = Math.min(times * 500, 5000);
    return delay;
  },
  maxRetriesPerRequest: 1,     // 单次请求最大重试次数
}
```

#### 3.2.4 连接生命周期事件

| 事件 | 处理 |
|------|------|
| `connect` | 记录连接成功日志 |
| `ready` | 记录连接就绪日志 |
| `error` | 记录错误日志 |
| `close` | 从连接池删除连接 |

---

### 3.3 API 路由设计 (server.js)

#### 3.3.1 连接管理

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/connect` | POST | 连接测试并建立持久连接 |
| `/api/disconnect` | POST | 断开连接 |

#### 3.3.2 数据库操作

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/databases` | POST | 获取所有数据库大小 |
| `/api/select-db` | POST | 切换数据库 |

#### 3.3.3 Key 操作

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/keys` | POST | 分页获取Key列表（SCAN） |
| `/api/get` | POST | 获取Key详情 |
| `/api/set` | POST | 设置String类型Key |
| `/api/del` | POST | 删除Key |
| `/api/create` | POST | 创建新Key |
| `/api/expire` | POST | 设置过期时间 |
| `/api/rename` | POST | 重命名Key |
| `/api/info` | POST | 获取服务器信息 |

#### 3.3.3.1 SCAN 生产安全注意事项

**SCAN 命令本身不是致命操作**，它是增量、非阻塞的，设计上对生产环境安全。但需注意以下几点：

| 风险点 | 说明 | 防护措施 |
|--------|------|----------|
| COUNT 参数 | COUNT 只是提示值，Redis 实际扫描的 key 数可能远超设定值 | COUNT 上限保护（最大 1000），下限保护（最小 10） |
| 并发请求 | 用户快速点击 "Load More" 会产生并发 SCAN 请求 | 前端 `loadingKeys` 状态锁防止并发 |
| MATCH 模式 | `MATCH *` 模式会扫描所有 key，大库下可能扫描数万 key | 推荐用户使用前缀过滤（如 `user:*`） |
| 内存压力 | 每次 SCAN 返回的 keys 会占用内存 | 单次返回数量限制，及时释放 |

**后端保护实现**:
```javascript
const MAX_COUNT = 1000;
const scanCount = Math.min(Math.max(parseInt(count), 10), MAX_COUNT);
```

**前端保护实现**:
```javascript
async function loadMoreKeys() {
  if (!S.connId || !S.hasMore || S.loadingKeys) return;
  S.loadingKeys = true;
  // ... 执行请求 ...
  finally {
    S.loadingKeys = false;
  }
}
```

#### 3.3.3.2 /api/databases 优化

**原实现问题**: 循环切换 16 个数据库并逐个调用 `dbsize()`，频繁 SELECT 切换会干扰其他客户端连接的 DB 上下文。

**优化方案**: 使用 `INFO keyspace` 一次性获取所有数据库的 key 数量，避免频繁 SELECT 切换。

```javascript
const info = await client.info('keyspace');
// 解析结果: db0:keys=100,expires=10,avg_ttl=3600
```

#### 3.3.3.3 性能优化汇总

| 端点 | 原实现 | 优化后 | 风险等级 |
|------|--------|--------|----------|
| `/api/get` (set) | `smembers(key)` 全量返回 | `scard(key)` + `sscan(key, 0, COUNT, 500)` | 致命 |
| `/api/get` (hash) | `hkeys(key)` 全量返回 + `hmget` | `hlen(key)` + `hscan(key, 0, COUNT, 500)` | 致命 |
| `/api/get` (type/ttl) | 两次独立请求 | `Promise.all([type, ttl])` 并行 | 中等 |
| `/api/del` | `del(...keys)` 无上限 | 单次最多 100 个，超过分批删除 | 高 |
| `/api/list/push` | `lpush/rpush(...values)` 无上限 | 最多 1000 个元素 | 中等 |
| `/api/set/add` | `sadd(...members)` 无上限 | 最多 1000 个成员 | 中等 |
| `/api/zset/add` | `zadd(...args)` 无上限 | 最多 1000 个成员 | 中等 |
| `/api/info` | 无参数校验 | section 白名单校验 | 低 |

#### 3.3.3.4 大 Key 处理策略

对于可能包含大量元素的数据类型，采用以下策略：

| 数据类型 | 命令 | 返回限制 |
|----------|------|----------|
| String | `GET` | 无限制（字符串本身大小有限） |
| List | `LLEN` + `LRANGE 0 499` | 最多 500 个元素 |
| Hash | `HLEN` + `HSCAN` | 最多 500 个字段 |
| Set | `SCARD` + `SSCAN` | 最多 500 个成员 |
| ZSet | `ZCARD` + `ZRANGE 0 499 WITHSCORES` | 最多 500 个成员 |
| Stream | `XLEN` + `XRANGE` | 最多 20 条记录 |

#### 3.3.4 List 操作

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/list/push` | POST | 添加元素 |
| `/api/list/pop` | POST | 移除元素 |
| `/api/list/set` | POST | 设置指定索引元素 |
| `/api/list/remove-index` | POST | 删除指定索引元素 |

#### 3.3.5 Hash 操作

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/hash/set` | POST | 设置字段 |
| `/api/hash/del` | POST | 删除字段 |

#### 3.3.6 Set 操作

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/set/add` | POST | 添加成员 |
| `/api/set/remove` | POST | 删除成员 |

#### 3.3.7 ZSet 操作

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/zset/add` | POST | 添加成员 |
| `/api/zset/remove` | POST | 删除成员 |

---

### 3.4 前端设计 (public/index.html)

#### 3.4.1 界面布局

```
┌─────────────────────────────────────────────────────────────────┐
│  Sidebar                    │  Key Panel         │  Detail      │
│  ┌────────────────────────┐  ┌─────────────────┐  │ Panel       │
│  │ Logo + Version         │  │ Header + Search │  │             │
│  ├────────────────────────┤  ├─────────────────┤  │             │
│  │ Connection Form        │  │ Key List        │  │ Key Detail  │
│  │ - Host, Port, DB       │  │ (Scrollable)    │  │ Editor      │
│  │ - Password             │  ├─────────────────┤  │             │
│  │ - Connect Button       │  │ Load More       │  │             │
│  ├────────────────────────┤  │                 │  │             │
│  │ Database Selector      │  │                 │  │             │
│  │ (16 DB buttons)        │  │                 │  │             │
│  ├────────────────────────┤  │                 │  │             │
│  │ Copyright              │  │                 │  │             │
│  └────────────────────────┘  └─────────────────┘  └─────────────┘
└─────────────────────────────────────────────────────────────────┘
```

#### 3.4.2 状态管理

```javascript
const S = {
  connId: null,           // 当前连接ID
  connected: false,       // 连接状态
  currentDb: 0,           // 当前数据库
  currentKey: null,       // 当前选中的Key
  currentData: null,      // 当前Key的数据
  keys: [],               // Key列表
  cursor: 0,              // SCAN游标
  hasMore: false,         // 是否有更多Key
  selectedKeys: new Set(), // 选中的Key集合
  dbSizes: [16],          // 各数据库大小
  redisVersion: '',       // Redis版本
  searchPattern: '*',     // 搜索模式
  typeFilter: 'all',      // 类型过滤器
};
```

#### 3.4.3 错误处理

前端对常见错误进行友好提示转换：

| 原始错误 | 用户提示 |
|----------|----------|
| `Failed to fetch` | 无法连接到服务器，请检查应用是否正常启动 |
| 网络错误 | 网络连接错误，请检查网络连接 |
| 超时 | 请求超时，请稍后重试 |
| CORS错误 | 跨域请求被阻止，请检查服务器配置 |

---

## 4. 错误处理设计

### 4.1 Redis 错误格式化 (formatRedisError)

后端对 Redis 连接错误进行格式化，提供友好的中文提示：

| 错误类型 | 用户提示 |
|----------|----------|
| `ECONNREFUSED` | 连接被拒绝，请检查 Redis 服务是否启动，以及主机和端口是否正确 |
| `ETIMEDOUT` / `timeout` | 连接超时，请检查网络连接和 Redis 服务状态 |
| `ENOTFOUND` / `EAI_AGAIN` | 无法解析主机地址，请检查主机名是否正确 |
| `NOAUTH` / `password` / `AUTH` | 密码错误，请检查 Redis 密码 |
| `ERR invalid DB index` | 数据库索引无效，请检查 DB 编号 |
| `Connection is closed` | 连接已关闭，请重试 |

### 4.2 全局异常捕获

- `uncaughtException`: 捕获未处理异常，记录错误日志
- `unhandledRejection`: 捕获未处理的 Promise 拒绝，记录错误日志

---

## 5. 安全设计

### 5.1 CORS 配置

```javascript
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

### 5.2 输入验证

- 所有请求参数进行类型转换和默认值处理
- 敏感信息（密码）不记录到日志

---

## 6. 打包与部署

### 6.1 打包配置

使用 `electron-builder` 打包为 Windows NSIS 安装程序：

```json
{
  "appId": "com.redisoperator.app",
  "productName": "Redis Operator",
  "win": {
    "target": "nsis",
    "icon": "build/icon.ico"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true
  }
}
```

### 6.2 打包后路径处理

打包后通过 `process.resourcesPath` 定位资源文件：

| 文件 | 开发路径 | 打包后路径 |
|------|----------|------------|
| server.js | `__dirname/../server.js` | `process.resourcesPath/server.js` |
| public/ | `__dirname/public` | `process.resourcesPath/public` |
| logger.js | `./logger` | `process.resourcesPath/logger` |

### 6.3 打包文件清单

`package.json` 的 `build.files` 配置必须包含以下文件：

```json
{
  "files": [
    "electron/**/*",
    "server.js",
    "logger.js",
    "public/**/*",
    "node_modules/**/*",
    "package.json"
  ]
}
```

### 6.3.1 extraResources 配置

由于 `fork()` 无法直接运行 asar 包内的文件，`server.js`、`logger.js` 和 `public` 目录必须作为外部资源复制到 `resources` 目录：

```json
{
  "extraResources": [
    {
      "from": "node_modules",
      "to": "node_modules",
      "filter": ["**/*"]
    },
    {
      "from": "server.js",
      "to": "."
    },
    {
      "from": "logger.js",
      "to": "."
    },
    {
      "from": "public",
      "to": "public"
    }
  ]
}
```

### 6.3.2 打包后目录结构

```
Redis Operator/
├── Redis Operator.exe
├── resources/
│   ├── app.asar          # Electron 主程序
│   ├── server.js         # 后端服务（extraResources 复制）
│   ├── logger.js         # 日志模块（extraResources 复制）
│   ├── public/           # 前端页面（extraResources 复制）
│   │   └── index.html
│   └── node_modules/     # 依赖（extraResources 复制）
```

### 6.4 打包状态检测

通过 `APP_IS_PACKAGED` 环境变量传递打包状态，避免依赖 `process.resourcesPath` 的存在性（Electron 开发模式下也存在）：

**Electron 主进程**:
```javascript
function isPackaged() {
  return app.isPackaged;
}

// fork 子进程时传递环境变量
serverProcess = fork(serverPath, [], {
  env: { 
    APP_IS_PACKAGED: String(isPackaged()),
    RESOURCES_PATH: process.resourcesPath || path.dirname(__dirname),
  },
});
```

**Express 服务进程**:
```javascript
const isPackaged = process.env.APP_IS_PACKAGED === 'true' || process.env.NODE_ENV === 'production';
```

### 6.5 打包检查清单

- [ ] `logger.js` 已添加到 `build.files`
- [ ] 所有新增的根目录文件都已添加到 `build.files`
- [ ] 路径引用使用 `RESOURCES_PATH` 环境变量
- [ ] 打包状态检测使用 `APP_IS_PACKAGED` 环境变量

---

## 7. 运行日志

### 7.1 日志查看

通过 Electron 菜单 `Help > View Logs` 直接打开日志目录。

### 7.2 日志示例

**连接成功**:
```
[2026-07-08 22:25:50.922] [INFO] Request: POST /api/connect
[2026-07-08 22:25:50.923] [INFO] Attempting to connect to Redis: 127.0.0.1:6379/0
[2026-07-08 22:25:50.937] [INFO] Redis [127.0.0.1:6379/0] connected successfully
[2026-07-08 22:25:50.939] [INFO] Connection successful: 127.0.0.1:6379/0
```

**连接失败**:
```
[2026-07-08 22:24:25.287] [INFO] Attempting to connect to Redis: 127.0.0.1:6380/0
[2026-07-08 22:24:25.295] [ERROR] Redis test connection error: 127.0.0.1:6380/0 ["connect ECONNREFUSED 127.0.0.1:6380"]
```

---

## 8. 版权信息

```
Copyright © 2026 南昌市星纬智创科技有限公司. All rights reserved.
```

显示位置：侧边栏底部。

---

## 9. 代码修改记录

| 版本 | 修改内容 | 文件 |
|------|----------|------|
| v1.0.0 | 初始版本 | 所有文件 |
| v1.0.1 | 修复连接错误信息不明确 | server.js |
| v1.0.1 | 修复连接重试过多问题 | server.js |
| v1.0.1 | 修复 /api/databases 路由问题 | server.js |
| v1.0.1 | 修复 keys 接口 pipeline 解析 bug | server.js |
| v1.0.1 | 添加日志模块 | logger.js |
| v1.0.1 | 集成日志系统到 server.js | server.js |
| v1.0.1 | 集成日志系统到 electron/main.js | electron/main.js |
| v1.0.1 | 添加 CORS 支持 | server.js |
| v1.0.1 | 改进前端错误处理 | public/index.html |
| v1.0.1 | 添加版权信息 | public/index.html |
| v1.0.1 | SCAN COUNT 参数上限保护（最大 1000） | server.js |
| v1.0.1 | 前端 loadMoreKeys 添加 loading 锁防止并发 | public/index.html |
| v1.0.1 | /api/databases 使用 INFO keyspace 替代 SELECT 循环 | server.js |
| v1.0.1 | /api/get set 类型 smembers → scard + sscan | server.js |
| v1.0.1 | /api/get hash 类型 hkeys → hlen + hscan | server.js |
| v1.0.1 | /api/get type+ttl 合并为 Promise.all | server.js |
| v1.0.1 | /api/del 批量删除上限 100，超过分批 | server.js |
| v1.0.1 | /api/list/push 元素上限 1000 | server.js |
| v1.0.1 | /api/set/add 成员上限 1000 | server.js |
| v1.0.1 | /api/zset/add 成员上限 1000 | server.js |
| v1.0.1 | /api/info section 参数白名单校验 | server.js |
| v1.0.1 | package.json 添加 logger.js 到 build.files | package.json |
| v1.0.1 | isPackaged 检测改用 APP_IS_PACKAGED 环境变量 | server.js, electron/main.js |