# Laya Mail Triage — Thunderbird extension

用本地 Laya 决策服务器给新到的邮件**自动分类打标**（像 Outlook/Gmail 的类别），并单独判垃圾。

## 组成
- `manifest.json` — MV3；权限 messagesRead/messagesUpdate/messagesMove/messagesTags/messagesTagsList/accountsRead/storage/notifications；host `http://127.0.0.1/*`
- `background.js` — 监听 `messages.onNewMailReceived`（monitorAllFolders），读正文 → 调 Laya → 打标签 / 标 junk
- `popup.html` / `popup.js` — 设置 + Test + 扫描 + 日志

## 安装
已 sideload 到：`~/snap/thunderbird/common/.thunderbird/gn6owyjq.default/extensions/laya-triage@invince.local.xpi`

1. 重启 Thunderbird
2. `Add-ons and Themes` → 启用 **Laya Mail Triage**
3. 点工具栏 Laya 图标 → 填 Server URL + API key → **Save** → **Test connection**

未签名时用 about:debugging → This Thunderbird → Load Temporary Add-on → 选 `manifest.json`（改一次 Reload 一次，迭代快）。

## 配置（popup）
| 项 | 默认 | 说明 |
|---|---|---|
| Server URL | `http://127.0.0.1:8010` | |
| API key | `cat ~/.config/laya/api_key` | |
| **Categories** | `personal, work, shopping, ads` | **逗号分隔，可自定义**（随便加 `finance, travel, news...`）|
| **Spam tag name** | `Spam` | 第二轮打的垃圾标签名 |
| **Processed tag** | `LayaDone` | 打给**已处理**邮件的标记；扫描时自动跳过带此标签的邮件 |
| Spam threshold | **0.85** | P(spam) ≥ 此值 → 标垃圾 |
| Round 1: auto-tag category | ✅ | 第一轮：打分类标签 |
| Round 2: flag spam (tag + junk) | ✅ | 第二轮：打 Spam 标签 + 标 junk |
| Dry run | ✅（安全默认）| 只判断不改动；确认满意再关 |

## 两轮打标（关键设计）
- **第一轮 = 分类**：从 Categories 里选**恰好一个** → 打该标签
- **第二轮 = 垃圾**：独立判 spam → 打 Spam 标签（+ junk）
- 两轮独立 → **一封邮件可以同时是 `ads` 和 `Spam`**（例：促销邮件）

标签解析：**优先复用 TB 里同名的现有标签**（如内置 `Work`/`Personal`），没有就按你输入的字符新建。一封邮件的 Laya 管理的标签会被替换，但**不动你自己的其他标签**。

## 处理顺序 & 已处理标记
- **Scan 取最新 N 封**：`messages.list(folder, {sortType:"date", sortOrder:"descending"})` → 最新优先（不是最旧）
- **Processed tag**（默认 `LayaDone`）：每次处理完（live 模式）会给邮件打上这个标记
- **live 模式下 Scan 自动跳过已带标记的邮件** → 重复点 Scan 不会重复处理，一次推进一批
- **Dry run 模式**：不打标记、不跳过（方便随便预览）

> Scan 的语义：**dry-run 开 = 只预览不改**；**dry-run 关 = 真处理最新 N 封并打标记**

## 实测（zero-shot，阈值 0.85）
| 邮件 | 结果 |
|---|---|
| 物流更新 | `shopping` ✅ |
| 促销 MEGA SALE | `ads` + `Spam` ✅ |
| newsletter | `ads` ✅ |
| 工作邮件 | `work` ✅ |
| 个人邮件 | `personal` ✅ |
| 诈骗 | `Spam` ✅ |
| 彩票诈骗 | `Spam` ✅ |

**垃圾判定 7/7，分类 5/5**（有明确定义的类别）。之前 5 合 1 分类时"广告被吞进垃圾"的问题，靠**两轮拆分**解决了。

## 怎么判断是 TB 标的还是插件标的
1. **服务端日志（最铁）**：`sudo journalctl -u laya-serve | grep systemone` — TB 自身过滤器**从不**调 Laya
2. **分类标签**：TB 原生不会打 `shopping`/`ads` 这类标签
3. **popup 日志**：`mode=dry-run` 表示只判断未执行；`action` 显示实际动作

## 精度与学习
- zero-shot 已可用，但**广告 vs 垃圾**这类边界仍靠阈值+两轮拆分兜住，非完美
- 要生产级精度 → **在自己的标注邮件上微调**（base 0.362 → 0.766）
- 插件日志（`storage.local`，最近 200 条）就是**现成的标注来源**

## 已知限制
- `onNewMailReceived` 只对新到邮件触发（TB 运行期间）；历史邮件用手动 Scan
- CPU 模式 ~0.5s/封（GPU 空闲可到 ~35ms）
- Laya 该 checkpoint 的置信度**未经校准**（官方警告），阈值需按自己数据微调

## ⚠️ 坑：host_permissions 不能带端口号
Firefox/Thunderbird match pattern **不支持端口**（bug 1362809）。`http://127.0.0.1:8010/*` 是无效模式 → 权限不授予 → fetch 报 `NetworkError`。**正确**：`http://127.0.0.1/*`。
