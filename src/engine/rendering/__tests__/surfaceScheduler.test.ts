import {afterEach,expect,it,vi} from 'vitest'
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules()})
it('coalesces surfaces, cancels work and defers hidden documents until visible',async()=>{
  let nextFrame:FrameRequestCallback|undefined,visibility:(()=>void)|undefined
  const document={hidden:false,addEventListener:(_event:string,callback:()=>void)=>{visibility=callback}}
  const request=vi.fn((callback:FrameRequestCallback)=>{nextFrame=callback;return 1}),cancel=vi.fn()
  vi.stubGlobal('document',document);vi.stubGlobal('requestAnimationFrame',request);vi.stubGlobal('cancelAnimationFrame',cancel)
  const {scheduleSurface,cancelSurface}=await import('../surfaceScheduler')
  const a=vi.fn(),b=vi.fn();scheduleSurface(a);const id=scheduleSurface(b)
  expect(request).toHaveBeenCalledTimes(1);cancelSurface(id);nextFrame!(0)
  expect(a).toHaveBeenCalledOnce();expect(b).not.toHaveBeenCalled()
  document.hidden=true;scheduleSurface(b);expect(request).toHaveBeenCalledTimes(1)
  document.hidden=false;visibility!();expect(request).toHaveBeenCalledTimes(2);nextFrame!(1)
  expect(b).toHaveBeenCalledOnce()
  const last=scheduleSurface(a);cancelSurface(last);expect(cancel).toHaveBeenCalledOnce()
})
