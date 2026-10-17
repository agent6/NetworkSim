#!/usr/bin/env python3
"""Source-index every command heading in pinned official Catalyst chapters.
Names/links are factual index metadata; no vendor implementation or prose copied.
This is a candidate inventory, never a count of implemented or required commands.
"""
from pathlib import Path
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor
import urllib.request,urllib.parse,json,re,hashlib,datetime
base='https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-12/command_reference/b_1712_9300_cr/'
tocURL=base+'interface_and_hardware_commands.html'
toc=urllib.request.urlopen(tocURL,timeout=30).read().decode()
chapters=sorted({urllib.parse.urlparse(urllib.parse.urljoin(tocURL,href)).path.rsplit('/',1)[-1][:-5] for href in re.findall(r'href=[\"\']([^\"\']+)[\"\']',toc) if urllib.parse.urljoin(tocURL,href).startswith(base) and urllib.parse.urlparse(urllib.parse.urljoin(tocURL,href)).path.endswith('.html')})
assert len(chapters)>=8,'Official chapter discovery unexpectedly incomplete'
cache=Path('.cache/fidelity/references');cache.mkdir(parents=True,exist_ok=True)
class Titles(HTMLParser):
 def __init__(self):super().__init__();self.current=None;self.depth=0;self.rows=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='h2' and 'topictitle2' in a.get('class',''):self.current={'command':'','anchor':a.get('id','')};self.depth=1
  elif self.current:self.depth+=1
 def handle_data(self,text):
  if self.current:self.current['command']+=text
 def handle_endtag(self,tag):
  if self.current:
   self.depth-=1
   if self.depth==0:self.current['command']=re.sub(r'\s+',' ',self.current['command']).strip();self.rows.append(self.current);self.current=None

def get(chapter):
 p=cache/('c9300-'+chapter+'-17.12.html');url=base+chapter+'.html'
 if not p.exists():p.write_bytes(urllib.request.urlopen(url,timeout=30).read())
 raw=p.read_bytes();parser=Titles();parser.feed(raw.decode());return chapter,url,hashlib.sha256(raw).hexdigest(),parser.rows
current=json.loads(Path('docs/audits/coverage-inventory.json').read_text());paths=sorted({r['command'] for r in current['commands'] if r['node'] in ['switch','l3switch','poeswitch']});objectives=json.loads(Path('docs/audits/exam-objective-coverage.json').read_text())['objectives'];rows=[];sources=[]
with ThreadPoolExecutor(max_workers=4)as pool:
 for chapter,url,digest,titles in pool.map(get,chapters):
  sources.append({'url':url,'sha256':digest,'commandHeadings':len(titles)})
  for title in titles:
   name=title['command'];canonical=re.sub(r'\s*\([^)]*\)','',name).strip().lower();exact=[p for p in paths if p.lower()==canonical];prefix=[p for p in paths if len(p.split())>=2 and (canonical.startswith(p.lower()+' ') or p.lower().startswith(canonical+' '))]
   links=[{'exam':o['exam'],'id':o['id'],'competency':o['competency']}for o in objectives if o['leaf'] and any(c.lower()==canonical or len(c.split())>=2 and canonical.startswith(c.lower()+' ') for c in o['commands'])]
   rows.append({'profile':'catalyst-9300-ios-xe-17.12','commandHeading':name,'reference':url+('#'+title['anchor']if title['anchor']else''),'sourceDigest':digest,'registryCandidates':exact or prefix,'registryMatch':'exact registration'if exact else'prefix handler candidate'if prefix else'no registry match','objectiveCandidates':links,'applicability':'objective-family candidate; per-option/platform verification pending'if links else'additional platform candidate; exam applicability not established','status':'unverified-reference-candidate','notes':'A generic parent handler may reject this subcommand. Neither title presence nor a lexical match establishes support, required exam scope or behavioral equivalence.'})
result={'schemaVersion':1,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':'Automatic extraction of all topictitle2 command headings from all automatically discovered pinned official Catalyst 9300 17.12 command-reference chapters; lexical source-registry and objective-family joins are candidates only. Router and wireless release-specific catalogs still require separate completion. Arguments, no forms and full command semantics are not inferred from headings.','sources':sources,'counts':{'chapters':len(sources),'headings':len(rows),'distinctHeadings':len({r['commandHeading']for r in rows}),'exactRegistryMatches':sum(r['registryMatch']=='exact registration'for r in rows),'prefixHandlerCandidates':sum(r['registryMatch']=='prefix handler candidate'for r in rows),'withoutRegistryMatch':sum(r['registryMatch']=='no registry match'for r in rows),'objectiveCandidates':sum(bool(r['objectiveCandidates'])for r in rows)},'commands':rows}
Path('docs/audits/reference-command-inventory.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result['counts'],indent=2))
