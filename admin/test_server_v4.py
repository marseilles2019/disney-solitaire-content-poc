import unittest, sys, tempfile, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from server import enrich_element_state

class EnrichmentTests(unittest.TestCase):

    def setUp(self):
        self.content_map = {"sprites": {
            "chips/chip_01": "assets/chips/chip_01.png",
            "chips/chip_06": "assets/chips/chip_06.png",
        }}
        self.tmpdir = tempfile.TemporaryDirectory()
        self.public_root = Path(self.tmpdir.name)
        (self.public_root / "assets" / "chips").mkdir(parents=True)
        (self.public_root / "assets" / "chips" / "chip_01.png").write_bytes(b"\x89PNG\r\n\x1a\n")  # exists
        # chip_06 NOT created

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_builtin_placeholder(self):
        el = {"currentAssetPath": "Resources/unity_builtin_extra:UISprite", "contentTagKey": "", "isBuiltin": True}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        self.assertEqual(s["resourceState"], "builtin_placeholder")

    def test_cdn_managed_when_tag_and_file_exists(self):
        el = {"currentAssetPath": "Resources/unity_builtin_extra:UISprite", "contentTagKey": "chips/chip_01", "isBuiltin": True}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        self.assertEqual(s["resourceState"], "cdn_managed")
        self.assertEqual(s["cdnAssetPath"], "assets/chips/chip_01.png")
        self.assertTrue(s["cdnAssetExists"])
        self.assertEqual(s["cdnAssetVersion"], "2026-05-12-04")

    def test_tagged_unpublished_when_tag_but_no_file(self):
        el = {"currentAssetPath": "Resources/unity_builtin_extra:UISprite", "contentTagKey": "chips/chip_06", "isBuiltin": True}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        self.assertEqual(s["resourceState"], "tagged_unpublished")
        self.assertEqual(s["cdnAssetPath"], "assets/chips/chip_06.png")
        self.assertFalse(s["cdnAssetExists"])

    def test_tagged_unpublished_when_tag_unknown(self):
        # contentTagKey not in content_map
        el = {"currentAssetPath": "Resources/unity_builtin_extra:UISprite", "contentTagKey": "chips/chip_99", "isBuiltin": True}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        self.assertEqual(s["resourceState"], "tagged_unpublished")
        # cdnAssetPath derived by convention: "assets/<tagKey>.png"
        self.assertEqual(s["cdnAssetPath"], "assets/chips/chip_99.png")
        self.assertFalse(s["cdnAssetExists"])

    def test_static_only_when_assets_png_and_no_tag(self):
        el = {"currentAssetPath": "Assets/Art/UI/Chips/chip_01.png", "contentTagKey": "", "isBuiltin": False}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        self.assertEqual(s["resourceState"], "static_only")
        self.assertEqual(s["staticAssetPath"], "Assets/Art/UI/Chips/chip_01.png")

    def test_dual_when_assets_png_AND_tag(self):
        el = {"currentAssetPath": "Assets/Art/UI/Chips/chip_01.png", "contentTagKey": "chips/chip_01", "isBuiltin": False}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        self.assertEqual(s["resourceState"], "dual")
        self.assertIn("warnings", s)
        self.assertTrue(any("既被 ContentTag 接管又有静态" in w for w in s["warnings"]))

    def test_null_sprite_is_builtin_placeholder_without_tag(self):
        el = {"currentAssetPath": "(null)", "contentTagKey": "", "isBuiltin": False}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        self.assertEqual(s["resourceState"], "builtin_placeholder")

    def test_null_sprite_with_tag_is_tagged_unpublished(self):
        el = {"currentAssetPath": "(null)", "contentTagKey": "chips/chip_06", "isBuiltin": False}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        # No sprite assigned in Unity but ContentTag will inject at runtime.
        self.assertEqual(s["resourceState"], "tagged_unpublished")

if __name__ == "__main__":
    unittest.main()
