/**
 * Codex-compatible 宠物包加载器。
 * 从内置目录和用户目录读取 pet.json，校验 spritesheet 仍位于宠物包内部，再生成安全的 file URL。
 */
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DEFAULT_PET_FRAME = Object.freeze({
  width: 192,
  height: 208,
  columns: 8,
  rows: 9
});

const STORAGE_LABELS = {
  codex: ".codex 宠物",
  custom: "自定义文件夹"
};

const PET_SOURCE_LABELS = {
  builtin: "内置",
  pets: "目录"
};

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function listDirectories(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function sanitizeId(input, fallback = "pet") {
  const base = String(input || fallback)
    .normalize("NFKD")
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || fallback;
}

function positiveInteger(value, fallback, minimum = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum ? number : fallback;
}

function normalizePetFrame(frame = {}) {
  return {
    width: positiveInteger(frame.width, DEFAULT_PET_FRAME.width),
    height: positiveInteger(frame.height, DEFAULT_PET_FRAME.height),
    columns: positiveInteger(frame.columns, DEFAULT_PET_FRAME.columns, 7),
    rows: positiveInteger(frame.rows, DEFAULT_PET_FRAME.rows, 8)
  };
}

function resolveSpritesheetPath(directory, manifestPath) {
  // 拒绝 ../ 等路径逃逸，宠物 manifest 不能读取包目录外的任意文件。
  const spritesheetPath = path.resolve(directory, manifestPath || "spritesheet.webp");
  const relative = path.relative(directory, spritesheetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return spritesheetPath;
}

function getPetStorageRoots({ codexHome, customPetsDir }) {
  return {
    codexPetsRoot: path.join(codexHome, "pets"),
    customPetsRoot: customPetsDir ? path.resolve(customPetsDir) : ""
  };
}

function normalizePetStorage(value, roots) {
  if (value === "custom" && roots.customPetsRoot) return "custom";
  return "codex";
}

function getActivePetsRoot({ codexHome, settings = {} }) {
  const roots = getPetStorageRoots({
    codexHome,
    customPetsDir: settings.customPetsDir
  });
  const petStorage = normalizePetStorage(settings.petStorage, roots);
  const petsRoot = petStorage === "custom" ? roots.customPetsRoot : roots.codexPetsRoot;

  return {
    petStorage,
    petsRoot,
    ...roots,
    options: [
      { id: "codex", label: STORAGE_LABELS.codex, path: roots.codexPetsRoot },
      { id: "custom", label: STORAGE_LABELS.custom, path: roots.customPetsRoot }
    ]
  };
}

function discoverPetsInDirectory(petsRoot, source = "pets", onError = () => {}) {
  const prefix = source === "builtin" ? "builtin" : "pets";
  return listDirectories(petsRoot)
    .map((dir) => {
      const manifest = readJson(path.join(dir, "pet.json")) || {};
      const id = String(manifest.id || path.basename(dir));
      const spritesheetPath = resolveSpritesheetPath(dir, manifest.spritesheetPath);

      if (!spritesheetPath || !fs.existsSync(spritesheetPath)) {
        onError(`Skipped invalid pet package: ${path.basename(dir)}`);
        return null;
      }

      return {
        id,
        key: `${prefix}:${id}`,
        displayName: String(manifest.displayName || id),
        description: String(manifest.description || ""),
        source,
        sourceLabel: PET_SOURCE_LABELS[source] || source,
        root: dir,
        spritesheetPath,
        frame: normalizePetFrame(manifest.frame)
      };
    })
    .filter(Boolean);
}

function discoverPets(petsRoot, options = {}) {
  // 内置宠物排在前面，保证用户目录为空时仍有可显示的默认资源。
  const bundledPets = options.bundledPetsRoot
    ? discoverPetsInDirectory(options.bundledPetsRoot, "builtin", options.onError)
    : [];
  return [
    ...bundledPets,
    ...discoverPetsInDirectory(petsRoot, "pets", options.onError)
  ];
}

function toPetPayload(pet) {
  // 只把 Renderer 绘制所需字段发送出去，不暴露整个内部对象。
  if (!pet) return null;
  return {
    id: pet.id,
    key: pet.key,
    displayName: pet.displayName,
    description: pet.description,
    source: pet.source,
    sourceLabel: pet.sourceLabel,
    spritesheetUrl: pathToFileURL(pet.spritesheetPath).toString(),
    frame: { ...pet.frame }
  };
}

module.exports = {
  DEFAULT_PET_FRAME,
  discoverPets,
  getActivePetsRoot,
  normalizePetFrame,
  sanitizeId,
  toPetPayload
};
