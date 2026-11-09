#!/usr/bin/env python3
"""Isolated PostgreSQL/artifact/rollback rehearsal using synthetic data only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import time
import uuid

parser=argparse.ArgumentParser()
parser.add_argument('--image',default='postgres:17-alpine')
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
def command(argv,**kwargs):
    result=subprocess.run(argv,capture_output=True,**kwargs)
    if result.returncode:
        error=result.stderr.decode(errors='replace') if isinstance(result.stderr,bytes) else result.stderr
        raise RuntimeError(error)
    return result.stdout
image=command(['docker','image','inspect',args.image,'--format','{{.Id}}'],text=True).strip()
containers=[]
def start(suffix):
    name='aski-rehearsal-'+uuid.uuid4().hex[:12]+'-'+suffix
    identity=command(['docker','run','-d','--name',name,'--network','none','--memory','512m','--cpus','1','--pids-limit','128',
                      '--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image],text=True).strip()
    containers.append(identity)
    deadline=time.monotonic()+30
    while time.monotonic()<deadline:
        process=subprocess.run(['docker','exec',identity,'cat','/proc/1/comm'],capture_output=True,text=True)
        if process.stdout.strip()=='postgres' and subprocess.run(['docker','exec',identity,'pg_isready','-U','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:return identity
        time.sleep(.2)
    raise RuntimeError('Synthetic PostgreSQL did not become ready')
def sql(container,statement):
    return command(['docker','exec','-i',container,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],input=statement,text=True).strip()
result={}
try:
    with tempfile.TemporaryDirectory(prefix='aski-recovery-') as folder:
        root=Path(folder)
        (root/'runtime.env').write_text('NODE_ENV=production\n')
        (root/'pg-password').write_text('synthetic-only\n')
        environment=os.environ.copy()
        environment.update({'ASKI_WEB_IMAGE':image,'ASKI_API_IMAGE':image,'ASKI_PG_IMAGE':image,
                            'ASKI_BIND_IP':'127.0.0.1','ASKI_HTTP_PORT':'3095','ASKI_ENV_FILE':str(root/'runtime.env'),
                            'ASKI_ARTIFACT_ROOT':str(root/'artifacts'),'ASKI_DATABASE_ROOT':str(root/'postgres'),
                            'ASKI_PG_PASSWORD_FILE':str(root/'pg-password')})
        command(['docker','compose','-f',str(Path(__file__).with_name('compose.release.yml')),'config','--quiet'],env=environment,text=True)
        source=start('source')
        sql(source,"CREATE TABLE library (id int PRIMARY KEY, owner text NOT NULL, payload jsonb NOT NULL); INSERT INTO library VALUES (1,'synthetic-a','{\"input\":\"ASKI\"}'),(2,'synthetic-b','{\"input\":\"SECOND\"}');")
        artifact=b'synthetic ASKI artifact\n'
        digest=hashlib.sha256(artifact).hexdigest()
        sql(source,f"CREATE TABLE artifacts (hash text PRIMARY KEY, owner text NOT NULL); INSERT INTO artifacts VALUES ('{digest}','synthetic-a');")
        expected=sql(source,'SELECT id,owner,payload FROM library ORDER BY id;')
        # Writers are quiesced throughout this bounded dump and artifact snapshot.
        dump=command(['docker','exec',source,'pg_dump','-U','postgres','-d','postgres','-Fc','--no-owner','--no-acl'])
        (root/'database.dump').write_bytes(dump)
        (root/'artifact.bin').write_bytes(artifact)
        manifest={'database':hashlib.sha256(dump).hexdigest(),'artifact':digest}
        assert hashlib.sha256((root/'database.dump').read_bytes()).hexdigest()==manifest['database']
        corrupted=artifact+b'corrupt'
        corruption_rejected=hashlib.sha256(corrupted).hexdigest()!=manifest['artifact']
        assert corruption_rejected
        restored=start('restore')
        command(['docker','exec','-i',restored,'pg_restore','-U','postgres','-d','postgres','--exit-on-error','--no-owner','--no-acl'],input=dump)
        assert sql(restored,'SELECT id,owner,payload FROM library ORDER BY id;')==expected
        restored_artifacts=root/'restored-artifacts';restored_artifacts.mkdir()
        shutil.copyfile(root/'artifact.bin',restored_artifacts/digest)
        assert sql(restored,'SELECT hash FROM artifacts;')==hashlib.sha256((restored_artifacts/digest).read_bytes()).hexdigest()
        # Reapply a synthetic account deletion before a restored service opens readiness.
        sql(restored,"DELETE FROM library WHERE owner='synthetic-b';")
        assert sql(restored,"SELECT count(*) FROM library WHERE owner='synthetic-b';")=='0'
        assert sql(restored,"SELECT count(*) FROM library WHERE owner='synthetic-a';")=='1'
        releases=root/'releases';releases.mkdir()
        for version in ['v1','v2']:
            (releases/version).mkdir();(releases/version/'build.json').write_text(json.dumps({'build':version}))
        current=root/'current';current.symlink_to(releases/'v1',target_is_directory=True)
        candidate=root/'candidate';candidate.symlink_to(releases/'v2',target_is_directory=True);candidate.replace(current)
        assert json.loads((current/'build.json').read_text())['build']=='v2'
        candidate.symlink_to(releases/'v1',target_is_directory=True);candidate.replace(current)
        assert json.loads((current/'build.json').read_text())['build']=='v1'
        result={'schemaVersion':1,'observedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'postgresImageId':image,
                'composeSyntaxOnly':True,'sourceRows':2,'restoredRowsBeforeDeletion':2,'remainingRowsAfterDeletion':1,'artifactSha256':digest,
                'databaseDumpSha256':manifest['database'],'restoreMatches':True,'artifactMatches':True,
                'corruptionRejected':True,'deletionJournalApplied':True,'rollbackMatches':True,
                'limits':'Synthetic quiesced data and release-pointer rollback. No live application, mail, credentials, ingress, encrypted off-host restore, migrations or production rollback tested.'}
finally:
    for identity in containers:
        subprocess.run(['docker','rm','-f',identity],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
if result:
    result['containersRemoved']=all(subprocess.run(['docker','inspect',identity],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0 for identity in containers)
    assert result['containersRemoved']
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))
