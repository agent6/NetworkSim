import type {Endpoint, Link} from './model.ts';

export interface Point {x:number;y:number}
export interface LayoutNode extends Point {id:string;name?:string}
export interface LayoutBox extends Point {width:number;height:number}
export interface PortLabel extends LayoutBox {text:string;endpoint:Endpoint;anchor:Point}
export interface LinkLayout {
  id:string;path:string;start:Point;end:Point;middle:Point;
  labels:[PortLabel,PortLabel];index:number;count:number;bounds:LayoutBox;
}
export function shortInterface(name:string):string {
  return name.replace(/^TwentyFiveGigE/,'Twe').replace(/^FortyGigabitEthernet/,'Fo').replace(/^HundredGigE/,'Hu').replace(/^TenGigabitEthernet/,'Te').replace(/^GigabitEthernet/,'Gi').replace(/^FastEthernet/,'Fa').replace(/^Ethernet/,'Eth').replace(/^Port-channel/,'Po');
}
export function pairKey(a:string,b:string):string {return JSON.stringify([a,b].sort());}
export function orderedPairLinks(links:readonly Link[],a:string,b:string):Link[] {
  const first=[a,b].sort()[0];
  const port=(link:Link,local:boolean)=>((link.a.deviceId===first)===local?link.a:link.b).port;
  return links.filter(l=>pairKey(l.a.deviceId,l.b.deviceId)===pairKey(a,b)).sort((x,y)=>port(x,true).localeCompare(port(y,true),undefined,{numeric:true})||port(x,false).localeCompare(port(y,false),undefined,{numeric:true})||x.id.localeCompare(y.id));
}
const add=(a:Point,b:Point,n=1):Point=>({x:a.x+b.x*n,y:a.y+b.y*n});
const unit=(a:Point):Point=>{const length=Math.hypot(a.x,a.y)||1;return{x:a.x/length,y:a.y/length};};
const overlap=(a:LayoutBox,b:LayoutBox,gap=5)=>Math.abs(a.x-b.x)<(a.width+b.width)/2+gap&&Math.abs(a.y-b.y)<(a.height+b.height)/2+gap;
const number=(n:number)=>Math.round(n*100)/100;
const coords=(p:Point)=>`${number(p.x)},${number(p.y)}`;
function cubic(a:Point,b:Point,c:Point,d:Point,t:number):Point {const u=1-t;return{x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y};}
function nodeBox(n:LayoutNode):LayoutBox {return{x:n.x,y:n.y+18,width:Math.max(84,(n.name?.length??0)*7+12),height:104};}

