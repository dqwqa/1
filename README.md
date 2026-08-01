# 洛克王国远行商人无人值守提醒

这是独立于 ChatGPT 网页抓取和 Gmail 审批弹窗的实时监控。

## 工作方式

- GitHub Actions 在北京时间 08:05、12:05、16:05、20:05 自动运行。
- 首选调用洛克万事屋的游客 API，两次独立读取必须一致。
- 同时读取好游快爆原始 HTML；若 HTTP 读取失败或过期，自动使用 Chromium 真浏览器重新加载。
- 对每条商品校验名称、价格和限购数量，并按北京时间核对当前轮次。
- 完整结果写入 `status/latest.json`，历史轮次保留在 `status/`。
- 命中“炫彩蛋”或“祝福项坠”时创建唯一 GitHub Issue，作为无人值守通知和去重记录。
- 读取失败会创建失败 Issue，不会误报“目标商品没有出现”。

## 通知

GitHub Issue 通知不依赖 Gmail 插件。可在 GitHub 的 Notifications 设置中把仓库 Issue 通知发送到需要的邮箱。ChatGPT 定时任务也可以读取 `status/latest.json`，再通过 ChatGPT 账号绑定邮箱发送系统任务通知。

## 手动测试

打开仓库 Actions，选择“洛克王国远行商人监控”，点击 Run workflow。
