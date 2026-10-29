# 工作台补充页面概念图生成记录

本轮按现有设计补齐五张概念图，使用内置 imagegen。参考图为 [局部改稿](concepts/02-local-revision.png)，保留已有应用外壳、配色与排版，分别替换页面内容和导航选中状态。各页均为示例内容，原图保持不变，本轮未修改业务代码。

图片索引见 [工作台功能与概念设计](workbench.md)。以下为实际使用的完整提示词，五张图均采用首次输出。

## 4 作品入口与导入

[最终图片](concepts/04-library-import.png)

```text
Use case: ui-mockup.
Asset type: a high-fidelity concept for another page of the same novel-engine desktop writing application.
Input image 1: edit target for a new page variant. Keep the exact app shell from this image: the dark forest-green left sidebar, brand "novel-engine", book selector "雾港来信", small "示例作品", navigation labels, icon style, warm ivory main background, white panels, ink typography, restrained green buttons and amber status hints. Replace the main page content and active navigation selection with the requested new page. Preserve the input's landscape size and near-16:10 aspect ratio. Keep similar scale, spacing, hairline borders and typography. This must look like another screenshot of the SAME app. No browser frame, device mockup, perspective or surroundings.
Shared navigation, in this order: "章节工作台", "规划", "故事记忆", "局部改稿", "任务记录", "版本与导出"; bottom "模型与设置". Change only the selected navigation item as specified. Do not retain any previous patch-comparison content or its bottom toolbar.
Typography: crisp legible Simplified Chinese, generous line height; clear sans-serif UI with restrained editorial heading treatment. Minimal beautiful line icons. Use accurate Chinese text and punctuation; English technical labels retain their spellings. Prefer fewer readable controls over tiny illegible text.
Colors: ivory #F6F5F1, white reading surface, green #31594D, dark ink #242C2A, amber for attention. Small badge at top right "概念设计 · 示例内容". All data is fictitious. Avoid charts, decorative KPI cards, arbitrary metrics, collaboration avatars, account/login controls, advertisements, gradients, illustrations and chat bubbles. Never imply automatic publishing or automatic manuscript approval.
Primary request: Transform the reference into the "作品入口" page, showing a blank selected local project and a manuscript import preview. No item in the main navigation is selected; highlight the book selector subtly. This is a practical file and book entry page, not a metrics dashboard.
Main header "作品入口"; subtitle "打开作品，或从已有稿件开始。". Top-right actions "打开工作区" outlined and "新建作品" forest-green.
Composition: a medium-width recent-projects panel at left within the content area, a broad manuscript import panel at right. Plenty of whitespace. Global navigation remains on the far left.
Recent-project panel heading "最近打开". Three restrained rows with simple book outline icons:
selected "雾港来信" and "新作品 · 尚无正式稿";
"山海夜航" and "12 章正式稿";
"白塔笔记" and "6 章正式稿".
Quiet footer "仅显示主动打开过的作品。".
Large import panel header "导入稿件", with small badge "当前作品：雾港来信". A compact file-selection box shows upload icon, filename "雾港来信.md", "UTF-8", and an outlined "重新选择" button. Under it a subtle hint "支持 Markdown 和 TXT".
Next heading "拆章预览". Table columns "章节", "标题", "字数"; exactly three rows:
"01" | "雨夜归港" | "2,180"
"02" | "封存的信" | "2,460"
"03" | "旧伤" | "2,250".
Below the table green checkmark and "未发现重复导入". Quiet summary "共 3 章 · 6,890 字".
A restrained note at panel bottom "确认后写入当前作品，保留原始稿件。". Bottom actions: outlined "取消导入", green primary "确认导入 3 章".
Critical invariants: the selected project has NO existing official chapters, the preview contains exactly three rows, and the primary button explicitly confirms import rather than writing immediately on file selection. No cloud upload or automatic filesystem scan. Do not add thumbnail cover art or giant empty-dropzone illustration.
```

## 5 章节规划

[最终图片](concepts/05-chapter-planning.png)

