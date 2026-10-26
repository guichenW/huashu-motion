#!/usr/bin/env node
// Local extension: frame-aligned narration, measured mixing and verified delivery.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const skill=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [command,projectArg,...args]=process.argv.slice(2);
const help='Usage: node narration.mjs prepare|mix|check|mux|verify <project> [video] [--out out/name.mp4]\nConfig: <project>/sources/narration.json. Read references/narration-sync.md.';
if(!command||command==='--help'){console.log(help);process.exit(0);}
if(!['prepare','mix','check','mux','verify'].includes(command)||!projectArg)throw new Error(help);
const root=path.resolve(projectArg),rate=48000;
const cfg=JSON.parse(await fs.readFile(path.join(root,'sources/narration.json'),'utf8'));
const get=(key,fallback)=>cfg[key]??fallback;
const out=(name)=>{
 const result=path.resolve(root,name),relative=path.relative(root,result);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('Generated output must stay inside the project: '+name);
 return result;
};
const input=(key,fallback)=>path.resolve(root,get(key,fallback));
const json=async(file,data)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(data,null,2));};
const run=(exe,params,options={})=>{
 const result=spawnSync(exe,params,{encoding:'utf8',maxBuffer:64<<20,...options});
 if(result.error||result.status!==0)throw new Error(result.error?.message||String(result.stderr).slice(-6000));
 return result;
};
const ff=(params,options)=>run(process.env.FFMPEG_PATH||'ffmpeg',['-nostdin','-hide_banner','-nostats',...params],options);
const probe=file=>JSON.parse(run(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]).stdout);
const measure=(file,filter='')=>{
 const result=ff(['-i',file,'-vn','-af',(filter?filter+',':'')+'loudnorm=I=-16:TP=-2:LRA=7:print_format=json','-f','null','-']);
 const match=result.stderr.match(/\{\s*"input_i"[\s\S]*?\}/g)?.at(-1);
 if(!match)throw new Error('No loudness measurement: '+file);
 return JSON.parse(match);
};
const normalize=(source,target,i,tp)=>{
 const scan=ff(['-i',source,'-vn','-af','loudnorm=I='+i+':TP='+tp+':LRA=7:print_format=json','-f','null','-']);
 const m=JSON.parse(scan.stderr.match(/\{\s*"input_i"[\s\S]*?\}/g).at(-1));
 if(!Number.isFinite(Number(m.input_i)))throw new Error('Cannot normalize silent narration or mix.');
 const filter='loudnorm=I='+i+':TP='+tp+':LRA=7:measured_I='+m.input_i+':measured_TP='+m.input_tp+':measured_LRA='+m.input_lra+':measured_thresh='+m.input_thresh+':offset='+m.target_offset+':linear=true,aresample=48000';
 ff(['-v','error','-y','-i',source,'-af',filter,'-ac','2','-c:a','pcm_s24le',target]);
 return measure(target);
};
const timingFile=out('sources/narration-timing.json');
const voice=out('assets/voice.wav'),bed=out('assets/bed-narration.wav'),master=out('assets/master-narrated.wav');
const ensureSettings=()=>{
 if(!Number.isInteger(cfg.fps)||cfg.fps<=0||!Number.isInteger(cfg.duration*cfg.fps)||cfg.duration<=0)throw new Error('Set an integer fps and a positive duration containing a whole number of frames.');
 if(!Array.isArray(cfg.sentences)||!cfg.sentences.length)throw new Error('Set reviewed sourceStart/sourceEnd/startFrame for each sentence.');
};
const alignmentFingerprint=()=>createHash('sha256').update(JSON.stringify({duration:cfg.duration,fps:cfg.fps,sentences:cfg.sentences,head:get('headHandleMs',20),tail:get('tailHandleMs',30),voiceLufs:get('voiceLufs',-17),voicePeak:get('voiceTruePeak',-2.5),highpass:get('highpassHz',65)})).digest('hex');
const mixFingerprint=()=>createHash('sha256').update(JSON.stringify({music:input('bedAudio','assets/sound.wav'),gain:get('bedGainDb',0),ducked:get('bedAlreadyDucked',true),lufs:get('masterLufs',-16),peak:get('masterTruePeak',-3)})).digest('hex');
const readTiming=async()=>{
 const t=JSON.parse(await fs.readFile(timingFile,'utf8'));
 if(t.alignmentFingerprint!==alignmentFingerprint()||t.sourceSha256!==await sha(input('sourceAudio','sources/narration-original.mp3'))||t.scriptSha256!==await sha(input('scriptFile','sources/narration.txt')))throw new Error('Narration, script or timing settings changed. Run prepare and rebuild the picture/cues before continuing.');
 return t;
};
const captionFrames=t=>[...new Set(t.sentences.flatMap(s=>[s.startFrame-1,s.startFrame,s.startFrame+1,s.endFrame-1,s.endFrame]).filter(f=>f>=0&&f<t.duration*t.fps))].sort((a,b)=>a-b);
const sha=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const stamp=t=>{const m=Math.round(t*1000);return [Math.floor(m/3600000),Math.floor(m/60000)%60,Math.floor(m/1000)%60].map(n=>String(n).padStart(2,'0')).join(':')+','+String(m%1000).padStart(3,'0');};