/** Deterministic, orientation-independent lanes, with labels laid out in world coordinates. */
export function layoutLinks(nodes:readonly LayoutNode[],links:readonly Link[],obstacles:readonly LayoutBox[]=[]):LinkLayout[] {
  const byId=new Map(nodes.map(n=>[n.id,n])),groups=new Map<string,Link[]>(),reserved:LayoutBox[]=[...nodes.map(nodeBox),...obstacles];
  for(const link of links){if(!byId.has(link.a.deviceId)||!byId.has(link.b.deviceId))continue;const key=pairKey(link.a.deviceId,link.b.deviceId);if(!groups.has(key))groups.set(key,orderedPairLinks(links,link.a.deviceId,link.b.deviceId));}
  const result:LinkLayout[]=[];
  for(const key of [...groups.keys()].sort()) {
    const group=groups.get(key)!;
    group.forEach((link,index)=>{
      const ends=[link.a,link.b].sort((a,b)=>a.deviceId.localeCompare(b.deviceId)),a=byId.get(ends[0].deviceId)!,b=byId.get(ends[1].deviceId)!;
      const delta={x:b.x-a.x,y:b.y-a.y},length=Math.hypot(delta.x,delta.y),direction=length>1?unit(delta):{x:1,y:0},normal={x:-direction.y,y:direction.x};
      const lane=index-(group.length-1)/2,spacing=38+Math.abs(normal.x)*38,spread=lane*spacing,fan=group.length===1?0:lane/Math.max(1,(group.length-1)/2)*20;
      // Separate the sockets as well as the curves. Vertical cables leave to the
      // side of a device caption, rather than running through its hostname.
      const socket=(node:LayoutNode,toward:Point,shift:number):Point=>{
        if(toward.y>.65){const side=Math.sign(normal.x*shift)||Math.sign(toward.x)||1;return{x:node.x+side*34,y:node.y+8+Math.abs(shift)*.5};}
        const distance=1/Math.max(Math.abs(toward.x)/34,Math.abs(toward.y)/29);
        const p=add(add(node,toward,distance),normal,shift);
        return{x:Math.max(node.x-36,Math.min(node.x+36,p.x)),y:Math.max(node.y-29,Math.min(node.y+26,p.y))};
      };
      const start=socket(a,direction,fan),end=socket(b,{x:-direction.x,y:-direction.y},fan),reach=Math.max(65,length*.3);
      let c1=add(add(a,direction,reach),normal,spread*1.38),c2=add(add(b,direction,-reach),normal,spread*1.38);
      if(direction.y>.65)c1.x=a.x+Math.sign(start.x-a.x)*Math.max(85,Math.abs(c1.x-a.x));
      if(direction.y<-.65)c2.x=b.x+Math.sign(end.x-b.x)*Math.max(85,Math.abs(c2.x-b.x));
      if(length<100){c1=add(c1,normal,80);c2=add(c2,normal,80);}
      const samples=Array.from({length:65},(_,i)=>cubic(start,c1,c2,end,i/64));
      const distances=[0];for(let i=1;i<samples.length;i++)distances.push(distances[i-1]+Math.hypot(samples[i].x-samples[i-1].x,samples[i].y-samples[i-1].y));
      const total=distances.at(-1)!;
      const place=(endpoint:Endpoint,fromStart:boolean):PortLabel=>{
        const text=shortInterface(endpoint.port),width=Math.max(48,text.length*6.6+14),height=22;
        let best:{label:PortLabel;cost:number}|undefined;
        for(const fraction of [.18,.25,.33,.4]){
          const target=fromStart?total*fraction:total*(1-fraction);
          let i=distances.findIndex(d=>d>=target);if(i<0)i=64;
          const anchor=samples[i],previous=samples[Math.max(0,i-1)],next=samples[Math.min(64,i+1)],tangent=unit({x:next.x-previous.x,y:next.y-previous.y}),perpendicular={x:-tangent.y,y:tangent.x};
          for(const offset of [0,-28,28,-56,56,-84,84,-112,112,-154,154,-210,210]){
            const center=add(anchor,perpendicular,offset),label={...center,width,height,text,endpoint,anchor};
            const collisions=reserved.reduce((n,box)=>n+Number(overlap(label,box)),0);
            const cost=collisions*100000+Math.abs(offset)+Math.abs(fraction-.18)*100;
            if(!best||cost<best.cost)best={label,cost};
          }
        }
        const label=best!.label;reserved.push(label);return label;
      };
      const first=place(ends[0],true),second=place(ends[1],false),labels:[PortLabel,PortLabel]=link.a.deviceId===ends[0].deviceId?[first,second]:[second,first];
      const xs=[...samples.map(p=>p.x),...labels.flatMap(l=>[l.x-l.width/2,l.x+l.width/2])],ys=[...samples.map(p=>p.y),...labels.flatMap(l=>[l.y-l.height/2,l.y+l.height/2])],left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
      result.push({id:link.id,path:`M${coords(start)} C${coords(c1)} ${coords(c2)} ${coords(end)}`,start:link.a.deviceId===ends[0].deviceId?start:end,end:link.a.deviceId===ends[0].deviceId?end:start,middle:samples[32],labels,index,count:group.length,bounds:{x:(left+right)/2,y:(top+bottom)/2,width:right-left,height:bottom-top}});
    });
  }
  return result;
}
