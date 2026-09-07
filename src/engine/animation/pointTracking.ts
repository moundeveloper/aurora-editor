export interface TrackingFrame {width:number;height:number;data:Uint8ClampedArray}
export function grayscale(frame:TrackingFrame) {
  const result=new Float32Array(frame.width*frame.height)
  for(let i=0;i<result.length;i++)result[i]=.2126*frame.data[i*4]!+.7152*frame.data[i*4+1]!+.0722*frame.data[i*4+2]!
  return result
}

/** Normalized correlation tolerates exposure changes; flat patches cannot produce a reliable match. */
export function trackPoint(previous:TrackingFrame,current:TrackingFrame,x:number,y:number,radius=7,search=20) {
  if(previous.width!==current.width || previous.height!==current.height)throw new Error('Tracking frames must have the same dimensions.')
  x=Math.round(x);y=Math.round(y)
  const width=previous.width,height=previous.height,a=grayscale(previous),b=grayscale(current)
  if(x<radius || y<radius || x>=width-radius || y>=height-radius)return null
  const template:number[]=[]
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)template.push(a[(y+dy)*width+x+dx]!)
  const mean=template.reduce((sum,value)=>sum+value,0)/template.length
  const centered=template.map(value=>value-mean),variance=centered.reduce((sum,value)=>sum+value*value,0)
  if(variance/template.length<4)return null
  let best={x,y,score:-1}
  for(let cy=Math.max(radius,y-search);cy<=Math.min(height-radius-1,y+search);cy++)for(let cx=Math.max(radius,x-search);cx<=Math.min(width-radius-1,x+search);cx++) {
    let sum=0,square=0,correlation=0,index=0
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++) {
      const value=b[(cy+dy)*width+cx+dx]!
      sum+=value;square+=value*value;correlation+=centered[index++]!*value
    }
    const denominator=Math.sqrt(variance*Math.max(0,square-sum*sum/template.length))
    const score=denominator>1e-6?correlation/denominator:-1
    if(score>best.score)best={x:cx,y:cy,score}
  }
  return best.score>=.65?best:null
}

export async function openTrackingVideo(url:string,signal?:AbortSignal) {
  const video=document.createElement('video')
  video.crossOrigin='anonymous';video.preload='auto';video.muted=true;video.playsInline=true
  function wait(event:string) {
    return new Promise<void>((resolve,reject)=>{
      const finish=(error?:Error)=>{clearTimeout(timer);video.removeEventListener(event,ready);video.removeEventListener('error',failed);signal?.removeEventListener('abort',cancel);error?reject(error):resolve()}
      const ready=()=>finish(),failed=()=>finish(new Error('Unable to decode tracking video.')),cancel=()=>finish(new DOMException('Tracking cancelled','AbortError'))
      const timer=setTimeout(()=>finish(new Error('Timed out decoding a tracking frame.')),10000)
      video.addEventListener(event,ready,{once:true});video.addEventListener('error',failed,{once:true});signal?.addEventListener('abort',cancel,{once:true})
      if(signal?.aborted)cancel()
    })
  }
  const dispose=()=>{video.pause();video.removeAttribute('src');video.load()}
  const ready=wait('loadeddata');video.src=url;video.load()
  try{await ready}catch(error){dispose();throw error}
  const canvas=document.createElement('canvas')
  canvas.width=Math.min(640,video.videoWidth);canvas.height=Math.max(1,Math.round(canvas.width*video.videoHeight/video.videoWidth))
  const context=canvas.getContext('2d',{willReadFrequently:true})!
  return {width:canvas.width,height:canvas.height,duration:video.duration,dispose,async sample(time:number):Promise<TrackingFrame>{
    if(signal?.aborted)throw new DOMException('Tracking cancelled','AbortError')
    const position=Math.max(0,Math.min(video.duration-.001,time))
    if(Math.abs(video.currentTime-position)>.00001){const seek=wait('seeked');video.currentTime=position;await seek}
    context.drawImage(video,0,0,canvas.width,canvas.height)
    return context.getImageData(0,0,canvas.width,canvas.height)
  }}
}
