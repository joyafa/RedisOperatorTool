# Redis Operator

一个轻量级的Redis数据管理工具，提供直观的图形界面来管理Redis数据库。

## 版本说明

### v1.1.0 (2026-07-11)

**新增功能**：
- 支持多种Redis数据类型：String、List、Hash、Set、ZSet、Stream、Bitmap、HyperLogLog、GEO、JSON、TimeSeries
- 树形Key列表，支持复选框选择和文件夹全选功能
- 创建Key时显示类型说明和使用场景提示
- GEO、Bitmap、JSON等特殊类型自动降级存储支持（使用元数据机制记录逻辑类型）
- 类型筛选器支持所有11种数据类型
- 自定义Prompt和Confirm模态框，替代浏览器原生弹窗
- 所有删除操作添加确认弹窗（删除Key、批量删除、列表元素删除、Hash字段删除、Set/ZSet成员删除）
- NSIS安装程序改为非一键安装模式，支持选择安装目录

**修复问题**：
- 修复Stream类型创建和查看的语法错误（使用client.call方法）
- 修复连接后立即断开的问题（添加windowLoaded和isLoadingURL并发保护）
- 修复复选框无法点击选中的问题（增大尺寸至16px，修复点击冲突）
- 修复复选框indeterminate属性设置不正确的问题（通过JavaScript设置）
- 修复特殊类型筛选显示错误的问题（使用元数据HSET __redis_operator_types__ key type记录类型）
- 修复安装程序界面问题（使用electron-builder标准NSIS模板）

**性能优化**：
- 使用SCAN命令分页获取Key，避免阻塞生产环境
- 用户交互感知，操作时暂停后台加载
- 大Key分页加载，避免界面卡顿

## 功能特性

- **Redis连接管理**：支持连接本地和远程Redis服务器，支持密码认证和数据库选择
- **树形Key列表**：自动按照冒号分隔符组织成目录结构，方便浏览大量Key
- **11种数据类型支持**：String、List、Hash、Set、ZSet、Stream、Bitmap、HyperLogLog、GEO、JSON、TimeSeries
- **键操作**：查看、创建、编辑、重命名、删除键
- **TTL管理**：设置和查看键的过期时间
- **批量操作**：支持批量删除选中的键，文件夹一键全选
- **类型筛选**：按数据类型筛选Key列表
- **搜索功能**：支持通配符搜索Key
- **类型说明**：创建Key时显示类型含义和使用场景
- **性能优化**：使用SCAN命令分页获取Key，避免阻塞生产环境
- **用户交互感知**：自动查询时检测用户操作，暂停加载避免界面卡顿

## 技术栈

- **Electron**：桌面应用框架
- **Express**：后端API服务
- **ioredis**：Redis客户端
- **HTML/CSS/JavaScript**：前端界面

## 安装方法

### 免安装版

1. 下载 `Redis-Operator-Portable-1.1.0.exe`
2. 双击运行即可使用

### 安装版

1. 下载 `Redis-Operator-1.1.0-x64.exe`
2. 运行安装程序，按照向导完成安装（支持选择安装目录）
3. 从开始菜单或桌面快捷方式启动应用

## 使用说明

### 连接Redis

1. 在左侧面板输入Redis服务器地址（默认：`127.0.0.1`）
2. 输入端口号（默认：`6379`）
3. 如果需要密码认证，输入密码
4. 选择数据库（0-15）
5. 点击 **Connect** 按钮连接

### 浏览Key

- Key列表自动按照树形结构显示，使用冒号 `:` 作为路径分隔符
- 点击文件夹图标展开/折叠子目录
- 点击键名查看详细内容
- 使用搜索框搜索特定Key
- 使用类型筛选器按数据类型过滤

### 操作Key

- **查看**：点击Key名称在右侧面板查看内容
- **创建**：点击 **+ Add Key** 按钮创建新键
- **编辑**：在右侧面板修改值后点击 **Save**
- **重命名**：点击键旁的重命名按钮
- **设置TTL**：点击键旁的TTL按钮设置过期时间
- **删除**：点击键旁的删除按钮或选中后使用批量删除

### 批量操作

1. 勾选多个键的复选框
2. 点击底部批量操作栏的 **Delete Selected** 按钮删除选中的键

## 开发

### 环境要求

- Node.js >= 18.x
- npm >= 9.x

### 安装依赖

```bash
npm install
```

### 运行开发环境

```bash
# 启动后端服务
npm run dev

# 启动Electron窗口（新终端）
npm run electron
```

### 构建应用

```bash
# 构建Windows安装包和便携版
npm run build
```

构建产物位于 `build-20260711-v2` 目录，包含：
- `Redis-Operator-1.1.0-x64.exe`：NSIS安装包（非一键安装，支持选择目录）
- `Redis-Operator-Portable-1.1.0.exe`：便携版（免安装）
- `win-unpacked/`：免安装目录版本

## 项目结构

```
RedisOperator/
├── electron/                      # Electron主进程代码
│   └── main.js                    # 主进程入口（窗口管理、服务器启动、菜单）
├── public/                        # 前端静态资源
│   └── index.html                 # 主界面（包含CSS和JavaScript，单页应用）
├── server.js                      # Express后端服务（Redis连接、API路由）
├── logger.js                      # 日志模块（日志写入、轮转、路径管理）
├── package.json                   # 项目配置（依赖、脚本、electron-builder配置）
└── README.md                      # 项目说明
```

### 文件说明

| 文件 | 说明 | 关键功能 |
|------|------|---------|
| `electron/main.js` | Electron主进程 | 窗口创建、Express服务启动、菜单管理、日志目录配置 |
| `public/index.html` | 前端界面 | 连接面板、树形Key列表、数据编辑、自定义模态框、类型说明卡片 |
| `server.js` | Express后端 | Redis连接管理、数据类型操作API、SCAN分页、元数据管理 |
| `logger.js` | 日志模块 | 日志写入、按日期轮转、敏感信息脱敏 |

## 性能优化说明

### SCAN命令

使用Redis SCAN命令替代KEYS命令，避免在大数据量时阻塞服务器：
- 每次查询最多返回100个Key
- 使用游标机制分批获取所有Key
- 自动后台加载剩余Key，通过定时器控制加载速度

### 用户交互感知

自动查询时检测用户操作（鼠标移动、点击、键盘输入、滚动）：
- 用户操作时暂停后台加载，避免界面卡顿
- 操作停止1.5秒后恢复加载
- 使用 `requestAnimationFrame` 优化渲染性能

### 元数据管理

特殊数据类型（GEO、Bitmap、JSON、TimeSeries）使用元数据机制：
- 使用 `HSET __redis_operator_types__ key type` 记录每个Key的逻辑类型
- 获取Key列表时优先使用元数据中的类型，避免误判
- 删除Key时同步删除对应的元数据记录

### 类型降级存储

部分扩展类型在不支持的Redis版本下自动降级：
- **GEO** → ZSET（存储经纬度编码）
- **Bitmap** → String（位操作）
- **JSON** → String（JSON字符串）
- **TimeSeries** → String（时间序列数据）

## 日志

日志文件位于应用数据目录：
- Windows：`%APPDATA%\Redis Operator\logs`
- 日志包含连接信息、API请求和错误记录

## License

Copyright © 2026 南昌市星纬智创科技有限公司. All rights reserved.