async function prepare(){
 ensureSettings();
 const source=input('sourceAudio','sources/narration-original.mp3'),sourceDuration=Number(probe(source).format.duration);
 if([voice,master,out('assets/voice-aligned-raw.wav')].includes(source))throw new Error('Keep the original recording separate from generated audio files.');
 const script=await fs.readFile(input('scriptFile','sources/narration.txt'),'utf8');
 const lines=script.replace(/^\uFEFF/,'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 if(lines.length!==cfg.sentences.length)throw new Error('One nonempty script line is required for each reviewed sentence.');
 const head=get('headHandleMs',20)/1000,tail=get('tailHandleMs',30)/1000;
 if(head<0||tail<0)throw new Error('Clip handles must be nonnegative.');
 const sentences=cfg.sentences.map((s,i)=>{
  if(!Number.isFinite(s.sourceStart)||!Number.isFinite(s.sourceEnd)||s.sourceStart<0||s.sourceEnd<=s.sourceStart||s.sourceEnd>sourceDuration+.001||!Number.isInteger(s.startFrame)||s.startFrame<0)throw new Error('Invalid source or target bounds at sentence '+(i+1));
  if(s.text&&s.text.trim()!==lines[i])throw new Error('Transcript differs at sentence '+(i+1));
  const clipStart=Math.max(0,s.sourceStart-head),clipEnd=Math.min(sourceDuration,s.sourceEnd+tail);
  const sourceA=Math.round(clipStart*rate),sourceB=Math.round(clipEnd*rate);
  const endFrame=s.startFrame+Math.ceil((sourceB-sourceA)/rate*cfg.fps);
  return {...s,text:lines[i],clipStart,clipEnd,sourceA,sourceB,endFrame,start:s.startFrame/cfg.fps,end:endFrame/cfg.fps};
 });
 sentences.forEach((s,i)=>{
  if(s.end>cfg.duration||(i&&s.startFrame<sentences[i-1].endFrame))throw new Error('Target clips overlap or exceed the film at sentence '+(i+1));
  if(i&&s.sourceA<sentences[i-1].sourceB)throw new Error('Source handles overlap at sentence '+(i+1)+'. Review the pause or reduce headHandleMs/tailHandleMs.');
 });
 await fs.mkdir(out('assets'),{recursive:true});
 const decoded=ff(['-v','error','-i',source,'-ar',String(rate),'-ac','2','-af','highpass=f='+get('highpassHz',65),'-f','f32le','-'],{encoding:null,maxBuffer:512<<20}).stdout;
 const pcm=Buffer.alloc(Math.round(cfg.duration*rate)*8);
 for(const s of sentences){
  const at=Math.round(s.start*rate),count=s.sourceB-s.sourceA,fade=Math.min(240,Math.floor(count/4));
  if(s.sourceB*8>decoded.length)throw new Error('Decoded source ends before sentence '+s.text);
  decoded.copy(pcm,at*8,s.sourceA*8,s.sourceB*8);
  for(let j=0;j<fade;j++)for(let c=0;c<2;c++){
   const a=(at+j)*8+c*4,b=(at+count-1-j)*8+c*4;
   pcm.writeFloatLE(pcm.readFloatLE(a)*j/fade,a);pcm.writeFloatLE(pcm.readFloatLE(b)*j/fade,b);
  }
 }
 const raw=out('assets/voice-aligned-raw.wav');
 ff(['-v','error','-y','-f','f32le','-ar',String(rate),'-ac','2','-i','pipe:0','-c:a','pcm_f32le',raw],{input:pcm,encoding:null});
 const voiceLevels=normalize(raw,voice,get('voiceLufs',-17),get('voiceTruePeak',-2.5));
 const timing={duration:cfg.duration,fps:cfg.fps,sentences,sourceSha256:await sha(source),scriptSha256:await sha(input('scriptFile','sources/narration.txt')),alignmentFingerprint:alignmentFingerprint(),originalVoice:measure(source),voiceLevels,precision:'Reviewed sentence clip edges; source speed and pitch preserved. Not word-level ASR.'};
 await json(timingFile,timing);
 await json(out('sources/captions.json'),sentences.map(s=>[s.start,s.end,s.text]));
 const cues={duration:cfg.duration,precision:timing.precision,words:sentences.map(s=>({word:s.text,start:s.start,end:s.end}))};
 await json(out('assets/voice.words.json'),cues);
 const data={duration:cfg.duration,fps:cfg.fps,sentences:sentences.map(({text,startFrame,endFrame})=>({text,startFrame,endFrame}))};
 await fs.writeFile(out('assets/narration-data.js'),'window.NARRATION_SYNC_DATA='+JSON.stringify(data).replaceAll('<','\\u003c')+';\n');
 await fs.copyFile(path.join(skill,'assets/narration-clock.js'),out('assets/narration-clock.js'));
 const fragment='<script src="assets/narration-data.js"></script>\n<script src="assets/narration-clock.js"></script>\n<script type="application/json" id="om-cues">'+JSON.stringify(cues).replaceAll('<','\\u003c')+'</script>\n<audio id="om-voice" src="assets/voice.wav" data-start="0" data-duration="'+cfg.duration+'" data-track-index="9" data-volume="1"></audio>\n<div id="narration-captions"></div>\n';
 await fs.writeFile(out('sources/narration-fragment.html'),fragment);
 await fs.mkdir(out('sources/subtitles'),{recursive:true});
 await fs.writeFile(out('sources/subtitles/narration.srt'),sentences.map((s,i)=>(i+1)+'\r\n'+stamp(s.start)+' --> '+stamp(s.end)+'\r\n'+s.text+'\r\n').join('\r\n'));
 return {prepared:true,voice,voiceLevels,sentences:sentences.length,duration:cfg.duration,htmlFragment:out('sources/narration-fragment.html')};
}

async function mix(){
 const t=await readTiming(),music=input('bedAudio','assets/sound.wav'),duration=String(t.duration);
 if([voice,bed,master,out('assets/master-narrated-raw.wav')].includes(music))throw new Error('Keep the source music separate from generated mix files.');
 const gain=get('bedGainDb',0),ducked=get('bedAlreadyDucked',true);
 const musicFilter='volume='+gain+'dB,apad,atrim=duration='+duration;
 if(ducked)ff(['-v','error','-y','-i',music,'-af',musicFilter,'-ar',String(rate),'-ac','2','-c:a','pcm_s24le',bed]);
 else ff(['-v','error','-y','-i',music,'-i',voice,'-filter_complex','[0:a]'+musicFilter+'[bed];[bed][1:a]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=250:makeup=1[out]','-map','[out]','-ar',String(rate),'-ac','2','-c:a','pcm_s24le',bed]);
 const raw=out('assets/master-narrated-raw.wav');
 ff(['-v','error','-y','-i',bed,'-i',voice,'-filter_complex','[0:a][1:a]amix=inputs=2:normalize=0:dropout_transition=0,apad,atrim=duration='+duration+',afade=t=out:st='+(t.duration-.02)+':d=0.02[out]','-map','[out]','-c:a','pcm_s24le',raw]);
 const masterLevels=normalize(raw,master,get('masterLufs',-16),get('masterTruePeak',-3));
 const select="aselect='"+t.sentences.map(s=>'between(t,'+s.start+','+s.end+')').join('+')+"',asetpts=N/SR/TB";
 const v=measure(voice,select),b=measure(bed,select),separationLU=Number(v.input_i)-Number(b.input_i);
 const report={master,duration:t.duration,mixFingerprint:mixFingerprint(),masterSha256:await sha(master),voiceSha256:await sha(voice),bedSourceSha256:await sha(music),voice:measure(voice),bed:measure(bed),masterLevels,duringNarration:{voiceLufs:Number(v.input_i),bedLufs:Number(b.input_i),separationLU:Number(separationLU.toFixed(2))},bedAlreadyDucked:ducked,bedGainDb:gain,warnings:separationLU<8||separationLU>18?['Review the voice/music balance; measured speech separation is outside the suggested 8–18 LU range.']:[]};
 await json(out('sources/audio-mix-report.json'),report);
 return report;
}

async function check(){
 const t=await readTiming();
 const cli=process.env.HUASHU_MOTION_CLI||path.join(os.homedir(),'.codex/tools/huashu-motion/cli/om.js');
 const {openFilm}=await import(pathToFileURL(path.join(path.dirname(cli),'lib/capture.js')));
 const film=await openFilm(path.join(root,'index.html'),{video:'seek'});
 const selector=get('captionSelector','[data-narration-caption]'),results=[];
 try{
  const layout=await film.evaluate('(()=>{const e=[...document.querySelectorAll('+JSON.stringify(selector)+')];return e.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,scroll:el.scrollWidth,text:el.textContent}})})()');
  if(layout.length!==t.sentences.length||layout.some((s,i)=>s.left<0||s.right>film.width||s.top<0||s.bottom>film.height||s.scroll>s.width+1||s.text.trim()!==t.sentences[i].text))throw new Error('Caption count, transcript or safe-area layout does not match the timeline.');
  for(let i=0;i<t.sentences.length;i++){
   const s=t.sentences[i],frames=[s.startFrame-1,s.startFrame,s.startFrame+1,s.endFrame-1,s.endFrame,s.startFrame-.25,s.endFrame-.25];
   for(const frame of frames.filter(f=>f>=0&&f<t.duration*t.fps)){
    await film.seek(frame/t.fps);
    const actual=await film.evaluate('(()=>{const e=[...document.querySelectorAll('+JSON.stringify(selector)+')];return e.map((el,i)=>({el,i})).filter(({el})=>{const s=getComputedStyle(el);return s.visibility==="visible"&&Number(s.opacity)>.99}).map(x=>x.i)})()');
    const expected=t.sentences.flatMap((c,j)=>Math.round(frame)>=c.startFrame&&Math.round(frame)<c.endFrame?[j]:[]);
    const passed=JSON.stringify(actual)===JSON.stringify(expected)&&actual.length<=1;
    results.push({frame,expected,actual,passed});if(!passed)throw new Error('Caption/subframe mismatch: '+JSON.stringify(results.at(-1)));
   }
  }
  if(film.errors.length)throw new Error(film.errors.join('\n'));
 }finally{await film.close();}
 const pcm=ff(['-v','error','-i',voice,'-ac','1','-ar',String(rate),'-f','f32le','-'],{encoding:null,maxBuffer:256<<20}).stdout;
 const db=(a,b)=>{let sum=0,count=0;for(let i=Math.max(0,Math.round(a*rate));i<Math.min(pcm.length/4,Math.round(b*rate));i++){const v=pcm.readFloatLE(i*4);sum+=v*v;count++;}return 10*Math.log10(sum/Math.max(1,count)+1e-14);};
 const audio=t.sentences.map((s,i)=>{
  const left=i?t.sentences[i-1].end:0,right=i+1<t.sentences.length?t.sentences[i+1].start:t.duration;
  return {sentence:i+1,beforeDb:db(Math.max(left,s.start-.02),s.start),afterDb:db(s.end,Math.min(right,s.end+.02))};
 });
 if(audio.some(a=>a.beforeDb>-60||a.afterDb>-60))throw new Error('Voice extends outside a caption: '+JSON.stringify(audio));
 const report={passed:true,captionFrameChecks:results.length,results,audioBoundaryChecks:audio,scope:'Owned caption layer and aligned PCM boundaries; inspect/remove old burned-in or external captions separately.'};
 await json(out('sources/narration-sync-check.json'),report);return report;
}

async function verify(file,report=true){
 const t=await readTiming(),media=probe(file),v=media.streams.find(s=>s.codec_type==='video'),a=media.streams.find(s=>s.codec_type==='audio');
 if(!v||!a||Number(v.width)!==get('width',1920)||Number(v.height)!==get('height',1080)||Number(v.nb_frames)!==t.duration*t.fps||Math.abs(Number(media.format.duration)-t.duration)>.05||a.channels!==2||Math.abs(Number(a.start_time))>1/t.fps)throw new Error('Unexpected dimensions, frame count, audio start, channel count or duration.');
 const parts=v.r_frame_rate.split('/').map(Number);
 if(Math.abs(parts[0]/parts[1]-t.fps)>.001)throw new Error('Video fps differs from the narration timeline.');
 if(media.streams.some(s=>s.codec_type==='subtitle'))throw new Error('An additional subtitle stream would duplicate burned-in captions.');
 try{await fs.access(file.replace(/\.mp4$/i,'.srt'));throw new Error('Remove the same-name external SRT from the burned-in delivery directory.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const levels=measure(file),maxPeak=get('maxEncodedTruePeak',-1),target=get('masterLufs',-16);
 if(Math.abs(Number(levels.input_i)-target)>.6||Number(levels.input_tp)>maxPeak)throw new Error('Encoded audio failed: '+levels.input_i+' LUFS, '+levels.input_tp+' dBTP. Lower masterTruePeak for AAC headroom, rerun mix/mux, and remeasure.');
 let pixels=null;
 if(cfg.captionRegion){
  const r=cfg.captionRegion,frames=captionFrames(t);
  if(![r.x,r.y,r.width,r.height].every(Number.isInteger)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>v.width||r.y+r.height>v.height)throw new Error('Invalid captionRegion.');
  const filter="select='"+frames.map(n=>'eq(n,'+n+')').join('+')+"',crop="+[r.width,r.height,r.x,r.y].join(':')+',format=gray';
  const decoded=ff(['-v','error','-i',file,'-vf',filter,'-fps_mode','passthrough','-f','rawvideo','-pix_fmt','gray','-'],{encoding:null,maxBuffer:256<<20}).stdout;
  const size=r.width*r.height;if(decoded.length!==frames.length*size)throw new Error('Could not decode all subtitle check frames.');
  pixels=frames.map((frame,i)=>{
   const data=decoded.subarray(i*size,(i+1)*size);let sum=0,square=0,edges=0;
   for(let j=0;j<size;j++){const value=data[j];sum+=value;square+=value*value;if(j%r.width)edges+=Math.abs(value-data[j-1]);}
   const deviation=Math.sqrt(Math.max(0,square/size-(sum/size)**2)),edgeMean=edges/(Math.max(1,r.width-1)*r.height);
   const visible=t.sentences.some(s=>frame>=s.startFrame&&frame<s.endFrame);
   const passed=visible?deviation>(r.onStdMin??4)&&edgeMean>(r.onEdgeMin??.5):deviation<(r.offStdMax??3)&&edgeMean<(r.offEdgeMax??.05);
   return {frame,visible,deviation,edgeMean,passed};
  });
  if(pixels.some(p=>!p.passed))throw new Error('Encoded caption pixels failed. Inspect these frames and the configured quiet background: '+JSON.stringify(pixels.filter(p=>!p.passed)));
 }
 const result={file,verified:true,sha256:await sha(file),media,loudness:levels,captionPixels:pixels,scope:pixels?'Media, audio, and configured caption pixel windows.':'Media/audio only; no captionRegion configured. Run check and review encoded subtitle edges.'};
 if(report)await json(out('sources/final-export-check.json'),result);
 return result;
}

async function mux(){
 const mixed=JSON.parse(await fs.readFile(out('sources/audio-mix-report.json'),'utf8'));
 if(mixed.mixFingerprint!==mixFingerprint()||mixed.masterSha256!==await sha(master)||mixed.voiceSha256!==await sha(voice)||mixed.bedSourceSha256!==await sha(input('bedAudio','assets/sound.wav')))throw new Error('Mix settings or audio stems changed. Run mix before mux.');
 const picture=args[0]&&!args[0].startsWith('--')?path.resolve(root,args[0]):null;
 const at=args.indexOf('--out'),target=out(at>=0?args[at+1]:'out/narrated.mp4');
 if(!picture||path.extname(target).toLowerCase()!=='.mp4')throw new Error('mux needs the exact new picture MP4 and --out out/name.mp4.');
 try{await fs.access(target);throw new Error('Output already exists; use a new versioned name: '+target);}catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.mkdir(path.dirname(target),{recursive:true});
 const candidate=target.replace(/\.mp4$/i,'.partial-'+randomUUID()+'.mp4');
 ff(['-v','error','-n','-i',picture,'-i',master,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','256k','-t',String(cfg.duration),'-movflags','+faststart',candidate]);
 const result=await verify(candidate,false); // failed candidates remain clearly marked; never become the delivery
 // Check the intended basename too; a stale SRT would auto-load only after the rename.
 try{await fs.access(target.replace(/\.mp4$/i,'.srt'));throw new Error('Same-name SRT exists beside the intended MP4.');}catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.copyFile(candidate,target,fs.constants.COPYFILE_EXCL);await fs.unlink(candidate);
 result.file=target;await json(out('sources/final-export-check.json'),result);
 await json(out('sources/current-version.json'),{video:path.relative(root,target),duration:cfg.duration,sha256:result.sha256,subtitleMode:'burned-in'});
 return {video:target,sha256:result.sha256,loudness:result.loudness,captionFrameChecks:result.captionPixels?.length??0};
}

try{
 const result=command==='prepare'?await prepare():command==='mix'?await mix():command==='check'?await check():command==='mux'?await mux():await verify(path.resolve(root,args[0]||''));
 console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
