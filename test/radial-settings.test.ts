import test from "node:test";
import assert from "node:assert/strict";
import {
  RADIAL_BUILTINS,
  RadialItemSchema,
  RadialSettingsSchema,
  defaultRadialSettings,
  normalizePetScale,
  normalizeRadialSettings
} from "../src/shared/radial-settings";

test("radial defaults are valid, complete, and independently mutable", () => {
  const defaults = defaultRadialSettings();
  assert.equal(RadialSettingsSchema.safeParse(defaults).success, true);
  assert.deepEqual(defaults.items.map(item => item.id), [...RADIAL_BUILTINS]);
  assert.deepEqual(defaults.items.filter(item => item.enabled).map(item => item.id), [
    "open-panel", "open-settings", "toggle-monitoring", "toggle-always-on-top",
    "pet-opacity", "pet-scale", "music"
  ]);
  assert.deepEqual({ ...defaults, items: [] }, {
    enabled: true, opacity: 92, scale: 90, showHints: true, animations: true, items: []
  });
  const independent = defaultRadialSettings();
  independent.items[0]!.enabled = false;
  independent.items.push({ id: "app-editor", name: "Editor", path: "C:\\Editor.exe", enabled: true });
  independent.opacity = 40;
  assert.deepEqual(defaultRadialSettings(), defaults);
});

test("migration preserves item order and user choices, appending missing builtins disabled", () => {
  const saved = {
    ...defaultRadialSettings(), enabled: false, opacity: 71, scale: 123,
    showHints: false, animations: false,
    items: [
      { id: "music", enabled: false },
      { id: "app-editor", name: "编辑器", path: "C:\\Apps\\Editor.exe", enabled: true },
      { id: "open-panel", enabled: false }
    ]
  };
  const before = JSON.parse(JSON.stringify(saved));
  const normalized = normalizeRadialSettings(saved);
  assert.deepEqual(normalized, {
    ...saved,
    items: [...saved.items, ...RADIAL_BUILTINS
      .filter(id => id !== "music" && id !== "open-panel")
      .map(id => ({ id, enabled: false }))]
  });
  assert.deepEqual(saved, before, "migration must not mutate persisted input");
  assert.deepEqual(normalizeRadialSettings(normalized), normalized, "migration is idempotent");
  assert.equal(RadialSettingsSchema.safeParse(normalized).success, true);
  normalized.items[0]!.enabled = true;
  assert.deepEqual(saved, before, "normalized items must not alias saved items");
});

test("an intentionally empty menu stays disabled when missing builtins are added", () => {
  const normalized = normalizeRadialSettings({ ...defaultRadialSettings(), items: [] });
  assert.deepEqual(normalized.items, RADIAL_BUILTINS.map(id => ({ id, enabled: false })));
});

test("obsolete size is repaired without discarding app entries or other preferences", () => {
  for (const scale of [undefined,40,49,131,140]) {
    const saved = {...defaultRadialSettings(),scale,opacity:67,enabled:false,
      items:[{id:"app-editor",name:"Editor",path:"C:\\Editor.exe",enabled:true}]};
    const normalized = normalizeRadialSettings(saved);
    assert.equal(normalized.scale,90);
    assert.equal(normalized.opacity,67);
    assert.equal(normalized.enabled,false);
    assert.deepEqual(normalized.items[0],saved.items[0]);
    assert.deepEqual(normalizeRadialSettings(normalized),normalized);
  }
});

test("radial opacity and scale accept inclusive integer bounds and reject invalid values", () => {
  for (const [field, minimum, maximum] of [["opacity", 40, 100], ["scale", 50, 130]] as const) {
    for (const value of [minimum, minimum + 1, maximum - 1, maximum]) {
      const input = { ...defaultRadialSettings(), [field]: value };
      assert.equal(RadialSettingsSchema.safeParse(input).success, true, `${field}: ${value}`);
      assert.deepEqual(normalizeRadialSettings(input), input);
    }
    for (const value of [minimum - 1, maximum + 1, minimum + 0.5, NaN, Infinity, -Infinity, String(minimum), null]) {
      const input = { ...defaultRadialSettings(), [field]: value };
      assert.equal(RadialSettingsSchema.safeParse(input).success, false, `${field}: ${value}`);
      assert.deepEqual(normalizeRadialSettings(input), defaultRadialSettings());
    }
  }
});

