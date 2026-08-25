/**
 * Codex-compatible 宠物包加载器。
 * 默认宠物和用户导入宠物使用同一个目录；这里负责解析目录、校验图集路径并生成安全的 file URL。
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

const PACKAGED_PETS_PATH = Object.freeze(["src", "assets", "pets"]);

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

function resolvePetStorageRoot({ isPackaged, resourcesPath, developmentPetsRoot }) {
  // 开发态直接使用仓库的 src/assets/pets；发布版对应到 asar 外的 resources 目录，
  // 因为 app.asar 内文件只读，不能接收用户导入。
  if (isPackaged) {
    if (typeof resourcesPath !== "string" || resourcesPath.length === 0) {
      throw new TypeError("resourcesPath is required for a packaged pet directory");
    }
    return path.resolve(resourcesPath, ...PACKAGED_PETS_PATH);
  }
  if (typeof developmentPetsRoot !== "string" || developmentPetsRoot.length === 0) {
    throw new TypeError("developmentPetsRoot is required");
  }
  return path.resolve(developmentPetsRoot);
}

function discoverPetsInDirectory(petsRoot, onError = () => {}) {
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
        key: `pets:${id}`,
        displayName: String(manifest.displayName || id),
        description: String(manifest.description || ""),
        source: "pets",
        root: dir,
        spritesheetPath,
        frame: normalizePetFrame(manifest.frame)
      };
    })
    .filter(Boolean);
}

function discoverPets(petsRoot, options = {}) {
  return discoverPetsInDirectory(petsRoot, options.onError);
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
    spritesheetUrl: pathToFileURL(pet.spritesheetPath).toString(),
    frame: { ...pet.frame }
  };
}

module.exports = {
  DEFAULT_PET_FRAME,
  discoverPets,
  normalizePetFrame,
  resolvePetStorageRoot,
  sanitizeId,
  toPetPayload
};
