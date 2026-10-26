# 自带配音：混音、对轨与字幕联动

本机扩展，适用于产品解说、用户提供 MP3/WAV、给已有动画补旁白、换字幕，以及配音与 BGM/音效合并。保持 huashu-motion 0.1.1 运行时；辅助脚本属于本 skill，不宣称是上游新增的 om 命令。

## 用户怎样调用

直接在 Codex 说：

> 使用 huashu-motion，为【产品名称】制作【时长】的介绍视频。资料在【源码/文档/网页路径】，素材在【目录】。先给我业务梳理和字幕脚本，确认后制作。配音我提供；需要背景音乐、操作音效和单层内嵌大字幕，字幕与配音按句同步。只交付视频，不额外打工程备份包。

配音到齐后：

> 继续用 huashu-motion。配音是【MP3 路径】，对应文字稿是【TXT 路径】。使用原声语速和音高，调整句间留白、镜头和字幕；测量混音响度并检查成片对轴。

有现成配音、素材和已确认脚本时，直接制作；不重复询问已明确的偏好。其他产品独立建立工程和素材目录，先读其实际能力，避免套用旧产品名称、业务、示例数据或镜头。用户指定输出、版本命名、交付范围时沿用；“只交视频”不等于删除可编辑源文件，也不授权自动提交 Git。

## 同一份时间轴

1. 保留用户原始录音。确认文字稿与录音一致，一行一句；按自然停顿、波形/静音和必要的试听审定原始句界。ASR/按字数分配只作初稿，不能把长停顿算进词语后宣称逐字精准。
2. 在 sources/narration.json 填 sourceStart/sourceEnd（原录音秒数）和 startFrame（成片起始帧）。默认不变速、不变调；用句间留白适配镜头。先移动自然停顿，再考虑经用户认可的变速。保留开头辅音和尾音余量。
3. prepare 从同一份配置生成配音 WAV、字幕帧、SRT 源文件和 voice.words.json；后者是**句级**提示，不是词级 ASR。需要词语级动作时另做真实词轴，或在句内人工标注，不能把句级 cues 称作逐字轴。
4. 画面使用 narration-data.js + narration-clock.js。音乐压低使用相同的语音区间。更换录音或改句界后重跑 prepare，重建影片，重跑 sound/mix/check/render/mux。

最小配置（示例句界需针对实际录音重新核对；不是自动对齐结果）：

~~~json
{
  "sourceAudio": "sources/narration-original.mp3",
  "scriptFile": "sources/narration.txt",
  "duration": 12,
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "headHandleMs": 20,
  "tailHandleMs": 30,
  "voiceLufs": -17,
  "voiceTruePeak": -2.5,
  "bedAudio": "assets/sound.wav",
  "bedAlreadyDucked": true,
  "bedGainDb": 0,
  "masterLufs": -16,
  "masterTruePeak": -3,
  "maxEncodedTruePeak": -1,
  "sentences": [
    {"sourceStart": 0, "sourceEnd": 3.04, "startFrame": 8},
    {"sourceStart": 3.39, "sourceEnd": 7.52, "startFrame": 120}
  ]
}
~~~

配置中的路径相对影片工程；原始素材也可使用绝对路径只读引用。生成物固定写入工程内 assets/、sources/、out/，不修改外部原件。prepare 会覆盖本流程拥有的 voice.wav、时间轴和辅助 JS，录音应使用独立的 sourceAudio 路径。长录音解码上限为 512 MiB PCM；超出时改用分段/流式处理，勿截断素材凑成功。

## 可复用命令

Node、FFmpeg/FFprobe 和已安装的 huashu-motion 运行时即可，不需要重新安装渲染器或 ASR。FFMPEG_PATH / FFPROBE_PATH 可指定可执行文件；HUASHU_MOTION_CLI 可指定运行时 om.js。

本流程由 prepare 接管 voice.wav 和句级 cues；之后不再运行 om voice 覆盖这些文件，避免重置已排好的时长和句界。底音须是不含待替换旁白的独立配乐/音效轨；已有完整人声的成片不能直接当 BGM 再叠一遍旁白。

~~~powershell
$narrationTool = "C:\Users\Administrator\.codex\skills\huashu-motion\scripts\narration.mjs"
$filmProject = "D:\视频工程\新产品"
$motionTool = "C:\Users\Administrator\.codex\skills\huashu-motion\bin\om.cmd"

node $narrationTool prepare $filmProject
# 按下节接入 HTML，并清理旧字幕层，再生成/更新音乐。
& $motionTool sound $filmProject
node $narrationTool mix $filmProject
node $narrationTool check $filmProject
& $motionTool check $filmProject
& $motionTool render $filmProject --workers 2 --blur 2
# render 可能刷新 sound.wav，按最新底音重混一次；不需要再次渲染画面。
node $narrationTool mix $filmProject
# 使用渲染器本次实际返回的路径，不能按“最新文件”猜测。
node $narrationTool mux $filmProject "out\新产品-v1.mp4" --out "out\新产品_配音版_v1.mp4"
node $narrationTool verify $filmProject "out\新产品_配音版_v1.mp4"
& $motionTool qa "$filmProject\out\新产品_配音版_v1.mp4"
~~~

