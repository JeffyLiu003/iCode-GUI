# TrajViz 与本地 OpenCode / iCode 监控接入分析

核查日期：2026-10-30。核查提交：`7c0ce0f044d413111f5e38bef55ea820acdc39c4`。

## 结论

可复用 TrajViz 作为轨迹归一化与历史分析引擎，并在 iCode-GUI 中增加独立的监控页面。不能只启动 TrajViz 就认为具备跨工具实时监控：源数据采集、变化监听、持久化、告警及业务验收判断仍需额外实现。

本次仅检查数据结构，并验证 OpenCode 采集函数；没有安装或启动 TrajViz 完整服务，没有配置外部模型、上传对话或修改原始数据库。

## 本地事实及验证范围

| 来源 | 数据位置 | 当前观察 |
|---|---|---|
| OpenCode | `~/.local/share/opencode/opencode.db` | 24 条 session_v2；1127 条 session_message；当前 parent_id 非空记录为 0 |
| iCode | `~/.chrys/sessions/*/session.json` | 9 个会话快照，meta.app_version 均为 0.31.0 |
| iCode 轨迹 | `~/.chrys/sessions/*/trajectory/events.jsonl` | 15 个轨迹日志文件，数量不同于会话快照，不能直接混为会话总量 |

OpenCode 当前数据结构为 session_v2 / session_message，不是早期的 session / message / part。TrajViz 固定提交已提供 collect/opencode_v2.py，主采集器也有表结构分流。将原版 v2 采集函数与只读 SQLite 连接组合后，本地 24 个会话、1127 条记录采集成功；未保存原文导出文件。使用 Python 3.14 验证；本机系统 Python 3.9 低于其 Python 3.11+ 要求。

本地 session_message 中包含 assistant、user、system、idle、compaction、synthetic、model-switched。assistant.content 内有 reasoning、text、tool。样本有 input/output/reasoning/cache token 字段；工具项有独立 time 与 state。不能把每条 assistant 记录当作一次用户任务。

OpenCode 的 event 表本次读取为 0 条，因此不能把该表假设成现成的实时事件流。

## 仓库能力及兼容边界

源码把“采集 → 格式转换 → 公共轨迹模型 → 分析视图 → 展示”分开。应复用公开的 Python API 和视图 JSON Schema，避免直接依赖内部 insight 子包。

OpenCode v2 采集器按 seq 读取 session_message，补齐 type/id/sessionID，按 parent_id 遍历子会话，并生成 opencode_v2 格式标识。当前本地样本无 DB 子会话，不代表所有任务均无委派行为；未来还应检查工具结果中的关联标识。

iCode 解析器主要读取 meta、state.messages、扩展导出标记和嵌套子会话。它读取消息上的 _chrys_timing 等工具时钟，但没有直接消费 events.jsonl 的逻辑。因此“会话可解析”不等于“完整运行监控字段已经接入”。

此前 iCode-GUI 的导出封装为 `icode-gui-session/v1`，不是 Chrys expanded-session 格式。不能直接把 GUI 的 JSON 导出当作 TrajViz 原生输入。应另行提供原生会话导出或公开插件适配。

TrajViz 提供轨迹分析视图及展示方式；本次没有实测完整视图输出、全部 iCode 会话转换、完整子 Agent 家族、特定 PyPI 发行版兼容性或跨平台运行。应以固定提交作为接入验证基线，避免将 main 源码中的新适配误认为所有发行版都已包含。

## 建议接入架构

```text
OpenCode SQLite（只读事务/快照） ── 原版 v2 collector ──┐
                                                   ├─ 标准轨迹 ─ TrajViz 历史分析
Chrys 原生/expanded session JSON ─ 会话与子会话适配 ───┘

iCode events.jsonl ─ 增量事件采集 ─ 标准事件/指标库 ─ 实时状态与告警
OpenCode session_message ─ 增量采集 ────────────────┘

                         iCode-GUI 监控页面
              总览 / 会话明细 / 运行时间线 / 对比 / 告警
```

采集与分析进程建议使用独立 Python 3.11+ 环境。Electron 主进程管理其生命周期，后台服务只监听 127.0.0.1，通过受限 IPC 或带会话令牌的本地接口提供查询。React 使用公共视图数据绘制图表；也可先用本地 TrajViz 页面验证历史分析，之后再集成原生界面。

不建议在每次流式输出时重新加载整段完整轨迹。采集层维护增量事件，任务结束或定期生成稳定快照，再运行 TrajViz。查看超长轨迹时按会话和时间段分页。

## 如何监控

### OpenCode

- 先用现有 collector 完成历史采集，不需要重写 v2 读取器。
- 持续采集 session_v2 与 session_message；对发生变化的会话按 seq 回读并以消息 ID upsert。单靠最大 seq 会漏掉同一条工具记录从 running 到 completed 的更新，要结合 time_updated 并采用重叠回读与周期校对。
- 使用只读 SQLite 事务或 backup API 获得一致快照，不要单独复制正在写入的 db 文件而丢掉 WAL。
- 不读取 credential/account 等表；字段挑选只覆盖会话、消息、模型及工具。
- 对重复消息更新做幂等处理；保留 compaction、retry、idle 等生命周期证据，避免把它们当作新的用户请求。

