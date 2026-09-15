(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.JiaoyingVoice=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const errors={
    'not-allowed':'麦克风未获授权。请在浏览器的网站权限中允许麦克风后重试，也可继续打字。',
    'service-not-allowed':'当前浏览器的语音服务不可用，可尝试其他支持语音识别的浏览器或键盘听写。',
    'audio-capture':'未能使用麦克风，请检查设备连接与系统麦克风权限。',
    'network':'语音识别服务连接失败，请检查网络，或使用键盘听写。',
    'no-speech':'没有识别到语音，请靠近麦克风后再试。',
    'language-not-supported':'当前语音服务不支持普通话，请改用键盘听写。',
    'aborted':'语音输入已停止，原草稿已保留。'
  };
  function create({Recognition,secure=true,getText,onText,onChange=()=>{},schedule=setTimeout,unschedule=clearTimeout}){
    const supported=typeof Recognition==='function'&&secure;
    const initialNote=!secure?'请使用 HTTPS 在线演示或本机服务开启语音。':!supported?'当前浏览器未提供语音识别，可用键盘上的麦克风听写，或换用支持的浏览器。':'点击开始说普通话，识别结束后可编辑，不会自动发送。';
    let phase='idle',note=initialNote;
    let preview='',recognition=null,sequence=0,timer=null,original='',finalText='';
    const active=()=>phase!=='idle';
    const state=()=>({supported,phase,note,preview,active:active()});
    const emit=()=>onChange(state());
    function clearTimer(){if(timer!==null)unschedule(timer);timer=null;}
    function release(){clearTimer();const old=recognition;sequence++;recognition=null;phase='idle';return old;}
    function cancel(message='已取消本次语音，原草稿已保留。',announce=true){
      const old=release();preview='';finalText='';note=supported?message:initialNote;
      try{old?.abort();}catch(_){}
      if(announce)emit();
    }
    function fail(message){cancel(message);}
    function finish(){
      const text=finalText.trim();release();preview='';
      if(!text)note='没有得到完整的识别结果，原草稿已保留，请再试一次。';
      else if(getText()!==original)note='输入内容已变化，本次语音未写入，请重新录入。';
      else{
        const combined=original+(original&&!/\s$/.test(original)?'\n':'')+text;
        if(combined.length>2000)note='加上原草稿后超过 2000 字，本次语音未写入。请分段录入。';
        else{note='语音已填入输入框，请核对地名、人数和需求后再发送。';onText(combined);}
      }
      emit();
    }
    function stop(){
      if(!active()||phase==='stopping')return;
      if(phase==='starting'){cancel('已取消等待麦克风，原草稿已保留。');return;}
      phase='stopping';note='正在整理最后一句，请稍候…';clearTimer();
      timer=schedule(()=>fail('识别服务未及时返回，原草稿已保留，请重试。'),8000);emit();
      try{recognition.stop();}catch(_){fail('无法结束本次识别，原草稿已保留，请重新录入。');}
    }
    function start(){
      if(active())return;
      if(!supported){emit();return;}
      original=String(getText()||'');preview='';finalText='';
      if(original.length>=2000){note='输入框已达到 2000 字上限，请先精简内容。';emit();return;}
      const token=++sequence;
      try{
        recognition=new Recognition();const current=recognition;
        current.lang='zh-CN';current.continuous=true;current.interimResults=true;current.maxAlternatives=1;
        const valid=()=>sequence===token&&recognition===current;
        current.onstart=()=>{if(!valid())return;phase='listening';note='正在听你说话，最长 60 秒。说完后点击“结束识别”。';clearTimer();timer=schedule(stop,60000);emit();};
        current.onresult=event=>{
          if(!valid())return;
          const finals=[],interims=[];
          for(let i=0;i<event.results.length;i++){
            const result=event.results[i],text=result[0]?.transcript||'';
            if(result.isFinal)finals.push(text);else interims.push(text);
          }
          finalText=finals.join('');preview=(finalText+interims.join('')).slice(0,2000);emit();
        };
        current.onend=()=>{if(valid())finish();};
        current.onerror=event=>{if(valid())fail(errors[event.error]||'本次语音识别未完成，原草稿已保留，可继续打字。');};
        current.onnomatch=()=>{if(valid())fail('没有辨认出完整语句，原草稿已保留，请再说一次。');};
        phase='starting';note='正在等待麦克风；首次使用请允许浏览器访问。';
        timer=schedule(()=>fail('等待麦克风超时，请检查浏览器权限后重试。'),30000);
        emit();current.start();
      }catch(error){fail(error.name==='NotAllowedError'?errors['not-allowed']:'无法启动语音识别，请检查浏览器支持情况与麦克风权限。');}
    }
    return {state,active,start,stop,cancel};
  }
  return {create};
});
