# 后端、采集器与运维模板

开源包提供独立的标准库鉴权/生活 API、只读硬件采集器、天气快照、聚合访问统计与文件式变更日志。它不是某个家庭服务器的完整镜像，也不包含 AI 调度、任务调度、模型部署、服务管理或远程终端后端。前端保留的相关入口不代表后端已经接入。

## 1. 安全初始化：没有默认密码

需要 Python 3.10+。在仓库之外、静态站目录之外初始化：

```sh
python3 gatekeeper/init-users.py --data /srv/homepage/private
```

交互式输入并确认两个至少 12 字符的口令；`yeti`/`yuki` 是前端契约标识，分别对应 `admin`/`user`，不是个人姓名。脚本只在本地生成 PBKDF2 哈希与随机签名 key，不打印口令或 key；目录要求 `0700`，`users.json` 与 `gatekeeper.env` 均为 `0600`，存在文件时拒绝覆盖，不接受不安全的 getpass 回退。不要上传这些文件。`config/users.example.json` 的字段只是结构示例，刻意不可用于登录。

```sh
set -a
. /srv/homepage/private/gatekeeper.env
set +a
python3 gatekeeper/gatekeeper.py
```

- `GK_DATA`：私有 JSON 目录，必须与 `/srv/homepage/www` 分开。
- `GK_SECRET`：必须显式设置；缺失、短于 32 字符、明显占位或重复字符 key 在**导入时**拒绝。使用初始化器生成的随机值，不要手写教程口令。
- `GK_BIND`/`GK_PORT`：默认 `127.0.0.1:8190`；不要直接暴露到外网。容器可显式调整 bind，但宿主端口仍应限制在回环/代理网络。
- `GK_COOKIE_SECURE`：默认 `1`，cookie 带 `Secure; HttpOnly; SameSite=Lax`。仅在明确的本地 HTTP 演示中才设为 `0`，上线必须使用 HTTPS。

`load_users()` 对缺文件、空文件、非法 JSON、空/错误结构、非法哈希或错误身份角色一律抛错，**不会创建、修复或填充用户表**。启动前检查失败会停止服务；运行期间配置失效时登录返回 `503`，已有 token 也失效。签名 token 还要校验当前用户与角色；过期或篡改 token 不通过。回跳只允许本站安全路径；家人用户不能借回跳进入管理员页面。

`home_features.py` 保留独立的随手记、家庭纪念日、公开随手记和私人草稿功能。公开随手记必须由用户显式设置为 public；登录本身不把私人记录公开。可选地将 `profiles.example.json`、`anniversaries.example.json` 分别复制为私有目录中的 `profiles.json`、`anniversaries.json`，`home-journal.example.json` 的实际目标名是 `home-journal-v14.json`。示例均为虚构/空内容，不含任何生产数据。

## 2. 最小 Caddy 边界

```sh
caddy validate --config caddy/Caddyfile.example --adapter caddyfile
HOME_WEB_ROOT=/srv/homepage/www caddy run --config caddy/Caddyfile.example --adapter caddyfile
```

模板默认 `https://localhost:8443`，使用内部 CA，且不自动安装根证书/不监听额外的 HTTP 重定向端口。浏览器需要自行信任本地 CA。公网部署要配置自己的域名与可信 TLS，替换 `tls internal`；不要关闭客户端证书校验。可通过 `HOME_ADDRESS`、`HOME_WEB_ROOT`、`GK_UPSTREAM` 显式指定地址与路径。Caddy 2.6+ 支持模板使用的传统 snippet 参数语法。

| 路径 | 默认行为 |
| --- | --- |
| `/`、`/index.html`、`/blog/*`、`/static/*`、`/demo-unavailable/*` | 公开静态资源 |
| `/login`、`/logout`、`/whoami` | 代理到 gatekeeper |
| `/yeti`、`/yeti/*` | 必须管理员 |
| `/yuki`、`/yuki/*` | 家人用户或管理员 |
| `/data/status.json`、`/data/live.json` | 任意有效登录用户；禁止缓存 |
| 其他 `/data` 路径，包括 `/data/users.json` | 一律 `404`，管理员也不能读取 |
| `/api/profile`、`/api/anniv`、`/api/notes`、`/api/blog-drafts`、`/api/holidays`、`/api/status` | 交由生活 API 自身检查身份和所有权；公开随手记是显式例外 |
| 未接入的 `/api/*`、`/cron-api/*`、`/ai-api/*` 等 | 明确 `501`，没有暗中转发 |
| `/service-api/*` | 先管理员鉴权，再 `503`；只能由部署者审计后接自己的服务 |
| 其他路径 | `404`，没有兜底静态目录遍历 |

不要扩大 `/data/*` 的静态白名单，也不要把用户表、失败记录、统计状态或原始日志放进静态目录。模板没有 cron API key、固定服务列表、个人主机路由、远程终端或额外公网监听器。服务 API 示例启用后仍应保留鉴权和后端自身的授权；登录 cookie 不能替代后端租户隔离。

## 3. 采集器

