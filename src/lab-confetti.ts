const COLORS=['#2563EB','#60A5FA','#FBBF24','#34D399','#A78BFA'];
let stopActive:(()=>void)|undefined;

/** A short, offline, decorative effect. It never takes focus or catches input. */
export function celebrateLabCompletion():void {
  stopActive?.();
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches) return;
  const layer=document.createElement('div');
  layer.className='lab-confetti';
  layer.setAttribute('aria-hidden','true');
  layer.inert=true;
  const pieces=document.createDocumentFragment(),count=innerWidth<600?48:72;
  for(let i=0;i<count;i++){
    const piece=document.createElement('span');
    piece.className='lab-confetti-piece';
    piece.style.left=(Math.random()*100)+'%';
    piece.style.backgroundColor=COLORS[i%COLORS.length];
    piece.style.width=(5+Math.random()*4)+'px';
    piece.style.height=(7+Math.random()*6)+'px';
    piece.style.setProperty('--confetti-drift',(Math.random()*240-120)+'px');
    piece.style.setProperty('--confetti-spin',(Math.random()*1080-540)+'deg');
    piece.style.setProperty('--confetti-duration',(1800+Math.random()*900)+'ms');
    piece.style.setProperty('--confetti-delay',(Math.random()*150)+'ms');
    pieces.append(piece);
  }
  layer.append(pieces);document.body.append(layer);
  const stop=()=>{window.clearTimeout(timer);motion.removeEventListener('change',onMotionChange);layer.remove();if(stopActive===stop)stopActive=undefined;};
  const onMotionChange=()=>{if(motion.matches)stop();};
  const timer=window.setTimeout(stop,3000);
  motion.addEventListener('change',onMotionChange);
  stopActive=stop;
}
