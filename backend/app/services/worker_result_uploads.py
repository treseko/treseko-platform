"""Durable, resumable result transfer; ACK only after exact byte verification."""
import hashlib
import json
import os
import shutil
from pathlib import Path
from uuid import UUID, uuid4


class ResultUploadStore:
    def __init__(self, root):
        self.root=Path(root)
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        if self.root.is_symlink():raise ValueError('Unsafe result upload directory')

    def paths(self, job_id, event_id):
        job_id,event_id=UUID(str(job_id)),UUID(str(event_id))
        directory=self.root/str(job_id)
        directory.mkdir(exist_ok=True,mode=0o700)
        if directory.is_symlink():raise ValueError('Unsafe result upload directory')
        data=directory/f'{event_id}.payload'
        manifest=directory/f'{event_id}.json'
        if data.is_symlink() or manifest.is_symlink():raise ValueError('Unsafe result upload file')
        return data,manifest

    def reserve(self, additional_bytes):
        reserve=max(0,int(os.getenv('AUTOMATION_EVIDENCE_DISK_RESERVE_MB','512')))*1024*1024
        if shutil.disk_usage(self.root).free < additional_bytes+reserve:
            raise OSError('No hay espacio para conservar la evidencia completa; la entrega debe reintentarse')

    def begin(self, job_id,event_id,total_bytes,sha256):
        if total_bytes<1 or len(sha256)!=64 or any(char not in '0123456789abcdef' for char in sha256):raise ValueError('Invalid result checksum or size')
        data,manifest=self.paths(job_id,event_id)
        self.reserve(max(0,total_bytes-(data.stat().st_size if data.exists() else 0))+total_bytes)
        if manifest.exists():
            stored=json.loads(manifest.read_text())
            if stored!={'bytes':total_bytes,'sha256':sha256}:raise ValueError('Result event already identifies different evidence')
        else:
            temporary=manifest.with_name(f'.{manifest.name}.{uuid4()}.tmp')
            with temporary.open('x') as output:
                os.chmod(temporary,0o600);json.dump({'bytes':total_bytes,'sha256':sha256},output);output.flush();os.fsync(output.fileno())
            os.replace(temporary,manifest)
            directory_fd=os.open(manifest.parent,os.O_RDONLY)
            try:os.fsync(directory_fd)
            finally:os.close(directory_fd)
        if not data.exists():
            with data.open('xb') as output:os.chmod(data,0o600);output.flush();os.fsync(output.fileno())
        return {'offset':data.stat().st_size,'bytes':total_bytes}

    def append(self,job_id,event_id,offset,chunk):
        data,manifest=self.paths(job_id,event_id)
        stored=json.loads(manifest.read_text())
        if len(chunk)>1024*1024 or not chunk:raise ValueError('Result chunk exceeds the transport limit')
        if data.stat().st_size!=offset or offset+len(chunk)>stored['bytes']:raise ValueError('Result upload offset does not match')
        self.reserve(len(chunk))
        with data.open('ab') as output:output.write(chunk);output.flush();os.fsync(output.fileno())
        return {'offset':data.stat().st_size,'bytes':stored['bytes']}

    def read_complete(self,job_id,event_id):
        data,manifest=self.paths(job_id,event_id)
        stored=json.loads(manifest.read_text())
        if data.stat().st_size!=stored['bytes']:raise ValueError('Result evidence is incomplete')
        digest=hashlib.sha256()
        with data.open('rb') as source:
            while chunk:=source.read(1024*1024):digest.update(chunk)
        if digest.hexdigest()!=stored['sha256']:raise ValueError('Result evidence checksum mismatch')
        return data.read_bytes()


    def save_evidence(self,job_id,event_id,value):
        data,_=self.paths(job_id,event_id)
        file=data.with_suffix('.evidence.json')
        if file.is_symlink():raise ValueError('Unsafe evidence archive')
        if file.exists():
            if json.loads(file.read_text())!=value:raise ValueError('Result event already identifies different evidence')
            return file
        encoded=json.dumps(value,ensure_ascii=False,allow_nan=False).encode()
        self.reserve(len(encoded))
        temporary=file.with_name(f'.{file.name}.{uuid4()}.tmp')
        with temporary.open('xb') as output:
            os.chmod(temporary,0o600);output.write(encoded);output.flush();os.fsync(output.fileno())
        os.replace(temporary,file)
        directory=os.open(file.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
        return file