```text
Use case: ui-mockup.
Asset type: a high-fidelity concept for another page of the same novel-engine desktop writing application.
Input image 1: edit target for a new page variant. Keep the exact app shell from this image: the dark forest-green left sidebar, brand "novel-engine", book selector "雾港来信", small "示例作品", navigation labels, icon style, warm ivory main background, white panels, ink typography, restrained green buttons and amber status hints. Replace the main page content and active navigation selection with the requested new page. Preserve the input's landscape size and near-16:10 aspect ratio. Keep similar scale, spacing, hairline borders and typography. This must look like another screenshot of the SAME app. No browser frame, device mockup, perspective or surroundings.
Shared navigation, in this order: "章节工作台", "规划", "故事记忆", "局部改稿", "任务记录", "版本与导出"; bottom "模型与设置". Change only the selected navigation item as specified. Do not retain any previous patch-comparison content or its bottom toolbar.
Typography: crisp legible Simplified Chinese, generous line height; clear sans-serif UI with restrained editorial heading treatment. Minimal beautiful line icons. Use accurate Chinese text and punctuation; English technical labels retain their spellings. Prefer fewer readable controls over tiny illegible text.
Colors: ivory #F6F5F1, white reading surface, green #31594D, dark ink #242C2A, amber for attention. Small badge at top right "概念设计 · 示例内容". All data is fictitious. Avoid charts, decorative KPI cards, arbitrary metrics, collaboration avatars, account/login controls, advertisements, gradients, illustrations and chat bubbles. Never imply automatic publishing or automatic manuscript approval.
Primary request: Transform the reference into the "章节规划" page. Highlight "规划" in the global sidebar.
Main header "章节规划"; subtitle "明确每章目标，批准后进入写作。". Small top controls "本批 3 章" and secondary "重新生成计划".
A shallow full-width brief strip labeled "创作要求" contains "围绕失踪航次展开调查，保持林舟的有限视角，逐步揭开灯塔秘密。".
Below the strip use three balanced columns: narrow chapter-plan list, wide structured editor, narrow author-constraint inspector. Ensure fields remain readable.
Left plan list heading "本批计划". Three chapter cards:
"06 潮汐线索" with "待批准";
selected "07 失踪航次" with "待批准";
"08 灯塔密语" with "待批准".
Small helper "每批支持 1～20 章".
Center editor heading "第 7 章 · 失踪航次", with pale amber "计划待批准". Fields laid out as a clear form:
"章节标题" value "失踪航次";
"本章目标" multiline value "找到缺失的航次记录，让调查从猜测转向可核对的线索。";
two columns for "叙事视角" dropdown "林舟" and "目标字数" value "3,200";
"出场人物" chips "林舟", "沈砚";
"关键事件" three short numbered rows "核对旧航海日志", "发现被划去的日期", "决定前往废弃灯塔";
"本章约束" value "不直接揭示船长的真实身份。".
Use coherent input borders, modest white panels, no excessive nested cards.
Right inspector header "作者约束". Three compact readable items "保持林舟的有限视角", "不提前揭晓顾宁的身世", "章末留下明确行动". Small tag "来自作品约束". Under a fine divider, "使用范围" and note "章节计划是未来安排，不能当作已发生事实。".
Bottom page action bar: left "当前计划已保存 · 等待批准"; right disabled gray "保存计划修改" because there are no unsaved edits, outlined "拒绝本批", forest-green "批准本批 3 章".
Critical invariants: none of these three chapters is approved yet. The primary approval applies to the saved batch, not automatic prose generation. Fields are plans, not established story facts. Do not show auto-saving, success percentage, quality scores, or unsaved edits while approval is enabled.
```

## 6 任务记录与恢复

[最终图片](concepts/06-task-records.png)

