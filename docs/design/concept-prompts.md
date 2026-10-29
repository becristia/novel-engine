# 工作台概念图生成记录

使用内置 imagegen，类型为 `ui-mockup`。内容来自当前项目的功能设计，不使用真实稿件、凭据或个人数据。最终图片保存在同目录的 `concepts/`，设计规则见 [工作台功能与概念设计](workbench.md)。

以下保存实际使用的完整提示词。第一张和第三张各进行一次针对状态含义的编辑；第二张采用首次输出。初稿和中间结果保留在工具默认目录，不是项目依赖。

## 1 章节工作台

```text
Use case: ui-mockup.
Asset type: A high fidelity desktop application UI concept for the existing novel-engine single-author fiction writing tool. This is a product screen, not a marketing page. Create one crisp, flat, front-on 16:10 landscape screen, ideally 2560 x 1600. No monitor, laptop, perspective, browser chrome, drop-shadow presentation frame, or photographic surroundings.
Design system: an editorial writing application with warm ivory canvas #F6F5F1, white reading surfaces, deep forest green accents #31594D, dark ink text #242C2A, light gray hairline dividers, restrained amber and red for semantic statuses. Quiet, precise and sophisticated, excellent spacing. A compact charcoal-green left navigation sidebar about 210 px of a 1600 px-wide composition; subtle line icons, small rounded rectangles, 8 px rhythm, generous readable document area. Avoid dashboard KPI cards, gradients, glossy effects, neon colors, large illustrations, and chat bubbles. Interface typography is clean modern Simplified Chinese sans-serif; novel prose uses an elegant readable Chinese serif. Chinese labels and punctuation must be accurate. Make text large enough to read. Do not add arbitrary tiny text.
Shared app chrome: brand "novel-engine" top left, book switcher "雾港来信" below it, small "示例作品". Vertical navigation exactly "章节工作台", "规划", "故事记忆", "局部改稿", "任务记录", "版本与导出". Bottom left "模型与设置". Small unobtrusive label in upper right "概念设计 · 示例内容".
This app separates candidate manuscripts from official text. Never show a direct publish button, invented quality score, collaboration avatars, agent chat room, or auto-approve. All data is fictitious concept content.
Primary request: Screen 01, the main chapter writing and evidence review workspace. Choose "章节工作台" in the navigation.
Composition: left sidebar with the common navigation, then below the navigation a compact chapter list; a dominant center manuscript taking about 58% of remaining width; a right evidence inspector taking about 30%. This is a comfortable editorial reading workspace with a single highlighted issue.
Chapter list: header "章节"; rows "01 雨夜归港" with "正式稿", "02 封存的信" with "正式稿", "03 旧伤" with "正式稿", highlighted "04 灯下的名单" with amber "待修订", "05 潮声" with "待生成".
Top content toolbar: breadcrumb "雾港来信 / 第 4 章"; title "灯下的名单"; outlined button "查看历史"; small export icon with text "导出". Under title show segmented tabs "正式稿" and active "候选稿", prominent amber badge "候选稿 · 未批准".
Center reading pane: large chapter heading "第四章  灯下的名单". Use generous margins, 4 short readable Chinese paragraphs with this actual narrative, not filler glyphs:
"雨停以后，码头只剩下缆绳轻碰船舷的声音。林舟推开旧屋的门，把那封没有署名的信放在灯下。"
"沈砚没有跟进来。他站在门外，听见屋里传来纸页翻动的轻响。"
"当天傍晚，他用受伤的右手写下整页名单。"
"最后一个名字被墨水洇开。林舟停住笔，望向窗外那盏忽明忽暗的航灯。"
Highlight the third paragraph softly in pale red, with a small red issue marker in the margin. Bottom of manuscript: quiet line "候选已保存 · 正式稿未改变".
Right inspector: tabs "审稿" selected, "本章计划", "上下文". Header "审稿结果". Red status pill "确定冲突 1", amber chip "待核查 1", neutral chip "风格建议 1". Main evidence card heading "伤势前后矛盾". Body "同一天，受伤的右手恢复了书写能力。". Section label "当前候选 · 第 4 章" with quoted evidence "当天傍晚，他用受伤的右手写下整页名单。". Second evidence section "正式稿来源 · 第 3 章" with quote "右手骨折，三天内不可执笔。". A quiet link "定位原文". Suggestion "改为左手记录，或补充恢复经过。". A short labeled field "修订要求" containing "保留情节，修正用手细节。".
Actions at bottom of inspector: forest-green primary "修订候选稿"; secondary "拒绝候选"; disabled gray button "批准为正式稿" with helper "先解决 1 项确定冲突".
At very bottom a restrained task strip "生成完成  →  审稿完成  →  等待作者处理". No percentage.
Critical semantic invariant: approval is clearly disabled while the confirmed conflict exists. The screenshot must not imply that this candidate has been approved. Prioritize the readable evidence comparison and large manuscript over extra widgets.
```

### 定向编辑

编辑输入为对应首版生成图，仅用于修正同一张图。

