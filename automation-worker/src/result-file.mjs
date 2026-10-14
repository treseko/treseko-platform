import fs from 'node:fs';
// The unprivileged script must not trick the coordinator into reading another
// file through a symlink or hard link when collecting its return value.
export function readResultFile(file){
 if(!fs.existsSync(file))return {};
 if(fs.lstatSync(file).isSymbolicLink())throw new Error('Unsafe linked result file');
 const descriptor=fs.openSync(file,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
 try{
  const stat=fs.fstatSync(descriptor);
  if(!stat.isFile() || stat.nlink!==1)throw new Error('Unsafe linked result file');
  return JSON.parse(fs.readFileSync(descriptor,'utf8'));
 }finally{fs.closeSync(descriptor);}
}
