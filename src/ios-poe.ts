import type {Simulator}from'./engine.ts';import type{Device,InterfaceConfig}from'./model.ts';import{poePort,powerInlineOutput}from'./poe.ts';
interface Host{engine:Simulator;device:Device;context:{mode:string};ports():InterfaceConfig[];interfaceName(name:string):string;changed():void;fail(message?:string):never}
export function poeCommands(h:Host){
 const commands:Array<{words:string[];description:string;args?:string;nativeOutput:boolean;run(a:string[],no:boolean):void|string[]}>=[];
 if(h.device.kind!=='poeswitch')return commands;
 if(['user','priv'].includes(h.context.mode))commands.push({words:['show','power','inline'],description:'Inspect actual PoE allocations and remaining budget',args:'[priority] [interface] [detail]',nativeOutput:true,run:a=>{const args=[...a];let priority=false,detail=false;if(args[0]&&'priority'.startsWith(args[0].toLowerCase())){priority=true;args.shift();}if(args.at(-1)&&'detail'.startsWith(args.at(-1)!.toLowerCase())){detail=true;args.pop();}if(args.length>1)h.fail();const port=args[0]&&h.interfaceName(args[0]);if(port&&!poePort(port))h.fail('% This interface does not support inline power.');return powerInlineOutput(h.engine,h.device,port,priority,detail);}});
 if(['interface','range'].includes(h.context.mode))commands.push({words:['power','inline'],description:'Configure 802.3at inline power',args:'auto [max <4000-30000>]|never|port priority high|low',nativeOutput:true,run:(a,no)=>{
  const ports=h.ports();if(ports.some(p=>!poePort(p.name)))h.fail('% Inline power is available on GigabitEthernet0/1 through 0/24.');
  if(a[0]&&'port'.startsWith(a[0].toLowerCase())){if(a.length!==3||!'priority'.startsWith(a[1].toLowerCase()))h.fail('% Use power inline port priority high|low.');const choices=['high','low'].filter(x=>x.startsWith(a[2].toLowerCase()));if(choices.length!==1)h.fail();for(const p of ports){if(no)delete p.features.powerPriority;else p.features.powerPriority=choices[0];}h.changed();return;}
  if(no){if(a.length>1||a.length===1&&!['auto','never'].includes(a[0]))h.fail();for(const p of ports)delete p.features.powerInline;h.changed();return;}
  if(!a.length)h.fail('% Incomplete command.');const choices=['auto','never'].filter(x=>x.startsWith(a[0].toLowerCase()));if(choices.length!==1)h.fail();const mode=choices[0];let max=30000;
  if(mode==='never'&&a.length!==1)h.fail();if(mode==='auto'&&a.length>1){if(a.length!==3||!'max'.startsWith(a[1].toLowerCase())||!/^\d+$/.test(a[2])||+a[2]<4000||+a[2]>30000)h.fail('% Use power inline auto max 4000–30000 (milliwatts).');max=+a[2];}
  for(const p of ports)p.features.powerInline={mode,max};h.changed();
 }});
 return commands;
}