### iCode

当前日志中已观察到：

- model.exchange.finished：usage、duration_ms、ttfc_ms、ttfv_ms、stall_count、请求尝试和模型标识等。
- tool.operation.finished：outcome、duration_ms、exit_code 等。
- approval.resolved：decision、decider、wait_ms 等。
- turn.finished：turn_id、duration_ms、end_reason。
- sub_agent.started / finished：子 Agent 生命周期。

因此能区分“模型慢”“工具慢”“等待人工审批”，而不是仅看整轮总耗时。

用文件偏移量增量读取 JSONL，保留未完成的尾行；按 session_id + event_id 去重，并处理日志截断、重建和 runtime 切换。结合 sequence / operation_id / parent_operation_id 关联开始结束事件。未观察到结束时标为运行中或状态未知，不填造完成时间。日志目录与会话快照数量不同，采集时必须保留来源和覆盖范围。

## 优先展示的指标

| 页面 | 指标及用途 |
|---|---|
| 总览 | 最近活跃会话、运行/等待/异常状态、工具错误、采集延迟 |
| 模型 | 请求尝试数、已观测 token 分类、缓存使用、iCode TTFC、模型耗时分位数 |
| 工具 | 调用量、失败率、耗时分布、重复调用及退出码 |
| 审批 | 人工/自动决策、审批等待时长、拒绝次数 |
| 会话 | 回合、模型/Agent 切换、子 Agent、上下文压缩及文件变更 |
| 对比 | 相同任务不同配置的耗时、用量、工具错误和验收结果 |
| 数据质量 | 缺失时钟/usage、未闭合操作、重复记录、采集覆盖区间 |

告警起步使用可配置规则：长时间无新进展、短时间连续工具错误、长时间待审批、用量预算和采集异常。首次阈值应在试运行后按自己的任务基线调节，不能把某个固定秒数作为普遍故障界限。人工等待不应算模型卡死；后台任务未结束也不应直接判为用户回合失败。

## 数据口径与风险

1. 不把不同 Agent 的 token.total 直接当作统一计费量。保留原始 input/output/reasoning/cache 字段及生产方语义，再定义对比口径；累计会话计数与逐请求 usage 不可相加。
2. 源 cost 为 0 不一定代表免费或无消耗。没有可靠价格和计费字段时显示“费用未知”；估算需标价表版本与币种。
3. tool 返回成功、turn 正常结束都不等于需求完成。业务成功率需要关联测试结果、验收标准或人工结论。
4. TrajViz 的更强失败归因依赖额外证据与可选能力；不能把模型解释当成确定因果。跨模型对比也需保证任务、代码基线和验收条件相当。
5. 原始轨迹可能含代码、命令输出和敏感字段。默认本地分析；外部 LLM 分析独立开关、脱敏，并明确数据接收方。报告共享与本机查看应使用不同的数据导出策略。
6. iCode-GUI 的进程仅能观察自身连接到的事件，无法覆盖用户另开 CLI 的所有历史；全机监控需要原生存储采集补全。

## 实施顺序

1. 历史验证：固定 TrajViz 提交，挑选 OpenCode 和 iCode 各一份可审阅样本，核验归一化、usage、工具时钟和子会话完整性。
2. 先做历史分析入口与数据质量面板，复用已有 collector 和公开视图。
3. 增加 iCode 事件增量读取与 OpenCode 消息变更采集，建立幂等标准事件库。
4. 增加实时状态和告警，再引入有明确验收证据的跨任务/跨模型比较。

不建议第一步就开发完整的双工具实时观测平台，也不建议先重写 TrajViz 已有的 OpenCode v2 适配。

## 依据

- [固定提交 README](https://github.com/rshu/TrajViz/blob/7c0ce0f044d413111f5e38bef55ea820acdc39c4/README.md)
- [OpenCode 主采集器](https://github.com/rshu/TrajViz/blob/7c0ce0f044d413111f5e38bef55ea820acdc39c4/agent_trajviz/collect/opencode.py)
- [OpenCode v2 采集器](https://github.com/rshu/TrajViz/blob/7c0ce0f044d413111f5e38bef55ea820acdc39c4/agent_trajviz/collect/opencode_v2.py)
- [OpenCode v2 格式转换](https://github.com/rshu/TrajViz/blob/7c0ce0f044d413111f5e38bef55ea820acdc39c4/agent_trajviz/insight/formats/opencode_v2.py)
- [iCode 格式转换](https://github.com/rshu/TrajViz/blob/7c0ce0f044d413111f5e38bef55ea820acdc39c4/agent_trajviz/insight/formats/icode.py)
- 本地源数据：以只读方式查看表结构、记录数量和事件字段；未读取账号或凭证表。
