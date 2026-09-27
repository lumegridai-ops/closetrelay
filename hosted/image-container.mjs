// Container validation only; the browser must also decode before showing output.
// Mirrors provider/images.py, including CRCs and bounded dimensions.
const invalid=()=>{throw new Error('result_not_an_image');};
const dimensions=(w,h)=>{if(w<1||h<1||w>4096||h>4096)invalid();};
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(bytes){let c=0xffffffff;for(const byte of bytes)c=table[(c^byte)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
export function imageType(bytes){
  const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)){
    let pos=8,header=false,hasData=false,ended=false;
    while(pos+12<=bytes.length){
      const size=data.getUint32(pos),end=pos+12+size;
      if(end>bytes.length)invalid();
      const kind=String.fromCharCode(...bytes.subarray(pos+4,pos+8));
      if(crc(bytes.subarray(pos+4,end-4))!==data.getUint32(end-4))invalid();
      if(!header){
        if(kind!=='IHDR'||size!==13)invalid();
        dimensions(data.getUint32(pos+8),data.getUint32(pos+12));
        const depth=bytes[pos+16],colour=bytes[pos+17],allowed={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
        if(!allowed[colour]?.includes(depth)||bytes[pos+18]||bytes[pos+19]||bytes[pos+20]>1)invalid();
        header=true;
      }else if(kind==='IHDR')invalid();
      if(kind==='acTL')invalid();
      if(kind==='IDAT'&&size)hasData=true;
      if(kind==='IEND'){if(size||end!==bytes.length)invalid();ended=true;break;}
      pos=end;
    }
    if(!header||!hasData||!ended)invalid();
    return'image/png';
  }
  if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)invalid();
  let pos=2,header=false;
  while(pos<bytes.length-2){
    if(bytes[pos]!==255)invalid();
    while(bytes[pos]===255)pos++;
    if(pos>=bytes.length-2)invalid();
    const marker=bytes[pos++];
    if([0,216,217].includes(marker)||(marker>=208&&marker<=215)||pos+2>bytes.length)invalid();
    const size=data.getUint16(pos);
    if(size<2||pos+size>bytes.length-2)invalid();
    if([192,193,194].includes(marker)){
      if(header||size<8)invalid();
      const precision=bytes[pos+2],height=data.getUint16(pos+3),width=data.getUint16(pos+5),components=bytes[pos+7];
      if(precision!==8||![1,3].includes(components)||size!==8+3*components)invalid();
      dimensions(width,height);header=true;
    }
    if(marker===218){if(!header||pos+size>=bytes.length-2)invalid();return'image/jpeg';}
    pos+=size;
  }
  invalid();
}
