/**
 * PetDex / Codex 兼容桌宠包的安全安装器。
 *
 * 文件夹和 ZIP 最终都会先转换为“已校验的清单 + 图集”，再原子写入用户桌宠目录。
 * ZIP 会先检查中央目录；路径穿越、ZIP64、加密、符号链接和超限文件都会在落盘前拒绝。
 * 安装时只复制 pet.json 及其引用的 PNG/WebP 图集，不把压缩包中的其他文件带入应用。
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { z } from "zod";
import { MAX_PET_ZIP_BYTES } from "../../shared/app-settings";

const DEFAULT_PET_FRAME = Object.freeze({
  width: 192,
  height: 208,
  columns: 8,
  rows: 9
});
const MAX_ARCHIVE_ENTRIES = 64;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_SPRITESHEET_BYTES = 64 * 1024 * 1024;
const SUPPORTED_SPRITESHEET_EXTENSIONS = new Set([".png", ".webp"]);
// JavaScript 自带 Unicode 字符属性；支持汉字不需要打包字库或增加第三方依赖。
const PET_ID_PATTERN = /^[\p{Script=Han}A-Za-z0-9_-]+$/u;
// 这些名称即使带有不同大小写，在 Windows 上也不能作为普通文件夹名。
const WINDOWS_RESERVED_PET_ID_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_VERSION = 45;

const PetFrameSchema = z.object({
  width: z.number().int().min(1).max(4_096),
  height: z.number().int().min(1).max(4_096),
  columns: z.union([z.literal(7), z.literal(8)]),
  rows: z.literal(9)
}).strict();

const PetPackageManifestSchema = z.object({
  id: z.string()
    .trim()
    .min(1, "宠物包缺少 id")
    .max(48, "宠物 ID 最多 48 个字符")
    .regex(
      PET_ID_PATTERN,
      "宠物 ID 只能使用大小写英文字母、数字、连字符、下划线和汉字"
    )
    .refine(
      (id) => !WINDOWS_RESERVED_PET_ID_PATTERN.test(id),
      "宠物 ID 不能使用 Windows 保留名称"
    ),
  displayName: z.string()
    .trim()
    .min(1, "宠物包缺少 displayName")
    .max(80, "宠物名称最多 80 个字符"),
  description: z.string().trim().max(500, "宠物描述最多 500 个字符").optional(),
  spritesheetPath: z.string().trim().min(1).max(240).default("spritesheet.webp"),
  frame: PetFrameSchema.optional().default(DEFAULT_PET_FRAME)
}).strip();

export interface PetPackageManifest {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
  frame: {
    width: number;
    height: number;
    columns: 7 | 8;
    rows: 9;
  };
}

export interface InstalledPetPackage {
  id: string;
  key: string;
  directory: string;
  spritesheetPath: string;
  frame: PetPackageManifest["frame"];
}

export interface PetPackageInstallOptions {
  petsRoot: string;
  validateSpritesheet?: (
    filePath: string,
    manifest: Readonly<PetPackageManifest>
  ) => void;
}

interface ZipEntry {
  name: string;
  normalizedName: string;
  flags: number;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

interface ValidatedPackage {
  manifest: PetPackageManifest;
  spritesheet: Buffer;
  spritesheetExtension: string;
}

export interface PetSpritesheetInfo {
  width: number;
  height: number;
  /** null means the format only exposes a non-authoritative alpha hint. */
  hasAlpha: boolean | null;
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

function inspectPng(data: Buffer): PetSpritesheetInfo {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (data.length < 33 || !data.subarray(0, 8).equals(signature)) {
    throw new Error("PNG 图集文件头无效");
  }
  if (data.readUInt32BE(8) !== 13 || data.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("PNG 图集缺少有效的 IHDR");
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const colorType = data[25];
  let hasTransparencyChunk = false;
  let foundEnd = false;
  let offset = 8;
  while (offset + 12 <= data.length) {
    const chunkLength = data.readUInt32BE(offset);
    const chunkType = data.toString("ascii", offset + 4, offset + 8);
    const nextOffset = offset + 12 + chunkLength;
    if (nextOffset > data.length) throw new Error("PNG 图集数据已截断");
    if (chunkType === "tRNS") hasTransparencyChunk = true;
    if (chunkType === "IEND") {
      foundEnd = true;
      break;
    }
    offset = nextOffset;
  }
  if (!foundEnd || width === 0 || height === 0) throw new Error("PNG 图集结构无效");
  return {
    width,
    height,
    hasAlpha: colorType === 4 || colorType === 6 || hasTransparencyChunk
  };
}

function readUInt24LE(data: Buffer, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16);
}

