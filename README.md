# LeetLoop

<p align="right"><a href="./README.md"><kbd>简体中文</kbd></a> <a href="./README.en.md"><kbd>English</kbd></a></p>

LeetLoop 是一个本地优先的 LeetCode 复习伴侣。它在你正常做题时自动记录提交结果，并根据间隔重复安排下一次练习，目标不是统计“做过多少题”，而是持续验证“现在还会多少”。

## 第一版包含什么

- 在 `leetcode.com/problems/*` 页面自动识别题目和提交结果；
- 自动记录日期、AC/WA/TLE、耗时、提交次数、语言和检测到的页面内提示暴露；
- 使用 FSRS 加刷题规则安排复习；
- Chrome 侧栏提供“今日、主题、记录”三个页面；
- 通过扩展角标和每日通知显示到期题数；
- 可在侧栏右上角开关每日提醒并调整提醒时间；
- 所有数据仅保存在本机，不需要账户或服务器；
- 不保存代码、Cookie、LeetCode Session，也不批量读取历史记录。

## 技术结构

- TypeScript：全部业务代码；
- React：侧栏界面；
- WXT：Manifest V3 构建、开发和打包；
- Dexie + IndexedDB：浏览器本地数据库；
- ts-fsrs：间隔重复调度；
- Vitest：调度及掌握度单元测试。

扩展由三类运行环境组成：

1. `leetcode.content` 内容脚本只观察用户当前打开的题目页面，把提交事件发送给扩展后台；
2. `background` Service Worker 负责去重、存储、排期、通知和角标；
3. `sidepanel` React 页面从本地数据库读取今日任务、主题掌握度和历史记录。

## 直接安装构建版

下载并解压交付包后：

1. 在 Chrome 打开 `chrome://extensions`；
2. 打开右上角“开发者模式”；
3. 点击“加载已解压的扩展程序”；
4. 选择包内的 `leetloop/.output/chrome-mv3`；
5. 打开一道 LeetCode 题，点击工具栏里的 LeetLoop 图标。

这是未发布到 Chrome Web Store 的开发构建，因此第一次需要通过开发者模式加载。

## 本地开发

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

然后：

1. 在 Chrome 打开 `chrome://extensions`；
2. 打开右上角“开发者模式”；
3. 点击“加载已解压的扩展程序”；
4. 选择 `.output/chrome-mv3`；
5. 打开一道 LeetCode 题，点击工具栏里的 LeetLoop 图标即可打开侧栏。

开发服务器运行时，WXT 会自动重建扩展；若 Chrome 没有自动更新，点击扩展卡片上的刷新按钮。

## 检查和打包

```bash
npm run compile
npm test
npm run build
npm run zip
```

构建后的可加载目录位于 `.output/chrome-mv3`，ZIP 位于 `.output`。

## 自动评分规则

Accepted 并不直接等于掌握。LeetLoop 会结合：

- 是否为第一次完成或间隔复习；
- 当前会话提交次数；
- 解题耗时；
- 是否检测到打开 Hint、Editorial 或 Solutions；
- 题目难度；
- 距离上次完成的时间。

首次记录通过只进入“学习中”。只有经过多次间隔复习，并持续表现稳定，题目才会进入“已掌握”。这些评分是用于排期的保守代理信号，不是对“独立完成”或真实面试能力的证明。

## 隐私与平台边界

本项目不调用 LeetCode 未公开接口，不在后台轮询 LeetCode，不自动翻页或批量抓取历史提交。内容脚本只处理用户主动打开的当前题目页面，并只保存复习所需的最小元数据。

当前版本从安装后开始形成可靠记录。过去已经完成的题目不会自动补齐；它们以后再次打开和提交时会自然进入复习系统。

## 当前限制

- LeetCode 改版可能导致提交结果选择器需要更新；代码将站点解析集中在一个内容脚本内，便于修复。
- 系统能识别 LeetCode 页面内打开的提示或题解，无法知道用户是否在其他网站查看答案。
- 第一版只支持 `leetcode.com`；中国站可以通过新增独立 provider adapter 支持。
- 数据尚未跨设备同步。卸载扩展前应先等待后续版本提供导出功能。