test("malformed configurations fall back completely instead of retaining partial unsafe data", () => {
  for (const raw of [
    undefined, null, false, 92, "settings", [], {}, { enabled: false },
    { ...defaultRadialSettings(), enabled: "false" },
    { ...defaultRadialSettings(), showHints: 1 },
    { ...defaultRadialSettings(), animations: null },
    { ...defaultRadialSettings(), items: null },
    { ...defaultRadialSettings(), unknown: true },
    { ...defaultRadialSettings(), items: [{ id: "unknown-action", enabled: true }] },
    { ...defaultRadialSettings(), items: [{ id: "open-panel", enabled: true, command: "run" }] }
  ]) {
    assert.equal(RadialSettingsSchema.safeParse(raw).success, false);
    assert.deepEqual(normalizeRadialSettings(raw), defaultRadialSettings());
  }
  const fallback = normalizeRadialSettings(null);
  fallback.items[0]!.enabled = false;
  assert.deepEqual(normalizeRadialSettings(null), defaultRadialSettings());
});

test("duplicate builtin and custom app IDs invalidate the whole configuration", () => {
  for (const item of [
    { id: "open-panel", enabled: true },
    { id: "app-editor", name: "Editor", path: "C:\\Editor.exe", enabled: true }
  ]) {
    const input = { ...defaultRadialSettings(), items: [item, { ...item, enabled: false }] };
    assert.equal(RadialSettingsSchema.safeParse(input).success, false);
    assert.deepEqual(normalizeRadialSettings(input), defaultRadialSettings());
  }
});

test("custom app items require bounded IDs, nonblank names and nonempty paths", () => {
  const app = { id: "app-editor-2", name: " 编辑器 ", path: "C:\\Apps\\Editor.exe", enabled: true };
  assert.deepEqual(RadialItemSchema.parse(app), { ...app, name: "编辑器" });
  assert.equal(RadialItemSchema.safeParse({
    ...app, id: `app-${"a".repeat(76)}`, name: "n".repeat(40), path: "p".repeat(2048)
  }).success, true);
  for (const invalid of [
    { ...app, id: "app-" }, { ...app, id: "app-name_with_underscore" },
    { ...app, id: `app-${"a".repeat(77)}` },
    { ...app, name: undefined }, { ...app, name: "   " }, { ...app, name: "n".repeat(41) },
    { ...app, path: undefined }, { ...app, path: "" }, { ...app, path: "p".repeat(2049) },
    { ...app, enabled: "true" }, { ...app, extra: true }
  ]) {
    assert.equal(RadialItemSchema.safeParse(invalid).success, false);
  }
});

test("a complete menu allows 45 unique items and rejects a 46th item", () => {
  const items = [
    ...defaultRadialSettings().items,
    ...Array.from({ length: 45 - RADIAL_BUILTINS.length }, (_, i) => ({
      id: `app-${i}`, name: `App ${i}`, path: `C:\\App${i}.exe`, enabled: true
    }))
  ];
  const full = { ...defaultRadialSettings(), items };
  assert.equal(RadialSettingsSchema.safeParse(full).success, true);
  assert.deepEqual(normalizeRadialSettings(full), full);
  const overflow = { ...full, items: [...items, {
    id: "app-overflow", name: "Overflow", path: "C:\\Overflow.exe", enabled: false
  }] };
  assert.equal(RadialSettingsSchema.safeParse(overflow).success, false);
  assert.deepEqual(normalizeRadialSettings(overflow), defaultRadialSettings());
});

test("pet scale migrates legacy sizes only when no valid numeric scale exists", () => {
  for (const [legacy, expected] of [["small", 60], ["normal", 100], ["large", 110], ["unknown", 100]] as const) {
    for (const invalid of [undefined, null, "120", 59.9, 180.1, NaN, Infinity, -Infinity, {}, true]) {
      assert.equal(normalizePetScale(invalid, legacy), expected);
    }
    for (const [input, rounded] of [[60, 60], [180, 180], [123.4, 123], [123.5, 124]]) {
      assert.equal(normalizePetScale(input, legacy), rounded);
    }
  }
  assert.equal(normalizePetScale(undefined), 100);
});
