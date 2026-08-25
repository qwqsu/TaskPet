import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import {
  inspectPetSpritesheetFile,
  installPetPackageFromDirectory,
  installPetPackageFromZip,
  installPetPackageFromZipFile
} from "../src/main/services/custom-pet-service";

interface ZipFixtureEntry {
  name: string;
  data: Buffer;
  compressionMethod?: 0 | 8;
  flags?: number;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data) {
    value = CRC32_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function createZip(entries: ZipFixtureEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.compressionMethod ?? 8;
    const flags = (entry.flags ?? 0) | 0x0800;
    const compressed = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const checksum = crc32(entry.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function manifest(
  id = "test-pet",
  spritesheetPath = "spritesheet.webp"
): Buffer {
  return Buffer.from(JSON.stringify({
    id,
    displayName: "测试桌宠",
    description: "PetDex 兼容测试包",
    spritesheetPath
  }));
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "taskpet-pet-package-"));
}

function createVp8lHeader(width: number, height: number, alphaHint: boolean): Buffer {
  const data = Buffer.alloc(26);
  data.write("RIFF", 0, "ascii");
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WEBP", 8, "ascii");
  data.write("VP8L", 12, "ascii");
  data.writeUInt32LE(5, 16);
  data[20] = 0x2f;
  const sizeBits = (
    (width - 1)
    | ((height - 1) << 14)
    | (alphaHint ? 0x10000000 : 0)
  ) >>> 0;
  data.writeUInt32LE(sizeBits, 21);
  return data;
}

test("spritesheet inspection reads PetDex VP8L geometry and alpha hint", () => {
  const root = tempDir();
  const spritesheetPath = path.join(root, "spritesheet.webp");
  fs.writeFileSync(spritesheetPath, createVp8lHeader(1_536, 1_872, true));
  assert.deepEqual(inspectPetSpritesheetFile(spritesheetPath), {
    width: 1_536,
    height: 1_872,
    hasAlpha: true
  });
});

test("pet package installs a deflated ZIP atomically and fills the default frame", () => {
  const root = tempDir();
  const petsRoot = path.join(root, "pets");
  const spritesheet = Buffer.from("fake-webp-spritesheet");
  const archive = createZip([
    { name: "pet.json", data: manifest() },
    { name: "spritesheet.webp", data: spritesheet }
  ]);
  let validated = false;
  const installed = installPetPackageFromZip({
    petsRoot,
    archive,
    validateSpritesheet: (filePath, petManifest) => {
      validated = true;
      assert.deepEqual(fs.readFileSync(filePath), spritesheet);
      assert.equal(petManifest.id, "test-pet");
    }
  });

  assert.equal(validated, true);
  assert.equal(installed.key, "pets:test-pet");
  assert.deepEqual(installed.frame, {
    width: 192,
    height: 208,
    columns: 8,
    rows: 9
  });
  assert.deepEqual(fs.readFileSync(installed.spritesheetPath), spritesheet);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(installed.directory, "pet.json"), "utf8")),
    {
      id: "test-pet",
      displayName: "测试桌宠",
      description: "PetDex 兼容测试包",
      spritesheetPath: "spritesheet.webp",
      frame: { width: 192, height: 208, columns: 8, rows: 9 }
    }
  );
  assert.deepEqual(
    fs.readdirSync(petsRoot).filter((name) => name.startsWith(".taskpet-import-")),
    []
  );
});

test("pet package imports stored ZIP files from one top-level folder", () => {
  const root = tempDir();
  const zipPath = path.join(root, "nested-pet.zip");
  fs.writeFileSync(zipPath, createZip([
    { name: "nested/pet.json", data: manifest("nested-pet"), compressionMethod: 0 },
    { name: "nested/spritesheet.webp", data: Buffer.from("stored"), compressionMethod: 0 }
  ]));
  const installed = installPetPackageFromZipFile({
    petsRoot: path.join(root, "pets"),
    zipPath
  });
  assert.equal(installed.id, "nested-pet");
  assert.equal(fs.readFileSync(installed.spritesheetPath, "utf8"), "stored");
});

test("pet package imports a selected folder and only copies manifest plus spritesheet", () => {
  const root = tempDir();
  const source = path.join(root, "source");
  fs.mkdirSync(path.join(source, "art"), { recursive: true });
  fs.writeFileSync(path.join(source, "pet.json"), manifest("folder-pet", "art/pet.png"));
  fs.writeFileSync(path.join(source, "art", "pet.png"), Buffer.from("png-data"));
  fs.writeFileSync(path.join(source, "ignored.exe"), Buffer.from("must-not-copy"));

  const installed = installPetPackageFromDirectory({
    petsRoot: path.join(root, "pets"),
    sourceDirectory: source
  });
  assert.equal(installed.id, "folder-pet");
  assert.deepEqual(fs.readdirSync(installed.directory).sort(), ["pet.json", "spritesheet.png"]);
  assert.equal(fs.readFileSync(installed.spritesheetPath, "utf8"), "png-data");
});

test("pet package rejects traversal entries before writing any files", () => {
  const root = tempDir();
  const petsRoot = path.join(root, "pets");
  const archive = createZip([
    { name: "pet.json", data: manifest() },
    { name: "spritesheet.webp", data: Buffer.from("sprite") },
    { name: "../escape.txt", data: Buffer.from("escape") }
  ]);
  assert.throws(
    () => installPetPackageFromZip({ petsRoot, archive }),
    /不安全的目录路径/
  );
  assert.equal(fs.existsSync(path.join(root, "escape.txt")), false);
  assert.equal(fs.existsSync(petsRoot), false);
});

test("pet package rejects unsafe manifests, encrypted ZIPs and missing spritesheets", () => {
  const root = tempDir();
  assert.throws(() => installPetPackageFromZip({
    petsRoot: path.join(root, "unsafe"),
    archive: createZip([
      { name: "pet.json", data: manifest("unsafe", "../outside.webp") },
      { name: "outside.webp", data: Buffer.from("sprite") }
    ])
  }), /不安全的目录路径/);
  assert.throws(() => installPetPackageFromZip({
    petsRoot: path.join(root, "encrypted"),
    archive: createZip([
      { name: "pet.json", data: manifest(), flags: 0x0001 },
      { name: "spritesheet.webp", data: Buffer.from("sprite") }
    ])
  }), /不支持加密 ZIP/);
  assert.throws(() => installPetPackageFromZip({
    petsRoot: path.join(root, "missing"),
    archive: createZip([{ name: "pet.json", data: manifest() }])
  }), /缺少图集/);
});

test("pet package never overwrites an existing pet ID", () => {
  const root = tempDir();
  const petsRoot = path.join(root, "pets");
  const archive = createZip([
    { name: "pet.json", data: manifest("duplicate") },
    { name: "spritesheet.webp", data: Buffer.from("sprite") }
  ]);
  installPetPackageFromZip({ petsRoot, archive });
  assert.throws(
    () => installPetPackageFromZip({ petsRoot, archive }),
    /已存在/
  );
  assert.deepEqual(
    fs.readdirSync(petsRoot).filter((name) => name.startsWith(".taskpet-import-")),
    []
  );
});