function inspectWebP(data: Buffer): PetSpritesheetInfo {
  if (
    data.length < 20
    || data.toString("ascii", 0, 4) !== "RIFF"
    || data.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new Error("WebP 图集文件头无效");
  }
  const riffEnd = data.readUInt32LE(4) + 8;
  if (riffEnd !== data.length) throw new Error("WebP RIFF 文件大小无效");

  let imageInfo: PetSpritesheetInfo | null = null;
  let hasAlphaChunk = false;
  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const chunkType = data.toString("ascii", offset, offset + 4);
    const chunkLength = data.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    const chunkEnd = chunkDataOffset + chunkLength;
    if (chunkEnd > riffEnd) throw new Error("WebP 图集数据已截断");

    if (chunkType === "VP8X") {
      if (chunkLength < 10) throw new Error("WebP VP8X 文件头无效");
      const featureFlags = data[chunkDataOffset]!;
      if ((featureFlags & 0x02) !== 0) throw new Error("桌宠图集不能使用动画 WebP");
      imageInfo = {
        width: readUInt24LE(data, chunkDataOffset + 4) + 1,
        height: readUInt24LE(data, chunkDataOffset + 7) + 1,
        hasAlpha: (featureFlags & 0x10) !== 0
      };
    } else if (chunkType === "ALPH") {
      hasAlphaChunk = true;
    } else if (chunkType === "VP8L") {
      if (chunkLength < 5 || data[chunkDataOffset] !== 0x2f) {
        throw new Error("WebP VP8L 文件头无效");
      }
      const sizeBits = data.readUInt32LE(chunkDataOffset + 1);
      if ((sizeBits >>> 29) !== 0) throw new Error("WebP VP8L 版本不受支持");
      imageInfo = {
        width: (sizeBits & 0x3fff) + 1,
        height: ((sizeBits >>> 14) & 0x3fff) + 1,
        // VP8L's alpha_is_used bit is only a hint, so false is not definitive.
        hasAlpha: ((sizeBits >>> 28) & 1) === 1 ? true : null
      };
    } else if (chunkType === "VP8 ") {
      if (
        chunkLength < 10
        || data[chunkDataOffset + 3] !== 0x9d
        || data[chunkDataOffset + 4] !== 0x01
        || data[chunkDataOffset + 5] !== 0x2a
      ) {
        throw new Error("WebP VP8 文件头无效");
      }
      imageInfo = {
        width: data.readUInt16LE(chunkDataOffset + 6) & 0x3fff,
        height: data.readUInt16LE(chunkDataOffset + 8) & 0x3fff,
        hasAlpha: hasAlphaChunk
      };
    }
    offset = chunkEnd + (chunkLength & 1);
  }
  if (offset !== riffEnd || !imageInfo || imageInfo.width === 0 || imageInfo.height === 0) {
    throw new Error("WebP 图集结构无效");
  }
  if (hasAlphaChunk) imageInfo.hasAlpha = true;
  return imageInfo;
}

export function inspectPetSpritesheetFile(filePath: string): PetSpritesheetInfo {
  const resolvedPath = path.resolve(filePath);
  const extension = path.extname(resolvedPath).toLowerCase();
  const data = fs.readFileSync(resolvedPath);
  if (extension === ".png") return inspectPng(data);
  if (extension === ".webp") return inspectWebP(data);
  throw new Error("宠物图集只支持 PNG 或 WebP 文件");
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizePackagePath(value: string, label: string): string {
  if (value.includes("\0")) throw new Error(`${label}包含无效字符`);
  const normalized = value.replace(/\\/g, "/").normalize("NFC");
  if (
    normalized.length === 0
    || normalized.startsWith("/")
    || /^[a-z]:/i.test(normalized)
  ) {
    throw new Error(`${label}必须是宠物包内的相对路径`);
  }
  const segments = normalized.split("/");
  const isDirectory = segments.at(-1) === "";
  const checkedSegments = isDirectory ? segments.slice(0, -1) : segments;
  if (
    checkedSegments.length === 0
    || checkedSegments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`${label}包含不安全的目录路径`);
  }
  return `${checkedSegments.join("/")}${isDirectory ? "/" : ""}`;
}

