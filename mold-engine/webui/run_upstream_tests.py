"""Runs moldforge's OWN headless test suite unmodified, working around a
Blender 5.2 behavior change: `wm.read_factory_settings()` now drops dynamically
registered Scene PointerProperties, which breaks the suite's two late
scenarios that use `context.scene.moldforge` (operator path + UI guards).

The wrapper re-attaches the pointer after every scene reset, then calls the
upstream main(). Nothing inside moldforge/ is modified. The webui driver itself
is unaffected by the quirk (it never registers the add-on and passes a
SimpleNamespace straight to the pipeline).

Run: engine\\blender-*\\blender.exe --background --python webui\\run_upstream_tests.py
"""

import os
import sys

THIS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(THIS)
sys.path.insert(0, ROOT)

import bpy  # noqa: E402
import moldforge  # noqa: E402
from moldforge.tests import test_headless as suite  # noqa: E402

_orig_reset = suite.reset_scene


def resetting_reset():
    _orig_reset()
    if not hasattr(bpy.types.Scene, "moldforge"):
        try:
            moldforge.register()
        except Exception:
            # classes may still be registered even though the pointer was
            # dropped — just re-attach the pointer property then
            from bpy.props import PointerProperty
            from moldforge.properties import MoldForgeProperties
            bpy.types.Scene.moldforge = PointerProperty(type=MoldForgeProperties)


suite.reset_scene = resetting_reset
sys.exit(suite.main())
