import { expect,it } from 'vitest'
import { IdentityIndex } from '../identityIndex'
it('reuses lookups and invalidates in-place membership and id changes',()=>{
  const index=new IdentityIndex<{id:string;value:number}>(),a={id:'a',value:1},values=[a]
  const first=index.get(values);a.value=2;expect(index.get(values)).toBe(first);expect(first.get('a')?.value).toBe(2)
  a.id='b';expect(index.get(values).has('a')).toBe(false);expect(index.get(values).get('b')).toBe(a)
  values.push({id:'c',value:3});expect(index.get(values).size).toBe(2)
  values.splice(0,1);expect(index.get(values).size).toBe(1)
})
