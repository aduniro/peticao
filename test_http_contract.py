import unittest,hashlib,base64,html
from unittest.mock import patch
import run as r,materials_http as m
class HttpContract(unittest.TestCase):
 def example(self):
  c=m.CONTENT1;v={'id':'11111111-1111-4111-8111-111111111111','revision':1,'content':c,'sha256':m.content_digest(c)};head={'id':'22222222-2222-4222-8222-222222222222','revision':3}
  body=('<style>body{color:black}</style>'+''.join(html.escape(c[k])for k in ['title','body','callToAction','footer'])).encode();digest=base64.b64encode(hashlib.sha256(b'body{color:black}').digest()).decode()
  headers={'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff','x-frame-options':'SAMEORIGIN','referrer-policy':'no-referrer','x-material-version-id':v['id'],'x-material-version-revision':'1','x-material-content-sha256':v['sha256'],'x-material-observed-head-version-id':head['id'],'x-material-observed-head-revision':'3','x-material-preview-scope':'exact-historical-version','content-security-policy':f"default-src 'none'; script-src 'none'; style-src 'sha256-{digest}'; img-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"}
  return headers,body,v,head
 def test_old_requested_version_and_distinct_new_head(self):
  h,b,v,head=self.example();self.assertEqual(m.preview_assert(200,h,b,v,head)['observedHeadRevision'],3)
 def test_substituted_head_denied(self):
  h,b,v,head=self.example();h['x-material-version-id']=head['id']
  with self.assertRaises(ValueError):m.preview_assert(200,h,b,v,head)
 def test_css_hash_denied(self):
  h,b,v,head=self.example();b=b.replace(b'color:black',b'color:white')
  with self.assertRaisesRegex(ValueError,'CSP'):m.preview_assert(200,h,b,v,head)
 def test_substituted_old_text_denied(self):
  h,b,v,head=self.example();b=b.replace(v['content']['title'].encode(),b'head version text')
  with self.assertRaisesRegex(ValueError,'historical text'):m.preview_assert(200,h,b,v,head)
 def test_login_uses_lowercase_headers_and_keeps_cookie_memory_only(self):
  calls=r.Calls()
  with patch.object(r,'get',return_value=(303,{'location':'http://127.0.0.1:31398/admin','set-cookie':'admin_session=fake_qa_token; HttpOnly; Secure; SameSite=Strict'},b'')):
   value=calls.login('editor');self.assertEqual(value['status'],303);self.assertEqual(calls.cookies['editor'],'admin_session=fake_qa_token');self.assertNotIn('cookie',value)
 def test_json_response_uses_lowercase_content_type(self):
  calls=r.Calls()
  with patch.object(r,'get',return_value=(200,{'content-type':'application/json'},b'{"ok":true}')):self.assertEqual(calls('GET','/api/admin/materiais',None,'editor')[3],{'ok':True})
 def test_external_endpoint_denied_before_socket(self):
  with patch.object(r.http.client,'HTTPConnection',side_effect=AssertionError('no network')):
   with self.assertRaises(ValueError):r.get('//external.invalid')
   with self.assertRaises(ValueError):r.get('/api/admin/lotes/1/enviar',method='POST')
if __name__=='__main__':unittest.main()
