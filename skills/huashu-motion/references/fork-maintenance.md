# Fork 维护与 Windows Codex 安装

## 仓库与分支

- 作者上游（upstream）：https://github.com/alchaincyf/huashu-motion
- 个人 Fork（origin）：https://github.com/guichenW/huashu-motion
- main：保留上游版本。
- codex/narration-sync：可用的定制版本，包含用户配音、混音、句级字幕联动和实际编码验证；合并上游更新后继续使用。
- package.json 和 SKILL.md 的版本号表示合并的上游版本；定制分支的 Git 提交标识具体扩展版本。

完整仓库包含 CLI、渲染器、原始上游历史和技能资源。不要将压缩包解压目录直接初始化后与上游做无共同历史的合并。

## 首次安装

将完整 Fork 克隆到 Codex tools 目录，检出定制分支：

~~~powershell
$codexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$checkout = Join-Path $codexRoot 'tools\huashu-motion'
git clone --branch codex/narration-sync https://github.com/guichenW/huashu-motion.git $checkout
Set-Location $checkout
git remote add upstream https://github.com/alchaincyf/huashu-motion.git
git config core.ignorestat false
.\scripts\install-codex.ps1 -CodexRoot $codexRoot
~~~

installer 将 Codex skills/huashu-motion 创建为指向仓库内技能目录的 NTFS junction；合并后技能与运行时立即属于同一份版本。已有普通技能目录会先保存到 Codex artifacts/huashu-motion-install-backups，再创建链接。若已有链接属于别的检出，脚本停止，由操作者检查。

Windows 入口为 skills/huashu-motion/bin/om.cmd；Node >=22、Chrome、FFmpeg/FFprobe 为现有依赖。辅助脚本在完整仓库中优先定位同仓库 CLI；HUASHU_MOTION_CLI 可显式覆盖。

安装后可能需要重新打开会话，才能刷新 Codex 已加载的技能说明。

## 更新并推送

在定制分支且工作目录干净时：

~~~powershell
.\scripts\sync-upstream.ps1 -Push
~~~

脚本依次 fetch upstream、merge upstream/main、运行上游测试和配音端到端测试，通过后推送 origin 的定制分支。去掉 -Push 可先完成本地合并和测试。不会强推、自动 reset 或自动处理冲突；冲突和失败会留下现场供检查。

若上游有冲突，修改对应文件、确认双方功能都保留，然后 git add 和 git commit 完成合并，再运行 scripts/test-narration.ps1，通过后正常推送。不要 rebase 或强推已经共享的分支。

Git 全局 core.ignorestat=true 会让新文件默认标为 assume-unchanged，可能漏报改动。此仓库关闭该选项；发现旧标记时需显式清除受影响文件的标记，避免覆盖未发现的修改。

此流程按用户请求手动运行，不创建后台任务或自动向作者仓库提交 PR。

## 合并后检查范围

- 上游测试：渲染、3D、素材、声音及 CLI 等原有测试。
- 配音集成：独立合成信号、真实 Chrome 双采样渲染、AAC 封装；检查原始句界、重叠拒绝、14 个 HTML/帧/子帧点和 10 个编码字幕边界点。
- 旁白与底音、字幕时轴、混音参数更改后，旧产物必须被校验值拒绝；同名外挂字幕必须被拒绝。
- 影片素材和输出不属于此 Skill 仓库；不要把业务报表、配音原件、Cookie、数据库配置或视频工程放进 Fork。
