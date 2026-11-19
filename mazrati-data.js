/* MAZRATI Data Adapter v1.0.0
 * Browser-side loader for the MAZRATI expert plant catalogue.
 * No UI changes and no external dependencies.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MazratiData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FILES = {
    vegetables: "vegetable-profiles.json",
    fruitTrees: "fruit-tree-profiles.json",
    fieldCrops: "field-crop-profiles.json",
    ornamentals: "ornamental-profiles.json",
    medicinalAromatic: "medicinal-aromatic-profiles.json",
    indoorShade: "indoor-shade-profiles.json"
  };

  function normalizeText(value) {
    return String(value == null ? "" : value)
      .toLocaleLowerCase("ar-IQ")
      .normalize("NFKC")
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ى/g, "ي")
      .trim();
  }

  async function readJson(baseUrl, filename, fetchImpl) {
    const response = await fetchImpl(baseUrl + filename, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error("تعذر تحميل " + filename + " (HTTP " + response.status + ")");
    }
    return response.json();
  }

  async function load(options) {
    const opts = options || {};
    const fetchImpl = opts.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (!fetchImpl) throw new Error("المتصفح لا يدعم fetch؛ تعذر تحميل قاعدة البيانات.");

    const baseUrl = String(opts.baseUrl || "./").replace(/\/?$/, "/");
    const manifest = await readJson(baseUrl, "database-manifest.json", fetchImpl);
    const catalogue = await readJson(baseUrl, "plants.json", fetchImpl);

    const categoryFiles = Object.values(FILES);
    const datasets = await Promise.all(categoryFiles.map(file => readJson(baseUrl, file, fetchImpl)));
    const profileRows = datasets.flatMap(dataset => Array.isArray(dataset.profiles) ? dataset.profiles : []);

    const catalogueRows = Array.isArray(catalogue.plants) ? catalogue.plants : [];
    const catalogueMap = new Map();
    for (const plant of catalogueRows) {
      if (!plant || !plant.id) throw new Error("يوجد سجل فهرس بلا معرّف نبات.");
      if (catalogueMap.has(plant.id)) throw new Error("معرّف نبات مكرر في الفهرس: " + plant.id);
      catalogueMap.set(plant.id, plant);
    }

    const profileMap = new Map();
    for (const profile of profileRows) {
      if (!profile || !profile.plant_id) throw new Error("يوجد ملف تفصيلي بلا plant_id.");
      if (profileMap.has(profile.plant_id)) throw new Error("ملف تفصيلي مكرر للنبات: " + profile.plant_id);
      profileMap.set(profile.plant_id, profile);
    }

    const missingProfiles = catalogueRows.filter(p => !profileMap.has(p.id)).map(p => p.id);
    const orphanProfiles = profileRows.filter(p => !catalogueMap.has(p.plant_id)).map(p => p.plant_id);
    if (missingProfiles.length || orphanProfiles.length) {
      throw new Error("عدم تطابق الفهرس والملفات التفصيلية. بلا ملف: " +
        missingProfiles.join(",") + "؛ ملفات بلا فهرس: " + orphanProfiles.join(","));
    }

    const expectedCount = Number(manifest.plant_count || catalogueRows.length);
    if (catalogueRows.length !== expectedCount) {
      throw new Error("عدد النباتات لا يطابق manifest: المتوقع " + expectedCount +
        "، الموجود " + catalogueRows.length);
    }

    const plants = catalogueRows.map(row => ({
      ...row,
      profile: profileMap.get(row.id),
      hasDetailedProfile: profileMap.has(row.id)
    }));

    const api = {
      version: manifest.version || "unknown",
      informationLevel: manifest.information_level || "unknown",
      total: plants.length,
      categories: manifest.categories || {},
      plants,
      getById(id) {
        return plants.find(p => p.id === String(id)) || null;
      },
      byCategory(category) {
        const target = normalizeText(category);
        return plants.filter(p => normalizeText(p.category) === target);
      },
      search(query, filters) {
        const q = normalizeText(query);
        const f = filters || {};
        return plants.filter(p => {
          if (f.category && normalizeText(p.category) !== normalizeText(f.category)) return false;
          if (f.profileStatus && p.profile_status !== f.profileStatus) return false;
          if (f.detailedOnly && !p.hasDetailedProfile) return false;
          if (!q) return true;
          const haystack = normalizeText([
            p.id, p.name_ar, p.scientific_name, p.category,
            ...(p.synonyms || []),
            p.profile && p.profile.name_ar
          ].join(" "));
          return haystack.includes(q);
        });
      },
      statusSummary() {
        const summary = { total: plants.length, detailed: 0, byStatus: {} };
        for (const p of plants) {
          if (p.hasDetailedProfile) summary.detailed++;
          const status = p.profile_status || "unspecified";
          summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;
        }
        return summary;
      }
    };

    return Object.freeze(api);
  }

  return Object.freeze({ load, normalizeText, files: Object.freeze(FILES) });
});
