"""Channel contract for a future WAHA adapter. No server or pairing is enabled."""
from dataclasses import dataclass
@dataclass(frozen=True)
class ChannelMessage:
 channel:str
 sender:str
 external_id:str
 task_id:str
 text:str
class DisabledWaha:
 enabled=False
 def receive(self,*args,**kwargs):raise RuntimeError('WAHA não configurado; não há listener ou sessão WhatsApp.')