function parseManifest(data: Buffer): PetPackageManifest {
  if (data.length === 0 || data.length > MAX_MANIFEST_BYTES) {
    throw new Error("pet.json 为空或超过 64 KB");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(data.toString("utf8"));
  } catch {
    throw new Error("pet.json 不是有效的 JSON 文件");
  }
  const parsed = PetPackageManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "pet.json 内容无效");
  }
  const spritesheetPath = normalizePackagePath(
    parsed.data.spritesheetPath,
    "spritesheetPath"
  );
  if (spritesheetPath.endsWith("/")) throw new Error("spritesheetPath 必须指向图片文件");
  const extension = path.posix.extname(spritesheetPath).toLowerCase();
  if (!SUPPORTED_SPRITESHEET_EXTENSIONS.has(extension)) {
    throw new Error("宠物图集只支持 PNG 或 WebP 文件");
  }
  return {
    id: parsed.data.id,
    displayName: parsed.data.displayName,
    description: parsed.data.description ?? "",
    spritesheetPath,
    frame: { ...parsed.data.frame }
  };
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimumOffset = Math.max(0, archive.length - 22 - 0xffff);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === archive.length) return offset;
  }
  throw new Error("ZIP 文件缺少有效的中央目录");
}

function decodeEntryName(data: Buffer, utf8: boolean): string {
  // PetDex package filenames are UTF-8/ASCII. Legacy encodings are decoded as UTF-8
  // as well and rejected if replacement characters appear.
  const value = data.toString("utf8");
  if ((!utf8 && value.includes("�")) || value.includes("\0")) {
    throw new Error("ZIP 中包含无法识别的文件名");
  }
  return value;
}

function parseZipEntries(archive: Buffer): ZipEntry[] {
  // 中央目录相当于 ZIP 的文件索引。先完整验证索引，再读取具体条目，
  // 可以避免边解压边发现危险路径而留下半成品。
  if (archive.length === 0 || archive.length > MAX_PET_ZIP_BYTES) {
    throw new Error("宠物 ZIP 为空或超过 50 MB");
  }
  const eocdOffset = findEndOfCentralDirectory(archive);
  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = archive.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = archive.readUInt16LE(eocdOffset + 8);
  const totalEntries = archive.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber !== 0
    || centralDirectoryDisk !== 0
    || entriesOnDisk !== totalEntries
  ) {
    throw new Error("不支持分卷 ZIP 宠物包");
  }
  if (
    totalEntries === 0
    || totalEntries > MAX_ARCHIVE_ENTRIES
    || entriesOnDisk === 0xffff
    || centralDirectorySize === 0xffffffff
    || centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error("ZIP 条目数量无效或使用了不支持的 ZIP64 格式");
  }
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (centralDirectoryEnd > eocdOffset || centralDirectoryEnd > archive.length) {
    throw new Error("ZIP 中央目录范围无效");
  }

  const entries: ZipEntry[] = [];
  const seenNames = new Set<string>();
  let totalUncompressedBytes = 0;
  let offset = centralDirectoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > centralDirectoryEnd) throw new Error("ZIP 中央目录已截断");
    if (archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("ZIP 中央目录条目无效");
    }
    const versionMadeBy = archive.readUInt16LE(offset + 4);
    const versionNeeded = archive.readUInt16LE(offset + 6);
    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const entryCrc32 = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const diskStart = archive.readUInt16LE(offset + 34);
    const externalAttributes = archive.readUInt32LE(offset + 38);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > centralDirectoryEnd) throw new Error("ZIP 中央目录条目已截断");
    if (
      versionNeeded >= ZIP64_VERSION
      || compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || localHeaderOffset === 0xffffffff
    ) {
      throw new Error("不支持 ZIP64 宠物包");
    }
    if (diskStart !== 0) throw new Error("不支持分卷 ZIP 宠物包");
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) {
      throw new Error("不支持加密 ZIP 宠物包");
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error("宠物 ZIP 只支持 Store 或 Deflate 压缩方式");
    }
    const hostSystem = versionMadeBy >>> 8;
    const unixFileType = (externalAttributes >>> 16) & 0xf000;
    if (hostSystem === 3 && unixFileType === 0xa000) {
      throw new Error("宠物 ZIP 不允许包含符号链接");
    }

    const rawName = archive.subarray(offset + 46, offset + 46 + nameLength);
    const name = decodeEntryName(rawName, (flags & 0x0800) !== 0);
    const normalizedName = normalizePackagePath(name, "ZIP 文件名");
    const foldedName = normalizedName.toLocaleLowerCase("en-US");
    if (seenNames.has(foldedName)) throw new Error("ZIP 中包含重复文件名");
    seenNames.add(foldedName);
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error("ZIP 解压后总大小超过 100 MB");
    }
    if (compressedSize > archive.length || localHeaderOffset >= centralDirectoryOffset) {
      throw new Error("ZIP 文件条目范围无效");
    }
    entries.push({
      name,
      normalizedName,
      flags,
      compressionMethod,
      crc32: entryCrc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });
    offset = nextOffset;
  }
  if (offset !== centralDirectoryEnd) throw new Error("ZIP 中央目录大小不一致");
  return entries;
}

