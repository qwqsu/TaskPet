const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_PET_FRAME,
  discoverPets,
  normalizePetFrame,
  resolvePetStorageRoot,
  sanitizeId,
  toPetPayload
} = require("../src/pet-library");

const WEBP = Buffer.from("RIFF\x10\x00\x00\x00WEBPVP8 ", "binary");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "taskpet-test-"));
}

function writePet(root, id, manifestPatch = {}) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "spritesheet.webp"), WEBP);
  fs.writeFileSync(path.join(dir, "pet.json"), JSON.stringify({
    id,
    displayName: `Pet ${id}`,
    spritesheetPath: "spritesheet.webp",
    ...manifestPatch
  }));
}

test("discoverPets reads only the provided pets root", () => {
  const root = tempDir();
  const petsRoot = path.join(root, "src", "assets", "pets");
  const runsRoot = path.join(root, "pet-runs");
  writePet(petsRoot, "boba");
  writePet(path.join(runsRoot, "run-1", "final"), "generated");

  const pets = discoverPets(petsRoot);
  assert.equal(pets.length, 1);
  assert.equal(pets[0].id, "boba");
  assert.equal(pets[0].source, "pets");
  assert.equal(pets[0].key, "pets:boba");
  assert.equal("sourceLabel" in pets[0], false);
});

test("default and imported pets share one directory and key namespace", () => {
  const root = tempDir();
  const petsRoot = path.join(root, "src", "assets", "pets");
  writePet(petsRoot, "starter");
  writePet(petsRoot, "custom");

  const pets = discoverPets(petsRoot);

  assert.equal(pets.length, 2);
  assert.deepEqual(pets.map((pet) => pet.source), ["pets", "pets"]);
  assert.deepEqual(pets.map((pet) => pet.key), ["pets:custom", "pets:starter"]);
});

test("development pet storage is exactly the source assets pets directory", () => {
  const root = tempDir();
  const developmentPetsRoot = path.join(root, "src", "assets", "pets");

  assert.equal(resolvePetStorageRoot({
    isPackaged: false,
    resourcesPath: path.join(root, "resources"),
    developmentPetsRoot
  }), path.resolve(developmentPetsRoot));
});

test("packaged pet storage stays writable outside app.asar", () => {
  const root = tempDir();
  const resourcesPath = path.join(root, "TaskPet", "resources");

  assert.equal(resolvePetStorageRoot({
    isPackaged: true,
    resourcesPath,
    developmentPetsRoot: path.join(root, "source-pets")
  }), path.join(resourcesPath, "src", "assets", "pets"));
});

test("pet storage path resolver rejects a missing active root", () => {
  assert.throws(() => resolvePetStorageRoot({
    isPackaged: false,
    resourcesPath: "",
    developmentPetsRoot: ""
  }), /developmentPetsRoot/);
  assert.throws(() => resolvePetStorageRoot({
    isPackaged: true,
    resourcesPath: "",
    developmentPetsRoot: "C:\\TaskPet\\src\\assets\\pets"
  }), /resourcesPath/);
});

test("sanitizeId keeps ids filesystem-safe", () => {
  assert.equal(sanitizeId("hello / world"), "hello-world");
});

test("Codex-compatible frame geometry is the default", () => {
  assert.deepEqual(normalizePetFrame(), DEFAULT_PET_FRAME);
  assert.deepEqual(normalizePetFrame({ width: -1, columns: 4, rows: 7 }), DEFAULT_PET_FRAME);
  assert.deepEqual(normalizePetFrame({ width: 162, height: 154, columns: 7, rows: 9 }), {
    width: 162,
    height: 154,
    columns: 7,
    rows: 9
  });
});

test("pet manifests can provide explicit frame geometry", () => {
  const root = tempDir();
  const petsRoot = path.join(root, "src", "assets", "pets");
  writePet(petsRoot, "wide", {
    frame: { width: 96, height: 104, columns: 8, rows: 9 }
  });

  const [pet] = discoverPets(petsRoot);
  assert.deepEqual(pet.frame, { width: 96, height: 104, columns: 8, rows: 9 });

  const payload = toPetPayload(pet);
  assert.deepEqual(payload.frame, pet.frame);
  assert.match(payload.spritesheetUrl, /^file:/);
  assert.equal("root" in payload, false);
  assert.equal("spritesheetPath" in payload, false);
});

test("pet manifests cannot load a spritesheet outside their package", () => {
  const root = tempDir();
  const petsRoot = path.join(root, "pets");
  fs.mkdirSync(petsRoot, { recursive: true });
  fs.writeFileSync(path.join(petsRoot, "outside.webp"), WEBP);
  writePet(petsRoot, "unsafe", { spritesheetPath: "../outside.webp" });

  const errors = [];
  assert.deepEqual(discoverPets(petsRoot, { onError: (message) => errors.push(message) }), []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Skipped invalid pet package/);
  assert.equal(errors[0].includes(root), false);
});
