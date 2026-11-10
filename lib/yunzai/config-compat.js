//#region src/yunzai/config-compat.ts
const adaptedConfigs = /* @__PURE__ */ new WeakSet();
/** Adapt legacy single-group APIs only; TRSS already accepts (botId, groupId). */
function installConfigCompatibility(cfg, variant, warn) {
	if (!cfg || typeof cfg.getGroup !== "function") return false;
	if (variant === "trss" || adaptedConfigs.has(cfg)) return true;
	if (variant !== "miao" && variant !== "yunzai") {
		warn("[compat] 未识别群配置接口，保留原生 cfg.getGroup");
		return false;
	}
	try {
		const getGroup = cfg.getGroup;
		cfg.getGroup = function(...args) {
			return Reflect.apply(getGroup, this, args.length >= 2 ? [args[1], ...args.slice(2)] : args);
		};
		adaptedConfigs.add(cfg);
		return true;
	} catch {
		warn("[compat] cfg.getGroup 不可注入双参数兼容");
		return false;
	}
}

//#endregion
export { installConfigCompatibility };