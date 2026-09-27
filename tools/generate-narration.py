"""Generate the disclosed demo narration using an existing Gemini API key.

Set GEMINI_API_KEY in the process environment. The key is sent only in an HTTPS
header to Google and is never saved to an artifact or printed. Requests are
sequential; provider throttles stop the run rather than silently changing models.
"""
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import base64, hashlib, io, json, os, sys, time, wave

root=Path(__file__).resolve().parents[1]
config=json.loads((root/'artifacts/narration/script.json').read_text())
key=os.environ.get('GEMINI_API_KEY')
if not key:
    raise SystemExit('Set GEMINI_API_KEY in your environment; do not add it to this repository.')
out=root/'artifacts/narration'
out.mkdir(parents=True,exist_ok=True)
for index,text in enumerate(config['segments']):
    name=f'{config["project"]}-{index:02}'
    target=out/(name+'.wav')
    metadata_path=out/(name+'.json')
    if target.exists() and metadata_path.exists():
        metadata=json.loads(metadata_path.read_text())
        if metadata.get('text')==text and metadata.get('model')==config['model'] and metadata.get('sha256')==hashlib.sha256(target.read_bytes()).hexdigest():
            print(f'{name}: verified cached narration'); continue
    payload={'model':config['model'],'input':[{'type':'user_input','content':[{'type':'text','text':text,'annotations':[{'type':'speech_metadata','style':config['style']}]}]}],'response_format':{'type':'audio'},'generation_config':{'speech_config':[{'voice':config['voice']}]}}
    req=Request('https://generativelanguage.googleapis.com/v1beta/interactions',data=json.dumps(payload).encode(),headers={'x-goog-api-key':key,'Content-Type':'application/json'})
    try:
        with urlopen(req,timeout=150) as response: result=json.load(response)
    except HTTPError as error:
        raise SystemExit(f'Gemini returned HTTP {error.code}; Retry-After: {error.headers.get("Retry-After", "unspecified")}. No automatic retry or billing change.') from None
    audio=[c for s in result.get('steps',[]) if s.get('type')=='model_output' for c in s.get('content',[]) if c.get('type')=='audio']
    if not audio: raise SystemExit('No audio returned; generation was not marked successful.')
    data=base64.b64decode(audio[-1]['data'],validate=True)
    with wave.open(io.BytesIO(data),'rb') as source:
        seconds=source.getnframes()/source.getframerate(); sample_rate=source.getframerate()
    if seconds<0.8: raise SystemExit('Unexpectedly short audio; inspect the provider result.')
    target.write_bytes(data)
    metadata={'provider':'Google Gemini API','model':config['model'],'voice':config['voice'],'style':config['style'],'text':text,'seconds':seconds,'sample_rate':sample_rate,'sha256':hashlib.sha256(data).hexdigest(),'synthetic':True,'created_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    metadata_path.write_text(json.dumps(metadata,indent=2)+'\n')
    print(f'{name}: {seconds:.2f}s of genuine Gemini output')
    time.sleep(16)
