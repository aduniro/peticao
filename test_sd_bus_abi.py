"""Exercise ctypes against a compiled local ABI shim, NEVER the system bus."""
import ctypes
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

import unit_refs as refs

HERE=Path(__file__).parent
SHIM=r'''
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <stdint.h>
#include <sys/socket.h>
#include <unistd.h>
typedef struct { int fd[2]; } Bus;
typedef struct { const char *sender; const char *value; } Message;
typedef struct { const char *name; const char *message; int need_free; } Error;
static int count=0, changed=0;
int abi_count(void){return count;}
void abi_change_owner(void){changed=1;}
int sd_bus_open_system(Bus **out){
 Bus *b=calloc(1,sizeof(Bus)); if(!b)return -12;
 if(socketpair(AF_UNIX,SOCK_STREAM,0,b->fd)<0){free(b);return -5;}
 *out=b;count=0;changed=0;return 0;
}
int sd_bus_set_method_call_timeout(Bus *b,uint64_t u){return b && u==10000000?0:-22;}
int sd_bus_get_unique_name(Bus *b,const char **out){if(!b)return -22;*out=":1.333";return 0;}
int sd_bus_get_fd(Bus *b){return b?b->fd[0]:-22;}
int sd_bus_call_method(Bus *b,const char *dst,const char *path,const char *iface,
 const char *member,Error *error,Message **out,const char *types,...){
 if(!b || !dst || !path || !iface || !member || !types || !error || !out)return -22;
 Message *m=calloc(1,sizeof(Message));if(!m)return -12;
 m->sender=changed?":1.9":":1.0";
 if(strcmp(member,"GetNameOwner")==0){
  va_list ap;va_start(ap,types);const char *arg=va_arg(ap,const char*);va_end(ap);
  if(strcmp(types,"s") || strcmp(arg,"org.freedesktop.systemd1")){free(m);return -22;}
  m->sender="org.freedesktop.DBus";m->value=":1.0";
 }else if(strcmp(member,"Ping")==0){
  if(strcmp(types,"") || strcmp(dst,":1.0")){free(m);return -22;}
 }else if(strcmp(member,"RefUnit")==0 || strcmp(member,"UnrefUnit")==0){
  va_list ap;va_start(ap,types);const char *arg=va_arg(ap,const char*);va_end(ap);
  if(strcmp(types,"s") || !arg || strncmp(arg,"admin-dev-",10) || strcmp(dst,":1.0")){free(m);return -22;}
  count+=strcmp(member,"RefUnit")==0?1:-1;
 }else{free(m);return -22;}
 *out=m;return 1;
}
int sd_bus_message_read(Message *m,const char *types,...){
 if(!m || !m->value || strcmp(types,"s"))return -22;
 va_list ap;va_start(ap,types);const char **out=va_arg(ap,const char**);va_end(ap);
 *out=m->value;return 2; /* ABI allows a positive success value. */
}
const char *sd_bus_message_get_sender(Message *m){return m?m->sender:NULL;}
Message *sd_bus_message_unref(Message *m){free(m);return NULL;}
void sd_bus_error_free(Error *e){(void)e;}
void sd_bus_close(Bus *b){if(b){close(b->fd[0]);close(b->fd[1]);}}
Bus *sd_bus_unref(Bus *b){free(b);return NULL;}
'''


class NativeABI(unittest.TestCase):
    def test_pointer_varargs_sender_and_reference_lifecycle_on_local_shim(self):
        # Only a local socketpair is created. Patching euid does not grant OS
        # privileges and is never included in the real host helper packet.
        with tempfile.TemporaryDirectory(prefix='abi-fixture-',dir=HERE) as tmp:
            root=Path(tmp);source=root/'shim.c';source.write_text(SHIM);library=root/'shim.so'
            r=subprocess.run(['/usr/bin/cc','-pipe','-shared','-fPIC','-Wall','-Wextra','-Werror',str(source),'-o',str(library)],
                capture_output=True,timeout=30,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TMPDIR':str(root)})
            self.assertEqual(r.returncode,0,r.stderr.decode(errors='replace'))
            native=ctypes.CDLL(str(library));native.abi_count.restype=ctypes.c_int
            with mock.patch.object(refs.C,'CDLL',return_value=native),mock.patch.object(refs.os,'geteuid',return_value=0):
                holder=refs.UnitReferences()
            unit='admin-dev-'+'a'*32+'-g1.service';inv='b'*32
            self.assertEqual(holder.bus.manager,':1.0')
            holder.acquire(unit,inv);self.assertEqual(native.abi_count(),1)
            holder.assert_held(unit,inv)
            holder.release(unit,inv);self.assertEqual(native.abi_count(),0)
            holder.close();self.assertTrue(holder.closed)
            with mock.patch.object(refs.C,'CDLL',return_value=native),mock.patch.object(refs.os,'geteuid',return_value=0):
                other=refs.UnitReferences()
            other.acquire(unit,inv);native.abi_change_owner()
            with self.assertRaises(refs.ReferenceUncertain):other.assert_held(unit,inv)
            # End this fake socketpair; no real unit/reference was ever created.
            other.bus.close()


if __name__=='__main__':unittest.main()