需要 Linux、Node.js 18+、bash、util-linux 的 `flock`/`timeout`、基础 procps/coreutils；`sensors` 和 `nvidia-smi` 可选。所有采集都只读本机指标，只向 `HOMEPAGE_ROOT` 写结果。部署者需预先创建 `/srv/homepage` 并让 Caddy 的运行账户能够遍历它、读取 `www`；私有目录和 raw 仍保持 `0700`。脚本将发布目录 `www/data` 设为 `0755`，发布文件为 `0644`，由 Caddy 的登录白名单而非 Unix 隐藏位控制网络访问：

```sh
HOMEPAGE_ROOT=/srv/homepage bash collector/collector.sh
HOMEPAGE_ROOT=/srv/homepage bash collector/live-collector.sh
```

- `collector.sh` → `www/data/status.json`；默认无网络服务清单、无挂载清单、无 VM/磁盘序列号采集。原始临时输入留在非静态的 `raw/`（`0700`）。
- `COLLECTOR_SERVICES_FILE`/`COLLECTOR_MOUNTS_FILE`：可显式选择仓库外配置文件；结构见 `config/collector-*.example.txt`。不执行配置，不使用固定私人端点；HTTP 请求有超时，HTTPS 校验不会被关闭。服务条目不要附带口令/密钥。服务状态 `up` 表示收到 HTTP 响应，不等于业务健康。
- `live-collector.sh` → `www/data/live.json`，每分钟工作约 50 秒，以 10 秒间隔采样，单独非阻塞锁；外部 cron 每分钟启动一次即可。采集失败保留可取得的字段，用 `errors` 标记缺失，不伪造数据。
- live GPU 包括 `mem_free`（区别于 total-used 中驱动保留内存）及保守的 `sampleStartedAtMs`；采样是可视化观测，不是授权释放显存或控制设备的依据。
- 采集器不读取进程命令行；运行时 GPU 标识、进程名、容量等仍属本机敏感指标，只能通过鉴权后的快照访问，不要把真实采集结果提交仓库。

## 4. 可选文件式运维工具

这些工具互相独立，不需要 AI/cron 栈，不自动安装系统定时任务。

### 天气快照

```sh
HOMEPAGE_ROOT=/srv/homepage WEATHER_LOCATION=云栖 WEATHER_LAT=31.23 WEATHER_LON=121.47 node ops/weather-snapshot.js
```

使用 Open-Meteo（需外网），写 `www/static/weather/home.json` 与非公开 `data/weather-health.json`。默认坐标为示例坐标。成功校验观测时效后才替换快照；失败返回 `1`、保留旧快照并更新失败计数。前端若使用同源兜底，应请求 `/static/weather/home.json`，城市名/坐标应与浏览器天气配置一致。

### 访问统计

```sh
node ops/site-stats.js --log /srv/homepage/private/access.jsonl --state /srv/homepage/private/stats-state.json --output /srv/homepage/www/static/site-stats-v1.json --fails /srv/homepage/private/fails.json --www /srv/homepage/www
```

需部署者自行提供 Caddy JSON 访问日志；最小模板**不默认记录访问日志**。原始日志可能含 IP/cookie/查询参数，必须在私有目录中受限存储并设置保留策略。工具只把聚合计数写到公开 output；私有状态包含随机 HMAC key、短期访客日哈希和读取游标（`0600`）。哈希并非匿名化保证，仍需按个人数据管理。失败记录不可读时 blocked 数为 null/unavailable，不编造为 0。统计不是安全风控系统。不要把原始日志、私有 state 或实际统计结果提交仓库。

### 变更日志

```sh
node ops/change-log.js --root /srv/homepage append config/change-log-entry.example.json
node ops/change-log.js --root /srv/homepage validate
node ops/change-log.js --root /srv/homepage build
```

`config/change-log-entry.example.json` 仅为虚构示例。规范数据写入私有的 `data/server-changes.json`（`0600`），渲染到 `www/yeti/server/log/`，由管理员页面鉴权保护。工具有锁、原子替换、revision 和重复 ID 检查，没有网络监听或远程写 API。**渲染会包含输入的 evidence/summary 等原文**，请在录入前主动排除秘密、真实地址和个人信息；不要把生产日志、证据文件或生成页面用于公开演示。

## 5. 本地验证

```sh
python3 -m unittest discover -s tests -p test_gatekeeper.py -v
node ops/test-ops.cjs
python3 caddy/test-security.py     # 需要 caddy，或设置 CADDY_BIN
node --check collector/build.js
node --check collector/build-live.js
bash -n collector/collector.sh collector/live-collector.sh
```

测试使用随机临时账号、合成输入与隔离目录；不依赖生产环境。ops 测试会读取执行机器本地硬件指标，但仅写临时目录并清理，不打印快照。Caddy 测试启动临时高端口 HTTPS 与 gatekeeper，校验静态页、角色门禁、快照白名单、用户表拒绝访问及 501/503 边界；仅测试内部 CA 时使用未验证的 TLS 上下文，不影响模板的上游证书校验。

本次实测：6 个 Python unittest 通过；ops 采集/天气/统计/日志集成检查通过；隔离运行 Caddy 2.6.2 的 18 条安全路由检查通过，模板 validate 通过。所有后端 JS/CJS 与 shell 已进行语法检查。没有向生产写入、没有提交或推送。
