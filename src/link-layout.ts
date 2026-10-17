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

interface Socket {point:Point;outward:Point}
interface SocketRequest {key:string;endpoint:Endpoint;preferred:Point}
const socketKey=(link:Link,endpoint:Endpoint)=>JSON.stringify([link.id,endpoint.deviceId,endpoint.port]);
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));

/** An open, rounded track around the icon. The bottom stays clear of its caption. */
function socketTrack(count:number) {
  const side=46,top=56,radius=8,arc=Math.PI*radius/2,length=2*side+top+2*arc,gap=14;
  const scale=Math.max(1,(count-1)*gap/length);
  const at=(distance:number):Socket=>{
    let s=clamp(distance/scale,0,length),point:Point,outward:Point;
    if(s<=side){point={x:-36,y:22-s};outward={x:-1,y:0};}
    else if((s-=side)<=arc){const angle=Math.PI+s/radius;outward={x:Math.cos(angle),y:Math.sin(angle)};point=add({x:-28,y:-24},outward,radius);}
    else if((s-=arc)<=top){point={x:-28+s,y:-32};outward={x:0,y:-1};}
    else if((s-=top)<=arc){const angle=-Math.PI/2+s/radius;outward={x:Math.cos(angle),y:Math.sin(angle)};point=add({x:28,y:-24},outward,radius);}
    else{point={x:36,y:-24+s-arc};outward={x:1,y:0};}
    return{point:{x:point.x*scale,y:22+(point.y-22)*scale},outward};
  };
  const project=(point:Point)=>{
    const p={x:point.x/scale,y:22+(point.y-22)/scale};
    const leftAngle=clamp((Math.atan2(p.y+24,p.x+28)+2*Math.PI)%(2*Math.PI),Math.PI,Math.PI*1.5);
    const rightAngle=clamp(Math.atan2(p.y+24,p.x-28),-Math.PI/2,0);
    const candidates=[clamp(22-p.y,0,side),side+(leftAngle-Math.PI)*radius,side+arc+clamp(p.x+28,0,top),side+arc+top+(rightAngle+Math.PI/2)*radius,side+2*arc+top+clamp(p.y+24,0,side)];
    return candidates.map(s=>({s:s*scale,point:at(s*scale).point})).sort((a,b)=>Math.hypot(a.point.x-point.x,a.point.y-point.y)-Math.hypot(b.point.x-point.x,b.point.y-point.y)||a.s-b.s)[0].s;
  };
  return{at,project,length:length*scale,gap};
}

/** Pack every neighbor's sockets together, preserving their order along the icon. */
function allocateSockets(nodes:Map<string,LayoutNode>,requests:SocketRequest[]):Map<string,Socket> {
  const result=new Map<string,Socket>(),byNode=new Map<string,SocketRequest[]>();
  for(const request of requests){const id=request.endpoint.deviceId;if(!byNode.has(id))byNode.set(id,[]);byNode.get(id)!.push(request);}
  for(const[id,local]of byNode){
    const node=nodes.get(id)!,track=socketTrack(local.length);
    const ordered=local.map(request=>({...request,target:track.project({x:request.preferred.x-node.x,y:request.preferred.y-node.y})})).sort((a,b)=>a.target-b.target||a.endpoint.port.localeCompare(b.endpoint.port,undefined,{numeric:true})||a.key.localeCompare(b.key));
    // Isotonic packing minimizes displacement while enforcing a gap between ALL
    // endpoints, rather than only the parallel cables in a single device pair.
    const blocks:{first:number;last:number;sum:number;count:number}[]=[];
    ordered.forEach((request,index)=>{
      blocks.push({first:index,last:index,sum:request.target-index*track.gap,count:1});
      while(blocks.length>1){const b=blocks.at(-1)!,a=blocks.at(-2)!;if(a.sum/a.count<=b.sum/b.count)break;blocks.splice(-2,2,{first:a.first,last:b.last,sum:a.sum+b.sum,count:a.count+b.count});}
    });
    const available=Math.max(0,track.length-(ordered.length-1)*track.gap);
    for(const block of blocks){const offset=clamp(block.sum/block.count,0,available);for(let i=block.first;i<=block.last;i++){const socket=track.at(offset+i*track.gap);result.set(ordered[i].key,{...socket,point:add(node,socket.point)});}}
  }
  return result;
}

