import type { Simulator } from './engine.ts';
import type { Device } from './model.ts';
import { formatIOSL2Show } from './ios-show-l2.ts';

/** Display only local configuration and observed state; unknown branches defer to the base formatter. */
export function formatIOSSwitchingShow(e:Simulator,d:Device,topic:string,input:readonly string[]):string[]|undefined {
  return formatIOSL2Show(e,d,topic,input);
}
