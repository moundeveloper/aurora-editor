/** Reuse lookup tables while detecting in-place insertion, replacement, deletion and ID edits. */
export class IdentityIndex<T extends {id:string}> {
  private values:T[]=[]
  private ids:string[]=[]
  private map=new Map<string,T>()
  get(values:readonly T[]) {
    if(values.length!==this.values.length||values.some((value,i)=>value!==this.values[i]||value.id!==this.ids[i])){
      this.values=[...values];this.ids=values.map(value=>value.id);this.map=new Map(values.map(value=>[value.id,value]))
    }
    return this.map
  }
}
