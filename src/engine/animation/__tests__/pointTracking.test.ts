import {describe,expect,it} from 'vitest'
import {trackPoint,type TrackingFrame} from '../pointTracking'
function frame(dx=0,dy=0,exposure=1):TrackingFrame {
  const width=64,height=64,data=new Uint8ClampedArray(width*height*4)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const px=x-dx,py=y-dy,value=px>=20 && px<=40 && py>=20 && py<=40 ? Math.min(255,((px*37+py*53+px*py*11)%180+20)*exposure):10
    data.set([value,value,value,255],(y*width+x)*4)
  }
  return {width,height,data}
}
describe('point tracking',()=>{
  it('finds a translated feature despite an exposure change',()=>{
    const result=trackPoint(frame(),frame(6,-4,1.1),30,30)
    expect(result?.x).toBe(36);expect(result?.y).toBe(26);expect(result!.score).toBeGreaterThan(.99)
  })
  it('rejects flat patches and features too near the edge',()=>{
    const blank={width:64,height:64,data:new Uint8ClampedArray(64*64*4)}
    expect(trackPoint(blank,blank,30,30)).toBeNull()
    expect(trackPoint(frame(),frame(),2,2)).toBeNull()
  })
})
