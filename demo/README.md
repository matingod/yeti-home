# 本地演示

```bash
python3 demo/demo-server.py
# 或：PORT=9000 python3 demo/demo-server.py
```

默认访问 `http://127.0.0.1:8990`。两个演示身份 `yeti` / `yuki` 的口令均为 `demo`，显示名为虚构的阿暖 / 阿安。

- 只监听回环地址，不可作为公网生产服务。
- 复用仓库内的登录页与签名函数，签名密钥在启动时随机生成；不读取生产用户表或 Cookie。
- 天气、硬件、日志、统计与定时任务都是明确标记的虚构数据，不连接家庭设备或实际服务。
- 随手记可在内存里新建、修改、删除，重启后恢复示例数据；不保存私人资料到仓库。
- 未接入的 AI 调度、任务控制与第三方服务返回明确提示，不假装执行成功。
- 真实部署请看 [部署笔记](../docs/deploy-notes.md)，不要沿用演示口令。

## 验证

```bash
python3 -m unittest discover -s tests -v
python3 tools/privacy_audit.py .
```

图片演示与程序功能的测试边界见 [更新记录](../CHANGELOG.md) 和 [安全说明](../SECURITY.md)。