```text
Use case: precise-object-edit. Edit only the bottom-right task status strip of this existing UI concept screenshot. Keep every other pixel, every Chinese label, all page layout, colors, novel text and evidence exactly unchanged. In the strip currently reading "生成完成 → 审稿完成 → 等待作者处理", show GREEN filled checkmark icons for BOTH "生成完成" AND "审稿完成", because both steps are complete. Show a small amber current-step dot next to "等待作者处理". This is a semantic correction, not a redesign. Preserve all dimensions and all other elements including the disabled "批准为正式稿" button.
```

## 2 局部改稿

```text
Use case: ui-mockup.
Asset type: A high fidelity desktop application UI concept for the existing novel-engine single-author fiction writing tool. This is a product screen, not a marketing page. Create one crisp, flat, front-on 16:10 landscape screen, ideally 2560 x 1600. No monitor, laptop, perspective, browser chrome, drop-shadow presentation frame, or photographic surroundings.
Design system: an editorial writing application with warm ivory canvas #F6F5F1, white reading surfaces, deep forest green accents #31594D, dark ink text #242C2A, light gray hairline dividers, restrained amber and red for semantic statuses. Quiet, precise and sophisticated, excellent spacing. A compact charcoal-green left navigation sidebar about 210 px of a 1600 px-wide composition; subtle line icons, small rounded rectangles, 8 px rhythm, generous readable document area. Avoid dashboard KPI cards, gradients, glossy effects, neon colors, large illustrations, and chat bubbles. Interface typography is clean modern Simplified Chinese sans-serif; novel prose uses an elegant readable Chinese serif. Chinese labels and punctuation must be accurate. Make text large enough to read. Do not add arbitrary tiny text.
Shared app chrome: brand "novel-engine" top left, book switcher "雾港来信" below it, small "示例作品". Vertical navigation exactly "章节工作台", "规划", "故事记忆", "局部改稿", "任务记录", "版本与导出". Bottom left "模型与设置". Small unobtrusive label in upper right "概念设计 · 示例内容".
This app separates candidate manuscripts from official text. Never show a direct publish button, invented quality score, collaboration avatars, agent chat room, or auto-approve. All data is fictitious concept content.
Primary request: Screen 02, the local revision workspace for reviewing a bounded cross-chapter change and selecting change groups before making new candidates. Choose "局部改稿" in the navigation.
Composition: same app shell. To the right of global navigation, a change-group pane of roughly 270 px in a 1600px composition; center a wide before/after text comparison; a narrow right impact summary. Clear hierarchy, calm editorial spacing, two diff columns of equal width. Not a developer code editor: all diffs are Chinese prose.
Top content header "局部改稿". Below, an instruction strip titled "修改要求" with "把林舟得知父亲身份的时间推迟到第六章。". A compact amber coverage strip "已检查 6 章 · 未检查 2 章"; link "查看检查范围".
Left change-group pane title "修改组". Three cards:
checked "01 延后身份揭示" subtitle "第 2 章";
checked "02 修正提前知情" subtitle "第 4 章 · 依赖修改组 01";
unchecked "03 调整伏笔措辞" subtitle "第 6 章".
Two selected cards have small green checkboxes and very subtle sage backgrounds. Third card is neutral. At bottom "已选 2 组 · 涉及 2 章".
Center title "第 4 章 · 修正提前知情". Toggle "并排对比" selected and "合并对比".
Left comparison heading "当前正式稿". Show normal paragraph "林舟把那封信放回灯下，听见码头的钟敲了三下。", then pale red removed prose "他已经知道，信里提到的船长就是失踪多年的父亲。".
Right heading "所选修改预览". Same unchanged opening paragraph, then pale green replacement "他仍不确定，那位船长为什么会在信里提到自己。".
Below both prose blocks, same visually locked text inside thin amber left rules, a small lock icon and exact label "锁定段落 · 保持原文", with text "潮水淹没了石阶，远处的航灯仍亮着。". Both sides display the same locked sentence. Mark changes using subtle minus/plus markers, not color alone.
Right inspector heading "影响与下一步". Compact items "直接冲突 1" and "因果待核查 2". A dependency row "修改组 02 → 修改组 01". A pale amber note "未检查章节仍需核对". Three vertically ordered steps "1 生成所选候选", "2 逐章重新审稿", "3 作者批准". Calm explanatory line "只选部分修改，也需要对实际结果重新审稿。"
Bottom full-width action bar: "已选 2 组 · 涉及 2 章" on the left, secondary button "返回调整", green primary "生成所选候选". Under the primary a quiet note "正式稿将在批准后更新".
Critical semantics: this is a preview before local candidate creation, not a commit screen. Do not include an enabled approve/apply/publish button. Selecting these groups is not enough to alter official text. The third group is visibly unchecked. Avoid technical hashes and JSON.
```

## 3 故事记忆

