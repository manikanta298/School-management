import React,{useEffect,useRef,useState} from 'react';
function useAnimatedNumber(target){
 const previous=useRef(target),[value,setValue]=useState(target);
 useEffect(()=>{
  const start=previous.current;previous.current=target;
  if(start===target)return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){setValue(target);return;}
  let frame,time;function step(now){time??=now;const t=Math.min((now-time)/1000,1);setValue(start+(target-start)*(1-(1-t)**3));if(t<1)frame=requestAnimationFrame(step);}
  frame=requestAnimationFrame(step);return()=>cancelAnimationFrame(frame);
 },[target]);return value;
}
export default function CircularAnalysis({percent=null,count,label,description,color='#078274',segments,size='small'}){
 const [ready,setReady]=useState(false),animated=useAnimatedNumber(percent??0);
 useEffect(()=>{const frame=requestAnimationFrame(()=>setReady(true));return()=>cancelAnimationFrame(frame);},[]);
 const radius=100,circumference=2*Math.PI*radius,total=segments?.reduce((sum,s)=>sum+s.value,0)||0;let offset=0;
 const summary=segments?segments.map(s=>`${s.label}: ${s.value}`).join(', '):percent===null?(count===undefined?'No data':`${count}`):`${percent.toFixed(1)} percent`;
 return <div className={`circular-analysis ${size}`}><div className="circle-visual"><svg viewBox="0 0 240 240" role="img" aria-label={`${label}. ${summary}. ${description||''}`}><circle cx="120" cy="120" r="115" fill="none" stroke="#e5e8eb" strokeWidth="1" strokeDasharray={size==='large'?'1 8':'0 0'}/><g transform="rotate(-90 120 120)" fill="none" strokeWidth={size==='large'?17:10}><circle cx="120" cy="120" r={radius} stroke="#edf0f2"/>{segments?segments.map(s=>{const length=total?s.value/total*circumference:0;const position=offset;offset+=length;return <circle key={s.key} cx="120" cy="120" r={radius} stroke={s.color} className="analysis-arc" strokeDasharray={`${ready?Math.max(0,length-(segments.filter(s=>s.value>0).length>1?2:0)):0} ${circumference}`} strokeDashoffset={-position}/>;}):percent!==null&&<circle cx="120" cy="120" r={radius} stroke={color} className="analysis-arc" strokeLinecap="round" strokeDasharray={`${ready?Math.max(0,Math.min(100,percent))/100*circumference:0} ${circumference}`}/>}</g></svg><div className="circle-center" aria-hidden="true"><strong>{percent===null?(count??'—'):animated.toFixed(1)}{percent!==null&&<small>%</small>}</strong>{size==='large'&&<span>Present or late</span>}</div></div>{size!=='large'&&<><h3>{label}</h3><p className="muted">{description}</p></>}</div>;
}