```text
Use case: ui-mockup.
Asset type: a high-fidelity concept for another page of the same novel-engine desktop writing application.
Input image 1: edit target for a new page variant. Keep the exact app shell from this image: the dark forest-green left sidebar, brand "novel-engine", book selector "雾港来信", small "示例作品", navigation labels, icon style, warm ivory main background, white panels, ink typography, restrained green buttons and amber status hints. Replace the main page content and active navigation selection with the requested new page. Preserve the input's landscape size and near-16:10 aspect ratio. Keep similar scale, spacing, hairline borders and typography. This must look like another screenshot of the SAME app. No browser frame, device mockup, perspective or surroundings.
Shared navigation, in this order: "章节工作台", "规划", "故事记忆", "局部改稿", "任务记录", "版本与导出"; bottom "模型与设置". Change only the selected navigation item as specified. Do not retain any previous patch-comparison content or its bottom toolbar.
Typography: crisp legible Simplified Chinese, generous line height; clear sans-serif UI with restrained editorial heading treatment. Minimal beautiful line icons. Use accurate Chinese text and punctuation; English technical labels retain their spellings. Prefer fewer readable controls over tiny illegible text.
Colors: ivory #F6F5F1, white reading surface, green #31594D, dark ink #242C2A, amber for attention. Small badge at top right "概念设计 · 示例内容". All data is fictitious. Avoid charts, decorative KPI cards, arbitrary metrics, collaboration avatars, account/login controls, advertisements, gradients, illustrations and chat bubbles. Never imply automatic publishing or automatic manuscript approval.
Primary request: Transform the reference into the "任务记录" page. Highlight "任务记录" in the global sidebar. Show an interrupted writing task with an unknown model request result, and make recovery decisions clear.
Header "任务记录". Filters "全部", "进行中", selected "待处理", "已结束". A concise subtitle "查看进度、已保存结果与下一步。".
Composition: task list at left, about 43% of main content; wide task details at right. No dashboard charts or percentage progress bars.
Task list has a search field "搜索章节或任务". Under the selected "待处理" filter show EXACTLY TWO rows, not completed tasks:
selected "第 4 章 · 生成并审稿", amber "运行中断", secondary line "审稿请求结果未知";
"第 6～8 章 · 章节规划", amber "等待批准", secondary line "计划已保存".
Detail header "第 4 章 · 生成并审稿". At top a pale amber alert, title "请求结果未知", body "服务连接中断，可能已产生用量。不会自动重试。".
Then a two-column area: left actual-step timeline with "生成候选" green check and "已保存", "审稿" amber question icon and "结果未知", "提取信息" gray circle and "未开始", "作者批准" gray circle and "未开始"; right simple compact budget rows:
"已发请求" "2 / 8";
"预算占用" "12,800 / 64,000";
small note "包含未知请求的预留";
"估算费用" "未知".
Below show a modest saved-result row with document icon "候选稿已保存", link "查看候选稿".
A recovery section title "继续这项任务". Explain "已保存步骤可以复用，重试仍受原任务预算限制。". An UNCHECKED checkbox labeled "我理解重试可能产生额外用量". Below it a DISABLED gray primary "重试未知请求". Nearby separate outlined button "取消任务".
At the bottom a tertiary action "只读重放" and helper "仅核对已保存记录，不请求模型。".
Critical invariants: unknown request status is not success or zero cost. Do not add an enabled automatic retry or generic resume button bypassing the checkbox. The retry action must clearly be disabled until acknowledged. Do not invent progress percentages. The task list contains only the two matching pending/interrupted tasks. Preserve readable medium-sized Chinese.
```

## 7 版本与导出

[最终图片](concepts/07-versions-export.png)

```text
Use case: ui-mockup.
Asset type: a high-fidelity concept for another page of the same novel-engine desktop writing application.
Input image 1: edit target for a new page variant. Keep the exact app shell from this image: the dark forest-green left sidebar, brand "novel-engine", book selector "雾港来信", small "示例作品", navigation labels, icon style, warm ivory main background, white panels, ink typography, restrained green buttons and amber status hints. Replace the main page content and active navigation selection with the requested new page. Preserve the input's landscape size and near-16:10 aspect ratio. Keep similar scale, spacing, hairline borders and typography. This must look like another screenshot of the SAME app. No browser frame, device mockup, perspective or surroundings.
Shared navigation, in this order: "章节工作台", "规划", "故事记忆", "局部改稿", "任务记录", "版本与导出"; bottom "模型与设置". Change only the selected navigation item as specified. Do not retain any previous patch-comparison content or its bottom toolbar.
Typography: crisp legible Simplified Chinese, generous line height; clear sans-serif UI with restrained editorial heading treatment. Minimal beautiful line icons. Use accurate Chinese text and punctuation; English technical labels retain their spellings. Prefer fewer readable controls over tiny illegible text.
Colors: ivory #F6F5F1, white reading surface, green #31594D, dark ink #242C2A, amber for attention. Small badge at top right "概念设计 · 示例内容". All data is fictitious. Avoid charts, decorative KPI cards, arbitrary metrics, collaboration avatars, account/login controls, advertisements, gradients, illustrations and chat bubbles. Never imply automatic publishing or automatic manuscript approval.
Primary request: Transform the reference into the "版本与导出" page. Highlight "版本与导出" in the global sidebar.
Header "版本与导出"; subtitle "查看历史正式稿，选择版本导出。". Top small status "当前正式版本 12".
Composition: a history list column about 235 px; a broad manuscript preview column; an export settings column about 290 px within the main area. This is a history browser, not a text editing screen.
History panel title "作品版本". Four rows:
"版本 12" with green "当前版本" and secondary "第 4 章正文更新";
"版本 11" and "第 3 章正文更新";
selected "版本 10" with muted green background and secondary "新增第 4 章正式稿";
"版本 9" and "第 3 章正文更新".
Center top has amber-neutral label "历史快照 · 作品版本 10 · 只读". A chapter dropdown "第 4 章 · 灯下的名单". Manuscript white reading surface with large serif heading "第四章  灯下的名单", and these two readable Chinese paragraphs:
"雨停以后，码头只剩下缆绳轻碰船舷的声音。林舟推开旧屋的门，把那封没有署名的信放在灯下。"
"最后一个名字被墨水洇开。他停住笔，望向窗外那盏忽明忽暗的航灯。"
Do not show an editable cursor. Bottom of preview an outlined button "预览恢复此章" and helper "恢复会创建新版本，历史记录仍保留。".
Right panel header "导出设置". A selected-version summary "作品版本 10". A format section "文件格式" with selected radio "Markdown (.md)" and unselected "TXT (.txt)". Range summary "整部作品 · 4 章正式稿". Filename input "雾港来信-v10.md". A soft info note "只包含选中版本的正式稿。".
Forest-green primary "导出版本 10". Under a divider, a compact checklist with green checks "章节顺序固定", "正文与历史版本一致".
Critical invariants: version 10 is being previewed/exported while current official version is 12. The UI must never confuse those two. Export includes only official chapters, no candidate checkbox. Restoring is a preview action that creates a new version later, not a destructive rollback or whole-book reset. No cloud publishing or share controls.
```