```text
Use case: ui-mockup.
Asset type: A high fidelity desktop application UI concept for the existing novel-engine single-author fiction writing tool. This is a product screen, not a marketing page. Create one crisp, flat, front-on 16:10 landscape screen, ideally 2560 x 1600. No monitor, laptop, perspective, browser chrome, drop-shadow presentation frame, or photographic surroundings.
Design system: an editorial writing application with warm ivory canvas #F6F5F1, white reading surfaces, deep forest green accents #31594D, dark ink text #242C2A, light gray hairline dividers, restrained amber and red for semantic statuses. Quiet, precise and sophisticated, excellent spacing. A compact charcoal-green left navigation sidebar about 210 px of a 1600 px-wide composition; subtle line icons, small rounded rectangles, 8 px rhythm, generous readable document area. Avoid dashboard KPI cards, gradients, glossy effects, neon colors, large illustrations, and chat bubbles. Interface typography is clean modern Simplified Chinese sans-serif; novel prose uses an elegant readable Chinese serif. Chinese labels and punctuation must be accurate. Make text large enough to read. Do not add arbitrary tiny text.
Shared app chrome: brand "novel-engine" top left, book switcher "雾港来信" below it, small "示例作品". Vertical navigation exactly "章节工作台", "规划", "故事记忆", "局部改稿", "任务记录", "版本与导出". Bottom left "模型与设置". Small unobtrusive label in upper right "概念设计 · 示例内容".
This app separates candidate manuscripts from official text. Never show a direct publish button, invented quality score, collaboration avatars, agent chat room, or auto-approve. All data is fictitious concept content.
Primary request: Screen 03, the story memory and source evidence workspace. Choose "故事记忆" in the navigation.
Composition: same global sidebar, a modest people filter sidebar within main content, a broad clean information table in center, a right source inspector. No network graph. This is a factual ledger that makes confirmation and source freshness visibly independent.
Top main title "故事记忆". Under it tabs "事实" active, "角色误信", "未来计划", "章节摘要". A search field "搜索人物、物品或事件". A restrained amber status line "2 条来源已失效" with link "查看失效项".
People filter column title "人物", entries "全部人物", active "林舟", "沈砚", "顾宁". Under selected person, aliases "别名：小林、阿舟".
Center table with four clear columns "信息", "来源", "作者确认", "来源状态". Four illustrative rows:
Selected: "林舟持有铜钥匙" | "第 2 章" | amber "待确认" | green "有效";
"林舟住在旧灯塔" | "第 1 章" | green "已确认" | green "有效";
"林舟把旧信交给沈砚" | "第 3 章" | "已确认" | muted amber "已失效";
"林舟知道船长的身份" | "第 4 章" | amber "待确认" | muted amber "已失效".
Use no numeric credibility scores. Do not imply that the currently selected unconfirmed information is being used by the writer.
Below the table a quiet context preview section headed "第 6 章上下文预览", with "视角：林舟", "已采用：有效且已确认的信息", and "当前条目未采用：尚未确认". A small neutral explanatory note "角色获知时间缺少证据时，保留未知。".
Right source inspector title "来源与确认". Item title "林舟持有铜钥匙". Kind pill "已发生事实"; confirmation pill "待确认". A source card labeled "第 2 章 · 正式稿" containing the quoted sentence "林舟把铜钥匙收进衣袋，转身离开了仓库。". Link "定位原文". Simple details "故事时间：未知" and "获知时间：未知". Small sentence "来源有效，不代表内容已经由作者确认。".
Green primary button "确认这条信息", secondary "纠正信息". Beneath it a subtle note "确认后将更新作品版本，现有候选可能需要刷新。". Lower in the inspector a compact "来源失效" section with action "重建失效来源" and label "调用模型".
Critical semantics: facts, character beliefs, and future plans are separate tabs. Source validity and human confirmation are separate columns. The selected fresh unconfirmed source remains excluded from the context. The update warning is understated and legible. All content is illustrative, not a verified real manuscript.
```

### 定向编辑

编辑输入为对应首版生成图，仅用于修正同一张图。

```text
Use case: precise-object-edit. Edit this existing Chinese novel-engine UI screenshot with two precise text corrections, preserving the app shell, dimensions, layout, typography, people list, memory table and buttons.
1) Replace ONLY the large narrative paragraphs INSIDE the bottom-center white panel under "第 6 章上下文预览" with a clean readable context SOURCE LIST, not narrative prose. Preserve the panel header, "视角：林舟", and "当前条目未采用：尚未确认". Inside the white panel display these four rows with comfortable vertical spacing and small outlined source-type badges:
Row 1: badge "本章计划" — "第 6 章 · 已批准的目标与约束" — quiet green "已采用"
Row 2: badge "正式正文" — "第 4 章、第 5 章 · 当前正式版本" — quiet green "已采用"
Row 3: badge "确认事实" — "林舟住在旧灯塔 · 来源：第 1 章" — quiet green "已采用"
Row 4: badge "未采用" — "林舟持有铜钥匙 · 尚未确认" — subdued amber "未采用"
Use a pale green left rule or minimal list row dividers. No generated story text inside this context panel. This panel describes input sources and does not generate the next chapter.
2) Ensure the two small fields in the right source inspector read exactly "故事时间：未知" and "获知时间：未知".
Keep every other element unchanged, including the selected unconfirmed memory, separate confirmation and freshness columns, the disabled-from-context meaning, Chinese labels, source evidence quote, subtle green/ivory visual style, and the concept label. No new controls.
```