mix 只合成音频，不渲染视频；只改音量时可复用已确认画面，重新 mix/mux。改文字、字幕大小、句界或场景时间后须重新渲染画面。mux 显式选择 0:v 和独立母带 1:a，避免在已有配音上叠第二遍。输出已存在会停下，改用版本文件名。仅验证通过的候选会成为最终命名文件；失败的 .partial-*.mp4 留作诊断，不作为交付。

时间轴绑定原录音与文字稿校验值，混音报告绑定母带、旁白和源底音校验值。改了录音/脚本却没有 prepare，或者底音被 render 刷新后没有 mix，会停下提示，避免沿用旧轨。

## HTML 接入与单层字幕

prepare 会生成 sources/narration-fragment.html，其中已写入当前 JSON cues、实际时长、两个本地辅助脚本、om-voice 音轨和字幕容器。将其中片段合并进 index.html（脚本先于调用，容器放在影片画幅内）；替换已有 om-voice / om-cues 时保持唯一。每次 prepare 后更新构建器中的片段，避免内嵌 JSON 留在旧版本。

时间轴已经存在时在注册到 window.__timelines 前 attach：

~~~js
NarrationSync.attach(tl, {container:'#narration-captions'});
window.__timelines['my-film']=tl;
~~~

为 .narration-caption 定义唯一字幕样式，留出固定字幕安全区。1080p 的 48 px 是本次中文影片的合适起点，其他画幅按可读性调整；长句按语义换行。字幕只设置 visibility/opacity，通过 Math.round(t*fps) 驱动；不淡入淡出跨越语音句界。渲染运动模糊时同一帧的前后子帧必须得到相同字幕状态，否则可能在消失后一帧留下灰色残影。OM.clock 可与现有画布时钟共存。

换版时检查三个来源：旧 HTML 小字幕、视频素材里已经烧入的旧字幕、播放器自动加载的 SRT/内嵌软字幕轨。只删除已确认的旧字幕层；视频里已经烧入的文字需从原工程重渲染或重新取景，不能假装关掉字幕开关就能移除。默认按用户已选的单层烧入字幕交付，SRT 留在 sources/subtitles/，不放在 MP4 旁边；用户明确要求可开关字幕时另设交付策略。

## 混音与 AAC 的实测

- 先测原录音和底音，用 LUFS 和 dBTP；百分比音量无法直接比较响度。办公解说片可从旁白约 −17 LUFS、母带约 −16 LUFS、语音期间底音低约 10–14 LU 起步，按听感、素材和渠道调整。
- om sound 已压低配乐时 bedAlreadyDucked=true，避免重复压低；外部 BGM 尚未处理时设 false，辅助脚本做侧链压缩。底音增益在 bedGainDb 调整。生成的底音报告按实际语音窗口比较，不以全片平均掩盖旁白被盖住的段落。
- 只加一次旁白：amix=inputs=2:normalize=0 后做双遍 loudnorm。自动平均会把人声压低；叠加两份人声会破坏音量和听感。不要给每句 asplit 后做无限 apad 再混合，可能造成不结束的滤镜图；本流程一次解码、PCM 切片移位和补零。
- WAV 峰值合格不保证 AAC 合格。本次实测 −2.00 dBTP WAV 经 AAC 后到 +0.64 dBTP；把母带峰值留到约 −5 dBTP 后，AAC 实测约 −2.19 dBTP、−16.25 LUFS。**这是本次素材的测量，不把 −5 当所有项目的固定标准。**
- mux 编码后会验证实际 LUFS/峰值，失败则降低 masterTruePeak 后重新 mix/mux，不重渲染未变的画面。每次都测最终 MP4，不通过调低验证门槛掩盖问题。最多依据一次实际结果做 1–3 次音频调整；仍失败保留诊断，说明原因。

## 验证覆盖与限制

check 检查每句出现前一帧、出现帧、下一帧、消失前一帧、消失帧及两个模糊子帧，核对任意时刻最多一个受管字幕可见；同时查原始配音是否越出字幕边界。它只能检查明确选择的字幕层，仍需人工排查其他旧字幕。

verify 测实际媒体尺寸、帧数、帧率、时长、音频起点/声道、响度与峰值、同名 SRT 和额外软字幕轨，保存带 SHA256 的 sources/final-export-check.json。它不是审片或人耳试听。

纯色/静态字幕安全区可在配置中增加：

~~~json
"captionRegion": {"x":480, "y":954, "width":960, "height":64}
~~~

该坐标只适合示例 1920×1080，必须按本片字幕位置重新确定。verify 才会逐句检查编码后的字幕像素：文字有足够边缘，消失后无文字边缘。平滑投影也会产生灰度方差，因此同时比较横向边缘强度，不能把阴影误报为残影；本次空白区方差约 1.553、边缘均值约 .001，完整字幕边缘约 12.6。背景动态、有纹理或字幕区与内容重叠时，不使用这套纯色阈值；改为截图对照/字幕遮罩或人工查看这些具体边界，并说明检查覆盖。

最后看关键帧与相邻转场，保留读表停顿和合理结尾停留。om qa 的静止警告需要判断是否为阅读时间，不能为了让指标通过给每一帧增加装饰运动。声音数值检查也不能宣称已经人耳听审。