function extractZipEntry(archive: Buffer, entry: ZipEntry, maxBytes: number): Buffer {
  if (entry.normalizedName.endsWith("/")) throw new Error("ZIP 条目不是文件");
  if (entry.uncompressedSize > maxBytes) throw new Error("宠物包文件超过允许大小");
  const offset = entry.localHeaderOffset;
  if (
    offset + 30 > archive.length
    || archive.readUInt32LE(offset) !== LOCAL_FILE_HEADER_SIGNATURE
  ) {
    throw new Error("ZIP 本地文件头无效");
  }
  const localFlags = archive.readUInt16LE(offset + 6);
  const localCompressionMethod = archive.readUInt16LE(offset + 8);
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  if (
    (localFlags & 0x0001) !== 0
    || localCompressionMethod !== entry.compressionMethod
  ) {
    throw new Error("ZIP 本地文件头与中央目录不一致");
  }
  const rawName = archive.subarray(offset + 30, offset + 30 + nameLength);
  const localName = normalizePackagePath(
    decodeEntryName(rawName, (localFlags & 0x0800) !== 0),
    "ZIP 文件名"
  );
  if (localName.toLocaleLowerCase("en-US") !== entry.normalizedName.toLocaleLowerCase("en-US")) {
    throw new Error("ZIP 本地文件名与中央目录不一致");
  }
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataOffset > archive.length || dataEnd > archive.length) {
    throw new Error("ZIP 文件数据已截断");
  }
  const compressed = archive.subarray(dataOffset, dataEnd);
  let extracted: Buffer;
  try {
    extracted = entry.compressionMethod === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 });
  } catch {
    throw new Error("ZIP 文件解压失败");
  }
  if (extracted.length !== entry.uncompressedSize) {
    throw new Error("ZIP 文件解压大小与清单不一致");
  }
  if (crc32(extracted) !== entry.crc32) throw new Error("ZIP 文件 CRC 校验失败");
  return extracted;
}

function locateZipEntry(entries: ZipEntry[], normalizedName: string): ZipEntry | undefined {
  const foldedName = normalizedName.toLocaleLowerCase("en-US");
  return entries.find(
    (entry) => entry.normalizedName.toLocaleLowerCase("en-US") === foldedName
  );
}

function readPackageFromZip(archive: Buffer): ValidatedPackage {
  const entries = parseZipEntries(archive);
  const manifestEntries = entries.filter(
    (entry) => !entry.normalizedName.endsWith("/")
      && path.posix.basename(entry.normalizedName).toLocaleLowerCase("en-US") === "pet.json"
  );
  if (manifestEntries.length !== 1) {
    throw new Error("宠物 ZIP 必须且只能包含一个 pet.json");
  }
  const manifestEntry = manifestEntries[0]!;
  const manifest = parseManifest(extractZipEntry(archive, manifestEntry, MAX_MANIFEST_BYTES));
  const packageRoot = path.posix.dirname(manifestEntry.normalizedName);
  const spritesheetEntryName = packageRoot === "."
    ? manifest.spritesheetPath
    : `${packageRoot}/${manifest.spritesheetPath}`;
  const spritesheetEntry = locateZipEntry(entries, spritesheetEntryName);
  if (!spritesheetEntry || spritesheetEntry.normalizedName.endsWith("/")) {
    throw new Error(`宠物 ZIP 缺少图集：${manifest.spritesheetPath}`);
  }
  const extension = path.posix.extname(manifest.spritesheetPath).toLowerCase();
  return {
    manifest,
    spritesheet: extractZipEntry(archive, spritesheetEntry, MAX_SPRITESHEET_BYTES),
    spritesheetExtension: extension
  };
}

