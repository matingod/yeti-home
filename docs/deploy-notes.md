# 部署笔记

开源包包含界面、登录与生活 API、采集器和几项可选运维工具，不包含作者的生产数据或完整 AI/任务调度后端。

## 先看本地演示

需要 Python 3.10+，从仓库根目录运行：

```bash
python3 demo/demo-server.py
```

访问 `http://127.0.0.1:8990`，口令为 `demo`。演示角色与数字均为虚构，只绑定本机回环地址，不要当成公网服务使用。

## 只部署界面

`site/` 可以交给任意静态服务器。所有资源使用 `/static/...` 根路径，因此应部署到独立站点根目录。

仅静态托管没有登录隔离，也不提供持久化记事、任务控制或硬件数据。请勿把私人内容放入其中。

- 服务入口与搜索：修改首页卡片、`site/yeti/search-index.json`、`site/yuki/search-index.json`。
- 内外网路由：按自己的需要填写 `site/static/access-routes-v10.json`。
- 天气：修改 `site/static/town-weather-v9.js` 的示例城市、经纬度与缓存键；可选同源快照工具的配置也须一致。
- 账号标识：`yeti`、`yuki` 是既有路径契约；显示姓名使用虚构名称。更改标识需要同时修改路径、用户配置与前端映射。

`192.0.2.10` 和 `home.example` 是文档占位，不是可用服务地址。

## 接上正式登录和生活 API

正式服务没有默认口令，也不会在用户表缺失时补建账号。需要准备 Python 3.10+ 和 Caddy，并在自己的服务器完成初始化。

以下命令假定代码放在 `/srv/homepage`，由拥有该目录写权限的专用用户运行：

```bash
# 将仓库里的 site/ 复制到独立网页目录。
mkdir -p /srv/homepage/www
cp -a site/. /srv/homepage/www/

# 交互输入两个账号的口令；不在命令行或终端输出中显示凭据。
python3 gatekeeper/init-users.py --data /srv/homepage/private

# 配置文件与 users.json 均为 0600，目录为 0700。
set -a
. /srv/homepage/private/gatekeeper.env
set +a
python3 gatekeeper/gatekeeper.py
```

随后在另一个终端启动 Caddy：

```bash
caddy validate --config caddy/Caddyfile.example --adapter caddyfile
caddy run --config caddy/Caddyfile.example --adapter caddyfile
```

默认访问 `https://localhost:8443`。模板使用本地 CA，客户端需显式信任该 CA；公网部署请改为自己的域名及可信证书。不要通过关闭 TLS 校验来部署。

| 变量 | 用途 |
|---|---|
| `GK_DATA` | 私有数据目录，必须位于网页目录之外 |
| `GK_SECRET` | 至少 32 字符的独立随机签名密钥，无弱默认值 |
| `GK_BIND` / `GK_PORT` | 登录后端监听地址与端口；默认回环地址和 `8190` |
| `GK_COOKIE_SECURE` | 初始化默认启用 Secure Cookie，配合 HTTPS |
| `HOME_ADDRESS` | Caddy 站点地址，默认 `localhost:8443` |
| `HOME_WEB_ROOT` | Caddy 网页目录，默认 `/srv/homepage/www` |
| `GK_UPSTREAM` | Caddy 使用的登录后端，默认 `127.0.0.1:8190` |

`/yeti/` 要求管理员权限，`/yuki/` 允许家庭成员和管理员。Caddy 只放行明确列出的生活 API 与状态文件；AI、任务和其他未提供的后端不会自动开放。

**不要把整个项目目录、私有数据目录或日志目录配置成公开的静态根目录。** `config/users.example.json` 只是字段结构示例，不能直接拿来登录。

## 添加硬件采集与运维工具

需要 Node.js 和适合自己系统的采集命令。采集器涉及 Linux、NVIDIA 与可选的虚拟机/存储工具；缺少对应组件时应按自己的平台调整，不能直接套用另一台机器的结果。

完整参数与命令见 [后端更新说明](backend-update.md)。重点区分：

- `data/` 保存私有状态与统计中间数据，不能整体公开。
- 网页只读取 `www/data/status.json` 与 `www/data/live.json`。Caddy 对这两个文件要求登录，其余 `/data/*` 拒绝访问。
- 天气与聚合统计放入专门的公开输出文件；不要公开原始访问日志、访问者地址或用户表。
- 变更日志生成器应只输入你愿意向获授权用户展示的内容。仓库不含生产日志。
- 检查一次真实采集后再添加计划任务，避免无效服务反复探测；示例服务列表默认不连接作者环境。

## 迁移旧版本

1. 备份自己的私人数据和配置，勿提交到 Git。
2. 为登录服务生成新的强签名密钥，初始化或迁移合规账号哈希。
3. 换上新的 Caddy 白名单路由，核对静态根目录与状态输出位置。
4. 实测两种角色登录、匿名访问和受保护路径，之后再开放外网。
5. 旧版本中出现过的凭据应撤销或轮换。拉取新版、删除字面量和清理 Git 历史都不会让已泄漏凭据自动失效。

## 常见问题

- **启动被拒绝**：先检查签名密钥长度、账号文件结构和目录权限，不要通过恢复默认密码绕过。
- **登录后仍回登录页**：检查两次启动是否使用相同签名密钥、Cookie 是否符合 HTTPS/Secure 设置、代理是否正确传递 Cookie。
- **天气取不到**：同源快照和前端坐标需要一致；检查快照更新时间及上游响应，不要把过期缓存当成成功。
- **字体变方块**：确认 `static/pixel/fonts/` 已复制，服务器提供 `.woff2` 字体类型。
- **任务按钮不可用**：生产任务后端未包含，这是明确的接入边界；演示不会执行机器上的任务。
- **小屏动画负担较重**：切换轻柔或静止模式；界面也尊重系统的减弱动态效果设置。

发布自己的衍生版本前，请运行 [隐私检查](../SECURITY.md)，并单独检查截图与图片元数据。
