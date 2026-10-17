import type{Device,DeviceConfig,DeviceKind}from'./model.ts';
export type HostOS='windows'|'linux'|'macos';
export function hostOSProfile(device:Device):HostOS{return device.kind==='server'?'windows':['linux','macos'].includes(device.config.features.hostOS)?device.config.features.hostOS:'windows';}
export function validateHostOS(kind:DeviceKind,config:DeviceConfig):void{const value=config.features.hostOS;if(value===undefined)return;if(!['windows','linux','macos'].includes(value)||!['pc','laptop','server'].includes(kind)||kind==='server'&&value!=='windows')throw Error('Invalid host operating-system profile.');}
