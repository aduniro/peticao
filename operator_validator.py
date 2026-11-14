import importlib.util
from pathlib import Path
s=importlib.util.spec_from_file_location('neon_infra_operator',Path(__file__).parent/'operator.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
validate=m.validate