/** Deterministic, orientation-independent lanes, with labels laid out in world coordinates. */
export function layoutLinks(nodes:readonly LayoutNode[],links:readonly Link[],obstacles:readonly LayoutBox[]=[]):LinkLayout[] {
  const byId=new Map(nodes.map(n=>[n.id,n])),groups=new Map<string,Link[]>(),reserved:LayoutBox[]=[...nodes.map(nodeBox),...obstacles];
  for(const link of links){if(!byId.has(link.a.deviceId)||!byId.has(link.b.deviceId))continue;const key=pairKey(link.a.deviceId,link.b.deviceId);if(!groups.has(key))groups.set(key,orderedPairLinks(links,link.a.deviceId,link.b.deviceId));}
  const requests:SocketRequest[]=[];
  const prepared: {link:Link;index:number;count:number;ends:Endpoint[];a:LayoutNode;b:LayoutNode;length:number;direction:Point;normal:Point;spread:number}[]=[];
  for(const key of [...groups.keys()].sort()) {
    const group=groups.get(key)!;
    group.forEach((link,index)=>{
      const ends=[link.a,link.b].sort((a,b)=>a.deviceId.localeCompare(b.deviceId)),a=byId.get(ends[0].deviceId)!,b=byId.get(ends[1].deviceId)!;
      const delta={x:b.x-a.x,y:b.y-a.y},length=Math.hypot(delta.x,delta.y),direction=length>1?unit(delta):{x:1,y:0},normal={x:-direction.y,y:direction.x};
      const lane=index-(group.length-1)/2,spacing=38+Math.abs(normal.x)*38,spread=lane*spacing,fan=group.length===1?0:lane/Math.max(1,(group.length-1)/2)*20;
      // Preferred positions retain the pair's fan-out. The global pass below
      // separates them from every other neighbor and keeps captions clear.
      const preferredSocket=(node:LayoutNode,toward:Point,shift:number):Point=>{
        if(toward.y>.65){const side=Math.sign(normal.x*shift)||Math.sign(toward.x)||1;return{x:node.x+side*34,y:node.y+8+Math.abs(shift)*.5};}
        const distance=1/Math.max(Math.abs(toward.x)/34,Math.abs(toward.y)/29);
        const p=add(add(node,toward,distance),normal,shift);
        return{x:Math.max(node.x-36,Math.min(node.x+36,p.x)),y:Math.max(node.y-29,Math.min(node.y+26,p.y))};
      };
      requests.push({key:socketKey(link,ends[0]),endpoint:ends[0],preferred:preferredSocket(a,direction,fan)},{key:socketKey(link,ends[1]),endpoint:ends[1],preferred:preferredSocket(b,{x:-direction.x,y:-direction.y},fan)});
      prepared.push({link,index,count:group.length,ends,a,b,length,direction,normal,spread});
    });
  }
  const sockets=allocateSockets(byId,requests),result:LinkLayout[]=[];
  // Reserve all sockets before placing any labels, including other device pairs.
  for(const socket of sockets.values())reserved.push({...socket.point,width:12,height:12});
  for(const{link,index,count,ends,a,b,length,direction,normal,spread}of prepared){
      const firstSocket=sockets.get(socketKey(link,ends[0]))!,secondSocket=sockets.get(socketKey(link,ends[1]))!,start=firstSocket.point,end=secondSocket.point,reach=Math.max(65,length*.3);
      let c1=add(add(a,direction,reach),normal,spread*1.38),c2=add(add(b,direction,-reach),normal,spread*1.38);
      if(direction.y>.65)c1.x=a.x+Math.sign(start.x-a.x)*Math.max(85,Math.abs(c1.x-a.x));
      if(direction.y<-.65)c2.x=b.x+Math.sign(end.x-b.x)*Math.max(85,Math.abs(c2.x-b.x));
      if(length<100){c1=add(c1,normal,80);c2=add(c2,normal,80);}
      const exit=(control:Point,socket:Socket)=>{const projection=(control.x-socket.point.x)*socket.outward.x+(control.y-socket.point.y)*socket.outward.y;return add(control,socket.outward,Math.max(0,48-projection));};
      c1=exit(c1,firstSocket);c2=exit(c2,secondSocket);
      const samples=Array.from({length:65},(_,i)=>cubic(start,c1,c2,end,i/64));
      const distances=[0];for(let i=1;i<samples.length;i++)distances.push(distances[i-1]+Math.hypot(samples[i].x-samples[i-1].x,samples[i].y-samples[i-1].y));
      const total=distances.at(-1)!;
      const place=(endpoint:Endpoint,fromStart:boolean):PortLabel=>{
        const text=shortInterface(endpoint.port),width=Math.max(48,text.length*6.6+14),height=22;
        let best:{label:PortLabel;cost:number;collisions:number}|undefined;
        const anchors:{anchor:Point;perpendicular:Point;fraction:number}[]=[];
        const consider=(anchor:Point,perpendicular:Point,fraction:number,offset:number)=>{
          const center=add(anchor,perpendicular,offset),label={...center,width,height,text,endpoint,anchor};
          const collisions=reserved.reduce((n,box)=>n+Number(overlap(label,box)),0);
          const cost=collisions*100000+Math.abs(offset)+Math.abs(fraction-.18)*100;
          if(!best||collisions<best.collisions||collisions===best.collisions&&cost<best.cost)best={label,cost,collisions};
        };
        for(const fraction of [.18,.25,.33,.4]){
          const target=fromStart?total*fraction:total*(1-fraction);
          let i=distances.findIndex(d=>d>=target);if(i<0)i=64;
          const anchor=samples[i],previous=samples[Math.max(0,i-1)],next=samples[Math.min(64,i+1)],tangent=unit({x:next.x-previous.x,y:next.y-previous.y});
          const perpendicular=tangent.x||tangent.y?{x:-tangent.y,y:tangent.x}:normal;
          anchors.push({anchor,perpendicular,fraction});
          for(const offset of [0,-28,28,-56,56,-84,84,-112,112,-154,154,-210,210])consider(anchor,perpendicular,fraction,offset);
        }
        // A crowded bundle must not silently accept a colliding last candidate.
        for(let offset=238;best!.collisions>0;offset+=28)for(const{anchor,perpendicular,fraction}of anchors){consider(anchor,perpendicular,fraction,-offset);consider(anchor,perpendicular,fraction,offset);}
        const label=best!.label;reserved.push(label);return label;
      };
      const first=place(ends[0],true),second=place(ends[1],false),labels:[PortLabel,PortLabel]=link.a.deviceId===ends[0].deviceId?[first,second]:[second,first];
      const xs=[...samples.map(p=>p.x),...labels.flatMap(l=>[l.x-l.width/2,l.x+l.width/2])],ys=[...samples.map(p=>p.y),...labels.flatMap(l=>[l.y-l.height/2,l.y+l.height/2])],left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
      result.push({id:link.id,path:`M${coords(start)} C${coords(c1)} ${coords(c2)} ${coords(end)}`,start:link.a.deviceId===ends[0].deviceId?start:end,end:link.a.deviceId===ends[0].deviceId?end:start,middle:samples[32],labels,index,count,bounds:{x:(left+right)/2,y:(top+bottom)/2,width:right-left,height:bottom-top}});
  }
  return result;
}