## 8 模型与设置

[最终图片](concepts/08-model-settings.png)

```text
Use case: ui-mockup.
Asset type: a high-fidelity concept for another page of the same novel-engine desktop writing application.
Input image 1: edit target for a new page variant. Keep the exact app shell from this image: the dark forest-green left sidebar, brand "novel-engine", book selector "雾港来信", small "示例作品", navigation labels, icon style, warm ivory main background, white panels, ink typography, restrained green buttons and amber status hints. Replace the main page content and active navigation selection with the requested new page. Preserve the input's landscape size and near-16:10 aspect ratio. Keep similar scale, spacing, hairline borders and typography. This must look like another screenshot of the SAME app. No browser frame, device mockup, perspective or surroundings.
Shared navigation, in this order: "章节工作台", "规划", "故事记忆", "局部改稿", "任务记录", "版本与导出"; bottom "模型与设置". Change only the selected navigation item as specified. Do not retain any previous patch-comparison content or its bottom toolbar.
Typography: crisp legible Simplified Chinese, generous line height; clear sans-serif UI with restrained editorial heading treatment. Minimal beautiful line icons. Use accurate Chinese text and punctuation; English technical labels retain their spellings. Prefer fewer readable controls over tiny illegible text.
Colors: ivory #F6F5F1, white reading surface, green #31594D, dark ink #242C2A, amber for attention. Small badge at top right "概念设计 · 示例内容". All data is fictitious. Avoid charts, decorative KPI cards, arbitrary metrics, collaboration avatars, account/login controls, advertisements, gradients, illustrations and chat bubbles. Never imply automatic publishing or automatic manuscript approval.
Primary request: Transform the reference into the "模型与设置" page. Highlight the bottom navigation item "模型与设置"; all other main sidebar items neutral.
Header "模型与设置"; subtitle "检查本地配置，为下一次任务设置预算。". Small badge "演示配置".
Composition: wide left stack for model configuration and request budget; narrower right stack for offline checks and model probe. Spacious clean settings, legible values, no raw JSON.
Top-left section "当前模型" with an unobtrusive "只读" badge. Simple label/value rows, visually read-only rather than editable:
"接口类型" → "OpenAI 兼容";
"模型名称" → "novel-model";
"服务地址" → "https://api.example.com/v1";
"配置来源" → "novel.config.json";
"凭据变量" → "NOVEL_API_KEY" with amber "未配置".
Quiet helper "密钥仅在本机配置，页面不显示密钥内容。". No secret input, no masked asterisks pretending an actual key exists, no save-config button.
Lower-left section "下一次任务预算". Two editable numeric fields side by side: "请求次数上限" value "8", "token 总预算" value "64,000". Quiet helper "在发起下一次任务时应用。". Below a pale neutral cost information row "价格未提供 · 费用将显示未知". This is a task parameter panel, not billing.
Top-right section "离线检查". Green status rows "Node.js 24.22.1" → "版本符合要求" and "配置格式" → "通过". Green outlined or filled button "重新检查配置". Small accurate helper "仅检查本地环境与配置。".
Lower-right section "模型连通". Amber badge "未探测". Text "探测将调用模型服务。". Budget line "最多 1 次请求 · 4,096 token". Disabled gray button "探测模型". Under the button amber helper "请先在本机配置 NOVEL_API_KEY。".
Critical invariants: offline configuration checks pass but model credentials are absent and the real model has not been probed. Therefore the model-probe button is disabled. No actual model success badge, no zero-dollar estimate, no online/offline switch pretending to change provider configuration. All endpoint and model names are illustrative. Do not show unsupported advanced model tuning controls or cloud-account settings.
```
