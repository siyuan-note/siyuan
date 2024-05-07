import os,sys
if os.path.abspath(os.path.dirname(__file__)) not in sys.path:
  sys.path.append(os.path.abspath(os.path.dirname(__file__)))
PY_DIR = os.path.abspath(os.path.dirname(sys.executable))
PYSPP = os.path.abspath(os.path.join(PY_DIR,'Lib', 'site-packages'))
if PY_DIR not in sys.path:
    sys.path.append(PY_DIR)
    sys.path.append(PYSPP)