function readPackageFromDirectory(sourceDirectory: string): ValidatedPackage {
  const sourceRoot = path.resolve(sourceDirectory);
  const sourceStat = fs.lstatSync(sourceRoot);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error("选择的宠物文件夹不存在或是符号链接");
  }
  const manifestPath = path.join(sourceRoot, "pet.json");
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error("所选文件夹根目录缺少有效的 pet.json");
  }
  if (manifestStat.size > MAX_MANIFEST_BYTES) throw new Error("pet.json 超过 64 KB");
  const manifest = parseManifest(fs.readFileSync(manifestPath));
  const spritesheetPath = path.resolve(sourceRoot, ...manifest.spritesheetPath.split("/"));
  if (!isWithin(sourceRoot, spritesheetPath)) {
    throw new Error("spritesheetPath 指向了宠物文件夹之外");
  }
  const spritesheetStat = fs.lstatSync(spritesheetPath);
  if (!spritesheetStat.isFile() || spritesheetStat.isSymbolicLink()) {
    throw new Error(`宠物文件夹缺少图集：${manifest.spritesheetPath}`);
  }
  if (spritesheetStat.size === 0 || spritesheetStat.size > MAX_SPRITESHEET_BYTES) {
    throw new Error("宠物图集为空或超过 64 MB");
  }
  return {
    manifest,
    spritesheet: fs.readFileSync(spritesheetPath),
    spritesheetExtension: path.extname(spritesheetPath).toLowerCase()
  };
}

function installValidatedPackage(
  options: PetPackageInstallOptions,
  petPackage: ValidatedPackage
): InstalledPetPackage {
  if (petPackage.spritesheet.length === 0) throw new Error("宠物图集为空");
  const petsRoot = path.resolve(options.petsRoot);
  const targetDirectory = path.resolve(petsRoot, petPackage.manifest.id);
  if (path.dirname(targetDirectory) !== petsRoot) {
    throw new Error("宠物 ID 生成了不安全的目录路径");
  }
  if (fs.existsSync(targetDirectory)) {
    throw new Error(`宠物 ID “${petPackage.manifest.id}” 已存在`);
  }

  fs.mkdirSync(petsRoot, { recursive: true });
  // 先写随机临时目录，全部校验成功后再 rename；失败时不会留下可被加载的残缺宠物。
  const temporaryDirectory = path.join(
    petsRoot,
    `.taskpet-import-${petPackage.manifest.id}-${randomUUID()}`
  );
  const spritesheetName = `spritesheet${petPackage.spritesheetExtension}`;
  const temporarySpritesheetPath = path.join(temporaryDirectory, spritesheetName);
  try {
    fs.mkdirSync(temporaryDirectory);
    fs.writeFileSync(temporarySpritesheetPath, petPackage.spritesheet, {
      flag: "wx"
    });
    options.validateSpritesheet?.(temporarySpritesheetPath, petPackage.manifest);
    fs.writeFileSync(
      path.join(temporaryDirectory, "pet.json"),
      `${JSON.stringify({
        ...petPackage.manifest,
        spritesheetPath: spritesheetName
      }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" }
    );
    fs.renameSync(temporaryDirectory, targetDirectory);
  } catch (error) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  return {
    id: petPackage.manifest.id,
    key: `pets:${petPackage.manifest.id}`,
    directory: targetDirectory,
    spritesheetPath: path.join(targetDirectory, spritesheetName),
    frame: { ...petPackage.manifest.frame }
  };
}

export function installPetPackageFromZip(
  options: PetPackageInstallOptions & { archive: Uint8Array }
): InstalledPetPackage {
  const archive = Buffer.from(
    options.archive.buffer,
    options.archive.byteOffset,
    options.archive.byteLength
  );
  return installValidatedPackage(options, readPackageFromZip(archive));
}

export function installPetPackageFromZipFile(
  options: PetPackageInstallOptions & { zipPath: string }
): InstalledPetPackage {
  const zipPath = path.resolve(options.zipPath);
  const stat = fs.statSync(zipPath);
  if (!stat.isFile() || path.extname(zipPath).toLowerCase() !== ".zip") {
    throw new Error("请选择 .zip 宠物包");
  }
  if (stat.size === 0 || stat.size > MAX_PET_ZIP_BYTES) {
    throw new Error("宠物 ZIP 为空或超过 50 MB");
  }
  return installPetPackageFromZip({ ...options, archive: fs.readFileSync(zipPath) });
}

export function installPetPackageFromDirectory(
  options: PetPackageInstallOptions & { sourceDirectory: string }
): InstalledPetPackage {
  return installValidatedPackage(options, readPackageFromDirectory(options.sourceDirectory));
}
